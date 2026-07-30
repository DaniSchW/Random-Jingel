/* Web Audio API playback engine for Random Jingle. */
const RJAudio = (() => {
  let ctx = null;
  let masterGain = null;
  const bufferCache = new Map(); // jingleId -> AudioBuffer
  const activeSources = new Map(); // jingleId -> { source, onStop: [] }

  function ensureContext() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    return ctx;
  }

  function setMasterVolume(value) {
    ensureContext();
    masterGain.gain.value = value;
  }

  async function decode(jingleId, blob) {
    if (bufferCache.has(jingleId)) return bufferCache.get(jingleId);
    const arrayBuffer = await blob.arrayBuffer();
    const audioCtx = ensureContext();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    bufferCache.set(jingleId, audioBuffer);
    return audioBuffer;
  }

  function invalidate(jingleId) {
    bufferCache.delete(jingleId);
  }

  // start/duration (seconds) trim the playback range using
  // AudioBufferSourceNode.start(when, offset, duration) — the browser stops
  // the source (and fires onended) at the right time on its own, no manual
  // timer needed. Both are clamped against the actual decoded buffer length
  // so stale/out-of-range cut points (e.g. after replacing the audio file)
  // degrade to "play what's left" instead of throwing. onProgress(elapsed,
  // total), if given, is driven by requestAnimationFrame off the audio
  // clock (audioCtx.currentTime), not a timer — stays sample-accurate and
  // only ticks while a frame is actually being painted.
  async function play(jingleId, blob, { onStart, onEnd, onProgress, start = 0, duration } = {}) {
    const audioCtx = ensureContext();
    stop(jingleId);

    let buffer;
    try {
      buffer = await decode(jingleId, blob);
    } catch (err) {
      console.error('Konnte Audio nicht dekodieren', err);
      throw err;
    }

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(masterGain);

    const safeStart = Math.min(Math.max(start || 0, 0), buffer.duration);
    const remaining = buffer.duration - safeStart;
    // Always a concrete number (never "play to end" left implicit) so
    // onProgress always has a real total to divide by.
    const safeDuration = duration != null ? Math.min(Math.max(duration, 0), remaining) : remaining;

    let rafId = null;
    function stopProgressLoop() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    source.onended = () => {
      stopProgressLoop();
      if (activeSources.get(jingleId)?.source === source) {
        activeSources.delete(jingleId);
      }
      if (onProgress) onProgress(safeDuration, safeDuration);
      if (onEnd) onEnd();
    };

    activeSources.set(jingleId, { source, stopProgressLoop });
    const startedAt = audioCtx.currentTime;
    source.start(0, safeStart, safeDuration);
    if (onStart) onStart();

    if (onProgress) {
      const tick = () => {
        const elapsed = Math.min(Math.max(audioCtx.currentTime - startedAt, 0), safeDuration);
        onProgress(elapsed, safeDuration);
        if (elapsed < safeDuration) rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }
    return source;
  }

  function stop(jingleId) {
    const entry = activeSources.get(jingleId);
    if (entry) {
      if (entry.stopProgressLoop) entry.stopProgressLoop();
      try {
        entry.source.onended = null;
        entry.source.stop();
      } catch (e) { /* already stopped */ }
      activeSources.delete(jingleId);
    }
  }

  function stopAll() {
    for (const jingleId of Array.from(activeSources.keys())) {
      stop(jingleId);
    }
  }

  function isPlaying(jingleId) {
    return activeSources.has(jingleId);
  }

  return {
    ensureContext,
    setMasterVolume,
    play,
    stop,
    stopAll,
    isPlaying,
    invalidate,
    decodeBuffer: decode,
  };
})();

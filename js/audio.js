/* Web Audio API playback engine for Random Jingle.
 * Phase 10: only one jingle ever plays at a time. `current` is the single
 * source of truth for "what's playing right now" — starting a new one
 * always hard-stops whatever `current` points to first, and `playToken`
 * guards against a still-decoding jingle audibly overlapping a later one
 * that finishes decoding (and starts) first, if two plays are triggered in
 * quick succession. */
const RJAudio = (() => {
  let ctx = null;
  let masterGain = null;
  const bufferCache = new Map(); // jingleId -> AudioBuffer
  let current = null; // { jingleId, source, stopProgressLoop } | null
  let playToken = 0;

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

  // Hard-stops whatever is currently playing, if anything. Deliberately
  // leaves the source's `onended` handler in place (unlike a plain
  // source.stop() call on its own) — stop() still fires the native `ended`
  // event, which runs that jingle's own onEnd callback and resets its
  // button/progress UI immediately, the same path a natural finish uses.
  function stopCurrent() {
    if (!current) return;
    const { source, stopProgressLoop } = current;
    current = null;
    if (stopProgressLoop) stopProgressLoop();
    try {
      source.stop();
    } catch (e) { /* already stopped/ended */ }
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
    const token = ++playToken;
    stopCurrent(); // only one jingle plays at a time — hard-stop whatever's running first

    let buffer;
    try {
      buffer = await decode(jingleId, blob);
    } catch (err) {
      console.error('Konnte Audio nicht dekodieren', err);
      throw err;
    }

    // A newer play() call came in while this one was still decoding — bail
    // out silently instead of starting audio out of order, which would
    // otherwise briefly overlap whatever that newer call already started.
    if (token !== playToken) return null;

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
      // If a *different* play() call for this same jingleId has since
      // become current (e.g. Random landing on the jingle that's already
      // playing, restarting it), this callback set is stale: the new call's
      // own onStart already re-applied "playing" state to the same shared
      // button refs, and firing this old onEnd now would immediately wipe
      // that back off. Only the case of a genuinely different jingle (or
      // nothing) taking over should reset this jingle's own UI.
      const supersededBySameJingle = current && current.jingleId === jingleId && current.source !== source;
      if (current && current.source === source) current = null;
      if (!supersededBySameJingle) {
        if (onProgress) onProgress(safeDuration, safeDuration);
        if (onEnd) onEnd();
      }
    };

    current = { jingleId, source, stopProgressLoop };
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

  // Only stops if jingleId is the one actually playing — a no-op otherwise
  // (e.g. calling stop() on a jingle that already finished, or was already
  // superseded by another one starting).
  function stop(jingleId) {
    if (current && current.jingleId === jingleId) stopCurrent();
  }

  function stopAll() {
    stopCurrent();
  }

  function isPlaying(jingleId) {
    return !!current && current.jingleId === jingleId;
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

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

  async function play(jingleId, blob, { onStart, onEnd } = {}) {
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
    source.onended = () => {
      if (activeSources.get(jingleId)?.source === source) {
        activeSources.delete(jingleId);
      }
      if (onEnd) onEnd();
    };

    activeSources.set(jingleId, { source });
    source.start(0);
    if (onStart) onStart();
    return source;
  }

  function stop(jingleId) {
    const entry = activeSources.get(jingleId);
    if (entry) {
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
  };
})();

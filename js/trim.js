/* Cut-point ("trim") editor for Random Jingle (Phase 6). Draws a waveform
 * from the jingle's already-decoded audio, lets the user drag two markers
 * (or type exact seconds) to pick a start/end range, and previews just
 * that range via RJAudio. The stored audio file itself is never touched —
 * only trimStart/trimEnd metadata (seconds) is saved on the jingle, and
 * RJAudio.play() applies it as a Web Audio start-offset/duration at
 * playback time (see js/audio.js).
 */
const RJTrimUI = (() => {
  const PREVIEW_ID = '__trim_preview__';
  // Separate RJAudio play id for "play the full original", distinct from
  // PREVIEW_ID (which always plays just the current start/end selection).
  // RJAudio only ever plays one thing at a time regardless of id, so
  // starting either one automatically hard-stops the other via its own
  // onEnd callback — each button/progress display only ever resets its
  // own UI, never reaches into the other's.
  const PREVIEW_FULL_ID = '__trim_preview_full__';
  const MIN_GAP = 0.05;

  const dialog = document.getElementById('trimDialog');
  const form = dialog.querySelector('form');
  const nameEl = document.getElementById('trimJingleName');
  const wrap = document.getElementById('trimWaveformWrap');
  const canvas = document.getElementById('trimCanvas');
  const originalProgressEl = document.getElementById('trimOriginalProgress');
  const originalTimeEl = document.getElementById('trimOriginalTime');
  const selectionEl = document.getElementById('trimSelection');
  const handleStart = document.getElementById('trimHandleStart');
  const handleEnd = document.getElementById('trimHandleEnd');
  const loadingEl = document.getElementById('trimLoading');
  const startInput = document.getElementById('trimStartInput');
  const endInput = document.getElementById('trimEndInput');
  const durationHint = document.getElementById('trimDurationHint');
  const previewBtn = document.getElementById('trimPreviewBtn');
  const playOriginalBtn = document.getElementById('trimPlayOriginalBtn');
  const resetBtn = document.getElementById('trimResetBtn');

  let duration = 0;
  let start = 0;
  let end = 0;
  // Where "Original abspielen" starts/resumes from. Lets a whole song be
  // scrubbed to e.g. the halfway point (by clicking the waveform) before
  // previewing or setting a cut marker there, instead of always having to
  // listen from 0:00 first.
  let playhead = 0;
  let currentBlob = null;
  let onSaveCb = null;
  let previewing = false;
  let playingOriginal = false;

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function drawWaveform(buffer) {
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.ceil(data.length / w));
    const mid = h / 2;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7c3aed';
    for (let x = 0; x < w; x++) {
      const from = x * step;
      let min = 0;
      let max = 0;
      for (let i = 0; i < step; i++) {
        const idx = from + i;
        if (idx >= data.length) break;
        const v = data[idx];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = mid + min * mid;
      const y2 = mid + max * mid;
      ctx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }

  function timeToX(t) {
    return duration > 0 ? (t / duration) * wrap.clientWidth : 0;
  }
  function xToTime(x) {
    return duration > 0 ? clamp((x / wrap.clientWidth) * duration, 0, duration) : 0;
  }

  function updateUI() {
    const xStart = timeToX(start);
    const xEnd = timeToX(end);
    handleStart.style.left = `${xStart}px`;
    handleEnd.style.left = `${xEnd}px`;
    selectionEl.style.left = `${xStart}px`;
    selectionEl.style.width = `${Math.max(0, xEnd - xStart)}px`;
    startInput.value = start.toFixed(2);
    endInput.value = end.toFixed(2);
    durationHint.textContent = RJI18n.t('trim.selectionHint', {
      selected: (end - start).toFixed(2),
      total: duration.toFixed(2),
    });
  }

  function setRange(newStart, newEnd, movingHandle) {
    newStart = clamp(newStart, 0, duration);
    newEnd = clamp(newEnd, 0, duration);
    if (newEnd - newStart < MIN_GAP) {
      if (movingHandle === 'start') newStart = Math.min(newStart, newEnd - MIN_GAP);
      else newEnd = Math.max(newEnd, newStart + MIN_GAP);
    }
    start = clamp(newStart, 0, duration);
    end = clamp(newEnd, start + MIN_GAP, duration);
    updateUI();
  }

  function makeDraggable(handle, which) {
    let dragging = false;
    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = wrap.getBoundingClientRect();
      const t = xToTime(e.clientX - rect.left);
      if (which === 'start') setRange(t, end, 'start');
      else setRange(start, t, 'end');
    });
    const release = () => { dragging = false; };
    handle.addEventListener('pointerup', release);
    handle.addEventListener('pointercancel', release);
    handle.addEventListener('keydown', (e) => {
      const delta = e.shiftKey ? 1 : 0.1;
      if (e.key === 'ArrowLeft') {
        if (which === 'start') setRange(start - delta, end, 'start');
        else setRange(start, end - delta, 'end');
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        if (which === 'start') setRange(start + delta, end, 'start');
        else setRange(start, end + delta, 'end');
        e.preventDefault();
      }
    });
  }
  makeDraggable(handleStart, 'start');
  makeDraggable(handleEnd, 'end');

  // Clicking anywhere on the waveform itself (not on a handle, which has
  // its own drag logic above) moves whichever marker — start or end — is
  // currently closer to the clicked position, AND jumps the "Original
  // abspielen" playhead there (seeking immediately if it's already
  // playing). That pairing is deliberate: clicking a spot in a long,
  // freshly-uploaded song both marks it as a candidate cut point and lets
  // you instantly hear from there, without listening through from 0:00.
  wrap.addEventListener('click', (e) => {
    if (e.target === handleStart || e.target === handleEnd) return;
    const rect = wrap.getBoundingClientRect();
    const t = xToTime(e.clientX - rect.left);
    if (Math.abs(t - start) <= Math.abs(t - end)) {
      setRange(t, end, 'start');
    } else {
      setRange(start, t, 'end');
    }
    if (playingOriginal) {
      playOriginalFrom(t);
    } else {
      playhead = clamp(t, 0, duration);
      renderPlayhead();
    }
  });

  startInput.addEventListener('change', () => setRange(Number(startInput.value) || 0, end, 'start'));
  endInput.addEventListener('change', () => setRange(start, Number(endInput.value) || 0, 'end'));

  function setPreviewLabel(isPreviewing) {
    previewBtn.textContent = RJI18n.t(isPreviewing ? 'trim.stopPreview' : 'trim.preview');
  }

  function stopPreview() {
    RJAudio.stop(PREVIEW_ID);
    previewing = false;
    setPreviewLabel(false);
  }

  previewBtn.addEventListener('click', async () => {
    if (previewing) {
      stopPreview();
      return;
    }
    previewing = true;
    setPreviewLabel(true);
    try {
      RJAudio.ensureContext();
      await RJAudio.play(PREVIEW_ID, currentBlob, {
        start,
        duration: Math.max(0.01, end - start),
        onEnd: () => { previewing = false; setPreviewLabel(false); },
      });
    } catch (err) {
      console.error('Vorhören fehlgeschlagen', err);
      previewing = false;
      setPreviewLabel(false);
    }
  });

  // ---- Full-original playback + its own progress bar/time readout ----
  // Entirely separate from the start/end-selection preview above: plays
  // from the current playhead (0:00 by default, or wherever the waveform
  // was last clicked) to the end of the decoded audio, and drives its own
  // DOM elements (trimOriginalProgress/trimOriginalTime) instead of
  // touching trimSelection or the handles, which stay exactly where the
  // user left them regardless of playback.
  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function setPlayOriginalLabel(isPlaying) {
    playOriginalBtn.textContent = RJI18n.t(isPlaying ? 'trim.stopPreview' : 'trim.playOriginal');
  }

  function resetOriginalProgressUI() {
    playhead = 0;
    originalProgressEl.style.width = '0%';
    originalTimeEl.classList.add('hidden');
  }

  // Reflects the current playhead in the red progress fill and the time
  // readout, without touching playback itself — used right after a
  // waveform click (seeking while stopped) and on every playback tick.
  function renderPlayhead() {
    const pct = duration > 0 ? Math.min(100, (playhead / duration) * 100) : 0;
    originalProgressEl.style.width = `${pct}%`;
    originalTimeEl.classList.remove('hidden');
    originalTimeEl.textContent = `${formatTime(playhead)} / ${formatTime(duration)}`;
  }

  // RJAudio.stop() still fires the source's native `ended` event (see
  // js/audio.js), which runs the same onEnd callback a natural finish
  // does — so a manual stop resets to 0:00 just like it already does for
  // every other progress bar in the app, rather than pausing in place.
  function stopOriginalPlayback() {
    RJAudio.stop(PREVIEW_FULL_ID);
    playingOriginal = false;
    setPlayOriginalLabel(false);
    resetOriginalProgressUI();
  }

  // Starts (or seeks, if already playing — RJAudio.play() hard-stops the
  // running source first) playback of the full original from seekStart.
  async function playOriginalFrom(seekStart) {
    playhead = clamp(seekStart, 0, duration);
    renderPlayhead();
    playingOriginal = true;
    setPlayOriginalLabel(true);
    try {
      RJAudio.ensureContext();
      await RJAudio.play(PREVIEW_FULL_ID, currentBlob, {
        start: playhead,
        duration: Math.max(0.01, duration - playhead),
        onProgress: (elapsed) => {
          playhead = seekStart + elapsed;
          renderPlayhead();
        },
        onEnd: () => {
          playingOriginal = false;
          setPlayOriginalLabel(false);
          resetOriginalProgressUI();
        },
      });
    } catch (err) {
      console.error('Original-Wiedergabe fehlgeschlagen', err);
      playingOriginal = false;
      setPlayOriginalLabel(false);
      resetOriginalProgressUI();
    }
  }

  playOriginalBtn.addEventListener('click', () => {
    if (playingOriginal) {
      stopOriginalPlayback();
      return;
    }
    playOriginalFrom(playhead);
  });

  function stopAllTrimAudio() {
    stopPreview();
    stopOriginalPlayback();
  }

  resetBtn.addEventListener('click', () => setRange(0, duration));

  form.addEventListener('submit', () => {
    stopAllTrimAudio();
    const isFullRange = start <= 0.01 && end >= duration - 0.01;
    if (onSaveCb) {
      onSaveCb(isFullRange ? null : Number(start.toFixed(2)), isFullRange ? null : Number(end.toFixed(2)));
    }
  });

  dialog.addEventListener('close', stopAllTrimAudio);
  dialog.querySelectorAll('[data-close-dialog]').forEach((btn) => btn.addEventListener('click', stopAllTrimAudio));

  // jingle: { id, name, trimStart, trimEnd }; blob: the decoded audio's Blob.
  async function open(jingle, blob, { onSave }) {
    onSaveCb = onSave;
    currentBlob = blob;
    nameEl.textContent = jingle.name;
    loadingEl.classList.remove('hidden');
    canvas.style.visibility = 'hidden';
    setPreviewLabel(false);
    setPlayOriginalLabel(false);
    resetOriginalProgressUI();
    dialog.showModal();

    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;

    try {
      const buffer = await RJAudio.decodeBuffer(jingle.id, blob);
      duration = buffer.duration;
      start = jingle.trimStart != null ? clamp(jingle.trimStart, 0, duration) : 0;
      end = jingle.trimEnd != null ? clamp(jingle.trimEnd, 0, duration) : duration;
      if (end - start < MIN_GAP) end = duration;
      drawWaveform(buffer);
      updateUI();
      canvas.style.visibility = 'visible';
    } catch (err) {
      console.error('Wellenform konnte nicht geladen werden', err);
      closeDialogSafely();
    } finally {
      loadingEl.classList.add('hidden');
    }
  }

  function closeDialogSafely() {
    if (dialog.open) dialog.close();
  }

  return { open };
})();

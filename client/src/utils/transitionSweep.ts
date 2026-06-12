/**
 * Procedural track-transition sweep ("whoosh") played by the host browser DURING
 * the server's volume duck. The host machine is normally both the Spotify playback
 * device and the PA source, so this Web Audio layer mixes with Spotify at the OS
 * level and masks the stepped Connect volume changes plus the cut itself.
 *
 * Shape: filtered noise that swells in over the duck-down, peaks across the cut
 * window, and falls away during the ramp-up — energy where the music dips.
 */

let sweepCtx: AudioContext | null = null;

/** Estimated gap between duck-down finishing and the next track being audible. */
const CUT_WINDOW_MS = 500;
/** Peak loudness of the sweep (linear gain). Texture, not an airhorn. */
const SWEEP_PEAK_GAIN = 0.2;

function getContext(): AudioContext | null {
  try {
    if (!sweepCtx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      sweepCtx = new Ctor();
    }
    return sweepCtx;
  } catch {
    return null;
  }
}

export function playTransitionSweep(downMs = 600, upMs = 450): void {
  const ctx = getContext();
  if (!ctx) return;
  const run = () => {
    try {
      const totalS = (downMs + CUT_WINDOW_MS + upMs) / 1000;
      const sr = ctx.sampleRate;
      const frames = Math.max(1, Math.ceil(sr * (totalS + 0.1)));
      const buf = ctx.createBuffer(1, frames, sr);
      const data = buf.getChannelData(0);
      // Pink-ish noise (Paul Kellet's economy filter) — softer than white noise.
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      for (let i = 0; i < frames; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + white * 0.099046;
        b1 = 0.963 * b1 + white * 0.2965164;
        b2 = 0.57 * b2 + white * 1.0526913;
        data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
      }

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      const gain = ctx.createGain();

      const t0 = ctx.currentTime;
      const peakT = t0 + (downMs + CUT_WINDOW_MS * 0.5) / 1000;
      const endT = t0 + totalS;
      // Bright -> dark -> bright, following the music's energy dip.
      bp.frequency.setValueAtTime(1600, t0);
      bp.frequency.exponentialRampToValueAtTime(320, peakT);
      bp.frequency.exponentialRampToValueAtTime(1300, endT);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(SWEEP_PEAK_GAIN, peakT);
      gain.gain.exponentialRampToValueAtTime(0.0001, endT);

      src.connect(bp);
      bp.connect(gain);
      gain.connect(ctx.destination);
      src.start(t0);
      src.stop(endT + 0.05);
    } catch {
      /* a missing sweep must never break the transition */
    }
  };
  // Any prior click on the host page grants activation, so resume() succeeds.
  if (ctx.state === 'suspended') {
    ctx.resume().then(run).catch(() => undefined);
  } else {
    run();
  }
}

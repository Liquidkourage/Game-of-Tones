/**
 * DJ track-change stinger, synthesized with Web Audio (no asset file). Played by
 * the host browser the moment the server triggers a track change. The host machine
 * is normally both the Spotify playback device and the PA source, so this mixes
 * with Spotify at the OS level and covers the hard cut + play-call latency.
 *
 * Three layers (~1.8 s total):
 *  - vinyl spinback: detuned triangle pair pitch-diving 520 Hz -> 35 Hz with flutter
 *  - swoosh: pink noise through an upward bandpass sweep
 *  - landing thump: short sub-kick right where the next track tends to start
 */

let sfxCtx: AudioContext | null = null;

/** Master loudness of the stinger (linear gain). */
const STINGER_GAIN = 0.5;

function getContext(): AudioContext | null {
  try {
    if (!sfxCtx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      sfxCtx = new Ctor();
    }
    return sfxCtx;
  } catch {
    return null;
  }
}

function buildPinkNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const frames = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Paul Kellet's economy pink-noise filter — softer than white noise.
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
  return buf;
}

export function playTrackChangeSound(): void {
  const ctx = getContext();
  if (!ctx) return;
  const run = () => {
    try {
      const t0 = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = STINGER_GAIN;
      master.connect(ctx.destination);

      // --- Layer 1: vinyl spinback (record slowing to a stop) ---
      const SPIN_S = 1.25;
      const spinGain = ctx.createGain();
      spinGain.gain.setValueAtTime(0.0001, t0);
      spinGain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.08);
      spinGain.gain.setValueAtTime(0.5, t0 + SPIN_S * 0.55);
      spinGain.gain.exponentialRampToValueAtTime(0.0001, t0 + SPIN_S);
      spinGain.connect(master);
      // Slight flutter (wobbly motor) on both oscillators.
      const flutter = ctx.createOscillator();
      flutter.frequency.value = 7;
      const flutterDepth = ctx.createGain();
      flutterDepth.gain.value = 14;
      flutter.connect(flutterDepth);
      for (const detune of [0, 9]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.detune.value = detune;
        osc.frequency.setValueAtTime(520, t0);
        osc.frequency.exponentialRampToValueAtTime(35, t0 + SPIN_S);
        flutterDepth.connect(osc.frequency);
        osc.connect(spinGain);
        osc.start(t0);
        osc.stop(t0 + SPIN_S + 0.05);
      }
      flutter.start(t0);
      flutter.stop(t0 + SPIN_S + 0.05);

      // --- Layer 2: swoosh (rising pink-noise sweep under the spinback) ---
      const SWOOSH_S = 1.5;
      const noise = ctx.createBufferSource();
      noise.buffer = buildPinkNoiseBuffer(ctx, SWOOSH_S + 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(280, t0);
      bp.frequency.exponentialRampToValueAtTime(2400, t0 + SWOOSH_S);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, t0);
      noiseGain.gain.exponentialRampToValueAtTime(0.4, t0 + SWOOSH_S * 0.6);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + SWOOSH_S);
      noise.connect(bp);
      bp.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(t0);
      noise.stop(t0 + SWOOSH_S + 0.1);

      // --- Layer 3: landing thump (sub-kick where the next track usually starts) ---
      const THUMP_AT = 1.2;
      const THUMP_S = 0.18;
      const thump = ctx.createOscillator();
      thump.type = 'sine';
      thump.frequency.setValueAtTime(140, t0 + THUMP_AT);
      thump.frequency.exponentialRampToValueAtTime(42, t0 + THUMP_AT + THUMP_S);
      const thumpGain = ctx.createGain();
      thumpGain.gain.setValueAtTime(0.0001, t0 + THUMP_AT);
      thumpGain.gain.exponentialRampToValueAtTime(0.9, t0 + THUMP_AT + 0.02);
      thumpGain.gain.exponentialRampToValueAtTime(0.0001, t0 + THUMP_AT + THUMP_S);
      thump.connect(thumpGain);
      thumpGain.connect(master);
      thump.start(t0 + THUMP_AT);
      thump.stop(t0 + THUMP_AT + THUMP_S + 0.05);
    } catch {
      /* a missing stinger must never break the transition */
    }
  };
  // Any prior click on the host page grants activation, so resume() succeeds.
  if (ctx.state === 'suspended') {
    ctx.resume().then(run).catch(() => undefined);
  } else {
    run();
  }
}

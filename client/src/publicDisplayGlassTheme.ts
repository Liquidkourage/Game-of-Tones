/** Shared violet–mint glass tokens for the projector / public display (matches host glass theme). */

export const pdGlass = {
  pageBg:
    'linear-gradient(155deg, #0f0c24 0%, #141a32 40%, #0a0e16 100%)',
  pageBgConnect:
    'linear-gradient(155deg, #0f0c24 0%, #152a3d 38%, #0a0e16 100%)',
  glassPanel:
    'linear-gradient(145deg, rgba(72, 52, 120, 0.42) 0%, rgba(32, 28, 56, 0.55) 55%, rgba(18, 20, 36, 0.62) 100%)',
  glassPanelStrong:
    'linear-gradient(165deg, rgba(72, 48, 128, 0.55) 0%, rgba(28, 26, 48, 0.88) 55%, rgba(14, 16, 28, 0.94) 100%)',
  borderViolet: 'rgba(167, 139, 250, 0.32)',
  borderMint: 'rgba(0, 255, 163, 0.38)',
  borderMintStrong: 'rgba(0, 255, 200, 0.48)',
  mint: '#00ff88',
  mintBright: '#00ffb0',
  violetBright: '#c4b5fd',
  glowMint: '0 0 48px rgba(0, 255, 136, 0.22)',
  glowViolet: '0 0 56px rgba(109, 40, 217, 0.18)',
  shadowGlass: '0 12px 40px rgba(0, 0, 0, 0.36), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
  orbViolet: 'radial-gradient(circle, rgba(124, 58, 237, 0.45) 0%, transparent 68%)',
  orbCyan: 'radial-gradient(circle, rgba(45, 130, 200, 0.28) 0%, transparent 65%)',
  titleGradient:
    'linear-gradient(90deg, #00ffa3 0%, #c4b5fd 35%, #ffffff 50%, #c4b5fd 65%, #00ffa3 100%)',
} as const;

const CALL_THUMB_GRADIENTS = [
  'linear-gradient(135deg, rgba(139, 92, 246, 0.75) 0%, rgba(59, 130, 246, 0.45) 50%, rgba(0, 255, 136, 0.25) 100%)',
  'linear-gradient(135deg, rgba(109, 40, 217, 0.7) 0%, rgba(236, 72, 153, 0.4) 55%, rgba(0, 200, 255, 0.22) 100%)',
  'linear-gradient(135deg, rgba(0, 255, 136, 0.35) 0%, rgba(139, 92, 246, 0.55) 50%, rgba(30, 58, 138, 0.5) 100%)',
  'linear-gradient(145deg, rgba(167, 139, 250, 0.65) 0%, rgba(255, 200, 120, 0.3) 45%, rgba(0, 255, 200, 0.2) 100%)',
  'linear-gradient(160deg, rgba(72, 48, 140, 0.8) 0%, rgba(0, 255, 200, 0.28) 100%)',
] as const;

export function callThumbBackground(seed: number): string {
  const i = Math.abs(Math.floor(seed)) % CALL_THUMB_GRADIENTS.length;
  return CALL_THUMB_GRADIENTS[i]!;
}

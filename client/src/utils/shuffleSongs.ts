/** Fisher–Yates shuffle (order-preserving copy). */
export function shuffleSongs<T>(songs: T[]): T[] {
  const out = [...songs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

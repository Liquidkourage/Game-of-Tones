# Player UI mockups

## `player-in-game-390x844.html`

Static **in-game** player screen at **390×844 CSS pixels** — the logical resolution of **iPhone 14 / 15** (and similar) in portrait.

- Sizes mirror `client/src/App.css` and the player FAB from `PlayerView.tsx` (toggle 42×24px, header padding, `min()` bingo card rule, 90px FAB at 390px width, etc.).
- Includes a **fake iOS status bar** and **home indicator** so the frame feels like a **real screenshot**.

### See it at true physical scale

1. Copy/open the file on your **iPhone** (AirDrop, Files, or host via `npx serve` from repo root).
2. Open in **Safari**, zoom so the black frame fills the width (on a **390 pt** wide phone that’s usually default).
3. **Screenshot** — you get a PNG at the device’s native scale (e.g. **1170×2532** @3×), with elements sized like the mock.

**Limitations:** Browser chrome, Dynamic Island, system font/size settings, and `100vh` vs `dvh` can differ slightly from the production Vite app. For the shipped app, run the real client on device; this mock is for layout/scale reference.

## App behavior (live player)

The real **`PlayerView`** uses a **single unified chrome**: header (name, players, songs played, connection + Resync) and one controls row (Display / Title–Artist, Text size). There is **no** separate “Focus card” / minimal top bar mode.

# Player UI Layout — Single Source of Truth

## DOM Structure

```
App
└── app-container (height: 100dvh, flex column)
    ├── app-header (sticky, flex-shrink: 0)
    └── app-main (flex: 1, min-height: 0, overflow: hidden when player)
        └── player-container (flex: 1, min-height: 0)
            ├── player-chrome (flex-shrink: 0) — header + controls
            └── player-content (flex: 1, min-height: 0)
                ├── bingo-section (flex: 1, min-height: 200px) — ResizeObserver target
                │   └── bingo-card (width/height from JS)
                │       └── bingo-card-grid (5×5)
                │           └── bingo-square × 25
                │               └── .square-text
                └── player-fab-row (flex-shrink: 0) — BINGO button
```

## Sizing Flow

1. **Viewport** → app-container gets `height: 100dvh`
2. **app-main** (with player) → `flex: 1`, `overflow: hidden` — no scroll, content must fit
3. **player-container** → `flex: 1`, `min-height: 0` — fills app-main, can shrink
4. **player-content** → `flex: 1`, `min-height: 0` — fills remaining space after chrome
5. **bingo-section** → `flex: 1`, `min-height: 200px` — gets remaining space; ResizeObserver measures it
6. **Card side** = `min(bingoSectionWidth, bingoSectionHeight) - 16`, clamped [180, 4096]
7. **FAB** → `flex-shrink: 0`, never clipped

## Font Sizing

- `.square-text`: `clamp(7px, min(2.5vw, 2.5vh), 11px)` — viewport-relative, no fixed px override
- Must NOT be overridden by more specific rules (e.g. `.player-container .bingo-card .square-text`)

## Critical Rules

- **No scroll** on player: overflow hidden on app-main and player-content
- **min-height: 0** on all flex children so they can shrink
- **flex-shrink: 0** on chrome and FAB so they never shrink
- **No dead selectors**: remove `.player-canvas-viewport`, `.player-canvas-inner`

## Media Queries

- 768px / 480px / landscape: MUST NOT override `.player-container` with `min-height: 100vh`, `overflow-y: visible`, or `height: auto` — that breaks the flex fit.

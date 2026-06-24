# Gesture: Leading vs Trailing Edge

A mobile touch gesture demo comparing **leading edge** and **trailing edge** gesture-initialization strategies when there's a 100&nbsp;ms delay between `touchstart` and gesture readiness.

Live demo: **https://nickcoury.github.io/gesture-leading-vs-trailing-edge/**

## The problem

When a gesture handler needs time to prepare (loading data, computing layout, etc.), touch events that arrive *during* that delay must be dealt with. Two strategies:

| Strategy | Anchor | Behaviour when ready |
|----------|--------|---------------------|
| **Leading edge** | Original `touchstart` position | All accumulated movement is applied at once — the overlay **jumps** to the finger. |
| **Trailing edge** | Most recent `touchmove` position | Accumulated movement is discarded — the overlay **starts fresh** from the current finger position, no jump. |

## How to test

1. Open the page on a phone (or Chrome DevTools mobile emulation).
2. The full-screen overlay covers a grid of coloured cards.
3. **Swipe down quickly** — the overlay follows your finger and shrinks to 90&nbsp;%, letting you peek at the cards behind.
4. Release — the overlay snaps back (it never actually dismisses).
5. Toggle between **Leading** and **Trailing** at the top.
6. Swipe *during* the 100&nbsp;ms prep delay to see the difference:
   - **Leading**: the overlay suddenly jumps to your finger.
   - **Trailing**: the overlay smoothly starts tracking from your finger's current position — no jump.

The **gold dot** marks the gesture anchor point — where the offset origin is set. In leading mode it stays at your initial touch point; in trailing mode it relocates to your finger when the gesture becomes ready.

## How it works

A 100&nbsp;ms **main-thread spinlock** (busy-wait loop) simulates real preparation work. During the spinlock the browser queues `touchmove` events — they can't fire until the main thread is free. When the spinlock ends:

- **Leading**: `offset = currentPos − touchStartPos` → the full accumulated delta is applied immediately, causing a visible jump.
- **Trailing**: `anchor = currentPos`, then `offset = currentPos − anchor = 0` → no jump; subsequent moves track from the new anchor.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure: base cards + overlay viewer + controls |
| `style.css` | Minimal mobile-first styling |
| `script.js` | Touch gesture logic, spinlock, mode toggle |

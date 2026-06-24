(function () {
  'use strict';

  var viewer     = document.getElementById('viewer');
  var segButtons = document.querySelectorAll('.seg-btn');
  var anchorDot  = document.getElementById('anchor-dot');
  var statusEl   = document.getElementById('status');

  // ---- Config ----
  var PREPARE_DELAY = 100;   // ms — main-thread spinlock duration
  var MIN_SCALE     = 0.9;   // scale at max drag distance
  var MAX_DRAG      = 300;   // px — drag distance at which scale bottoms out

  // ---- State ----
  var mode  = 'leading';     // 'leading' | 'trailing'
  var phase = 'idle';        // 'idle' | 'preparing' | 'tracking' | 'snapping'

  var startX = 0, startY = 0;   // raw touchstart coords
  var ancX   = 0, ancY   = 0;   // anchor (offset reference) — changes per mode
  var curX   = 0, curY   = 0;   // latest finger position
  var offX   = 0, offY   = 0;   // applied translate
  var sc     = 1;                // applied scale

  var ready    = false;          // true once the spinlock is over
  var reanchor = false;          // trailing edge: re-anchor on next touchmove

  // ---- Spinlock — blocks the main thread to simulate real work ----
  function spinlock(ms) {
    var t0 = performance.now();
    while (performance.now() - t0 < ms) { /* busy-wait */ }
  }

  // ---- DOM helpers ----
  function applyTransform() {
    viewer.style.transform =
      'translate(' + offX + 'px,' + offY + 'px) scale(' + sc + ')';
  }

  function showAnchor(x, y) {
    anchorDot.style.left = x + 'px';
    anchorDot.style.top  = y + 'px';
    anchorDot.classList.add('visible');
  }

  function hideAnchor() {
    anchorDot.classList.remove('visible');
  }

  function setStatus(text, active) {
    statusEl.textContent = text;
    statusEl.classList.toggle('active', !!active);
  }

  function snapBack() {
    phase = 'snapping';
    viewer.classList.add('snapping');
    offX = 0; offY = 0; sc = 1;
    applyTransform();
    hideAnchor();
    setStatus('Snapping back', false);
    setTimeout(function () {
      viewer.classList.remove('snapping');
      phase = 'idle';
      setStatus('Idle', false);
    }, 350);
  }

  // ---- Touch: start ----
  function onTouchStart(e) {
    // Ignore touches that land on the toggle controls
    if (e.target.closest('#controls')) return;
    // Don't start a new gesture if one is already in progress
    if (phase === 'preparing' || phase === 'tracking') return;

    e.preventDefault();

    var t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    ancX   = startX;
    ancY   = startY;
    curX   = startX;
    curY   = startY;
    offX   = 0; offY = 0; sc = 1;
    ready    = false;
    reanchor = false;
    phase    = 'preparing';

    viewer.classList.remove('snapping');

    // Show the anchor dot at the touch-start position
    showAnchor(startX, startY);

    // Show "Preparing" and force a reflow so it paints *before* the spinlock
    setStatus('Preparing (100ms spinlock)\u2026', true);
    void statusEl.offsetHeight;   // force layout / paint

    // ===== 100 ms main-thread spinlock =====
    // touchmove events queue up in the browser during this time;
    // they fire in rapid succession once we return.
    spinlock(PREPARE_DELAY);

    // Gesture is now ready
    ready  = true;
    phase  = 'tracking';
    setStatus('Tracking', true);

    if (mode === 'trailing') {
      // Trailing edge: re-anchor to the most recent touchmove position
      // on the first touchmove that fires after the spinlock.
      reanchor = true;
    }
    // Leading edge: anchor stays at touchstart → the overlay will JUMP
    // to reflect all movement that accumulated during the spinlock.
  }

  // ---- Touch: move ----
  function onTouchMove(e) {
    e.preventDefault();

    var t = e.touches[0];
    curX = t.clientX;
    curY = t.clientY;

    if (!ready) return;   // safety — shouldn't happen post-spinlock

    if (reanchor) {
      // Trailing edge: discard accumulated movement, start fresh here
      ancX = curX;
      ancY = curY;
      showAnchor(ancX, ancY);
      reanchor = false;
    }

    offX = curX - ancX;
    offY = curY - ancY;

    // Shrink proportionally to drag distance (1.0 → 0.9)
    var dist = Math.sqrt(offX * offX + offY * offY);
    var p    = Math.min(dist / MAX_DRAG, 1);
    sc       = 1 - (1 - MIN_SCALE) * p;

    applyTransform();
  }

  // ---- Touch: end / cancel ----
  function onTouchEnd(e) {
    e.preventDefault();
    if (phase === 'idle' || phase === 'snapping') return;
    snapBack();
  }

  function onTouchCancel() {
    snapBack();
  }

  // ---- Mode toggle ----
  segButtons.forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      mode = btn.getAttribute('data-mode');
      segButtons.forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
    });
    // Prevent touch on the toggle from starting / interfering with the gesture
    btn.addEventListener('touchstart', function (e) {
      e.stopPropagation();
    }, { passive: true });
    btn.addEventListener('touchmove', function (e) {
      e.stopPropagation();
    }, { passive: true });
  });

  // ---- Register touch listeners on document (passive:false for preventDefault) ----
  document.addEventListener('touchstart',  onTouchStart,  { passive: false });
  document.addEventListener('touchmove',   onTouchMove,   { passive: false });
  document.addEventListener('touchend',    onTouchEnd,    { passive: false });
  document.addEventListener('touchcancel', onTouchCancel, { passive: false });

  // Prevent the iOS long-press context menu
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

})();

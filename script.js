(function () {
  'use strict';

  var viewer     = document.getElementById('viewer');
  var segButtons = document.querySelectorAll('.seg-btn');
  var dotStart   = document.getElementById('dot-start');
  var dotReady   = document.getElementById('dot-ready');
  var statusEl   = document.getElementById('status');

  // ---- Config ----
  var PREPARE_DELAY = 150;   // ms — main-thread spinlock duration
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

  // Dots are children of the viewer (position: absolute), so they use
  // the viewer's local coordinate system which matches viewport coords
  // before the transform is applied. Once the transform is applied, the
  // dots drift along with the overlay — pinned to a visual spot on it.
  function showDot(el, x, y) {
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.classList.add('visible');
  }

  function hideDots() {
    dotStart.classList.remove('visible');
    dotReady.classList.remove('visible');
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
    hideDots();
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
    dotReady.classList.remove('visible');

    // Show the touch-start dot (orange) at the initial touch position.
    // Dot is a child of the viewer, so it drifts when the viewer transforms.
    showDot(dotStart, startX, startY);

    // Show "Preparing" and force a reflow so it paints *before* the spinlock
    setStatus('Preparing (150ms spinlock)\u2026', true);
    void statusEl.offsetHeight;   // force layout / paint

    // ===== 150 ms main-thread spinlock =====
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
      // Trailing edge: discard accumulated movement, start fresh here.
      // Show the ready dot (cyan) at the re-anchor position.
      ancX = curX;
      ancY = curY;
      showDot(dotReady, ancX, ancY);
      reanchor = false;
    } else if (!dotReady.classList.contains('visible')) {
      // Leading edge: the ready dot shows where the finger is now
      // (the moment the gesture became ready — first touchmove after spinlock).
      // The anchor stays at touchstart, but we mark this point visually.
      showDot(dotReady, curX, curY);
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
  // FIX: Must stop propagation on touchend too, otherwise the
  // document-level touchend handler calls preventDefault() which
  // prevents the browser from synthesizing a click event.
  segButtons.forEach(function (btn) {
    function setMode(e) {
      e.stopPropagation();
      e.preventDefault();
      mode = btn.getAttribute('data-mode');
      segButtons.forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
    }

    // Use touchend (not click) for immediate response on mobile,
    // AND stop it from reaching the document handler.
    btn.addEventListener('touchend', setMode, { passive: false });
    btn.addEventListener('touchstart', function (e) {
      e.stopPropagation();
      e.preventDefault();
    }, { passive: false });
    btn.addEventListener('touchmove', function (e) {
      e.stopPropagation();
      e.preventDefault();
    }, { passive: false });
    // Fallback for desktop testing
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      mode = btn.getAttribute('data-mode');
      segButtons.forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
    });
  });

  // ---- Register touch listeners on document (passive:false for preventDefault) ----
  document.addEventListener('touchstart',  onTouchStart,  { passive: false });
  document.addEventListener('touchmove',   onTouchMove,   { passive: false });
  document.addEventListener('touchend',    onTouchEnd,    { passive: false });
  document.addEventListener('touchcancel', onTouchCancel, { passive: false });

  // Prevent the iOS long-press context menu
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

})();
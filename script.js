(function () {
  'use strict';

  var viewer     = document.getElementById('viewer');
  var segButtons = document.querySelectorAll('.seg-btn');
  var dotStart   = document.getElementById('dot-start');
  var dotReady   = document.getElementById('dot-ready');
  var dotAnchor  = document.getElementById('dot-anchor');
  var statusEl   = document.getElementById('status');
  var dotsToggle = document.getElementById('dots-toggle');

  var dotsVisible = true;   // toggle state for anchor dots + legend

  // ---- Config ----
  var PREPARE_DELAY = 100;   // ms — main-thread spinlock duration
  var MIN_SCALE     = 0.9;   // scale at max drag distance
  var MAX_DRAG      = 300;   // px — drag distance at which scale bottoms out

  // ---- State ----
  var mode  = 'leading';     // 'leading' | 'balanced' | 'trailing'
  var phase = 'idle';        // 'idle' | 'preparing' | 'tracking' | 'snapping'

  var startX = 0, startY = 0;   // raw touchstart coords
  var ancX   = 0, ancY   = 0;   // anchor (offset reference) — changes per mode
  var curX   = 0, curY   = 0;   // latest finger position
  var offX   = 0, offY   = 0;   // applied translate
  var sc     = 1;                // applied scale

  var ready    = false;          // true once the spinlock is over
  var reanchor = false;          // true if anchor needs updating on first touchmove
  var readyDotShown = false;     // has the ready dot been placed for this gesture?

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
    if (!dotsVisible) return;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.classList.add('visible');
  }

  function hideDots() {
    dotStart.classList.remove('visible');
    dotReady.classList.remove('visible');
    dotAnchor.classList.remove('visible');
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
    readyDotShown = false;
    phase    = 'preparing';

    viewer.classList.remove('snapping');
    dotReady.classList.remove('visible');
    dotAnchor.classList.remove('visible');

    // Show the touch-start dot (orange) at the initial touch position.
    showDot(dotStart, startX, startY);

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

    if (mode === 'trailing' || mode === 'balanced') {
      // Both trailing and balanced re-anchor on the first touchmove
      // after the spinlock — trailing to the finger, balanced to the
      // midpoint between touchstart and the finger.
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
      // Show the ready dot (cyan) at the finger's current position.
      showDot(dotReady, curX, curY);
      readyDotShown = true;

      if (mode === 'trailing') {
        // Trailing edge: anchor = current finger position → no jump.
        ancX = curX;
        ancY = curY;
      } else {
        // Balanced: anchor = midpoint between touchstart and finger
        // → overlay jumps by half the accumulated distance.
        ancX = (startX + curX) / 2;
        ancY = (startY + curY) / 2;
        // Show the green anchor dot at the midpoint.
        showDot(dotAnchor, ancX, ancY);
      }
      reanchor = false;
    } else if (!readyDotShown) {
      // Leading edge: the ready dot shows where the finger is now
      // (first touchmove after spinlock). Anchor stays at touchstart.
      showDot(dotReady, curX, curY);
      readyDotShown = true;
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

  // ---- Dots toggle ----
  // Same touch event handling as mode buttons: stop propagation on all
  // touch events so the document handler doesn't interfere.
  function toggleDots(e) {
    if (e) { e.stopPropagation(); e.preventDefault(); }
    dotsVisible = !dotsVisible;
    dotsToggle.classList.toggle('active', dotsVisible);
    document.body.classList.toggle('dots-hidden', !dotsVisible);
    if (!dotsVisible) {
      dotStart.classList.remove('visible');
      dotReady.classList.remove('visible');
      dotAnchor.classList.remove('visible');
    }
  }
  dotsToggle.addEventListener('touchend', toggleDots, { passive: false });
  dotsToggle.addEventListener('touchstart', function (e) {
    e.stopPropagation(); e.preventDefault();
  }, { passive: false });
  dotsToggle.addEventListener('touchmove', function (e) {
    e.stopPropagation(); e.preventDefault();
  }, { passive: false });
  dotsToggle.addEventListener('click', function (e) {
    e.stopPropagation();
    dotsVisible = !dotsVisible;
    dotsToggle.classList.toggle('active', dotsVisible);
    document.body.classList.toggle('dots-hidden', !dotsVisible);
    if (!dotsVisible) {
      dotStart.classList.remove('visible');
      dotReady.classList.remove('visible');
      dotAnchor.classList.remove('visible');
    }
  });

  // ---- Register touch listeners on document (passive:false for preventDefault) ----
  document.addEventListener('touchstart',  onTouchStart,  { passive: false });
  document.addEventListener('touchmove',   onTouchMove,   { passive: false });
  document.addEventListener('touchend',    onTouchEnd,    { passive: false });
  document.addEventListener('touchcancel', onTouchCancel, { passive: false });

  // Prevent the iOS long-press context menu
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

})();
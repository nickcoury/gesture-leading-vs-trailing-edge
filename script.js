(function () {
  'use strict';

  var viewer     = document.getElementById('viewer');
  var segButtons = document.querySelectorAll('.seg-btn');
  var dotStart   = document.getElementById('dot-start');
  var dotReady   = document.getElementById('dot-ready');
  var dotAnchor  = document.getElementById('dot-anchor');
  var statusEl   = document.getElementById('status');
  var dotsToggle = document.getElementById('dots-toggle');

  // Dots off by default — focus on the feel, not the debug visuals
  document.body.classList.add('dots-hidden');
  var dotsVisible = false;

  // ---- Config ----
  var PREPARE_DELAY = 150;   // ms — main-thread spinlock duration
  var MIN_SCALE     = 0.9;   // scale at max drag distance
  var MAX_DRAG      = 300;   // px — drag distance at which scale bottoms out

  // Catching-up mode: CSS transition duration for overlay catch-up.
  // Starts at this value and decays to 0 over CATCHUP_FRAMES touchmove frames,
  // so the overlay smoothly transitions from "lagging behind" to "1:1 tracking".
  var CATCHUP_START_MS = 120;
  var CATCHUP_FRAMES   = 4;

  // ---- State ----
  var mode  = 'leading';     // 'leading' | 'balanced' | 'trailing' | 'catching-up'
  var phase = 'idle';        // 'idle' | 'preparing' | 'tracking' | 'snapping'

  var startX = 0, startY = 0;
  var ancX   = 0, ancY   = 0;
  var curX   = 0, curY   = 0;
  var offX   = 0, offY   = 0;
  var sc     = 1;

  var ready    = false;
  var reanchor = false;
  var readyDotShown = false;

  // Catching-up state
  var catchupFrame   = 0;    // counts touchmove frames since gesture ready
  var catchupDur     = 0;    // current transition duration (ms), decays to 0

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

  function applyTransformWithTransition(durationMs) {
    if (durationMs > 0) {
      viewer.style.transition = 'transform ' + durationMs + 'ms linear';
    } else {
      viewer.style.transition = 'none';
    }
    viewer.style.transform =
      'translate(' + offX + 'px,' + offY + 'px) scale(' + sc + ')';
  }

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
    viewer.style.transition = 'none';   // clear any catch-up transition
    viewer.classList.add('snapping');   // snapping class applies its own transition
    offX = 0; offY = 0; sc = 1;
    applyTransform();
    hideDots();
    setStatus('Snapping back', false);
    setTimeout(function () {
      viewer.classList.remove('snapping');
      viewer.style.transition = 'none';
      phase = 'idle';
      setStatus('Idle', false);
    }, 350);
  }

  // ---- Touch: start ----
  function onTouchStart(e) {
    if (e.target.closest('#controls')) return;
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
    catchupFrame  = 0;
    catchupDur    = 0;
    phase    = 'preparing';

    viewer.classList.remove('snapping');
    viewer.style.transition = 'none';
    dotReady.classList.remove('visible');
    dotAnchor.classList.remove('visible');

    showDot(dotStart, startX, startY);

    setStatus('Preparing (150ms spinlock)\u2026', true);
    void statusEl.offsetHeight;

    spinlock(PREPARE_DELAY);

    // Gesture is now ready
    ready  = true;
    phase  = 'tracking';
    setStatus('Tracking', true);

    if (mode === 'trailing' || mode === 'balanced') {
      reanchor = true;
    }
    if (mode === 'catching-up') {
      // First touchmove will start with the initial catch-up transition
      catchupDur = CATCHUP_START_MS;
    }
    // Leading edge: anchor stays at touchstart → the overlay will JUMP
  }

  // ---- Touch: move ----
  function onTouchMove(e) {
    e.preventDefault();

    var t = e.touches[0];
    curX = t.clientX;
    curY = t.clientY;

    if (!ready) return;

    if (reanchor) {
      showDot(dotReady, curX, curY);
      readyDotShown = true;

      if (mode === 'trailing') {
        ancX = curX;
        ancY = curY;
      } else {
        // balanced
        ancX = (startX + curX) / 2;
        ancY = (startY + curY) / 2;
        showDot(dotAnchor, ancX, ancY);
      }
      reanchor = false;
    } else if (mode === 'catching-up' && catchupFrame === 0) {
      // First touchmove in catching-up mode: the overlay is still at
      // (0,0) from the spinlock. Apply the full target with a transition
      // so it smoothly catches up. Anchor stays at touchstart (like leading).
      showDot(dotReady, curX, curY);
      readyDotShown = true;
      // Anchor = touchstart, same as leading — the offset is the full delta
      // but instead of jumping, we transition to it.
    } else if (!readyDotShown) {
      // Leading edge
      showDot(dotReady, curX, curY);
      readyDotShown = true;
    }

    if (mode === 'catching-up') {
      // Anchor at touchstart (same as leading) so offX/offY = full delta.
      // But instead of jumping, apply via CSS transition that decays.
      offX = curX - startX;
      offY = curY - startY;

      var dist = Math.sqrt(offX * offX + offY * offY);
      var p    = Math.min(dist / MAX_DRAG, 1);
      sc       = 1 - (1 - MIN_SCALE) * p;

      // Apply with current catch-up transition duration
      applyTransformWithTransition(catchupDur);

      // Decay the transition duration toward 0 over CATCHUP_FRAMES frames.
      // Frame 0: CATCHUP_START_MS (120ms)
      // Frame 1: 90ms (75%)
      // Frame 2: 60ms (50%)
      // Frame 3: 30ms (25%)
      // Frame 4+: 0ms (1:1 tracking)
      catchupFrame++;
      if (catchupFrame >= CATCHUP_FRAMES) {
        catchupDur = 0;
      } else {
        catchupDur = CATCHUP_START_MS * (1 - catchupFrame / CATCHUP_FRAMES);
      }
    } else {
      // Leading / balanced / trailing — standard 1:1 tracking, no transition
      offX = curX - ancX;
      offY = curY - ancY;

      var dist2 = Math.sqrt(offX * offX + offY * offY);
      var p2    = Math.min(dist2 / MAX_DRAG, 1);
      sc        = 1 - (1 - MIN_SCALE) * p2;

      applyTransform();
    }
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
    function setMode(e) {
      e.stopPropagation();
      e.preventDefault();
      mode = btn.getAttribute('data-mode');
      segButtons.forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
    }

    btn.addEventListener('touchend', setMode, { passive: false });
    btn.addEventListener('touchstart', function (e) {
      e.stopPropagation();
      e.preventDefault();
    }, { passive: false });
    btn.addEventListener('touchmove', function (e) {
      e.stopPropagation();
      e.preventDefault();
    }, { passive: false });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      mode = btn.getAttribute('data-mode');
      segButtons.forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
    });
  });

  // ---- Dots toggle ----
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
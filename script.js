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

  // Catching-up mode: time-based transition schedule (refresh-rate independent).
  // The easing cubic-bezier(0.25, 1, 0.25, 1) has fast initial acceleration
  // (closes most of the gap in the first ~30% of the duration) then eases out.
  var CATCHUP_EASING = 'cubic-bezier(0.25, 1, 0.25, 1)';
  // Schedule: [elapsed_ms_threshold, transition_duration_ms]
  // 0–100ms  → 100ms transition (smooth catch-up, fast-start easing)
  // 100–150ms → 50ms transition (tighter)
  // 150–200ms → 25ms transition (nearly 1:1)
  // 200ms+    → 0ms (direct tracking, transition removed)
  var CATCHUP_SCHEDULE = [
    [0,   100],
    [100,  50],
    [150,  25],
  ];
  var CATCHUP_END_MS = 200;  // after this, transition removed entirely

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
  var catchupStartTime = 0;  // performance.now() when gesture became ready
  var catchupDur       = 0;  // current transition duration (ms)
  var catchupFirstFrame = false;  // true on first touchmove — forces reflow

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

  // On the first catch-up frame, the overlay is at (0,0) from the spinlock.
  // We need to:
  //   1. Set the transition property
  //   2. Force a reflow so the browser commits the current (0,0) transform
  //      as the "from" state of the transition
  //   3. Then set the new target transform
  // Without step 2, the browser batches the transition + transform change
  // into one atomic style update and the transition is silently skipped —
  // the overlay just jumps (looks identical to leading edge).
  function applyTransformWithTransition(durationMs) {
    if (durationMs > 0) {
      viewer.style.transition = 'transform ' + durationMs + 'ms ' + CATCHUP_EASING;
      if (catchupFirstFrame) {
        // Force the browser to commit the current transform as the
        // starting point before we change the target.
        void viewer.offsetWidth;  // forces layout/reflow
        catchupFirstFrame = false;
      }
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
    viewer.style.transition = 'none';
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

  // Get the transition duration for the current elapsed time in catch-up mode
  function catchupDurationFor(elapsedMs) {
    if (elapsedMs >= CATCHUP_END_MS) return 0;
    for (var i = CATCHUP_SCHEDULE.length - 1; i >= 0; i--) {
      if (elapsedMs >= CATCHUP_SCHEDULE[i][0]) {
        return CATCHUP_SCHEDULE[i][1];
      }
    }
    return CATCHUP_SCHEDULE[0][1];
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
    catchupStartTime = 0;
    catchupDur       = 0;
    catchupFirstFrame = false;
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
      catchupStartTime = performance.now();
      catchupDur = CATCHUP_SCHEDULE[0][1];  // start at 100ms
      catchupFirstFrame = true;  // first touchmove must force reflow
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
    } else if (mode === 'catching-up' && !readyDotShown) {
      showDot(dotReady, curX, curY);
      readyDotShown = true;
    } else if (!readyDotShown) {
      // Leading edge
      showDot(dotReady, curX, curY);
      readyDotShown = true;
    }

    if (mode === 'catching-up') {
      // Anchor at touchstart (same as leading) so offX/offY = full delta.
      // But instead of jumping, apply via CSS transition that decays
      // on a time-based schedule.
      offX = curX - startX;
      offY = curY - startY;

      var dist = Math.sqrt(offX * offX + offY * offY);
      var p    = Math.min(dist / MAX_DRAG, 1);
      sc       = 1 - (1 - MIN_SCALE) * p;

      // Compute elapsed time since gesture became ready
      var elapsed = performance.now() - catchupStartTime;
      catchupDur = catchupDurationFor(elapsed);

      applyTransformWithTransition(catchupDur);
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
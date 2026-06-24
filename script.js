1|(function () {
2|  'use strict';
3|
4|  var viewer     = document.getElementById('viewer');
5|  var segButtons = document.querySelectorAll('.seg-btn');
6|  var dotStart   = document.getElementById('dot-start');
7|  var dotReady   = document.getElementById('dot-ready');
8|  var dotAnchor  = document.getElementById('dot-anchor');
9|  var statusEl   = document.getElementById('status');
10|  var dotsToggle = document.getElementById('dots-toggle');
11|
12|  // Dots off by default — focus on the feel, not the debug visuals
13|  document.body.classList.add('dots-hidden');
14|  var dotsVisible = false;
15|
16|  // ---- Config ----
17|  var PREPARE_DELAY = 150;   // ms — main-thread spinlock duration
18|  var MIN_SCALE     = 0.9;   // scale at max drag distance
19|  var MAX_DRAG      = 300;   // px — drag distance at which scale bottoms out
20|
21|  // Catching-up mode: time-based transition schedule (refresh-rate independent).
22|  // The easing cubic-bezier(0.25, 1, 0.25, 1) has fast initial acceleration
23|  // (closes most of the gap in the first ~30% of the duration) then eases out.
24|  var CATCHUP_EASING = 'cubic-bezier(0.25, 1, 0.25, 1)';
25|  // Schedule: [elapsed_ms_threshold, transition_duration_ms]
26|  // 0–100ms  → 100ms transition (smooth catch-up, fast-start easing)
27|  // 100–150ms → 50ms transition (tighter)
28|  // 150–200ms → 25ms transition (nearly 1:1)
29|  // 200ms+    → 0ms (direct tracking, transition removed)
30|  var CATCHUP_SCHEDULE = [
31|    [0,   100],
32|    [100,  50],
33|    [150,  25],
34|  ];
35|  var CATCHUP_END_MS = 200;  // after this, transition removed entirely
36|
37|  // ---- State ----
38|  var mode  = 'leading';     // 'leading' | 'balanced' | 'trailing' | 'catching-up'
39|  var phase = 'idle';        // 'idle' | 'preparing' | 'tracking' | 'snapping'
40|
41|  var startX = 0, startY = 0;
42|  var ancX   = 0, ancY   = 0;
43|  var curX   = 0, curY   = 0;
44|  var offX   = 0, offY   = 0;
45|  var sc     = 1;
46|
47|  var ready    = false;
48|  var reanchor = false;
49|  var readyDotShown = false;
50|
51|  // Catching-up state
52|  var catchupStartTime = 0;  // performance.now() when gesture became ready
53|  var catchupDur       = 0;  // current transition duration (ms)
54|
55|  // ---- Spinlock — blocks the main thread to simulate real work ----
56|  function spinlock(ms) {
57|    var t0 = performance.now();
58|    while (performance.now() - t0 < ms) { /* busy-wait */ }
59|  }
60|
61|  // ---- DOM helpers ----
62|  function applyTransform() {
63|    viewer.style.transform =
64|      'translate(' + offX + 'px,' + offY + 'px) scale(' + sc + ')';
65|  }
66|
67|  function applyTransformWithTransition(durationMs) {
68|    if (durationMs > 0) {
69|      viewer.style.transition = 'transform ' + durationMs + 'ms ' + CATCHUP_EASING;
70|    } else {
71|      viewer.style.transition = 'none';
72|    }
73|    // Force the transition to start from the current rendered position
74|    // before applying the new target. Without this, the browser may
75|    // batch the style change and skip the transition.
76|    viewer.style.transform =
77|      'translate(' + offX + 'px,' + offY + 'px) scale(' + sc + ')';
78|  }
79|
80|  function showDot(el, x, y) {
81|    if (!dotsVisible) return;
82|    el.style.left = x + 'px';
83|    el.style.top  = y + 'px';
84|    el.classList.add('visible');
85|  }
86|
87|  function hideDots() {
88|    dotStart.classList.remove('visible');
89|    dotReady.classList.remove('visible');
90|    dotAnchor.classList.remove('visible');
91|  }
92|
93|  function setStatus(text, active) {
94|    statusEl.textContent = text;
95|    statusEl.classList.toggle('active', !!active);
96|  }
97|
98|  function snapBack() {
99|    phase = 'snapping';
100|    viewer.style.transition = 'none';
101|    viewer.classList.add('snapping');   // snapping class applies its own transition
102|    offX = 0; offY = 0; sc = 1;
103|    applyTransform();
104|    hideDots();
105|    setStatus('Snapping back', false);
106|    setTimeout(function () {
107|      viewer.classList.remove('snapping');
108|      viewer.style.transition = 'none';
109|      phase = 'idle';
110|      setStatus('Idle', false);
111|    }, 350);
112|  }
113|
114|  // Get the transition duration for the current elapsed time in catch-up mode
115|  function catchupDurationFor(elapsedMs) {
116|    if (elapsedMs >= CATCHUP_END_MS) return 0;
117|    for (var i = CATCHUP_SCHEDULE.length - 1; i >= 0; i--) {
118|      if (elapsedMs >= CATCHUP_SCHEDULE[i][0]) {
119|        return CATCHUP_SCHEDULE[i][1];
120|      }
121|    }
122|    return CATCHUP_SCHEDULE[0][1];
123|  }
124|
125|  // ---- Touch: start ----
126|  function onTouchStart(e) {
127|    if (e.target.closest('#controls')) return;
128|    if (phase === 'preparing' || phase === 'tracking') return;
129|
130|    e.preventDefault();
131|
132|    var t = e.touches[0];
133|    startX = t.clientX;
134|    startY = t.clientY;
135|    ancX   = startX;
136|    ancY   = startY;
137|    curX   = startX;
138|    curY   = startY;
139|    offX   = 0; offY = 0; sc = 1;
140|    ready    = false;
141|    reanchor = false;
142|    readyDotShown = false;
143|    catchupStartTime = 0;
144|    catchupDur       = 0;
145|    phase    = 'preparing';
146|
147|    viewer.classList.remove('snapping');
148|    viewer.style.transition = 'none';
149|    dotReady.classList.remove('visible');
150|    dotAnchor.classList.remove('visible');
151|
152|    showDot(dotStart, startX, startY);
153|
154|    setStatus('Preparing (150ms spinlock)\u2026', true);
155|    void statusEl.offsetHeight;
156|
157|    spinlock(PREPARE_DELAY);
158|
159|    // Gesture is now ready
160|    ready  = true;
161|    phase  = 'tracking';
162|    setStatus('Tracking', true);
163|
164|    if (mode === 'trailing' || mode === 'balanced') {
165|      reanchor = true;
166|    }
167|    if (mode === 'catching-up') {
168|      catchupStartTime = performance.now();
169|      catchupDur = CATCHUP_SCHEDULE[0][1];  // start at 100ms
170|    }
171|    // Leading edge: anchor stays at touchstart → the overlay will JUMP
172|  }
173|
174|  // ---- Touch: move ----
175|  function onTouchMove(e) {
176|    e.preventDefault();
177|
178|    var t = e.touches[0];
179|    curX = t.clientX;
180|    curY = t.clientY;
181|
182|    if (!ready) return;
183|
184|    if (reanchor) {
185|      showDot(dotReady, curX, curY);
186|      readyDotShown = true;
187|
188|      if (mode === 'trailing') {
189|        ancX = curX;
190|        ancY = curY;
191|      } else {
192|        // balanced
193|        ancX = (startX + curX) / 2;
194|        ancY = (startY + curY) / 2;
195|        showDot(dotAnchor, ancX, ancY);
196|      }
197|      reanchor = false;
198|    } else if (mode === 'catching-up' && !readyDotShown) {
199|      showDot(dotReady, curX, curY);
200|      readyDotShown = true;
201|    } else if (!readyDotShown) {
202|      // Leading edge
203|      showDot(dotReady, curX, curY);
204|      readyDotShown = true;
205|    }
206|
207|    if (mode === 'catching-up') {
208|      // Anchor at touchstart (same as leading) so offX/offY = full delta.
209|      // But instead of jumping, apply via CSS transition that decays
210|      // on a time-based schedule.
211|      offX = curX - startX;
212|      offY = curY - startY;
213|
214|      var dist = Math.sqrt(offX * offX + offY * offY);
215|      var p    = Math.min(dist / MAX_DRAG, 1);
216|      sc       = 1 - (1 - MIN_SCALE) * p;
217|
218|      // Compute elapsed time since gesture became ready
219|      var elapsed = performance.now() - catchupStartTime;
220|      catchupDur = catchupDurationFor(elapsed);
221|
222|      applyTransformWithTransition(catchupDur);
223|    } else {
224|      // Leading / balanced / trailing — standard 1:1 tracking, no transition
225|      offX = curX - ancX;
226|      offY = curY - ancY;
227|
228|      var dist2 = Math.sqrt(offX * offX + offY * offY);
229|      var p2    = Math.min(dist2 / MAX_DRAG, 1);
230|      sc        = 1 - (1 - MIN_SCALE) * p2;
231|
232|      applyTransform();
233|    }
234|  }
235|
236|  // ---- Touch: end / cancel ----
237|  function onTouchEnd(e) {
238|    e.preventDefault();
239|    if (phase === 'idle' || phase === 'snapping') return;
240|    snapBack();
241|  }
242|
243|  function onTouchCancel() {
244|    snapBack();
245|  }
246|
247|  // ---- Mode toggle ----
248|  segButtons.forEach(function (btn) {
249|    function setMode(e) {
250|      e.stopPropagation();
251|      e.preventDefault();
252|      mode = btn.getAttribute('data-mode');
253|      segButtons.forEach(function (b) {
254|        b.classList.toggle('active', b === btn);
255|      });
256|    }
257|
258|    btn.addEventListener('touchend', setMode, { passive: false });
259|    btn.addEventListener('touchstart', function (e) {
260|      e.stopPropagation();
261|      e.preventDefault();
262|    }, { passive: false });
263|    btn.addEventListener('touchmove', function (e) {
264|      e.stopPropagation();
265|      e.preventDefault();
266|    }, { passive: false });
267|    btn.addEventListener('click', function (e) {
268|      e.stopPropagation();
269|      mode = btn.getAttribute('data-mode');
270|      segButtons.forEach(function (b) {
271|        b.classList.toggle('active', b === btn);
272|      });
273|    });
274|  });
275|
276|  // ---- Dots toggle ----
277|  function toggleDots(e) {
278|    if (e) { e.stopPropagation(); e.preventDefault(); }
279|    dotsVisible = !dotsVisible;
280|    dotsToggle.classList.toggle('active', dotsVisible);
281|    document.body.classList.toggle('dots-hidden', !dotsVisible);
282|    if (!dotsVisible) {
283|      dotStart.classList.remove('visible');
284|      dotReady.classList.remove('visible');
285|      dotAnchor.classList.remove('visible');
286|    }
287|  }
288|  dotsToggle.addEventListener('touchend', toggleDots, { passive: false });
289|  dotsToggle.addEventListener('touchstart', function (e) {
290|    e.stopPropagation(); e.preventDefault();
291|  }, { passive: false });
292|  dotsToggle.addEventListener('touchmove', function (e) {
293|    e.stopPropagation(); e.preventDefault();
294|  }, { passive: false });
295|  dotsToggle.addEventListener('click', function (e) {
296|    e.stopPropagation();
297|    dotsVisible = !dotsVisible;
298|    dotsToggle.classList.toggle('active', dotsVisible);
299|    document.body.classList.toggle('dots-hidden', !dotsVisible);
300|    if (!dotsVisible) {
301|      dotStart.classList.remove('visible');
302|      dotReady.classList.remove('visible');
303|      dotAnchor.classList.remove('visible');
304|    }
305|  });
306|
307|  // ---- Register touch listeners on document (passive:false for preventDefault) ----
308|  document.addEventListener('touchstart',  onTouchStart,  { passive: false });
309|  document.addEventListener('touchmove',   onTouchMove,   { passive: false });
310|  document.addEventListener('touchend',    onTouchEnd,    { passive: false });
311|  document.addEventListener('touchcancel', onTouchCancel, { passive: false });
312|
313|  // Prevent the iOS long-press context menu
314|  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
315|
316|})();
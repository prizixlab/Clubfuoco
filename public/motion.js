/* ============================================================
   Club Fuoco — motion engine
   Scroll-LINKED entrance motion (eases continuously with scroll,
   Apple-style) + hero load sequence + ambient drift + headline
   clip-reveal. Pure CSS/JS, no dependencies.

   Reduced-motion contract: if the user prefers reduced motion we
   return immediately and NEVER add html.motion — so every animated
   base state (scoped to html.motion inside a
   prefers-reduced-motion:no-preference query) never applies and the
   page renders in its final, visible state. Same for no-JS.
   ============================================================ */
(function () {
  "use strict";

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  var root = document.documentElement;
  root.classList.add("motion");

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

  /* ---------- headline word/line splitter ---------- */
  function wrapWords(node) {
    var out = [], kids = Array.prototype.slice.call(node.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var child = kids[i];
      if (child.nodeType === 3) {
        var parts = child.textContent.split(/(\s+)/);
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j];
          if (p === "") continue;
          if (/^\s+$/.test(p)) { out.push(document.createTextNode(" ")); continue; }
          var outer = document.createElement("span"); outer.className = "w-outer";
          var inner = document.createElement("span"); inner.className = "w-inner";
          inner.textContent = p; outer.appendChild(inner); out.push(outer);
        }
      } else if (child.nodeType === 1) {
        var innerKids = wrapWords(child);
        child.innerHTML = "";
        for (var k = 0; k < innerKids.length; k++) child.appendChild(innerKids[k]);
        out.push(child);
      }
    }
    return out;
  }
  function splitTitle(h) {
    if (h.getAttribute("data-split")) return;
    h.setAttribute("data-split", "1");
    var kids = wrapWords(h);
    h.innerHTML = "";
    for (var i = 0; i < kids.length; i++) h.appendChild(kids[i]);
    h.classList.add("split");
  }
  function assignLines(h) {
    var outers = h.querySelectorAll(".w-outer"), lineTop = null, line = -1;
    for (var i = 0; i < outers.length; i++) {
      var t = outers[i].offsetTop;
      if (lineTop === null || Math.abs(t - lineTop) > 4) { line++; lineTop = t; }
      var inner = outers[i].querySelector(".w-inner");
      if (inner) inner.style.setProperty("--d", (line * 80) + "ms");
    }
  }

  ready(function () {
    var supportsIO = "IntersectionObserver" in window;

    /* ============================================================
       1. SCROLL-LINKED REVEALS — the core "free / Apple" feel.
          Each block eases in as a function of its viewport position
          (not a single trigger), with a soft quint ease-out, then
          latches once fully revealed so it never reverses.
       ============================================================ */
    var revealSel = [
      ".step", ".belief", ".venue-row", ".prow", ".perk", ".num-col",
      ".release", ".metric", ".aud-card", ".route-card", ".positioning",
      ".closing", ".integrate .names", ".integrate p", ".founder-attr",
      ".pq .attr", ".press-note", ".press-cta", ".contact-strip", ".prose",
      ".opp-actions", ".portrait", ".form-card", ".venues",
      ".section-head .eyebrow", ".how-head .eyebrow", ".perks-head .eyebrow",
      ".partner .eyebrow", ".partner .sub", ".dir-head", ".routes-head"
    ].join(",");

    var nodes = Array.prototype.slice.call(document.querySelectorAll(revealSel));
    var blocks = [];
    nodes.forEach(function (el) {
      el.classList.add("reveal");
      var i = 0, prev = el.previousElementSibling;
      while (prev) { if (prev.classList && prev.classList.contains("reveal")) i++; prev = prev.previousElementSibling; }
      blocks.push({ el: el, offset: Math.min(i, 6) * 20, done: false });
    });

    var TRAVEL = 48;
    function updateReveals() {
      var vh = window.innerHeight || document.documentElement.clientHeight;
      for (var b = 0; b < blocks.length; b++) {
        var bl = blocks[b];
        if (bl.done) continue;
        var r = bl.el.getBoundingClientRect();
        if (r.height === 0 && r.top === 0) continue;
        var start = vh * 1.02 - bl.offset;
        var end = vh * 0.52 - bl.offset;
        var t = clamp((start - r.top) / (start - end), 0, 1);
        var e = easeOutCubic(t);
        var o = easeOutCubic(clamp(t * 1.35, 0, 1));
        if (t >= 1) {
          bl.el.style.opacity = "";
          bl.el.style.transform = "";
          bl.el.style.filter = "";
          bl.el.style.willChange = "";
          bl.el.classList.add("shown");
          bl.done = true;
        } else {
          bl.el.style.willChange = "opacity, transform, filter";
          bl.el.style.opacity = o.toFixed(3);
          bl.el.style.transform = "translateY(" + ((1 - e) * TRAVEL).toFixed(1) + "px) scale(" + (0.99 + e * 0.01).toFixed(4) + ")";
          bl.el.style.filter = (1 - o) > 0.02 ? "blur(" + ((1 - o) * 5).toFixed(2) + "px)" : "";
        }
      }
    }

    /* light parallax on the iPhone showcase for layered depth */
    var showcases = Array.prototype.slice.call(document.querySelectorAll(".showcase"));
    function updateParallax() {
      var vh = window.innerHeight || document.documentElement.clientHeight;
      for (var s = 0; s < showcases.length; s++) {
        var el = showcases[s];
        var r = el.getBoundingClientRect();
        var center = r.top + r.height / 2;
        var d = (center - vh / 2) / vh;
        el.style.setProperty("--px", clamp(d * 22, -22, 22).toFixed(1) + "px");
      }
    }

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        try { updateReveals(); updateParallax(); } catch (e) {}
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    updateReveals(); updateParallax();
    setTimeout(function () { updateReveals(); updateParallax(); }, 250);
    window.addEventListener("load", function () { updateReveals(); updateParallax(); });

    /* safety net: anything still hidden after 6s gets shown */
    setTimeout(function () {
      blocks.forEach(function (bl) {
        if (!bl.done) {
          bl.el.style.opacity = ""; bl.el.style.transform = ""; bl.el.style.filter = ""; bl.el.style.willChange = "";
          bl.el.classList.add("shown"); bl.done = true;
        }
      });
    }, 6000);

    /* ============================================================
       2. TIMED ONE-SHOTS — headline clip-reveal + quote settle +
          iPhone scale-in. Triggered slightly before fully in view.
       ============================================================ */
    var titles = Array.prototype.slice.call(document.querySelectorAll("h2.serif-title"));
    titles.forEach(splitTitle);
    function relineAll() { titles.forEach(assignLines); }
    relineAll();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relineAll);
    else window.addEventListener("load", relineAll);

    var oneShots = titles
      .concat(Array.prototype.slice.call(document.querySelectorAll(".founder-quote, .mission-quote, .pq blockquote")))
      .concat(Array.prototype.slice.call(document.querySelectorAll(".iphone")));

    if (!supportsIO) {
      oneShots.forEach(function (el) { el.classList.add("in"); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
        });
      }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
      oneShots.forEach(function (el) { io.observe(el); });
      setTimeout(function () {
        oneShots.forEach(function (el) { if (!el.classList.contains("in")) el.classList.add("in"); });
      }, 6000);
    }

    /* ============================================================
       3. HERO LOAD SEQUENCE
       ============================================================ */
    function fireLoad() {
      var stats = document.querySelectorAll(".hero-stats .hstat");
      for (var i = 0; i < stats.length; i++) stats[i].style.transitionDelay = (700 + i * 150) + "ms";
      root.classList.add("loaded");
    }
    if (document.readyState === "complete") {
      // rAF lets the hidden base state paint once so the entrance transitions
      // rather than snapping. rAF is throttled in backgrounded tabs, so a
      // short timeout guarantees the hero still appears if rAF is delayed.
      requestAnimationFrame(fireLoad);
      setTimeout(function () { if (!root.classList.contains("loaded")) fireLoad(); }, 300);
    } else {
      window.addEventListener("load", fireLoad);
      setTimeout(function () { if (!root.classList.contains("loaded")) fireLoad(); }, 1200);
    }
  });
})();

/* ============================================================
   Club Fuoco — cursor glimmers
   Faint fragments of the app UI bloom and drift where the mouse
   moves across the hero, like embers catching candlelight.

   Disabled for touch / reduced-motion (CSS hides the layer and we
   bail here too). Hero-scoped, capped, and pooled so it stays a
   whisper — felt more than seen.
   ============================================================ */
(function () {
  "use strict";

  var mq = window.matchMedia;
  var reduce = mq && mq("(prefers-reduced-motion: reduce)").matches;
  var noHover = mq && mq("(hover: none)").matches;
  if (reduce || noHover) return;

  function start() {
    var hero = document.querySelector(".hero");
    var layer = document.querySelector(".glimmer-layer");
    if (!hero || !layer) return;

    var THUMBS = [
      "linear-gradient(135deg,#3a2a4a,#160f22)",
      "linear-gradient(135deg,#4a2a32,#1d1014)",
      "linear-gradient(135deg,#2a3a4a,#101824)",
      "linear-gradient(135deg,#4a3c2a,#211a0e)",
      "linear-gradient(135deg,#2a4a3a,#0f211a)"
    ];
    var VENUES = [
      ["Opium", "Free guestlist"],
      ["Pacha", "VIP table"],
      ["Jamboree", "Free guestlist"],
      ["Shôko", "Guestlist open"],
      ["CDLC", "VIP · 2 left"],
      ["Sutton", "Free guestlist"],
      ["Bling Bling", "VIP table"],
      ["Carpe Diem", "Guestlist open"]
    ];
    var LABELS = [
      "Free guestlist", "VIP table", "Free guestlist · VIP table",
      "Guestlist open", "Table · 2 left", "On the door"
    ];
    var PILLS = ["22:14", "Tonight", "23:40", "Apple Pay", "01:20"];

    function pick(a) { return a[(Math.random() * a.length) | 0]; }

    function makeFragment() {
      var roll = Math.random();
      var el = document.createElement("div");
      if (roll < 0.42) {
        var v = pick(VENUES);
        el.className = "glimmer g-row";
        var t = document.createElement("div");
        t.className = "gthumb";
        t.style.background = pick(THUMBS);
        var meta = document.createElement("div");
        var n = document.createElement("div");
        n.className = "gname";
        n.textContent = v[0];
        var l = document.createElement("div");
        l.className = "glabel";
        l.textContent = v[1];
        meta.appendChild(n);
        meta.appendChild(l);
        el.appendChild(t);
        el.appendChild(meta);
      } else if (roll < 0.74) {
        el.className = "glimmer g-label";
        el.textContent = pick(LABELS);
      } else if (roll < 0.93) {
        el.className = "glimmer g-pill";
        el.textContent = pick(PILLS);
      } else {
        el.className = "glimmer g-mark";
        el.textContent = "CLUB FUOCO";
      }
      return el;
    }

    var MAX = 16;
    var live = 0;
    var lastX = 0, lastY = 0, haveLast = false;
    var travel = 0;
    var SPAWN_EVERY = 78;

    function spawn(x, y) {
      if (live >= MAX) return;
      var rect = hero.getBoundingClientRect();
      var lx = x - rect.left;
      var ly = y - rect.top;
      lx += (Math.random() - 0.5) * 26;
      ly += (Math.random() - 0.5) * 22;

      var el = makeFragment();
      el.style.left = lx + "px";
      el.style.top = ly + "px";
      var rot = (Math.random() - 0.5) * 7;
      layer.appendChild(el);
      live++;

      var peak = 0.2 + Math.random() * 0.16;
      var rise = 26 + Math.random() * 26;
      var dur = 1100 + Math.random() * 700;

      var anim = el.animate(
        [
          { opacity: 0, filter: "blur(7px)", transform: "translate(-50%, -50%) scale(0.9) rotate(" + rot + "deg)" },
          { opacity: peak, filter: "blur(0.5px)", transform: "translate(-50%, calc(-50% - " + (rise * 0.42) + "px)) scale(1) rotate(" + rot + "deg)", offset: 0.32 },
          { opacity: peak * 0.85, filter: "blur(1px)", transform: "translate(-50%, calc(-50% - " + (rise * 0.7) + "px)) scale(1.01) rotate(" + rot + "deg)", offset: 0.62 },
          { opacity: 0, filter: "blur(6px)", transform: "translate(-50%, calc(-50% - " + rise + "px)) scale(1.02) rotate(" + rot + "deg)" }
        ],
        { duration: dur, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
      );
      anim.onfinish = function () { el.remove(); live--; };
      anim.oncancel = function () { el.remove(); live--; };
    }

    function onMove(e) {
      var x = e.clientX, y = e.clientY;
      if (!haveLast) { lastX = x; lastY = y; haveLast = true; return; }
      var dx = x - lastX, dy = y - lastY;
      travel += Math.sqrt(dx * dx + dy * dy);
      lastX = x; lastY = y;
      if (travel >= SPAWN_EVERY) {
        travel = 0;
        spawn(x, y);
      }
    }

    hero.addEventListener("mousemove", onMove, { passive: true });
    hero.addEventListener("mouseleave", function () { haveLast = false; travel = 0; });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();

/* Portalis birthday card
   - Colorful canvas animation (4 styles) that runs exactly as long as the chosen song in the song/ folder
   - Admin and officer pick the song + style, add ONE photo, and are the only ones who see "Download video"
   - Everyone else only gets the play button
   Needs: config.js (sb) and common.js (el) loaded first. */
(function () {
  "use strict";

  var SONG_DIR = "song/";
  var SONG_LIST_URL = SONG_DIR + "songs.json"; // written by the deploy workflow from the files in song/
  var DEFAULT_SONG = "maligayang-bati.mp3";
  var BUCKET = "birthday";
  var MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.js";
  var W = 1280;
  var H = 720;
  var FALLBACK_DURATION = 48.64; // used until the mp3 reports its real length
  var IDLE_T = 6.5; // frame shown before pressing play
  var TITLE = "Maligayang Bati!";
  var HEAD_FONT = '"Permanent Marker", "Comic Sans MS", cursive';
  var BODY_FONT = '"Patrick Hand", "Comic Sans MS", cursive';
  var PALETTE = ["#ff5d8f", "#ffd23f", "#3ec1ff", "#5ee06f", "#b57bff", "#ff9a3c", "#ff6b6b"];
  var TAU = Math.PI * 2;

  /* ---------- small helpers ---------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function easeOutBack(x) { var c1 = 1.70158, c3 = c1 + 1; x = clamp(x, 0, 1); return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function easeOutElastic(x) {
    x = clamp(x, 0, 1);
    if (x === 0 || x === 1) return x;
    return Math.pow(2, -9 * x) * Math.sin((x * 10 - 0.75) * (TAU / 3)) + 1;
  }
  function easeOutBounce(x) {
    x = clamp(x, 0, 1);
    var n1 = 7.5625, d1 = 2.75;
    if (x < 1 / d1) return n1 * x * x;
    if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
    if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
    return n1 * (x -= 2.625 / d1) * x + 0.984375;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  function slug(s) {
    return String(s || "birthday").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "birthday";
  }
  function manilaToday() {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    function p(t) { return parts.filter(function (i) { return i.type === t; })[0].value; }
    return p("year") + "-" + p("month") + "-" + p("day");
  }
  var dateLabelCache = null;
  function manilaDateLabel() {
    if (!dateLabelCache) dateLabelCache = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric" }).format(new Date());
    return dateLabelCache;
  }

  /* ---------- seeded (always identical) particles ---------- */
  var rnd = mulberry32(20261122);
  var confetti = [], balloons = [], bokeh = [], fireworks = [], cannonParts = [], sprinkles = [];
  var i;
  for (i = 0; i < 110; i++) confetti.push({ x: rnd() * W, period: 5 + rnd() * 5, phase: rnd() * 10, amp: 20 + rnd() * 60, k: 1 + rnd() * 2, w: 10 + rnd() * 10, h: 6 + rnd() * 8, spin: 2 + rnd() * 6, hue: Math.floor(rnd() * 360), flip: 2 + rnd() * 5 });
  for (i = 0; i < 12; i++) balloons.push({ x: 40 + (i / 11) * (W - 80) + (rnd() - 0.5) * 60, period: 11 + rnd() * 6, phase: rnd() * 14, size: 0.7 + rnd() * 0.6, color: PALETTE[i % PALETTE.length], sway: 20 + rnd() * 30 });
  for (i = 0; i < 22; i++) bokeh.push({ x: rnd() * W, y: rnd() * H, r: 20 + rnd() * 60, speed: 6 + rnd() * 18, hue: Math.floor(rnd() * 360) });
  for (i = 0; i < 22; i++) fireworks.push({ at: 2.5 + i * 3.7, x: 150 + rnd() * (W - 300), y: 130 + rnd() * 230, hue: Math.floor(rnd() * 360), n: 26 });
  for (i = 0; i < 40; i++) cannonParts.push({ ang: (-80 + rnd() * 40) * Math.PI / 180, speed: 650 + rnd() * 450, hue: Math.floor(rnd() * 360), w: 9 + rnd() * 8, h: 6 + rnd() * 7, spin: 3 + rnd() * 8 });
  for (i = 0; i < 46; i++) sprinkles.push({ x: rnd(), y: rnd(), rot: rnd() * Math.PI, c: PALETTE[i % PALETTE.length] });

  /* ---------- scene pieces ---------- */
  function drawBackground(g, t) {
    var h = (t * 16) % 360;
    var grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "hsl(" + h + ",90%,62%)");
    grad.addColorStop(0.5, "hsl(" + ((h + 70) % 360) + ",92%,58%)");
    grad.addColorStop(1, "hsl(" + ((h + 150) % 360) + ",90%,60%)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W * 0.28, H * 0.58);
    g.rotate(t * 0.12);
    var n = 18;
    g.fillStyle = "rgba(255,255,255,0.13)";
    for (var k = 0; k < n; k++) {
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 1400, (k / n) * TAU, (k / n + 0.5 / n) * TAU);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function drawBokeh(g, t) {
    g.save();
    for (var k = 0; k < bokeh.length; k++) {
      var b = bokeh[k];
      var y = H + 100 - ((b.y + t * b.speed) % (H + 200));
      g.globalAlpha = 0.16 + 0.08 * Math.sin(t * 1.5 + k);
      g.fillStyle = "hsl(" + ((b.hue + t * 20) % 360) + ",100%,85%)";
      g.beginPath();
      g.arc(b.x + Math.sin(t * 0.5 + k) * 20, y, b.r, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  function drawFireworks(g, t) {
    g.save();
    g.lineCap = "round";
    for (var k = 0; k < fireworks.length; k++) {
      var f = fireworks[k];
      var age = t - f.at;
      if (age < 0 || age > 1.8) continue;
      g.globalAlpha = clamp(1 - age / 1.8, 0, 1);
      g.lineWidth = 4;
      for (var j = 0; j < f.n; j++) {
        var a = (j / f.n) * TAU;
        var d1 = 170 * (1 - Math.exp(-Math.max(age - 0.09, 0) * 2.6));
        var d2 = 170 * (1 - Math.exp(-age * 2.6));
        var gy1 = 70 * Math.max(age - 0.09, 0) * Math.max(age - 0.09, 0);
        var gy2 = 70 * age * age;
        g.strokeStyle = "hsl(" + ((f.hue + j * 9) % 360) + ",100%," + (j % 2 ? 70 : 85) + "%)";
        g.beginPath();
        g.moveTo(f.x + Math.cos(a) * d1, f.y + Math.sin(a) * d1 + gy1);
        g.lineTo(f.x + Math.cos(a) * d2, f.y + Math.sin(a) * d2 + gy2);
        g.stroke();
      }
    }
    g.restore();
  }

  function drawBalloon(g, x, y, s, color, t) {
    g.save();
    g.translate(x, y);
    g.rotate(Math.sin(t * 1.3 + x) * 0.08);
    g.scale(s, s);
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 46);
    g.bezierCurveTo(10, 70, -10, 95, 0, 125);
    g.stroke();
    g.beginPath();
    g.ellipse(0, 0, 36, 44, 0, 0, TAU);
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 3.5;
    g.strokeStyle = "#000";
    g.stroke();
    g.beginPath();
    g.ellipse(-13, -18, 8, 14, -0.5, 0, TAU);
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fill();
    g.beginPath();
    g.moveTo(0, 44);
    g.lineTo(-7, 57);
    g.lineTo(7, 57);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.stroke();
    g.restore();
  }

  function drawBalloons(g, t) {
    for (var k = 0; k < balloons.length; k++) {
      var b = balloons[k];
      var u = ((t + b.phase) / b.period) % 1;
      var y = H + 140 - u * (H + 360);
      var x = b.x + Math.sin(u * TAU * 2) * b.sway;
      drawBalloon(g, x, y, b.size, b.color, t);
    }
  }

  function drawConfettiPiece(g, x, y, w, h, rot, flip, hue) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(1, Math.cos(flip));
    g.fillStyle = "hsl(" + hue + ",100%,60%)";
    g.fillRect(-w / 2, -h / 2, w, h);
    g.strokeStyle = "rgba(0,0,0,0.55)";
    g.lineWidth = 1;
    g.strokeRect(-w / 2, -h / 2, w, h);
    g.restore();
  }

  function drawConfetti(g, t, T) {
    for (var k = 0; k < confetti.length; k++) {
      var c = confetti[k];
      var u = ((t + c.phase) / c.period) % 1;
      drawConfettiPiece(g, c.x + Math.sin(u * TAU * c.k) * c.amp, -20 + u * (H + 40), c.w, c.h, u * TAU * c.spin, t * c.flip + k, (c.hue + t * 30) % 360);
    }
    // confetti cannons from both bottom corners at set moments of the song
    var shots = [0.4, T * 0.25, T * 0.5, T * 0.75, Math.max(T - 5, 1)];
    for (var s = 0; s < shots.length; s++) {
      var age = t - shots[s];
      if (age < 0 || age > 3.4) continue;
      g.save();
      g.globalAlpha = clamp((3.4 - age) / 0.8, 0, 1);
      for (var p = 0; p < cannonParts.length; p++) {
        var q = cannonParts[p];
        var side = p % 2 ? 1 : -1;
        var vx = Math.cos(q.ang) * q.speed * (side === -1 ? 1 : -1);
        var vy = Math.sin(q.ang) * q.speed;
        var ox = side === -1 ? 0 : W;
        drawConfettiPiece(g, ox + vx * age, H + vy * age + 0.5 * 900 * age * age, q.w, q.h, age * q.spin, age * 9 + p, (q.hue + s * 50) % 360);
      }
      g.restore();
    }
  }

  function drawSparkle(g, x, y, r, a, color) {
    g.save();
    g.translate(x, y);
    g.globalAlpha = clamp(a, 0, 1);
    g.fillStyle = color || "#fff";
    g.strokeStyle = "#000";
    g.lineWidth = 2;
    g.beginPath();
    for (var k = 0; k < 8; k++) {
      var rad = k % 2 ? r * 0.28 : r;
      var ang = (k / 8) * TAU - Math.PI / 2;
      g.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  function frosting(g, x, y, w) {
    var n = Math.max(2, Math.round(w / 28));
    var r = w / n / 2;
    g.lineWidth = 4;
    g.strokeStyle = "#000";
    g.fillStyle = "#fff";
    for (var k = 0; k < n; k++) {
      g.beginPath();
      g.arc(x + r + 2 * r * k, y + 14, r * 0.8, 0, TAU);
      g.fill();
      g.stroke();
    }
    rr(g, x - 6, y - 8, w + 12, 22, 10);
    g.fill();
    g.stroke();
  }

  function drawCake(g, cx, cy, t) {
    g.save();
    g.translate(cx, cy + Math.sin(t * 3) * 4);
    g.lineJoin = "round";
    g.lineWidth = 4;
    g.strokeStyle = "#000";
    g.fillStyle = "#fff";
    g.beginPath();
    g.ellipse(0, 148, 215, 26, 0, 0, TAU);
    g.fill();
    g.stroke();
    var tiers = [[-170, 50, 340, 92, "#ff6fa8"], [-125, -32, 250, 82, "#ffd23f"], [-80, -102, 160, 70, "#46c3ff"]];
    for (var k = 0; k < tiers.length; k++) {
      var T_ = tiers[k];
      rr(g, T_[0], T_[1], T_[2], T_[3], 10);
      g.fillStyle = T_[4];
      g.fill();
      g.stroke();
      g.save();
      rr(g, T_[0], T_[1], T_[2], T_[3], 10);
      g.clip();
      for (var s = 0; s < 14; s++) {
        var sp = sprinkles[(k * 14 + s) % sprinkles.length];
        g.save();
        g.translate(T_[0] + 14 + sp.x * (T_[2] - 28), T_[1] + 30 + sp.y * (T_[3] - 40));
        g.rotate(sp.rot);
        g.fillStyle = sp.c === T_[4] ? "#fff" : sp.c;
        g.fillRect(-6, -2, 12, 4);
        g.restore();
      }
      g.restore();
      frosting(g, T_[0], T_[1], T_[2]);
    }
    for (var c = 0; c < 5; c++) {
      var x = -56 + c * 28;
      g.fillStyle = PALETTE[(c + 2) % PALETTE.length];
      rr(g, x - 6, -148, 12, 44, 3);
      g.fill();
      g.stroke();
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.fillRect(x - 6, -136, 12, 5);
      g.fillRect(x - 6, -120, 12, 5);
      var sc = 1 + 0.16 * Math.sin(t * 14 + c * 2);
      var glow = g.createRadialGradient(x, -162, 2, x, -162, 34);
      glow.addColorStop(0, "rgba(255,230,120,0.65)");
      glow.addColorStop(1, "rgba(255,230,120,0)");
      g.fillStyle = glow;
      g.beginPath();
      g.arc(x, -162, 34, 0, TAU);
      g.fill();
      g.save();
      g.translate(x + Math.sin(t * 9 + c) * 1.5, -150);
      g.scale(sc, sc);
      g.beginPath();
      g.moveTo(0, -26);
      g.bezierCurveTo(10, -14, 10, -2, 0, 0);
      g.bezierCurveTo(-10, -2, -10, -14, 0, -26);
      var fg = g.createLinearGradient(0, -26, 0, 0);
      fg.addColorStop(0, "#fff7a8");
      fg.addColorStop(1, "#ff8a1f");
      g.fillStyle = fg;
      g.lineWidth = 3;
      g.fill();
      g.stroke();
      g.restore();
    }
    g.restore();
  }

  function drawPolaroid(g, st, cx, cy, t) {
    var w = 380, h = 450;
    g.save();
    g.translate(cx, cy);
    g.rotate(-0.07 + Math.sin(t * 1.2) * 0.02);
    g.fillStyle = "#000";
    g.fillRect(-w / 2 + 12, -h / 2 + 12, w, h);
    g.fillStyle = "#fff";
    g.fillRect(-w / 2, -h / 2, w, h);
    g.lineWidth = 5;
    g.strokeStyle = "#000";
    g.strokeRect(-w / 2, -h / 2, w, h);
    var px = -w / 2 + 20, py = -h / 2 + 20, pw = w - 40, ph = h - 100;
    g.save();
    g.beginPath();
    g.rect(px, py, pw, ph);
    g.clip();
    var img = st.photo;
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var scale = Math.max(pw / iw, ph / ih);
    var drift = Math.sin(t * 0.5) * 0.02 + 1.04; // slow gentle zoom
    g.drawImage(img, px + pw / 2 - (iw * scale * drift) / 2, py + ph / 2 - (ih * scale * drift) / 2, iw * scale * drift, ih * scale * drift);
    g.restore();
    g.strokeRect(px, py, pw, ph);
    g.fillStyle = "#222";
    g.font = "38px " + HEAD_FONT;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("Happy Birthday!", 0, h / 2 - 38);
    g.fillStyle = "rgba(255,230,90,0.85)";
    g.strokeStyle = "rgba(0,0,0,0.4)";
    g.lineWidth = 2;
    [[-w / 2 + 40, -h / 2 + 6, -0.5], [w / 2 - 40, -h / 2 + 6, 0.5]].forEach(function (tp) {
      g.save();
      g.translate(tp[0], tp[1]);
      g.rotate(tp[2]);
      g.fillRect(-42, -13, 84, 26);
      g.strokeRect(-42, -13, 84, 26);
      g.restore();
    });
    g.restore();
  }

  /* ---------- extra card styles (disco, candy, galaxy) ---------- */
  var stars = [], notes = [], hearts = [], bubbles = [], pops = [], shooters = [];
  for (i = 0; i < 150; i++) stars.push({ x: rnd() * W, y: rnd() * H, r: 0.8 + rnd() * 2.2, tw: 1 + rnd() * 3, ph: rnd() * TAU, hue: Math.floor(rnd() * 360) });
  for (i = 0; i < 16; i++) notes.push({ x: 30 + rnd() * (W - 60), period: 6 + rnd() * 5, phase: rnd() * 12, size: 0.8 + rnd() * 0.8, sway: 15 + rnd() * 25, hue: Math.floor(rnd() * 360) });
  for (i = 0; i < 14; i++) hearts.push({ x: 30 + rnd() * (W - 60), period: 7 + rnd() * 5, phase: rnd() * 12, size: 0.6 + rnd() * 0.9, sway: 15 + rnd() * 30, hue: Math.floor(rnd() * 360) });
  for (i = 0; i < 20; i++) bubbles.push({ x: rnd() * W, period: 8 + rnd() * 6, phase: rnd() * 14, r: 18 + rnd() * 36, sway: 15 + rnd() * 30 });
  for (i = 0; i < 7; i++) pops.push({ x: 60 + (i / 6) * (W - 120) + (rnd() - 0.5) * 80, period: 12 + rnd() * 5, phase: rnd() * 15, size: 0.7 + rnd() * 0.5, sway: 20 + rnd() * 25 });
  for (i = 0; i < 5; i++) shooters.push({ period: 6 + rnd() * 3, phase: rnd() * 9, x: rnd() * W * 0.7, y: rnd() * H * 0.5, speed: 700 + rnd() * 300 });

  function riseU(p, t) { return ((t + p.phase) / p.period) % 1; }

  function drawNote(g, x, y, s, hue, rot) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(s, s);
    g.lineJoin = "round";
    g.lineWidth = 3.5;
    g.strokeStyle = "#000";
    g.fillStyle = "hsl(" + hue + ",100%,62%)";
    g.fillRect(9, -42, 5, 42);
    g.strokeRect(9, -42, 5, 42);
    g.beginPath();
    g.ellipse(0, 0, 13, 9, -0.4, 0, TAU);
    g.fill();
    g.stroke();
    g.beginPath();
    g.moveTo(14, -42);
    g.bezierCurveTo(32, -36, 32, -22, 24, -12);
    g.bezierCurveTo(30, -24, 24, -30, 14, -28);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  function drawHeart(g, x, y, s, hue, rot) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(s, s);
    g.beginPath();
    g.moveTo(0, 16);
    g.bezierCurveTo(-36, -10, -18, -36, 0, -14);
    g.bezierCurveTo(18, -36, 36, -10, 0, 16);
    g.closePath();
    g.fillStyle = "hsl(" + hue + ",100%,64%)";
    g.fill();
    g.lineJoin = "round";
    g.lineWidth = 3.5;
    g.strokeStyle = "#000";
    g.stroke();
    g.beginPath();
    g.ellipse(-12, -14, 6, 4, -0.7, 0, TAU);
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.fill();
    g.restore();
  }

  function drawLollipop(g, x, y, s, rot) {
    g.save();
    g.translate(x, y);
    g.rotate(rot);
    g.scale(s, s);
    g.lineCap = "round";
    g.strokeStyle = "#000";
    g.lineWidth = 9;
    g.beginPath(); g.moveTo(0, 30); g.lineTo(0, 110); g.stroke();
    g.strokeStyle = "#fff";
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, 30); g.lineTo(0, 110); g.stroke();
    for (var k = 0; k < 8; k++) {
      g.beginPath();
      g.moveTo(0, 0);
      g.arc(0, 0, 34, (k / 8) * TAU, ((k + 1) / 8) * TAU);
      g.closePath();
      g.fillStyle = PALETTE[k % PALETTE.length];
      g.fill();
    }
    g.beginPath();
    g.arc(0, 0, 34, 0, TAU);
    g.lineWidth = 4;
    g.strokeStyle = "#000";
    g.stroke();
    g.beginPath();
    g.ellipse(-12, -14, 8, 5, -0.7, 0, TAU);
    g.fillStyle = "rgba(255,255,255,0.6)";
    g.fill();
    g.restore();
  }

  function drawBubble(g, x, y, r, t, k) {
    var gr = g.createLinearGradient(x - r, y - r, x + r, y + r);
    for (var c = 0; c < 5; c++) gr.addColorStop(c / 4, "hsl(" + ((t * 60 + k * 40 + c * 60) % 360) + ",100%,65%)");
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = gr;
    g.stroke();
    g.beginPath();
    g.ellipse(x - r * 0.35, y - r * 0.4, r * 0.22, r * 0.12, -0.6, 0, TAU);
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.fill();
  }

  function drawNotes(g, t) {
    for (var k = 0; k < notes.length; k++) {
      var n = notes[k], u = riseU(n, t);
      drawNote(g, n.x + Math.sin(u * TAU * 2) * n.sway, H + 60 - u * (H + 160), n.size, (n.hue + t * 40) % 360, Math.sin(t * 2 + k) * 0.3);
    }
  }
  function drawHearts(g, t) {
    for (var k = 0; k < hearts.length; k++) {
      var h = hearts[k], u = riseU(h, t);
      drawHeart(g, h.x + Math.sin(u * TAU * 2) * h.sway, H + 50 - u * (H + 120), h.size * (1 + 0.08 * Math.sin(t * 6 + k)), (h.hue + t * 30) % 360, Math.sin(t * 1.5 + k) * 0.25);
    }
  }
  function drawBubbles(g, t) {
    for (var k = 0; k < bubbles.length; k++) {
      var b = bubbles[k], u = riseU(b, t);
      drawBubble(g, b.x + Math.sin(u * TAU * 2) * b.sway, H + b.r + 10 - u * (H + 2 * b.r + 20), b.r, t, k);
    }
  }
  function drawLollipops(g, t) {
    for (var k = 0; k < pops.length; k++) {
      var p = pops[k], u = riseU(p, t);
      drawLollipop(g, p.x + Math.sin(u * TAU * 2) * p.sway, H + 60 - u * (H + 260), p.size, Math.sin(t * 1.3 + k) * 0.3);
    }
  }

  function drawDiscoBall(g, x, y, r, t) {
    g.save();
    g.strokeStyle = "#000";
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, y - r); g.stroke();
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.save();
    g.clip();
    var n = 10, cs = (2 * r) / n, shift = Math.floor(t * 3);
    for (var a = 0; a < n; a++) {
      for (var b = 0; b < n; b++) {
        var l = 55 + 38 * Math.sin(t * 3 + a * 1.7 + b * 2.3);
        g.fillStyle = "hsl(" + (((a + shift) * 36 + b * 20 + t * 60) % 360) + ",85%," + l + "%)";
        g.fillRect(x - r + a * cs, y - r + b * cs, cs - 1.5, cs - 1.5);
      }
    }
    g.restore();
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.lineWidth = 4;
    g.stroke();
    for (var k = 0; k < 4; k++) drawSparkle(g, x + Math.cos(t * 1.5 + k * 1.6) * (r + 22), y + Math.sin(t * 1.5 + k * 1.6) * (r + 22), 10 + 6 * Math.sin(t * 4 + k), 0.5 + 0.5 * Math.abs(Math.sin(t * 3 + k)), PALETTE[k]);
    g.restore();
  }

  function drawDiscoBackground(g, t) {
    var hh = (t * 30) % 360;
    var grad = g.createLinearGradient(0, 0, 0, H);
    var baseHue = 270 + 45 * Math.sin(t * 0.3);
    grad.addColorStop(0, "hsl(" + baseHue + ",80%,16%)");
    grad.addColorStop(1, "hsl(" + (baseHue + 40) + ",85%,30%)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    var beat = Math.pow(Math.max(0, Math.sin(t * TAU * 2)), 4); // steady 120 bpm pulse
    var glow = g.createRadialGradient(350, 410, 20, 350, 410, 460 + beat * 70);
    glow.addColorStop(0, "hsla(" + ((hh + 120) % 360) + ",100%,60%," + (0.35 + beat * 0.25) + ")");
    glow.addColorStop(1, "hsla(" + ((hh + 120) % 360) + ",100%,60%,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    g.save();
    g.globalCompositeOperation = "lighter";
    var origins = [[0, 0], [W, 0], [W / 2, -30], [1190, 72]];
    for (var k = 0; k < 9; k++) {
      var o = origins[k % origins.length];
      var base = Math.PI / 2 + Math.sin(t * 0.6 + k * 1.7) * 1.0;
      var half = 0.07;
      g.fillStyle = "hsla(" + ((hh + k * 40) % 360) + ",100%,55%,0.2)";
      g.beginPath();
      g.moveTo(o[0], o[1]);
      g.lineTo(o[0] + Math.cos(base - half) * 1700, o[1] + Math.sin(base - half) * 1700);
      g.lineTo(o[0] + Math.cos(base + half) * 1700, o[1] + Math.sin(base + half) * 1700);
      g.closePath();
      g.fill();
    }
    g.restore();
    var cols = 32, tw = W / cols;
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.lineWidth = 2;
    for (var r = 0; r < 2; r++) {
      for (var c = 0; c < cols; c++) {
        g.fillStyle = "hsl(" + ((c * 12 + r * 60 + t * 140) % 360) + ",100%," + (48 + 14 * Math.sin(t * 5 + c * 0.8 + r * 2)) + "%)";
        g.fillRect(c * tw, H - 70 + r * 35, tw, 35);
        g.strokeRect(c * tw, H - 70 + r * 35, tw, 35);
      }
    }
  }

  function drawCandyBackground(g, t) {
    var cols = ["#ff5d8f", "#ffd23f", "#3ec1ff", "#5ee06f", "#b57bff", "#ff9a3c"];
    var sw = 90, shift = t * 40, base = Math.floor(shift / sw), frac = shift - base * sw;
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-0.5);
    for (var k = -20; k <= 20; k++) {
      g.fillStyle = cols[(((k - base) % cols.length) + cols.length) % cols.length];
      g.fillRect(k * sw + frac, -1300, sw, 2600);
    }
    g.restore();
    g.fillStyle = "rgba(255,255,255,0.28)";
    for (var gx = 0; gx < 20; gx++) {
      for (var gy = 0; gy < 12; gy++) {
        g.beginPath();
        g.arc(((gx * 70 + t * 14 + (gy % 2) * 35) % (W + 70)) - 35, gy * 70 + 20, 13, 0, TAU);
        g.fill();
      }
    }
    var soft = g.createRadialGradient(350, 410, 40, 350, 410, 420);
    soft.addColorStop(0, "rgba(255,255,255,0.5)");
    soft.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = soft;
    g.fillRect(0, 0, W, H);
  }

  function drawPlanet(g, x, y, r, hue, ring) {
    g.save();
    g.translate(x, y);
    g.rotate(-0.35);
    function ringArc(a0, a1) {
      g.beginPath();
      g.ellipse(0, 0, r * 1.9, r * 0.5, 0, a0, a1);
      g.lineCap = "butt";
      g.lineWidth = 14;
      g.strokeStyle = "#000";
      g.stroke();
      g.lineWidth = 8;
      g.strokeStyle = "hsl(" + ((hue + 40) % 360) + ",100%,65%)";
      g.stroke();
    }
    if (ring) ringArc(Math.PI, TAU);
    var pg = g.createRadialGradient(-r * 0.35, -r * 0.35, r * 0.1, 0, 0, r);
    pg.addColorStop(0, "hsl(" + hue + ",100%,78%)");
    pg.addColorStop(1, "hsl(" + hue + ",90%,45%)");
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fillStyle = pg;
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = "rgba(255,255,255,0.22)";
    g.fillRect(-r, -r * 0.45, 2 * r, r * 0.22);
    g.fillRect(-r, r * 0.15, 2 * r, r * 0.3);
    g.restore();
    g.lineWidth = 4;
    g.strokeStyle = "#000";
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
    if (ring) ringArc(0, Math.PI);
    g.restore();
  }

  function drawGalaxyBackground(g, t) {
    var h = 25 * Math.sin(t * 0.2);
    var grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, "hsl(" + (225 + h) + ",85%,16%)");
    grad.addColorStop(0.55, "hsl(" + (275 + h) + ",80%,24%)");
    grad.addColorStop(1, "hsl(" + (325 + h) + ",80%,22%)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    g.save();
    g.globalCompositeOperation = "lighter";
    var neb = [[220, 180, 420, 0], [1050, 500, 460, 120], [700, 120, 380, 220], [300, 620, 380, 300]];
    neb.forEach(function (n, k) {
      var nx = n[0] + Math.sin(t * 0.3 + k) * 40, ny = n[1] + Math.cos(t * 0.25 + k) * 30, hu = (n[3] + t * 10) % 360;
      var rg = g.createRadialGradient(nx, ny, 10, nx, ny, n[2]);
      rg.addColorStop(0, "hsla(" + hu + ",100%,55%,0.35)");
      rg.addColorStop(1, "hsla(" + hu + ",100%,55%,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
    });
    g.lineCap = "round";
    g.lineJoin = "round";
    for (var k = 0; k < 3; k++) {
      for (var pass = 0; pass < 2; pass++) {
        g.lineWidth = pass ? 16 : 64;
        g.strokeStyle = "hsla(" + ((t * 25 + k * 110) % 360) + ",100%,60%," + (pass ? 0.35 : 0.14) + ")";
        g.beginPath();
        for (var x = -40; x <= W + 40; x += 40) {
          var y = 150 + k * 210 + Math.sin(x * 0.004 + t * 0.5 + k * 2) * 70 + Math.sin(x * 0.012 - t * 0.9 + k) * 22;
          if (x === -40) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
    }
    g.restore();
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      g.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * st.tw + st.ph));
      g.fillStyle = "hsl(" + st.hue + ",100%,85%)";
      g.beginPath();
      g.arc(st.x, st.y, st.r, 0, TAU);
      g.fill();
      if (st.r > 2.4) {
        g.strokeStyle = g.fillStyle;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(st.x - st.r * 3, st.y); g.lineTo(st.x + st.r * 3, st.y);
        g.moveTo(st.x, st.y - st.r * 3); g.lineTo(st.x, st.y + st.r * 3);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    drawPlanet(g, 110, 118, 56, (320 + t * 6) % 360, true);
    drawPlanet(g, 90, 640, 34, (190 + t * 6) % 360, false);
  }

  function drawShooters(g, t) {
    g.save();
    g.lineCap = "round";
    for (var k = 0; k < shooters.length; k++) {
      var s = shooters[k];
      var age = (t + s.phase) % s.period;
      if (age > 0.9) continue;
      var d = age * s.speed, dx = Math.cos(0.6), dy = Math.sin(0.6);
      var hx = s.x + d * dx, hy = s.y + d * dy;
      var gr = g.createLinearGradient(hx - dx * 220, hy - dy * 220, hx, hy);
      gr.addColorStop(0, "rgba(255,255,255,0)");
      gr.addColorStop(1, "#fff");
      g.globalAlpha = clamp((0.9 - age) * 3, 0, 1);
      g.strokeStyle = gr;
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(hx - dx * 220, hy - dy * 220);
      g.lineTo(hx, hy);
      g.stroke();
      g.fillStyle = "#fff";
      g.beginPath();
      g.arc(hx, hy, 6, 0, TAU);
      g.fill();
    }
    g.restore();
  }

  // Each style only draws what sits BEHIND the cake / photo and the text; the foreground is shared.
  var STYLES = [
    { label: "Classic rainbow", back: function (g, t, T) { drawBackground(g, t); drawBokeh(g, t); drawFireworks(g, t); drawBalloons(g, t); drawConfetti(g, t, T); } },
    { label: "Disco party", back: function (g, t, T) { drawDiscoBackground(g, t); drawFireworks(g, t); drawNotes(g, t); drawConfetti(g, t, T); drawDiscoBall(g, 1190, 72, 58, t); } },
    { label: "Candy pop", back: function (g, t, T) { drawCandyBackground(g, t); drawBubbles(g, t); drawLollipops(g, t); drawFireworks(g, t); drawHearts(g, t); drawConfetti(g, t, T); } },
    { label: "Galaxy night", back: function (g, t, T) { drawGalaxyBackground(g, t); drawShooters(g, t); drawBokeh(g, t); drawFireworks(g, t); drawConfetti(g, t, T); } }
  ];

  function drawVisual(g, st, t) {
    var cx = 350, cy = 410;
    var pop = easeOutElastic((t - 0.9) / 1.4);
    g.save();
    g.translate(cx, cy);
    g.scale(Math.max(pop, 0.001), Math.max(pop, 0.001));
    g.translate(-cx, -cy);
    if (st.photo) drawPolaroid(g, st, cx, cy, t);
    else drawCake(g, cx, cy - 14, t);
    g.restore();
    for (var k = 0; k < 8; k++) {
      var a = (k / 8) * TAU + t * 0.4;
      drawSparkle(g, cx + Math.cos(a) * 270, cy + Math.sin(a) * 250, 14 + 8 * Math.sin(t * 3 + k), 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + k)) * pop, PALETTE[k % PALETTE.length]);
    }
  }

  function strokedText(g, text, x, y, size, fill, outline) {
    g.lineJoin = "round";
    g.lineWidth = Math.max(4, size * 0.13);
    g.strokeStyle = outline || "#000";
    g.strokeText(text, x, y);
    g.fillStyle = fill;
    g.fillText(text, x, y);
  }

  function drawTitle(g, t) {
    g.save();
    g.font = "78px " + HEAD_FONT;
    g.textBaseline = "alphabetic";
    g.textAlign = "left";
    var widths = [], total = 0, k;
    for (k = 0; k < TITLE.length; k++) { var w = g.measureText(TITLE[k]).width; widths.push(w); total += w; }
    var x = W / 2 - total / 2;
    for (k = 0; k < TITLE.length; k++) {
      var start = 0.15 * k;
      var u = clamp((t - start) / 0.9, 0, 1);
      var drop = (1 - easeOutBounce(u)) * -260;
      var wave = t > 3.2 ? Math.sin(t * 3.2 + k * 0.55) * 7 : 0;
      var rot = t > 3.2 ? Math.sin(t * 2.4 + k) * 0.05 : 0;
      g.save();
      g.globalAlpha = u > 0 ? 1 : 0;
      g.translate(x + widths[k] / 2, 104 + drop + wave);
      g.rotate(rot);
      g.textAlign = "center";
      strokedText(g, TITLE[k], 0, 0, 78, "hsl(" + (((k * 24) + t * 70) % 360) + ",100%,62%)");
      g.restore();
      x += widths[k];
    }
    g.restore();
  }

  function wrapLines(g, text, maxW) {
    var out = [];
    String(text).split(/\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean);
      var line = "";
      if (!words.length) { out.push(""); return; }
      words.forEach(function (word) {
        while (g.measureText(word).width > maxW) {
          var cut = word.length - 1;
          while (cut > 1 && g.measureText(word.slice(0, cut)).width > maxW) cut--;
          if (line) { out.push(line); line = ""; }
          out.push(word.slice(0, cut));
          word = word.slice(cut);
        }
        var test = line ? line + " " + word : word;
        if (g.measureText(test).width <= maxW) line = test;
        else { out.push(line); line = word; }
      });
      out.push(line);
    });
    return out;
  }

  function nameLayout(g, name) {
    var maxW = 590;
    g.font = "96px " + HEAD_FONT;
    var one = g.measureText(name).width;
    var words = name.split(/\s+/).filter(Boolean);
    if (one <= maxW || words.length < 2) {
      var size1 = Math.max(46, Math.min(96, (96 * maxW) / Math.max(one, 1)));
      return { lines: [name], size: size1 };
    }
    var best = null;
    for (var k = 1; k < words.length; k++) {
      var a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
      var longest = Math.max(g.measureText(a).width, g.measureText(b).width);
      if (!best || longest < best.longest) best = { lines: [a, b], longest: longest };
    }
    return { lines: best.lines, size: Math.max(46, Math.min(80, (96 * maxW) / best.longest)) };
  }

  function messageLayout(g, text, boxW, boxH) {
    var size = 34;
    var lines;
    for (; size >= 18; size -= 2) {
      g.font = size + "px " + BODY_FONT;
      lines = wrapLines(g, text, boxW);
      if (lines.length * size * 1.25 <= boxH) return { size: size, lines: lines };
    }
    var maxLines = Math.max(1, Math.floor(boxH / (18 * 1.25)));
    lines = lines.slice(0, maxLines);
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*\S{0,3}$/, "") + "...";
    return { size: 18, lines: lines };
  }

  function drawTexts(g, st, t) {
    var cx = 935;
    g.save();
    g.textAlign = "center";
    g.textBaseline = "alphabetic";

    var lab = easeOutBack((t - 1.2) / 0.6);
    g.save();
    g.translate(cx, 212);
    g.scale(Math.max(lab, 0.001), Math.max(lab, 0.001));
    g.font = "38px " + HEAD_FONT;
    strokedText(g, "HAPPY BIRTHDAY", 0, 0, 38, "#fff");
    g.restore();

    if (!st._name) st._name = nameLayout(g, st.name);
    var nm = st._name;
    var pop = easeOutBack((t - 1.8) / 0.8);
    var lh = nm.size * 0.95;
    var firstY = 215 + 40 + nm.size * 0.9;
    for (var k = 0; k < nm.lines.length; k++) {
      g.save();
      g.translate(cx, firstY + k * lh);
      g.scale(Math.max(pop, 0.001), Math.max(pop, 0.001));
      g.rotate(Math.sin(t * 1.6 + k) * 0.012);
      g.font = nm.size + "px " + HEAD_FONT;
      var half = g.measureText(nm.lines[k]).width / 2;
      var grad = g.createLinearGradient(-half, 0, half, 0);
      var hh = (t * 60) % 360;
      grad.addColorStop(0, "hsl(" + hh + ",100%,70%)");
      grad.addColorStop(0.5, "hsl(" + ((hh + 90) % 360) + ",100%,68%)");
      grad.addColorStop(1, "hsl(" + ((hh + 200) % 360) + ",100%,68%)");
      g.shadowColor = "rgba(0,0,0,0.9)";
      g.shadowOffsetX = 6;
      g.shadowOffsetY = 6;
      g.shadowBlur = 0;
      strokedText(g, nm.lines[k], 0, 0, nm.size, grad);
      g.restore();
    }

    var textBottom = firstY + (nm.lines.length - 1) * lh + 26;
    var cardY = textBottom + 18;
    var cardH = 632 - cardY;
    var cardW = 600;
    var cardX = cx - cardW / 2;
    var e = easeOutBack((t - 3.2) / 0.9);
    if (e > 0.001) {
      var hasMsg = !!(st.message && st.message.trim());
      var body = hasMsg ? st.message.trim() : "Wishing you a day full of joy, laughter, and cake!";
      if (!st._msg || st._msgKey !== body) {
        st._msg = messageLayout(g, body, cardW - 56, cardH - (hasMsg ? 84 : 48));
        st._msgKey = body;
      }
      var m = st._msg;
      g.save();
      g.globalAlpha = clamp(e, 0, 1);
      g.translate(0, (1 - clamp(e, 0, 1.1)) * 70);
      g.fillStyle = "#000";
      rr(g, cardX + 8, cardY + 8, cardW, cardH, 18);
      g.fill();
      g.fillStyle = "#fff";
      rr(g, cardX, cardY, cardW, cardH, 18);
      g.fill();
      g.lineWidth = 4;
      g.strokeStyle = "#000";
      g.stroke();
      g.fillStyle = "#ff3d81";
      g.textAlign = "left";
      var ty = cardY + 20;
      if (hasMsg) {
        g.font = "30px " + HEAD_FONT;
        g.fillStyle = "#ff3d81";
        var first = st.name.split(/\s+/)[0];
        g.fillText(first + " says:", cardX + 28, ty + 28);
        ty += 40;
      }
      g.font = m.size + "px " + BODY_FONT;
      g.fillStyle = "#222";
      var linesTotal = m.lines.length * m.size * 1.25;
      var avail = cardY + cardH - 22 - ty;
      var offset = hasMsg ? 0 : Math.max(0, (avail - linesTotal) / 2);
      for (var l = 0; l < m.lines.length; l++) g.fillText(m.lines[l], cardX + 28, ty + offset + m.size + l * m.size * 1.25);
      g.restore();
    }
    g.restore();
  }

  // The scrolling ribbon is gone; only the closing "MAKE A WISH!" shows in the last seconds.
  function drawFooter(g, t, T) {
    if (t <= T - 5.5) return;
    var pulse = 1 + 0.06 * Math.sin(t * 7);
    g.save();
    g.translate(W / 2, H - 34);
    g.scale(pulse, pulse);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "46px " + HEAD_FONT;
    strokedText(g, "MAKE A WISH!", 0, 0, 46, "hsl(" + ((t * 120) % 360) + ",100%,65%)");
    g.restore();
  }

  function drawFrame(st, t) {
    var g = st.g;
    var T = st.duration;
    g.save();
    g.clearRect(0, 0, W, H);
    STYLES[st.style].back(g, t, T);
    drawVisual(g, st, t);
    drawTexts(g, st, t);
    drawTitle(g, t);
    drawFooter(g, t, T);
    var fadeIn = clamp(1 - t / 0.5, 0, 1);
    var fadeOut = clamp(1 - (T - t) / 0.9, 0, 1);
    var fade = Math.max(fadeIn, fadeOut);
    if (fade > 0 && t !== IDLE_T) {
      g.fillStyle = "rgba(0,0,0," + fade + ")";
      g.fillRect(0, 0, W, H);
    }
    g.restore();
  }

  /* ---------- shared audio (one song element for the whole page) ---------- */
  var shared = { audio: null, ac: null, src: null, rec: null, active: null };

  function songUrl(file) { return SONG_DIR + encodeURIComponent(file); }
  function songLabel(file) {
    var name = file.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  function getAudio() {
    if (!shared.audio) {
      var a = new Audio();
      a.preload = "auto";
      shared.audio = a;
    }
    return shared.audio;
  }
  // Points the shared player at one song and waits until its length is known.
  function loadSong(file) {
    var a = getAudio();
    var url = new URL(songUrl(file), document.baseURI).href;
    if (a.src !== url) { a.src = url; a.load(); }
    if (a.readyState >= 1) return Promise.resolve(a.duration);
    return new Promise(function (resolve, reject) {
      a.addEventListener("loadedmetadata", function () { resolve(a.duration); }, { once: true });
      a.addEventListener("error", function () { reject(new Error("Could not load song/" + file)); }, { once: true });
    });
  }
  // Song length for the idle preview, read with its own element so it never disturbs the playing song.
  var durations = {};
  function readDuration(file) {
    if (!durations[file]) {
      durations[file] = new Promise(function (resolve, reject) {
        var a = new Audio();
        a.preload = "metadata";
        a.onloadedmetadata = function () { resolve(a.duration); };
        a.onerror = function () { delete durations[file]; reject(new Error("Could not load song/" + file)); };
        a.src = songUrl(file);
      });
    }
    return durations[file];
  }
  // song/songs.json is generated at deploy time from the files in the song folder.
  var songListPromise = null;
  function loadSongList() {
    if (!songListPromise) {
      songListPromise = fetch(SONG_LIST_URL, { cache: "no-cache" }).then(function (res) {
        if (!res.ok) throw new Error("Could not read " + SONG_LIST_URL + ". Redeploy the site so the song list is built.");
        return res.json();
      });
      songListPromise.catch(function () { songListPromise = null; });
    }
    return songListPromise;
  }
  function ensureGraph() {
    if (shared.ac) return shared;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("Audio is unavailable in this browser.");
    shared.ac = new AC();
    shared.src = shared.ac.createMediaElementSource(getAudio());
    shared.rec = shared.ac.createMediaStreamDestination();
    return shared;
  }
  function route(toRecorder) {
    var s = ensureGraph();
    try { s.src.disconnect(); } catch (_) {}
    s.src.connect(toRecorder ? s.rec : s.ac.destination);
  }
  // Fallback recorder (only used when the browser has no WebCodecs). WebM first: we can repair its length.
  function pickMime() {
    if (!window.MediaRecorder) return null;
    var list = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    for (var k = 0; k < list.length; k++) if (MediaRecorder.isTypeSupported(list[k])) return list[k];
    return "";
  }
  function stopAll() {
    if (shared.active && shared.active.abort) shared.active.abort();
  }

  /* ---------- video export ---------- */
  // Videos recorded live by the browser have no length stored in the file, so players show a bogus duration.
  // This patches the real length into a recorded WebM.
  function fixWebmDurationBytes(buf, seconds) {
  function readVint(p, keepMarker) {
    var b = buf[p], len = 1, mask = 0x80;
    while (len <= 8 && !(b & mask)) { mask >>= 1; len++; }
    if (len > 8) return null;
    var val = keepMarker ? b : b & (mask - 1), allOnes = (b & (mask - 1)) === mask - 1;
    for (var k = 1; k < len; k++) { val = val * 256 + buf[p + k]; if (buf[p + k] !== 255) allOnes = false; }
    return { len: len, val: val, unknown: !keepMarker && allOnes };
  }
  function vintBytes(n) {
    for (var len = 1; len <= 8; len++) if (n < Math.pow(2, 7 * len) - 1) break;
    var out = new Uint8Array(len), v = n;
    for (var k = len - 1; k >= 0; k--) { out[k] = v % 256; v = Math.floor(v / 256); }
    out[0] |= 1 << (8 - len);
    return out;
  }
  var p = 0, id = readVint(p, true), sz = readVint(p + id.len, false);
  if (!id || id.val !== 0x1a45dfa3) return null;
  p += id.len + sz.len + sz.val;
  id = readVint(p, true);
  if (!id || id.val !== 0x18538067) return null;
  sz = readVint(p + id.len, false);
  if (!sz.unknown) return null; // known segment size: leave file untouched
  p += id.len + sz.len;
  var infoSizePos = -1, infoStart = -1, infoLen = -1;
  while (p < buf.length) {
    id = readVint(p, true);
    if (!id) return null;
    sz = readVint(p + id.len, false);
    if (!sz || sz.unknown) return null;
    if (id.val === 0x1549a966) { infoSizePos = p + id.len; infoStart = infoSizePos + sz.len; infoLen = sz.val; break; }
    if (id.val === 0x1f43b675) return null; // reached clusters without Info
    p += id.len + sz.len + sz.val;
  }
  if (infoStart < 0) return null;
  var scale = 1000000, q = infoStart, durPos = -1, durLen = 0;
  while (q < infoStart + infoLen) {
    var cid = readVint(q, true), csz = readVint(q + cid.len, false);
    var dataPos = q + cid.len + csz.len;
    if (cid.val === 0x2ad7b1) { scale = 0; for (var k = 0; k < csz.val; k++) scale = scale * 256 + buf[dataPos + k]; }
    if (cid.val === 0x4489) { durPos = dataPos; durLen = csz.val; }
    q = dataPos + csz.val;
  }
  var ticks = seconds * 1e9 / scale;
  if (durPos >= 0) {
    var dv = new DataView(buf.buffer, buf.byteOffset + durPos, durLen);
    if (durLen === 8) dv.setFloat64(0, ticks); else if (durLen === 4) dv.setFloat32(0, ticks); else return null;
    return buf;
  }
  var el = new Uint8Array(11);
  el[0] = 0x44; el[1] = 0x89; el[2] = 0x88;
  new DataView(el.buffer).setFloat64(3, ticks);
  var newSize = vintBytes(infoLen + el.length);
  var out = new Uint8Array(buf.length - (infoStart - infoSizePos) + newSize.length + el.length);
  out.set(buf.subarray(0, infoSizePos), 0);
  out.set(newSize, infoSizePos);
  out.set(buf.subarray(infoStart, infoStart + infoLen), infoSizePos + newSize.length);
  out.set(el, infoSizePos + newSize.length + infoLen);
  out.set(buf.subarray(infoStart + infoLen), infoSizePos + newSize.length + infoLen + el.length);
  return out;
}

  function unsupported(msg) { var e = new Error(msg); e.unsupported = true; return e; }
  function tick(ms) { return new Promise(function (r) { setTimeout(r, ms || 0); }); }
  function supportsWebCodecs() {
    return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoFrame !== "undefined" && typeof AudioData !== "undefined";
  }
  function loadMuxer() {
    if (window.Mp4Muxer) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = MUXER_URL;
      sc.onload = resolve;
      sc.onerror = function () { reject(unsupported("Could not load the video writer.")); };
      document.head.appendChild(sc);
    });
  }

  // Renders the animation frame by frame (not in real time) and writes a proper .mp4 with the exact song length.
  async function exportMp4(st, onProgress, shouldCancel) {
    if (!supportsWebCodecs()) throw unsupported("WebCodecs is not available.");
    await loadMuxer();
    if (!window.Mp4Muxer) throw unsupported("Video writer missing.");

    var resp = await fetch(songUrl(st.song));
    if (!resp.ok) throw new Error("Could not load song/" + st.song);
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw unsupported("No audio decoder.");
    var actx = new AC();
    var decoded;
    try { decoded = await actx.decodeAudioData(await resp.arrayBuffer()); }
    finally { try { actx.close(); } catch (_) {} }
    var sr = decoded.sampleRate;
    var ch = Math.min(2, decoded.numberOfChannels);
    var FPS = 30;
    var T = decoded.duration;
    st.duration = T;
    var total = Math.round(T * FPS);

    var vCodec = null;
    var codecs = ["avc1.640028", "avc1.4d0028", "avc1.42E028"];
    for (var c = 0; c < codecs.length && !vCodec; c++) {
      var vr = await VideoEncoder.isConfigSupported({ codec: codecs[c], width: W, height: H, bitrate: 5000000, framerate: FPS });
      if (vr && vr.supported) vCodec = codecs[c];
    }
    if (!vCodec) throw unsupported("H.264 encoding is not available.");
    var aCfg = { codec: "mp4a.40.2", sampleRate: sr, numberOfChannels: ch, bitrate: 128000 };
    var ar = await AudioEncoder.isConfigSupported(aCfg);
    if (!ar || !ar.supported) throw unsupported("AAC encoding is not available.");

    var muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width: W, height: H, frameRate: FPS },
      audio: { codec: "aac", numberOfChannels: ch, sampleRate: sr },
      fastStart: "in-memory"
    });
    var encErr = null;
    var venc = new VideoEncoder({ output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); }, error: function (e) { encErr = e; } });
    var aenc = new AudioEncoder({ output: function (chunk, meta) { muxer.addAudioChunk(chunk, meta); }, error: function (e) { encErr = e; } });
    try {
      venc.configure({ codec: vCodec, width: W, height: H, bitrate: 5000000, framerate: FPS });
      aenc.configure(aCfg);

      var step = Math.round(sr / 10);
      for (var off = 0; off < decoded.length; off += step) {
        if (shouldCancel()) return null;
        if (encErr) throw encErr;
        var n = Math.min(step, decoded.length - off);
        var data = new Float32Array(n * ch);
        for (var k = 0; k < ch; k++) data.set(decoded.getChannelData(k).subarray(off, off + n), k * n);
        var ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((off / sr) * 1e6), data: data });
        aenc.encode(ad);
        ad.close();
        while (aenc.encodeQueueSize > 30) await tick(5);
      }

      for (var i = 0; i < total; i++) {
        if (shouldCancel()) return null;
        if (encErr) throw encErr;
        drawFrame(st, i / FPS);
        var vf = new VideoFrame(st.canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
        venc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
        vf.close();
        while (venc.encodeQueueSize > 6) await tick(2);
        if (i % 4 === 0) { onProgress(i / total); await tick(); }
      }
      await venc.flush();
      await aenc.flush();
      if (encErr) throw encErr;
      muxer.finalize();
      return new Blob([muxer.target.buffer], { type: "video/mp4" });
    } finally {
      try { venc.close(); } catch (_) {}
      try { aenc.close(); } catch (_) {}
    }
  }

  /* ---------- photo helpers ---------- */
  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("That image could not be read.")); };
      img.src = url;
    });
  }
  async function prepareImage(file) {
    var img = await loadImageFile(file);
    var max = 1400;
    var scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    var g = c.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    var blob = await new Promise(function (resolve) { c.toBlob(resolve, "image/jpeg", 0.86); });
    if (!blob) throw new Error("That image could not be processed.");
    if (blob.size > 5 * 1024 * 1024) throw new Error("That image is still too large after shrinking.");
    return blob;
  }
  // Downloaded as a blob so the canvas is never "tainted" (this is what makes video recording possible).
  async function fetchPhoto(path) {
    var res = await sb.storage.from(BUCKET).download(path);
    if (res.error) throw res.error;
    return loadImageFile(res.data);
  }

  /* ---------- the card ---------- */
  function createStage(opts) {
    var name = opts.name || "Classmate";
    var st = {
      name: name,
      message: opts.message || "",
      photo: null,
      photoPath: opts.photoPath || null,
      song: opts.song || DEFAULT_SONG,
      style: opts.style || 0,
      duration: FALLBACK_DURATION,
      mode: "idle",
      raf: 0,
      _name: null,
      _msg: null
    };

    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Animated birthday card for " + name);
    st.canvas = canvas;
    st.g = canvas.getContext("2d");

    var wrap = el("div", "bday-stage-wrap");
    var stage = el("div", "bday-stage");
    var playBig = el("button", "bday-play-big", "\u25B6");
    playBig.type = "button";
    playBig.setAttribute("aria-label", "Play the birthday song and animation");
    stage.append(canvas, playBig);

    var bar = el("div", "bday-progress");
    var fill = el("i");
    bar.appendChild(fill);

    var tools = el("div", "bday-tools");
    var btnPlay = el("button", "bday-btn bday-btn-play", "\u25B6 Play song");
    btnPlay.type = "button";
    var status = el("span", "bday-status");
    status.setAttribute("aria-live", "polite");
    tools.append(btnPlay);

    var btnVideo, songSel, styleSel, photoBtn, removeBtn, fileInput;
    if (opts.isAdmin) {
      btnVideo = el("button", "bday-btn bday-btn-video", "\u2B07 Download video");
      btnVideo.type = "button";
      songSel = document.createElement("select");
      songSel.className = "bday-select";
      songSel.setAttribute("aria-label", "Birthday song");
      songSel.appendChild(new Option(songLabel(st.song), st.song));
      styleSel = document.createElement("select");
      styleSel.className = "bday-select";
      styleSel.setAttribute("aria-label", "Animation style");
      STYLES.forEach(function (s, k) { styleSel.appendChild(new Option(s.label, String(k))); });
      styleSel.value = String(st.style);
      photoBtn = el("button", "bday-btn bday-btn-photo", st.photoPath ? "\uD83D\uDCF7 Change photo" : "\uD83D\uDCF7 Add photo");
      photoBtn.type = "button";
      removeBtn = el("button", "bday-btn bday-btn-remove", "Remove photo");
      removeBtn.type = "button";
      removeBtn.hidden = !st.photoPath;
      fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.hidden = true;
      tools.append(btnVideo, songSel, styleSel, photoBtn, removeBtn, fileInput);
    }
    tools.appendChild(status);
    wrap.append(stage, bar, tools);
    if (opts.isAdmin) wrap.appendChild(el("p", "bday-hint", "Admin / officer: pick the song and animation style, and add 1 photo for this celebration. They appear in the card and in the downloaded video. Only you can download the video."));

    function notify(text, bad) {
      if (opts.onNotify) opts.onNotify(text, bad);
    }
    function setStatus(text, bad) {
      status.textContent = text || "";
      status.classList.toggle("is-bad", !!bad);
    }
    function setProgress(p) { fill.style.width = clamp(p, 0, 1) * 100 + "%"; }
    function drawIdle() { drawFrame(st, IDLE_T); }

    function setUi(mode) {
      st.mode = mode;
      stage.classList.toggle("is-live", mode !== "idle");
      btnPlay.textContent = mode === "play" ? "\u25A0 Stop" : "\u25B6 Play song";
      btnPlay.disabled = mode === "record";
      if (btnVideo) {
        btnVideo.textContent = mode === "record" ? "Cancel recording" : "\u2B07 Download video";
        btnVideo.disabled = mode === "play";
        songSel.disabled = mode !== "idle";
        styleSel.disabled = mode !== "idle";
      }
      if (photoBtn) photoBtn.disabled = mode !== "idle";
      if (removeBtn) removeBtn.disabled = mode !== "idle";
    }

    function resetToIdle() {
      cancelAnimationFrame(st.raf);
      var a = getAudio();
      try { a.pause(); a.currentTime = 0; } catch (_) {}
      a.onended = null;
      if (shared.active === st) shared.active = null;
      setUi("idle");
      setProgress(0);
      drawIdle();
    }

    var exporting = false;
    var cancelExport = false;
    var recorder = null;
    var recChunks = [];
    var discard = false;
    var recMime = "";

    st.abort = function () {
      if (exporting) { cancelExport = true; setStatus("Cancelling..."); return; }
      if (st.mode === "record" && recorder && recorder.state !== "inactive") {
        discard = true;
        try { recorder.stop(); } catch (_) {}
      }
      setStatus("");
      resetToIdle();
    };

    async function start(mode) {
      stopAll();
      var audio = getAudio();
      if (mode === "record") {
        recMime = pickMime();
        if (recMime === null) { setStatus("This browser cannot record video. Try Chrome, Edge, or Safari 14.1+.", true); return; }
      }
      try {
        await loadSong(st.song);
        ensureGraph();
        await shared.ac.resume();
        route(mode === "record");
      } catch (e) {
        setStatus(e.message || "Audio is unavailable in this browser.", true);
        return;
      }
      audio.onended = null;
      try { audio.currentTime = 0; } catch (_) {}
      shared.active = st;
      setUi(mode);

      if (mode === "record") {
        discard = false;
        recChunks = [];
        var vs = canvas.captureStream(30);
        var combined = new MediaStream(vs.getVideoTracks().concat(shared.rec.stream.getAudioTracks()));
        try {
          recorder = new MediaRecorder(combined, recMime ? { mimeType: recMime, videoBitsPerSecond: 5000000, audioBitsPerSecond: 160000 } : undefined);
        } catch (e) {
          setStatus("Could not start recording: " + (e.message || e), true);
          resetToIdle();
          return;
        }
        recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size) recChunks.push(ev.data); };
        recorder.onstop = async function () {
          vs.getTracks().forEach(function (tr) { tr.stop(); });
          if (discard) { recChunks = []; return; }
          var type = (recorder.mimeType || recMime || "video/webm").split(";")[0];
          var ext = type.indexOf("mp4") >= 0 ? "mp4" : "webm";
          var blob = new Blob(recChunks, { type: type });
          if (ext === "webm") {
            try {
              var fixed = fixWebmDurationBytes(new Uint8Array(await blob.arrayBuffer()), st.duration);
              if (fixed) blob = new Blob([fixed], { type: type });
            } catch (_) {}
          }
          saveBlob(blob, ext);
          setStatus("Video saved (." + ext + ", " + fmtTime(st.duration) + ").");
          notify("Birthday video downloaded.", false);
        };
        recorder.start(1000);
      }

      try {
        await audio.play();
      } catch (e) {
        setStatus("Could not play song/" + st.song + ". Check that the song file is uploaded.", true);
        if (recorder && recorder.state !== "inactive") { discard = true; try { recorder.stop(); } catch (_) {} }
        resetToIdle();
        return;
      }
      st.duration = audio.duration;

      function tick() {
        if (shared.active !== st) return;
        var t = audio.currentTime;
        drawFrame(st, t);
        setProgress(t / st.duration);
        if (mode === "record") setStatus("Recording " + Math.round((t / st.duration) * 100) + "% - keep this tab open");
        else setStatus(fmtTime(t) + " / " + fmtTime(st.duration));
        st.raf = requestAnimationFrame(tick);
      }
      tick();

      audio.onended = function () {
        cancelAnimationFrame(st.raf);
        drawFrame(st, Math.max(st.duration - 0.01, 0));
        setProgress(1);
        if (mode === "record" && recorder && recorder.state !== "inactive") {
          setStatus("Saving video...");
          setTimeout(function () {
            try { recorder.stop(); } catch (_) {}
            resetToIdle();
          }, 400);
        } else {
          setTimeout(function () { setStatus(""); resetToIdle(); }, 1200);
        }
      };
    }

    function saveBlob(blob, ext) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "birthday-" + slug(st.name) + "-" + manilaToday() + "." + ext;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    }

    async function startExport() {
      stopAll();
      shared.active = st;
      exporting = true;
      cancelExport = false;
      setUi("record");
      setProgress(0);
      setStatus("Preparing video...");
      try {
        var blob = await exportMp4(
          st,
          function (p) { setProgress(p); setStatus("Making video " + Math.round(p * 100) + "%"); },
          function () { return cancelExport; }
        );
        if (blob) {
          saveBlob(blob, "mp4");
          setStatus("Video saved (.mp4, " + fmtTime(st.duration) + ").");
          notify("Birthday video downloaded.", false);
        } else setStatus("");
      } catch (e) {
        exporting = false;
        if (e && e.unsupported) {
          shared.active = null;
          setUi("idle");
          await start("record"); // older browser: record live instead
          return;
        }
        setStatus("Could not make the video: " + ((e && e.message) || e), true);
      }
      exporting = false;
      resetToIdle();
    }

    btnPlay.onclick = playBig.onclick = function () {
      if (st.mode === "play") { st.abort(); return; }
      setStatus("");
      start("play");
    };

    function loadLength() {
      readDuration(st.song).then(function (d) {
        st.duration = d;
        if (st.mode === "idle") { drawIdle(); setStatus("Song length " + fmtTime(d)); }
      }).catch(function (e) { setStatus(e.message, true); });
    }

    // Saves the admin / officer's song + style choice for this celebrant so everyone sees the same card.
    async function saveSettings(song, style) {
      var row = await sb.from("birthday_settings").upsert({ recipient_id: opts.recipientId, song: song, style: style, updated_at: new Date().toISOString() }, { onConflict: "recipient_id" });
      if (row.error) throw row.error;
      st.song = song;
      st.style = style;
    }
    function settingsError(e) {
      var msg = (e && e.message) || "Could not save the choice.";
      return /birthday_settings/i.test(msg) ? "Run sql/migration_birthday_settings.sql in Supabase first." : msg;
    }

    if (opts.isAdmin) {
      btnVideo.onclick = function () {
        if (st.mode === "record") { st.abort(); return; }
        setStatus("");
        if (supportsWebCodecs()) startExport();
        else start("record");
      };
      loadSongList().then(function (list) {
        songSel.replaceChildren();
        list.forEach(function (file) { songSel.appendChild(new Option(songLabel(file), file)); });
        if (list.indexOf(st.song) < 0) {
          songSel.selectedIndex = -1;
          setStatus("The saved song (" + st.song + ") is not in the song folder. Pick another.", true);
        } else songSel.value = st.song;
      }).catch(function (e) { setStatus(e.message, true); });
      songSel.onchange = async function () {
        var previous = st.song;
        songSel.disabled = true;
        try {
          await saveSettings(songSel.value, st.style);
          st.duration = FALLBACK_DURATION;
          loadLength();
          notify("Birthday song saved.", false);
        } catch (e) {
          songSel.value = previous;
          notify(settingsError(e), true);
        }
        songSel.disabled = st.mode !== "idle";
      };
      styleSel.onchange = async function () {
        var previous = st.style;
        styleSel.disabled = true;
        try {
          await saveSettings(st.song, Number(styleSel.value));
          drawIdle();
          notify("Animation style saved.", false);
        } catch (e) {
          styleSel.value = String(previous);
          notify(settingsError(e), true);
        }
        styleSel.disabled = st.mode !== "idle";
      };
      photoBtn.onclick = function () { fileInput.click(); };
      fileInput.onchange = async function () {
        var file = fileInput.files && fileInput.files[0];
        fileInput.value = "";
        if (!file) return;
        if (!file.type || file.type.indexOf("image/") !== 0 || file.size > 25 * 1024 * 1024) {
          notify("Choose one image under 25 MB.", true);
          return;
        }
        photoBtn.disabled = true;
        setStatus("Uploading photo...");
        var newPath = null;
        try {
          var blob = await prepareImage(file);
          newPath = opts.recipientId + "/" + Date.now() + ".jpg";
          var up = await sb.storage.from(BUCKET).upload(newPath, blob, { contentType: "image/jpeg", upsert: false });
          if (up.error) throw up.error;
          var row = await sb.from("birthday_photos").upsert({ recipient_id: opts.recipientId, image_path: newPath, updated_at: new Date().toISOString() }, { onConflict: "recipient_id" });
          if (row.error) throw row.error;
          var oldPath = st.photoPath;
          st.photoPath = newPath;
          st.photo = await fetchPhoto(newPath);
          if (oldPath && oldPath !== newPath) await sb.storage.from(BUCKET).remove([oldPath]);
          photoBtn.textContent = "\uD83D\uDCF7 Change photo";
          removeBtn.hidden = false;
          drawIdle();
          setStatus("");
          notify("Birthday photo saved.", false);
        } catch (e) {
          if (newPath) await sb.storage.from(BUCKET).remove([newPath]);
          setStatus("");
          var msg = (e && e.message) || "Could not save the photo.";
          if (/relation .*birthday_photos|bucket not found/i.test(msg)) msg = "Run sql/migration_birthday_photo.sql in Supabase first.";
          notify(msg, true);
        }
        photoBtn.disabled = false;
      };
      removeBtn.onclick = async function () {
        if (!st.photoPath) return;
        removeBtn.disabled = true;
        try {
          var del = await sb.from("birthday_photos").delete().eq("recipient_id", opts.recipientId);
          if (del.error) throw del.error;
          await sb.storage.from(BUCKET).remove([st.photoPath]);
          st.photoPath = null;
          st.photo = null;
          photoBtn.textContent = "\uD83D\uDCF7 Add photo";
          removeBtn.hidden = true;
          drawIdle();
          notify("Birthday photo removed.", false);
        } catch (e) {
          notify((e && e.message) || "Could not remove the photo.", true);
        }
        removeBtn.disabled = false;
      };
    }

    // first paint, then repaint once fonts / photo / song length are known
    drawIdle();
    if (document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load("40px 'Permanent Marker'"), document.fonts.load("30px 'Patrick Hand'")])
        .catch(function () {})
        .then(function () { st._name = null; st._msg = null; if (st.mode === "idle") drawIdle(); });
    }
    loadLength();
    if (st.photoPath) {
      fetchPhoto(st.photoPath).then(function (img) { st.photo = img; if (st.mode === "idle") drawIdle(); }).catch(function () {});
    }
    return wrap;
  }

  window.PortalisBirthday = { createStage: createStage, stopAll: stopAll };
})();
/*
 * Portalis school calendar.
 *  - parseEventsText():  turns the pasted "Event: / Date: / Time: / Place: / Details:" format into events
 *  - month grid, event cards, event popup, the top-bar date/time popup, and the Notes-page strip
 * Events are stored as local (Philippine) dates and times, so nothing shifts between time zones.
 * Pure helpers work in Node too (used by the tests); everything that touches the page needs common.js first.
 */
(function (root) {
  "use strict";
  if (root.PortalisCalendar) return;

  var TZ = "Asia/Manila";
  var BUCKET = "event-notices";
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var MONTHS_LC = MONTHS.map(function (m) { return m.toLowerCase(); });
  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var PALETTE = ["#ff8f8f", "#ffba55", "#f2d94e", "#6fd18f", "#6db5ff", "#c79bff"];
  var LIMITS = { title: 120, place: 160, details: 2000 };

  // ------------------------------------------------------------------ dates
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function isoOf(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
  function parseIso(s) { var a = String(s).split("-"); return { y: +a[0], m: +a[1], d: +a[2] }; }
  function utc(iso) { var p = parseIso(iso); return new Date(Date.UTC(p.y, p.m - 1, p.d)); }
  function addDays(iso, n) { var p = parseIso(iso); var d = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
  function dow(iso) { return utc(iso).getUTCDay(); }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function validDate(y, m, d) { if (m < 1 || m > 12 || d < 1) return false; return d <= daysInMonth(y, m) && y >= 2000 && y <= 2100; }
  function daysBetween(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }

  function nowParts() {
    var f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
    var p = {};
    f.formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    var h = p.hour === "24" ? 0 : +p.hour;
    return { y: +p.year, m: +p.month, d: +p.day, h: h, mi: +p.minute, s: +p.second, iso: p.year + "-" + p.month + "-" + p.day };
  }
  function todayIso() { return nowParts().iso; }

  function fmtDate(iso, opts) { return utc(iso).toLocaleDateString("en-US", Object.assign({ timeZone: "UTC" }, opts)); }
  function fmtTime(t) {
    if (!t) return "";
    var a = String(t).split(":");
    var h = +a[0];
    return (h % 12 || 12) + ":" + (a[1] || "00") + " " + (h >= 12 ? "PM" : "AM");
  }

  // ------------------------------------------------------------------ event helpers
  function lastDay(ev) { return ev.end_date && ev.end_date > ev.event_date ? ev.end_date : ev.event_date; }
  function onDay(ev, iso) { return ev.event_date <= iso && iso <= lastDay(ev); }
  function isMultiDay(ev) { return lastDay(ev) !== ev.event_date; }
  function timeText(ev) {
    var s = fmtTime(ev.start_time), e = fmtTime(ev.end_time);
    if (!s) return "All day";
    return e ? s + " \u2013 " + e : s;
  }
  function dateText(ev, long) {
    if (!isMultiDay(ev)) return fmtDate(ev.event_date, long ? { weekday: "long", month: "long", day: "numeric", year: "numeric" } : { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    return fmtDate(ev.event_date, { month: "short", day: "numeric" }) + " \u2013 " + fmtDate(lastDay(ev), { month: "short", day: "numeric", year: "numeric" });
  }
  function sortEvents(a, b) {
    var ka = a.event_date + (a.start_time || "00:00:00"), kb = b.event_date + (b.start_time || "00:00:00");
    return ka < kb ? -1 : ka > kb ? 1 : String(a.title).localeCompare(String(b.title));
  }
  function eventsOn(events, iso) { return events.filter(function (ev) { return onDay(ev, iso); }).sort(sortEvents); }
  function colorOf(ev) { return PALETTE[Math.abs(+ev.id || 0) % PALETTE.length]; }
  function relativeLabel(ev, today) {
    today = today || todayIso();
    if (onDay(ev, today)) return isMultiDay(ev) ? "Happening now" : "Today";
    var n = daysBetween(today, ev.event_date);
    if (n === 1) return "Tomorrow";
    if (n > 1 && n <= 14) return "In " + n + " days";
    if (n > 14) return "In " + Math.round(n / 7) + " weeks";
    return "Past";
  }

  // ------------------------------------------------------------------ the paste format
  var FIELD = { event: "title", title: "title", name: "title", date: "date", dates: "date", when: "date", time: "time", times: "time",
    place: "place", location: "place", venue: "place", where: "place", details: "details", detail: "details", description: "details", info: "details", note: "details", notes: "details" };
  var TEMPLATE = "Event: Intramurals Opening\nDate: Nov 20, 2026\nTime: 8:00 AM - 5:00 PM\nPlace: School gym\nDetails: Wear your PE uniform. Bring water.";

  function monthFromWord(w) {
    w = String(w).toLowerCase().replace(/\.$/, "");
    if (w.length < 3) return 0;
    for (var i = 0; i < 12; i++) if (MONTHS_LC[i].indexOf(w) === 0) return i + 1;
    return 0;
  }
  function fullYear(y) { return y < 100 ? 2000 + y : y; }
  function parsePiece(s) {
    s = String(s).trim();
    if (!s) return null;
    var sl = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
    if (sl) return { m: +sl[1], d: +sl[2], y: sl[3] ? fullYear(+sl[3]) : 0 };
    var out = { m: 0, d: 0, y: 0 };
    var tokens = s.split(/[\s,]+/).filter(Boolean);
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (/^\d{4}$/.test(t)) out.y = +t;
      else if (/^\d{1,2}$/.test(t)) { if (out.d) return null; out.d = +t; }
      else {
        var mm = monthFromWord(t);
        if (mm && !out.m) out.m = mm;
        else if (/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$/i.test(t)) continue;
        else return null;
      }
    }
    return out;
  }
  /** "Nov 20, 2026" | "Dec 1-5, 2026" | "Nov 28 - Dec 2" | "2026-11-20" | "11/20/2026" -> {event_date, end_date} */
  function parseDateSpec(text, ref) {
    ref = ref || nowParts();
    var s = String(text || "").trim();
    if (!s) return { error: "Add a date, for example  Date: Nov 20, 2026" };
    s = s.replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
    var a, b = null;
    var isos = s.match(/\d{4}-\d{1,2}-\d{1,2}/g);
    if (isos) {
      var pa = parseIso(isos[0]); a = { y: pa.y, m: pa.m, d: pa.d };
      if (isos[1]) { var pb = parseIso(isos[1]); b = { y: pb.y, m: pb.m, d: pb.d }; }
    } else {
      var norm = s.replace(/\s*(\u2013|\u2014)\s*/g, " - ").replace(/\s+(to|until|thru|through)\s+/gi, " - ");
      var parts = norm.split(/\s*-\s*/);
      if (parts.length > 2) return { error: "Use one date or one range, for example  Dec 1-5, 2026" };
      a = parsePiece(parts[0]);
      if (parts.length === 2) b = parsePiece(parts[1]);
      if (!a || (parts.length === 2 && !b)) return { error: "Could not read the date \"" + s + "\". Try  Nov 20, 2026" };
      if (b) {
        if (!a.m) a.m = b.m;
        if (!b.m) b.m = a.m;
        var yy = a.y || b.y;
        a.y = a.y || yy; b.y = b.y || yy;
      }
    }
    if (!a.m || !a.d) return { error: "The date needs a month and a day, for example  Nov 20, 2026" };
    if (!a.y) { a.y = ref.y; if (isoOf(a.y, a.m, a.d) < addDays(ref.iso, -60)) a.y++; } // no year typed: dates more than ~2 months ago mean next year
    if (!validDate(a.y, a.m, a.d)) return { error: "\"" + s + "\" is not a real date" };
    var start = isoOf(a.y, a.m, a.d), end = null;
    if (b) {
      if (!b.y) { b.y = a.y; if (b.m < a.m) b.y++; } // Dec 28 - Jan 3 runs into the next year
      if (!validDate(b.y, b.m, b.d)) return { error: "The end date in \"" + s + "\" is not a real date" };
      end = isoOf(b.y, b.m, b.d);
      if (end < start) return { error: "The end date is before the start date" };
      if (end === start) end = null;
    }
    return { event_date: start, end_date: end };
  }

  function parseTimePiece(s) {
    s = String(s).trim().toLowerCase();
    if (s === "noon") return { h: 12, m: 0, ap: "pm" };
    if (s === "midnight") return { h: 12, m: 0, ap: "am" };
    var m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m?\.?|p\.?m?\.?)?$/.exec(s);
    if (!m) return null;
    var h = +m[1], mi = m[2] ? +m[2] : 0, ap = m[3] ? (m[3].charAt(0) === "a" ? "am" : "pm") : "";
    if (mi > 59 || h > 24 || (ap && (h < 1 || h > 12))) return null;
    return { h: h, m: mi, ap: ap };
  }
  function to24(p, ap) {
    var h = p.h;
    if (ap) h = (h % 12) + (ap === "pm" ? 12 : 0);
    return pad(h % 24) + ":" + pad(p.m) + ":00";
  }
  function guessAp(p) { // no am/pm typed: 13-24 and 0 are 24-hour; 1-6 school afternoon; 7-11 morning; 12 noon
    if (p.h === 0 || p.h > 12) return "";
    return p.h === 12 || p.h <= 6 ? "pm" : "am";
  }
  /** "8:00 AM - 5:00 PM" | "8am-5pm" | "1pm" | "All day" -> {start_time, end_time} (HH:MM:SS) */
  function parseTimeSpec(text) {
    var s = String(text || "").trim();
    if (/^(all[\s-]*day|whole[\s-]*day|tba|tbd|to be announced|n\/a)?$/i.test(s)) return { start_time: null, end_time: null };
    var parts = s.split(/\s*(?:-|\u2013|\u2014|\bto\b|\buntil\b)\s*/i);
    if (parts.length > 2) return { error: "Use one time or a range, for example  Time: 8:00 AM - 5:00 PM" };
    var p1 = parseTimePiece(parts[0]), p2 = parts[1] !== undefined ? parseTimePiece(parts[1]) : null;
    if (!p1 || (parts[1] !== undefined && !p2)) return { error: "Could not read the time \"" + s + "\". Try  Time: 8:00 AM - 5:00 PM" };
    var a1 = p1.ap, a2 = p2 ? p2.ap : "";
    if (p2) {
      if (!a1 && a2) {
        a1 = a2;
        if (to24(p1, a1) > to24(p2, a2)) a1 = a2 === "pm" ? "am" : "pm";
      } else if (a1 && !a2) {
        a2 = a1;
        if (to24(p2, a2) < to24(p1, a1)) a2 = a1 === "am" ? "pm" : "am";
      } else if (!a1 && !a2) { a1 = guessAp(p1); a2 = guessAp(p2); }
    } else if (!a1) a1 = guessAp(p1);
    var start = to24(p1, a1), end = p2 ? to24(p2, a2) : null;
    if (end && end <= start) return { error: "The end time must be after the start time" };
    return { start_time: start, end_time: end };
  }

  /** The whole paste -> { items: [{title, event_date, end_date, start_time, end_time, location, description, errors}], count } */
  function parseEventsText(text, ref) {
    ref = ref || nowParts();
    var lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    var raw = [], cur = null, field = null;
    function start() { cur = { title: "", date: "", time: "", place: "", details: "", line: 0 }; raw.push(cur); field = null; }
    lines.forEach(function (line, idx) {
      if (!line.trim()) { cur = null; field = null; return; }
      var m = /^\s*([A-Za-z ]{2,12}?)\s*[:=]\s*(.*)$/.exec(line);
      var key = m ? FIELD[m[1].trim().toLowerCase()] : null;
      if (key) {
        if (key === "title" && cur && cur.title) cur = null;
        if (!cur) { start(); cur.line = idx + 1; }
        field = key;
        cur[key] = cur[key] ? cur[key] + "\n" + m[2].trim() : m[2].trim();
      } else if (cur && field) {
        cur[field] += "\n" + line.trim();
      } else if (!cur) {
        start(); cur.line = idx + 1; cur.title = line.trim(); field = "title"; // a bare first line counts as the title
      } else {
        cur.details += (cur.details ? "\n" : "") + line.trim();
      }
    });
    var items = raw.map(function (r) {
      var errors = [];
      var title = r.title.replace(/\s+/g, " ").trim();
      if (!title) errors.push("Missing the event name (Event: ...)");
      else if (title.length > LIMITS.title) errors.push("The event name is too long (max " + LIMITS.title + " characters)");
      var d = parseDateSpec(r.date.replace(/\n/g, " "), ref);
      if (d.error) errors.push(d.error);
      var t = parseTimeSpec(r.time.replace(/\n/g, " "));
      if (t.error) errors.push(t.error);
      var place = r.place.replace(/\s+/g, " ").trim();
      if (place.length > LIMITS.place) errors.push("The place is too long (max " + LIMITS.place + " characters)");
      var details = r.details.replace(/[ \t]+\n/g, "\n").trim();
      if (details.length > LIMITS.details) errors.push("The details are too long (max " + LIMITS.details + " characters)");
      return {
        title: title, event_date: d.event_date || null, end_date: d.end_date || null,
        start_time: t.start_time || null, end_time: t.end_time || null,
        location: place || null, description: details || null, errors: errors, line: r.line
      };
    });
    return { items: items, count: items.length };
  }
  /** Back into the paste format (used by Edit). */
  function eventToText(ev) {
    var out = ["Event: " + ev.title];
    out.push("Date: " + (isMultiDay(ev)
      ? fmtDate(ev.event_date, { month: "short", day: "numeric", year: "numeric" }) + " - " + fmtDate(lastDay(ev), { month: "short", day: "numeric", year: "numeric" })
      : fmtDate(ev.event_date, { month: "short", day: "numeric", year: "numeric" })));
    out.push("Time: " + timeText(ev).replace("\u2013", "-"));
    if (ev.location) out.push("Place: " + ev.location);
    if (ev.description) out.push("Details: " + ev.description);
    return out.join("\n");
  }

  // ------------------------------------------------------------------ data
  var state = { events: null, loadedAt: 0, loading: null, error: null, urls: {} };
  function client() { return typeof sb !== "undefined" ? sb : root.__sb; }
  function setupMissing() { return !!(state.error && /school_events|does not exist|schema cache|relation/i.test(String(state.error.message || ""))); }
  async function loadEvents(force) {
    if (!force && state.events && Date.now() - state.loadedAt < 60000) return state.events;
    if (state.loading) return state.loading;
    state.loading = (async function () {
      try {
        var from = addDays(todayIso(), -120);
        var res = await client().from("school_events").select("*").or("event_date.gte." + from + ",end_date.gte." + from).order("event_date", { ascending: true });
        if (res.error) { state.error = res.error; state.events = state.events || []; }
        else { state.error = null; state.events = (res.data || []).slice().sort(sortEvents); }
      } catch (e) { state.error = e; state.events = state.events || []; }
      state.loadedAt = Date.now();
      state.loading = null;
      return state.events;
    })();
    return state.loading;
  }
  function invalidate() { state.loadedAt = 0; }
  async function hydrateImages(rootEl) {
    var nodes = Array.prototype.slice.call(rootEl.querySelectorAll("[data-img-path]"));
    var need = [];
    nodes.forEach(function (n) { var p = n.getAttribute("data-img-path"); if (p && !state.urls[p] && need.indexOf(p) < 0) need.push(p); });
    if (need.length) {
      try {
        var res = await client().storage.from(BUCKET).createSignedUrls(need, 3600);
        (res.data || []).forEach(function (r) { if (r.signedUrl) state.urls[r.path] = r.signedUrl; });
      } catch (e) { /* images just stay hidden */ }
    }
    nodes.forEach(function (n) {
      var url = state.urls[n.getAttribute("data-img-path")];
      if (url) { n.src = url; n.hidden = false; }
    });
  }

  // ------------------------------------------------------------------ DOM pieces
  function mk(tag, cls, text) { return el(tag, cls, text); }
  function dateBlock(ev, today) {
    var b = mk("div", "ev-date");
    var state_ = onDay(ev, today || todayIso()) ? "now" : "";
    if (state_) b.classList.add("is-now");
    var d = utc(ev.event_date);
    b.append(mk("span", "ev-date-mon", MONTHS[d.getUTCMonth()].slice(0, 3)), mk("strong", "ev-date-day", String(d.getUTCDate())), mk("span", "ev-date-dow", DOW[d.getUTCDay()]));
    if (isMultiDay(ev)) b.appendChild(mk("span", "ev-date-more", "+" + daysBetween(ev.event_date, lastDay(ev)) + "d"));
    return b;
  }
  function linkify(parent, text) {
    String(text || "").split(/(https?:\/\/[^\s]+)/g).forEach(function (part) {
      if (/^https?:\/\//.test(part)) {
        var a = mk("a", "", part);
        a.href = part; a.target = "_blank"; a.rel = "noopener noreferrer";
        parent.appendChild(a);
      } else if (part) parent.appendChild(document.createTextNode(part));
    });
  }
  function eventCard(ev, opts) {
    opts = opts || {};
    var today = todayIso();
    var card = mk("article", "ev-card" + (onDay(ev, today) ? " is-now" : "") + (lastDay(ev) < today ? " is-past" : ""));
    card.style.setProperty("--ev", colorOf(ev));
    card.append(dateBlock(ev, today));
    var body = mk("div", "ev-card-body");
    var title = mk("strong", "ev-card-title", ev.title);
    body.appendChild(title);
    body.appendChild(mk("span", "ev-line ev-time", "\ud83d\udd52 " + timeText(ev) + (isMultiDay(ev) ? " \u00b7 " + dateText(ev) : "")));
    if (ev.location) body.appendChild(mk("span", "ev-line ev-place", "\ud83d\udccd " + ev.location));
    if (opts.relative !== false) body.appendChild(mk("span", "ev-rel", relativeLabel(ev, today)));
    card.appendChild(body);
    if (ev.image_path) {
      var img = document.createElement("img");
      img.className = "ev-thumb"; img.alt = "Notice for " + ev.title; img.loading = "lazy"; img.hidden = true;
      img.setAttribute("data-img-path", ev.image_path);
      card.appendChild(img);
    }
    if (opts.onOpen) {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", ev.title + ", " + dateText(ev) + ", " + timeText(ev));
      card.onclick = function () { opts.onOpen(ev); };
      card.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onOpen(ev); } };
    }
    return card;
  }

  var modalEl = null;
  function closeModal() {
    if (modalEl) { modalEl.remove(); modalEl = null; document.body.classList.remove("ev-modal-open"); }
  }
  function openEventModal(ev, opts) {
    opts = opts || {};
    closeModal();
    var back = mk("div", "ev-modal-back");
    var card = mk("div", "ev-modal");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-labelledby", "evModalTitle");
    card.style.setProperty("--ev", colorOf(ev));
    var head = mk("div", "ev-modal-head");
    head.appendChild(dateBlock(ev));
    var titles = mk("div", "ev-modal-titles");
    var h = mk("h3", "", ev.title); h.id = "evModalTitle";
    titles.append(h, mk("span", "ev-rel", relativeLabel(ev)));
    head.appendChild(titles);
    var close = mk("button", "ev-modal-close", "\u2715"); close.type = "button"; close.setAttribute("aria-label", "Close");
    close.onclick = closeModal;
    head.appendChild(close);
    card.appendChild(head);
    var info = mk("div", "ev-modal-info");
    info.appendChild(mk("div", "ev-line", "\ud83d\udcc5 " + dateText(ev, true)));
    info.appendChild(mk("div", "ev-line", "\ud83d\udd52 " + timeText(ev)));
    if (ev.location) info.appendChild(mk("div", "ev-line", "\ud83d\udccd " + ev.location));
    card.appendChild(info);
    if (ev.description) { var det = mk("p", "ev-modal-details"); linkify(det, ev.description); card.appendChild(det); }
    if (ev.image_path) {
      var fig = mk("a", "ev-modal-photo"); fig.target = "_blank"; fig.rel = "noopener"; fig.title = "Open the full notice";
      var img = document.createElement("img"); img.alt = "Notice for " + ev.title; img.hidden = true; img.setAttribute("data-img-path", ev.image_path);
      fig.appendChild(img); card.appendChild(fig);
      hydrateImages(card).then(function () { if (img.src) fig.href = img.src; });
    }
    var actions = mk("div", "ev-modal-actions");
    if (opts.canEdit) {
      if (opts.onEdit) { var edit = mk("button", "ghost", "Edit"); edit.type = "button"; edit.onclick = function () { closeModal(); opts.onEdit(ev); }; actions.appendChild(edit); }
      else { var editLink = mk("a", "btn ghost", "Edit on the calendar page"); editLink.href = "events.html#edit-" + ev.id; actions.appendChild(editLink); }
      if (opts.onDelete) { var del = mk("button", "danger", "Delete"); del.type = "button"; del.onclick = function () { opts.onDelete(ev); }; actions.appendChild(del); }
    }
    var done = mk("button", "", "Close"); done.type = "button"; done.onclick = closeModal; actions.appendChild(done);
    card.appendChild(actions);
    back.appendChild(card);
    back.addEventListener("click", function (e) { if (e.target === back) closeModal(); });
    document.body.appendChild(back);
    document.body.classList.add("ev-modal-open");
    modalEl = back;
    done.focus();
  }
  typeof document !== "undefined" && document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modalEl) closeModal(); });

  /** A month grid. opts: {year, month(1-12), events, selected, today, onSelect(iso), onOpen(ev), big} */
  function buildMonth(opts) {
    var wrap = mk("div", "cal-grid" + (opts.big ? " big" : ""));
    var head = mk("div", "cal-dow");
    DOW.forEach(function (d) { head.appendChild(mk("span", "", d)); });
    wrap.appendChild(head);
    var body = mk("div", "cal-days");
    var first = isoOf(opts.year, opts.month, 1);
    var offset = dow(first);
    for (var i = 0; i < 42; i++) {
      var iso = addDays(first, i - offset);
      var p = parseIso(iso);
      var evs = eventsOn(opts.events || [], iso);
      var cell = mk("div", "cal-cell" + (p.m !== opts.month ? " other" : "") + (iso === opts.today ? " today" : "") + (iso === opts.selected ? " selected" : "") + (evs.length ? " has" : ""));
      var btn = mk("button", "cal-day");
      btn.type = "button";
      btn.setAttribute("aria-label", fmtDate(iso, { month: "long", day: "numeric", year: "numeric" }) + (evs.length ? ", " + evs.length + (evs.length === 1 ? " event" : " events") : ""));
      btn.setAttribute("aria-pressed", iso === opts.selected ? "true" : "false");
      btn.appendChild(mk("span", "cal-num", String(p.d)));
      if (opts.big) {
        var chips = mk("span", "cal-chips");
        evs.slice(0, 3).forEach(function (ev) { var c = mk("span", "cal-chip", (ev.start_time ? fmtTime(ev.start_time).replace(":00 ", " ").replace(" ", "").toLowerCase() + " " : "") + ev.title); c.style.setProperty("--ev", colorOf(ev)); chips.appendChild(c); });
        if (evs.length > 3) chips.appendChild(mk("span", "cal-more", "+" + (evs.length - 3) + " more"));
        btn.appendChild(chips);
      }
      var dots = mk("span", "cal-dots");
      evs.slice(0, 3).forEach(function (ev) { var dot = mk("i", "cal-dot"); dot.style.background = colorOf(ev); dots.appendChild(dot); });
      btn.appendChild(dots);
      (function (isoDay) { btn.onclick = function () { if (opts.onSelect) opts.onSelect(isoDay); }; })(iso);
      cell.appendChild(btn);
      body.appendChild(cell);
    }
    wrap.appendChild(body);
    return wrap;
  }
  function shiftMonth(st, delta) {
    var m = st.m + delta, y = st.y;
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    st.m = m; st.y = y;
  }

  // ------------------------------------------------------------------ top-bar popup
  function attachBar(btn, ctx) {
    var staff = !!(ctx && ctx.isAdmin);
    var panel = mk("div", "cal-pop"); panel.hidden = true;
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Calendar");
    document.body.appendChild(panel);
    var now = nowParts();
    var st = { y: now.y, m: now.m, sel: now.iso };
    var badge = btn.querySelector(".bar-clock-badge");

    function position() {
      var r = btn.getBoundingClientRect();
      var vw = document.documentElement.clientWidth;
      var w = Math.min(400, vw - 16);
      panel.style.width = w + "px";
      var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
      panel.style.left = (left + window.scrollX) + "px";
      var bar = btn.closest ? btn.closest(".bar") : null;
      var bottom = bar ? bar.getBoundingClientRect().bottom : r.bottom; // open below the whole bar, not over the nav
      panel.style.top = (bottom + window.scrollY + 10) + "px";
    }
    function updateBadge() {
      if (!badge) return;
      var n = eventsOn(state.events || [], todayIso()).length;
      badge.textContent = n ? String(n) : "";
      badge.hidden = !n;
      btn.title = n ? n + (n === 1 ? " event today" : " events today") + " \u2013 open the calendar" : "Open the calendar";
    }
    function render() {
      var events = state.events || [];
      var today = todayIso();
      panel.replaceChildren();
      var head = mk("div", "cal-pop-head");
      var prev = mk("button", "cal-nav", "\u2039"); prev.type = "button"; prev.setAttribute("aria-label", "Previous month");
      var next = mk("button", "cal-nav", "\u203a"); next.type = "button"; next.setAttribute("aria-label", "Next month");
      var title = mk("strong", "cal-title", MONTHS[st.m - 1] + " " + st.y);
      var todayBtn = mk("button", "cal-today-btn", "Today"); todayBtn.type = "button";
      prev.onclick = function () { shiftMonth(st, -1); render(); };
      next.onclick = function () { shiftMonth(st, 1); render(); };
      todayBtn.onclick = function () { var n = nowParts(); st.y = n.y; st.m = n.m; st.sel = n.iso; render(); };
      head.append(prev, title, next, todayBtn);
      panel.appendChild(head);
      panel.appendChild(buildMonth({ year: st.y, month: st.m, events: events, selected: st.sel, today: today, onSelect: function (iso) { st.sel = iso; var p = parseIso(iso); st.y = p.y; st.m = p.m; render(); } }));
      var day = mk("div", "cal-pop-day");
      var evs = eventsOn(events, st.sel);
      day.appendChild(mk("h4", "", fmtDate(st.sel, { weekday: "long", month: "short", day: "numeric" }) + (st.sel === today ? " \u00b7 Today" : "")));
      if (evs.length) {
        var list = mk("ul", "cal-pop-list");
        evs.forEach(function (ev) {
          var li = mk("li");
          var b = mk("button", "cal-pop-item"); b.type = "button"; b.style.setProperty("--ev", colorOf(ev));
          b.append(mk("span", "cal-pop-time", timeText(ev)), mk("strong", "", ev.title));
          if (ev.location) b.appendChild(mk("span", "cal-pop-place", "\ud83d\udccd " + ev.location));
          b.onclick = function () { openEventModal(ev, { canEdit: staff }); };
          li.appendChild(b); list.appendChild(li);
        });
        day.appendChild(list);
      } else {
        day.appendChild(mk("p", "hint", setupMissing() ? (staff ? "The calendar isn't set up yet. Run migration_school_events.sql in Supabase." : "No events yet.") : "No events this day."));
      }
      panel.appendChild(day);
      var foot = mk("div", "cal-pop-foot");
      var full = mk("a", "", "Open full calendar"); full.href = "events.html";
      foot.appendChild(full);
      if (staff) { var add = mk("a", "cal-add", "+ Add event"); add.href = "events.html#add"; foot.appendChild(add); }
      panel.appendChild(foot);
    }
    function set(open) {
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { var n = nowParts(); st.y = n.y; st.m = n.m; st.sel = n.iso; position(); render(); loadEvents().then(function () { updateBadge(); if (!panel.hidden) render(); }); }
    }
    btn.setAttribute("aria-haspopup", "dialog");
    btn.setAttribute("aria-expanded", "false");
    btn.onclick = function (e) { e.stopPropagation(); set(panel.hidden); };
    document.addEventListener("click", function (e) {
      if (panel.hidden || document.querySelector(".ev-modal-back")) return;
      // composedPath() is taken when the click happens, so a button that the popup has already redrawn still counts as inside
      var path = e.composedPath ? e.composedPath() : [];
      var inside = path.indexOf(panel) !== -1 || path.indexOf(btn) !== -1 || panel.contains(e.target) || btn.contains(e.target);
      if (!inside) set(false);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden && !modalEl) { set(false); btn.focus(); } });
    window.addEventListener("resize", function () { if (!panel.hidden) position(); });
    loadEvents().then(updateBadge);
  }

  // ------------------------------------------------------------------ Notes-page strip
  async function renderUpcoming(container, opts) {
    opts = opts || {};
    var staff = !!opts.canEdit;
    container.replaceChildren();
    var events = await loadEvents();
    var today = todayIso();
    var list = events.filter(function (ev) { return lastDay(ev) >= today; }).slice(0, opts.limit || 6);
    if (!list.length && !(staff && setupMissing())) { container.hidden = true; return; }
    container.hidden = false;
    var head = mk("div", "ev-strip-head");
    head.appendChild(mk("h3", "", "\ud83d\udcc5 Upcoming events"));
    var links = mk("div", "ev-strip-links");
    var all = mk("a", "", "Full calendar \u2192"); all.href = "events.html"; links.appendChild(all);
    if (staff) { var add = mk("a", "ev-add", "+ Add event"); add.href = "events.html#add"; links.appendChild(add); }
    head.appendChild(links);
    container.appendChild(head);
    if (!list.length) { container.appendChild(mk("p", "hint", "The calendar isn't set up yet. Run migration_school_events.sql in Supabase.")); return; }
    var row = mk("div", "ev-strip-row");
    list.forEach(function (ev) { row.appendChild(eventCard(ev, { onOpen: function (e) { openEventModal(e, { canEdit: staff }); } })); });
    container.appendChild(row);
    hydrateImages(container);
  }

  var api = {
    BUCKET: BUCKET, MONTHS: MONTHS, DOW: DOW, LIMITS: LIMITS, TEMPLATE: TEMPLATE,
    nowParts: nowParts, todayIso: todayIso, isoOf: isoOf, parseIso: parseIso, addDays: addDays, dow: dow, daysInMonth: daysInMonth, daysBetween: daysBetween,
    fmtDate: fmtDate, fmtTime: fmtTime, lastDay: lastDay, onDay: onDay, isMultiDay: isMultiDay, timeText: timeText, dateText: dateText, sortEvents: sortEvents, eventsOn: eventsOn, colorOf: colorOf, relativeLabel: relativeLabel,
    parseDateSpec: parseDateSpec, parseTimeSpec: parseTimeSpec, parseEventsText: parseEventsText, eventToText: eventToText,
    loadEvents: loadEvents, invalidate: invalidate, setupMissing: setupMissing, state: state, hydrateImages: hydrateImages,
    eventCard: eventCard, openEventModal: openEventModal, closeModal: closeModal, buildMonth: buildMonth, shiftMonth: shiftMonth, attachBar: attachBar, renderUpcoming: renderUpcoming
  };
  root.PortalisCalendar = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

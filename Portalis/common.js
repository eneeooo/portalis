/* Portalis shared helpers (load after config.js) */
const LABEL = { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" };
const ORDER = ["urgent", "high", "medium", "low"];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function fmtDate(d) { return new Date(d).toLocaleString(); }

async function requireAuth(adminOnly) {
  const { data } = await sb.auth.getSession();
  if (!data.session) { location.href = "index.html"; return null; }
  const { data: prof } = await sb.from("profiles").select("role").eq("id", data.session.user.id).single();
  const role = prof ? prof.role : "user";
  if (adminOnly && role !== "admin") { location.href = "dashboard.html"; return null; }
  return { user: data.session.user, role: role, isAdmin: role === "admin" };
}

function renderBar(ctx, active) {
  const bar = document.getElementById("bar");
  bar.className = "bar";
  bar.innerHTML = "";
  bar.appendChild(el("span", "brand", "Portalis"));
  const nav = el("nav", "nav");
  const links = [["dashboard.html", "Notes", "notes"], ["reviewer.html", "Reviewers", "reviewers"]];
  if (ctx.isAdmin) links.push(["admin.html", "Admin", "admin"], ["manage.html", "Manage reviewers", "manage"]);
  links.forEach(l => {
    const a = el("a", "btn ghost" + (active === l[2] ? " on" : ""), l[1]);
    a.href = l[0];
    nav.appendChild(a);
  });
  bar.appendChild(nav);
  const right = el("div", "right");
  right.appendChild(el("span", "who", ctx.user.email));
  right.appendChild(el("span", "badge", ctx.role));
  const out = el("button", "ghost", "Log out");
  out.onclick = async () => { await sb.auth.signOut(); location.href = "index.html"; };
  right.appendChild(out);
  bar.appendChild(right);
}

/* ---------- note body in the chosen format ---------- */
function renderContent(n) {
  const lines = (n.content || "").split("\n").map(s => s.trim()).filter(Boolean);
  if (n.format === "bullets" || n.format === "numbered") {
    const list = el(n.format === "numbered" ? "ol" : "ul", "fmt-list");
    lines.forEach(t => list.appendChild(el("li", "", t)));
    return list;
  }
  return el("div", "text", n.content);
}

/* ---------- reviewer text: "# Heading", "- bullet", paragraphs ---------- */
function renderRich(text) {
  const box = el("div", "rich");
  let list = null;
  (text || "").replace(/\r/g, "").split("\n").forEach(raw => {
    const line = raw.trim();
    if (!line) { list = null; return; }
    let m;
    if ((m = line.match(/^#{1,3}\s+(.+)$/))) { list = null; box.appendChild(el("h3", "", m[1])); return; }
    if ((m = line.match(/^[-*\u2022]\s+(.+)$/))) {
      if (!list) { list = el("ul", ""); box.appendChild(list); }
      list.appendChild(el("li", "", m[1]));
      return;
    }
    list = null;
    box.appendChild(el("p", "", line));
  });
  return box;
}

/* ---------- sticky note card ----------
   o: { canEdit, showStatus, onPriority(n,p), onSubs(n,arr), actions:[buttons], footer(card) } */
function noteCard(n, o) {
  o = o || {};
  const c = el("div", "note p-" + n.priority);

  const top = el("div", "topline");
  const tags = el("div", "tags");
  tags.appendChild(el("span", "tag", LABEL[n.priority]));
  if (o.showStatus && n.status !== "approved") {
    tags.appendChild(el("span", "tag status " + n.status, n.status === "pending" ? "Awaiting review" : "Rejected"));
  }
  top.appendChild(tags);
  if (o.canEdit && o.onPriority) {
    const dots = el("div", "dots");
    ["low", "medium", "high", "urgent"].forEach(p => {
      const d = el("button", "dot p-" + p + (p === n.priority ? " on" : ""));
      d.title = "Set to " + LABEL[p];
      d.onclick = () => o.onPriority(n, p);
      dots.appendChild(d);
    });
    top.appendChild(dots);
  }
  c.appendChild(top);

  c.appendChild(el("h3", "ntitle", n.title || "Untitled"));
  if (o.showStatus && n.status === "rejected" && n.reject_reason) {
    c.appendChild(el("div", "reason", "Admin note: " + n.reject_reason));
  }
  if (n.content) c.appendChild(renderContent(n));

  const subs = Array.isArray(n.subnotes) ? n.subnotes : [];
  if (subs.length) {
    const done = subs.filter(s => s.done).length;
    c.appendChild(el("div", "progress", done + "/" + subs.length + " done"));
    const ul = el("ul", "subs");
    subs.forEach((s, i) => {
      const li = el("li", s.done ? "done" : "");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!s.done;
      cb.disabled = !o.canEdit;
      if (o.canEdit && o.onSubs) cb.onchange = () => o.onSubs(n, subs.map((x, j) => j === i ? { text: x.text, done: cb.checked } : x));
      li.append(cb, el("span", "", s.text));
      if (o.canEdit && o.onSubs) {
        const x = el("button", "x", "\u00d7");
        x.title = "Remove subnote";
        x.onclick = () => o.onSubs(n, subs.filter((_, j) => j !== i));
        li.appendChild(x);
      }
      ul.appendChild(li);
    });
    c.appendChild(ul);
  }
  if (o.canEdit && o.onSubs) {
    const row = el("div", "addsub");
    const inp = el("input", "mini");
    inp.placeholder = "Add subnote";
    const plus = el("button", "plus", "+");
    const add = () => { const t = inp.value.trim(); if (t) o.onSubs(n, subs.concat([{ text: t, done: false }])); };
    plus.onclick = add;
    inp.addEventListener("keydown", e => { if (e.key === "Enter") add(); });
    row.append(inp, plus);
    c.appendChild(row);
  }

  c.appendChild(el("small", "", "by " + (n.author_name || "user") + " \u00b7 " + new Date(n.created_at).toLocaleDateString()));
  if (o.actions && o.actions.length) {
    const row = el("div", "actions");
    o.actions.forEach(b => row.appendChild(b));
    c.appendChild(row);
  }
  if (o.footer) o.footer(c);
  return c;
}

/* ---------- quiz tools ---------- */
function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = b[i]; b[i] = b[j]; b[j] = t;
  }
  return b;
}

/* Bulk format (blank line between questions):
     Q: question text
     A) option
     B) option
     Answer: B          <- letter for multiple choice, or the text for identification   */
function parseBulk(text) {
  const blocks = (text || "").replace(/\r/g, "").split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const items = [], errors = [];
  blocks.forEach((block, bi) => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    let prompt = "", answer = "";
    const opts = [];
    lines.forEach(line => {
      let m;
      if ((m = line.match(/^answer\s*[:=\-]\s*(.+)$/i))) { answer = m[1].trim(); return; }
      if (prompt && (m = line.match(/^([A-Fa-f])\s*[\).:]\s*(.+)$/))) { opts.push({ letter: m[1].toUpperCase(), text: m[2].trim() }); return; }
      if (opts.length === 0) {
        const t = line.replace(/^(?:q(?:uestion)?\s*\d*|\d+)\s*[:.)]\s*/i, "");
        prompt = prompt ? prompt + " " + t : t;
      }
    });
    const tag = "Question " + (bi + 1) + ": ";
    if (!prompt) { errors.push(tag + "no question text"); return; }
    if (!answer) { errors.push(tag + "missing 'Answer:' line"); return; }
    if (opts.length === 0) { items.push({ qtype: "identification", prompt: prompt, options: [], answer: answer }); return; }
    if (opts.length < 2) { errors.push(tag + "needs at least 2 options"); return; }
    let correct = null;
    const byLetter = opts.find(o => o.letter === answer.toUpperCase());
    if (byLetter) correct = byLetter.text;
    else { const byText = opts.find(o => o.text.toLowerCase() === answer.toLowerCase()); if (byText) correct = byText.text; }
    if (correct === null) { errors.push(tag + "the answer '" + answer + "' does not match any option"); return; }
    items.push({ qtype: "mcq", prompt: prompt, options: opts.map(o => o.text), answer: correct });
  });
  return { items: items, errors: errors };
}

/* Reads "Term - definition" or "Term: definition" lines from the reviewer text */
function extractPairs(text) {
  const pairs = [];
  (text || "").replace(/\r/g, "").split("\n").forEach(raw => {
    if (/^\s*#/.test(raw)) return;
    const line = raw.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s*/, "").trim();
    const m = line.match(/^(.{2,60}?)\s*(?::|\s[-\u2013\u2014]\s)\s*(.{5,})$/);
    if (m) pairs.push({ term: m[1].trim(), def: m[2].trim() });
  });
  return pairs;
}

/* style: "mcq" (pick the term) or "identification" (type the term) */
function generateQuestions(text, style, limit) {
  const all = extractPairs(text);
  const chosen = shuffle(all).slice(0, Math.max(1, limit || 10));
  const out = [];
  chosen.forEach(p => {
    if (style === "identification") {
      out.push({ qtype: "identification", prompt: "Identify the term: " + p.def, options: [], answer: p.term });
      return;
    }
    const seen = {};
    seen[p.term.toLowerCase()] = true;
    const distractors = [];
    shuffle(all).forEach(x => {
      const k = x.term.toLowerCase();
      if (!seen[k] && distractors.length < 3) { seen[k] = true; distractors.push(x.term); }
    });
    if (distractors.length < 1) return;
    out.push({ qtype: "mcq", prompt: "Which term matches this description? " + p.def, options: shuffle([p.term].concat(distractors)), answer: p.term });
  });
  return out;
}

/* Portalis shared helpers (load after config.js) */
const LABEL = { urgent: "Urgent", high: "High", medium: "Medium", neutral: "Neutral", low: "Low" };
const ORDER = ["urgent", "high", "medium", "neutral", "low"];
const CLASS_TITLES = {
  "26-22-059": "Treasurer",
  "26-22-060": "Vice President",
  "26-22-061": "PRO",
  "26-22-064": "Auditor",
  "26-22-066": "President",
  "26-22-075": "Secretary"
};

function profileTitle(profile) {
  const classTitle = CLASS_TITLES[profile.student_number];
  if (classTitle) return classTitle;
  return profile.role === "user"
    ? "Student"
    : profile.role.charAt(0).toUpperCase() + profile.role.slice(1);
}

function staffTitle(profile) {
  return profile && (profile.role === "admin" || profile.role === "officer")
    ? profileTitle(profile)
    : "";
}

async function loadStaffAuthorTitles(authorIds) {
  const ids = [...new Set((authorIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const { data, error } = await sb.rpc("staff_author_titles", {
    p_author_ids: ids
  });
  if (error) throw error;
  return Object.fromEntries((data || []).map(row => [row.author_id, row.title]));
}

function staffAuthorName(name, title) {
  const identity = el("span", "author-identity");
  identity.appendChild(el("span", "author-name", name || "user"));
  if (title) identity.appendChild(el("span", "staff-title-card", title));
  return identity;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function fmtDate(d) { return new Date(d).toLocaleString(); }

/* Reads the real reason out of a supabase-js Edge Function error
   (our own {error}, or the gateway's {code,message} / plain text). */
async function functionErrorMessage(error, fallback) {
  if (!error) return fallback || "Unknown error.";
  if (error.name === "FunctionsFetchError") {
    return "the function is not reachable (not deployed in this project, or blocked by CORS).";
  }
  if (error.context instanceof Response) {
    const res = error.context.clone();
    const status = res.status;
    let text = "";
    try { text = await res.text(); } catch (_) {}
    try {
      const body = JSON.parse(text);
      const reason = body.error || body.message || body.msg || body.code;
      if (reason) return reason + " (HTTP " + status + ")";
    } catch (_) {}
    if (text) return text.slice(0, 200) + " (HTTP " + status + ")";
    return "HTTP " + status + " with no message";
  }
  return error.message || fallback || "Unknown error.";
}

/* ---------- session validity: sign out when the account is removed ---------- */
function isAccountGone(error) {
  if (!error) return false;
  const status = error.status;
  const code = String(error.code || "");
  const text = String(error.message || "");
  if (error.name === "AuthRetryableFetchError" || /failed to fetch|network/i.test(text)) return false; // offline != removed
  return status === 401 || status === 403 || status === 404 ||
    /user_not_found|bad_jwt|session_not_found|session_expired|refresh_token/i.test(code) ||
    /does not exist|not found|invalid jwt|invalid refresh token|refresh token/i.test(text);
}

async function forceSignOut(reason) {
  try { await sb.auth.signOut({ scope: "local" }); } catch (_) { /* local cleanup below */ }
  try { sessionStorage.setItem("portalis_logout_reason", reason || "You have been signed out."); } catch (_) {}
  location.href = "index.html";
}

let sessionWatchStarted = false;
function startSessionWatch() {
  if (sessionWatchStarted) return;
  sessionWatchStarted = true;
  let checking = false;
  const check = async () => {
    if (checking || document.hidden) return;
    checking = true;
    try {
      const { data, error } = await sb.auth.getUser(); // asks the server, not just the local token
      if (error ? isAccountGone(error) : !data.user) {
        await forceSignOut("Your account was removed or your session expired. Please log in again.");
      }
    } finally { checking = false; }
  };
  sb.auth.onAuthStateChange(event => {
    if (event === "SIGNED_OUT") {
      try { sessionStorage.setItem("portalis_logout_reason", "You have been signed out."); } catch (_) {}
      location.href = "index.html";
    }
  });
  setInterval(check, 60000);
  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);
}

async function requireAuth(adminOnly) {
  const { data, error } = await sb.auth.getSession();
  if (error) {
    if (isAccountGone(error)) { await forceSignOut("Your session expired. Please log in again."); return null; }
    document.body.insertAdjacentText("afterbegin", error.message); return null;
  }
  if (!data.session) { location.href = "index.html"; return null; }

  // getSession() only reads the local token, so confirm the account still exists on the server.
  const { data: userData, error: userError } = await sb.auth.getUser();
  if (userError) {
    if (isAccountGone(userError)) { await forceSignOut("Your account was removed. Please contact an admin."); return null; }
    alert("Cannot reach Supabase: " + userError.message);
    return null;
  }
  if (!userData.user) { await forceSignOut("Your account was removed. Please contact an admin."); return null; }

  const { data: prof, error: profileError } = await sb.from("profiles")
    .select("role,full_name,student_number,avatar_url")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) { alert("Unable to load your profile: " + profileError.message); return null; }
  if (!prof) {
    await forceSignOut("Your profile no longer exists. Sign up again or contact an admin.");
    return null;
  }
  const role = prof.role;
  const isAdmin = role === "admin" || role === "officer";
  if (adminOnly && role !== "admin") { location.href = "dashboard.html"; return null; }
  if (!isAdmin) {
    const { data: isMember, error: membershipError } = await sb.rpc("is_class_12_member");
    if (membershipError) {
      alert("Unable to verify class access: " + membershipError.message);
      return null;
    }
    if (!isMember) {
      await forceSignOut("This account is not registered as a member of class 12.");
      return null;
    }
  }
  startSessionWatch();
  return { user: userData.user, profile: prof, role: role, isAdmin };
}

function renderBar(ctx, active) {
  const bar = document.getElementById("bar");
  bar.className = "bar";
  bar.innerHTML = "";
  const identity = el("div", "bar-profile");
  if (ctx.profile.avatar_url) {
    const avatar = el("img", "bar-avatar");
    avatar.src = ctx.profile.avatar_url;
    avatar.alt = "";
    identity.appendChild(avatar);
  } else {
    const initials = (ctx.profile.full_name || ctx.profile.student_number || "Student")
      .split(/\s+/)
      .map(part => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase();
    identity.appendChild(el("span", "bar-avatar bar-avatar-fallback", initials));
  }
  identity.append(
    el("span", "bar-name", ctx.profile.full_name || "Student"),
    el("span", "bar-student-number", ctx.profile.student_number || "Student number not set")
  );
  bar.appendChild(identity);
  const nav = el("nav", "nav");
  const links = [["dashboard.html", "Notes", "notes"], ["reviewer.html", "Reviewers", "reviewers"], ["funds.html", "Class funds", "funds"], ["confessions.html", "Confessions", "confessions"], ["profile.html", "Profile", "profile"]];
  if (ctx.role === "admin") links.push(["admin.html", "Admin", "admin"]);
  if (ctx.role === "officer") links.push(["officer.html", "Officer", "officer"]);
  if (ctx.isAdmin) links.push(["manage.html", "Manage reviewers", "manage"]);
  links.forEach(l => {
    const a = el("a", "nav-link" + (active === l[2] ? " on" : ""), l[1]);
    if (active === l[2]) a.setAttribute("aria-current", "page");
    a.href = l[0];
    nav.appendChild(a);
  });
  bar.appendChild(nav);
  const right = el("div", "right profile-controls");
  right.appendChild(el("span", "badge profile-role", profileTitle(ctx.profile)));
  const out = el("button", "ghost", "Log out");
  out.onclick = () => confirmLogout();
  right.appendChild(out);
  bar.appendChild(right);

  document.querySelectorAll(".suggestion-circle").forEach(button => button.remove());
  const suggestion = el("button", "suggestion-circle", "?");
  suggestion.type = "button";
  suggestion.title = "Send a suggestion to the admins";
  suggestion.setAttribute("aria-label", "Send a suggestion to the admins");
  suggestion.onclick = () => openSuggestion(ctx);
  document.body.appendChild(suggestion);
}

function renderMath(box) {
  if (window.renderMathInElement) {
    window.renderMathInElement(box, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false }
      ],
      throwOnError: false
    });
  }
  return box;
}

function confirmLogout() {
  const dialog = el("div", "modal-backdrop");
  const box = el("div", "modal-card");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.append(el("div", "sad-duck", "\u{1F986}\u{1F622}"), el("h2", "", "You'll leave?"));
  box.appendChild(el("p", "", "Are you sure you want to log out?"));
  const stay = el("button", "ghost", "Stay");
  const leave = el("button", "", "Log out");
  stay.onclick = () => dialog.remove();
  leave.onclick = async () => {
    leave.disabled = true;
    const { error } = await sb.auth.signOut();
    if (error) { leave.disabled = false; alert(error.message); return; }
    location.href = "index.html";
  };
  box.append(stay, document.createTextNode(" "), leave);
  dialog.appendChild(box);
  dialog.onclick = e => { if (e.target === dialog) dialog.remove(); };
  document.body.appendChild(dialog);
  stay.focus();
}

function openSuggestion(ctx) {
  const dialog = el("div", "modal-backdrop");
  const box = el("form", "modal-card");
  box.appendChild(el("h2", "", "Send a suggestion"));
  const label = el("label", "", "Your message (admins will see your student number)");
  const input = document.createElement("textarea");
  input.maxLength = 1000;
  input.required = true;
  input.placeholder = "What could make Portalis better?";
  const status = el("p", "msg");
  const close = el("button", "ghost", "Cancel");
  close.type = "button";
  close.onclick = () => dialog.remove();
  const send = el("button", "", "Send");
  send.type = "submit";
  box.append(label, input, status, close, document.createTextNode(" "), send);
  box.onsubmit = async event => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content) { status.className = "msg err"; status.textContent = "Write a suggestion first."; return; }
    send.disabled = true;
    const { error } = await sb.from("suggestions").insert({ content, user_id: ctx.user.id });
    if (error) { status.className = "msg err"; status.textContent = error.message; send.disabled = false; return; }
    status.className = "msg ok"; status.textContent = "Suggestion sent to the admins.";
    input.disabled = true;
    send.remove();
  };
  dialog.appendChild(box);
  dialog.onclick = e => { if (e.target === dialog) dialog.remove(); };
  document.body.appendChild(dialog);
  input.focus();
}

/* ---------- note body in the chosen format ---------- */
function renderContent(n) {
  const lines = (n.content || "").split("\n").map(s => s.trim()).filter(Boolean);
  if (n.format === "bullets" || n.format === "numbered") {
    const list = el(n.format === "numbered" ? "ol" : "ul", "fmt-list");
    lines.forEach(t => list.appendChild(el("li", "", t)));
    return renderMath(list);
  }
  return renderMath(el("div", "text", n.content));
}

/* ---------- reviewer text: "# Heading", "- bullet", paragraphs ---------- */
function renderRich(text) {
  const box = el("div", "rich");
  let list = null, definitions = null;
  const closeList = () => { list = null; };
  const closeDefinitions = () => { definitions = null; };
  (text || "").replace(/\r/g, "").split("\n").forEach(raw => {
    const line = raw.trim();
    if (!line) { closeList(); return; }
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.+)$/))) {
      closeList(); closeDefinitions();
      const level = Math.min(m[1].length + 1, 4);
      const heading = el("h" + level);
      if (/^examples?(?:\s+\d+)?$/i.test(m[2].trim())) {
        heading.classList.add("rich-example-heading");
        heading.appendChild(el("span", "rich-example-badge", "Example"));
        if (/^examples? \d+$/i.test(m[2].trim())) {
          heading.appendChild(el("span", "rich-example-number", m[2].match(/\d+/)[0]));
        }
      } else {
        appendRichText(heading, m[2]);
      }
      box.appendChild(heading);
      return;
    }
    if ((m = line.match(/^[-*\u2022]\s+(.+)$/))) {
      closeDefinitions();
      if (!list || list.tagName !== "UL") { list = el("ul", "rich-list"); box.appendChild(list); }
      const item = el("li");
      appendRichText(item, m[1]);
      list.appendChild(item);
      return;
    }
    if ((m = line.match(/^\d+[.)]\s+(.+)$/))) {
      closeDefinitions();
      if (!list || list.tagName !== "OL") { list = el("ol", "rich-list"); box.appendChild(list); }
      const item = el("li");
      appendRichText(item, m[1]);
      list.appendChild(item);
      return;
    }
    closeList();
    if ((m = line.match(/^examples?(?:\s+(\d+))?\s*:\s*(.+)$/i))) {
      closeDefinitions();
      const example = el("aside", "rich-example");
      example.appendChild(el("span", "rich-example-badge", "Example" + (m[1] ? " " + m[1] : "")));
      const content = el("p", "rich-example-content");
      appendRichText(content, m[2]);
      example.appendChild(content);
      box.appendChild(example);
      return;
    }
    if ((m = line.match(/^(.{2,60}?)\s*(?::|\s[-\u2013\u2014]\s)\s*(.{5,})$/))) {
      if (!definitions) {
        definitions = el("div", "rich-grid");
        box.appendChild(definitions);
      }
      const item = el("article", "rich-definition");
      if (/^examples?(?:\s+\d+)?$/i.test(m[1].trim())) {
        item.classList.add("rich-definition-example");
        item.appendChild(el("span", "rich-example-badge", m[1].trim()));
      }
      const term = el("h3", "rich-term");
      if (item.classList.contains("rich-definition-example")) term.textContent = "";
      else appendRichText(term, m[1].trim());
      const definition = el("p", "rich-description");
      appendRichText(definition, m[2].trim());
      item.append(term, definition);
      definitions.appendChild(item);
      return;
    }
    closeDefinitions();
    if ((m = line.match(/^>\s*(.+)$/))) {
      const callout = el("blockquote", "rich-callout");
      appendRichText(callout, m[1]);
      box.appendChild(callout);
      return;
    }
    const paragraph = el("p");
    appendRichText(paragraph, line);
    box.appendChild(paragraph);
  });
  return renderMath(box);
}

function appendRichText(parent, text) {
  const pattern = /\*\*(.+?)\*\*|==(.+?)==/g;
  let last = 0, match;
  while ((match = pattern.exec(text))) {
    parent.appendChild(document.createTextNode(text.slice(last, match.index)));
    const highlighted = el(match[1] ? "strong" : "mark", match[1] ? "rich-emphasis" : "rich-highlight", match[1] || match[2]);
    parent.appendChild(highlighted);
    last = pattern.lastIndex;
  }
  parent.appendChild(document.createTextNode(text.slice(last)));
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
  if (o.canPrioritize && o.onPriority) {
    const dots = el("div", "dots");
    ["low", "neutral", "medium", "high", "urgent"].forEach(p => {
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

  const author = el("small", "note-author");
  author.append(
    document.createTextNode("by "),
    staffAuthorName(n.author_name, n.staff_title),
    document.createTextNode(" \u00b7 " + new Date(n.created_at).toLocaleDateString())
  );
  c.appendChild(author);
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

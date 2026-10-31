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

const nickCache = {};
async function loadNicknames(ids) {
  const wanted = [...new Set((ids || []).filter(id => id && !(id in nickCache)))];
  if (!wanted.length) return;
  wanted.forEach(id => { nickCache[id] = ""; });
  try {
    const { data, error } = await sb.rpc("get_member_nicknames", { p_ids: wanted });
    if (!error) (data || []).forEach(row => { nickCache[row.user_id] = (row.nickname || "").toLowerCase(); });
  } catch (_) { /* nicknames are optional */ }
}

async function loadStaffAuthorTitles(authorIds) {
  const ids = [...new Set((authorIds || []).filter(Boolean))];
  if (!ids.length) return {};
  await loadNicknames(ids);
  const { data, error } = await sb.rpc("staff_author_titles", {
    p_author_ids: ids
  });
  if (error) throw error;
  return Object.fromEntries((data || []).map(row => [row.author_id, row.title]));
}

/* Hover (or tap) a name to get a small "See profile" menu. */
const profilePop = { node: null, timer: 0 };
function hideProfilePop() {
  clearTimeout(profilePop.timer);
  if (profilePop.node) profilePop.node.hidden = true;
}
function hideProfilePopSoon() {
  clearTimeout(profilePop.timer);
  profilePop.timer = setTimeout(hideProfilePop, 220);
}
function showProfilePop(anchor, userId, name) {
  clearTimeout(profilePop.timer);
  if (!profilePop.node) {
    const node = el("div", "profile-pop");
    node.setAttribute("role", "menu");
    node.onmouseenter = () => clearTimeout(profilePop.timer);
    node.onmouseleave = hideProfilePopSoon;
    document.body.appendChild(node);
    profilePop.node = node;
    document.addEventListener("keydown", event => { if (event.key === "Escape") hideProfilePop(); });
    document.addEventListener("click", event => {
      if (!profilePop.node.contains(event.target) && !event.target.closest(".author-name.has-profile")) hideProfilePop();
    });
    window.addEventListener("scroll", hideProfilePop, { passive: true });
  }
  const node = profilePop.node;
  node.replaceChildren();
  node.appendChild(el("span", "profile-pop-name", name || "Classmate"));
  const see = el("button", "", "\ud83d\udc64 See profile");
  see.type = "button";
  see.setAttribute("role", "menuitem");
  see.onclick = () => { hideProfilePop(); openMemberProfile(userId); };
  node.appendChild(see);
  node.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = node.offsetWidth || 200;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  node.style.left = (left + window.scrollX) + "px";
  node.style.top = (rect.bottom + window.scrollY + 4) + "px";
}

function staffAuthorName(name, title, userId) {
  const identity = el("span", "author-identity");
  let nameNode;
  if (userId) {
    nameNode = el("button", "author-name has-profile", name || "user");
    nameNode.type = "button";
    nameNode.title = "See profile";
    nameNode.setAttribute("aria-haspopup", "menu");
    nameNode.onmouseenter = () => showProfilePop(nameNode, userId, name);
    nameNode.onmouseleave = hideProfilePopSoon;
    nameNode.onfocus = () => showProfilePop(nameNode, userId, name);
    nameNode.onclick = event => { event.stopPropagation(); showProfilePop(nameNode, userId, name); };
  } else {
    nameNode = el("span", "author-name", name || "user");
  }
  identity.appendChild(nameNode);
  const nick = userId && nickCache[userId];
  if (nick) identity.appendChild(el("span", "author-nick", "(" + nick + ")"));
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

/* Phones: the top bar shrinks to the profile + a Menu button; every tab lives inside the menu. */
function installBarMenuStyles() {
  if (document.getElementById("barMenuStyle")) return;
  const style = document.createElement("style");
  style.id = "barMenuStyle";
  style.textContent =
    ".bar-who { display: contents; }" +
    "button.menu-toggle { display: none; }" +
    "@media (max-width: 700px) {" +
    "  .bar { justify-content: space-between; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 24px; }" +
    "  .bar-profile { flex: 1; min-width: 0; flex-direction: row; text-align: left; gap: 10px; }" +
    "  .bar-profile .bar-avatar { width: 42px; height: 42px; flex: none; font-size: 17px; }" +
    "  .bar-who { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; gap: 2px; }" +
    "  .bar-profile .bar-name { max-width: 100%; font-size: 17px; }" +
    "  .bar-profile .bar-student-number { font-size: 13px; }" +
    "  button.menu-toggle { display: inline-flex; align-items: center; gap: 8px; flex: none; margin: 0; min-height: 42px; padding: 6px 14px; border: 2.5px solid #000; border-radius: 999px; background: #f6b8dc; color: #000; font-size: 17px; font-weight: bold; box-shadow: 2px 2px 0 #000; }" +
    "  button.menu-toggle:hover { background: #fff0f8; }" +
    "  button.menu-toggle:focus-visible { outline: 3px solid #000; outline-offset: 3px; }" +
    "  button.menu-toggle svg { width: 18px; height: 18px; display: block; }" +
    "  .bar .nav, .bar .profile-controls { display: none; }" +
    "  .bar.menu-open .nav { display: flex; flex: 0 0 100%; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 2px dashed #000; }" +
    "  .bar.menu-open .nav-link { justify-content: flex-start; width: 100%; min-height: 44px; padding: 8px 16px; font-size: 18px; border-radius: 14px; }" +
    "  .bar.menu-open .profile-controls { display: flex; flex: 0 0 100%; flex-direction: row; justify-content: space-between; align-items: center; gap: 10px; padding-top: 10px; border-top: 2px dashed #000; }" +
    "}";
  document.head.appendChild(style);
}

function makeMenuToggle(bar, nav) {
  const toggle = el("button", "menu-toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-controls", "barNav");
  const icons = {
    open: '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M2 4.5 H16 M2 9 H16 M2 13.5 H16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>',
    close: '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 3.5 L14.5 14.5 M14.5 3.5 L3.5 14.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>'
  };
  const set = open => {
    bar.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.innerHTML = (open ? icons.close : icons.open) + "<span>" + (open ? "Close" : "Menu") + "</span>";
  };
  set(false);
  toggle.onclick = event => { event.stopPropagation(); set(!bar.classList.contains("menu-open")); };
  document.addEventListener("click", event => {
    if (bar.classList.contains("menu-open") && !bar.contains(event.target)) set(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && bar.classList.contains("menu-open")) { set(false); toggle.focus(); }
  });
  return toggle;
}

function renderBar(ctx, active) {
  const bar = document.getElementById("bar");
  installBarMenuStyles();
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
  const who = el("span", "bar-who");
  who.append(
    el("span", "bar-name", ctx.profile.full_name || "Student"),
    el("span", "bar-student-number", ctx.profile.student_number || "Student number not set")
  );
  identity.appendChild(who);
  bar.appendChild(identity);
  loadNicknames([ctx.user.id]).then(() => {
    const nick = nickCache[ctx.user.id];
    const nameSpan = identity.querySelector(".bar-name");
    if (nick && nameSpan) nameSpan.append(" ", el("span", "bar-nick", "(" + nick + ")"));
  });
  const nav = el("nav", "nav");
  nav.id = "barNav";
  bar.appendChild(makeMenuToggle(bar, nav));
  const links = [["dashboard.html", "Notes", "notes"], ["reviewer.html", "Reviewers", "reviewers"], ["funds.html", "Class funds", "funds"], ["attendance.html", "Attendance", "attendance"], ["memories.html", "Memories", "memories"], ["confessions.html", "Confessions", "confessions"], ["profile.html", "Profile", "profile"]];
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
  renderOnlineButton(ctx);
  renderFundButton(ctx);
}

/* ---------- outstanding fund balance (bottom-right button, only when something is owed) ---------- */
const fundState = { button: null, panel: null, items: [], total: 0, timer: 0 };

function pesos(amount) {
  return "\u20b1" + Number(amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function refreshFundBalance() {
  const button = fundState.button, panel = fundState.panel;
  if (!button || !button.isConnected) return;
  try {
    const { data: funds, error } = await sb.from("funds").select("id,title").order("id");
    if (error) throw error;
    const items = [];
    for (const fund of funds || []) {
      const { data, error: balanceError } = await sb.rpc("get_my_fund_balance", { p_fund_id: fund.id });
      if (balanceError) continue;
      const row = Array.isArray(data) ? data[0] : data;
      const owed = Number(row && row.outstanding);
      // Paid in full or paid ahead (advance credit): nothing is owed, so nothing is shown.
      if (Number.isFinite(owed) && owed > 0) items.push({ id: fund.id, title: fund.title, owed });
    }
    fundState.items = items;
    fundState.total = items.reduce((sum, item) => sum + item.owed, 0);
  } catch (_) {
    fundState.items = [];
    fundState.total = 0;
  }
  const owes = fundState.total > 0;
  button.hidden = !owes;
  document.body.classList.toggle("has-fund-btn", owes);
  if (!owes) { panel.hidden = true; button.setAttribute("aria-expanded", "false"); return; }
  button.querySelector(".fund-amount").textContent = pesos(fundState.total);
  if (!panel.hidden) paintFundPanel();
}

function paintFundPanel() {
  const panel = fundState.panel;
  panel.replaceChildren();
  const head = el("div", "online-head");
  const titleBox = el("div");
  titleBox.append(el("h3", "online-title", "Fund balance"), el("p", "online-sub", "You still need to pay"));
  const close = el("button", "online-close", "\u00d7");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.onclick = () => { panel.hidden = true; fundState.button.setAttribute("aria-expanded", "false"); };
  head.append(titleBox, close);
  panel.appendChild(head);
  panel.appendChild(el("p", "fund-total", pesos(fundState.total)));
  const list = el("ul", "fund-list");
  fundState.items.forEach(item => {
    const row = el("li");
    row.append(el("span", "", item.title), el("strong", "", pesos(item.owed)));
    list.appendChild(row);
  });
  panel.appendChild(list);
  const link = el("a", "btn fund-link", "View your fund balance");
  link.href = "funds.html";
  panel.appendChild(link);
}

function renderFundButton(ctx) {
  document.querySelectorAll(".fund-circle, .fund-panel").forEach(node => node.remove());
  const button = el("button", "fund-circle");
  button.type = "button";
  button.hidden = true;
  button.title = "Outstanding fund balance";
  button.setAttribute("aria-label", "Outstanding fund balance");
  button.setAttribute("aria-expanded", "false");
  button.appendChild(el("span", "fund-sign", "\u20b1"));
  button.appendChild(el("span", "fund-amount", ""));
  document.body.appendChild(button);
  const panel = el("section", "online-panel fund-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", "Outstanding fund balance");
  document.body.appendChild(panel);
  fundState.button = button;
  fundState.panel = panel;
  button.onclick = () => {
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) paintFundPanel();
  };
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) { panel.hidden = true; button.setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("click", event => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });
  clearInterval(fundState.timer);
  fundState.timer = setInterval(refreshFundBalance, 5 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshFundBalance(); });
  refreshFundBalance();
}

/* ---------- avatars, toasts ---------- */
function initialsOf(name) {
  return (name || "?").split(/[\s,]+/).filter(Boolean).map(part => part.charAt(0)).join("").slice(0, 2).toUpperCase() || "?";
}

function avatarNode(url, name, cls) {
  if (url) {
    const img = el("img", cls || "avatar-sm");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => img.replaceWith(el("span", (cls || "avatar-sm") + " avatar-fallback", initialsOf(name)));
    return img;
  }
  return el("span", (cls || "avatar-sm") + " avatar-fallback", initialsOf(name));
}

function showToast(text, kind) {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = el("div", "toast-stack");
    stack.setAttribute("role", "status");
    stack.setAttribute("aria-live", "polite");
    document.body.appendChild(stack);
  }
  const toast = el("div", "toast" + (kind ? " toast-" + kind : ""), text);
  stack.appendChild(toast);
  while (stack.children.length > 3) stack.firstChild.remove();
  setTimeout(() => toast.classList.add("toast-out"), 4200);
  setTimeout(() => toast.remove(), 4700);
}

/* ---------- view a classmate's profile ---------- */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* Round X button in the top-right corner of the profile card. */
function memberCloseButton(onClose) {
  if (!document.getElementById("memberCloseStyle")) {
    const style = document.createElement("style");
    style.id = "memberCloseStyle";
    style.textContent =
      ".member-card { position: relative; }" +
      ".member-card .member-head { padding-right: 34px; }" +
      "button.member-x { position: absolute; top: 10px; right: 10px; width: 34px; height: 34px; margin: 0; padding: 0; display: grid; place-items: center; border-radius: 50%; background: #fff; color: #000; border: 2.5px solid #000; box-shadow: none; cursor: pointer; }" +
      "button.member-x svg { width: 16px; height: 16px; display: block; }" +
      "button.member-x:hover { background: #000; color: #fff; box-shadow: none; }" +
      "button.member-x:focus-visible { outline: 3px solid #000; outline-offset: 2px; }";
    document.head.appendChild(style);
  }
  const x = document.createElement("button");
  x.type = "button";
  x.className = "member-x";
  x.setAttribute("aria-label", "Close");
  x.title = "Close";
  x.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
  x.onclick = onClose;
  return x;
}

function openMemberProfile(userId, hint) {
  if (!userId) return;
  hint = hint || {};
  const dialog = el("div", "modal-backdrop");
  const card = el("div", "modal-card member-card");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.setAttribute("aria-label", "Member profile");
  const close = () => { dialog.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = event => { if (event.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  dialog.onclick = event => { if (event.target === dialog) close(); };
  card.appendChild(el("p", "hint", "Loading profile..."));
  dialog.appendChild(card);
  document.body.appendChild(dialog);

  sb.rpc("get_member_profile", { p_user_id: userId }).then(({ data, error }) => {
    card.replaceChildren();
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) {
      card.appendChild(el("h2", "", "Profile unavailable"));
      card.appendChild(el("p", "msg err", error
        ? error.message + " (Run migration_profile_nickname_online.sql in the Supabase SQL Editor if you have not yet.)"
        : "This profile could not be found."));
      card.appendChild(memberCloseButton(close));
      return;
    }
    const title = profileTitle({ student_number: row.student_number, role: row.role });
    const head = el("div", "member-head");
    head.appendChild(avatarNode(row.avatar_url, row.display_name, "member-avatar"));
    const who = el("div", "member-who");
    const nameLine = el("h2", "member-name", row.display_name || "Student");
    if (row.nickname) nameLine.append(" ", el("span", "member-nick", "(" + row.nickname.toLowerCase() + ")"));
    who.appendChild(nameLine);
    const chips = el("div", "member-chips");
    chips.appendChild(el("span", "staff-title-card member-title", title));
    if (row.student_number) chips.appendChild(el("span", "member-number", row.student_number));
    const online = presence.users.some(u => u.user_id === row.user_id);
    chips.appendChild(el("span", "online-pill" + (online ? " on" : ""), online ? "Online now" : "Offline"));
    who.appendChild(chips);
    head.appendChild(who);
    card.appendChild(head);

    const about = el("div", "member-section");
    about.appendChild(el("h3", "member-label", "About"));
    about.appendChild(el("p", row.about ? "member-about" : "hint", row.about || "This member has not written anything yet."));
    card.appendChild(about);

    [["Favorite things", row.favorites], ["Hobbies", row.hobbies], ["Fun facts", row.fun_facts]].forEach(([label, text]) => {
      if (!text) return;
      const note = el("div", "member-note");
      note.append(el("h3", "member-label", label), el("p", "", text));
      card.appendChild(note);
    });

    const facts = el("dl", "member-facts");
    const fact = (label, value) => { facts.append(el("dt", "", label), el("dd", "", value)); };
    if (row.birth_month && row.birth_day) fact("Birthday", MONTHS[row.birth_month - 1] + " " + row.birth_day);
    if (row.member_since) fact("Joined Portalis", new Date(row.member_since).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }));
    fact("Class", "BSIT-12");
    card.appendChild(facts);

    const actions = el("div", "edit-note-actions");
    if (userId === (presence.me && presence.me.user_id)) {
      const edit = el("a", "btn ghost", "Edit my profile");
      edit.href = "profile.html";
      actions.appendChild(edit);
    }
    if (actions.children.length) card.appendChild(actions);
    const closeX = memberCloseButton(close);
    card.appendChild(closeX);
    closeX.focus();
  });
}

/* ---------- who's online (heartbeat saved in the database) ---------- */
const presence = { users: [], me: null, status: "connecting", error: "", panel: null, button: null, known: new Set(), started: false };

function toastsMuted() {
  try { return localStorage.getItem("portalis_online_toasts") === "off"; } catch (_) { return false; }
}
function setToastsMuted(off) {
  try { localStorage.setItem("portalis_online_toasts", off ? "off" : "on"); } catch (_) {}
}

function startPresence(ctx) {
  if (presence.started) return;
  presence.started = true;
  presence.me = {
    user_id: ctx.user.id,
    name: ctx.profile.full_name || ctx.profile.student_number || "Student",
    title: profileTitle(ctx.profile),
    role: ctx.profile.role,
    avatar_url: ctx.profile.avatar_url || null
  };
  let first = true;

  async function tick() {
    try {
      const beat = await sb.rpc("touch_presence");
      if (beat.error) throw beat.error;
      const { data, error } = await sb.rpc("get_online_users");
      if (error) throw error;
      const users = (data || []).map(u => ({
        user_id: u.user_id,
        name: u.display_name || "Student",
        nickname: (u.nickname || "").toLowerCase(),
        title: profileTitle({ student_number: u.student_number, role: u.role }),
        role: u.role,
        avatar_url: u.avatar_url || null
      }));
      users.forEach(u => { if (u.nickname) nickCache[u.user_id] = u.nickname; });
      if (!first && !toastsMuted()) {
        const joined = users.filter(u => u.user_id !== ctx.user.id && !presence.known.has(u.user_id)).map(u => u.nickname || u.name);
        if (joined.length) showToast(joined.length === 1 ? joined[0] + " is online" : joined.length + " classmates came online", "online");
      }
      presence.known = new Set(users.map(u => u.user_id));
      first = false;
      presence.users = users;
      presence.status = "live";
      presence.error = "";
    } catch (error) {
      presence.status = "error";
      presence.error = (error && error.message) || String(error);
    }
    refreshOnlineUI();
  }

  tick();
  setInterval(tick, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}

function renderOnlineButton(ctx) {
  document.querySelectorAll(".online-circle, .online-panel").forEach(node => node.remove());
  const button = el("button", "online-circle");
  button.type = "button";
  button.title = "Who's online";
  button.setAttribute("aria-label", "Who's online");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.2c2.7.2 4.5 2.2 4.5 4.8"/></svg>';
  button.appendChild(el("span", "online-count", "0"));
  document.body.appendChild(button);
  presence.button = button;

  const panel = el("section", "online-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", "People online now");
  document.body.appendChild(panel);
  presence.panel = panel;

  button.onclick = () => {
    panel.hidden = !panel.hidden;
    button.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) refreshOnlineUI();
  };
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) { panel.hidden = true; button.setAttribute("aria-expanded", "false"); }
  });
  document.addEventListener("click", event => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) {
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  });
  startPresence(ctx);
  refreshOnlineUI();
}

function refreshOnlineUI() {
  const button = presence.button, panel = presence.panel;
  if (!button || !panel) return;
  const count = presence.users.length;
  const badge = button.querySelector(".online-count");
  badge.textContent = presence.status === "error" ? "!" : String(count);
  button.classList.toggle("has-online", count > 0 && presence.status !== "error");
  button.classList.toggle("is-error", presence.status === "error");
  if (panel.hidden) return;

  panel.replaceChildren();
  const head = el("div", "online-head");
  const titleBox = el("div");
  titleBox.append(el("h3", "online-title", "Online now"), el("p", "online-sub", presence.status === "live" ? count + (count === 1 ? " person" : " people") + " online" : presence.status === "error" ? "Not connected" : "Connecting..."));
  const close = el("button", "online-close", "\u00d7");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  close.onclick = () => { panel.hidden = true; button.setAttribute("aria-expanded", "false"); };
  head.append(titleBox, close);
  panel.appendChild(head);

  if (presence.status === "error") {
    panel.appendChild(el("p", "online-empty", "The online list could not connect. Run migration_profile_nickname_online.sql in the Supabase SQL Editor, then refresh." + (presence.error ? " (" + presence.error + ")" : "")));
  } else if (!count) {
    panel.appendChild(el("p", "online-empty", presence.status === "live" ? "No one else is online right now." : "Checking who is around..."));
  } else {
    const list = el("ul", "online-list");
    presence.users.forEach(user => {
      const item = el("li");
      const row = el("button", "online-row");
      row.type = "button";
      row.title = "View " + user.name + "'s profile";
      const avatar = el("span", "online-avatar-wrap");
      avatar.append(avatarNode(user.avatar_url, user.name, "avatar-sm"), el("span", "online-dot"));
      const text = el("span", "online-text");
      const nameLine = el("span", "online-name", user.name + (user.nickname ? " (" + user.nickname + ")" : "") + (presence.me && user.user_id === presence.me.user_id ? " \u00b7 you" : ""));
      text.append(nameLine, el("span", "online-role", user.title));
      row.append(avatar, text);
      row.onclick = () => openMemberProfile(user.user_id, user);
      item.appendChild(row);
      list.appendChild(item);
    });
    panel.appendChild(list);
  }

  const foot = el("label", "online-foot");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = !toastsMuted();
  toggle.onchange = () => setToastsMuted(!toggle.checked);
  foot.append(toggle, document.createTextNode(" Notify me when classmates come online"));
  panel.appendChild(foot);
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
    staffAuthorName(n.author_name, n.staff_title, n.user_id),
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

function noteEditAction(note, onSave) {
  const button = el("button", "ghost", "Edit");
  button.type = "button";
  button.onclick = () => {
    const dialog = el("div", "modal-backdrop edit-note-backdrop");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "editNoteHeading");
    const form = el("form", "note composer edit-note-form");
    const heading = el("h2", "", "Edit note");
    heading.id = "editNoteHeading";
    const titleLabel = el("label", "", "Title");
    const title = el("input");
    title.maxLength = 80;
    title.value = note.title || "";
    titleLabel.appendChild(title);

    const priorityLabel = el("label", "", "Importance");
    const priorities = el("div", "prio-pick");
    ["low", "neutral", "medium", "high", "urgent"].forEach(priority => {
      const option = el("label", "p-" + priority);
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "edit-priority";
      input.value = priority;
      input.checked = (note.priority || "medium") === priority;
      option.append(input, el("span", "", LABEL[priority]));
      priorities.appendChild(option);
    });

    const formatLabel = el("label", "", "Format");
    const formats = el("div", "fmt-pick");
    [["text", "Plain"], ["bullets", "\u2022 Bullets"], ["numbered", "1. Numbered"]].forEach(([format, label]) => {
      const option = el("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = "edit-format";
      input.value = format;
      input.checked = (note.format || "text") === format;
      option.append(input, el("span", "", label));
      formats.appendChild(option);
    });

    const contentLabel = el("label", "", "Details (optional)");
    const content = el("textarea");
    content.value = note.content || "";
    content.placeholder = "Write something...";
    contentLabel.appendChild(content);

    const subnotesLabel = el("label", "", "Subnotes (optional)");
    const subnotes = el("ul", "chips");
    const subnoteInput = el("input");
    subnoteInput.placeholder = "Add a subnote";
    const addSubnote = el("button", "ghost", "+");
    addSubnote.type = "button";
    const subnoteRow = el("div", "subrow");
    subnoteRow.append(subnoteInput, addSubnote);
    const savedSubnotes = Array.isArray(note.subnotes)
      ? note.subnotes.map(item => ({ text: item.text || "", done: !!item.done }))
      : [];

    function renderSubnotes() {
      subnotes.replaceChildren();
      savedSubnotes.forEach((item, index) => {
        const row = el("li");
        const text = el("span", "", item.text);
        const done = document.createElement("input");
        done.type = "checkbox";
        done.checked = item.done;
        done.setAttribute("aria-label", "Mark subnote complete");
        done.onchange = () => { item.done = done.checked; };
        const remove = el("button", "x", "\u00d7");
        remove.type = "button";
        remove.setAttribute("aria-label", "Remove subnote");
        remove.onclick = () => {
          savedSubnotes.splice(index, 1);
          renderSubnotes();
        };
        row.append(done, text, remove);
        subnotes.appendChild(row);
      });
    }

    function appendSubnote() {
      const text = subnoteInput.value.trim();
      if (!text) return;
      savedSubnotes.push({ text, done: false });
      subnoteInput.value = "";
      renderSubnotes();
      subnoteInput.focus();
    }

    addSubnote.onclick = appendSubnote;
    subnoteInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        appendSubnote();
      }
    });
    renderSubnotes();

    const status = el("p", "msg");
    const actions = el("div", "edit-note-actions");
    const cancel = el("button", "ghost", "Cancel");
    cancel.type = "button";
    cancel.onclick = () => dialog.remove();
    const save = el("button", "", "Save changes");
    save.type = "submit";
    actions.append(cancel, save);

    form.append(
      heading,
      titleLabel,
      priorityLabel,
      priorities,
      formatLabel,
      formats,
      contentLabel,
      subnotesLabel,
      subnotes,
      subnoteRow,
      status,
      actions,
    );
    form.onsubmit = async event => {
      event.preventDefault();
      const nextTitle = title.value.trim();
      const nextContent = content.value.trim();
      if (!nextTitle && !nextContent && !savedSubnotes.length) {
        status.className = "msg err";
        status.textContent = "A note needs a title, details, or at least one subnote.";
        return;
      }
      save.disabled = true;
      const saved = await onSave(note, {
        title: nextTitle,
        content: nextContent,
        priority: form.querySelector('input[name="edit-priority"]:checked').value,
        format: form.querySelector('input[name="edit-format"]:checked').value,
        subnotes: savedSubnotes,
      });
      if (saved) dialog.remove();
      else save.disabled = false;
    };
    dialog.appendChild(form);
    dialog.onclick = event => {
      if (event.target === dialog) dialog.remove();
    };
    document.body.appendChild(dialog);
    title.focus();
  };
  return button;
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
     Answer: B          <- letter for multiple choice, or the text for identification
   No options + "Answer: True" / "Answer: False" makes a True/False question.            */
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
    if (opts.length === 0 && /^(true|false)$/i.test(answer)) {
      items.push({ qtype: "mcq", prompt: prompt, options: ["True", "False"], answer: /^true$/i.test(answer) ? "True" : "False" });
      return;
    }
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

/* ==========================================================================
   Reactions (memories, memory comments and note comments share this)
   ========================================================================== */
const REACTIONS = [
  { key: "like", label: "Like", icon: '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.3a2 2 0 0 0 2-1.7l1.4-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>' },
  { key: "love", label: "Love", icon: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21.2l7.8-7.7 1.1-1.1a5.5 5.5 0 0 0 0-7.8z"/>' },
  { key: "haha", label: "Haha", icon: '<circle cx="12" cy="12" r="9"/><path d="M7.5 9.8q1.2-1.6 2.4 0M14.1 9.8q1.2-1.6 2.4 0"/><path d="M7 13.5h10a5 5 0 0 1-10 0z" fill="currentColor"/>' },
  { key: "wow", label: "Wow", icon: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9.8" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="9.8" r="1.1" fill="currentColor" stroke="none"/><ellipse cx="12" cy="16" rx="2" ry="2.7" fill="currentColor" stroke="none"/>' },
  { key: "sad", label: "Sad", icon: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="1.1" fill="currentColor" stroke="none"/><path d="M8.5 17q3.5-3.4 7 0"/>' },
  { key: "angry", label: "Angry", icon: '<circle cx="12" cy="12" r="9"/><path d="M7 8l3.2 1.6M17 8l-3.2 1.6"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><path d="M8.5 17.2q3.5-2.8 7 0"/>' }
];
const REACTION_MAP = {};
REACTIONS.forEach(r => { REACTION_MAP[r.key] = r; });

function reactionSvg(key) {
  const r = REACTION_MAP[key] || REACTION_MAP.like;
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + r.icon + "</svg>";
}

function installReactionStyles() {
  if (document.getElementById("reactionStyle")) return;
  const style = document.createElement("style");
  style.id = "reactionStyle";
  style.textContent = [
    ".react-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 8px 0 2px; line-height: 1.2; }",
    "button.react-btn { display: inline-flex; align-items: center; gap: 7px; margin: 0; min-height: 36px; padding: 4px 13px 4px 9px; border: 2.5px solid #000; border-radius: 999px; background: #fff; color: #000; font: inherit; font-size: 17px; box-shadow: 2px 2px 0 #000; cursor: pointer; }",
    "button.react-btn svg { display: block; flex: none; width: 20px; height: 20px; }",
    "button.react-btn:hover { background: #f6b8dc; color: #000; box-shadow: 2px 2px 0 #000; }",
    "button.react-btn.on, button.react-btn.on:hover { background: #000; color: #fff; }",
    "button.react-btn:focus-visible, button.react-sum:focus-visible, button.react-opt:focus-visible, button.react-tab:focus-visible { outline: 3px solid #000; outline-offset: 3px; }",
    ".react-row.compact button.react-btn { min-height: 30px; padding: 2px 11px 2px 7px; border-width: 2px; font-size: 15px; gap: 6px; }",
    ".react-row.compact button.react-btn svg { width: 16px; height: 16px; }",
    "button.react-sum { display: inline-flex; align-items: center; gap: 6px; margin: 0; padding: 2px 8px 2px 4px; border: 0; border-radius: 999px; background: transparent; color: #000; font: inherit; font-size: 16px; box-shadow: none; cursor: pointer; }",
    "button.react-sum:hover:not(:disabled) { background: #fff0f8; color: #000; box-shadow: none; text-decoration: underline; }",
    "button.react-sum:disabled { cursor: default; }",
    "button.react-sum[hidden] { display: none; }",
    ".react-stack { display: inline-flex; }",
    ".react-mini { display: grid; place-items: center; width: 24px; height: 24px; margin-left: -7px; border: 2px solid #000; border-radius: 50%; background: #fff; color: #000; }",
    ".react-mini:first-child { margin-left: 0; }",
    ".react-mini svg { display: block; width: 14px; height: 14px; }",
    ".react-row.compact .react-mini { width: 21px; height: 21px; }",
    ".react-row.compact .react-mini svg { width: 12px; height: 12px; }",
    ".react-picker { position: absolute; z-index: 1200; display: flex; gap: 4px; padding: 6px; background: #fff; border: 3px solid #000; border-radius: 999px; box-shadow: 3px 3px 0 #000; }",
    ".react-picker[hidden] { display: none; }",
    "button.react-opt { display: grid; place-items: center; width: 40px; height: 40px; margin: 0; padding: 0; border: 2px solid #000; border-radius: 50%; background: #fff; color: #000; box-shadow: none; cursor: pointer; transition: transform .1s; }",
    "button.react-opt svg { display: block; width: 22px; height: 22px; }",
    "button.react-opt:hover { background: #f6b8dc; color: #000; box-shadow: none; transform: translateY(-3px); }",
    "button.react-opt.on, button.react-opt.on:hover { background: #000; color: #fff; }",
    ".react-modal { position: relative; text-align: left; max-width: 420px; }",
    ".react-modal h3 { margin: 0 0 12px; padding-right: 44px; }",
    ".react-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }",
    "button.react-tab { display: inline-flex; align-items: center; gap: 6px; margin: 0; padding: 3px 12px; border: 2px solid #000; border-radius: 999px; background: #fff; color: #000; font: inherit; font-size: 16px; box-shadow: none; }",
    "button.react-tab svg { display: block; width: 16px; height: 16px; }",
    "button.react-tab:hover { background: #f6b8dc; color: #000; box-shadow: none; }",
    "button.react-tab.on, button.react-tab.on:hover { background: #000; color: #fff; }",
    "ul.react-people { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow-y: auto; border-top: 2px dashed #000; }",
    "li.react-person { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1.5px dashed #000; }",
    "li.react-person .react-mini { flex: none; width: 30px; height: 30px; margin: 0; }",
    "li.react-person .react-mini svg { width: 17px; height: 17px; }",
    ".react-person-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }",
    ".react-person-nick { opacity: .7; }",
    "button.react-link { margin: 0; padding: 0; border: 0; background: none; color: #000; font: inherit; text-align: left; text-decoration: underline; box-shadow: none; cursor: pointer; }",
    "button.react-link:hover { background: none; color: #000; box-shadow: none; text-decoration-thickness: 2px; }",
    ".react-you { padding: 0 9px; border: 1.5px solid #000; border-radius: 999px; font-size: 13px; }",
    ".react-empty { margin: 12px 0 0; }",
    ".react-toast { position: fixed; left: 50%; bottom: 96px; z-index: 1300; max-width: min(92vw, 460px); transform: translateX(-50%); padding: 10px 16px; background: #000; color: #fff; font-size: 17px; box-shadow: 3px 3px 0 #0005; }"
  ].join("\n");
  document.head.appendChild(style);
}

function reactionToast(text) {
  installReactionStyles();
  document.querySelectorAll(".react-toast").forEach(node => node.remove());
  const toast = el("div", "react-toast", text);
  toast.setAttribute("role", "alert");
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function friendlyReactionError(error) {
  const text = (error && error.message) || String(error);
  if (/relation|does not exist|schema cache|could not find|function/i.test(text)) {
    return "Reactions are not set up yet. Run migration_memory_reactions.sql and migration_comment_reactions.sql in the Supabase SQL Editor.";
  }
  if (/row-level security|violates/i.test(text)) return "You can only react to approved posts and comments.";
  return text;
}

/* One floating picker shared by every reaction button (so nothing gets clipped inside cards or sliders). */
const reactPicker = { node: null, anchor: null, hideTimer: 0, openTimer: 0, ready: false };

function reactionPickerOpen() { return !!(reactPicker.node && !reactPicker.node.hidden); }

function hideReactPicker() {
  clearTimeout(reactPicker.hideTimer);
  clearTimeout(reactPicker.openTimer);
  if (reactPicker.node) reactPicker.node.hidden = true;
  reactPicker.anchor = null;
}

function scheduleHideReactPicker(ms) {
  clearTimeout(reactPicker.hideTimer);
  reactPicker.hideTimer = setTimeout(hideReactPicker, ms);
}

function showReactPicker(anchor, current, onPick, focusFirst) {
  installReactionStyles();
  if (!reactPicker.node) {
    const node = el("div", "react-picker");
    node.setAttribute("role", "menu");
    node.hidden = true;
    node.addEventListener("mouseenter", () => clearTimeout(reactPicker.hideTimer));
    node.addEventListener("mouseleave", () => scheduleHideReactPicker(300));
    document.body.appendChild(node);
    reactPicker.node = node;
  }
  if (!reactPicker.ready) {
    reactPicker.ready = true;
    document.addEventListener("click", event => {
      if (!event.target.closest(".react-picker, .react-btn")) hideReactPicker();
    });
    document.addEventListener("keydown", event => { if (event.key === "Escape") hideReactPicker(); });
  }
  const node = reactPicker.node;
  node.replaceChildren();
  REACTIONS.forEach(r => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "react-opt" + (r.key === current ? " on" : "");
    option.title = r.label;
    option.setAttribute("role", "menuitem");
    option.setAttribute("aria-label", r.label + (r.key === current ? " (your reaction, tap to remove)" : ""));
    option.innerHTML = reactionSvg(r.key);
    option.onclick = event => { event.stopPropagation(); hideReactPicker(); onPick(r.key); };
    node.appendChild(option);
  });
  reactPicker.anchor = anchor;
  node.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = node.offsetWidth, height = node.offsetHeight;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  let top = rect.top - height - 8;
  if (top < 8) top = rect.bottom + 8;
  node.style.left = (left + window.scrollX) + "px";
  node.style.top = (top + window.scrollY) + "px";
  if (focusFirst) { const first = node.querySelector(".react-opt.on") || node.firstChild; if (first) first.focus(); }
}

/* opts: { table, idColumn, targetId, reactions: [{user_id, reaction, display_name?, nickname?}],
           me: {id, name, nickname}, names: bool (tap the count to see who reacted),
           fetchFresh: async () => array | null, compact: bool } */
function createReactions(opts) {
  installReactionStyles();
  const me = opts.me;
  let list = (opts.reactions || []).map(r => Object.assign({}, r));
  const row = el("div", "react-row" + (opts.compact ? " compact" : ""));
  const btn = el("button", "react-btn");
  btn.type = "button";
  btn.setAttribute("aria-haspopup", "menu");
  const sum = el("button", "react-sum");
  sum.type = "button";
  row.append(btn, sum);

  const mine = () => list.find(r => r.user_id === me.id);

  function render() {
    const my = mine();
    btn.classList.toggle("on", !!my);
    const label = my ? REACTION_MAP[my.reaction].label : "React";
    btn.innerHTML = reactionSvg(my ? my.reaction : "like") + "<span>" + label + "</span>";
    btn.setAttribute("aria-label", my ? "Your reaction: " + label + ". Change it" : "React");
    const counts = {};
    list.forEach(r => { counts[r.reaction] = (counts[r.reaction] || 0) + 1; });
    const top = REACTIONS.map(r => r.key).filter(k => counts[k]).sort((a, b) => counts[b] - counts[a]).slice(0, 3);
    sum.hidden = !list.length;
    sum.innerHTML = '<span class="react-stack">' + top.map(k => '<span class="react-mini">' + reactionSvg(k) + "</span>").join("") + '</span><span class="react-total">' + list.length + "</span>";
    sum.title = REACTIONS.filter(r => counts[r.key]).map(r => r.label + " " + counts[r.key]).join(", ");
    sum.setAttribute("aria-label", list.length + (list.length === 1 ? " reaction" : " reactions") + (opts.names ? ". See who reacted" : ""));
    sum.disabled = !opts.names;
  }

  let chain = Promise.resolve();
  function pick(key) {
    const before = mine();
    const remove = !!before && before.reaction === key;
    list = list.filter(r => r.user_id !== me.id);
    if (!remove) list.push({ user_id: me.id, reaction: key, display_name: me.name, nickname: me.nickname || null });
    render();
    chain = chain.then(async () => {
      const request = remove
        ? sb.from(opts.table).delete().eq(opts.idColumn, opts.targetId).eq("user_id", me.id)
        : sb.from(opts.table).upsert({ [opts.idColumn]: opts.targetId, user_id: me.id, reaction: key }, { onConflict: opts.idColumn + ",user_id" });
      const { error } = await request;
      if (error) {
        list = list.filter(r => r.user_id !== me.id);
        if (before) list.push(before);
        render();
        reactionToast(friendlyReactionError(error));
      }
    });
  }

  const openPicker = focusFirst => { const my = mine(); showReactPicker(btn, my && my.reaction, pick, focusFirst); };
  const canHover = () => window.matchMedia && window.matchMedia("(hover: hover)").matches;
  btn.onclick = event => { event.stopPropagation(); openPicker(true); };
  btn.addEventListener("mouseenter", () => {
    if (!canHover()) return;
    clearTimeout(reactPicker.hideTimer);
    clearTimeout(reactPicker.openTimer);
    reactPicker.openTimer = setTimeout(() => openPicker(false), 250);
  });
  btn.addEventListener("mouseleave", () => { clearTimeout(reactPicker.openTimer); scheduleHideReactPicker(350); });

  function openList() {
    let filter = "all";
    const dialog = el("div", "modal-backdrop");
    const card = el("div", "modal-card react-modal");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-label", "Who reacted");
    const close = () => { dialog.remove(); document.removeEventListener("keydown", onKey); };
    const onKey = event => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    dialog.onclick = event => { if (event.target === dialog) close(); };
    const tabs = el("div", "react-tabs");
    const people = el("ul", "react-people");
    function draw() {
      const counts = {};
      list.forEach(r => { counts[r.reaction] = (counts[r.reaction] || 0) + 1; });
      if (filter !== "all" && !counts[filter]) filter = "all";
      tabs.replaceChildren();
      const makeTab = (key, html) => {
        const tab = el("button", "react-tab" + (filter === key ? " on" : ""));
        tab.type = "button";
        tab.innerHTML = html;
        tab.onclick = () => { filter = key; draw(); };
        tabs.appendChild(tab);
      };
      makeTab("all", "All " + list.length);
      REACTIONS.forEach(r => { if (counts[r.key]) makeTab(r.key, reactionSvg(r.key) + "<span>" + counts[r.key] + "</span>"); });
      people.replaceChildren();
      list.slice().reverse().filter(r => filter === "all" || r.reaction === filter).forEach(r => {
        const li = el("li", "react-person");
        const icon = el("span", "react-mini");
        icon.innerHTML = reactionSvg(r.reaction);
        icon.title = REACTION_MAP[r.reaction].label;
        const name = el("span", "react-person-name");
        const link = el("button", "react-link", r.display_name || "Student");
        link.type = "button";
        link.onclick = () => openMemberProfile(r.user_id);
        name.appendChild(link);
        if (r.nickname) name.append(" ", el("span", "react-person-nick", "(" + r.nickname.toLowerCase() + ")"));
        li.append(icon, name);
        if (r.user_id === me.id) li.appendChild(el("span", "react-you", "You"));
        people.appendChild(li);
      });
      if (!list.length) people.appendChild(el("li", "hint react-empty", "No reactions yet."));
    }
    card.append(el("h3", "", "Reactions"), tabs, people, memberCloseButton(close));
    dialog.appendChild(card);
    document.body.appendChild(dialog);
    draw();
    if (typeof opts.fetchFresh === "function") {
      opts.fetchFresh().then(fresh => {
        if (!Array.isArray(fresh) || !dialog.isConnected) return;
        list = fresh.map(r => Object.assign({}, r));
        render();
        draw();
      }).catch(() => {});
    }
  }
  sum.onclick = event => { event.stopPropagation(); if (opts.names) openList(); };

  render();
  return row;
}
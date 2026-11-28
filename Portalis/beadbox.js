// Shared helpers for beadshop.html (customer) and beadorders.html (seller).
const FREE_EVERY = 5;

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const peso = n => "₱" + (Number.isInteger(n) ? n : n.toFixed(2));
const fmtTime = value =>
  new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// Supabase calls return { data, error } instead of throwing; this makes them throw.
function must(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
// Click handlers use this so any thrown error shows up as a toast.
async function run(fn) {
  try { await fn(); } catch (e) { toast(e.message); }
}

const mascot = () => {
  const img = el("img", "mascot");
  img.src = "unique-logo.webp";
  img.alt = "";
  return img;
};

// order = { no, customer, created_at, items: [{name, qty, free, total}], total }
function buildReceipt(order) {
  const wrap = el("div", "receipt-wrap");
  const r = el("div", "receipt");
  const head = el("div", "r-head");
  const title = el("h3", "logo");
  title.append("anik ", el("b", "", "anik"), " ", el("span", "star", "★"));
  head.append(mascot(), title);
  r.append(head);
  r.append(el("div", "r-no", "Order #" + order.no));
  r.append(el("div", "meta", fmtTime(order.created_at)));
  if (order.customer) r.append(el("div", "who", "For: " + order.customer));
  r.append(el("div", "tear"));
  order.items.forEach(it => {
    const row = el("div", "r");
    row.append(el("span", "q", String(it.qty)), el("span", "nm", it.name), el("span", "pr", peso(it.total)));
    r.append(row);
    if (it.free > 0) {
      const f = el("div", "r free");
      f.append(el("span", "q", "+" + it.free), el("span", "nm", it.name + " 🎁 FREE"), el("span", "pr", peso(0)));
      r.append(f);
    }
  });
  r.append(el("div", "tear"));
  const t = el("div", "r-total");
  t.append(el("span", "", "TOTAL"), el("span", "", peso(order.total)));
  r.append(t);
  r.append(el("div", "r-thanks", "Thank you! ♡ Come again!"));
  r.append(el("div", "r-bars"));
  wrap.append(r);
  return wrap;
}
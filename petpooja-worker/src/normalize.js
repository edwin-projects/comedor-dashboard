// ─── Pet Pooja order → Comedor income model ──────────────────────────────────
// Pure, side-effect-free transforms shared by the real-time webhook handler and
// the nightly reconcile pull. No I/O here so it's trivially unit-testable.
//
// Two Pet Pooja payload shapes feed in and must both work:
//   • PUSH  (Global API webhook): { properties: { Order, OrderItem, ... } }
//       item category key = "category_name",  part payments = "part_payments",
//       no "order_date" (derive from "created_on"), items carry scalar discount/tax.
//   • PULL  (Get Orders API):     order_json[] = { Order, OrderItem, ... }
//       item category key = "categoryname",   part payments = "part_payment",
//       has "order_date", items carry total_discount / total_tax / item_tax_info.
// normalizeOrder() reads both spellings so downstream code never branches on source.

const num = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = v => (v == null ? '' : String(v)).trim();

// Payment-mode buckets. Pet Pooja calls UPI "Other"; aggregator dues that the
// platform will settle later come as "Online" / "Not Paid" (still real revenue —
// only the collector differs, so they count in gross like any other sale).
function payBucket(type) {
  const t = str(type).toLowerCase();
  if (t === 'cash') return 'cash';
  if (t === 'card' || t === 'credit card' || t === 'debit card') return 'card';
  if (t === 'upi' || t === 'other') return 'upi';  // pull sends "UPI"; push calls UPI "Other"
  if (t === 'online' || t === 'not paid') return 'online';
  return 'other';
}

// Accepts a single Pet Pooja order object from EITHER payload shape and returns
// the flat, normalized order we store and roll up. `total` is the customer-paid,
// tax-inclusive, net-of-discount figure — our "gross" (it sums to Pet Pooja's own
// "Total Sales"). Nothing here decides inclusion; rollupDay() drops cancellations.
function normalizeOrder(raw) {
  const root = raw && raw.properties ? raw.properties : raw;   // unwrap push envelope
  if (!root || !root.Order) return null;
  const o = root.Order;
  const items = root.OrderItem || [];
  const parts = o.part_payment || o.part_payments || [];

  const date = str(o.order_date) || str(o.created_on).slice(0, 10);
  const gross = num(o.total);                       // final, tax-incl, net of discount

  // Payment split: honour a part-payment breakdown when present, else the whole
  // bill lands in the single payment_type's bucket.
  const payMix = { cash: 0, card: 0, upi: 0, online: 0, other: 0 };
  if (parts.length) {
    parts.forEach(p => { payMix[payBucket(p.payment_type)] += num(p.amount); });
  } else {
    payMix[payBucket(o.payment_type)] += gross;
  }

  const itemList = items.map(it => ({
    n: str(it.name),
    c: str(it.categoryname || it.category_name),
    g: num(it.total),
    q: num(it.quantity),
    id: str(it.itemid),
    catId: str(it.categoryid),
  }));

  return {
    orderID: str(o.orderID),
    date,
    createdOn: str(o.created_on),
    status: str(o.status) || 'Success',
    cancelled: str(o.status).toLowerCase() === 'cancelled',
    orderType: str(o.order_type),                   // Dine In / Pick Up / Delivery
    channel: str(o.order_from) || 'POS',            // POS / Zomato / Swiggy / …
    paymentType: str(o.payment_type),
    gross,
    coreTotal: num(o.core_total),
    discount: num(o.discount_total),
    tax: num(o.tax_total),
    payMix,
    itemList,
    restID: str(root.Restaurant && root.Restaurant.restID),
  };
}

// Roll a day's normalized orders up into the exact record shape the app already
// reads from comedor/income/<date> — so the dashboard needs no change to consume
// it. Cancelled orders are stored (audit) but excluded from every total. Extra
// fields (payMix, channels, counts) are additive for later features.
function rollupDay(date, orders) {
  const live = orders.filter(o => o && !o.cancelled && o.date === date);
  let gross = 0, discount = 0, tax = 0, units = 0;
  const categories = {};
  const payMix = { cash: 0, card: 0, upi: 0, online: 0, other: 0 };
  const channels = {};
  const itemAgg = {};                               // keyed by itemid|name

  live.forEach(o => {
    gross += o.gross; discount += o.discount; tax += o.tax;
    channels[o.channel] = (channels[o.channel] || 0) + o.gross;
    Object.keys(payMix).forEach(k => { payMix[k] += o.payMix[k] || 0; });
    o.itemList.forEach(it => {
      units += it.q;
      categories[it.c] = round2((categories[it.c] || 0) + it.g);
      const key = it.id || (it.n + '|' + it.c);
      const a = itemAgg[key] || (itemAgg[key] = { n: it.n, c: it.c, g: 0, q: 0, id: it.id });
      a.g = round2(a.g + it.g); a.q = round2(a.q + it.q);
    });
  });

  return {
    id: 'pp_' + date,
    from: date,
    to: date,
    gross: round2(gross),
    tax: round2(tax),
    discount: round2(discount),
    items: round2(units),
    categories,
    itemList: Object.values(itemAgg).sort((a, b) => b.g - a.g),
    // additive (not yet read by the app) —
    orders: live.length,
    cancelled: orders.filter(o => o && o.cancelled && o.date === date).length,
    payMix: mapVals(payMix, round2),
    channels: mapVals(channels, round2),
    source: 'Pet Pooja',
    uploadedBy: 'Pet Pooja API',
  };
}

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const mapVals = (o, f) => { const r = {}; for (const k in o) r[k] = f(o[k]); return r; };

export { normalizeOrder, rollupDay, payBucket, num, str };

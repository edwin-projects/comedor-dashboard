// ─── Comedor × Pet Pooja real-time bridge (Cloudflare Worker) ────────────────
// Two entry points:
//   • fetch()     — the public webhook. Pet Pooja POSTs one order per bill print.
//   • scheduled() — nightly cron. Pulls the last few business days and reconciles,
//                   so a missed/edited push self-heals (belt-and-suspenders).
//
// Both land data in Firebase RTDB, which the app already listens to live — so a
// new order shows on every open dashboard within ~1s with no app change.
//
// Data model:
//   comedor/orders/<YYYY-MM-DD>/<orderID>  raw normalized order (idempotent by ID;
//                                          re-push overwrites, so no double-count)
//   comedor/income/<YYYY-MM-DD>            derived daily rollup the app consumes
//
// Every write recomputes the day's income from the FULL set of stored orders, so
// edits, cancellations, retries and out-of-order arrival can never inflate a total.

import { normalizeOrder, rollupDay } from './normalize.js';
import { firebase } from './firebase.js';
import { pullDay } from './petpooja.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Recompute + persist the rollup for one date from whatever orders are stored,
// after merging in `incoming` (already-normalized orders from a push or a pull).
async function rebuildDay(fb, date, incoming) {
  const stored = (await fb.get('comedor/orders/' + date)) || {};
  incoming.forEach(o => { if (o && o.orderID) stored[o.orderID] = o; });
  await fb.set('comedor/orders/' + date, stored);
  const rec = rollupDay(date, Object.values(stored));
  rec.at = new Date().toISOString();
  await fb.set('comedor/income/' + date, rec);
  return rec;
}

export default {
  // ── Real-time webhook ──────────────────────────────────────────────────────
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    let payload;
    try { payload = await request.json(); }
    catch { return json({ error: 'bad json' }, 400); }

    // Shared-token check. Pet Pooja can echo a static token in the body; we set
    // WEBHOOK_TOKEN to the same value and reject anything that doesn't match.
    if (env.WEBHOOK_TOKEN) {
      // Trim both sides — Pet Pooja's console pads the token with a trailing space
      // in the payload, which an exact compare would (and did) reject with a 401.
      const got = String(payload.token || payload.Token || '').trim();
      if (got !== String(env.WEBHOOK_TOKEN).trim()) return json({ error: 'unauthorized' }, 401);
    }
    if (payload.event && payload.event !== 'orderdetails') return json({ ok: true, skipped: payload.event });

    const order = normalizeOrder(payload);
    if (!order || !order.orderID) return json({ error: 'no order' }, 422);
    if (env.PETPOOJA_RESTID && order.restID && order.restID !== env.PETPOOJA_RESTID)
      return json({ error: 'wrong outlet' }, 403);
    if (!order.date) return json({ error: 'no date' }, 422);

    const fb = firebase(env);
    try {
      const rec = await rebuildDay(fb, order.date, [order]);
      return json({ ok: true, orderID: order.orderID, date: order.date, dayGross: rec.gross });
    } catch (e) {
      // 500 tells Pet Pooja the delivery failed; the nightly pull is the safety net.
      return json({ error: String(e && e.message || e) }, 500);
    }
  },

  // ── Nightly reconcile ──────────────────────────────────────────────────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const fb = firebase(env);
      const days = Number(env.RECONCILE_DAYS || 3);          // trailing window self-heals skips
      const today = new Date();
      for (let i = 0; i <= days; i++) {   // i=0 = today, so intraday runs keep the current day live
        const d = new Date(today.getTime() - i * 86400000);
        const date = new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);  // IST day
        try {
          const orders = await pullDay(env, date);
          await rebuildDay(fb, date, orders);
        } catch (e) {
          console.error('reconcile ' + date + ' failed: ' + (e && e.message || e));
        }
      }
    })());
  },
};

export { rebuildDay };

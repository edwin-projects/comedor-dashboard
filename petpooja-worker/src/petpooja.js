// ─── Pet Pooja "Get Orders" pull client (nightly reconcile) ──────────────────
// The Get Orders API is a T-1 pull: ask for date D and it returns orders for
// D-1. Credentials (app_key/app_secret/access_token) + restID go in the request
// body. We normalize each returned order via the shared normalizer.
//
// GOTCHA: the doc shows a GET with a JSON body (`curl --request GET --data …`).
// The Fetch standard forbids a body on GET, and the Workers runtime enforces it —
// so we CANNOT replay that curl verbatim. PETPOOJA_PULL_METHOD lets us send POST
// instead (most such endpoints accept it); confirm the accepted verb with Pet
// Pooja. Everything else is identical.

import { normalizeOrder } from './normalize.js';

// pad a Date to YYYY-MM-DD in IST (Pet Pooja business day is India time).
function istDateStr(d) {
  const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
  return ist.toISOString().slice(0, 10);
}

// Fetch one business day (the API's T-1 rule means we ask for day+1).
async function pullDay(env, businessDate) {
  const ask = istDateStr(new Date(new Date(businessDate + 'T00:00:00Z').getTime() + 86400000));
  const body = JSON.stringify({
    app_key: env.PETPOOJA_APP_KEY,
    app_secret: env.PETPOOJA_APP_SECRET,
    access_token: env.PETPOOJA_ACCESS_TOKEN,
    restID: env.PETPOOJA_RESTID,
    order_date: ask,
    refId: '',
  });
  const method = (env.PETPOOJA_PULL_METHOD || 'POST').toUpperCase();
  const res = await fetch(env.PETPOOJA_PULL_URL, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) throw new Error('pull ' + businessDate + ' → ' + res.status + ' ' + (await res.text()));
  const j = await res.json();
  const list = j.order_json || j.orders || [];
  return list.map(normalizeOrder).filter(o => o && o.date === businessDate);
}

export { pullDay, istDateStr };

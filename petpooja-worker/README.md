# Comedor × Pet Pooja — real-time sales bridge

A Cloudflare Worker that turns Pet Pooja's order feed into the daily income
records the Comedor dashboard already reads. **Push for speed, pull for truth:**
every printed bill arrives in real time; a nightly pull reconciles the day so a
missed or edited push self-heals.

```
Pet Pooja POS ──push on every bill print──▶ Worker ──▶ Firebase RTDB ──▶ App (live, ~1s)
      └────────nightly T-1 pull (full day)─▶ Worker ──▶ reconcile ───────┘
```

## Why it's trustworthy

- **No double-counting.** Each order is stored under `comedor/orders/<date>/<orderID>`.
  A re-push overwrites that key; the day's income is *recomputed* from the full set,
  so retries, edits and out-of-order arrival can't inflate a total.
- **Cancellations & edits** re-push with new totals / `status:Cancelled` and are
  recomputed out of the day.
- **Missed pushes** (Worker down, network blip) are healed by the nightly pull,
  which re-pulls a trailing window (`RECONCILE_DAYS`, default 3).
- **The app needs no change** — it already listens to `comedor/*` live, so a new
  order shows on every open dashboard within ~1s.

## Data model

| Path | Contents |
|---|---|
| `comedor/orders/<YYYY-MM-DD>/<orderID>` | raw normalized order (idempotent source of truth) |
| `comedor/income/<YYYY-MM-DD>` | derived daily rollup the app consumes |

The rollup keeps the exact keys the app reads (`gross`, `discount`, `tax`,
`categories`, `itemList`, `from`/`to`, `id`) and **adds** `payMix` (cash/card/upi/
online), `channels` (POS/Zomato/…), and order counts for later features. `gross`
= sum of each Success order's `total` (tax-inclusive, net of discount) — the same
figure as Pet Pooja's "Total Sales".

## Files

- `src/normalize.js` — pure Pet Pooja → Comedor transforms (handles both the push
  and pull payload shapes). Fully unit-tested.
- `src/firebase.js` — service-account auth (RS256 JWT via WebCrypto) + RTDB REST.
- `src/petpooja.js` — Get Orders (pull) client.
- `src/worker.js` — `fetch` (webhook) + `scheduled` (nightly reconcile).
- `test/normalize.test.mjs` — asserts against the real sample payloads from both PDFs.

Run tests: `node --test`

## Deploy

Prereqs: a Cloudflare account and the credentials below.

1. `cd petpooja-worker && npm install`
2. Fill the non-secret `[vars]` in `wrangler.toml` (`FIREBASE_DB_URL`,
   `PETPOOJA_PULL_URL`, `PETPOOJA_RESTID`).
3. Set secrets (never commit these):
   ```
   npx wrangler secret put WEBHOOK_TOKEN
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT     # paste the full JSON, one line
   npx wrangler secret put PETPOOJA_APP_KEY
   npx wrangler secret put PETPOOJA_APP_SECRET
   npx wrangler secret put PETPOOJA_ACCESS_TOKEN
   ```
4. `npx wrangler deploy` → note the Worker URL.
5. Give Pet Pooja that URL as the webhook, and the same `WEBHOOK_TOKEN` value so
   pushes carry it in the `token` field.

For a non-interactive deploy (CI or this agent), export `CLOUDFLARE_API_TOKEN`
(scoped: *Workers Scripts: Edit*) and `CLOUDFLARE_ACCOUNT_ID` instead of `wrangler login`.

## Credentials needed (from you / Pet Pooja)

| Secret / var | Source |
|---|---|
| `PETPOOJA_APP_KEY` / `APP_SECRET` / `ACCESS_TOKEN` / `RESTID` | Pet Pooja |
| `PETPOOJA_PULL_URL` | Pet Pooja (doc shows placeholder `xyz.com/data`) |
| `WEBHOOK_TOKEN` | you pick; share with Pet Pooja |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase console → Project settings → Service accounts → Generate key |
| `FIREBASE_DB_URL` | Firebase RTDB URL |
| `CLOUDFLARE_API_TOKEN` / `ACCOUNT_ID` | Cloudflare (for deploy) |

## Open questions for Pet Pooja (blocking full go-live)

1. **Pull verb.** The doc shows a GET *with a JSON body*; the Fetch/Workers runtime
   can't send that. Does the endpoint accept **POST** (default here) or query params?
2. **Real pull URL** (the doc's `xyz.com/data` is a placeholder).
3. **Historical backfill** — can the pull return days back to **3 Mar 2026** so we
   retire the manual uploads and the `HIST_INCOME_DAILY` seed for covered days?
4. **Cancellations** — is a voided bill re-pushed with `status:Cancelled`?
5. **Complimentary** orders — do they arrive as a 100% discount / `waivedOff`?
6. **Push retries** — if our endpoint is briefly down, does Pet Pooja retry?

## Migration note

When live-backfill lands, the API writes `comedor/income/pp_<date>`. The app's
seeded `HIST_INCOME_DAILY` uses `pp_d_<date>`; both are 1-day records, so to avoid
two owners for the same day, retire the seed for API-covered days (drop `pp_d_*`
once the API record exists). Tracked as a follow-up in the app repo.

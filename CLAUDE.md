# Comedor Finance Dashboard — working notes for Claude

Single-file app: everything lives in `index.html` (inline CSS + HTML + JS). No build step.
Data syncs live across devices via Firebase Realtime Database (`comedor/*`), mirrored to
localStorage. Deployed as a static page (GitHub Pages).

**Cache-busting — bump the version on EVERY deploy.** GitHub Pages puts a ~10-min HTTP cache
on `index.html`, so changes otherwise lag on already-open devices. On each change that ships,
bump `const APP_VERSION` in `index.html` **and** write the identical value into `version.json`.
The app fetches `version.json` with `cache:'no-store'` on load + on every foreground and reloads
itself when the live version differs, so stale pages self-heal in ~1s. Keep the two values
identical — if `version.json` is ahead of the deployed `APP_VERSION`, clients reload-loop (the
per-session guard limits it, but it's still wrong). A network-first service worker (`sw.js`) is
the second layer. Do not remove either.

## Design thumb-rules (apply to every change)

1. **Money inputs — live Indian-lakh grouping.** Any field where a person types an amount
   must show Indian comma grouping *as they type* (e.g. `12,34,567`), so the number being
   entered is instantly readable. Use `type="text" inputmode="decimal"` with
   `oninput="onMoneyInput(this)"`, read the value with `money(id)` (strips commas), and set
   values with `setMoney(id, val)`. Never use a bare `type="number"` for rupee amounts.

2. **Add / Save feedback lives in the button.** When the user hits an add/save action, the
   button itself shows an interim state (`Saving…` / `Adding…`), then a confirmation
   (`Saved ✓` / `Added ✓`) for ~2 seconds, then returns to its label. Use `btnFlash(id, interim,
   done, restLabel)`. Do **not** show a separate success/confirmation box above or below the
   form — the button is the acknowledgement. (Validation errors may still use inline error text.)

3. **Mobile-first.** This is used mainly on phones (iPhone/Android) and iPads. Every screen
   must fit the viewport with no horizontal overflow; prefer card layouts over wide tables on
   small screens; keep tap targets large.

4. **Green · gold, Grotesque type.** Dark theme is "Jardín Verde — Deep Forest": a deep-forest
   green-black ground (`--bg:#0C1410`) with near-white green-tinted text, soft mint positives
   (`--green:#6FCF97`) and the gold Wolfpack emblem/accent (`--accent2:#C9A040`); light theme is
   the green "Jardín" palette (deep green `#1A5C38` + gold). Dark = light Jardín inverted.
   Fonts: Inter for labels/body & uppercase letter-spaced section titles; **all
   displayed numbers are Poppins SemiBold with tabular lining figures** (via the
   `--num-font` var applied to every numeric class — see the numerals block at the
   end of the CSS). Keep new number displays on that var so digits stay consistent.
   Positive/negative figures stay green/red.

5. **Capital ≠ expense.** Capital infusions (`capital: true`) never count as expenses and never
   touch the P&L — they only move the bank balance up. Expenses move it down.

6. **Bank balance is derived.** Displayed balance = the last statement balance
   (`comedor/meta/bankBalance`, with `asOfISO`) + capital − expenses dated *after* that date.
   Historical entries on/before the statement date are already baked into the base and must not
   be re-applied.

7. **Audit trail.** Every entry is stamped with `addedBy` (and `editedBy` on edit). Preserve the
   original author when editing.

8. **Income = Pet Pooja.** Sales/income come from uploaded Pet Pooja item-wise reports
   (`comedor/income` records with a period + gross + category breakdown), NOT the daily cash
   register (which is for cash reconciliation and undercounts delivery). Overlapping report
   periods are deduped by day — the **most granular (shortest-span) report owns overlap days**,
   earliest as tiebreak — so a per-day report always beats a coarse month/quarter estimate that
   overlaps it, and re-uploads never double-count. P&L income for a dashboard period = each
   report's gross spread evenly across its days, summed over the period. (Pet Pooja's item-wise
   "Gross Sales" already includes 5% GST and matches its "Total Sales" headline.)

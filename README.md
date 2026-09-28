# Money HQ

A private personal finance app: debt payoff plans, a card rewards optimizer, net worth, subscriptions, and home-buying readiness. It's one `index.html` page hosted on GitHub Pages, with magic-link login and sync through Supabase. There's no build step.

The **Credit** screen (Debt → Credit, or the Credit tile on Home) shows utilization by card and overall, a "pay before it reports" planner that times payments before statement closing dates (with a pre-approval month and an "all zero except one" mode), a 12-month utilization projection, a score log, directional score factors, hard inquiries, and what to avoid before a mortgage application.

**Statement Snap** reads your credit card statements and fills in the numbers the app needs. Tap **Snap** on a card or on the Debts screen, or drop several statements at once on the **Statement day** checklist (Debt → Credit). PDFs are read with pdf.js; photos and screenshots with Tesseract.js OCR, both loaded from jsdelivr only when you use them. Issuer-aware readers cover American Express (Platinum, Blue Cash Preferred), Capital One (Savor), Apple Card and the Robinhood Gold Card, with a generic reader for any other issuer. Each statement is matched to a card by its last 4 digits (or issuer and product). A review screen shows every value next to the statement text it came from, with a confidence score; tap a field to edit it, or tap a number in the text to use it. "Apply to card" shows before → after first, then updates the balance (logged to history like a check-in), APR, minimum, due day, closing day, limit and promo. Each card keeps a statement history with charts, and changes (APR up or down, promo ending within 60 days, a minimum jump, a new fee, a limit change, unexpected interest, balance up) show up as insights. Statement day shows which statements have closed since your last snap ("3 of 5 statements in for September").

**Statement privacy:** everything runs on your device. Statement files and their text are never uploaded or stored; they're held in memory during review and dropped when you confirm or close. Only the extracted numbers and the card's last 4 digits are saved. Account numbers, names, addresses and transactions are never saved.

Tabs: **Home** (dashboard, search, insights), **Debt** (overview, debts, credit, check-in, paychecks, savings), **Cards** (which card, credits, caps, merchants), **Net Worth**, **Spending** (subscriptions), and **More** (home buying, insights, settings).

Live: https://wealthsheethq.github.io/debt-tracker/

## Setup
The Supabase anon (public) key is in `index.html`. It's meant to be public: Row Level Security limits each signed-in user to their own row. Never put the service_role key in this repo.

1. In Supabase → Authentication → URL Configuration, add `https://wealthsheethq.github.io/debt-tracker/` to the **Redirect URLs** (and make it the Site URL).
2. Turn on GitHub Pages for this repo: Settings → Pages → deploy from branch `main`, folder `/ (root)`.

All numbers are entered in the app. None are stored in this repo. The app data is saved as one JSON object in `public.tracker_state.data`, one row per user, protected by RLS.

## Files
- `index.html`: the whole app (design system and icons, the pure engine between `ENGINE START`/`ENGINE END`, UI, sync)
- `manifest.webmanifest`, `icons/`: install the app to your home screen as a full-screen app
- `sw.js`: offline shell (network-first, so updates show up right away; Supabase calls are never cached)
- `tests/statements.test.mjs`: Statement Snap tests on SYNTHETIC statement text (`tests/fixtures/statements.mjs`: made-up numbers, no real statements): each issuer reader, the generic reader, OCR noise (O vs 0, l vs 1, missing spaces), two- and four-digit years, a $0 balance, a charge card with no preset limit, date parsing, matching cards by last 4, the apply step (balance history, closing day, APR, minimum), change alerts, statement day, migration of data saved by every previous version, and a check that no statement text or account numbers are ever written to saved data (`node tests/statements.test.mjs`)
- `tests/payoff.test.mjs`: tests for payoff math (fake cards), credit-buffer-first logic, custom order, payday checklist payments, spending-drift detection, the investing projection, monthly recaps, balance-transfer checks, net worth (linked HYSA and debts, no double counting), subscription totals, renewals and "cut it" math, card earn-rule ranking with caps and point values, merchant categories, credit periods, mortgage/DTI math, the down-payment-ready date, insights and dismissal, statement closing dates across month lengths, reported-balance projection with spending, per-card / overall / "all zero except one" payment targets that never short a minimum, inquiry aging, charge-card include/exclude, rate-tier mortgage math, credit insights, and migration of data saved by every previous version (`node tests/payoff.test.mjs`)

## Saved data
All data is in the one `data` JSON object (currently data version 7; version 7 added `statements`, the numbers read from each snapped statement, and `last4` on debts and wallet cards). `normalize()` in `index.html` upgrades data saved by any older version. It never renames fields, it fills new fields with safe defaults, and it keeps fields it doesn't recognise. When you deploy a new version, reload the app on every device, so an old open tab doesn't save the old data shape.

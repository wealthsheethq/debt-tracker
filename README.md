# Money HQ

A private personal finance app: debt payoff plans, net worth, and subscriptions. It's one `index.html` page hosted on GitHub Pages, with magic-link login and sync through Supabase. There's no build step.

Tabs: **Home** (dashboard), **Debt** (overview, debts, check-in, paychecks, savings), **Net Worth**, **Spending** (subscriptions), and **More** (settings and tools).

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
- `tests/payoff.test.mjs`: tests for payoff math (fake cards), credit-buffer-first logic, custom order, payday checklist payments, spending-drift detection, the investing projection, monthly recaps, balance-transfer checks, net worth (linked HYSA and debts, no double counting), subscription totals, renewals and "cut it" math, and migration of data saved by every previous version (`node tests/payoff.test.mjs`)

## Saved data
All data is in the one `data` JSON object (currently data version 4). `normalize()` in `index.html` upgrades data saved by any older version. It never renames fields, it fills new fields with safe defaults, and it keeps fields it doesn't recognise. When you deploy a new version, reload the app on every device, so an old open tab doesn't save the old data shape.

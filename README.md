# Debt Tracker

A private debt payoff tracker. It's one `index.html` page hosted on GitHub Pages, with magic-link login and sync through Supabase.

Live: https://wealthsheethq.github.io/debt-tracker/

## Setup
1. In `index.html`, set `SUPABASE_ANON_KEY` to your project's anon (public) key. Until you do, the page shows "Setup needed".
2. In Supabase → Authentication → URL Configuration, add `https://wealthsheethq.github.io/debt-tracker/` to the **Redirect URLs** (and make it the Site URL).
3. Turn on GitHub Pages for this repo: Settings → Pages → deploy from branch `main`, folder `/ (root)`.

All numbers are entered in the app. None are stored in this repo. The app data is saved as one JSON object in `public.tracker_state.data`, one row per user, protected by RLS.

## Files
- `index.html`: the whole app (styles, payoff engine, UI, sync)
- `manifest.webmanifest`, `icons/`: install the app to your home screen as a full-screen app
- `sw.js`: offline shell (network-first, so updates show up right away; Supabase calls are never cached)
- `tests/payoff.test.mjs`: payoff-math tests with fake cards (`node tests/payoff.test.mjs`)

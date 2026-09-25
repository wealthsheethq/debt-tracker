// Tests the payoff engine embedded in index.html using made-up sample cards.
// Run: node tests/payoff.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.slice(html.indexOf('/* ENGINE START */'), html.indexOf('/* ENGINE END */'));
const engine = new Function(`${src}; return { simulatePayoff, projectPlan, projectSavings, normalize, baselineAt, FREQUENCIES,
  buildChecklist, checkChecklistItem, uncheckChecklistItem, recordBalance, detectDrift, driftSummary, driftDelayDays,
  projectInvesting, buildMonthlySummary, ensureMonthlySummary, daysAheadOfPlan, balanceTransferCheck, lastPaydayOnOrBefore, toISO, parseISO, r2,
  netWorth, recordNetWorthSnapshot, netWorthChange, checkNetWorthMilestones, subscriptionTotals, subYearly, subMonthly,
  renewalsBetween, rollRenewals, cutItImpact, ACCOUNT_TYPES, CYCLES,
  merchantCategory, allMerchants, earnFor, rankCards, yearlyEarn, spentTowardRule, periodKeyFor, CARD_PRESETS, cardFromPreset, normalizeWalletCard,
  creditPeriod, toggleCreditUsed, creditUsed, creditsSummary, expiringCredits, monthlyPI, housingPayment, maxPriceForDTI, affordability, cashToClose,
  homeReadyDate, computeInsights, visibleInsights, dismissInsight, sigOf, planOptionsFrom, defaultHome };`)();
const { simulatePayoff, projectPlan, normalize, baselineAt, r2, parseISO } = engine;

// Three fake cards (sample data only).
const cards = [
  { id: 'a', name: 'Card A (Travel)',  balance: 4200, apr: 27.99, minPayment: 120 },
  { id: 'b', name: 'Card B (Store)',   balance: 950,  apr: 19.49, minPayment: 35 },
  { id: 'c', name: 'Card C (Cashback)', balance: 2600, apr: 23.24, minPayment: 75 }
];
const base = { perPaycheck: 300, frequency: 'biweekly', payAnchor: '2026-10-02', today: '2026-09-24' };
const LUMP = 1500;

const runs = [];
for (const strategy of ['avalanche', 'snowball']) {
  for (const lumpSum of [0, LUMP]) {
    runs.push({ strategy, lumpSum, r: simulatePayoff(cards, { ...base, strategy, lumpSum }) });
  }
}

const startTotal = cards.reduce((s, c) => s + c.balance, 0);
for (const { strategy, lumpSum, r } of runs) {
  assert.ok(r.ok, `${strategy}/${lumpSum} should finish`);
  // money in = principal + interest (to the cent)
  assert.ok(Math.abs(r.totalPaid - (startTotal + r.totalInterest)) < 0.02, `conservation ${strategy}/${lumpSum}: paid ${r.totalPaid} vs ${startTotal + r.totalInterest}`);
  // no paycheck ever pays more than the per-paycheck debt amount
  for (const p of r.paychecks) assert.ok(p.toDebt <= base.perPaycheck + 0.001);
  // every paycheck except the last is fully used
  r.paychecks.slice(0, -1).forEach((p) => assert.ok(Math.abs(p.toDebt - base.perPaycheck) < 0.001, `unused money on ${p.date}`));
  assert.equal(r.payoffs.length, 3);
}
const get = (s, l) => runs.find((x) => x.strategy === s && x.lumpSum === l).r;
// avalanche targets highest APR first
assert.equal(get('avalanche', 0).payoffs[0].id, 'a', 'avalanche clears the highest APR first');
assert.ok(get('avalanche', 0).totalInterest <= get('snowball', 0).totalInterest, 'avalanche should cost no more interest than snowball');
assert.equal(get('snowball', 0).payoffs[0].id, 'b', 'snowball clears the smallest balance first');
assert.equal(get('avalanche', LUMP).lump.allocations[0].id, 'a', 'avalanche lump sum goes to highest APR');
assert.equal(get('snowball', LUMP).lump.allocations[0].id, 'b', 'snowball lump sum goes to smallest balance');
for (const s of ['avalanche', 'snowball']) {
  assert.ok(get(s, LUMP).totalInterest < get(s, 0).totalInterest, 'lump sum reduces interest');
  assert.ok(get(s, LUMP).months <= get(s, 0).months, 'lump sum never slows payoff');
}

// Promo: a 0% card accrues no interest before its promo end.
const promo = simulatePayoff([{ id: 'p', name: 'Promo', balance: 1000, apr: 25, minPayment: 50, promoEnd: '2027-12-31' }],
  { ...base, perPaycheck: 100, strategy: 'avalanche', lumpSum: 0 });
assert.equal(promo.totalInterest, 0);

// Budget below minimums is reported, not looped forever.
const tooLow = simulatePayoff(cards, { ...base, perPaycheck: 50, strategy: 'avalanche' });
assert.equal(tooLow.ok, false);
assert.ok(tooLow.warnings.length > 0);

// ----- credit buffers: restore first, flagged urgent -----
{
  // Card P: limit $19,900, keep $1,000 open → buffer line $18,900. Balance $19,400 is $500 over.
  const withBuffer = [
    { id: 'p', name: 'Platinum', balance: 19400, apr: 12.99, minPayment: 400, creditLimit: 19900, keepOpen: 1000 },
    { id: 'h', name: 'High APR', balance: 3000, apr: 29.99, minPayment: 90 }
  ];
  // Payday Sep 25 is in the same month as "today", so no interest is added before it and the numbers stay exact.
  const sameMonth = { ...base, payAnchor: '2026-09-25' };
  const r = simulatePayoff(withBuffer, { ...sameMonth, perPaycheck: 1200, strategy: 'avalanche' });
  assert.ok(r.ok);
  assert.deepEqual(r.overBuffer, [{ id: 'p', name: 'Platinum', over: 500 }]);
  const first = r.paychecks[0];
  const p = first.allocations.find((a) => a.id === 'p');
  const h = first.allocations.find((a) => a.id === 'h');
  // minimums: 400 + 90; then buffer restore 500 - (400 already paid) = 100 more to P; rest to High APR (avalanche target)
  assert.equal(p.amount, 500, 'P gets min + whatever restores the buffer');
  assert.equal(p.buffer, 100, 'buffer portion is tracked separately');
  assert.equal(h.amount, 700, 'everything left goes to the avalanche target only after the buffer');
  assert.equal(first.urgent, true, 'paycheck is flagged urgent');
  assert.equal(r.bufferRestored.p, first.date);
  // Without the buffer the same paycheck would send nothing extra to P.
  const noBuf = simulatePayoff(withBuffer.map((d) => ({ ...d, creditLimit: null, keepOpen: 0 })), { ...sameMonth, perPaycheck: 1200, strategy: 'avalanche' });
  assert.equal(noBuf.paychecks[0].allocations.find((a) => a.id === 'p').amount, 400);
  assert.equal(noBuf.paychecks[0].urgent, false);

  // Snowball would target the smaller High APR card, but the buffer still comes first.
  const tight = simulatePayoff(withBuffer, { ...sameMonth, perPaycheck: 600, strategy: 'snowball' });
  const tp = tight.paychecks[0].allocations;
  assert.equal(tp.find((a) => a.id === 'p').amount, 500, 'buffer restored before snowball extra');
  assert.equal(tp.find((a) => a.id === 'h').amount, 100, 'snowball target gets only what is left');

  // Lump sum also restores buffers first.
  const lump = simulatePayoff(withBuffer, { ...sameMonth, perPaycheck: 1200, strategy: 'avalanche', lumpSum: 800 });
  assert.equal(lump.lump.allocations[0].id, 'p');
  assert.equal(lump.lump.allocations[0].buffer, 500);
  assert.equal(lump.lump.allocations.find((a) => a.id === 'h').amount, 300);
  assert.equal(lump.lump.urgent, true);

  // A card under its line is never urgent.
  const under = simulatePayoff([{ ...withBuffer[0], balance: 10000 }], { ...sameMonth, perPaycheck: 800 });
  assert.equal(under.paychecks.some((pc) => pc.urgent), false);
  assert.ok(Math.abs(r.totalPaid - (19400 + 3000 + r.totalInterest)) < 0.02, 'conservation with buffers');
}

// ----- custom order -----
{
  const order = ['c', 'b', 'a'];   // not avalanche (a,c,b) and not snowball (b,c,a)
  const r = simulatePayoff(cards, { ...base, strategy: 'custom', customOrder: order });
  assert.deepEqual(r.payoffs.map((p) => p.id), order, 'debts are paid off in the custom order');
  const extra = r.paychecks[0].allocations.find((a) => a.id === 'c');
  assert.ok(extra.amount > 75, 'extra money goes to #1 in the custom order');
  const lump = simulatePayoff(cards, { ...base, strategy: 'custom', customOrder: order, lumpSum: LUMP });
  assert.equal(lump.lump.allocations[0].id, 'c');
  // Debts missing from the saved order are appended (avalanche among themselves), not dropped.
  const partial = simulatePayoff(cards, { ...base, strategy: 'custom', customOrder: ['b'] });
  assert.deepEqual(partial.payoffs.map((p) => p.id), ['b', 'a', 'c']);
  assert.equal(partial.payoffs.length, 3);
}

// ----- migration of data saved by the first version -----
{
  const v1 = {
    version: 1,
    debts: [
      { id: 'x1', name: 'Old Card', type: 'card', balance: 1234.56, startBalance: 2000, apr: 22.9, minPayment: 40, promoEnd: '', paid: false, paidAt: null, createdAt: '2026-09-01T00:00:00Z' },
      { id: 'x2', name: 'Old Loan', type: 'loan', balance: 0, startBalance: 500, apr: 6, minPayment: 50, promoEnd: '2026-12-31', paid: true, paidAt: '2026-09-20T00:00:00Z', createdAt: '2026-09-01T00:00:00Z' }
    ],
    budget: { takeHome: 2400, frequency: 'biweekly', payAnchor: '2026-09-25', debtPerPaycheck: 500, savingsPerPaycheck: 150, lumpSum: 1000 },
    strategy: 'snowball',
    activePlan: 'B',
    savings: { balance: 3000, goal: 10000, apy: 4.1, monthlyContribution: null },
    history: [{ id: 'h1', at: '2026-09-20T00:00:00Z', kind: 'paid', debtId: 'x2', debtName: 'Old Loan', amount: 500, before: 500, after: 0 }],
    milestones: { 25: '2026-09-20T00:00:00Z' }
  };
  const before = JSON.parse(JSON.stringify(v1));
  const m = normalize(v1, '2026-09-24');
  assert.deepEqual(v1, before, 'normalize does not mutate its input');
  // every old field keeps its name and value
  for (const k of ['id', 'name', 'type', 'balance', 'startBalance', 'apr', 'minPayment', 'promoEnd', 'paid', 'paidAt', 'createdAt']) {
    assert.deepEqual(m.debts[0][k], v1.debts[0][k], `debt.${k} preserved`);
    assert.deepEqual(m.debts[1][k], v1.debts[1][k], `paid debt.${k} preserved`);
  }
  for (const k of Object.keys(v1.budget)) assert.equal(m.budget[k], v1.budget[k], `budget.${k} preserved`);
  assert.deepEqual(m.savings, v1.savings);
  assert.equal(m.strategy, 'snowball');
  assert.equal(m.activePlan, 'B');
  assert.deepEqual(m.history, v1.history);
  assert.deepEqual(m.milestones, v1.milestones);
  // new fields get safe defaults
  assert.equal(m.debts[0].creditLimit, null);
  assert.equal(m.debts[0].keepOpen, 0);
  assert.equal(m.debts[0].dueDay, null);
  assert.equal(m.budget.rentReserve, 0);
  assert.equal(m.budget.spending, 0);
  assert.deepEqual(m.budget.customItems, []);
  assert.deepEqual(m.budget.freedLater, {});
  assert.equal(m.budget.lumpFromSavings, false);
  assert.deepEqual(m.customOrder, []);
  assert.deepEqual(m.customMilestones, []);
  assert.deepEqual(m.checkins, []);
  assert.equal(m.baseline, null);
  // idempotent, JSON-safe, and the migrated data simulates the same as before
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(m)), '2026-09-24'), m, 'normalize is idempotent');
  const opts = { perPaycheck: 500, frequency: 'biweekly', payAnchor: '2026-09-25', today: '2026-09-24', strategy: 'snowball' };
  assert.deepEqual(simulatePayoff(m.debts, opts).payoffs, simulatePayoff(v1.debts, opts).payoffs, 'same payoff result after migration');
  // unknown fields (e.g. from a future version) survive
  const future = normalize({ ...v1, futureThing: { a: 1 }, debts: [{ ...v1.debts[0], futureField: 'keep me' }] }, '2026-09-24');
  assert.deepEqual(future.futureThing, { a: 1 });
  assert.equal(future.debts[0].futureField, 'keep me');
  // garbage in → usable defaults out
  const empty = normalize(null, '2026-09-24');
  assert.deepEqual(empty.debts, []);
  assert.equal(empty.strategy, 'avalanche');
  const bad = normalize({ debts: [null, 5, { name: 'X', balance: '-5', apr: 'abc', dueDay: 45 }], strategy: 'weird', customOrder: ['nope'] }, '2026-09-24');
  assert.equal(bad.debts.length, 1);
  assert.equal(bad.debts[0].balance, 0);
  assert.equal(bad.debts[0].apr, 0);
  assert.equal(bad.debts[0].dueDay, null);
  assert.equal(bad.strategy, 'avalanche');
  assert.deepEqual(bad.customOrder, [], 'custom order drops ids that no longer exist');
  assert.equal(normalize({ ...v1, strategy: 'custom', customOrder: ['x1', 'x1', 'gone'] }, '2026-09-24').customOrder.join(), 'x1');
}

// ----- projection & baseline helpers -----
{
  const plan = simulatePayoff(cards, { ...base, strategy: 'avalanche' });
  const proj = projectPlan(plan, { balance: 1000, apy: 0, monthlyContribution: 100, lumpFromSavings: false });
  assert.equal(proj[0].debt, 7750);
  assert.equal(proj[proj.length - 1].debt, 0);
  assert.equal(proj[proj.length - 1].date, plan.debtFree);
  assert.equal(proj[proj.length - 1].hysa, 1000 + 100 * plan.months + plan.paychecks[plan.paychecks.length - 1].leftover, 'HYSA grows by contributions + freed-up money');
  const planB = simulatePayoff(cards, { ...base, strategy: 'avalanche', lumpSum: 500 });
  assert.equal(projectPlan(planB, { balance: 1000, apy: 0, monthlyContribution: 0, lumpFromSavings: true })[0].hysa, 500, 'lump sum from HYSA is deducted');
  assert.equal(baselineAt([{ date: '2026-01-01', debt: 100, hysa: 0 }, { date: '2026-01-31', debt: 40, hysa: 30 }], '2026-01-16', 'debt'), 70);
}

// ----- payday checklist: payments update balances + history -----
{
  const {
    buildChecklist, checkChecklistItem, uncheckChecklistItem
  } = engine;
  const data = normalize({
    debts: [
      { id: 'a', name: 'Card A', balance: 1000, apr: 25, minPayment: 40 },
      { id: 'b', name: 'Card B', balance: 300, apr: 20, minPayment: 25 }
    ],
    budget: { debtPerPaycheck: 500, savingsPerPaycheck: 150, rentReserve: 700, payAnchor: '2026-09-25' },
    savings: { balance: 2000 }
  }, '2026-09-25');
  const plan = simulatePayoff(data.debts, { perPaycheck: 500, frequency: 'biweekly', payAnchor: '2026-09-25', today: '2026-09-25', strategy: 'avalanche' });
  const pc = plan.paychecks[0];
  assert.equal(pc.date, '2026-09-25');
  const list = buildChecklist(pc, data.budget, pc.date, '2026-09-25T15:00:00.000Z');
  data.payChecklists.push(list);
  assert.deepEqual(list.items.map((i) => i.key), ['debt:a', 'debt:b', 'hysa', 'rent']);
  assert.equal(list.items.find((i) => i.key === 'debt:a').planned, 475, 'Card A: its min + all extra (avalanche)');
  assert.equal(list.items.find((i) => i.key === 'debt:b').planned, 25, 'Card B: its minimum');
  assert.equal(list.items.find((i) => i.key === 'hysa').planned, 150);
  assert.equal(list.items.find((i) => i.key === 'rent').planned, 700);

  // Pay Card A a slightly different amount than planned.
  const r1 = checkChecklistItem(data, '2026-09-25', 'debt:a', 480, '2026-09-25T16:00:00.000Z');
  assert.ok(r1.ok && !r1.complete && !r1.paidOff);
  assert.equal(data.debts[0].balance, 520, 'balance reduced by the amount actually paid');
  const h = data.history[0];
  assert.equal(h.kind, 'payment'); assert.equal(h.debtId, 'a'); assert.equal(h.amount, 480);
  assert.equal(h.before, 1000); assert.equal(h.after, 520); assert.equal(h.source, 'payday');
  assert.equal(checkChecklistItem(data, '2026-09-25', 'debt:a', 480).ok, false, 'cannot check the same item twice');
  // Undo puts everything back.
  assert.equal(uncheckChecklistItem(data, '2026-09-25', 'debt:a'), true);
  assert.equal(data.debts[0].balance, 1000);
  assert.equal(data.history.length, 0, 'undo removes the logged payment');
  checkChecklistItem(data, '2026-09-25', 'debt:a', 475, '2026-09-25T16:00:00.000Z');
  // Card B: paying the full balance marks it paid.
  const rb = checkChecklistItem(data, '2026-09-25', 'debt:b', 300, '2026-09-25T16:01:00.000Z');
  assert.equal(rb.paidOff.id, 'b');
  assert.equal(data.debts[1].balance, 0); assert.equal(data.debts[1].paid, true);
  assert.equal(data.history[0].kind, 'paid');
  // HYSA transfer adds to savings; rent is just marked done.
  checkChecklistItem(data, '2026-09-25', 'hysa', 150, '2026-09-25T16:02:00.000Z');
  assert.equal(data.savings.balance, 2150);
  assert.equal(data.history[0].kind, 'savings'); assert.equal(data.history[0].amount, 150);
  const last = checkChecklistItem(data, '2026-09-25', 'rent', 700, '2026-09-25T16:03:00.000Z');
  assert.equal(last.complete, true, 'all 4 done → complete');
  assert.equal(data.payChecklists[0].completedAt, '2026-09-25T16:03:00.000Z');
  assert.equal(data.history.filter((x) => x.kind === 'payment').length, 2);
  // Undoing a payoff un-pays the card.
  uncheckChecklistItem(data, '2026-09-25', 'debt:b');
  assert.equal(data.debts[1].paid, false); assert.equal(data.debts[1].balance, 300);
  assert.equal(data.payChecklists[0].completedAt, null);
  // Checklist state survives a save/load round trip.
  const again = normalize(JSON.parse(JSON.stringify(data)), '2026-09-26');
  assert.deepEqual(again.payChecklists, data.payChecklists);
  // Last payday lookup (for past-due checklists).
  assert.equal(engine.toISO(engine.lastPaydayOnOrBefore('2026-09-25', 'biweekly', engine.parseISO('2026-10-08'))), '2026-09-25');
  assert.equal(engine.toISO(engine.lastPaydayOnOrBefore('2026-09-25', 'biweekly', engine.parseISO('2026-10-09'))), '2026-10-09');
}

// ----- drift: new card spending vs. allowance -----
{
  const { recordBalance, detectDrift, driftSummary, driftDelayDays } = engine;
  // Interest is not spending: $1,000 at 24% for 30 days ≈ $19.73 interest.
  assert.equal(detectDrift(1000, 1019, 24, 30), null);
  assert.deepEqual(detectDrift(1000, 1100, 24, 30), { rise: 80.27, interest: 19.73 });
  assert.equal(detectDrift(1000, 900, 24, 30), null);

  const data = normalize({
    debts: [
      { id: 'a', name: 'Card A', balance: 2000, apr: 0, minPayment: 50, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'b', name: 'Card B', balance: 1000, apr: 0, minPayment: 30, createdAt: '2026-09-01T00:00:00.000Z' },
      { id: 'l', name: 'Loan', type: 'loan', balance: 5000, apr: 0, minPayment: 100, createdAt: '2026-09-01T00:00:00.000Z' }
    ],
    budget: { debtPerPaycheck: 400, cardSpending: 150 }
  }, '2026-09-01');
  assert.equal(data.budget.cardSpending, 150);
  // Card A up $100 (within the $150 allowance)
  const d1 = recordBalance(data, data.debts[0], 2100, '2026-09-10T12:00:00.000Z', 'checkin');
  assert.deepEqual(d1, { rise: 100, interest: 0 });
  assert.equal(data.debts[0].balance, 2100);
  assert.equal(data.history[0].kind, 'balance'); assert.equal(data.history[0].before, 2000); assert.equal(data.history[0].after, 2100);
  let sm = driftSummary(data, '2026-09');
  assert.equal(sm.total, 100); assert.equal(sm.excess, 0, 'no warning inside the allowance');
  // Card B up $120: allowance has $50 left → $70 excess, all on Card B
  recordBalance(data, data.debts[1], 1120, '2026-09-12T12:00:00.000Z', 'update');
  sm = driftSummary(data, '2026-09');
  assert.equal(sm.total, 220); assert.equal(sm.excess, 70);
  assert.deepEqual(sm.byCard.map((c) => [c.debtId, c.rise, c.excess]), [['a', 100, 0], ['b', 120, 70]]);
  // Decreases, loans, and other months don't count
  assert.equal(recordBalance(data, data.debts[0], 1900, '2026-09-15T12:00:00.000Z', 'update'), null);
  assert.equal(recordBalance(data, data.debts[2], 5600, '2026-09-15T12:00:00.000Z', 'update'), null, 'loans are never flagged as spending');
  assert.equal(data.debts[2].balance, 5600, 'but the loan balance still updates');
  recordBalance(data, data.debts[0], 2500, '2026-10-02T12:00:00.000Z', 'checkin');
  assert.equal(driftSummary(data, '2026-09').total, 220);
  assert.equal(driftSummary(data, '2026-10').total, 600);
  assert.equal(driftSummary(data, '2026-10').excess, 450);
  // An allowance of $0 flags every rise
  data.budget.cardSpending = 0;
  assert.equal(driftSummary(data, '2026-09').excess, 220);
  // Days pushed back: extra balance delays the debt-free date
  const opts = { perPaycheck: 400, frequency: 'biweekly', payAnchor: '2026-09-25', today: '2026-09-24', strategy: 'avalanche' };
  const days = driftDelayDays(data.debts, opts, { b: 800 });
  assert.ok(days >= 28 && days <= 30, `$800 at $400/paycheck ≈ 2 paychecks later (got ${days})`);
  assert.equal(driftDelayDays(data.debts, opts, {}), 0);
}

// ----- investing projection after debt-free -----
{
  const { projectInvesting } = engine;
  // 0% return: pure contributions. $1,000/mo from Jan, 100% Roth capped at $7,000/yr.
  const flat = projectInvesting({ startISO: '2027-12-15', months: 24, monthly: 1000, rothPct: 100, rothLimit: 7000, annualReturn: 0, hysaStart: 5000, hysaMonthly: 200, hysaApy: 0 });
  assert.equal(flat.length, 25);
  const y1 = flat[12];   // Jan..Dec 2028
  assert.equal(y1.date, '2028-12-15');
  assert.equal(y1.roth, 7000, 'Roth capped at the annual limit');
  assert.equal(y1.brokerage, 5000, 'overflow goes to brokerage');
  assert.equal(y1.hysa, 5000 + 200 * 12);
  assert.equal(y1.total, 7000 + 5000 + 7400);
  assert.equal(flat[24].roth, 14000, 'limit resets each calendar year');
  assert.equal(flat[24].contributed, 24000);
  // Split: 40% to Roth, no cap
  const split = projectInvesting({ startISO: '2027-12-15', months: 12, monthly: 1000, rothPct: 40, rothLimit: 0, annualReturn: 0, hysaStart: 0, hysaMonthly: 0, hysaApy: 0 });
  assert.equal(split[12].roth, 4800); assert.equal(split[12].brokerage, 7200);
  // 7% return matches the closed-form annuity: FV = P * ((1+r)^n - 1) / r
  const grow = projectInvesting({ startISO: '2027-12-15', months: 120, monthly: 1000, rothPct: 0, rothLimit: 7000, annualReturn: 7, hysaStart: 0, hysaMonthly: 0, hysaApy: 0 });
  const r = Math.pow(1.07, 1 / 12) - 1;
  const fv = 1000 * (Math.pow(1 + r, 120) - 1) / r;
  assert.ok(Math.abs(grow[120].invested - fv) < 0.02, `${grow[120].invested} vs ${fv}`);
  assert.ok(Math.abs(grow[12].invested - 1000 * (Math.pow(1 + r, 12) - 1) / r) < 0.02);
  // HYSA compounds at its APY
  const h = projectInvesting({ startISO: '2027-12-15', months: 12, monthly: 0, rothPct: 100, rothLimit: 7000, annualReturn: 7, hysaStart: 10000, hysaMonthly: 0, hysaApy: 4 });
  assert.ok(Math.abs(h[12].hysa - 10400) < 0.02);
}

// ----- monthly summary -----
{
  const { ensureMonthlySummary, buildMonthlySummary, daysAheadOfPlan } = engine;
  const data = normalize({
    debts: [{ id: 'a', name: 'Card A', balance: 5000, apr: 24, minPayment: 100 }, { id: 'b', name: 'Card B', balance: 400, apr: 18, minPayment: 25 }],
    savings: { balance: 1000 }
  }, '2026-09-01');
  // First open in September: snapshot, nothing to summarize yet.
  assert.equal(ensureMonthlySummary(data, '2026-09-01T09:00:00.000Z'), true);
  assert.equal(data.monthlySummaries.length, 0);
  assert.equal(data.monthMarks['2026-09'].debt, 5400);
  // September activity
  data.history.unshift({ id: 'h1', at: '2026-09-10T12:00:00.000Z', kind: 'payment', debtId: 'a', debtName: 'Card A', amount: 600, before: 5000, after: 4400 });
  data.debts[0].balance = 4400;
  data.history.unshift({ id: 'h2', at: '2026-09-20T12:00:00.000Z', kind: 'payment', debtId: 'b', debtName: 'Card B', amount: 400, before: 400, after: 0 });
  data.history.unshift({ id: 'h3', at: '2026-09-20T12:00:00.000Z', kind: 'paid', debtId: 'b', debtName: 'Card B', amount: 0, before: 0, after: 0 });
  data.debts[1].balance = 0; data.debts[1].paid = true;
  data.savings.balance = 1300;
  data.baseline = { setAt: '2026-09-01', plan: 'A', strategy: 'avalanche', points: [{ date: '2026-09-01', debt: 5400, hysa: 1000 }, { date: '2026-10-01', debt: 4700, hysa: 1200 }, { date: '2026-11-01', debt: 4000, hysa: 1400 }] };
  // First open in October: September's recap is created once.
  assert.equal(ensureMonthlySummary(data, '2026-10-02T09:00:00.000Z'), true);
  assert.equal(ensureMonthlySummary(data, '2026-10-05T09:00:00.000Z'), false, 'only once per month');
  const sm = data.monthlySummaries[0];
  assert.equal(sm.month, '2026-09');
  assert.equal(sm.paidToDebt, 1000);
  assert.equal(sm.debtStart, 5400); assert.equal(sm.debtEnd, 4400); assert.equal(sm.debtChange, -1000);
  assert.equal(sm.hysaStart, 1000); assert.equal(sm.hysaChange, 300);
  assert.deepEqual(sm.paidOff, ['Card B']);
  assert.equal(sm.interestEst, r2(5000 * 24 / 1200 + 400 * 18 / 1200));
  // Plan expected $4,400 about 13 days into October; on Sep 30 we're already there → ahead.
  assert.ok(sm.aheadDays > 10 && sm.aheadDays < 16, `ahead ${sm.aheadDays}`);
  assert.equal(daysAheadOfPlan(data.baseline.points, '2026-10-01', 4700), 0);
  assert.ok(daysAheadOfPlan(data.baseline.points, '2026-11-01', 4700) < 0, 'behind when the plan got there earlier');
  // A month opened mid-way is summarized from that point on
  const mid = normalize({ debts: [{ id: 'a', name: 'A', balance: 1000, apr: 12, minPayment: 30 }] }, '2026-09-16');
  ensureMonthlySummary(mid, '2026-09-16T09:00:00.000Z');
  ensureMonthlySummary(mid, '2026-10-01T09:00:00.000Z');
  assert.equal(mid.monthlySummaries[0].interestEst, r2(1000 * 12 / 1200 * 15 / 30));
  assert.equal(buildMonthlySummary(mid, '2026-09', '2026-10-01T09:00:00.000Z').hysaChange, 0);
}

// ----- balance transfer check -----
{
  const { balanceTransferCheck } = engine;
  const opts = { ...base, strategy: 'avalanche' };
  const bt = balanceTransferCheck(cards, opts, 'a', { feePct: 3, months: 18, promoApr: 0 });
  assert.equal(bt.fee, 126);
  assert.equal(bt.promoEnd, '2028-03-24');
  assert.ok(bt.interestSaved > 0 && bt.net === r2(bt.interestSaved - bt.fee));
  assert.equal(bt.paidBeforePromoEnd, true);
  const short = balanceTransferCheck(cards, opts, 'a', { feePct: 5, months: 2, promoApr: 0 });
  assert.equal(short.paidBeforePromoEnd, false);
  assert.ok(short.net < bt.net);
  // promo APR is honored by the payoff engine
  const promoApr = simulatePayoff([{ id: 'p', name: 'P', balance: 1000, apr: 25, minPayment: 50, promoEnd: '2030-01-01', promoApr: 12 }], { ...base, perPaycheck: 100 });
  const zero = simulatePayoff([{ id: 'p', name: 'P', balance: 1000, apr: 25, minPayment: 50, promoEnd: '2030-01-01' }], { ...base, perPaycheck: 100 });
  assert.equal(zero.totalInterest, 0);
  assert.ok(promoApr.totalInterest > 0 && promoApr.totalInterest < simulatePayoff([{ id: 'p', name: 'P', balance: 1000, apr: 25, minPayment: 50 }], { ...base, perPaycheck: 100 }).totalInterest);
}

// ----- migration of data saved by the previous version (v2) -----
{
  const v2 = {
    version: 2,
    debts: [{ id: 'p', name: 'Platinum', type: 'card', balance: 18000, startBalance: 20000, apr: 12.99, minPayment: 400, promoEnd: '', paid: false, paidAt: null, createdAt: '2026-09-01T00:00:00Z', creditLimit: 19900, keepOpen: 1000, dueDay: 27 }],
    budget: { takeHome: 2600, frequency: 'biweekly', payAnchor: '2026-09-26', debtPerPaycheck: 1100, savingsPerPaycheck: 200, lumpSum: 0, rentReserve: 700, spending: 400, customItems: [{ id: 'g', name: 'Gym', amount: 30, freedLater: true }], freedLater: { spending: true }, lumpFromSavings: true },
    strategy: 'custom', customOrder: ['p'], activePlan: 'A',
    savings: { balance: 4600, goal: 10000, apy: 4.2, monthlyContribution: 500 },
    history: [{ id: 'h', at: '2026-09-24T00:00:00Z', kind: 'checkin', after: 18000, hysa: 4600 }],
    milestones: { 25: '2026-09-24T00:00:00Z' },
    customMilestones: [{ id: 'm', title: 'Platinum gone', reward: 'Dinner', type: 'debtPaid', debtId: 'p', value: 0, earnedAt: null }],
    checkins: [{ id: 'c', date: '2026-09-24', at: '2026-09-24T00:00:00Z', balances: { p: 18000 }, totalDebt: 18000, hysa: 4600 }],
    baseline: { setAt: '2026-09-24T00:00:00Z', plan: 'A', strategy: 'custom', points: [{ date: '2026-09-24', debt: 18000, hysa: 4600 }] }
  };
  const snapshot = JSON.parse(JSON.stringify(v2));
  const m = normalize(v2, '2026-10-01');
  assert.deepEqual(v2, snapshot, 'input not mutated');
  // Every v2 field is kept exactly
  for (const k of Object.keys(v2.debts[0])) assert.deepEqual(m.debts[0][k], v2.debts[0][k], `debt.${k}`);
  for (const k of Object.keys(v2.budget)) assert.deepEqual(m.budget[k], v2.budget[k], `budget.${k}`);
  for (const k of ['strategy', 'customOrder', 'activePlan', 'savings', 'history', 'milestones', 'customMilestones', 'checkins', 'baseline']) assert.deepEqual(m[k], v2[k], k);
  // New fields get safe defaults
  assert.equal(m.debts[0].promoApr, 0);
  assert.equal(m.budget.cardSpending, 0);
  assert.deepEqual(m.payChecklists, []);
  assert.equal(m.checklistSince, null);
  assert.deepEqual(m.drift, []);
  assert.deepEqual(m.afterPlan, { monthly: null, rothPct: 100, rothLimit: 7000, annualReturn: 7 });
  assert.deepEqual(m.monthlySummaries, []);
  assert.deepEqual(m.monthMarks, {});
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(m)), '2026-10-01'), m, 'idempotent');
  // Same plan before and after migration
  const o = { perPaycheck: 1100, frequency: 'biweekly', payAnchor: '2026-09-26', today: '2026-10-01', strategy: 'custom', customOrder: ['p'] };
  assert.deepEqual(simulatePayoff(m.debts, o).payoffs, simulatePayoff(v2.debts, o).payoffs);
  // v1 data (first version) still migrates all the way up
  const v1m = normalize({ debts: [{ id: 'x', name: 'Old', balance: 100, apr: 10, minPayment: 10 }], budget: { debtPerPaycheck: 50 }, strategy: 'snowball' }, '2026-10-01');
  assert.equal(v1m.budget.cardSpending, 0); assert.equal(v1m.afterPlan.annualReturn, 7); assert.equal(v1m.debts[0].promoApr, 0); assert.equal(v1m.strategy, 'snowball');
  // Custom after-plan settings are kept, incl. an explicit "no Roth limit" (0)
  const ap = normalize({ afterPlan: { monthly: 1500, rothPct: 60, rothLimit: 0, annualReturn: 5.5 } }, '2026-10-01').afterPlan;
  assert.deepEqual(ap, { monthly: 1500, rothPct: 60, rothLimit: 0, annualReturn: 5.5 });
}

// ----- migration of data saved by EVERY previous version (v1, v2, v3) to v4 -----
{
  const v1 = {
    version: 1,
    debts: [{ id: 'd1', name: 'Card', type: 'card', balance: 1500, startBalance: 2000, apr: 22, minPayment: 40, promoEnd: '', paid: false, paidAt: null, createdAt: '2026-01-01T00:00:00Z' }],
    budget: { takeHome: 2000, frequency: 'biweekly', payAnchor: '2026-09-25', debtPerPaycheck: 300, savingsPerPaycheck: 100, lumpSum: 0 },
    strategy: 'snowball', activePlan: 'A', savings: { balance: 800, goal: 5000, apy: 4, monthlyContribution: null },
    history: [{ id: 'h1', at: '2026-09-01T00:00:00Z', kind: 'payment', debtId: 'd1', debtName: 'Card', amount: 100, before: 1600, after: 1500 }],
    milestones: { 25: '2026-09-01T00:00:00Z' }
  };
  const v2 = Object.assign(JSON.parse(JSON.stringify(v1)), {
    version: 2, customOrder: ['d1'], customMilestones: [{ id: 'm1', title: 'Card gone', reward: 'Pizza', type: 'debtPaid', debtId: 'd1', value: 0, earnedAt: null }],
    checkins: [{ id: 'c1', date: '2026-09-10', at: '2026-09-10T00:00:00Z', balances: { d1: 1500 }, totalDebt: 1500, hysa: 800 }],
    baseline: { setAt: '2026-09-10T00:00:00Z', plan: 'A', strategy: 'snowball', points: [{ date: '2026-09-10', debt: 1500, hysa: 800 }] }
  });
  v2.debts[0] = Object.assign(v2.debts[0], { creditLimit: 5000, keepOpen: 500, dueDay: 12 });
  Object.assign(v2.budget, { rentReserve: 600, spending: 200, customItems: [{ id: 'ci', name: 'Gym', amount: 25, freedLater: true }], freedLater: { spending: true }, lumpFromSavings: false });
  const v3 = Object.assign(JSON.parse(JSON.stringify(v2)), {
    version: 3, checklistSince: '2026-09-20',
    payChecklists: [{ date: '2026-09-25', createdAt: '2026-09-25T12:00:00Z', dismissed: false, completedAt: null, items: [{ key: 'debt:d1', kind: 'debt', debtId: 'd1', label: 'Card', planned: 300, done: true, paid: 300, historyIds: ['h9'] }] }],
    drift: [{ id: 'x1', debtId: 'd1', debtName: 'Card', at: '2026-09-15T00:00:00Z', month: '2026-09', before: 1400, after: 1500, rise: 100, interest: 0, source: 'checkin' }],
    afterPlan: { monthly: 900, rothPct: 80, rothLimit: 7000, annualReturn: 6 },
    monthlySummaries: [{ month: '2026-08', createdAt: '2026-09-01T00:00:00Z', paidToDebt: 500, dismissed: true }],
    monthMarks: { '2026-09': { at: '2026-09-01T00:00:00Z', debt: 1600, hysa: 700, balances: { d1: 1600 } } }
  });
  v3.debts[0].promoApr = 0;
  v3.budget.cardSpending = 150;
  for (const [label, src] of [['v1', v1], ['v2', v2], ['v3', v3]]) {
    const snapshot = JSON.parse(JSON.stringify(src));
    const m = normalize(src, '2026-09-25');
    assert.deepEqual(src, snapshot, `${label}: input not mutated`);
    assert.equal(m.version, 5, `${label}: bumped to the current version`);
    // every field the old version saved is still there with the same value
    const same = (a, b, path) => {
      if (a && typeof a === 'object' && !Array.isArray(a)) { for (const k of Object.keys(a)) { if (k === 'version') continue; same(a[k], b[k], `${path}.${k}`); } }
      else if (Array.isArray(a)) { assert.equal(b.length, a.length, `${path} length`); a.forEach((x, i) => same(x, b[i], `${path}[${i}]`)); }
      else assert.deepEqual(b, a, path);
    };
    same(src, m, label);
    // v4 defaults
    assert.deepEqual(m.accounts, []);
    assert.deepEqual(m.netWorthHistory, []);
    assert.deepEqual(m.nwMilestones, {});
    assert.equal(m.nwMilestonesInit, false);
    assert.deepEqual(m.subscriptions, []);
    assert.deepEqual(m.onboarding, { completedAt: null, skippedAt: null });
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(m)), '2026-09-25'), m, `${label}: idempotent`);
    const o = { perPaycheck: 300, frequency: 'biweekly', payAnchor: '2026-09-25', today: '2026-09-25', strategy: 'snowball' };
    assert.deepEqual(simulatePayoff(m.debts, o).payoffs, simulatePayoff(src.debts, o).payoffs, `${label}: same payoff plan`);
  }
  // v4 fields round-trip and bad values are cleaned up
  const v4 = normalize({
    accounts: [{ id: 'a1', name: 'Checking', type: 'checking', balance: 1200.5 }, { id: 'a2', name: 'Weird', type: 'spaceship', balance: -5 }],
    subscriptions: [{ id: 's1', name: 'Music', amount: 10.99, cycle: 'monthly', nextRenewal: '2026-10-31', category: 'Music', cardId: 'd1', review: true }, { name: 'Bad', cycle: 'daily', amount: 'x' }],
    netWorthHistory: [{ month: '2026-09', date: '2026-09-25', assets: 2000, liabilities: 1500, netWorth: 500 }, { month: 'nope' }],
    onboarding: { skippedAt: '2026-09-25T00:00:00Z' }
  }, '2026-09-25');
  assert.equal(v4.accounts[1].type, 'other'); assert.equal(v4.accounts[1].balance, 0); assert.equal(v4.accounts[0].archived, false);
  assert.equal(v4.subscriptions[0].anchorDay, 31);
  assert.equal(v4.subscriptions[1].cycle, 'monthly'); assert.equal(v4.subscriptions[1].amount, 0); assert.equal(v4.subscriptions[1].cardId, 'other');
  assert.equal(v4.netWorthHistory.length, 1);
  assert.equal(v4.onboarding.skippedAt, '2026-09-25T00:00:00Z');
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(v4)), '2026-09-25'), v4);
}

// ----- net worth: debts and HYSA are linked, never double counted -----
{
  const { netWorth, recordNetWorthSnapshot, netWorthChange, checkNetWorthMilestones } = engine;
  const data = normalize({
    debts: [
      { id: 'c', name: 'Card', balance: 3000, apr: 20, minPayment: 60 },
      { id: 'l', name: 'Car loan', type: 'loan', balance: 8000, apr: 6, minPayment: 250 },
      { id: 'p', name: 'Old card', balance: 0, apr: 20, minPayment: 0, paid: true }
    ],
    savings: { balance: 5000 },
    accounts: [
      { id: 'chk', name: 'Checking', type: 'checking', balance: 2500 },
      { id: 'rth', name: 'Roth', type: 'roth', balance: 9000 },
      { id: 'car', name: 'Car', type: 'vehicle', balance: 12000 },
      { id: 'old', name: 'Closed brokerage', type: 'brokerage', balance: 4000, archived: true },
      { id: 'mtg', name: 'Mortgage', type: 'mortgage', balance: 1000 }
    ]
  }, '2026-09-25');
  let nw = netWorth(data);
  assert.equal(nw.assets, 5000 + 2500 + 9000 + 12000, 'HYSA from savings + active assets; archived excluded');
  assert.equal(nw.liabilities, 3000 + 8000 + 1000, 'unpaid debts + liability accounts; paid debts excluded');
  assert.equal(nw.netWorth, 28500 - 12000);
  assert.equal(nw.items.filter((i) => i.type === 'hysa').length, 1, 'HYSA counted once');
  assert.equal(nw.items.filter((i) => i.linked === 'debt').length, 2, 'each unpaid debt counted once');
  assert.deepEqual(nw.byType, { hysa: 5000, checking: 2500, roth: 9000, vehicle: 12000, debtCard: 3000, debtLoan: 8000, mortgage: 1000 });
  // Updating the HYSA or a debt (e.g. via check-in) changes net worth exactly once
  data.savings.balance = 5500; data.debts[0].balance = 2500;
  nw = netWorth(data);
  assert.equal(nw.netWorth, 16500 + 500 + 500);
  // Snapshots: one per month, replaced within the month; change vs last month
  recordNetWorthSnapshot(data, '2026-08-31T12:00:00.000Z');
  data.netWorthHistory[0].netWorth = 15000;
  assert.deepEqual(netWorthChange(data, '2026-09-25T12:00:00.000Z'), { from: 15000, month: '2026-08', change: 2500 });
  recordNetWorthSnapshot(data, '2026-09-10T12:00:00.000Z');
  recordNetWorthSnapshot(data, '2026-09-25T12:00:00.000Z');
  assert.deepEqual(data.netWorthHistory.map((x) => x.month), ['2026-08', '2026-09']);
  assert.equal(data.netWorthHistory[1].netWorth, 17500);
  assert.equal(netWorthChange(data, '2026-09-25T12:00:00.000Z').from, 15000, 'this month\'s snapshot is not "last month"');
  // Milestones: first run records what's already passed without celebrating
  assert.deepEqual(checkNetWorthMilestones(data, '2026-09-25T12:00:00.000Z', true), []);
  assert.deepEqual(data.nwMilestones, { 0: 'before', 10000: 'before' });
  data.accounts[1].balance = 17000;   // Roth jumps → net worth 25,500
  assert.deepEqual(checkNetWorthMilestones(data, '2026-10-01T12:00:00.000Z', false), [25000]);
  assert.equal(data.nwMilestones[25000], '2026-10-01T12:00:00.000Z');
  assert.deepEqual(checkNetWorthMilestones(data, '2026-10-02T12:00:00.000Z', false), [], 'never celebrated twice');
  // Negative net worth reaching $0 is the first milestone
  const neg = normalize({ debts: [{ id: 'x', name: 'X', balance: 1000, apr: 10, minPayment: 20 }], savings: { balance: 200 } }, '2026-09-25');
  checkNetWorthMilestones(neg, '2026-09-25T00:00:00Z', true);
  assert.deepEqual(neg.nwMilestones, {});
  neg.debts[0].balance = 150;
  assert.deepEqual(checkNetWorthMilestones(neg, '2026-10-25T00:00:00Z', false), [0]);
}

// ----- subscriptions: totals across billing cycles, renewals, cut it -----
{
  const { subscriptionTotals, subYearly, subMonthly, renewalsBetween, rollRenewals, cutItImpact } = engine;
  const subs = normalize({ subscriptions: [
    { id: 'w', name: 'Coffee club', amount: 10, cycle: 'weekly', nextRenewal: '2026-09-28', category: 'Food', cardId: 'c' },
    { id: 'm', name: 'Streaming', amount: 15.49, cycle: 'monthly', nextRenewal: '2026-10-31', category: 'Streaming', cardId: 'c' },
    { id: 'q', name: 'Box', amount: 30, cycle: 'quarterly', nextRenewal: '2026-11-15', category: 'Shopping', cardId: 'other' },
    { id: 'y', name: 'Cloud', amount: 99.99, cycle: 'yearly', nextRenewal: '2027-02-01', category: 'Software' },
    { id: 'x', name: 'Cancelled gym', amount: 50, cycle: 'monthly', nextRenewal: '2026-10-05', category: 'Fitness', cancelledAt: '2026-09-01T00:00:00Z' }
  ] }, '2026-09-25').subscriptions;
  assert.equal(subYearly(subs[0]), 520);    assert.equal(subMonthly(subs[0]), 43.33);
  assert.equal(subYearly(subs[1]), 185.88); assert.equal(subMonthly(subs[1]), 15.49);
  assert.equal(subYearly(subs[2]), 120);    assert.equal(subMonthly(subs[2]), 10);
  assert.equal(subYearly(subs[3]), 99.99);  assert.equal(subMonthly(subs[3]), 8.33);
  const debts = [{ id: 'c', name: 'Visa', balance: 2000, apr: 24, minPayment: 50 }];
  const tot = subscriptionTotals(subs, debts);
  assert.equal(tot.count, 4, 'cancelled subscriptions are excluded');
  assert.equal(tot.yearly, r2(520 + 185.88 + 120 + 99.99));
  assert.equal(tot.monthly, r2(tot.yearly / 12));
  assert.deepEqual(tot.byCategory.map((g) => [g.name, g.yearly]), [['Food', 520], ['Streaming', 185.88], ['Shopping', 120], ['Software', 99.99]]);
  assert.deepEqual(tot.byCard.map((g) => [g.name, g.yearly, g.count]), [['Visa', 705.88, 2], ['Other / not a tracked card', 219.99, 2]]);
  // Renewals: month-end anchors clamp and come back; weekly/quarterly/yearly step correctly
  assert.deepEqual(renewalsBetween(subs[1], '2026-10-01', '2027-03-31'), ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  assert.deepEqual(renewalsBetween(subs[0], '2026-09-25', '2026-10-15'), ['2026-09-28', '2026-10-05', '2026-10-12']);
  assert.deepEqual(renewalsBetween(subs[2], '2026-09-25', '2027-06-30'), ['2026-11-15', '2027-02-15', '2027-05-15']);
  assert.deepEqual(renewalsBetween(subs[3], '2026-09-25', '2028-03-01'), ['2027-02-01', '2028-02-01']);
  assert.deepEqual(renewalsBetween(subs[4], '2026-09-25', '2026-12-31'), [], 'cancelled never renews');
  assert.deepEqual(renewalsBetween(subs[1], '2026-11-01', '2026-11-29'), [], 'nothing in a window with no renewal');
  // Past renewal dates roll forward
  const data = normalize({ subscriptions: [{ id: 'm', name: 'M', amount: 5, cycle: 'monthly', nextRenewal: '2026-07-31' }] }, '2026-09-25');
  assert.equal(rollRenewals(data, '2026-09-25'), true);
  assert.equal(data.subscriptions[0].nextRenewal, '2026-09-30');
  assert.equal(rollRenewals(data, '2026-09-25'), false);
  // Cut it: yearly savings + days sooner via the payoff engine
  const opts = { perPaycheck: 300, frequency: 'biweekly', payAnchor: '2026-10-02', today: '2026-09-24', strategy: 'avalanche' };
  const cut = cutItImpact(cards, opts, subs[0]);
  assert.equal(cut.yearly, 520); assert.equal(cut.monthly, 43.33);
  assert.equal(cut.perPaycheck, r2(43.33 / (26 / 12)));
  const faster = simulatePayoff(cards, { ...opts, perPaycheck: 300 + cut.perPaycheck });
  const base = simulatePayoff(cards, opts);
  assert.equal(cut.daysSooner, Math.round((parseISO(base.debtFree) - parseISO(faster.debtFree)) / 86400000));
  assert.ok(cut.daysSooner > 0, `cutting $520/yr frees up days (got ${cut.daysSooner})`);
  assert.ok(cut.interestSaved > 0);
  assert.equal(cutItImpact([], opts, subs[0]).daysSooner, 0, 'no debt → nothing sooner');
}

// ===================== PHASE 2 =====================
const preset = (id) => engine.CARD_PRESETS.find((p) => p.id === id);
const walletData = (extra = {}) => normalize(Object.assign({
  wallet: [
    Object.assign(JSON.parse(JSON.stringify(preset('amex-bcp'))), { id: 'bcp' }),
    Object.assign(JSON.parse(JSON.stringify(preset('apple'))), { id: 'apl' }),
    Object.assign(JSON.parse(JSON.stringify(preset('amex-plat'))), { id: 'plat', cpp: 2 })
  ]
}, extra), '2026-09-25');

// ----- merchant category mapping -----
{
  const { merchantCategory } = engine;
  const data = normalize({ merchants: [{ name: 'Costco', category: 'supermarket' }, { name: 'Corner Deli', category: 'dining' }] }, '2026-09-25');
  assert.equal(merchantCategory(data, 'Harris Teeter').category, 'supermarket');
  assert.equal(merchantCategory(data, '  harris   teeter ').name, 'Harris Teeter', 'case and spacing insensitive');
  assert.equal(merchantCategory(data, 'Walmart').category, 'superstore', 'Walmart is NOT a supermarket');
  assert.equal(merchantCategory(data, 'Target').category, 'superstore', 'Target is NOT a supermarket');
  assert.equal(merchantCategory(normalize({}, '2026-09-25'), 'Costco').category, 'wholesale', 'Costco is a warehouse club by default');
  assert.equal(merchantCategory(data, 'Costco').category, 'supermarket', 'your merchant list overrides the built-in one');
  assert.equal(merchantCategory(data, 'Costco').source, 'mine');
  assert.equal(merchantCategory(data, 'Amazon').category, 'online');
  assert.equal(merchantCategory(data, 'Corner Deli').category, 'dining', 'merchants you add are found');
  assert.equal(merchantCategory(data, 'harris').name, 'Harris Teeter', 'partial match');
  assert.deepEqual(merchantCategory(data, 'gas'), { name: null, category: 'gas', source: 'category' }, 'category names work too');
  assert.equal(merchantCategory(data, 'Supermarkets').category, 'supermarket');
  assert.equal(merchantCategory(data, 'zzzz'), null);
  assert.equal(merchantCategory(data, ''), null);
}

// ----- earn-rule ranking with caps and points values -----
{
  const { rankCards, earnFor, spentTowardRule, yearlyEarn } = engine;
  const data = walletData();
  const bcp = data.wallet[0], apl = data.wallet[1], plat = data.wallet[2];
  // Supermarket $100: BCP 6% ($6) > Apple 2% ($2) > Platinum 1x at 2¢ ($2), ties broken by lower fee
  let r = rankCards(data, { category: 'supermarket', merchant: 'Harris Teeter', amount: 100, today: '2026-09-25' });
  assert.deepEqual(r.ranked.map((x) => [x.card.id, x.value]), [['bcp', 6], ['apl', 2], ['plat', 2]]);
  assert.equal(r.best.card.id, 'bcp');
  // Walmart isn't a supermarket: BCP falls to 1%, Apple's 2% wins
  r = rankCards(data, { category: 'superstore', merchant: 'Walmart', amount: 100, today: '2026-09-25' });
  assert.equal(r.best.card.id, 'apl'); assert.equal(r.best.value, 2);
  // Merchant-specific rule: Apple 3% at Uber beats BCP 3% transit (tie → lower fee), Platinum 1x·2¢
  r = rankCards(data, { category: 'transit', merchant: 'Uber', amount: 50, today: '2026-09-25' });
  assert.deepEqual(r.ranked.map((x) => [x.card.id, x.value]), [['apl', 1.5], ['bcp', 1.5], ['plat', 1]]);
  // Points value: Platinum flights 5x at 2¢ = 10%
  r = rankCards(data, { category: 'flights', merchant: 'Delta', amount: 400, today: '2026-09-25' });
  assert.equal(r.best.card.id, 'plat'); assert.equal(r.best.value, 40); assert.equal(r.best.effectivePct, 10);
  plat.cpp = 0.6;   // a lower cents-per-point value changes the answer
  assert.equal(earnFor(plat, 'flights', 'Delta', 400).value, 12);
  plat.cpp = 2;
  // Cap: $6,000/calendar year at 6%, then 1%. Log $5,950 this year → $100 purchase earns 50×6% + 50×1%
  data.cardSpend.push({ id: 's1', cardId: 'bcp', category: 'supermarket', merchant: 'Harris Teeter', amount: 5950, date: '2026-03-01' });
  data.cardSpend.push({ id: 's0', cardId: 'bcp', category: 'supermarket', merchant: '', amount: 999, date: '2025-12-20' });   // last year: doesn't count
  data.cardSpend.push({ id: 's2', cardId: 'bcp', category: 'gas', merchant: '', amount: 300, date: '2026-04-01' });           // other category: doesn't count
  const supRule = bcp.rules.find((x) => x.category === 'supermarket');
  assert.equal(spentTowardRule(data, bcp, supRule, '2026-09-25'), 5950);
  r = rankCards(data, { category: 'supermarket', merchant: 'Harris Teeter', amount: 100, today: '2026-09-25' });
  const b = r.ranked.find((x) => x.card.id === 'bcp');
  assert.equal(b.value, 3.5); assert.equal(b.partial, true); assert.equal(b.capRemaining, 50);
  // Cap fully used → recommendation switches to Apple
  data.cardSpend.push({ id: 's3', cardId: 'bcp', category: 'supermarket', merchant: '', amount: 50, date: '2026-09-01' });
  r = rankCards(data, { category: 'supermarket', merchant: 'Harris Teeter', amount: 100, today: '2026-09-25' });
  assert.equal(r.best.card.id, 'apl', 'cap hit → switch cards');
  assert.equal(r.ranked.find((x) => x.card.id === 'bcp').capHit, true);
  // …and resets in the new calendar year
  r = rankCards(data, { category: 'supermarket', merchant: 'Harris Teeter', amount: 100, today: '2027-01-02' });
  assert.equal(r.best.card.id, 'bcp');
  // Paying down a card: flagged, and never the "best" pick
  const debtData = walletData({ debts: [{ id: 'd-bcp', name: 'Blue Cash', balance: 1200, apr: 25, minPayment: 40 }] });
  debtData.wallet[0].debtId = 'd-bcp';
  r = rankCards(debtData, { category: 'supermarket', merchant: 'Harris Teeter', amount: 100, today: '2026-09-25' });
  assert.equal(r.ranked[0].card.id, 'bcp'); assert.equal(r.ranked[0].payingDown, true);
  assert.equal(r.best.card.id, 'apl', 'best skips cards with a balance being paid down');
  debtData.debts[0].paid = true;
  assert.equal(rankCards(debtData, { category: 'supermarket', merchant: null, amount: 100, today: '2026-09-25' }).best.card.id, 'bcp');
  // Yearly value with an annual cap: $700/mo groceries = $8,400/yr → 6,000×6% + 2,400×1% = $384
  assert.equal(yearlyEarn(bcp, 'supermarket', 700), 384);
  // Monthly caps scale to a year
  const mcap = engine.normalizeWalletCard({ name: 'M', rules: [{ category: 'dining', rate: 5, cap: 100, capPeriod: 'month', afterRate: 1 }, { category: 'everything', rate: 1 }] });
  assert.equal(yearlyEarn(mcap, 'dining', 200), r2(1200 * 0.05 + 1200 * 0.01));
}

// ----- card credits: periods, resets, used toggles -----
{
  const { creditPeriod, toggleCreditUsed, creditUsed, creditsSummary, expiringCredits } = engine;
  const c = (period, extra = {}) => Object.assign({ id: 'c', name: 'X', amount: 10, period, resetMonth: 1, used: {} }, extra);
  assert.deepEqual(creditPeriod(c('monthly'), '2026-09-25'), { key: '2026-09-01', start: '2026-09-01', reset: '2026-10-01', daysLeft: 6 });
  assert.equal(creditPeriod(c('monthly'), '2026-12-31').reset, '2027-01-01');
  assert.deepEqual(creditPeriod(c('quarterly'), '2026-08-15'), { key: '2026-07-01', start: '2026-07-01', reset: '2026-10-01', daysLeft: 47 });
  assert.equal(creditPeriod(c('semiannual'), '2026-03-10').reset, '2026-07-01');
  assert.equal(creditPeriod(c('semiannual'), '2026-09-25').key, '2026-07-01');
  assert.equal(creditPeriod(c('calendarYear'), '2026-09-25').reset, '2027-01-01');
  // Card-year credit that resets every May
  assert.deepEqual(creditPeriod(c('annual', { resetMonth: 5 }), '2026-03-01'), { key: '2025-05-01', start: '2025-05-01', reset: '2026-05-01', daysLeft: 61 });
  assert.equal(creditPeriod(c('annual', { resetMonth: 5 }), '2026-05-01').key, '2026-05-01');
  // Used toggles belong to one period and clear themselves when it resets
  const uber = c('monthly', { amount: 15 });
  assert.equal(toggleCreditUsed(uber, '2026-09-25', '2026-09-25T10:00:00Z'), true);
  assert.equal(creditUsed(uber, '2026-09-30'), true);
  assert.equal(creditUsed(uber, '2026-10-01'), false, 'a new period starts unused');
  assert.equal(toggleCreditUsed(uber, '2026-09-26'), false, 'toggle back off');
  toggleCreditUsed(uber, '2026-08-10'); toggleCreditUsed(uber, '2026-09-10');
  const card = engine.normalizeWalletCard({ name: 'Plat', annualFee: 895, credits: [uber, c('quarterly', { id: 'q', amount: 100, used: { '2026-07-01': 'x', '2025-10-01': 'x' } }), c('monthly', { id: 'y', name: 'Y', amount: 5 })] });
  assert.deepEqual(creditsSummary(card, '2026-09-25'), { captured: 130, potential: 15 * 12 + 400 + 60, fee: 895, net: 130 - 895 });
  // Unused credits resetting within 7 days
  const data = normalize({ wallet: [card] }, '2026-09-25');
  const exp = expiringCredits(data, '2026-09-25', 7);
  assert.deepEqual(exp.map((e) => [e.credit.name, e.period.daysLeft, e.lastDay]), [['Y', 6, '2026-09-30']], 'only the unused credit that resets soon');
  assert.equal(expiringCredits(data, '2026-09-20', 7).length, 0, 'nothing resets within a week of Sep 20');
}

// ----- mortgage payment and DTI max-price math -----
{
  const { monthlyPI, housingPayment, maxPriceForDTI, affordability, cashToClose } = engine;
  assert.equal(monthlyPI(200000, 6, 30), 1199.1);    // standard amortization
  assert.equal(monthlyPI(300000, 7, 30), 1995.91);
  assert.equal(monthlyPI(120000, 0, 30), 333.33);    // 0% rate
  const h = Object.assign(engine.defaultHome(), { downPct: 5, closingPct: 3, ratePct: 6.5, termYears: 30, taxRatePct: 1.2, insuranceYr: 1800, pmiRatePct: 0.5, hoaMonthly: 50, grossIncomeYr: 90000 });
  const p = housingPayment(300000, h);
  assert.equal(p.loan, 285000); assert.equal(p.down, 15000);
  assert.equal(p.pi, monthlyPI(285000, 6.5, 30));
  assert.equal(p.tax, 300); assert.equal(p.ins, 150); assert.equal(p.pmi, 118.75); assert.equal(p.hoa, 50);
  assert.equal(p.total, r2(p.pi + 300 + 150 + 118.75 + 50));
  assert.equal(housingPayment(300000, Object.assign({}, h, { downPct: 20 })).pmi, 0, 'no PMI at 20% down');
  // 28% of $7,500/mo = $2,100 for housing; the max price is the highest one that fits
  const front = maxPriceForDTI(h, 28, 0);
  assert.ok(housingPayment(front, h).total <= 2100 && housingPayment(front + 200, h).total > 2100, `front-end max ${front}`);
  // Back-end 36% with $600/mo of other debt = $2,100 left for housing too
  assert.equal(maxPriceForDTI(h, 36, 600), front);
  const a = affordability(h, 900);
  assert.equal(a.max, Math.min(a.front28, a.back36));
  assert.ok(a.back36 < a.front28 && a.back43 > a.back36, 'debts tighten back-end; 43% allows more');
  assert.equal(affordability(h, 0).max, front, 'with no other debt the 28% front-end limit binds');
  assert.equal(maxPriceForDTI(Object.assign({}, h, { grossIncomeYr: 0 }), 28, 0), 0);
  assert.deepEqual(cashToClose(300000, h, 3000), { down: 15000, closing: 9000, emergency: 9000, total: 33000 });
}

// ----- down-payment-ready date -----
{
  const { homeReadyDate } = engine;
  const points = [{ date: '2026-09-25', debt: 10000, hysa: 5000 }, { date: '2026-10-01', debt: 8000, hysa: 5500 }, { date: '2026-11-01', debt: 4000, hysa: 6000 }, { date: '2026-11-20', debt: 0, hysa: 6000 }];
  // Already reached during the debt plan
  assert.deepEqual(homeReadyDate({ points, debtFree: '2026-11-20', apy: 0, monthlyContribution: 500, freedMonthly: 2000, target: 5500 }), { date: '2026-10-01', monthsAfterDebtFree: -1, hysaAtDate: 5500 });
  // After debt-free: +$500 contribution + $2,000 freed each month, 0% APY → $6,000 + 2×$2,500 = $11,000 in Jan
  assert.deepEqual(homeReadyDate({ points, debtFree: '2026-11-20', apy: 0, monthlyContribution: 500, freedMonthly: 2000, target: 11000 }), { date: '2027-01-01', monthsAfterDebtFree: 2, hysaAtDate: 11000 });
  assert.equal(homeReadyDate({ points, debtFree: '2026-11-20', apy: 0, monthlyContribution: 500, freedMonthly: 2000, target: 11001 }).date, '2027-02-01');
  // Today when it's already there
  assert.equal(homeReadyDate({ points, debtFree: '2026-11-20', apy: 0, monthlyContribution: 0, freedMonthly: 0, target: 4000 }).date, '2026-09-25');
  // Never, if nothing is being saved
  assert.equal(homeReadyDate({ points, debtFree: '2026-11-20', apy: 0, monthlyContribution: 0, freedMonthly: 0, target: 1e6, maxMonths: 24 }), null);
}

// ----- insights: generation and dismissal -----
{
  const { computeInsights, visibleInsights, dismissInsight } = engine;
  const fmt = (v) => '$' + Math.round(v).toLocaleString('en-US');
  const data = walletData({
    debts: [{ id: 'd1', name: 'Card', balance: 12000, apr: 22, minPayment: 240, creditLimit: 15000 }],
    budget: { debtPerPaycheck: 400, savingsPerPaycheck: 200, takeHome: 2500, frequency: 'biweekly', payAnchor: '2026-10-02', cardSpending: 100 },
    savings: { balance: 4000, apy: 4 },
    subscriptions: [{ id: 's', name: 'Streamer', amount: 20, cycle: 'monthly', nextRenewal: '2026-10-10', review: true }, { id: 't', name: 'Gym', amount: 45, cycle: 'monthly', nextRenewal: '2026-10-03', review: true }],
    spendProfile: { supermarket: 600, gas: 100 },
    home: { priceMin: 250000, priceMax: 300000, downPct: 3, closingPct: 3, ratePct: 6.5, taxRatePct: 1, insuranceYr: 1500, grossIncomeYr: 85000 }
  });
  data.drift.push({ id: 'dr', debtId: 'd1', debtName: 'Card', at: '2026-09-20T12:00:00Z', month: '2026-09', rise: 400, before: 2600, after: 3000 });
  const all = computeInsights(data, '2026-09-25', fmt);
  const ids = all.map((i) => i.id);
  // Credit resets in 6 days, unused (Disney credit on BCP, monthly credits on Platinum)
  assert.ok(ids.some((x) => x.startsWith('credit:bcp:')), 'unused credit expiring soon');
  assert.ok(all.find((x) => x.id.startsWith('credit:')).text.includes('resets in 6 days, unused'));
  assert.ok(ids.includes('drift:2026-09') && all.find((i) => i.id === 'drift:2026-09').text.includes('$300'), 'drift beyond allowance');
  const best = all.find((i) => i.id === 'bestcard:supermarket');
  assert.ok(best, 'best card for groceries');
  assert.equal(best.text, `Harris Teeter on **Amex Blue Cash Preferred** earns **${fmt((6000 * 0.06 + 1200 * 0.01) - 7200 * 0.02)} more a year** than Apple Card.`);
  const rev = all.find((i) => i.id === 'review-subs');
  assert.ok(rev && /moves debt-free day up \*\*\d+ days?\*\*/.test(rev.text), 'flagged subscriptions → days sooner');
  assert.ok(ids.includes('home-ready'), 'down payment timing');
  assert.ok(ids.includes('utilization'));
  // Every insight has a type, priority, action and signature; sorted by priority
  all.forEach((i) => { assert.ok(i.type && Number.isFinite(i.priority) && i.action && i.action.tab && i.sig !== undefined, i.id); });
  assert.deepEqual(all.map((i) => i.priority), all.map((i) => i.priority).slice().sort((a, b) => b - a));
  // Dismiss: gone while the numbers hold, back when they change meaningfully
  const drift = all.find((i) => i.id === 'drift:2026-09');
  dismissInsight(data, drift, '2026-09-25T13:00:00Z');
  assert.ok(!visibleInsights(computeInsights(data, '2026-09-25', fmt), data.insightDismissals).some((i) => i.id === drift.id), 'dismissed');
  data.drift[0].rise = 402;   // tiny change: still dismissed
  assert.ok(!visibleInsights(computeInsights(data, '2026-09-25', fmt), data.insightDismissals).some((i) => i.id === drift.id), 'small change keeps it dismissed');
  data.drift[0].rise = 900;   // meaningful change: comes back
  assert.ok(visibleInsights(computeInsights(data, '2026-09-25', fmt), data.insightDismissals).some((i) => i.id === drift.id), 'returns when numbers change');
  // Dismissals survive save/load
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(data)), '2026-09-25').insightDismissals, data.insightDismissals);
  // Using the credit removes that insight
  const exp = all.find((x) => x.id.startsWith('credit:bcp:'));
  engine.toggleCreditUsed(data.wallet[0].credits[0], '2026-09-25');
  assert.ok(!computeInsights(data, '2026-09-25', fmt).some((i) => i.id === exp.id));
  // Empty data → no crash, nothing to say
  assert.deepEqual(computeInsights(normalize({}, '2026-09-25'), '2026-09-25', fmt), []);
}

// ----- migration from every previous version (v1…v4) to v5 -----
{
  const v1 = { version: 1, debts: [{ id: 'd1', name: 'Card', type: 'card', balance: 1500, startBalance: 2000, apr: 22, minPayment: 40, promoEnd: '', paid: false, paidAt: null, createdAt: '2026-01-01T00:00:00Z' }],
    budget: { takeHome: 2000, frequency: 'biweekly', payAnchor: '2026-09-25', debtPerPaycheck: 300, savingsPerPaycheck: 100, lumpSum: 0 }, strategy: 'snowball', activePlan: 'A',
    savings: { balance: 800, goal: 5000, apy: 4, monthlyContribution: null }, history: [{ id: 'h1', at: '2026-09-01T00:00:00Z', kind: 'payment', debtId: 'd1', debtName: 'Card', amount: 100, before: 1600, after: 1500 }], milestones: { 25: '2026-09-01T00:00:00Z' } };
  const v2 = Object.assign(JSON.parse(JSON.stringify(v1)), { version: 2, customOrder: ['d1'], customMilestones: [{ id: 'm1', title: 'Gone', reward: 'Pizza', type: 'debtPaid', debtId: 'd1', value: 0, earnedAt: null }],
    checkins: [{ id: 'c1', date: '2026-09-10', at: '2026-09-10T00:00:00Z', balances: { d1: 1500 }, totalDebt: 1500, hysa: 800 }], baseline: null });
  Object.assign(v2.debts[0], { creditLimit: 5000, keepOpen: 500, dueDay: 12 });
  Object.assign(v2.budget, { rentReserve: 600, spending: 200, customItems: [], freedLater: {}, lumpFromSavings: false });
  const v3 = Object.assign(JSON.parse(JSON.stringify(v2)), { version: 3, checklistSince: '2026-09-20', payChecklists: [], drift: [], afterPlan: { monthly: 900, rothPct: 80, rothLimit: 7000, annualReturn: 6 }, monthlySummaries: [], monthMarks: {} });
  v3.debts[0].promoApr = 0; v3.budget.cardSpending = 150;
  const v4 = Object.assign(JSON.parse(JSON.stringify(v3)), { version: 4, accounts: [{ id: 'a1', name: 'Checking', type: 'checking', balance: 1200, archived: false, createdAt: '2026-09-25T00:00:00Z', updatedAt: null }],
    netWorthHistory: [{ month: '2026-09', date: '2026-09-25', at: '2026-09-25T00:00:00Z', assets: 2000, liabilities: 1500, netWorth: 500, byType: {} }], nwMilestones: { 0: 'before' }, nwMilestonesInit: true,
    subscriptions: [{ id: 's1', name: 'Music', amount: 10.99, cycle: 'monthly', nextRenewal: '2026-10-31', anchorDay: 31, category: 'Music', cardId: 'd1', review: true, cancelledAt: null, createdAt: '2026-09-25T00:00:00Z' }],
    onboarding: { completedAt: '2026-09-25T00:00:00Z', skippedAt: null } });
  const same = (a, b, path) => {
    if (a && typeof a === 'object' && !Array.isArray(a)) { for (const k of Object.keys(a)) { if (k === 'version') continue; same(a[k], b[k], `${path}.${k}`); } }
    else if (Array.isArray(a)) { assert.equal(b.length, a.length, `${path} length`); a.forEach((x, i) => same(x, b[i], `${path}[${i}]`)); }
    else assert.deepEqual(b, a, path);
  };
  for (const [label, src] of [['v1', v1], ['v2', v2], ['v3', v3], ['v4', v4]]) {
    const snap = JSON.parse(JSON.stringify(src));
    const m = normalize(src, '2026-09-25');
    assert.deepEqual(src, snap, `${label}: not mutated`);
    assert.equal(m.version, 5, `${label} → v5`);
    same(src, m, label);
    assert.deepEqual(m.wallet, []); assert.deepEqual(m.merchants, []); assert.deepEqual(m.cardSpend, []); assert.deepEqual(m.spendProfile, {});
    assert.deepEqual(m.insightDismissals, {});
    assert.deepEqual(m.settings, { currency: 'USD', locale: 'en-US', weekStart: 0, reduceMotion: false });
    assert.equal(m.home.downPct, 5); assert.equal(m.home.closingPct, 3); assert.equal(m.home.ratePct, null, 'no hardcoded mortgage rate');
    assert.deepEqual(m.home.programs.map((p) => p.name), ['NC Home Advantage Mortgage', 'NC 1st Home Advantage Down Payment', 'NC Mortgage Credit Certificate', 'HouseCharlotte']);
    assert.ok(m.home.programs.every((p) => p.verify), 'programs are labeled "verify current terms"');
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(m)), '2026-09-25'), m, `${label}: idempotent`);
    const o = { perPaycheck: 300, frequency: 'biweekly', payAnchor: '2026-09-25', today: '2026-09-25', strategy: 'snowball' };
    assert.deepEqual(simulatePayoff(m.debts, o).payoffs, simulatePayoff(src.debts, o).payoffs, `${label}: same plan`);
  }
  // v5 data round-trips; a deleted program list stays deleted
  const v5 = normalize({ wallet: [preset('amex-bcp')], merchants: [{ name: 'Harris Teeter', category: 'supermarket' }], home: { programs: [] }, settings: { currency: 'EUR', locale: 'de-DE', weekStart: 1, reduceMotion: true } }, '2026-09-25');
  assert.deepEqual(v5.home.programs, []);
  assert.deepEqual(v5.settings, { currency: 'EUR', locale: 'de-DE', weekStart: 1, reduceMotion: true });
  assert.equal(v5.wallet[0].rules.find((r) => r.category === 'supermarket').cap, 6000);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(v5)), '2026-09-25'), v5);
  // Presets are complete and editable copies
  engine.CARD_PRESETS.forEach((p) => { const c = engine.cardFromPreset(p, '2026-09-25T00:00:00Z'); assert.ok(c.rules.some((r) => r.category === 'everything'), `${p.id} has a base rate`); assert.notEqual(c.id, p.id); });
  for (const id of ['amex-bcp', 'amex-plat', 'c1-savor', 'apple', 'rh-gold']) assert.ok(preset(id), `preset ${id}`);
}

// ----- results table -----
const fmt = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(`Cards: ${cards.map((c) => `${c.name} ${fmt(c.balance)} @ ${c.apr}% (min ${fmt(c.minPayment)})`).join('; ')}`);
console.log(`Budget: ${fmt(base.perPaycheck)} per bi-weekly paycheck, first payday ${base.payAnchor}, today ${base.today}\n`);
console.log('| Strategy | Lump sum | Debt-free | Months | Total interest | Payoff order (month) |');
console.log('|---|---|---|---|---|---|');
for (const { strategy, lumpSum, r } of runs) {
  const order = r.payoffs.map((p) => `${p.name.split(' (')[0]} (${p.date.slice(0, 7)})`).join(' → ');
  console.log(`| ${strategy} | ${fmt(lumpSum)} | ${r.debtFree} | ${r.months} | ${fmt(r.totalInterest)} | ${order} |`);
}
console.log('\nAll payoff tests passed.');

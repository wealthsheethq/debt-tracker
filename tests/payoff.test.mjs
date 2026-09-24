// Tests the payoff engine embedded in index.html using made-up sample cards.
// Run: node tests/payoff.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.slice(html.indexOf('/* ENGINE START */'), html.indexOf('/* ENGINE END */'));
const engine = new Function(`${src}; return { simulatePayoff, projectPlan, projectSavings, normalize, baselineAt, FREQUENCIES,
  buildChecklist, checkChecklistItem, uncheckChecklistItem, recordBalance, detectDrift, driftSummary, driftDelayDays,
  projectInvesting, buildMonthlySummary, ensureMonthlySummary, daysAheadOfPlan, balanceTransferCheck, lastPaydayOnOrBefore, toISO, parseISO, r2 };`)();
const { simulatePayoff, projectPlan, normalize, baselineAt, r2 } = engine;

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

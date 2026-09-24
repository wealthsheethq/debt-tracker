// Tests the payoff engine embedded in index.html using made-up sample cards.
// Run: node tests/payoff.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.slice(html.indexOf('/* ENGINE START */'), html.indexOf('/* ENGINE END */'));
const engine = new Function(`${src}; return { simulatePayoff, projectPlan, projectSavings, normalize, baselineAt, FREQUENCIES };`)();
const { simulatePayoff, projectPlan, normalize, baselineAt } = engine;

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

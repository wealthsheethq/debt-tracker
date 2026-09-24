// Tests the payoff engine embedded in index.html using made-up sample cards.
// Run: node tests/payoff.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.slice(html.indexOf('/* ENGINE START */'), html.indexOf('/* ENGINE END */'));
const engine = new Function(`${src}; return { simulatePayoff, projectSavings, FREQUENCIES };`)();
const { simulatePayoff } = engine;

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

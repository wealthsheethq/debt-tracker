// Tests Statement Snap (reading card statements) in index.html's engine, with SYNTHETIC statement text only.
// Run: node tests/statements.test.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as F from './fixtures/statements.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const src = html.slice(html.indexOf('/* ENGINE START */'), html.indexOf('/* ENGINE END */'));
const E = new Function(`${src}; return { parseStatement, stmtValues, parseStmtDate, stmtTokens, fixOcrDigits, matchStatementCard, statementPlan, applyStatement,
  normalizeStatement, statementsFor, statementAlerts, statementDay, statementInsights, missingPlanInfo, statementSeries, normalize, DATA_VERSION, computeInsights,
  closeDayFrom, STMT_FIELDS, STMT_LOW, creditAccounts, cardFromPreset, CARD_PRESETS, simulatePayoff, planOptionsFrom };`)();
const { parseStatement, stmtValues, normalize } = E;

const TODAY = '2026-09-28';
const NOW = '2026-09-28T15:00:00.000Z';
const read = (text, source = 'pdf', today = TODAY) => parseStatement(text, { source, today });
const vals = (text, source, today) => stmtValues(read(text, source, today));
const pick = (v, keys) => Object.fromEntries(keys.map((k) => [k, v[k]]));
let count = 0;
const test = (name, fn) => { fn(); count++; console.log(`✓ ${name}`); };

// ---------------------------------------------------------------- dates & tokens
test('date parsing: two- and four-digit years, month names, ranges, missing spaces', () => {
  const d = (s, t = TODAY) => E.parseStmtDate(s, t);
  assert.equal(d('09/18/26'), '2026-09-18');
  assert.equal(d('9/8/2026'), '2026-09-08');
  assert.equal(d('10-13-2026'), '2026-10-13');
  assert.equal(d('2026-09-18'), '2026-09-18');
  assert.equal(d('Sep 18, 2026'), '2026-09-18');
  assert.equal(d('September 18 2026'), '2026-09-18');
  assert.equal(d('Sept. 18, 2026'), '2026-09-18');
  assert.equal(d('18 Sep 2026'), '2026-09-18');
  assert.equal(d('Oct13,2026'), '2026-10-13', 'no spaces');
  assert.equal(d('SEP 18, 2026'), '2026-09-18', 'upper case');
  assert.equal(d('Dec 30', '2027-01-10'), '2026-12-30', 'no year → nearest to today (back across New Year)');
  assert.equal(d('Jan 5', '2026-12-20'), '2027-01-05', 'no year → nearest to today (forward across New Year)');
  assert.equal(d('02/30/26'), null, 'impossible day');
  assert.equal(d('13/01/26'), null, 'impossible month');
  assert.equal(d('03/2027'), '2027-03-31', 'month/year means the end of that month');
  // a range with the year only at the end, crossing a year boundary
  const r = E.stmtTokens('Statement Period Dec 19 - Jan 18, 2027', TODAY).filter((t) => t.type === 'date').map((t) => t.value);
  assert.deepEqual(r, ['2026-12-19', '2027-01-18']);
  // "APR 24.99%" is a rate, never April 24
  assert.deepEqual(E.stmtTokens('Purchase APR 24.99%', TODAY).map((t) => t.type), ['pct']);
  // prose "may" is never a month
  assert.ok(!E.stmtTokens('you may 2 times', TODAY).some((t) => t.type === 'date'));
});
test('amounts: $, commas, cents, credits, and plain counts', () => {
  const toks = E.stmtTokens('New Balance $1,234.56 Payments -$500.00 Credit ($25.00) Refund 12.00 CR 31 days 4,011', TODAY);
  assert.deepEqual(toks.map((t) => [t.type, t.value]), [['money', 1234.56], ['money', -500], ['money', -25], ['money', -12], ['int', 31], ['money', 4011]]);
});
test('OCR digit fixes touch numbers only', () => {
  assert.equal(E.fixOcrDigits('NewBalance$l,876.54'), 'NewBalance$1,876.54');
  assert.equal(E.fixOcrDigits('$1O.OO and $1,O23.4l'), '$10.00 and $1,023.41');
  assert.equal(E.fixOcrDigits('Aug l9, 2O26'), 'Aug 19, 2026');
  assert.equal(E.fixOcrDigits('Pay Over Time Total Interest Charged Info'), 'Pay Over Time Total Interest Charged Info', 'words untouched');
  assert.equal(E.fixOcrDigits('$0.00Interest'), '$0.00Interest', 'a word glued to a number stays a word');
});

// ---------------------------------------------------------------- issuer parsers
test('Amex Platinum: charge card, no preset limit, Pay Over Time, two-digit years', () => {
  const p = read(F.amexPlatinum);
  assert.equal(p.issuer, 'amex'); assert.equal(p.product, 'amex-plat');
  assert.equal(p.noPresetLimit, true); assert.equal(p.payOverTime, true);
  const v = stmtValues(p);
  assert.deepEqual(pick(v, ['closingDate', 'balance', 'minPayment', 'dueDate', 'apr', 'cashApr', 'creditLimit', 'available', 'interest', 'fees', 'prevBalance', 'potBalance', 'last4']), {
    closingDate: '2026-09-18', balance: 4812.37, minPayment: 512.4, dueDate: '2026-10-13', apr: 22.49, cashApr: 29.24, creditLimit: 35000, available: 32300,
    interest: 50.12, fees: 0, prevBalance: 3390.12, potBalance: 2700, last4: '1004' });
  assert.equal(v.promoApr, null);
  ['closingDate', 'balance', 'minPayment', 'dueDate', 'apr', 'last4'].forEach((k) => assert.ok(p.fields[k].conf >= 0.85, `${k} confident (${p.fields[k].conf})`));
  // "Next Closing Date" never competes with the real one
  assert.ok(!p.fields.closingDate.alts);
});
test('Amex Blue Cash Preferred: limit, promo APR, four-digit years, warning box ignored', () => {
  const p = read(F.amexBCP);
  assert.equal(p.issuer, 'amex'); assert.equal(p.product, 'amex-bcp'); assert.equal(p.noPresetLimit, false);
  assert.deepEqual(pick(stmtValues(p), ['closingDate', 'balance', 'minPayment', 'dueDate', 'apr', 'cashApr', 'promoApr', 'promoEnd', 'creditLimit', 'available', 'interest', 'fees', 'prevBalance', 'last4']), {
    closingDate: '2026-09-12', balance: 2431.88, minPayment: 40, dueDate: '2026-10-07', apr: 19.24, cashApr: 29.24, promoApr: 0, promoEnd: '2026-11-12',
    creditLimit: 15000, available: 12568.12, interest: 19.12, fees: 0, prevBalance: 2105.4, last4: '1007' });
  assert.ok(p.fields.balance.conf >= 0.95, 'balance + available = limit adds confidence');
  assert.ok(!p.fields.minPayment.alts, 'the minimum-payment warning box is not a rival');
});
test('Capital One Savor: billing-cycle range, year-to-date totals ignored', () => {
  const p = read(F.capitalOneSavor);
  assert.equal(p.issuer, 'capitalone'); assert.equal(p.product, 'c1-savor');
  const v = stmtValues(p);
  assert.deepEqual(pick(v, ['closingDate', 'periodStart', 'balance', 'minPayment', 'dueDate', 'apr', 'cashApr', 'creditLimit', 'available', 'interest', 'fees', 'prevBalance', 'last4']), {
    closingDate: '2026-09-18', periodStart: '2026-08-19', balance: 1876.54, minPayment: 49, dueDate: '2026-10-13', apr: 29.74, cashApr: 29.74, creditLimit: 8500,
    available: 6623.46, interest: 32.41, fees: 0, prevBalance: 1402.1, last4: '4821' });
  assert.ok(!p.fields.interest.alts, 'year-to-date interest is not a rival');
  assert.ok(!p.fields.creditLimit.alts, 'the cash-advance limit is not a rival');
});
test('Capital One from OCR: O vs 0, l vs 1, missing spaces → same numbers, lower confidence', () => {
  const clean = read(F.capitalOneSavor), ocr = read(F.capitalOneSavorOCR, 'ocr');
  assert.equal(ocr.issuer, 'capitalone');
  const keys = ['closingDate', 'periodStart', 'balance', 'minPayment', 'dueDate', 'apr', 'creditLimit', 'available', 'interest', 'fees', 'prevBalance', 'last4'];
  assert.deepEqual(pick(stmtValues(ocr), keys), pick(stmtValues(clean), keys));
  assert.ok(ocr.fields.balance.conf < clean.fields.balance.conf, 'a corrected digit lowers confidence');
  assert.ok(ocr.fields.minPayment.conf < E.STMT_LOW + 0.1, `fixed digits are flagged for review (${ocr.fields.minPayment.conf})`);
  // review snippets point at the text as read (before corrections)
  const f = ocr.fields.balance;
  assert.equal(ocr.lines[f.line].slice(f.start, f.end), '$l,876.54');
});
test('Capital One: $0 balance statement', () => {
  const v = vals(F.capitalOneZero, 'pdf', '2026-10-20');
  assert.deepEqual(pick(v, ['closingDate', 'balance', 'minPayment', 'dueDate', 'interest', 'fees', 'available', 'last4']),
    { closingDate: '2026-10-18', balance: 0, minPayment: 0, dueDate: '2026-11-13', interest: 0, fees: 0, available: 8500, last4: '4821' });
});
test('Apple Card: calendar month, Total Balance, due "by", closes on the last day', () => {
  const p = read(F.appleCard);
  assert.equal(p.issuer, 'apple'); assert.equal(p.product, 'apple'); assert.equal(p.monthEnd, true);
  const v = stmtValues(p);
  assert.deepEqual(pick(v, ['closingDate', 'periodStart', 'balance', 'minPayment', 'dueDate', 'apr', 'creditLimit', 'available', 'interest', 'prevBalance', 'last4', 'fees']), {
    closingDate: '2026-08-31', periodStart: '2026-08-01', balance: 1203.19, minPayment: 30, dueDate: '2026-09-30', apr: 24.99, creditLimit: 6000, available: 4796.81,
    interest: 0, prevBalance: 954.2, last4: null, fees: null });
  assert.ok(!p.fields.balance.alts, '"Previous Total Balance" is not a rival');
  assert.equal(E.closeDayFrom(v.closingDate, v.monthEnd), 31, 'short months close on their last day');
  assert.equal(E.closeDayFrom('2026-09-30', false), 30);
});
test('Robinhood Gold: statement period with the year at the end', () => {
  const p = read(F.robinhoodGold);
  assert.equal(p.issuer, 'robinhood'); assert.equal(p.product, 'rh-gold');
  assert.deepEqual(pick(stmtValues(p), ['closingDate', 'periodStart', 'balance', 'minPayment', 'dueDate', 'apr', 'cashApr', 'creditLimit', 'available', 'interest', 'fees', 'prevBalance', 'last4']), {
    closingDate: '2026-09-18', periodStart: '2026-08-19', balance: 3120.45, minPayment: 95, dueDate: '2026-10-15', apr: 27.24, cashApr: 30.24, creditLimit: 12000,
    available: 8879.55, interest: 61.2, fees: 0, prevBalance: 2845, last4: '5519' });
});

// ---------------------------------------------------------------- generic fallback
test('generic reader: unknown issuer, Opening/Closing range, Credit Line, intro APR until month/year', () => {
  const p = read(F.genericCreditUnion);
  assert.equal(p.issuer, null);
  assert.deepEqual(pick(stmtValues(p), ['closingDate', 'periodStart', 'balance', 'minPayment', 'dueDate', 'apr', 'creditLimit', 'available', 'interest', 'fees', 'prevBalance', 'promoApr', 'promoEnd', 'last4']), {
    closingDate: '2026-09-18', periodStart: '2026-08-19', balance: 912.66, minPayment: 25, dueDate: '2026-10-15', apr: 21.99, creditLimit: 5000, available: 4087.34,
    interest: 14.05, fees: 29, prevBalance: 1150, promoApr: 0, promoEnd: '2027-03-31', last4: '9012' });
  assert.ok(p.fields.balance.conf < read(F.amexBCP).fields.balance.conf, 'generic labels are a bit less certain than issuer-specific ones');
});
test('generic reader: labels on their own line, value on the next', () => {
  const p = read(F.genericHeaders);
  assert.deepEqual(pick(stmtValues(p), ['closingDate', 'dueDate', 'balance', 'minPayment', 'creditLimit', 'available', 'apr', 'interest', 'last4']), {
    closingDate: '2026-09-18', dueDate: '2026-10-13', balance: 2045.1, minPayment: 61, creditLimit: 9000, available: 6954.9, apr: 23.49, interest: 38.77, last4: '7710' });
});
test('confidence: low for rivals, bad cross-checks and nothing found', () => {
  const p = read('Some Bank\nNew Balance $500.00\nNew Balance $900.00\nMinimum Payment Due $950.00\nClosing Date 09/18/26\nPayment Due Date 12/30/26');
  assert.ok(p.fields.balance.conf < E.STMT_LOW, 'two different "New Balance" values');
  assert.deepEqual(p.fields.balance.alts, [900]);
  assert.ok(p.fields.minPayment.conf < E.STMT_LOW, 'minimum above the balance');
  assert.ok(p.fields.dueDate.conf < E.STMT_LOW, 'due date 3 months after closing');
  assert.equal(p.fields.creditLimit, null);
  assert.equal(read('hello').fields.balance, null);
  assert.deepEqual(stmtValues(read('')).balance, null);
});

// ---------------------------------------------------------------- matching
const walletFor = (id, preset, extra = {}) => Object.assign(E.cardFromPreset(E.CARD_PRESETS.find((p) => p.id === preset), NOW), { id }, extra);
function household() {
  return normalize({
    debts: [
      { id: 'plat', name: 'Amex Platinum', balance: 3390.12, apr: 0, minPayment: 0, cardKind: 'charge', closingDay: 18, dueDay: 13, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'bcp', name: 'Blue Cash', balance: 2105.4, apr: 0, minPayment: 0, creditLimit: 15000, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'savor', name: 'Savor', balance: 1402.1, apr: 29.74, minPayment: 35, creditLimit: 8500, closingDay: 18, dueDay: 13, last4: '4821', createdAt: '2026-01-01T00:00:00Z' },
      { id: 'rh', name: 'RH Gold', balance: 2845, apr: 27.24, minPayment: 90, creditLimit: 12000, closingDay: 18, dueDay: 15, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'loan', name: 'Car loan', type: 'loan', balance: 9000, apr: 6, minPayment: 300, dueDay: 1, createdAt: '2026-01-01T00:00:00Z' }
    ],
    wallet: [walletFor('wp', 'amex-plat', { debtId: 'plat' }), walletFor('wb', 'amex-bcp', { debtId: 'bcp' }), walletFor('wa', 'apple', { creditLimit: 6000, currentBalance: 954.2 })],
    budget: { debtPerPaycheck: 800, frequency: 'biweekly', payAnchor: '2026-09-18' }
  }, TODAY);
}
test('card matching: last 4 decides; issuer + product otherwise; ask when unsure', () => {
  const data = household();
  const m1 = E.matchStatementCard(data, read(F.capitalOneSavor));
  assert.equal(m1.acctId, 'savor'); assert.equal(m1.sure, true); assert.ok(m1.candidates[0].why.includes('last4'));
  const m2 = E.matchStatementCard(data, read(F.amexPlatinum));
  assert.equal(m2.acctId, 'plat'); assert.equal(m2.sure, true, 'Platinum vs Blue Cash is told apart by product');
  assert.equal(E.matchStatementCard(data, read(F.amexBCP)).acctId, 'bcp');
  const m3 = E.matchStatementCard(data, read(F.appleCard));
  assert.equal(m3.acctId, 'w:wa', 'a wallet-only card'); assert.equal(m3.sure, true);
  // the loan is never a candidate
  assert.ok(!m1.candidates.some((c) => c.id === 'loan'));
  // a card whose remembered last 4 is different is ruled out
  data.debts.find((d) => d.id === 'rh').last4 = '0000';
  const m4 = E.matchStatementCard(data, read(F.robinhoodGold));
  assert.notEqual(m4.acctId, 'rh');
  assert.equal(m4.sure, false, 'unsure → ask me to pick');
  // two Amex cards and a statement that doesn't say which → ask
  const plainAmex = read('American Express\nClosing Date 09/18/26\nNew Balance $10.00');
  const m5 = E.matchStatementCard(data, plainAmex);
  assert.equal(m5.sure, false);
  assert.ok(['plat', 'bcp'].includes(m5.acctId));
  // unknown issuer, no last 4 → nothing picked
  const m6 = E.matchStatementCard(data, read('Some Bank\nNew Balance $10.00\nClosing Date 09/18/26'));
  assert.equal(m6.acctId, null); assert.equal(m6.sure, false);
});

// ---------------------------------------------------------------- apply
test('apply: balance history, closing day, due day, APR, minimum, limit, last 4 (remembered for next time)', () => {
  const data = household();
  const v = vals(F.robinhoodGold);
  const plan = E.statementPlan(data, 'rh', v);
  assert.equal(plan.latest, true);
  const rows = Object.fromEntries(plan.rows.map((r) => [r.key, r]));
  assert.deepEqual([rows.balance.before, rows.balance.after, rows.balance.changed], [2845, 3120.45, true]);
  assert.deepEqual([rows.apr.before, rows.apr.after, rows.apr.changed], [27.24, 27.24, false], 'unchanged values are shown as unchanged');
  assert.deepEqual([rows.minPayment.after, rows.dueDay.after, rows.closingDay.after, rows.last4.after], [95, 15, 18, '5519']);
  const res = E.applyStatement(data, 'rh', v, NOW, { issuer: 'robinhood', source: 'pdf' });
  const d = data.debts.find((x) => x.id === 'rh');
  assert.deepEqual([d.balance, d.apr, d.minPayment, d.dueDay, d.closingDay, d.creditLimit, d.last4], [3120.45, 27.24, 95, 15, 18, 12000, '5519']);
  const h = data.history.find((x) => x.debtId === 'rh' && x.kind === 'balance');
  assert.deepEqual([h.before, h.after, h.source, h.at], [2845, 3120.45, 'statement', NOW], 'logged to history like a check-in');
  assert.equal(data.statements.length, 1);
  assert.equal(res.stmt.acctId, 'rh'); assert.equal(res.stmt.closingDate, '2026-09-18'); assert.equal(res.stmt.issuer, 'robinhood');
  // the next statement for this card is matched by the remembered last 4 even with an unhelpful name
  d.name = 'Card #4';
  assert.equal(E.matchStatementCard(data, read(F.robinhoodGold)).acctId, 'rh');
  // snapping the same statement again replaces it (no duplicates)
  E.applyStatement(data, 'rh', v, NOW, {});
  assert.equal(data.statements.length, 1);
});
test('apply: closing day, promo and charge card; Apple month-end → 31; wallet-only card', () => {
  const data = household();
  E.applyStatement(data, 'bcp', vals(F.amexBCP), NOW, { issuer: 'amex' });
  const b = data.debts.find((x) => x.id === 'bcp');
  assert.deepEqual([b.closingDay, b.dueDay, b.apr, b.minPayment, b.promoApr, b.promoEnd, b.creditLimit, b.last4], [12, 7, 19.24, 40, 0, '2026-11-12', 15000, '1007']);
  assert.equal(data.wallet.find((w) => w.id === 'wb').last4, '1007', 'the linked wallet card remembers the last 4 too');
  // Platinum: charge card, no preset limit → kind stays charge, Pay Over Time limit used as the limit
  const pp = E.statementPlan(data, 'plat', vals(F.amexPlatinum));
  assert.equal(pp.rows.find((r) => r.key === 'creditLimit').label, 'Limit (Pay Over Time)');
  E.applyStatement(data, 'plat', vals(F.amexPlatinum), NOW, { issuer: 'amex' });
  const p = data.debts.find((x) => x.id === 'plat');
  assert.deepEqual([p.cardKind, p.apr, p.minPayment, p.creditLimit, p.balance], ['charge', 22.49, 512.4, 35000, 4812.37]);
  // Apple Card, a wallet-only card: current balance, limit, closing day 31 (month-end), history entry
  E.applyStatement(data, 'w:wa', vals(F.appleCard), NOW, { issuer: 'apple' });
  const a = data.wallet.find((w) => w.id === 'wa');
  assert.deepEqual([a.currentBalance, a.closingDay, a.dueDay, a.creditLimit], [1203.19, 31, 30, 6000]);
  assert.ok(data.history.some((h) => h.kind === 'cardbal' && h.walletId === 'wa' && h.after === 1203.19 && h.source === 'statement'));
  // the credit screen now sees the new closing days
  const accts = E.creditAccounts(data);
  assert.equal(accts.find((x) => x.id === 'bcp').closeDay, 12);
  assert.equal(accts.find((x) => x.id === 'w:wa').closeDay, 31);
});
test('apply: payments logged after closing come off; a balance you set since is kept; older statements are history only', () => {
  const data = household();
  data.history.push({ id: 'h1', kind: 'payment', debtId: 'savor', debtName: 'Savor', amount: 400, before: 1402.1, after: 1002.1, at: '2026-09-22T12:00:00.000Z' });
  const plan = E.statementPlan(data, 'savor', vals(F.capitalOneSavor));
  assert.equal(plan.paidSince, 400);
  assert.equal(plan.rows.find((r) => r.key === 'balance').after, 1476.54, '1,876.54 − 400 paid since Sep 18');
  // you set the balance yourself after it closed → keep yours
  data.history.unshift({ id: 'h2', kind: 'balance', debtId: 'savor', debtName: 'Savor', before: 1002.1, after: 990, source: 'checkin', at: '2026-09-25T12:00:00.000Z' });
  const kept = E.statementPlan(data, 'savor', vals(F.capitalOneSavor));
  assert.equal(kept.keptSince, '2026-09-25');
  assert.ok(!kept.rows.some((r) => r.key === 'balance'));
  // a newer statement is on file → the older one only goes to history
  const d2 = household();
  E.applyStatement(d2, 'savor', vals(F.capitalOneZero, 'pdf', '2026-10-20'), '2026-10-20T12:00:00.000Z', {});
  const before = JSON.stringify(d2.debts);
  const old = E.applyStatement(d2, 'savor', vals(F.capitalOneSavor), '2026-10-20T12:05:00.000Z', {});
  assert.equal(old.plan.latest, false); assert.equal(old.plan.newer, '2026-10-18');
  assert.equal(JSON.stringify(d2.debts), before, 'card untouched');
  assert.deepEqual(E.statementsFor(d2, { id: 'savor', debtId: 'savor' }).map((s) => s.closingDate), ['2026-09-18', '2026-10-18']);
});
test('apply: a $0 statement marks the debt paid; a later balance reopens it', () => {
  const data = household();
  const res = E.applyStatement(data, 'savor', vals(F.capitalOneZero, 'pdf', '2026-10-20'), '2026-10-20T12:00:00.000Z', {});
  const s = data.debts.find((x) => x.id === 'savor');
  assert.equal(res.paidOff, s); assert.equal(s.paid, true); assert.equal(s.balance, 0);
  assert.ok(data.history.some((h) => h.kind === 'paid' && h.debtId === 'savor'));
  E.applyStatement(data, 'savor', Object.assign(vals(F.capitalOneZero, 'pdf', '2026-11-20'), { closingDate: '2026-11-18', balance: 250 }), '2026-11-20T12:00:00.000Z', {});
  assert.equal(s.paid, false); assert.equal(s.balance, 250);
});
test('apply clears the "projection is optimistic" banner for those cards', () => {
  const data = household();
  const names = () => E.missingPlanInfo(data).map((x) => x.debt.id).sort();
  assert.deepEqual(names(), ['bcp', 'plat'], 'Platinum and Blue Cash have no APR or minimum yet');
  E.applyStatement(data, 'bcp', vals(F.amexBCP), NOW, {});
  assert.deepEqual(names(), ['plat']);
  // a charge card that truly has a 0% APR and $0 minimum: the statement confirms it, so it no longer counts as missing
  E.applyStatement(data, 'plat', Object.assign(vals(F.amexPlatinum), { apr: 0, minPayment: 0, potBalance: 0 }), NOW, {});
  assert.deepEqual(names(), []);
  assert.equal(data.debts.find((x) => x.id === 'plat').apr, 0);
});

// ---------------------------------------------------------------- history, alerts, statement day
test('change alerts: APR up, fee, minimum jump, limit down, balance up, promo ending, surprise interest', () => {
  const data = household();
  E.applyStatement(data, 'rh', vals(F.robinhoodGold), '2026-09-28T12:00:00.000Z', {});
  assert.deepEqual(E.statementAlerts(data, TODAY).filter((a) => a.acctId === 'rh').map((a) => a.kind), ['balance-up'], 'first statement: vs. its own previous balance');
  E.applyStatement(data, 'rh', vals(F.robinhoodGoldNext, 'pdf', '2026-10-20'), '2026-10-20T12:00:00.000Z', {});
  const al = E.statementAlerts(data, '2026-10-20');
  const kinds = al.filter((a) => a.acctId === 'rh').map((a) => a.kind).sort();
  assert.deepEqual(kinds, ['apr-up', 'balance-up', 'fee', 'limit', 'min-jump']);
  const t = (k) => al.find((a) => a.acctId === 'rh' && a.kind === k).text;
  assert.equal(t('apr-up'), "RH Gold's APR went **up** from 27.24% to **29.24%**.");
  assert.equal(t('fee'), "A **$40 fee** showed up on RH Gold's Oct 18 statement.");
  assert.equal(t('min-jump'), "RH Gold's minimum payment jumped from $95 to **$140**.");
  assert.equal(t('limit'), "RH Gold's credit limit went **down** from $12,000 to **$10,000**. That raises your utilization.");
  // promo ending within 60 days (Blue Cash promo ends Nov 12)
  E.applyStatement(data, 'bcp', vals(F.amexBCP), NOW, {});
  const promo = E.statementAlerts(data, TODAY).find((a) => a.kind === 'promo');
  assert.equal(promo.acctId, 'bcp'); assert.equal(promo.days, 45);
  assert.equal(promo.text, 'The 0% promo on Blue Cash ends **Nov 12** (in 45 days). After that it\'s 19.24%.');
  assert.ok(!E.statementAlerts(data, '2026-09-01').some((a) => a.kind === 'promo'), 'not yet within 60 days');
  assert.ok(!E.statementAlerts(data, TODAY).some((a) => a.acctId === 'bcp' && a.kind === 'interest'), 'a promo on part of the balance: regular interest is expected');
  // interest when you expected none: last statement was $0, this one charged interest
  const d2 = household();
  E.applyStatement(d2, 'savor', Object.assign(vals(F.capitalOneZero, 'pdf', '2026-10-20'), { closingDate: '2026-08-18' }), '2026-08-20T12:00:00.000Z', {});
  E.applyStatement(d2, 'savor', vals(F.capitalOneSavor), NOW, {});
  assert.ok(E.statementAlerts(d2, TODAY).some((a) => a.acctId === 'savor' && a.kind === 'interest'));
  // APR down is good news
  const d3 = household();
  E.applyStatement(d3, 'rh', Object.assign(vals(F.robinhoodGold), { closingDate: '2026-08-18', apr: 29.99 }), '2026-08-20T12:00:00.000Z', {});
  E.applyStatement(d3, 'rh', vals(F.robinhoodGold), NOW, {});
  const down = E.statementAlerts(d3, TODAY).find((a) => a.kind === 'apr-down');
  assert.equal(down.level, 'good');
  // stale statements don't raise change alerts
  assert.ok(!E.statementAlerts(data, '2027-02-01').some((a) => a.kind === 'fee'));
});
test('alerts feed the insights engine (and Home)', () => {
  const data = household();
  E.applyStatement(data, 'rh', vals(F.robinhoodGold), '2026-09-28T12:00:00.000Z', {});
  E.applyStatement(data, 'rh', vals(F.robinhoodGoldNext, 'pdf', '2026-10-20'), '2026-10-20T12:00:00.000Z', {});
  const ins = E.computeInsights(data, '2026-10-20');
  const fee = ins.find((i) => i.id === 'stmt:fee:rh:2026-10-18');
  assert.ok(fee); assert.equal(fee.type, 'statementwarn'); assert.equal(fee.action.tab, 'credit');
  assert.ok(ins.indexOf(fee) < 3, 'high priority: shows on Home');
  ins.forEach((i) => assert.ok(i.action.tab && i.sig !== undefined));
  // statements waiting: once you've snapped at least one
  const waiting = ins.find((i) => i.id.startsWith('stmt-due:'));
  assert.ok(waiting, ins.map((i) => i.id).join());
  assert.match(waiting.text, /^\*\*\d statements? closed\*\* since your last snap/);
  assert.deepEqual(E.computeInsights(normalize({}, TODAY), TODAY), [], 'nothing for an empty account');
});
test('statement history series: balance, interest, utilization', () => {
  const data = household();
  E.applyStatement(data, 'rh', vals(F.robinhoodGold), '2026-09-28T12:00:00.000Z', {});
  E.applyStatement(data, 'rh', vals(F.robinhoodGoldNext, 'pdf', '2026-10-20'), '2026-10-20T12:00:00.000Z', {});
  const a = E.creditAccounts(data).find((x) => x.id === 'rh');
  assert.deepEqual(E.statementSeries(data, a), [
    { date: '2026-09-18', balance: 3120.45, interest: 61.2, fees: 0, util: 26 },
    { date: '2026-10-18', balance: 3410.8, interest: 70.35, fees: 40, util: 34.11 }
  ]);
});
test('statement day: "3 of 5 statements in for September", what closed since the last snap', () => {
  const data = household();
  data.wallet.find((w) => w.id === 'wa').closingDay = 31;
  data.debts.find((d) => d.id === 'bcp').closingDay = 12;
  let sd = E.statementDay(data, TODAY);
  assert.equal(sd.month, '2026-09');
  assert.equal(sd.total, 5, 'four cards + the Apple Card (the loan is not a card)');
  assert.equal(sd.inCount, 0);
  assert.deepEqual(sd.due.map((r) => r.id).sort(), ['bcp', 'plat', 'rh', 'savor']);
  assert.equal(sd.rows.find((r) => r.id === 'w:wa').status, 'upcoming', 'Apple closes Sep 30');
  E.applyStatement(data, 'savor', vals(F.capitalOneSavor), NOW, {});
  E.applyStatement(data, 'rh', vals(F.robinhoodGold), NOW, {});
  E.applyStatement(data, 'bcp', vals(F.amexBCP), NOW, {});
  sd = E.statementDay(data, TODAY);
  assert.equal(`${sd.inCount} of ${sd.total}`, '3 of 5');
  assert.deepEqual(sd.due.map((r) => r.id), ['plat']);
  // early in a month with nothing closed yet, the checklist stays on last month
  assert.equal(E.statementDay(data, '2026-10-05').month, '2026-09');
  assert.equal(E.statementDay(data, '2026-10-13').month, '2026-10');
  // a card with no closing day yet
  data.debts.find((d) => d.id === 'rh').closingDay = null;
  data.debts.find((d) => d.id === 'rh').dueDay = null;
  assert.equal(E.statementDay(data, TODAY).rows.find((r) => r.id === 'rh').status, 'in', 'its September statement is on file');
});

// ---------------------------------------------------------------- saved data: privacy and migration
test('PRIVACY: no statement text, account numbers, names, addresses or transactions reach saved data', () => {
  const data = household();
  const all = [F.amexPlatinum, F.amexBCP, F.capitalOneSavor, F.capitalOneSavorOCR, F.appleCard, F.robinhoodGold, F.genericCreditUnion, F.genericHeaders];
  for (const text of all) {
    const p = read(text, text === F.capitalOneSavorOCR ? 'ocr' : 'pdf');
    const m = E.matchStatementCard(data, p);
    // the review screen holds the parse (with text) in memory; only stmtValues() go to the apply step
    E.applyStatement(data, m.acctId || 'rh', stmtValues(p), NOW, { issuer: p.issuer, source: p.source });
  }
  const saved = JSON.stringify(normalize(JSON.parse(JSON.stringify(data)), TODAY));
  for (const bit of F.PRIVATE_BITS) assert.ok(!saved.toLowerCase().includes(bit.toLowerCase()), `"${bit}" leaked into saved data`);
  // no card/account-number-like digit runs anywhere but random ids (a UUID can hold 12 digits in a row by chance)
  const noIds = JSON.stringify(JSON.parse(saved), (k, v) => (/^(id|acctId|debtId|walletId|historyIds)$/.test(k) ? undefined : v));
  assert.ok(!/\d{4}[\s-]?\d{4}[\s-]?\d{4}/.test(noIds), 'no card numbers');
  // no line of statement text, not even a short one
  for (const text of all) for (const line of text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 12)) assert.ok(!saved.includes(line), `statement line leaked: ${line}`);
  // each saved statement holds only numbers, dates, ids, flags and a 4-digit last4
  const allowed = new Set(['id', 'acctId', 'debtId', 'walletId', 'issuer', 'source', 'last4', 'appliedAt', 'noPresetLimit', 'payOverTime', 'monthEnd',
    'balance', 'prevBalance', 'minPayment', 'apr', 'cashApr', 'promoApr', 'creditLimit', 'available', 'interest', 'fees', 'potBalance', 'closingDate', 'periodStart', 'dueDate', 'promoEnd']);
  assert.equal(data.statements.length, 5, 'one per card and closing date (re-snaps replace)');
  for (const s of data.statements) {
    for (const [k, v] of Object.entries(s)) {
      assert.ok(allowed.has(k), `unexpected field ${k}`);
      assert.ok(v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string', k);
      if (typeof v === 'string') assert.ok(v.length <= 40 && !/\s/.test(v), `${k}: ${v}`);
    }
    assert.ok(s.last4 === '' || /^\d{4}$/.test(s.last4));
  }
  data.debts.concat(data.wallet).forEach((c) => assert.ok(c.last4 === '' || /^\d{4}$/.test(c.last4)));
  // text smuggled into a statement record (say, by a future bug) is dropped on load
  const sneaky = normalize({ statements: [{ acctId: 'rh', closingDate: '2026-09-18', balance: 5, note: 'JORDAN Q SAMPLE 123 SAMPLE ST', rawText: F.amexPlatinum, lines: ['New Balance $1'], last4: '4000123456789012', future: 7 }] }, TODAY);
  const s0 = sneaky.statements[0];
  assert.equal(s0.note, undefined); assert.equal(s0.rawText, undefined); assert.equal(s0.lines, undefined);
  assert.equal(s0.last4, ''); assert.equal(s0.future, 7, 'numbers from a newer version are kept');
  const d = normalize({ debts: [{ id: 'x', name: 'X', balance: 1, last4: '4000 1234 5678 9012' }] }, TODAY);
  assert.equal(d.debts[0].last4, '', 'a full account number is never kept as last 4');
});
test('migration: data saved by every previous version (v1…v6) loads into v7', () => {
  assert.equal(E.DATA_VERSION, 7);
  const v1 = { version: 1, debts: [{ id: 'd1', name: 'Card', type: 'card', balance: 1500, startBalance: 2000, apr: 22, minPayment: 40, promoEnd: '', paid: false, paidAt: null, createdAt: '2026-01-01T00:00:00Z' }],
    budget: { takeHome: 2000, frequency: 'biweekly', payAnchor: '2026-09-25', debtPerPaycheck: 300, savingsPerPaycheck: 100, lumpSum: 0 }, strategy: 'snowball', activePlan: 'A',
    savings: { balance: 800, goal: 5000, apy: 4, monthlyContribution: null }, history: [{ id: 'h', kind: 'payment', debtId: 'd1', debtName: 'Card', amount: 50, before: 1550, after: 1500, at: '2026-09-01T12:00:00Z' }], milestones: {} };
  const v2 = Object.assign(JSON.parse(JSON.stringify(v1)), { version: 2, customOrder: ['d1'], checkins: [], baseline: null });
  Object.assign(v2.debts[0], { creditLimit: 5000, keepOpen: 500, dueDay: 31 });
  const v3 = Object.assign(JSON.parse(JSON.stringify(v2)), { version: 3, checklistSince: '2026-09-20', payChecklists: [{ date: '2026-09-25', items: [{ key: 'debt:d1', kind: 'debt', debtId: 'd1', label: 'Card', planned: 100, done: false, paid: null }] }] });
  const v4 = Object.assign(JSON.parse(JSON.stringify(v3)), { version: 4, accounts: [{ id: 'a1', name: 'Checking', type: 'checking', balance: 1200, archived: false }], subscriptions: [] });
  const v5 = Object.assign(JSON.parse(JSON.stringify(v4)), { version: 5, wallet: [{ id: 'w1', name: 'Savor', network: 'Mastercard', annualFee: 0, earnType: 'cash', cpp: 1, debtId: 'd1', rules: [{ id: 'r', category: 'dining', rate: 3 }], credits: [] }],
    merchants: [], cardSpend: [], spendProfile: { dining: 300 }, insightDismissals: {}, settings: { currency: 'USD', locale: 'en-US', weekStart: 0, reduceMotion: false } });
  const v6 = Object.assign(JSON.parse(JSON.stringify(v5)), { version: 6, credit: { targetCard: 25, targetOverall: 8, goal: 'overall', leadDays: 3, mode: 'next', scores: [{ id: 's', date: '2026-09-01', score: 712, model: 'FICO 8', source: 'Bank' }], inquiries: [] } });
  Object.assign(v6.debts[0], { closingDay: 18, cardKind: 'revolving', openDate: '2019-05-01', utilInclude: true, monthlySpend: null });
  Object.assign(v6.wallet[0], { creditLimit: null, keepOpen: 0, currentBalance: 0, closingDay: null, dueDay: null, cardKind: 'revolving', openDate: '', utilInclude: true, monthlySpend: null });
  const same = (a, b, path) => {
    if (a && typeof a === 'object' && !Array.isArray(a)) { for (const k of Object.keys(a)) { if (k === 'version') continue; same(a[k], b[k], `${path}.${k}`); } }
    else if (Array.isArray(a)) { assert.equal(b.length, a.length, `${path} length`); a.forEach((x, i) => same(x, b[i], `${path}[${i}]`)); }
    else assert.deepEqual(b, a, path);
  };
  for (const [label, old] of [['v1', v1], ['v2', v2], ['v3', v3], ['v4', v4], ['v5', v5], ['v6', v6]]) {
    const snap = JSON.parse(JSON.stringify(old));
    const m = normalize(old, TODAY);
    assert.deepEqual(old, snap, `${label}: input not mutated`);
    assert.equal(m.version, 7, `${label} → v7`);
    same(old, m, label);   // every saved field kept with the same value, nothing renamed
    assert.deepEqual(m.statements, [], `${label}: no statements yet`);
    m.debts.forEach((d) => assert.equal(d.last4, '', `${label}: blank last 4`));
    m.wallet.forEach((w) => assert.equal(w.last4, ''));
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(m)), TODAY), m, `${label}: idempotent`);
    // everything that reads statements works on migrated data
    assert.deepEqual(E.statementAlerts(m, TODAY), []);
    E.statementDay(m, TODAY); E.missingPlanInfo(m); E.computeInsights(m, TODAY);
    // …and snapping a statement onto migrated data works
    const res = E.applyStatement(m, 'd1', vals(F.capitalOneSavor), NOW, { issuer: 'capitalone', source: 'pdf' });
    assert.equal(res.stmt.closingDate, '2026-09-18');
    assert.equal(m.debts[0].last4, '4821');
    if (m.wallet.length) assert.equal(m.wallet[0].last4, '4821');
    assert.deepEqual(normalize(JSON.parse(JSON.stringify(m)), TODAY), m, `${label}: round-trips after a snap`);
  }
  // v7 data round-trips, and junk statement entries are dropped safely
  const v7 = normalize({ debts: [{ id: 'd', name: 'D', balance: 5, last4: '0042' }], statements: [
    { id: 's1', acctId: 'd', debtId: 'd', closingDate: '2026-08-18', balance: '12.345', apr: 'x', last4: 42, source: 'fax', issuer: 'nope' },
    { acctId: 'd', closingDate: 'soon' }, 'junk', null, { closingDate: '2026-09-01' }] }, TODAY);
  assert.equal(v7.debts[0].last4, '0042');
  assert.equal(v7.statements.length, 1);
  assert.deepEqual(pick(v7.statements[0], ['balance', 'apr', 'last4', 'source', 'issuer']), { balance: 12.35, apr: null, last4: '', source: null, issuer: null });
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(v7)), TODAY), v7);
});

console.log(`\nAll ${count} statement tests passed.`);

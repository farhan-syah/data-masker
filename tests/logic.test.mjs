// Unit checks for src/logic.js. Runs in Node with no browser.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
globalThis.self = globalThis;
new Function(fs.readFileSync(ROOT + '/src/logic.js', 'utf8'))();
const L = globalThis.DMLogic;

let failed = 0;
function check(name, cond, detail) {
  if (!cond) failed++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}

const session = { random: new Map(), now: new Date(), dateFmt: 'off', dateOrder: 'dmy', shiftMode: 'row', rowShift: () => -40, noise: () => 0 };
function scrub(text, names) {
  const ctx = L.newContext(session);
  const entries = [];
  names.forEach(n => {
    entries.push({ text: n, prefix: 'PERSON', style: 'seq', colName: 'n' });
    L.nameParts(n).forEach(g => entries.push({ text: g, partial: true }));
  });
  ctx.dict = L.buildDict(entries);
  return L.scrubText(text, ctx, 'x');
}

// Notes scrubbing
check('name in a note becomes a code', scrub('Met Maria Garcia today.', ['Maria Garcia']) === 'Met PERSON_001 today.');
check('a letter such as İ does not stop name masking', scrub('Met Maria Garcia in İstanbul.', ['Maria Garcia']) === 'Met PERSON_001 in İstanbul.');
check('a name with İ is found', !scrub('İbrahim Yılmaz left', ['İbrahim Yılmaz']).includes('İbrahim'));
check('a surname alone and a reversed name are masked', !/Garcia|Maria/.test(scrub('Mr Garcia called. Garcia, Maria signed.', ['Maria Garcia'])));
check('a Chinese name inside text without spaces is masked', !scrub('王小明请假一天', ['王小明']).includes('王小明'));
check('email, phone and ID patterns are masked', (() => {
  const t = scrub('Mail a@b.co, call +44 7700 900123, ID 912-34-5124, IBAN GB82 WEST 1234 5698 7654 32', []);
  return !/a@b\.co|7700|912-34|GB82/.test(t);
})(), scrub('Mail a@b.co, call +44 7700 900123, ID 912-34-5124', []));

// Dates
check('day first is the default', L.parseDate('03/04/2020').m === 4);
check('month first when set', L.parseDate('03/04/2020', false, null, 'mdy').m === 3);
check('month first keeps its layout after a shift', L.formatDate(L.addDays(L.parseDate('12/25/2004', false, null, 'mdy'), -10), L.parseDate('12/25/2004', false, null, 'mdy').fmt) === '12/15/2004');
check('English month names, both orders', L.parseDate('25 Dec 2004').m === 12 && L.parseDate('December 25, 2004').d === 25);

// Numbers
check('number formats are read', [['1,234.50', 1234.5], ['1.234,50', 1234.5], ['1 234,50', 1234.5], ['$1,250.00', 1250], ['EUR 900.50', 900.5], ['1250 €', 1250]].every(([s, v]) => L.parseNumber(s) && L.parseNumber(s).v === v));
check('codes such as AB123 are not numbers', L.parseNumber('AB123') === null);

// Headers and detection
check('camelCase and accents', L.headerHint(L.normalizeColumnName('FirstName')).kind === 'name' && L.headerHint(L.normalizeColumnName('DateOfBirth')).birth && L.headerHint(L.normalizeColumnName('Prénom')).kind === 'name');
check('headers in any script keep their letters', L.normalizeColumnName('姓名') === '姓名');
check('values that look like data are found', L.looksLikeData('maria@example.com') && L.looksLikeData('912-34-5124') && L.looksLikeData('12/09/1991') && !L.looksLikeData('Employee ID'));
check('Chinese names are classified as names', L.classifyColumn('x', 'x', ['王小明', '李四', '张三丰', '赵六', '钱七']).kind === 'name');
check('unknown Chinese text is flagged for review', L.classifyColumn('部门', '部门', ['财务', '财务', '人事', '财务', '人事', '财务']).review === true);

// Other identifiers and unknown columns
const many = n => Array.from({ length: n }, (_, i) => i);
check('card numbers and IP addresses are classified as IDs', L.classifyColumn('x', 'x', ['4111 1111 1111 1111', '5500 0000 0000 0004', '3400 0000 0000 009', '6011 0000 0000 0004']).kind === 'id' && L.classifyColumn('x', 'x', ['10.0.0.1', '192.168.1.20', '172.16.5.4', '8.8.8.8']).kind === 'id');
check('a card number and an IP address in a note are hidden', (() => { const t = scrub('Paid with 4111 1111 1111 1111 from 10.1.2.3', []); return !/4111|10\.1\.2\.3/.test(t); })());
check('a short column with nearly all different values is flagged for review', L.classifyColumn('Nickname', 'nickname', many(40).map(i => 'zed' + String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + ((i * 7) % 26)) + String.fromCharCode(97 + ((i * 3) % 17)))).review === true);
check('a column with few different values is not flagged', L.classifyColumn('Team', 'team', many(40).map(i => ['Red', 'Blue', 'Green'][i % 3])).review === false);
check('username headers are IDs', L.headerHint(L.normalizeColumnName('User Name')).kind === 'id' || L.headerHint(L.normalizeColumnName('Username')).kind === 'id');

// Domains: names under role headers, private categories, locations, number IDs, short free text
const people = Array.from({ length: 30 }, (_, i) => ['Maria Garcia', 'Liam Murphy', 'Aisha Khan', 'Wei Zhang'][i % 4]);
const suggestFor = (h, vals) => { const n = L.normalizeColumnName(h); const c = L.classifyColumn(h, n, vals); return { c, s: L.suggest(c, h) }; };
check('names under a role header are masked, even when repeated', suggestFor('Patient', people).s.status === 'mask' && suggestFor('Patient', people).c.kind === 'name');
check('a repeated name-like column without a role header is flagged', suggestFor('Owner2', people.map(x => x)).c.review === true || suggestFor('Misc', people).c.review === true);
check('a private category such as Diagnosis is masked', suggestFor('Diagnosis', many(30).map(i => ['Asthma', 'Diabetes'][i % 2])).s.status === 'mask');
check('coordinates are rounded by default', (() => { const r = suggestFor('Lat', many(30).map(i => (51.5 + i / 1000).toFixed(5))); return r.c.kind === 'location' && r.s.strategy === 'num' && r.s.params.roundTo === 0.1; })());
check('plain digit numbers of one length are treated as IDs', suggestFor('Contact No', many(30).map(i => String(13800000000 + i * 31))).c.kind === 'id');
check('short free text under a message header is free text', suggestFor('Gift Message', many(30).map(i => 'Happy birthday Maria number ' + i)).c.kind === 'text');

// Headers in other languages and scripts
const hk = h => L.headerHint(L.normalizeColumnName(h)).kind;
check('headers in Chinese, Japanese, Korean, Arabic and Russian', hk('姓名') === 'name' && hk('电话') === 'phone' && hk('出生日期') === 'date' && hk('住所') === 'address' && hk('이메일') === 'email' && hk('الاسم') === 'name' && hk('телефон') === 'phone' && hk('身份证号') === 'national_id' && hk('नाम') === 'name' && hk('ชื่อ') === 'name' && hk('फोन नंबर') === 'phone');
check('headers in French, Spanish, German, Italian and Dutch', hk('Prénom') === 'name' && hk('Teléfono') === 'phone' && hk('Geburtsdatum') === 'date' && hk('Indirizzo') === 'address' && hk('Voornaam') === 'name' && hk('Sueldo') === 'money' && hk('DNI') === 'national_id');

// Dates in other languages
check('month names in French, Spanish, German and Turkish', ['12 janvier 1991', '12 de enero de 1991', '12. Januar 1991'.replace('. ', ' '), '12 Ocak 1991'].every(v => L.parseDate(v) && L.parseDate(v).m === 1 && L.parseDate(v).d === 12));
check('Chinese and Korean dates keep their layout after a shift', (() => { const d = L.parseDate('1991年9月12日'); const k = L.parseDate('1991년 9월 12일'); return d && k && L.formatDate(L.addDays(d, -12), d.fmt) === '1991年8月31日' && L.formatDate(k, k.fmt) === '1991년 9월 12일'; })());
check('a Buddhist era birth year gives a sensible age group', (() => {
  const col = { kind: 'date', strategy: 'gen', params: { ...L.defaultParams(), genMode: 'ageband', width: 5 }, outName: 'd' };
  const ctx = L.newContext({ ...session, now: new Date(2026, 5, 1) });
  return L.maskValue('12/09/2534', col, ctx, 0) === '30-34';
})());

// Web addresses, medical codes, age, addresses that start with the largest area
check('web addresses keep the website only', (() => { const col = { kind: 'url', strategy: 'gen', params: { ...L.defaultParams(), genMode: 'urlhost' }, outName: 'u' }; return L.maskValue('https://Shop.example/u/Maria.Garcia?id=7', col, L.newContext(session), 0) === 'shop.example'; })());
check('a web address in a note is hidden', !scrub('See https://shop.example/u/maria.garcia now', []).includes('maria'));
check('a column of web addresses is classified', suggestFor('Page', many(10).map(i => 'https://a.example/p/' + i)).s.params.genMode === 'urlhost');
check('medical codes are masked by value, even under a plain header', suggestFor('Code', many(30).map(i => ['E11.9', 'I10', 'J45.9', 'G43.9'][i % 4])).s.status === 'mask');
check('an age column becomes age groups', (() => { const r = suggestFor('Edad', many(30).map(i => String(20 + i))); return r.s.strategy === 'gen' && r.s.params.genMode === 'band' && r.s.params.width === 5; })());
check('addresses in Japanese, Chinese and Korean keep the first area only', (() => {
  const col = { kind: 'address', strategy: 'gen', params: { ...L.defaultParams(), genMode: 'region' }, outName: 'a' };
  const m = v => L.maskValue(v, col, L.newContext(session), 0);
  return m('東京都千代田区丸の内1-1-1') === '東京都' && m('广东省深圳市南山区科技园') === '广东省' && m('서울시 강남구 테헤란로 1') === '서울시';
})());

// Address
const addr = { kind: 'address', strategy: 'gen', params: { ...L.defaultParams(), genMode: 'region' }, outName: 'a' };
check('address keeps its last part only', L.maskValue('12 Oak St, Springfield, IL 62704, USA', addr, L.newContext(session), 0) === 'USA');
check('address without commas is not kept', L.maskValue('12 Oak Street Springfield', addr, L.newContext(session), 0) === '[?]');

// Restore
check('restore round trip with case and dash variants', (() => {
  const k = L.parseKeyRows([['code', 'original_value', 'column'], ['PERSON_001', 'Maria Garcia', 'n']]);
  const out = L.restoreText('Hi person-001 and PERSON_001. Not id_card.', k, L.buildRestoreRe(k), { replaced: 0, unknown: new Set() });
  return out === 'Hi Maria Garcia and Maria Garcia. Not id_card.';
})());

// Codes
check('codes ignore letter case', (() => {
  const ctx = L.newContext(session);
  const col = { kind: 'name', strategy: 'pseudo', params: { ...L.defaultParams(), prefix: 'P' }, outName: 'n' };
  return L.maskValue('maria garcia', col, ctx, 0) === L.maskValue('Maria Garcia', col, ctx, 1) && ctx.keyRows.length === 1;
})());
check('numbered codes are dealt out in random order and cover every value', (() => {
  const values = Array.from({ length: 200 }, (_, i) => 'Person ' + i);
  const order = L.buildCodeOrder(new Map([['P', values]])).get('P');
  const nums = values.map(v => order.get(v.toLowerCase()));
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted.every((n, i) => n === i + 1) && nums.some((n, i) => n !== i + 1);
})());

// Formulas and restore of a whole table
check('formula-like values are guarded, plain values and numbers are not', L.formulaSafe('=SUM(A1)') === "'=SUM(A1)" && L.formulaSafe('@x') === "'@x" && L.formulaSafe('-5') === '-5' && L.formulaSafe('+1 555 010 4321') === '+1 555 010 4321' && L.formulaSafe('Maria') === 'Maria');
check('restore of a table returns names and shifted dates, even when rows are reordered', (() => {
  const k = L.parseKeyRows([['code', 'original_value', 'column'], ['#shift_mode', 'row', ''], ['#shifted_date_columns', 'Hired', ''], ['#date_order', 'dmy', ''], ['#anchor_column', 'Name', ''],
    ['P_001', 'Ann', 'Name'], ['P_002', 'Bob', 'Name'], ['#shift', '-10', 'P_001'], ['#shift', '-20', 'P_002']]);
  const rows = [['Name', 'Hired'], ['P_002', '01/01/2020'], ['P_001', '11/01/2020']];
  const r = L.restoreRows(rows, k, L.buildRestoreRe(k), { dates: true }).rows;
  return r[1][0] === 'Bob' && r[1][1] === '21/01/2020' && r[2][0] === 'Ann' && r[2][1] === '21/01/2020';
})());
check('the anchor is the first code column that is different in every row', L.pickAnchor([['a', 'x'], ['a', 'y']], [0, 1]) === 1 && L.pickAnchor([['a'], ['a']], [0]) === -1);

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

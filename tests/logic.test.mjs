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

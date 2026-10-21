// Browser test for index.html in headless Chromium. It protects four things:
// no network request, no original value in any download, restore returns the real values,
// and the match file fits the masked data. Set CHROMIUM_PATH to use a system browser.
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const TOOL = ROOT + '/index.html';
const SAMPLES = ROOT + '/samples/';
const OUT = HERE + '/out';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT, { recursive: true });
const XLSX = require(ROOT + '/vendor/sheetjs/xlsx.full.min.js');

let failed = 0;
function check(name, cond, detail) {
  if (!cond) failed++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && detail !== undefined ? ' :: ' + String(detail).slice(0, 300) : ''));
}
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"' && f === '') { q = true; continue; }
    if (c === ',') { row.push(f); f = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; continue; }
    f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const toObjs = aoa => aoa.slice(1).map(r => Object.fromEntries(aoa[0].map((k, i) => [k, r[i] ?? ''])));
const csvOf = p => parseCSV(fs.readFileSync(p, 'utf8'));
const orig = toObjs(csvOf(SAMPLES + 'staff-list-sample.csv'));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 768 } });
const requests = [], errors = [];
context.on('request', r => requests.push(r.url()));
const STAR_URL = 'https://api.github.com/repos/farhan-syah/data-masker';
const starCalls = [];
await context.route('**/*', route => {
  const rq = route.request(), u = rq.url();
  if (u.startsWith('file:')) return route.continue();
  if (u === STAR_URL) { starCalls.push({ method: rq.method(), body: rq.postData() }); return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ stargazers_count: 42 }) }); }
  return route.abort();
});

let page;
async function open() {
  page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(pathToFileURL(TOOL).href);
  await page.waitForFunction(() => window.__dm);
}
const tab = async id => { await page.click(`[aria-controls="${id}"]`); await page.waitForTimeout(120); };
async function load(file) {
  await page.setInputFiles('#file-input', file);
  const base = path.basename(file);
  await page.waitForFunction(b => window.__dm.state.file && window.__dm.state.file.name === b && window.__dm.state.cols.length > 0, base, { timeout: 30000 });
}
const colIdx = h => page.evaluate(h => window.__dm.state.cols.findIndex(c => c.header === h), h);
async function setStatus(h, st) { const i = await colIdx(h); await page.click(`label[for="s-${i}-${st}"]`); }
async function download(click, tag) {
  const p = page.waitForEvent('download', { timeout: 30000 });
  await click();
  const d = await p; const dest = `${OUT}/${tag}-${d.suggestedFilename()}`; await d.saveAs(dest); return dest;
}
const generate = async () => {
  await tab('p-export');
  await page.evaluate(() => window.__dm.generate());
  await page.waitForFunction(() => window.__dm.state.result && window.__dm.state.result.version === window.__dm.state.version);
};
const downloadKey = tag => download(async () => {
  await page.click('#dl-key'); await page.waitForSelector('#key-dialog[open]');
  await page.check('#key-ack'); await page.click('#key-confirm');
}, tag);

// ---------- sample: suggestions, examples, downloads, leaks ----------
await open();
await page.waitForFunction(() => !document.querySelector('#stars').hidden, null, { timeout: 5000 });
check('the footer shows the star count', (await page.textContent('#stars')).includes('42'));
check('data tabs are off before a file is open', await page.$eval('#tab-columns', e => e.disabled));
await load(SAMPLES + 'staff-list-sample.csv');
const kinds = await page.evaluate(() => Object.fromEntries(window.__dm.state.cols.map(c => [c.header, c.kind + '/' + c.status + '/' + c.strategy])));
check('suggestions fit the column names and values', kinds['Full Name'] === 'name/mask/pseudo' && kinds['National ID'] === 'national_id/mask/pseudo' &&
  kinds['Phone'] === 'phone/mask/partial' && kinds['Address'] === 'address/mask/gen' && kinds['Date of Birth'] === 'date/accept/shift' &&
  kinds['Hire Date'] === 'date/accept/shift' && kinds['Salary'] === 'money/accept/num' && kinds['Notes'] === 'text/mask/scrub' && kinds['Department'] === 'category/accept/pseudo', JSON.stringify(kinds));
check('month-first dates are detected from the values', await page.evaluate(() => window.__dm.state.sanitise.dateOrder) === 'mdy');

await tab('p-columns');
await setStatus('Salary', 'mask'); await setStatus('Hire Date', 'mask'); await setStatus('Date of Birth', 'mask');
const exNames = await page.$$eval('#ex-1 .ex-list li code:last-child', els => els.map(e => e.textContent));
await generate();
const csv1 = await download(() => page.click('#dl-csv'), 'one');
const masked1 = toObjs(csvOf(csv1));
check('card examples show the same codes as the download', exNames.length === 3 && exNames.every((c, i) => c === masked1[i]['Full Name']), exNames.join());

const xlsx1 = await download(() => page.click('#dl-xlsx'), 'one');
const schema = await download(() => page.click('#dl-schema'), 'one');
check('a download shows a visible message', /Downloaded/.test(await page.textContent('#toast')) && await page.isVisible('#toast'));
await page.click('#copy-schema');
await page.waitForFunction(() => !document.querySelector('#toast').hidden && /Copied|Copy did not work/.test(document.querySelector('#toast').textContent));
check('a copy shows a visible message', true);
await tab('p-columns');
await page.evaluate(() => { document.querySelector('details.card').open = true; });
const settings = await download(() => page.click('#preset-save'), 'one');
const wb = XLSX.read(fs.readFileSync(xlsx1), { type: 'buffer' });
const xlsxText = JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }));
const everything = [fs.readFileSync(csv1, 'utf8'), xlsxText, fs.readFileSync(schema, 'utf8'), fs.readFileSync(settings, 'utf8')].join('\n');
const leaks = [];
orig.forEach(r => ['Full Name', 'National ID', 'Email', 'Phone', 'Employee ID'].forEach(k => { if (everything.includes(r[k])) leaks.push(r[k]); }));
check('no original name, ID, email or phone in the CSV, XLSX, column names or settings', leaks.length === 0, leaks.slice(0, 4).join(' | '));
check('column names export shows no real value for a kept column', !orig.some(r => fs.readFileSync(schema, 'utf8').includes(r['Job Title']) || fs.readFileSync(schema, 'utf8').includes(r['Notes']) && r['Notes']));
const salaryOk = masked1.every((r, i) => /^\d+(\.\d+)?$/.test(r['Salary']) && Math.abs(+r['Salary'] / +orig[i]['Salary'] - 1) <= 0.0501);
const dobOk = masked1.every(r => /^\d\d\/\d\d\/\d{4}$/.test(r['Date of Birth']));
const meanOf = a => a.reduce((x, y) => x + y, 0) / a.length;
const meanShift = Math.abs(meanOf(masked1.map(r => +r['Salary'])) / meanOf(orig.map(r => +r['Salary'])) - 1);
check('salary stays a number within 5 percent, and the average stays close, so charts still work', salaryOk && meanShift < 0.03, meanShift);
check('a masked date of birth is still a date', dobOk, masked1.slice(0, 3).map(r => r['Date of Birth']).join());
check('codes are one to one', new Set(masked1.map(r => r['Full Name'])).size === 60 && /^PERSON_\d{3}$/.test(masked1[0]['Full Name']));
check('the file names hold no source name', /masked-data-[A-Z0-9]{4}-\d{8}-\d{4}\.csv$/.test(csv1) && !/staff-list/.test(csv1));

// The match file must fit the masked data that was downloaded, even after a settings change.
await setStatus('Notes', 'hide');
await tab('p-export');
const key1 = await downloadKey('one');
const keyRows = csvOf(key1);
const key = new Map(keyRows.filter(r => r[0] && r[0][0] !== '#' && r[0] !== 'code').map(r => [r[0], r[1]]));
check('match file fits the downloaded data after a settings change', masked1.every((r, i) => key.get(r['Full Name']) === orig[i]['Full Name']));
check('match file holds the run ID and English field names', keyRows[0].join() === 'code,original_value,column' && keyRows.some(r => r[0] === '#run_id') && /MATCH-FILE-[A-Z0-9]{4}-/.test(key1));
check('the page warns that settings changed after the download', /changed settings/i.test(await page.textContent('#export-msg')), await page.textContent('#export-msg'));

// ---------- row choice gives feedback and the preview follows it ----------
await tab('p-export');
await page.check('input[name=rows-mode][value=first]'); await page.fill('#rows-n', '3');
const firstInfo = await page.evaluate(() => ({ s: document.querySelector('#rows-summary').textContent, rows: document.querySelectorAll('#preview tbody tr').length, nums: [...document.querySelectorAll('#preview tbody th')].map(e => e.textContent) }));
check('first rows: the summary and the preview follow the choice', /first 3 rows of 60/.test(firstInfo.s) && firstInfo.rows === 3 && firstInfo.nums.join() === '1,2,3', JSON.stringify(firstInfo));
await page.check('input[name=rows-mode][value=random]'); await page.fill('#rows-n', '20');
const rndInfo = await page.evaluate(() => ({ s: document.querySelector('#rows-summary').textContent, rows: document.querySelectorAll('#preview tbody tr').length }));
check('random rows: the preview shows at most 5 rows', /20 random rows out of 60/.test(rndInfo.s) && rndInfo.rows === 5, JSON.stringify(rndInfo));
await page.check('input[name=rows-mode][value=all]');
check('all rows: the summary says so', /all 60 rows/.test(await page.textContent('#rows-summary')));

// ---------- restore ----------
await tab('p-restore');
await page.setInputFiles('#key-input', key1); await page.waitForSelector('#key-msg.ok');
await page.check('input[name=restore-src][value=file]');
await page.setInputFiles('#restore-file', csv1); await page.waitForSelector('#restore-file-msg.ok');
await page.click('#restore-btn'); await page.waitForSelector('#restore-table-out:not([hidden])');
const restored = toObjs(csvOf(await download(() => page.click('#restore-dl-csv'), 'restored')));
const cols = ['Full Name', 'National ID', 'Employee ID', 'Email', 'Date of Birth', 'Hire Date'];
check('restore returns names, IDs, emails and shifted dates exactly', restored.every((r, i) => cols.every(c => r[c] === orig[i][c])));
const rows = csvOf(csv1); const rev = [rows[0], ...rows.slice(1).reverse()];
const revFile = OUT + '/reversed.csv';
fs.writeFileSync(revFile, '﻿' + rev.map(r => r.map(v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',')).join('\r\n'));
await page.setInputFiles('#restore-file', revFile);
await page.waitForFunction(() => /reversed/.test(document.querySelector('#restore-file-msg').textContent));
await page.click('#restore-btn');
const restoredRev = toObjs(csvOf(await download(() => page.click('#restore-dl-csv'), 'restored-rev'))).reverse();
check('restore still returns exact dates when rows are in another order', restoredRev.every((r, i) => cols.every(c => r[c] === orig[i][c])));
await page.check('input[name=restore-src][value=text]');
const code = masked1[0]['Full Name'];
await page.fill('#restore-text', `${code} and ${code.toLowerCase().replace('_', '-')} and PERSON_999.`);
await page.click('#restore-btn'); await page.waitForSelector('#restore-text-out:not([hidden])');
check('pasted text is restored, unknown codes are reported', await page.inputValue('#restore-output') === `${orig[0]['Full Name']} and ${orig[0]['Full Name']} and PERSON_999.` && /PERSON_999/.test(await page.textContent('#restore-msg')));
await page.close();

// ---------- methods that change the format are opt-in, with a clear warning ----------
await open();
await load(SAMPLES + 'staff-list-small.csv');
await tab('p-columns');
await setStatus('Salary', 'mask');
const salI = await colIdx('Salary');
const offered = await page.$$eval(`#f-${salI}-strategy option`, o => o.map(x => x.textContent));
check('a number column offers a range method that says it changes the format', offered.some(t => /changes the format/.test(t)) && offered.some(t => /Round or change numbers/.test(t)), offered.join(' | '));
await page.selectOption(`#f-${salI}-strategy`, 'group');
check('the card warns that the format changes', /changes the format/i.test(await page.textContent(`#card-${salI} .msg.warn`)));
const dobI = await colIdx('Date of Birth');
await setStatus('Date of Birth', 'mask'); await page.selectOption(`#f-${dobI}-strategy`, 'group'); await page.selectOption(`#f-${dobI}-genMode`, 'year');
await generate();
const grp = toObjs(csvOf(await download(() => page.click('#dl-csv'), 'group')));
check('salary becomes a range and date of birth becomes a year', grp.every(r => /^\d+-\d+$/.test(r['Salary']) && /^\d{4}$/.test(r['Date of Birth'])), JSON.stringify(grp[0]));
check('the download summary lists the columns whose format changed', /format changed in: .*Salary/i.test(await page.textContent('#export-status')), await page.textContent('#export-status'));
await page.close();

// ---------- a file with no header row must not leak its first row ----------
await open();
const small = fs.readFileSync(SAMPLES + 'staff-list-small.csv', 'utf8').split(/\r?\n/).filter(Boolean);
const noHeader = OUT + '/no-header.csv';
fs.writeFileSync(noHeader, small.slice(1).join('\r\n'));
await load(noHeader);
const nh = await page.evaluate(() => ({ on: window.__dm.state.noHeader, rows: window.__dm.state.rows.length, heads: window.__dm.state.cols.map(c => c.header) }));
check('a file without a header row is detected and keeps its first row as data', nh.on && nh.rows === 8 && nh.heads[0] === 'Column 1', JSON.stringify(nh));
await generate();
const nhSchema = await download(() => page.click('#dl-schema'), 'nh');
check('column names export holds no value from row 1', !/Maria|912-34|Garcia/.test(fs.readFileSync(nhSchema, 'utf8')));
await page.close();

// ---------- other inputs ----------
await open();
await load(SAMPLES + 'staff-list-sample.xlsx');
check('XLSX opens below its title row, with a sheet picker and real dates', await page.evaluate(() => window.__dm.state.headerRow === 1 && /^\d{4}-\d\d-\d\d$/.test(window.__dm.state.rows[0][7])) && await page.isVisible('#sheet-select'));
await page.close();
await open();
await load(ROOT + '/tests/fixtures/serial.xlsx');
check('Excel serial numbers under date headers become dates', await page.evaluate(() => window.__dm.state.cols.slice(1, 3).every(c => c.kind === 'date' && c.serialDates)));
await page.close();
await open();
await load(ROOT + '/tests/fixtures/sample.xls');
check('old .xls files open', await page.evaluate(() => window.__dm.state.rows.length === 60));
await page.close();
await open();
const latin = OUT + '/latin1.csv';
fs.writeFileSync(latin, Buffer.from('Name,City\nJosé,Málaga\nZoë,Köln\n', 'latin1'));
await load(latin);
check('a file that is not UTF-8 is read and the page says it guessed', await page.evaluate(() => window.__dm.state.rows[0][0] === 'José' && window.__dm.state.file.guessed === true));
await page.close();
await open();
const cjk = OUT + '/cjk.csv';
fs.writeFileSync(cjk, '﻿姓名,部门,备注\n王小明,财务,请假\n李四,人事,出差\n张三丰,财务,请假\n赵六,人事,病假\n钱七,财务,出差\n');
await load(cjk);
const cj = await page.evaluate(() => window.__dm.state.cols.map(c => c.kind + '/' + c.status + '/' + !!c.review));
check('Chinese names are masked and other Chinese text is flagged', cj[0] === 'name/mask/false' && cj[1] === 'category/accept/true', cj.join());
await page.close();

// ---------- no network, even from a web server ----------
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(fs.readFileSync(TOOL)); });
await new Promise(res => server.listen(0, '127.0.0.1', res));
const url = `http://127.0.0.1:${server.address().port}/`;
await context.route(url + '**', route => route.continue());
page = await context.newPage();
page.on('console', () => {});
await page.goto(url);
await page.waitForFunction(() => window.__dm);
const probe = await page.evaluate(async () => {
  const out = {};
  try { await fetch('https://example.com/x'); out.other = 'sent'; } catch (e) { out.other = 'refused'; }
  try { await fetch('/index.html'); out.same = 'sent'; } catch (e) { out.same = 'refused'; }
  return out;
});
check('the page refuses fetch to another site and to its own server', probe.other === 'refused' && probe.same === 'refused', JSON.stringify(probe));
await page.close(); server.close();
const stray = requests.filter(u => !/^(file|data|blob):/.test(u) && !u.startsWith(url) && u !== STAR_URL);
check('no request left the page except the GitHub star count', stray.length === 0, stray.join(' '));
check('the star count request is one plain GET with no body', starCalls.length >= 1 && starCalls.every(c => c.method === 'GET' && !c.body), JSON.stringify(starCalls));
check('no page errors', errors.filter(e => !/example\.com|index\.html|Failed to fetch|Content Security Policy|ERR_FAILED/.test(e)).length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);

/* Data Masker user interface. */
(function () {
  'use strict';
  var L = window.DMLogic;
  var PREVIEW_ROWS = 5;
  var CHUNK = 1000;
  var SAMPLE_CSV = 'Full Name,National ID,Grade,Department,Date of Birth,Hire Date,Salary,Notes\r\n' +
    'Maria Garcia,912-34-5124,L4,Finance,04/12/1988,07/01/2014,4120.00,Parental leave until 11/30/2026\r\n' +
    'Liam Murphy,923-45-6031,L5,Operations,09/23/1979,03/15/2005,5300.00,\r\n' +
    'Aisha Khan,934-56-5302,L1,Operations,01/17/1995,05/02/2019,2050.00,Covering for Liam Murphy while on a course\r\n' +
    'Wei Zhang,945-67-5468,L3,Finance,06/05/1990,10/01/2016,2480.00,\r\n' +
    'Priya Sharma,956-78-5599,L4,Finance,11/30/1985,08/19/2011,3890.50,Team lead. Call +1 555 010 4477 if urgent\r\n' +
    'Lars Andersson,967-89-5712,L2,Operations,02/14/1992,06/01/2018,2975.25,\r\n' +
    'Olga Ivanova,978-90-5820,L5,Finance,12/01/1975,09/12/2001,6100.00,Supervisor: Maria Garcia\r\n' +
    'Chinedu Okafor,989-01-5931,L3,Operations,10/09/1983,04/18/2012,3320.00,\r\n';
  var ENCODINGS = [['utf-8', 'UTF-8 (Unicode)'], ['windows-1252', 'Western European (Windows-1252)'], ['iso-8859-2', 'Central European (ISO-8859-2)'],
    ['windows-1250', 'Central European (Windows-1250)'], ['windows-1251', 'Cyrillic (Windows-1251)'], ['koi8-r', 'Cyrillic (KOI8-R)'],
    ['windows-1253', 'Greek (Windows-1253)'], ['windows-1254', 'Turkish (Windows-1254)'], ['windows-1255', 'Hebrew (Windows-1255)'],
    ['windows-1256', 'Arabic (Windows-1256)'], ['windows-1257', 'Baltic (Windows-1257)'], ['windows-1258', 'Vietnamese (Windows-1258)'],
    ['windows-874', 'Thai (Windows-874)'], ['shift_jis', 'Japanese (Shift_JIS)'], ['euc-jp', 'Japanese (EUC-JP)'], ['gbk', 'Chinese (GBK)'],
    ['big5', 'Chinese Traditional (Big5)'], ['euc-kr', 'Korean (EUC-KR)'], ['utf-16le', 'UTF-16 little-endian'], ['utf-16be', 'UTF-16 big-endian']];

  // ---------- helpers ----------
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function trunc(s, n) { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function tick() { return new Promise(function (r) { setTimeout(r, 0); }); }
  function fmtInt(n) { return Number(n).toLocaleString('en-GB'); }
  function fmtBytes(n) { return n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function stamp() {
    var d = new Date();
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function announce(msg) { var r = $('#live'); r.textContent = ''; setTimeout(function () { r.textContent = msg; }, 30); }
  function setMsg(el, kind, html) {
    el.className = 'msg ' + (kind || '');
    el.innerHTML = html || '';
    el.hidden = !html;
  }

  function csvEscape(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]|^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // safe: protect cells that a spreadsheet program could run as formulas. Not used for the match file, which must keep exact values.
  function toCSV(aoa, safe) {
    return aoa.map(function (r) { return r.map(function (v) { return csvEscape(safe ? L.formulaSafe(v) : v); }).join(','); }).join('\r\n') + '\r\n';
  }

  function download(name, data, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
    announce('Downloaded ' + name + '.');
  }
  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      announce(ok ? okMsg : 'Copy did not work. Select the text and press Ctrl+C.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { announce(okMsg); }, fallback);
    } else fallback();
  }

  // ---------- worker bridge ----------
  var Bridge = (function () {
    var worker = null, seq = 0, pending = new Map();
    function runMain(msg) { return Promise.resolve().then(function () { return window.DMCore.handle(msg); }); }
    try {
      var src = $('#lib-xlsx').textContent + '\n;\n' + $('#core-src').textContent;
      var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      worker = new Worker(url);
      worker.onmessage = function (e) {
        var d = e.data, p = pending.get(d.id);
        if (!p) return;
        pending.delete(d.id);
        if (d.ok) p.resolve(d.result); else p.reject(new Error(d.error));
      };
      worker.onerror = function (e) {
        if (e && e.preventDefault) e.preventDefault();
        worker = null;
        var list = Array.from(pending.values()); pending.clear();
        list.forEach(function (p) { runMain(p.msg).then(p.resolve, p.reject); });
      };
    } catch (e) { worker = null; }
    return {
      call: function (msg) {
        if (!worker) return runMain(msg);
        return new Promise(function (resolve, reject) {
          var id = ++seq; msg.id = id;
          pending.set(id, { resolve: resolve, reject: reject, msg: msg });
          worker.postMessage(msg);
        });
      },
      mode: function () { return worker ? 'worker' : 'main'; }
    };
  })();

  // ---------- state ----------
  var noiseCache = new Map();
  var rowShiftCache = new Map();
  var state = {
    file: null, sheets: [], sheet: null, raw: [], headerRow: 0, noHeader: false, buf: null, lastData: null, dlData: '', dlKey: '',
    headers: [], rows: [], cols: [], validation: null,
    sanitise: { dateFmt: 'off', dateOrder: 'dmy', trim: true, normHeader: false, ctrl: true, empty: true },
    rowsMode: 'all', rowsN: 50, sampleIdx: null, sampleKey: '',
    version: 0, result: null, dictCache: null,
    session: {
      random: new Map(), now: new Date(), shiftDays: L.randomShiftDays(), dateFmt: 'off', dateOrder: 'dmy', shiftMode: 'row',
      rowShift: function (r) {
        var d = rowShiftCache.get(r);
        if (d === undefined) { d = L.randomShiftDays(); rowShiftCache.set(r, d); }
        return d;
      },
      noise: function (r, c) {
        var key = r * 4096 + c;
        var u = noiseCache.get(key);
        if (u === undefined) { u = L.randUnit() * 2 - 1; noiseCache.set(key, u); }
        return u;
      }
    }
  };

  var STRATEGIES = [
    ['pseudo', 'Replace with a code', 'Each name or number becomes a code such as PERSON_001. The same value always gets the same code.'],
    ['partial', 'Hide part of the value', 'Show a few letters or digits. The rest become *.'],
    ['gen', 'Replace with a group or range', 'Replace the exact value with a group: a year, an age group, a number range, first letters or the end of an address.'],
    ['shift', 'Move dates', 'Move each date by a random number of days.'],
    ['num', 'Round or change numbers', 'Round each number, or change it by a small random amount.'],
    ['fixed', 'Replace with fixed text', 'Every filled cell gets the same text. Empty cells stay empty.'],
    ['scrub', 'Hide names and numbers in notes', 'Hide names, IDs, emails and phone numbers in free text. Read the rest of the text yourself.']
  ];
  var STRAT_LABEL = {}; var STRAT_HELP = {};
  STRATEGIES.forEach(function (s) { STRAT_LABEL[s[0]] = s[1]; STRAT_HELP[s[0]] = s[2]; });
  var GEN_MODES = [
    ['year', 'Year only (for dates)'], ['ageband', 'Age group (for dates)'],
    ['band', 'Number range'], ['firstn', 'First letters (for text)'], ['region', 'Last part of an address (for example the country)'], ['urlhost', 'Website only, without the path (for web addresses)']
  ];

  function bump() {
    state.version++;
    state.dictCache = null;
    if (state.result) {
      state.result = null;
      renderExport();
    }
    schedulePreview();
    renderRiskSummary();
    renderColSummary();
    renderShiftNotice();
  }
  var previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(function () { renderPreview(); }, 120);
  }

  // ---------- tabs ----------
  function showTab(id, moveFocus) {
    $$('[role=tab]').forEach(function (t) {
      var on = t.getAttribute('aria-controls') === id;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    $$('[role=tabpanel]').forEach(function (p) { p.hidden = p.id !== id; });
    if (id === 'p-columns') refreshExamples();
    if (id === 'p-risk' && state.rows.length) renderRisk();
    if (id === 'p-export') { renderPreview(); renderExport(); }
    window.scrollTo(0, 0);
    if (moveFocus) {
      var hd = $('#' + id + ' h2');
      if (hd) { hd.tabIndex = -1; hd.focus(); }
    }
  }
  function initTabs() {
    var tabs = $$('[role=tab]');
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { showTab(t.getAttribute('aria-controls')); });
      t.addEventListener('keydown', function (e) {
        var step = e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowLeft' ? -1 : 0);
        if (!step) return;
        var j = i;
        do { j = (j + step + tabs.length) % tabs.length; } while (tabs[j].disabled && j !== i);
        if (j !== i) { e.preventDefault(); tabs[j].focus(); showTab(tabs[j].getAttribute('aria-controls')); }
      });
    });
    $$('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { showTab(b.getAttribute('data-goto'), true); });
    });
  }
  function setDataTabsEnabled(on) {
    $$('[data-needs-data]').forEach(function (b) { b.disabled = !on; });
  }

  // ---------- step 1: load ----------
  function initLoad() {
    var input = $('#file-input'), zone = $('#drop-zone');
    input.addEventListener('change', function () { if (input.files[0]) loadFile(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function () { zone.classList.remove('drag'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });
    $('#sheet-select').addEventListener('change', function (e) { pickSheet(e.target.value); });
    $('#try-sample').addEventListener('click', function () { loadFile(new File([SAMPLE_CSV], 'sample-staff-list.csv', { type: 'text/csv' })); });
    $('#no-header').addEventListener('change', function (e) {
      state.noHeader = e.target.checked; buildTable(); renderLoadInfo();
      announce(state.noHeader ? 'The columns are named Column 1, Column 2 and so on.' : 'Row ' + (state.headerRow + 1) + ' has the column names.');
    });
    $('#enc-select').addEventListener('change', function (e) {
      Bridge.call({ type: 'open', slot: 'main', name: state.file.name, buf: state.buf, encoding: e.target.value }).then(function (res) {
        state.file.encoding = res.encoding; state.file.guessed = false;
        setRaw(res.rows);
      }).catch(function (err) { setMsg($('#load-msg'), 'err', 'The tool cannot read the file with that encoding: ' + esc(err.message) + '.'); });
    });
  }

  function loadFile(file) {
    var msg = $('#load-msg');
    if (!/\.(csv|tsv|txt|xlsx|xlsm|xlsb|xls|ods)$/i.test(file.name)) {
      setMsg(msg, 'err', 'The tool cannot open <b>' + esc(file.name) + '</b>. Choose a CSV, Excel (.xlsx, .xls) or .ods file.');
      return;
    }
    setMsg(msg, 'info', 'Opening <b>' + esc(file.name) + '</b> (' + fmtBytes(file.size) + ')…');
    file.arrayBuffer().then(function (buf) {
      state.buf = buf;
      return Bridge.call({ type: 'open', slot: 'main', name: file.name, buf: buf });
    }).then(function (res) {
      state.file = { name: file.name, size: file.size, kind: res.kind, encoding: res.encoding, guessed: res.guessed, delimiter: res.delimiter };
      state.lastData = null; state.dlData = ''; state.dlKey = '';
      setMsg($('#export-msg'), '', '');
      state.sheets = res.sheets; state.sheet = res.sheet;
      state.session.random = new Map(); noiseCache.clear(); rowShiftCache.clear();
      setRaw(res.rows);
      setMsg(msg, 'ok', 'Opened <b>' + esc(file.name) + '</b>.');
    }).catch(function (err) {
      setMsg(msg, 'err', 'The tool cannot read <b>' + esc(file.name) + '</b>: ' + esc(err.message) +
        '. Check that the file is not damaged and has no password. Then try again.');
    });
  }

  function pickSheet(name) {
    Bridge.call({ type: 'sheet', slot: 'main', sheet: name }).then(function (res) {
      state.sheet = res.sheet; setRaw(res.rows);
    }).catch(function (err) { setMsg($('#load-msg'), 'err', 'The tool cannot read sheet “' + esc(name) + '”: ' + esc(err.message) + '. Choose another sheet.'); });
  }

  function autoHeader(raw) {
    var lim = Math.min(raw.length, 10), max = 0;
    for (var i = 0; i < lim; i++) {
      var n = raw[i].filter(function (x) { return String(x).trim() !== ''; }).length;
      if (n > max) max = n;
    }
    for (var j = 0; j < lim; j++) {
      var cells = raw[j].filter(function (x) { return String(x).trim() !== ''; });
      var numeric = cells.filter(function (x) { return /^-?[\d.,\/\- ]+$/.test(String(x)); }).length;
      if (cells.length >= Math.max(1, Math.ceil(max * 0.6)) && numeric <= cells.length * 0.2) return j;
    }
    return 0;
  }

  function setRaw(raw) {
    state.raw = raw;
    state.headerRow = autoHeader(raw);
    state.noHeader = (raw[state.headerRow] || []).some(function (x) { return L.looksLikeData(x); });
    state.autoNoHeader = state.noHeader;
    buildTable();
    renderLoadInfo();
  }

  function buildTable() {
    var raw = state.raw, h = state.noHeader ? -1 : state.headerRow;
    var width = 0;
    raw.forEach(function (r) { if (r.length > width) width = r.length; });
    var hdrRaw = (h >= 0 ? (raw[h] || []) : []).slice();
    while (hdrRaw.length < width) hdrRaw.push('');
    var seen = {}, dupNames = [], blankHeaders = 0, dataHeaders = 0;
    var headers = hdrRaw.map(function (x, i) {
      var s = String(x).replace(/[\r\n]+/g, ' ').trim();
      // A header cell that is really a value (an email, ID, phone or date) must never reach the output.
      var looksReal = !!s && L.looksLikeData(s);
      if (looksReal) dataHeaders++;
      if (!s || looksReal) { s = 'Column ' + (i + 1); if (!looksReal && !state.noHeader) blankHeaders++; }
      var base = s, n = 1;
      while (seen[s.toLowerCase()]) { n++; s = base + ' (' + n + ')'; }
      if (n > 1) dupNames.push(base);
      seen[s.toLowerCase()] = 1;
      return s;
    });
    var rows = [], emptyRows = 0;
    for (var r = h + 1; r < raw.length; r++) {
      var row = raw[r];
      var any = false;
      for (var c = 0; c < row.length; c++) { if (String(row[c]).trim() !== '') { any = true; break; } }
      if (!any) { emptyRows++; continue; }
      var out = row.slice();
      while (out.length < width) out.push('');
      rows.push(out);
    }
    state.headers = headers; state.rows = rows;
    var dupRows = 0, set = new Set();
    rows.forEach(function (r2) { var k = r2.join('\u0001'); if (set.has(k)) dupRows++; else set.add(k); });
    state.cols = headers.map(function (hd, i) {
      var vals = rows.map(function (r3) { return r3[i]; });
      var norm = L.normalizeColumnName(hd) || ('column_' + (i + 1));
      var cls = L.classifyColumn(hd, norm, vals);
      var sug = L.suggest(cls, hd);
      var samples = [], sampleRows = [], ss = new Set();
      for (var k2 = 0; k2 < vals.length && samples.length < 3; k2++) {
        var v = String(vals[k2]).trim();
        if (v && !ss.has(v)) { ss.add(v); samples.push(v); sampleRows.push(k2); }
      }
      return {
        idx: i, header: hd, norm: norm, kind: cls.kind, birth: cls.birth, personal: cls.personal, freeText: cls.freeText,
        serialDates: cls.serialDates, info: cls.info, status: sug.status, strategy: sug.strategy,
        params: sug.params, outNameUser: '', outName: hd, samples: samples, sampleRows: sampleRows, presetPII: false,
        review: cls.review
      };
    });
    state.sanitise.dateOrder = detectDateOrder();
    var emptyCols = state.cols.filter(function (c) { return c.kind === 'empty'; }).map(function (c) { return c.header; });
    state.validation = {
      rows: rows.length, cols: headers.length, emptyRows: emptyRows, dupRows: dupRows,
      dupNames: dupNames, blankHeaders: blankHeaders, dataHeaders: dataHeaders, emptyCols: emptyCols, missingRequired: []
    };
    state.sampleIdx = null; state.result = null; state.dictCache = null;
    state.version++; state.fileSeq = (state.fileSeq || 0) + 1;
    setDataTabsEnabled(rows.length > 0);
    renderColumns(); renderSanitise(); renderPreview(); renderExport(); renderRiskSummary();
  }

  // 03/04/2020 is ambiguous. A value such as 25/12/2004 or 12/25/2004 shows which part is the day.
  function detectDateOrder() {
    var dayFirst = 0, monthFirst = 0;
    state.cols.forEach(function (c) {
      if (c.kind !== 'date' || c.serialDates) return;
      for (var r = 0; r < state.rows.length && r < 400; r++) {
        var m = /^\s*(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}/.exec(String(state.rows[r][c.idx]));
        if (!m) continue;
        if (+m[1] > 12) dayFirst++;
        if (+m[2] > 12) monthFirst++;
      }
    });
    return monthFirst > 0 && dayFirst === 0 ? 'mdy' : 'dmy';
  }

  function renderLoadInfo() {
    var box = $('#load-info');
    if (!state.file) { box.hidden = true; return; }
    box.hidden = false;
    var f = state.file;
    var meta = [esc(f.name), fmtBytes(f.size)];
    if (f.delimiter) meta.push('separator ' + (f.delimiter === '\t' ? 'tab' : '“' + esc(f.delimiter) + '”'));
    $('#file-meta').innerHTML = meta.join(' · ');
    var sheetWrap = $('#sheet-wrap');
    sheetWrap.hidden = state.sheets.length < 2;
    $('#sheet-select').innerHTML = state.sheets.map(function (s) {
      return '<option' + (s === state.sheet ? ' selected' : '') + '>' + esc(s) + '</option>';
    }).join('');
    var encWrap = $('#enc-wrap');
    encWrap.hidden = f.kind !== 'csv';
    if (f.kind === 'csv') {
      $('#enc-select').innerHTML = ENCODINGS.map(function (e) {
        return '<option value="' + e[0] + '"' + (String(f.encoding).toLowerCase() === e[0] ? ' selected' : '') + '>' + esc(e[1]) + '</option>';
      }).join('');
      $('#enc-help').textContent = f.guessed ? 'This file is not UTF-8, so the tool guessed. If letters look wrong, choose another encoding.' : '';
      $('#enc-help').className = 'help' + (f.guessed ? ' warn-t' : '');
    }
    $('#no-header').checked = state.noHeader;
    // header-row picker
    var lim = Math.min(state.raw.length, 30), width = 0;
    for (var i = 0; i < lim; i++) width = Math.max(width, state.raw[i].length);
    width = Math.min(width, 12);
    var html = '<table class="grid raw"><thead><tr><th scope="col">Column names</th><th scope="col">Row</th>';
    for (var c = 0; c < width; c++) html += '<th scope="col">' + String.fromCharCode(65 + (c % 26)) + '</th>';
    html += '</tr></thead><tbody>';
    for (var r = 0; r < lim; r++) {
      var on = !state.noHeader && r === state.headerRow;
      html += '<tr class="' + (on ? 'hdr-on' : '') + '"><td><input type="radio" name="hdr-row" value="' + r + '"' +
        (on ? ' checked' : '') + (state.noHeader ? ' disabled' : '') + ' aria-label="Row ' + (r + 1) + ' has the column names"></td><td>' + (r + 1) + '</td>';
      for (var c2 = 0; c2 < width; c2++) html += '<td dir="auto">' + esc(trunc(state.raw[r][c2], 22)) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';
    $('#hdr-table').innerHTML = html;
    $$('input[name=hdr-row]').forEach(function (rb) {
      rb.addEventListener('change', function () {
        state.headerRow = +rb.value; buildTable(); renderLoadInfo();
        announce('Row ' + (state.headerRow + 1) + ' has the column names.');
      });
    });
    var v = state.validation, items = [];
    items.push('<li><b>' + fmtInt(v.rows) + '</b> data rows and <b>' + fmtInt(v.cols) + '</b> columns.</li>');
    if (v.emptyRows) items.push('<li>' + fmtInt(v.emptyRows) + ' empty rows were ignored.</li>');
    if (v.dupRows) items.push('<li class="warn-t">' + fmtInt(v.dupRows) + ' rows are exact copies of another row.</li>');
    if (v.dupNames.length) items.push('<li class="warn-t">Some columns had the same name. The tool added numbers: ' + esc(v.dupNames.join(', ')) + '.</li>');
    if (state.noHeader && state.autoNoHeader) items.push('<li class="warn-t">Row ' + (state.headerRow + 1) + ' looks like data, not column names. The tool named the columns “Column 1”, “Column 2” and so on. Untick the box if that row has the names.</li>');
    if (v.dataHeaders && !state.noHeader) items.push('<li class="err-t">' + v.dataHeaders + ' cells in the header row look like real values (an email, ID, phone number or date). The tool renamed them “Column N”. If your file has no header row, tick the box above.</li>');
    if (v.blankHeaders) items.push('<li class="warn-t">' + v.blankHeaders + ' columns had no name. The tool named them “Column N”.</li>');
    if (v.emptyCols.length) items.push('<li>Empty columns (the tool suggests Remove): ' + esc(v.emptyCols.join(', ')) + '.</li>');
    if (!v.rows) items.push('<li class="err-t">' + (state.raw.length <= (state.noHeader ? 0 : 1) ? 'The file has no rows of data.' : 'There are no rows below the header row. Choose another header row.') + '</li>');
    $('#validation').innerHTML = items.join('');
    $('#to-columns').disabled = !v.rows;
  }

  // ---------- output names ----------
  function computeOutNames() {
    var used = {};
    state.cols.forEach(function (c) {
      var base = c.outNameUser.trim() || (state.sanitise.normHeader ? c.norm : c.header);
      var name = base, n = 1;
      if (c.status !== 'hide') {
        while (used[name.toLowerCase()]) { n++; name = base + '_' + n; }
        used[name.toLowerCase()] = 1;
      }
      c.outName = name;
    });
  }

  // ---------- step 2: columns ----------
  function statusLabel(s) { return s === 'mask' ? 'Mask' : (s === 'hide' ? 'Remove' : 'Keep'); }

  function renderColumns() {
    var list = $('#col-list');
    computeOutNames();
    exCache = state.rows.length ? computeExamples() : {};
    list.innerHTML = state.cols.map(cardHtml).join('');
    state.cols.forEach(function (c) { bindCard(c); });
    $('#col-tools').hidden = state.cols.length <= 8;
    applyFilter();
    renderColSummary();
  }

  // Filter for wide files: by name and by what the user needs to look at.
  function needsAttention(c) {
    return c.status !== 'hide' && ((c.status === 'accept' && (c.personal || c.presetPII || c.freeText)) || (c.review && c.status === 'accept'));
  }
  function applyFilter() {
    var q = ($('#col-filter').value || '').trim().toLowerCase(), mode = $('#col-show').value, shown = 0;
    state.cols.forEach(function (c) {
      var ok = (!q || c.header.toLowerCase().indexOf(q) >= 0) &&
        (mode === 'all' || (mode === 'mask' && c.status === 'mask') || (mode === 'accept' && c.status === 'accept') ||
         (mode === 'hide' && c.status === 'hide') || (mode === 'attention' && needsAttention(c)));
      var card = $('#card-' + c.idx);
      if (card) card.hidden = !ok;
      if (ok) shown++;
    });
    $('#col-shown').textContent = shown < state.cols.length ? 'Showing ' + shown + ' of ' + state.cols.length + ' columns.' : '';
  }

  function renderColSummary() {
    var n = { mask: 0, hide: 0, accept: 0 }, risky = 0;
    state.cols.forEach(function (c) {
      n[c.status]++;
      if (c.status === 'accept' && (c.personal || c.presetPII)) risky++;
    });
    var html = fmtInt(state.cols.length) + ' columns: ' + n.mask + ' to mask, ' + n.accept + ' to keep, ' + n.hide + ' to remove';
    if (risky) html += ' · <b class="err-t">' + risky + (risky === 1 ? ' column with personal data is' : ' columns with personal data are') + ' set to Keep</b>';
    $('#col-count').innerHTML = html;
  }

  function badgeHtml(c) {
    var b = [];
    if (c.personal || c.presetPII) b.push('<span class="badge b-danger">Personal data</span>');
    if (c.freeText) b.push('<span class="badge b-warn">Free text: read it yourself</span>');
    if (c.review) b.push('<span class="badge b-warn">Check this column</span>');
    if (c.serialDates) b.push('<span class="badge">Dates stored as Excel numbers</span>');
    return b.join(' ');
  }

  function fieldHelp(id, help) { return help ? '<p class="help" id="' + id + '-h">' + help + '</p>' : ''; }
  function fieldDesc(id, help) { return help ? ' aria-describedby="' + id + '-h"' : ''; }
  function numField(c, key, label, help, min, step) {
    var id = 'f-' + c.idx + '-' + key;
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input type="number" id="' + id + '" data-p="' + key + '" value="' + esc(c.params[key]) + '" min="' + (min == null ? 0 : min) + '" step="' + (step || 1) + '"' + fieldDesc(id, help) + '>' +
      fieldHelp(id, help) + '</div>';
  }
  function textField(c, key, label, help) {
    var id = 'f-' + c.idx + '-' + key;
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input type="text" id="' + id + '" data-p="' + key + '" value="' + esc(c.params[key]) + '"' + fieldDesc(id, help) + '>' +
      fieldHelp(id, help) + '</div>';
  }
  function selField(c, key, label, help, opts) {
    var id = 'f-' + c.idx + '-' + key;
    return '<div class="field"><label for="' + id + '">' + label + '</label><select id="' + id + '" data-p="' + key + '"' + fieldDesc(id, help) + '>' +
      opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(c.params[key]) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
      '</select>' + fieldHelp(id, help) + '</div>';
  }
  function checkField(c, key, label, help) {
    var id = 'f-' + c.idx + '-' + key;
    return '<div class="field check"><input type="checkbox" id="' + id + '" data-p="' + key + '"' + (c.params[key] ? ' checked' : '') + fieldDesc(id, help) + '>' +
      '<label for="' + id + '">' + label + '</label>' + fieldHelp(id, help) + '</div>';
  }

  function firstSanitized(c) {
    for (var i = 0; i < state.rows.length && i < 500; i++) {
      var s = L.sanitizeValue(state.rows[i][c.idx], c, state.sanitise);
      if (s) return s;
    }
    return '';
  }

  function paramsHtml(c) {
    var p = c.params, h = '';
    switch (c.strategy) {
      case 'pseudo':
        h += textField(c, 'prefix', 'Start of the code', '');
        h += selField(c, 'tokenStyle', 'Type of code', '', [['seq', 'Numbers (_001, _002)'], ['random', 'Random letters (_7KQ3XZ)']]);
        break;
      case 'partial':
        h += numField(c, 'keepN', 'Characters to show', '', 0, 1);
        h += selField(c, 'side', 'Show them at', '', [['last', 'The end'], ['first', 'The start']]);
        h += checkField(c, 'keepSep', 'Keep - / . @ and spaces', '');
        if (L.partialRevealsDate(firstSanitized(c), c, parseInt(p.keepN, 10) || 0, p.side, state.sanitise.dateOrder)) {
          h += '<p class="msg err inline" role="alert">This shows the month or day, not only the year. Show fewer characters, or choose “Replace with a group or range”.</p>';
        }
        if (c.kind === 'national_id') {
          h += '<p class="msg warn inline">Digits of a national ID can still identify a person. Some IDs contain a birth date. Safer: choose Remove, or choose “Replace with a code” with random letters.</p>';
        }
        break;
      case 'gen':
        h += selField(c, 'genMode', 'Group by', '', GEN_MODES);
        if (p.genMode === 'ageband') h += numField(c, 'width', 'Years in each age group', 'Ages are worked out from today.', 1, 1);
        if (p.genMode === 'band') h += numField(c, 'width', 'Size of each range', '', 1, 'any');
        if (p.genMode === 'firstn') h += numField(c, 'firstN', 'How many letters', '', 0, 1);
        if (p.genMode === 'region') h += numField(c, 'parts', 'How many address parts to keep', 'Parts are separated by commas. Parts with digits, such as a postcode, are removed.', 1, 1);
        break;
      case 'shift':
        h += '<p class="help">' + (state.session.shiftMode === 'file' ? 'All rows move by the same number of days.' : 'Each row moves by a different number of days.') + ' Change this under “Dates and cleaning”.</p>';
        break;
      case 'num':
        h += selField(c, 'numMode', 'How to change the number', '', [['round', 'Round it'], ['noise', 'Add a small random change']]);
        if (p.numMode === 'noise') h += numField(c, 'noisePct', 'Biggest change (%)', '', 0, 'any');
        else h += numField(c, 'roundTo', 'Round to the nearest', '', 0, 'any');
        break;
      case 'fixed':
        h += textField(c, 'fixedText', 'Text to use', '');
        break;
    }
    return h;
  }

  // Before and after for the first few distinct values of each column. One pass over the rows in order,
  // with every column, so codes in order match the codes in the download.
  var exCache = {};
  function computeExamples() {
    var run = prepareRun(), res = {}, want = {}, max = -1, cap = 3000;
    state.cols.forEach(function (c) {
      if (c.status !== 'mask') return;
      c.sampleRows.forEach(function (r) { (want[r] = want[r] || []).push(c); if (r > max) max = r; });
    });
    for (var r = 0; r <= max; r++) {
      if (r >= cap && !want[r]) continue;
      var out = processRow(r, run.outCols, run.ctx);
      (want[r] || []).forEach(function (c) {
        (res[c.idx] = res[c.idx] || []).push([L.sanitizeValue(state.rows[r][c.idx], c, state.sanitise), out[run.outCols.indexOf(c)]]);
      });
    }
    return res;
  }
  function examplesHtml(c) {
    function code(t) { return t === '' ? '<i>empty</i>' : '<code dir="auto">' + esc(trunc(t, 40)) + '</code>'; }
    if (!c.samples.length) return '<p class="ex-title">No values in this column.</p>';
    var rows = c.status === 'mask' ? exCache[c.idx] : null;
    if (rows) {
      var bad = rows.filter(function (x) { return x[1] === '[?]'; }).length;
      return '<p class="ex-title">Example: before → after</p><ul class="ex-list">' + rows.map(function (x) {
        return '<li>' + code(x[0]) + '<span class="ex-arrow" aria-hidden="true">→</span><span class="sr-only"> becomes </span>' + code(x[1]) + '</li>';
      }).join('') + '</ul>' + (bad ? '<p class="msg warn inline">The tool cannot read ' + (bad === 1 ? 'this value' : 'these values') + ' with this method. ' +
        (c.kind === 'date' ? 'Check the date order under “Dates and cleaning”, or choose another method.' : 'Choose another method.') + '</p>' : '');
    }
    var title = c.status === 'hide' ? 'Examples (this column is left out)' : 'Examples (copied as they are)';
    return '<p class="ex-title">' + title + '</p><ul class="ex-list">' + c.samples.map(function (t) { return '<li>' + code(t) + '</li>'; }).join('') + '</ul>';
  }
  function refreshExamples() {
    if (!state.rows.length) return;
    computeOutNames();
    exCache = computeExamples();
    state.cols.forEach(function (c) { var el = $('#ex-' + c.idx); if (el) el.innerHTML = examplesHtml(c); });
  }
  function updateExamples() { refreshExamples(); }

  function cardHtml(c) {
    var i = c.idx, st = c.status;
    var h = '<article class="col-card st-' + st + '" id="card-' + i + '" aria-labelledby="cn-' + i + '">';
    h += '<div class="col-info"><h3 id="cn-' + i + '">' + esc(c.header) + '</h3>';
    h += '<p class="meta">Type: <b>' + esc(L.KIND_LABEL[c.kind]) + '</b></p>';
    h += '<p class="badges">' + badgeHtml(c) + '</p>';
    h += '<div class="ex" id="ex-' + i + '">' + examplesHtml(c) + '</div></div>';
    h += '<div class="col-main"><fieldset class="status"><legend>What to do</legend><div class="seg">';
    [['mask', 'Mask'], ['hide', 'Remove'], ['accept', 'Keep']].forEach(function (o) {
      var id = 's-' + i + '-' + o[0];
      h += '<input type="radio" name="st-' + i + '" id="' + id + '" value="' + o[0] + '"' + (st === o[0] ? ' checked' : '') + '><label for="' + id + '">' + o[1] + '</label>';
    });
    h += '</div></fieldset>';
    h += '<div class="strategy">';
    if (st === 'mask') {
      var sid = 'f-' + i + '-strategy';
      h += '<div class="field"><label for="' + sid + '">How to mask</label><select id="' + sid + '" data-strategy aria-describedby="' + sid + '-h" title="' + esc(STRAT_HELP[c.strategy]) + '">' +
        STRATEGIES.map(function (s) { return '<option value="' + s[0] + '"' + (c.strategy === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('') +
        '</select><span class="sr-only" id="' + sid + '-h">' + esc(STRAT_HELP[c.strategy]) + '</span></div>';
      h += '<div class="params">' + paramsHtml(c) + '</div>';
    } else if (st === 'accept') {
      if (c.personal || c.presetPII) h += '<p class="msg err inline">This column has personal data, but you chose Keep. Choose Mask or Remove.</p>';
      if (c.freeText) h += '<p class="msg warn inline">Notes can have names in them. Choose Mask with “Hide names and numbers in notes”, or choose Remove.</p>';
    }
    h += '</div></div>';
    var oid = 'on-' + i;
    h += '<div class="col-extra"><details class="more"' + (c.outNameUser ? ' open' : '') + '><summary>Change the column name</summary>';
    h += '<div class="field"><label for="' + oid + '">Name in the new file</label><input type="text" id="' + oid + '" data-outname value="' + esc(c.outNameUser) + '" placeholder="' + esc(state.sanitise.normHeader ? c.norm : c.header) + '"' + (st === 'hide' ? ' disabled' : '') + '></div>';
    h += '</details></div>';
    h += '</article>';
    return h;
  }

  // Removing a focused input with an uncommitted edit fires 'change', whose handler calls
  // rerenderCard again while the first replaceWith runs. The guard skips that nested call.
  var rerendering = {};
  function rerenderCard(c) {
    if (rerendering[c.idx]) return;
    rerendering[c.idx] = true;
    try {
      var old = $('#card-' + c.idx);
      var focusId = document.activeElement && old.contains(document.activeElement) ? document.activeElement.id : null;
      var tmp = document.createElement('div');
      computeOutNames();
      tmp.innerHTML = cardHtml(c);
      old.replaceWith(tmp.firstChild);
      bindCard(c);
      refreshExamples();
      applyFilter();
      if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus();
    } finally {
      rerendering[c.idx] = false;
    }
  }

  function bindCard(c) {
    var card = $('#card-' + c.idx);
    $$('input[name=st-' + c.idx + ']', card).forEach(function (rb) {
      rb.addEventListener('change', function () { c.status = rb.value; rerenderCard(c); bump(); });
    });
    var sel = $('[data-strategy]', card);
    if (sel) sel.addEventListener('change', function () {
      c.strategy = sel.value;
      if (c.strategy === 'gen') {
        if (c.kind === 'date') c.params.genMode = c.birth ? 'ageband' : 'year';
        else if (c.kind === 'money' || c.kind === 'number') { c.params.genMode = 'band'; if (!c.params.width || c.params.width < 10) c.params.width = 1000; }
        else if (c.kind === 'address') c.params.genMode = 'region';
        else if (c.kind === 'url') c.params.genMode = 'urlhost';
        else c.params.genMode = 'firstn';
      }
      if (c.strategy === 'pseudo' && (c.params.prefix === 'CODE' || c.params.prefix === 'TOKEN') && L.DEFAULT_PREFIX[c.kind]) c.params.prefix = L.DEFAULT_PREFIX[c.kind];
      rerenderCard(c); bump();
    });
    $$('[data-p]', card).forEach(function (inp) {
      var key = inp.getAttribute('data-p');
      var ev = inp.tagName === 'SELECT' || inp.type === 'checkbox' ? 'change' : 'input';
      inp.addEventListener(ev, function () {
        c.params[key] = inp.type === 'checkbox' ? inp.checked : inp.value;
        if (key === 'genMode' && inp.value === 'ageband' && (+c.params.width < 1 || +c.params.width > 50)) c.params.width = 5;
        if (key === 'genMode' && inp.value === 'band' && +c.params.width < 10) c.params.width = 1000;
        if (inp.tagName === 'SELECT' || inp.type === 'checkbox' || key === 'keepN') rerenderCard(c);
        else updateExamples();
        bump();
      });
      if (key === 'prefix') inp.addEventListener('change', function () { c.params.prefix = L.cleanPrefix(inp.value); rerenderCard(c); bump(); });
    });
    var on = $('[data-outname]', card);
    on.addEventListener('input', function () { c.outNameUser = on.value; bump(); });
  }

  function resetSuggestions() {
    state.cols.forEach(function (c) {
      var sug = L.suggest({ kind: c.kind, birth: c.birth }, c.header);
      c.status = sug.status; c.strategy = sug.strategy; c.params = sug.params; c.outNameUser = '';
    });
    renderColumns(); bump();
    announce('Every column is back to the suggested choice.');
  }

  // ---------- presets ----------
  function savePreset() {
    if (!state.cols.length) return;
    var domain = $('#preset-domain').value.trim() || 'my-settings';
    var columns = {}, fieldMap = {}, pii = [];
    state.cols.forEach(function (c) {
      columns[c.norm] = { status: c.status, strategy: c.strategy, params: c.params };
      if (c.outNameUser.trim()) fieldMap[c.norm] = c.outNameUser.trim();
      if (c.personal || c.presetPII) pii.push(c.norm);
    });
    var preset = {
      format: 'data-masker-preset', version: '1.0', domain: domain,
      description: $('#preset-desc').value.trim(), created: new Date().toISOString(),
      sanitise: state.sanitise, shift_mode: state.session.shiftMode, rows: { mode: state.rowsMode, n: state.rowsN },
      field_map: fieldMap, columns: columns, pii_fields: pii,
      required_fields: state.cols.map(function (c) { return c.norm; })
    };
    var name = 'saved-settings-' + (L.normalizeColumnName(domain) || 'my-settings') + '.json';
    download(name, JSON.stringify(preset, null, 2), 'application/json');
    setMsg($('#preset-msg'), 'ok', 'Saved <b>' + esc(name) + '</b>. It has no data from your file.');
  }

  function loadPreset(file) {
    var msg = $('#preset-msg');
    file.text().then(function (text) {
      var p;
      try { p = JSON.parse(text); } catch (e) { throw new Error('the file is not a valid settings file'); }
      if (!p || p.format !== 'data-masker-preset' || typeof p.columns !== 'object') throw new Error('this is not a settings file from this tool');
      if (!state.cols.length) throw new Error('open a data file first');
      var matched = 0, unmatched = [];
      var validStatus = { mask: 1, hide: 1, accept: 1 };
      state.cols.forEach(function (c) {
        var cfg = p.columns[c.norm];
        if (!cfg) { unmatched.push(c.header); return; }
        matched++;
        if (validStatus[cfg.status]) c.status = cfg.status;
        if (STRAT_LABEL[cfg.strategy]) c.strategy = cfg.strategy;
        var dp = L.defaultParams();
        Object.keys(dp).forEach(function (k) { if (cfg.params && cfg.params[k] !== undefined) dp[k] = cfg.params[k]; });
        dp.prefix = L.cleanPrefix(dp.prefix);
        c.params = dp;
        c.outNameUser = p.field_map && typeof p.field_map[c.norm] === 'string' ? p.field_map[c.norm] : '';
        c.presetPII = Array.isArray(p.pii_fields) && p.pii_fields.indexOf(c.norm) >= 0;
      });
      var norms = state.cols.map(function (c) { return c.norm; });
      var missing = (p.required_fields || []).filter(function (f) { return norms.indexOf(f) < 0; });
      state.validation.missingRequired = missing;
      if (p.sanitise) Object.keys(state.sanitise).forEach(function (k) { if (p.sanitise[k] !== undefined) state.sanitise[k] = p.sanitise[k]; });
      if (p.rows && /^(all|first|random)$/.test(p.rows.mode)) { state.rowsMode = p.rows.mode; state.rowsN = Math.max(1, parseInt(p.rows.n, 10) || 50); state.sampleIdx = null; }
      if (p.shift_mode === 'row' || p.shift_mode === 'file') state.session.shiftMode = p.shift_mode;
      $('#preset-domain').value = p.domain || ''; $('#preset-desc').value = p.description || '';
      renderColumns(); renderSanitise(); bump();
      var html = 'Loaded <b>' + esc(p.domain || file.name) + '</b>. It matched ' + matched + ' columns.';
      if (unmatched.length) html += '<br>These columns are not in the settings file. The tool used its suggestion: ' + esc(unmatched.join(', ')) + '.';
      if (missing.length) html += '<br><b>These columns are in the settings file but not in this file:</b> ' + esc(missing.join(', ')) + '. Check that you chose the right file.';
      setMsg(msg, missing.length ? 'warn' : 'ok', html);
    }).catch(function (err) {
      setMsg(msg, 'err', 'The tool cannot use <b>' + esc(file.name) + '</b>: ' + esc(err.message) + '. Choose a .json file that this tool saved.');
    });
  }

  // ---------- step 3: sanitise ----------
  function renderSanitise() {
    var s = state.sanitise;
    $('#san-date').value = s.dateFmt;
    $('#san-order').value = s.dateOrder;
    ['trim', 'normHeader', 'ctrl', 'empty'].forEach(function (k) { $('#san-' + k).checked = !!s[k]; });
    $$('input[name=shift-mode]').forEach(function (rb) { rb.checked = rb.value === state.session.shiftMode; });
    $('#tidy-summary').textContent = '(dates are read ' + (s.dateOrder === 'mdy' ? 'month first' : 'day first') + ')';
    $('#shift-file-warn').hidden = state.session.shiftMode !== 'file';
    renderShiftNotice();
  }
  function renderShiftNotice() {
    var used = state.cols.some(function (c) { return c.status === 'mask' && c.strategy === 'shift'; });
    $('#shift-unused').hidden = used || !state.cols.length;
  }
  function initSanitise() {
    $('#san-date').addEventListener('change', function (e) { state.sanitise.dateFmt = e.target.value; renderColumns(); bump(); });
    $('#san-order').addEventListener('change', function (e) { state.sanitise.dateOrder = e.target.value; renderSanitise(); renderColumns(); bump(); });
    ['trim', 'normHeader', 'ctrl', 'empty'].forEach(function (k) {
      $('#san-' + k).addEventListener('change', function (e) {
        state.sanitise[k] = e.target.checked;
        if (k === 'normHeader') renderColumns();
        bump();
      });
    });
    $$('input[name=shift-mode]').forEach(function (rb) {
      rb.addEventListener('change', function () {
        state.session.shiftMode = rb.value; renderSanitise(); renderColumns(); bump();
      });
    });
    $('#new-shift').addEventListener('click', function () {
      state.session.shiftDays = L.randomShiftDays(); rowShiftCache.clear();
      bump();
      announce('The tool chose new random shifts. An older match file cannot move the dates back.');
      $('#shift-info').textContent = 'The tool chose new random shifts. Download the masked data and the match file again.';
    });
  }

  // ---------- pipeline ----------
  function outputIndices() {
    var n = state.rows.length;
    if (state.rowsMode === 'first') {
      var m = Math.min(n, state.rowsN), a = new Array(m);
      for (var i = 0; i < m; i++) a[i] = i;
      return a;
    }
    if (state.rowsMode === 'random') {
      var key = n + ':' + state.rowsN;
      if (!state.sampleIdx || state.sampleKey !== key) { state.sampleIdx = L.randomSample(n, state.rowsN); state.sampleKey = key; }
      return state.sampleIdx;
    }
    var all = new Array(n);
    for (var j = 0; j < n; j++) all[j] = j;
    return all;
  }

  var DICT_KINDS = { name: 1, national_id: 1, id: 1, email: 1 };
  function getDict() {
    if (state.dictCache) return state.dictCache;
    var useScrub = state.cols.some(function (c) { return c.status === 'mask' && c.strategy === 'scrub'; });
    if (!useScrub) { state.dictCache = new Map(); return state.dictCache; }
    var entries = [], seen = new Set();
    state.cols.forEach(function (c) {
      if (!DICT_KINDS[c.kind]) return;
      var pseudo = c.status === 'mask' && c.strategy === 'pseudo';
      var prefix = pseudo ? L.cleanPrefix(c.params.prefix) : L.DEFAULT_PREFIX[c.kind];
      var style = pseudo ? c.params.tokenStyle : 'seq';
      var given = new Map();
      state.rows.forEach(function (r) {
        var v = L.sanitizeValue(r[c.idx], c, state.sanitise).replace(/\s+/g, ' ').trim();
        if (v.length < 4 || seen.has(prefix + '\u0001' + v)) return;
        seen.add(prefix + '\u0001' + v);
        entries.push({ text: v, prefix: prefix, style: style, colName: c.outName });
        if (c.kind === 'name') L.nameParts(v).forEach(function (g) { given.set(g.toLowerCase(), g); });
      });
      given.forEach(function (g) { entries.push({ text: g, partial: true }); });
    });
    state.dictCache = L.buildDict(entries);
    return state.dictCache;
  }

  // Numbers for "Numbered" codes are dealt out in random order, once per set of settings,
  // so the preview, the examples and the download agree and a number never shows a row position.
  var codeOrderCache = { sig: '', order: null };
  function getCodeOrder() {
    var cols = state.cols.filter(function (c) { return c.status === 'mask' && c.strategy === 'pseudo' && c.params.tokenStyle !== 'random'; });
    var sig = cols.map(function (c) { return c.idx + ':' + L.cleanPrefix(c.params.prefix); }).join('|') + '#' + JSON.stringify(state.sanitise) + '#' + state.fileSeq;
    if (codeOrderCache.sig === sig) return codeOrderCache.order;
    var groups = new Map();
    cols.forEach(function (c) {
      var pf = L.cleanPrefix(c.params.prefix), list = groups.get(pf) || [];
      state.rows.forEach(function (r) {
        var v = L.sanitizeValue(r[c.idx], c, state.sanitise).replace(/\s+/g, ' ').trim();
        if (v) list.push(v);
      });
      groups.set(pf, list);
    });
    codeOrderCache = { sig: sig, order: L.buildCodeOrder(groups) };
    return codeOrderCache.order;
  }

  function prepareRun() {
    computeOutNames();
    state.session.dateFmt = state.sanitise.dateFmt; state.session.dateOrder = state.sanitise.dateOrder;
    var ctx = L.newContext(state.session);
    ctx.order = getCodeOrder();
    ctx.dict = getDict();
    var outCols = state.cols.filter(function (c) { return c.status !== 'hide'; });
    return { ctx: ctx, outCols: outCols };
  }
  function processRow(r, outCols, ctx) {
    var raw = state.rows[r], s = state.sanitise, out = new Array(outCols.length);
    for (var i = 0; i < outCols.length; i++) {
      var c = outCols[i];
      var v = L.sanitizeValue(raw[c.idx], c, s);
      out[i] = c.status === 'mask' ? L.maskValue(v, c, ctx, r) : v;
    }
    return out;
  }

  function isNumericOut(c) {
    if (c.status === 'accept') return c.kind === 'number' || c.kind === 'money';
    return c.status === 'mask' && c.strategy === 'num';
  }

  async function processRows(idx, run, version, onProgress) {
    var rows = new Array(idx.length);
    for (var i = 0; i < idx.length; i++) {
      rows[i] = processRow(idx[i], run.outCols, run.ctx);
      if (i % CHUNK === CHUNK - 1) {
        onProgress(i + 1, idx.length);
        await tick();
        if (state.version !== version) return null;
      }
    }
    return rows;
  }

  function makeResult(version, idx, run, rows) {
    var header = run.outCols.map(function (c) { return c.outName; });
    var shiftCols = run.outCols.filter(function (c) { return c.status === 'mask' && c.strategy === 'shift'; }).map(function (c) { return c.outName; });
    var rowShifts = null, anchor = '';
    if (shiftCols.length && state.session.shiftMode === 'row') {
      // Anchor each row's offset to a code that is unique per row, so restore still works
      // when AI output reorders rows. Fall back to the row number.
      var codeCols = [];
      run.outCols.forEach(function (c, j) { if (c.status === 'mask' && c.strategy === 'pseudo') codeCols.push(j); });
      var ai = L.pickAnchor(rows, codeCols);
      anchor = ai >= 0 ? header[ai] : '';
      rowShifts = idx.map(function (r, n) { return [state.session.rowShift(r), ai >= 0 ? rows[n][ai] : 'ROW:' + (n + 1)]; });
    }
    var fmt = state.sanitise.dateFmt;
    return {
      version: version, header: header, rows: rows, keyRows: run.ctx.keyRows, stats: run.ctx.stats,
      numeric: run.outCols.map(isNumericOut), shiftCols: shiftCols, shiftDays: state.session.shiftDays,
      shiftMode: state.session.shiftMode, rowShifts: rowShifts, anchor: anchor, dateOrder: fmt === 'dmy' || fmt === 'mdy' ? fmt : state.sanitise.dateOrder,
      at: new Date(), runId: L.randomCode(4)
    };
  }

  var generating = null;
  function generate() {
    if (generating) return generating;
    var prog = $('#gen-progress'), lab = $('#gen-progress-label');
    prog.hidden = false; lab.hidden = false; prog.value = 0;
    var version = state.version;
    var inner = (async function () {
      var idx = outputIndices();
      var run = prepareRun();
      var rows = await processRows(idx, run, version, function (done, total) {
        prog.value = done / total;
        lab.textContent = 'Working on row ' + fmtInt(done) + ' of ' + fmtInt(total) + '…';
      });
      if (!rows) return null;
      state.result = makeResult(version, idx, run, rows);
      return state.result;
    })();
    generating = inner.then(function (res) {
      generating = null; prog.hidden = true; lab.hidden = true;
      if (!res) return generate();
      renderExport(); renderRiskSummary();
      if (!$('#p-risk').hidden) renderRisk();
      announce('The masked data is ready: ' + fmtInt(res.rows.length) + ' rows.');
      return res;
    }, function (err) {
      generating = null; prog.hidden = true; lab.hidden = true;
      setMsg($('#export-msg'), 'err', 'The tool cannot make the masked data: ' + esc(err.message) + '. Check your column choices and try again.');
      throw err;
    });
    return generating;
  }
  function freshResult() {
    if (state.result && state.result.version === state.version) return Promise.resolve(state.result);
    return generate();
  }

  // ---------- step 4: preview and export ----------
  function renderPreview() {
    var box = $('#preview');
    if (!state.rows.length) { box.innerHTML = '<p class="help">Open a file first.</p>'; $('#preview-note').textContent = ''; return; }
    var idx = outputIndices().slice(0, PREVIEW_ROWS);
    var run = prepareRun();
    var showOrig = $('#prev-orig').checked;
    var html = '<table class="grid preview"><caption class="sr-only">Preview of the masked rows</caption><thead><tr><th scope="col" title="Row number in your file">Row</th>';
    state.cols.forEach(function (c) {
      if (c.status === 'hide') html += '<th scope="col" class="hidden-col"><s>' + esc(c.header) + '</s><span class="tag">left out</span></th>';
      else html += '<th scope="col">' + esc(c.outName) + (c.outName !== c.header ? '<span class="tag">was: ' + esc(c.header) + '</span>' : '') + '<span class="tag st-' + c.status + '">' + statusLabel(c.status) + '</span></th>';
    });
    html += '</tr></thead><tbody>';
    idx.forEach(function (r) {
      var out = processRow(r, run.outCols, run.ctx);
      var map = {};
      run.outCols.forEach(function (c, j) { map[c.idx] = out[j]; });
      html += '<tr><th scope="row">' + (r + 1) + '</th>';
      state.cols.forEach(function (c) {
        var orig = state.rows[r][c.idx];
        if (c.status === 'hide') { html += '<td class="hidden-col" title="Left out">—</td>'; return; }
        var after = map[c.idx];
        if (after !== String(orig)) {
          html += '<td dir="auto" class="changed"><span class="after">' + esc(trunc(after, 60)) + '</span>' +
            (showOrig ? '<span class="before"><span class="sr-only">Original: </span>' + esc(trunc(orig, 60)) + '</span>' : '') + '</td>';
        } else html += '<td dir="auto">' + esc(trunc(after, 60)) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    box.innerHTML = html;
    $('#preview-note').textContent = 'Showing ' + idx.length + ' of the ' + fmtInt(outputIndices().length) + ' rows you will download.' +
      (state.rowsMode === 'random' ? ' The tool picked them at random. The number is the row in your file.' : ' The number is the row in your file.');
  }

  function rowsSummary() {
    var n = state.rows.length, k = Math.min(state.rowsN, n);
    if (state.rowsMode === 'first') return 'You will download the first ' + fmtInt(k) + (k === 1 ? ' row' : ' rows') + ' of ' + fmtInt(n) + '.';
    if (state.rowsMode === 'random') return 'You will download ' + fmtInt(k) + ' random ' + (k === 1 ? 'row' : 'rows') + ' out of ' + fmtInt(n) + '.';
    return 'You will download all ' + fmtInt(n) + ' rows.';
  }
  function renderRowsControls() {
    var n = state.rows.length, all = state.rowsMode === 'all';
    $$('input[name=rows-mode]').forEach(function (rb) { rb.checked = rb.value === state.rowsMode; });
    $('#rows-total').textContent = n ? '(' + fmtInt(n) + ')' : '';
    $('#rows-n').value = Math.min(state.rowsN, n || state.rowsN);
    $('#rows-n').max = n || '';
    $('#rows-n-h').textContent = n ? 'Choose a number from 1 to ' + fmtInt(n) + '.' : '';
    $('#rows-n').closest('.field').hidden = all;
    $('#resample').closest('.field').hidden = state.rowsMode !== 'random';
    $('#rows-extra').hidden = all;
    $('#rows-summary').textContent = n ? rowsSummary() : '';
  }
  function initExport() {
    $$('input[name=rows-mode]').forEach(function (rb) {
      rb.addEventListener('change', function () {
        state.rowsMode = rb.value; renderRowsControls(); bump(); renderPreview(); announce(rowsSummary());
      });
    });
    $('#rows-n').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      if (!(v > 0)) return;
      state.rowsN = Math.min(v, state.rows.length);
      renderRowsControls(); bump(); renderPreview();
    });
    $('#rows-n').addEventListener('change', renderRowsControls);
    $('#resample').addEventListener('click', function () { state.sampleIdx = null; state.sampleKey = ''; bump(); renderPreview(); announce('The tool picked different random rows.'); });
    $('#prev-orig').addEventListener('change', renderPreview);
    $('#dl-csv').addEventListener('click', function () {
      freshResult().then(function (res) {
        noteData(res);
        download('masked-data-' + res.runId + '-' + stamp() + '.csv', '﻿' + toCSV([res.header].concat(res.rows), true), 'text/csv;charset=utf-8');
      });
    });
    $('#dl-xlsx').addEventListener('click', function () {
      var dataRes;
      freshResult().then(function (res) {
        dataRes = res;
        var aoa = [res.header.slice()].concat(res.rows.map(function (r) { return r.map(function (v) { return L.formulaSafe(v); }); }));
        return Bridge.call({ type: 'writeXlsx', aoa: aoa, numericCols: res.numeric, sheetName: 'Masked data' });
      }).then(function (out) {
        noteData(dataRes);
        download('masked-data-' + dataRes.runId + '-' + stamp() + '.xlsx', new Blob([out.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      }).catch(function (err) { setMsg($('#export-msg'), 'err', 'The tool cannot write the Excel file: ' + esc(err.message) + '. Download the CSV instead.'); });
    });
    $('#copy-data').addEventListener('click', function () {
      freshResult().then(function (res) {
        noteData(res);
        copyText(toCSV([res.header].concat(res.rows), true), 'Copied the masked data (' + fmtInt(res.rows.length) + ' rows) as CSV text.');
      });
    });
    $('#copy-schema').addEventListener('click', function () { copyText(schemaText(), 'Copied the column names.'); });
    $('#dl-schema').addEventListener('click', function () { download('column-names-' + stamp() + '.txt', '﻿' + schemaText(), 'text/plain;charset=utf-8'); });
    // The match file always belongs to the masked data the user last downloaded. Sequential codes depend
    // on every setting, so a match file made from other settings would point codes at the wrong people.
    var pendingKey = null;
    $('#dl-key').addEventListener('click', function () {
      (state.lastData ? Promise.resolve(state.lastData) : freshResult()).then(function (res) {
        if (!res.keyRows.length && !res.shiftCols.length) {
          setMsg($('#export-msg'), 'info', 'This download has no codes and no moved dates, so it needs no match file.');
          return;
        }
        pendingKey = res;
        $('#key-ack').checked = false; $('#key-confirm').disabled = true;
        $('#key-dialog').showModal();
      });
    });
    $('#key-ack').addEventListener('change', function (e) { $('#key-confirm').disabled = !e.target.checked; });
    $('#key-cancel').addEventListener('click', function () { $('#key-dialog').close(); });
    $('#key-confirm').addEventListener('click', function () {
      $('#key-dialog').close();
      var res = pendingKey;
      if (!res) return;
      state.lastData = res; state.dlKey = res.runId;
      download('MATCH-FILE-' + res.runId + '-' + stamp() + '-KEEP-ON-THIS-PC.csv', '﻿' + toCSV(keyAoa(res)), 'text/csv;charset=utf-8');
      if (!state.dlData) state.dlData = '';
      if (res.version !== state.version) setMsg($('#export-msg'), 'warn', 'You changed settings after the last masked download. This match file fits that download (run ' + esc(res.runId) + '). To use the new settings, download the masked data again. Then download the match file again.');
      else checkRunMismatch();
      renderExport();
    });
    window.addEventListener('beforeunload', function (e) {
      var r = state.lastData;
      if (r && state.dlData && !state.dlKey && (r.keyRows.length || r.shiftCols.length)) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function noteData(res) {
    state.lastData = res; state.dlData = res.runId;
    checkRunMismatch();
  }
  function checkRunMismatch() {
    if (state.dlData && state.dlKey && state.dlData !== state.dlKey) {
      setMsg($('#export-msg'), 'warn', 'The match file (run ' + esc(state.dlKey) + ') does not fit the masked data you just downloaded (run ' + esc(state.dlData) + '). The settings changed in between. Download the match file again.');
    } else if (state.dlData && state.dlData === state.dlKey) {
      setMsg($('#export-msg'), '', '');
    }
  }

  // Match-file format. Restore reads these header cells and '#' field names.
  function keyAoa(res) {
    var aoa = [['code', 'original_value', 'column'],
      ['#warning', 'MATCH FILE. Keep it on this computer only. Never upload it to an AI tool, email, Google Drive or OneDrive.', ''],
      ['#source_file', state.file ? state.file.name + (state.sheets.length > 1 ? ' [' + state.sheet + ']' : '') : '', ''],
      ['#generated', res.at.toISOString(), ''],
      ['#run_id', res.runId, '']];
    if (res.shiftCols.length) {
      aoa.push(['#shift_mode', res.shiftMode === 'file' ? 'file' : 'row', '']);
      aoa.push(['#shifted_date_columns', res.shiftCols.join(' | '), '']);
      aoa.push(['#date_order', res.dateOrder, '']);
      if (res.shiftMode === 'file') aoa.push(['#shift_days', String(res.shiftDays), '']);
      else aoa.push(['#anchor_column', res.anchor, '']);
    }
    aoa = aoa.concat(res.keyRows);
    if (res.rowShifts) res.rowShifts.forEach(function (rs) { aoa.push(['#shift', String(rs[0]), rs[1]]); });
    return aoa;
  }

  function treatment(c) {
    if (c.status === 'accept') return 'Keep (original values)';
    var p = c.params;
    switch (c.strategy) {
      case 'pseudo': return 'Replace with code (' + L.cleanPrefix(p.prefix) + '_…)';
      case 'partial': return 'Hide part (keep ' + (parseInt(p.keepN, 10) || 0) + ' characters at the ' + (p.side === 'first' ? 'start' : 'end') + ')';
      case 'gen': return 'Change to a range or group (' + ({ year: 'year', ageband: p.width + '-year age group', band: 'range of ' + p.width, firstn: 'first ' + p.firstN + ' characters', urlhost: 'website only', region: 'last ' + (parseInt(p.parts, 10) || 1) + ' address part(s)' })[p.genMode] + ')';
      case 'shift': return state.session.shiftMode === 'file' ? 'Shift dates (one shift for the file)' : 'Shift dates (a different shift for each row)';
      case 'num': return p.numMode === 'noise' ? 'Round or adjust numbers (random change ±' + p.noisePct + '%)' : 'Round or adjust numbers (round to ' + p.roundTo + ')';
      case 'fixed': return 'Replace with fixed text';
      case 'scrub': return 'Mask names in notes';
    }
    return '';
  }
  function schemaText() {
    var idx = outputIndices();
    var run = prepareRun();
    var examples = run.outCols.map(function () { return ''; });
    var need = run.outCols.length;
    for (var i = 0; i < idx.length && i < 300 && need > 0; i++) {
      var out = processRow(idx[i], run.outCols, run.ctx);
      out.forEach(function (v, j) { if (!examples[j] && v) { examples[j] = v; need--; } });
    }
    // Only masked columns show an example. A kept column would show a real value.
    run.outCols.forEach(function (c, j) { if (c.status === 'accept') examples[j] = '(' + L.KIND_LABEL[c.kind].toLowerCase() + ', original values)'; });
    var lines = [];
    lines.push('Column names, data types and one masked example. No data rows.');
    lines.push('Rows in the file: ' + idx.length + '. Columns: ' + run.outCols.length + '.');
    lines.push('');
    lines.push('| Column | Data type | Masking method | Masked example |');
    lines.push('|---|---|---|---|');
    run.outCols.forEach(function (c, j) {
      var cell = function (s) { return String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' '); };
      lines.push('| ' + cell(c.outName) + ' | ' + cell(L.KIND_LABEL[c.kind]) + ' | ' + cell(treatment(c)) + ' | ' + cell(trunc(examples[j] || '(empty)', 60)) + ' |');
    });
    return lines.join('\r\n') + '\r\n';
  }

  function renderExport() {
    renderRowsControls();
    var res = state.result, fresh = res && res.version === state.version;
    var box = $('#export-status');
    if (!state.rows.length) { box.innerHTML = '<p class="help">Open a file first.</p>'; return; }
    if (!fresh) {
      box.innerHTML = '';
    } else {
      var items = ['<li><b>' + fmtInt(res.rows.length) + '</b> rows and <b>' + res.header.length + '</b> columns are ready.</li>',
        '<li><b>' + fmtInt(res.keyRows.length) + '</b> codes are in the match file.</li>'];
      items.push('<li>Run ID <b>' + esc(res.runId) + '</b>. Both the masked file and the match file show it in their names.</li>');
      if (res.shiftCols.length) items.push('<li>Dates moved in: ' + esc(res.shiftCols.join(', ')) + '.</li>');
      if (res.shiftCols.length && res.shiftMode === 'row' && !res.anchor) items.push('<li class="warn-t">No masked column has a different code in every row. To restore the dates later, keep the rows in the same order.</li>');
      if (res.stats.scrubHits) items.push('<li>' + fmtInt(res.stats.scrubHits) + ' names, numbers or emails in notes were hidden.</li>');
      Object.keys(res.stats.unparsed).forEach(function (k) {
        items.push('<li class="warn-t">Column <b>' + esc(k) + '</b>: the tool cannot read ' + fmtInt(res.stats.unparsed[k]) + ' values. It wrote [?] for them. Check the format of those values.</li>');
      });
      box.innerHTML = '<ul class="facts">' + items.join('') + '</ul>';
    }
  }

  // ---------- risk ----------
  function riskData() {
    var personalAccepted = [], freeText = [], partialDates = [], weakPartial = [], review = [];
    state.cols.forEach(function (c) {
      if (c.status === 'hide') return;
      if (((c.personal || c.presetPII) || c.freeText) && c.status === 'accept') personalAccepted.push(c);
      if (c.freeText) freeText.push(c);
      if (c.review && c.status === 'accept') review.push(c);
      if (c.status === 'mask' && c.strategy === 'partial') {
        if (L.partialRevealsDate(firstSanitized(c), c, parseInt(c.params.keepN, 10) || 0, c.params.side, state.sanitise.dateOrder)) partialDates.push(c);
      }
      if (c.status === 'mask' && c.strategy === 'gen' && c.params.genMode === 'firstn' && c.kind === 'name' && (parseInt(c.params.firstN, 10) || 0) > 2) weakPartial.push(c);
    });
    return { personalAccepted: personalAccepted, freeText: freeText, partialDates: partialDates, weakPartial: weakPartial, review: review };
  }
  function renderRiskSummary() {
    var el = $('#risk-summary');
    if (!state.rows.length) { el.innerHTML = ''; return; }
    var d = riskData(), red = d.personalAccepted.length + d.partialDates.length + d.weakPartial.length, amber = d.freeText.length + d.review.length;
    var parts = [];
    if (red) parts.push('<b class="err-t">' + red + (red === 1 ? ' red item' : ' red items') + '</b>');
    if (amber) parts.push('<b class="warn-t">' + amber + (amber === 1 ? ' yellow item' : ' yellow items') + ' to read yourself</b>');
    el.innerHTML = '<p class="msg ' + (red ? 'err' : (amber ? 'warn' : 'ok')) + '">Risk check: ' + (parts.length ? parts.join(' and ') : 'no problems found so far') +
      '. <button type="button" class="link" data-goto="p-risk">Open Risk check</button></p>';
    $('[data-goto]', el).addEventListener('click', function () { showTab('p-risk', true); });
    var tab = $('#tab-risk');
    tab.querySelector('.count').textContent = red ? String(red) : '';
    tab.querySelector('.count').hidden = !red;
  }

  function colList(list) { return list.map(function (c) { return '<b>' + esc(c.header) + '</b>'; }).join(', '); }
  function riskWarningsHtml(d) {
    var shiftUsed = state.cols.some(function (c) { return c.status === 'mask' && c.strategy === 'shift'; });
    var h = '<section class="card"><h3>Personal data still in the file</h3>';
    h += d.personalAccepted.length ? '<p class="msg err">These columns can have personal data, but you chose Keep: ' + colList(d.personalAccepted) + '. Go back and choose Mask or Remove.</p>'
      : '<p class="msg ok">Good. No column with personal data is set to Keep.</p>';
    if (d.partialDates.length) h += '<p class="msg err">The column ' + colList(d.partialDates) + ' still shows the month or day. Show only the year, or choose “Replace with a group or range”.</p>';
    if (d.weakPartial.length) h += '<p class="msg err">The first letters of the names in ' + colList(d.weakPartial) + ' can identify a person. Show 2 letters or fewer.</p>';
    if (shiftUsed && state.session.shiftMode === 'file') h += '<p class="msg warn">All dates move by the same number of days. Someone who knows one real date can work out the others. Choose “Each row moves by a different number of days”, unless the order of dates must stay the same.</p>';
    return h + '</section>';
  }
  function riskReadHtml(d) {
    var h = '<section class="card"><h3>Text to read yourself</h3>';
    h += d.freeText.length ? '<p class="msg warn">Read these columns before you share the file: ' + colList(d.freeText) + '. Free text often has names, phone numbers or private details. The tool misses nicknames and other spellings.</p>'
      : '<p class="msg ok">No free-text columns found.</p>';
    if (d.review.length) h += '<p class="msg warn">The tool cannot tell what is in these columns, or most of their values are different: ' + colList(d.review) + '. You chose Keep. Read them yourself. Names, IDs and other private values can hide there.</p>';
    return h + '</section>';
  }
  function renderRisk() {
    var box = $('#risk-body');
    if (!state.rows.length) { box.innerHTML = '<p class="help">Open a file first.</p>'; return; }
    var d = riskData(), v = state.validation;
    var h = riskWarningsHtml(d) + riskReadHtml(d);
    if (v.missingRequired.length) h += '<section class="card"><h3>Settings file</h3><p class="msg warn">These columns are in the settings file but not in this file: ' + esc(v.missingRequired.join(', ')) + '. Check that you chose the right file.</p></section>';
    h += '<section class="card"><h3>Your organisation\'s rules</h3><p class="msg warn">Masking does not change how your organisation classifies the file. Follow its rules before you share it.</p></section>';
    box.innerHTML = h;
  }

  // ---------- restore ----------
  var restore = { key: null, keyName: '', table: null, tableName: '', out: null };
  function initRestore() {
    $('#key-input').addEventListener('change', function (e) {
      var f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      var msg = $('#key-msg');
      f.arrayBuffer().then(function (buf) {
        return Bridge.call({ type: 'open', slot: 'key', name: f.name, buf: buf });
      }).then(function (res) {
        var k = L.parseKeyRows(res.rows);
        if (!k.key.size) throw new Error('the file has no codes');
        restore.key = k; restore.keyName = f.name;
        var info = 'Opened match file <b>' + esc(f.name) + '</b>. It has ' + fmtInt(k.key.size) + ' codes.';
        if (k.meta.shifted_date_columns) info += ' It can also move dates back in: ' + esc(k.meta.shifted_date_columns) + '.';
        setMsg(msg, 'ok', info);
        updateRestoreBtn();
      }).catch(function (err) {
        restore.key = null;
        setMsg(msg, 'err', 'The tool cannot read <b>' + esc(f.name) + '</b>: ' + esc(err.message) + '. Choose the MATCH-FILE file you downloaded in step 3.');
        updateRestoreBtn();
      });
    });
    $$('input[name=restore-src]').forEach(function (rb) {
      rb.addEventListener('change', function () {
        var isText = $('input[name=restore-src][value=text]').checked;
        $('#src-text').hidden = !isText; $('#src-file').hidden = isText;
        updateRestoreBtn();
      });
    });
    $('#restore-text').addEventListener('input', updateRestoreBtn);
    $('#restore-file').addEventListener('change', function (e) {
      var f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      var msg = $('#restore-file-msg');
      f.arrayBuffer().then(function (buf) {
        return Bridge.call({ type: 'open', slot: 'restore', name: f.name, buf: buf });
      }).then(function (res) {
        restore.table = res.rows; restore.tableName = f.name;
        setMsg(msg, 'ok', 'Opened <b>' + esc(f.name) + '</b>. It has ' + fmtInt(Math.max(0, res.rows.length - 1)) + ' rows' + (res.sheets.length > 1 ? ' on the first sheet, “' + esc(res.sheet) + '”' : '') + '.');
        updateRestoreBtn();
      }).catch(function (err) {
        restore.table = null;
        setMsg(msg, 'err', 'The tool cannot read <b>' + esc(f.name) + '</b>: ' + esc(err.message) + '. Check that the file is not damaged and has no password. Then try again.');
        updateRestoreBtn();
      });
    });
    $('#restore-btn').addEventListener('click', doRestore);
    $('#restore-copy').addEventListener('click', function () { copyText($('#restore-output').value, 'Copied the restored text.'); });
    $('#restore-dl-txt').addEventListener('click', function () { download('restored-text-' + stamp() + '.txt', '﻿' + $('#restore-output').value, 'text/plain;charset=utf-8'); });
    $('#restore-dl-csv').addEventListener('click', function () {
      if (restore.out) download(restoreBase() + '-' + stamp() + '.csv', '﻿' + toCSV(restore.out, true), 'text/csv;charset=utf-8');
    });
    $('#restore-dl-xlsx').addEventListener('click', function () {
      if (!restore.out) return;
      Bridge.call({ type: 'writeXlsx', aoa: restore.out.map(function (r) { return r.slice(); }), numericCols: [], sheetName: 'Restored' }).then(function (out) {
        download(restoreBase() + '-' + stamp() + '.xlsx', new Blob([out.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      }).catch(function (err) { setMsg($('#restore-msg'), 'err', 'The tool cannot write the Excel file: ' + esc(err.message) + '. Download the CSV instead.'); });
    });
  }
  function restoreBase() { return 'restored-data'; }
  function updateRestoreBtn() {
    var isText = $('input[name=restore-src][value=text]').checked;
    var ready = !!restore.key && (isText ? $('#restore-text').value.trim() !== '' : !!restore.table);
    $('#restore-btn').disabled = !ready;
  }
  function restoreTableHtml(rows) {
    var header = rows[0] || [];
    var h = '<table class="grid"><thead><tr>' + header.map(function (x) { return '<th scope="col">' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.slice(1, 11).forEach(function (r) { h += '<tr>' + r.map(function (v) { return '<td dir="auto">' + esc(trunc(v, 50)) + '</td>'; }).join('') + '</tr>'; });
    return h + '</tbody></table>';
  }
  function restoreMessage(stats, k, table) {
    var html = fmtInt(stats.replaced) + ' codes were changed back to real values.';
    if (stats.unknown.size) html += '<br>These codes are not in the match file, so they stay as they are: ' + esc(Array.from(stats.unknown).slice(0, 20).join(', ')) + (stats.unknown.size > 20 ? ' …' : '') + '. Check that you chose the match file from the same download.';
    if (table) {
      var fileRun = /masked-data-([A-Z0-9]{4})-/.exec(restore.tableName || '');
      if (fileRun && k.meta.run_id && fileRun[1] !== k.meta.run_id) html += '<br><b>The file name shows run ' + esc(fileRun[1]) + ', but the match file is from run ' + esc(k.meta.run_id) + '.</b> Check that you chose the right match file.';
      if (table.doDates && table.rowMode && !k.meta.anchor_column) html += '<br>This match file finds each date by row number. The rows must stay in the original order.';
      if (stats.noDateCols) html += '<br>The tool found no date columns to move back. The column names can have changed.';
      if (stats.noOffset) html += '<br>' + stats.noOffset + ' rows have no date shift in the match file (column ' + esc(k.meta.anchor_column || 'row number') + ' does not match). Their dates stay as they are.';
      if (stats.dateFails) html += '<br>The tool cannot read ' + stats.dateFails + ' dates. They stay as they are.';
    }
    return html;
  }
  function doRestore() {
    var k = restore.key, re = L.buildRestoreRe(k), stats = { replaced: 0, unknown: new Set() }, table = null;
    $('#restore-text-out').hidden = true; $('#restore-table-out').hidden = true;
    if ($('input[name=restore-src][value=text]').checked) {
      $('#restore-output').value = L.restoreText($('#restore-text').value, k, re, stats);
      $('#restore-text-out').hidden = false;
    } else {
      table = L.restoreRows(restore.table, k, re, { dates: $('#restore-dates').checked });
      stats = table.stats;
      restore.out = table.rows;
      $('#restore-table-preview').innerHTML = restoreTableHtml(table.rows);
      $('#restore-table-out').hidden = false;
    }
    setMsg($('#restore-msg'), stats.unknown.size ? 'warn' : 'ok', restoreMessage(stats, k, table));
    announce(stats.replaced + ' codes were changed back.');
  }

  // ---------- init ----------
  function init() {
    initTabs(); initLoad(); initSanitise(); initExport(); initRestore();
    $('#to-columns').addEventListener('click', function () { showTab('p-columns', true); });
    $('#col-filter').addEventListener('input', applyFilter);
    $('#col-show').addEventListener('change', applyFilter);
    $('#reset-sug').addEventListener('click', resetSuggestions);
    $('#preset-save').addEventListener('click', savePreset);
    $('#preset-input').addEventListener('change', function (e) { var f = e.target.files[0]; e.target.value = ''; if (f) loadPreset(f); });
    setDataTabsEnabled(false);
    renderSanitise(); renderExport(); renderPreview();
    function engineText() { return 'SheetJS ' + (window.XLSX ? window.XLSX.version : '?'); }
    $('#engine').textContent = engineText();
    Bridge.call({ type: 'ping' }).then(function () { $('#engine').textContent = engineText(); });
    window.__dm = { state: state, generate: generate, schemaText: schemaText, keyAoa: keyAoa, toCSV: toCSV, bridge: Bridge };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

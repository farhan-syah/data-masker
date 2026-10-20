/* Data Masker core: file reading and XLSX writing.
   Runs inside a Web Worker built from a blob, or on the main thread as a fallback. */
(function (root) {
  'use strict';
  var slots = {};

  function decodeText(u8) {
    if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
      return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'UTF-8' };
    }
    if (u8[0] === 0xFF && u8[1] === 0xFE) {
      return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'UTF-16LE' };
    }
    if (u8[0] === 0xFE && u8[1] === 0xFF) {
      return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), encoding: 'UTF-16BE' };
    }
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('windows-1252').decode(u8), encoding: 'windows-1252', guessed: true };
    }
  }

  // Count delimiters outside quotes in the first lines; pick the most consistent one.
  function detectDelim(text) {
    var sample = text.slice(0, 50000);
    var cands = [',', ';', '\t', '|'];
    var best = ',', bestScore = 0;
    cands.forEach(function (d) {
      var counts = [], n = 0, inQ = false;
      for (var i = 0; i < sample.length && counts.length < 10; i++) {
        var ch = sample[i];
        if (ch === '"') inQ = !inQ;
        else if (!inQ && ch === d) n++;
        else if (!inQ && ch === '\n') { counts.push(n); n = 0; }
      }
      if (counts.length < 10 && n > 0) counts.push(n);
      if (!counts.length || counts[0] === 0) return;
      var same = counts.filter(function (c) { return c === counts[0]; }).length;
      var score = same * 1000 + counts[0];
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  }

  function parseCSV(text, d) {
    var rows = [], row = [], field = '', inQ = false, i = 0, n = text.length;
    var dc = d.charCodeAt(0);
    while (i < n) {
      var c = text.charCodeAt(i);
      if (inQ) {
        if (c === 34) {
          if (text.charCodeAt(i + 1) === 34) { field += '"'; i += 2; continue; }
          inQ = false; i++; continue;
        }
        var j = text.indexOf('"', i);
        if (j === -1) { field += text.slice(i); i = n; continue; }
        field += text.slice(i, j); i = j; continue;
      }
      if (c === 34 && field === '') { inQ = true; i++; continue; }
      if (c === dc) { row.push(field); field = ''; i++; continue; }
      if (c === 13 || c === 10) {
        row.push(field); field = ''; rows.push(row); row = [];
        if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
        i++; continue;
      }
      field += text[i]; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  function cellToString(cell, date1904) {
    if (!cell) return '';
    var t = cell.t, v = cell.v, z = cell.z;
    if (t === 'n') {
      if (z && typeof z === 'string' && z !== 'General' && XLSX.SSF.is_date(z)) {
        var p = XLSX.SSF.parse_date_code(v, { date1904: !!date1904 });
        if (p) {
          var s = pad(p.y, 4) + '-' + pad(p.m, 2) + '-' + pad(p.d, 2);
          if (p.H || p.M || p.S) s += ' ' + pad(p.H, 2) + ':' + pad(p.M, 2) + (p.S ? ':' + pad(Math.round(p.S), 2) : '');
          return s;
        }
      }
      if (z && /^0+$/.test(z) && cell.w) return cell.w;
      if (z && typeof z === 'string') {
        var sec = z.split(';')[0];
        var dm = /\.(0+)(?![^"]*")/.exec(sec);
        if (dm && !/%|E\+|E-/i.test(sec) && isFinite(v)) return v.toFixed(dm[1].length);
      }
      return String(v);
    }
    if (t === 'd') {
      var dt = v instanceof Date ? v : new Date(v);
      return pad(dt.getFullYear(), 4) + '-' + pad(dt.getMonth() + 1, 2) + '-' + pad(dt.getDate(), 2);
    }
    if (t === 'b') return v ? 'TRUE' : 'FALSE';
    if (t === 'e') return cell.w || '';
    if (t === 'z') return '';
    return v == null ? '' : String(v);
  }

  function sheetRows(ws, date1904) {
    if (!ws || !ws['!ref']) return [];
    var r = XLSX.utils.decode_range(ws['!ref']);
    var dense = ws['!data'];
    var rows = [];
    for (var R = r.s.r; R <= r.e.r; R++) {
      var row = [];
      var drow = dense ? dense[R] : null;
      for (var C = r.s.c; C <= r.e.c; C++) {
        var cell = dense ? (drow ? drow[C] : null) : ws[XLSX.utils.encode_cell({ r: R, c: C })];
        row.push(cellToString(cell, date1904));
      }
      rows.push(row);
    }
    while (rows.length && rows[rows.length - 1].every(function (x) { return x === ''; })) rows.pop();
    var maxC = 0;
    rows.forEach(function (row) {
      for (var k = row.length - 1; k >= 0; k--) { if (row[k] !== '') { if (k + 1 > maxC) maxC = k + 1; break; } }
    });
    return rows.map(function (row) { return row.slice(0, maxC); });
  }

  function openFile(msg) {
    var name = String(msg.name || '').toLowerCase();
    var u8 = new Uint8Array(msg.buf);
    if (/\.(csv|tsv|txt)$/.test(name)) {
      var dec = msg.encoding ? { text: new TextDecoder(msg.encoding).decode(u8), encoding: msg.encoding } : decodeText(u8);
      var delim = /\.tsv$/.test(name) ? '\t' : detectDelim(dec.text);
      slots[msg.slot] = null;
      return { kind: 'csv', sheets: ['(CSV)'], sheet: '(CSV)', rows: parseCSV(dec.text, delim), encoding: dec.encoding, guessed: !!dec.guessed, delimiter: delim };
    }
    var wb = XLSX.read(u8, { type: 'array', dense: true, cellNF: true, cellText: true, cellDates: false });
    var date1904 = !!(wb.Workbook && wb.Workbook.WBProps && wb.Workbook.WBProps.date1904);
    slots[msg.slot] = { wb: wb, date1904: date1904 };
    var first = wb.SheetNames[0];
    return { kind: 'xlsx', sheets: wb.SheetNames.slice(), sheet: first, rows: sheetRows(wb.Sheets[first], date1904) };
  }

  function readSheet(msg) {
    var s = slots[msg.slot];
    if (!s) throw new Error('No Excel file is open.');
    return { sheet: msg.sheet, rows: sheetRows(s.wb.Sheets[msg.sheet], s.date1904) };
  }

  function writeXlsx(msg) {
    var aoa = msg.aoa, numeric = msg.numericCols || [];
    for (var r = 1; r < aoa.length; r++) {
      var row = aoa[r];
      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        if (numeric[c] && typeof v === 'string' && /^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(v)) row[c] = Number(v);
      }
    }
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = (aoa[0] || []).map(function (h, c) {
      var w = String(h).length;
      for (var r2 = 1; r2 < Math.min(aoa.length, 200); r2++) {
        var len = String(aoa[r2][c] == null ? '' : aoa[r2][c]).length;
        if (len > w) w = len;
      }
      return { wch: Math.min(Math.max(w + 2, 8), 60) };
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, String(msg.sheetName || 'Data').slice(0, 31));
    var out = XLSX.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
    return { buffer: out };
  }

  function handle(msg) {
    switch (msg.type) {
      case 'open': return openFile(msg);
      case 'sheet': return readSheet(msg);
      case 'writeXlsx': return writeXlsx(msg);
      case 'ping': return { pong: true, version: XLSX.version };
      default: throw new Error('Unknown message type: ' + msg.type);
    }
  }

  root.DMCore = { handle: handle };

  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = function (e) {
      var m = e.data;
      try {
        var result = handle(m);
        var tr = result && result.buffer instanceof ArrayBuffer ? [result.buffer] : [];
        root.postMessage({ id: m.id, ok: true, result: result }, tr);
      } catch (err) {
        root.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
      }
    };
  }
})(self);

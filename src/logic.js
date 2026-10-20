/* Data Masker logic: header normalisation, column classification, tidy, mask, restore.
   Codes are random or sequential per session, and a match file holds the mapping.
   Every free-text column is flagged, and names found in free text are replaced. */
(function (root) {
  'use strict';

  // ---------- random ----------
  var cryptoObj = root.crypto || (typeof globalThis !== 'undefined' ? globalThis.crypto : null);
  function randUint32() {
    var a = new Uint32Array(1);
    cryptoObj.getRandomValues(a);
    return a[0];
  }
  // Uniform integer in [0, max) with rejection sampling (no modulo bias).
  function randInt(max) {
    if (max <= 0) return 0;
    var limit = Math.floor(0x100000000 / max) * max;
    var x;
    do { x = randUint32(); } while (x >= limit);
    return x % max;
  }
  function randUnit() { return randUint32() / 0x100000000; }
  var TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function randomCode(len) {
    var s = '';
    for (var i = 0; i < len; i++) s += TOKEN_ALPHABET[randInt(TOKEN_ALPHABET.length)];
    return s;
  }
  function randomSample(n, k) {
    var idx = new Array(n);
    for (var i = 0; i < n; i++) idx[i] = i;
    k = Math.min(k, n);
    for (var j = 0; j < k; j++) {
      var r = j + randInt(n - j);
      var t = idx[j]; idx[j] = idx[r]; idx[r] = t;
    }
    return idx.slice(0, k).sort(function (a, b) { return a - b; });
  }
  // Shift dates back by 30 to 730 days, so shifted dates never land in the future.
  function randomShiftDays() {
    return -(30 + randInt(701));
  }

  // ---------- header normalisation ----------
  function normalizeColumnName(name) {
    var s = String(name == null ? '' : name).trim().normalize('NFKC');
    s = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1_$2').toLowerCase();
    s = s.replace(/[.\-/\\()\[\]{}:;,]+/g, '_');
    s = s.replace(/\s+/g, '_');
    s = s.replace(/[^\p{L}\p{N}_]/gu, '');
    s = s.replace(/_+/g, '_');
    s = s.replace(/^_+|_+$/g, '');
    return s;
  }

  // ---------- patterns ----------
  var RX = {
    nationalId: /^(?:\d{3}([- ])\d{2}\1\d{4}|\d{6}([- ])\d{2}\2\d{4})$/,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    // 7 to 15 digits with at least one of + ( ) space . - so that plain numbers do not match.
    phone: /^(?=(?:\D*\d){7,15}\D*$)(?=.*[+()\s.-])[+(]?\d[\d\s().-]*$/,
    addr: /(^|[\s,])(street|st|road|rd|avenue|ave|lane|ln|drive|boulevard|blvd|court|terrace|highway|hwy|apt|apartment|suite|flat|block|building|po box|no\.)(?=[\s,.]|$)/i,
    postcode: /(^|[^A-Za-z0-9])(?:\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|[A-Z]\d[A-Z]\s?\d[A-Z]\d)($|[^A-Za-z0-9])/,
    nameLike: /^\p{Lu}[\p{L}'’.\-]*(?:\s+(?:(?:van|von|der|den|de|del|della|di|da|dos|du|la|le|bin|binti|ibn|bint|al|el|ben|bar|ap)|\p{Lu}[\p{L}'’.\-]*))+$/u,
    nameCaps: /^\p{Lu}[\p{Lu}'’.\-]+(?:\s+\p{Lu}[\p{Lu}'’.\/\-]*)+$/u,
    emailG: /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[A-Za-z]{2,}/g,
    // National ID shapes in free text: 3-2-4 and 6-2-4 digits, long digit runs, UK NINO, IBAN.
    idG: /(?<![\d-])\d{3}[- ]\d{2}[- ]\d{4}(?![\d-])|(?<![\d-])\d{6}-\d{2}-\d{4}(?![\d-])|(?<![\d.,+-])\d{9,16}(?![\d.,-])|\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b|\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g,
    // Candidate phone numbers in free text. scrubText checks the digit count before it replaces one.
    phoneG: /(?<![\w+])(?=[+(\d])(?:\+\d{8,15}|(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,5}(?:[\s.-]\d{2,6}){1,3})(?![\w-])/g
  };
  function validNationalId(s) { return RX.nationalId.test(String(s).trim()); }
  // Letters that have no upper and lower case, such as Chinese, Arabic, Hebrew, Thai and Korean.
  function isCaseless(t) { return /\p{L}/u.test(t) && t.toLowerCase() === t && t.toUpperCase() === t; }
  // Lower-case a string without changing its length, so positions line up with the original text.
  function fold(s) {
    return Array.from(s).map(function (ch) { var l = ch.toLowerCase(); return l.length === ch.length ? l : ch; }).join('');
  }

  // ---------- dates ----------
  var MONTHS = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
    jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
    nov: 11, november: 11, dec: 12, december: 12
  };
  var MON_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MON_EN_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function pad(n, w) { var s = String(Math.abs(n)); while (s.length < w) s = '0' + s; return (n < 0 ? '-' : '') + s; }
  function validYMD(y, m, d) {
    if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCFullYear(y);
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }
  function pivotYear(yy, now) {
    var cur = (now || new Date()).getFullYear() % 100;
    return yy <= cur ? 2000 + yy : 1900 + yy;
  }
  function fromSerial(v) {
    // Excel 1900 system; serials >= 61 avoid the fake 1900-02-29.
    var ms = Date.UTC(1899, 11, 30) + Math.round(v * 86400000);
    var dt = new Date(ms);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  function monthStyle(tok) {
    var low = tok.toLowerCase();
    var longForm = tok.length > 3 && low !== 'sept';
    var kase = tok === tok.toUpperCase() ? 'upper' : (tok === tok.toLowerCase() ? 'lower' : 'title');
    return { long: longForm, kase: kase };
  }

  // Returns {y,m,d,fmt} or null. fmt describes the input layout so output can keep it.
  // order: 'dmy' (default) or 'mdy' decides how 03/04/2020 is read.
  function parseDate(raw, allowSerial, now, order) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    var m, y, mo, d, suffix = '';
    m = /^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})((?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?)$/.exec(s);
    if (m) {
      y = +m[1]; mo = +m[3]; d = +m[4]; suffix = m[5] || '';
      if (!validYMD(y, mo, d)) return null;
      return { y: y, m: mo, d: d, fmt: { order: 'ymd', sep: m[2], padM: m[3].length === 2, padD: m[4].length === 2, yy: false, suffix: suffix } };
    }
    m = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})((?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)$/.exec(s);
    if (m) {
      var mdy = order === 'mdy', dTok = mdy ? m[3] : m[1], mTok = mdy ? m[1] : m[3];
      d = +dTok; mo = +mTok; y = m[4].length === 2 ? pivotYear(+m[4], now) : +m[4]; suffix = m[5] || '';
      if (!validYMD(y, mo, d)) return null;
      return { y: y, m: mo, d: d, fmt: { order: mdy ? 'mdy' : 'dmy', sep: m[2], padM: mTok.length === 2, padD: dTok.length === 2, yy: m[4].length === 2, suffix: suffix } };
    }
    m = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})\.?[\s-,]+(\d{4})$/.exec(s);
    if (m && MONTHS[m[2].toLowerCase()]) {
      d = +m[1]; mo = MONTHS[m[2].toLowerCase()]; y = +m[3];
      if (!validYMD(y, mo, d)) return null;
      var sepM = /^\d{1,2}-/.test(s) ? '-' : ' ';
      return { y: y, m: mo, d: d, fmt: { order: 'dmony', sep: sepM, padD: m[1].length === 2, mon: monthStyle(m[2]), suffix: '' } };
    }
    m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s);
    if (m && MONTHS[m[1].toLowerCase()]) {
      d = +m[2]; mo = MONTHS[m[1].toLowerCase()]; y = +m[3];
      if (!validYMD(y, mo, d)) return null;
      return { y: y, m: mo, d: d, fmt: { order: 'mdony', padD: m[2].length === 2, mon: monthStyle(m[1]), suffix: '' } };
    }
    if (allowSerial && /^\d{4,5}(\.\d+)?$/.test(s)) {
      var v = parseFloat(s);
      if (v >= 61 && v < 80000) {
        var p = fromSerial(v);
        return { y: p.y, m: p.m, d: p.d, fmt: { order: 'ymd', sep: '-', padM: true, padD: true, yy: false, suffix: '', serial: true } };
      }
    }
    return null;
  }

  function monthName(mo, st) {
    var t = (st.long ? MON_EN_LONG : MON_EN)[mo - 1];
    if (st.kase === 'upper') return t.toUpperCase();
    if (st.kase === 'lower') return t.toLowerCase();
    return t;
  }

  // Parts of a formatted date, typed y/m/d/s, so callers can see which characters show what.
  function formatDateParts(dt, fmt, target) {
    if (target === 'iso') return [{ t: 'y', v: pad(dt.y, 4) }, { t: 's', v: '-' }, { t: 'm', v: pad(dt.m, 2) }, { t: 's', v: '-' }, { t: 'd', v: pad(dt.d, 2) }];
    if (target === 'mdy') return [{ t: 'm', v: pad(dt.m, 2) }, { t: 's', v: '/' }, { t: 'd', v: pad(dt.d, 2) }, { t: 's', v: '/' }, { t: 'y', v: pad(dt.y, 4) }];
    if (target === 'dmy') return [{ t: 'd', v: pad(dt.d, 2) }, { t: 's', v: '/' }, { t: 'm', v: pad(dt.m, 2) }, { t: 's', v: '/' }, { t: 'y', v: pad(dt.y, 4) }];
    var f = fmt || { order: 'ymd', sep: '-', padM: true, padD: true };
    var parts;
    if (f.order === 'ymd') {
      parts = [{ t: 'y', v: pad(dt.y, 4) }, { t: 's', v: f.sep }, { t: 'm', v: f.padM ? pad(dt.m, 2) : String(dt.m) }, { t: 's', v: f.sep }, { t: 'd', v: f.padD ? pad(dt.d, 2) : String(dt.d) }];
    } else if (f.order === 'dmy') {
      parts = [{ t: 'd', v: f.padD ? pad(dt.d, 2) : String(dt.d) }, { t: 's', v: f.sep }, { t: 'm', v: f.padM ? pad(dt.m, 2) : String(dt.m) }, { t: 's', v: f.sep }, { t: 'y', v: f.yy ? pad(dt.y % 100, 2) : pad(dt.y, 4) }];
    } else if (f.order === 'mdy') {
      parts = [{ t: 'm', v: f.padM ? pad(dt.m, 2) : String(dt.m) }, { t: 's', v: f.sep }, { t: 'd', v: f.padD ? pad(dt.d, 2) : String(dt.d) }, { t: 's', v: f.sep }, { t: 'y', v: f.yy ? pad(dt.y % 100, 2) : pad(dt.y, 4) }];
    } else if (f.order === 'mdony') {
      parts = [{ t: 'm', v: monthName(dt.m, f.mon) }, { t: 's', v: ' ' }, { t: 'd', v: f.padD ? pad(dt.d, 2) : String(dt.d) }, { t: 's', v: ', ' }, { t: 'y', v: pad(dt.y, 4) }];
    } else {
      parts = [{ t: 'd', v: f.padD ? pad(dt.d, 2) : String(dt.d) }, { t: 's', v: f.sep }, { t: 'm', v: monthName(dt.m, f.mon) }, { t: 's', v: f.sep }, { t: 'y', v: pad(dt.y, 4) }];
    }
    if (f.suffix) parts.push({ t: 'x', v: f.suffix });
    return parts;
  }
  function formatDate(dt, fmt, target) {
    return formatDateParts(dt, fmt, target).map(function (p) { return p.v; }).join('');
  }
  function addDays(dt, days) {
    var x = new Date(Date.UTC(dt.y, dt.m - 1, dt.d));
    x.setUTCFullYear(dt.y);
    x.setUTCDate(x.getUTCDate() + days);
    return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
  }
  function ageAt(dt, now) {
    var ty = now.getFullYear(), tm = now.getMonth() + 1, td = now.getDate();
    var a = ty - dt.y;
    if (tm < dt.m || (tm === dt.m && td < dt.d)) a--;
    return a;
  }

  // A header cell that is really a value: an email, an ID, a phone number or a date.
  function looksLikeData(v) {
    var t = String(v == null ? '' : v).trim();
    if (!t) return false;
    return RX.email.test(t) || validNationalId(t) || (RX.phone.test(t) && !parseDate(t, false) && !parseNumber(t)) ||
      !!(parseDate(t, false) || parseDate(t, false, null, 'mdy'));
  }

  // ---------- classification by header words and value patterns ----------
  // Kind ids are internal and never shown. KIND_LABEL holds the screen text.
  var KIND_LABEL = {
    name: 'Person name', national_id: 'National ID / passport no.', id: 'Reference no. / ID', email: 'Email', phone: 'Phone',
    address: 'Address', date: 'Date', money: 'Money', number: 'Number', text: 'Free text',
    category: 'Category', empty: 'Empty'
  };
  var PERSONAL_KINDS = { name: 1, national_id: 1, id: 1, email: 1, phone: 1, address: 1 };
  var DEFAULT_PREFIX = { name: 'PERSON', national_id: 'NID', id: 'ID', email: 'EMAIL', phone: 'PHONE', address: 'ADDRESS' };

  function headerHint(norm) {
    norm = norm.normalize('NFD').replace(/\p{M}/gu, '');
    var t = norm.split('_').filter(Boolean);
    function has() { for (var i = 0; i < arguments.length; i++) if (t.indexOf(arguments[i]) >= 0) return true; return false; }
    function inc() { for (var i = 0; i < arguments.length; i++) if (norm.indexOf(arguments[i]) >= 0) return true; return false; }
    var r = { kind: null, birth: false, qi: false };
    if (has('grade', 'level', 'rank', 'department', 'division', 'unit', 'section', 'team', 'branch', 'office', 'site', 'position', 'title',
      'role', 'job', 'gender', 'sex', 'race', 'ethnicity', 'religion', 'age', 'state', 'province', 'region', 'city', 'country',
      'nationality', 'class', 'category', 'group', 'school', 'location')) r.qi = true;
    if (inc('national_id', 'nationalid', 'social_security', 'passport', 'nric', 'identity_card', 'id_card', 'driver_licen', 'tax_id', 'taxid') ||
      has('ssn', 'nin', 'nid', 'sin', 'tin', 'passport', 'iban')) r.kind = 'national_id';
    else if (has('email', 'mail', 'emailaddress', 'correo', 'courriel') || inc('e_mail')) r.kind = 'email';
    else if (has('phone', 'tel', 'telephone', 'mobile', 'cell', 'cellphone', 'fax', 'msisdn', 'telefono', 'telefon', 'telefone', 'handy')) r.kind = 'phone';
    else if (has('address', 'street', 'postcode', 'zip', 'zipcode', 'postal', 'direccion', 'adresse', 'anschrift', 'indirizzo', 'endereco')) { r.kind = 'address'; r.qi = true; }
    else if (has('dob', 'birth', 'birthdate', 'birthday', 'born', 'geburtsdatum', 'geburtstag', 'nacimiento', 'naissance', 'nascimento')) { r.kind = 'date'; r.birth = true; r.qi = true; }
    else if (has('date', 'dt', 'datetime', 'timestamp')) r.kind = 'date';
    else if (has('salary', 'wage', 'wages', 'pay', 'income', 'amount', 'allowance', 'price', 'cost', 'fee', 'balance', 'revenue', 'bonus', 'compensation')) r.kind = 'money';
    else if (has('note', 'notes', 'remark', 'remarks', 'comment', 'comments', 'description', 'reason', 'feedback', 'memo', 'narrative', 'summary')) r.kind = 'text';
    else if (has('name', 'fullname', 'surname', 'forename', 'firstname', 'lastname', 'givenname', 'familyname', 'middlename', 'supervisor', 'manager',
      'spouse', 'kin', 'nom', 'prenom', 'nombre', 'apellido', 'apellidos', 'vorname', 'nachname', 'nome', 'cognome') && !has('department', 'division', 'unit', 'position', 'job', 'title', 'course',
      'company', 'project', 'program', 'school', 'file', 'product', 'state', 'city', 'agency', 'ministry', 'section', 'branch',
      'sheet', 'journal', 'team', 'role', 'organisation', 'organization', 'country', 'region', 'street')) r.kind = 'name';
    else if (has('staff', 'employee', 'member', 'customer', 'client', 'patient', 'student', 'user', 'account', 'case', 'file') &&
      has('no', 'id', 'number', 'num', 'code')) r.kind = 'id';
    else if (has('id', 'empid', 'staffid', 'account', 'bank')) r.kind = 'id';
    return r;
  }

  function classifyColumn(header, norm, values) {
    var hint = headerHint(norm);
    var sample = [];
    for (var i = 0; i < values.length && sample.length < 400; i++) {
      var v = values[i];
      if (v != null && String(v).trim() !== '') sample.push(String(v).trim());
    }
    var info = { nonEmpty: 0, distinct: 0 };
    var nonEmptyAll = 0;
    var distinctSet = new Set();
    for (var k = 0; k < values.length; k++) {
      var vv = values[k];
      if (vv != null && String(vv).trim() !== '') { nonEmptyAll++; if (distinctSet.size < 100000) distinctSet.add(String(vv).trim()); }
    }
    info.nonEmpty = nonEmptyAll;
    info.distinct = distinctSet.size;
    var res = { kind: 'category', birth: hint.birth, qi: hint.qi, personal: false, freeText: false, serialDates: false, info: info, hintKind: hint.kind };
    if (!sample.length) { res.kind = 'empty'; return res; }
    var n = sample.length, c = { nid: 0, email: 0, phone: 0, date: 0, serial: 0, money: 0, num: 0, addr: 0, name: 0, caseless: 0, shortCaseless: 0, word: 0, len: 0, nospace: 0 };
    var dateHint = hint.kind === 'date';
    sample.forEach(function (s) {
      if (validNationalId(s)) c.nid++;
      if (RX.email.test(s)) c.email++;
      var pd = parseDate(s, false) || parseDate(s, false, null, 'mdy');
      var pn = parseNumber(s);
      var isNum = !!pn, isMoney = !!pn && (!!pn.pre || !!pn.suf || pn.dec === 2);
      if (RX.phone.test(s) && !pd && !isMoney && !isNum) c.phone++;
      if (pd) c.date++;
      else if (dateHint && parseDate(s, true)) { c.date++; c.serial++; }
      if (isMoney) c.money++;
      if (isNum) c.num++;
      if (RX.addr.test(s) || (RX.postcode.test(s) && s.indexOf(',') >= 0 && /[A-Za-z]/.test(s))) c.addr++;
      if ((RX.nameLike.test(s) || RX.nameCaps.test(s)) && s.length < 60) c.name++;
      if (isCaseless(s)) { c.caseless++; if (s.length <= 30) c.shortCaseless++; }
      c.word += s.split(/\s+/).length;
      c.len += s.length;
      if (!/\s/.test(s)) c.nospace++;
    });
    var R = function (x) { return x / n; };
    var avgLen = c.len / n, avgWords = c.word / n;
    var distinctRatio = info.distinct / Math.max(info.nonEmpty, 1);
    var kind;
    if (R(c.nid) >= 0.6) kind = 'national_id';
    else if (R(c.email) >= 0.6) kind = 'email';
    else if (R(c.phone) >= 0.6 && hint.kind !== 'date' && hint.kind !== 'money') kind = 'phone';
    else if (hint.kind && hint.kind !== 'date' && hint.kind !== 'money') kind = hint.kind;
    else if (hint.kind === 'date' && R(c.date) >= 0.5) kind = 'date';
    else if (R(c.date) >= 0.8) kind = 'date';
    else if (hint.kind === 'money' && R(Math.max(c.num, c.money)) >= 0.6) kind = 'money';
    else if (R(c.money) >= 0.8) kind = 'money';
    else if (R(c.num) >= 0.8) kind = 'number';
    else if (R(c.addr) >= 0.5) kind = 'address';
    else if (avgLen >= 30 || avgWords >= 6) kind = 'text';
    else if (R(c.name) >= 0.6 && distinctRatio >= 0.6 && avgWords >= 2) kind = 'name';
    else if (R(c.shortCaseless) >= 0.6 && distinctRatio >= 0.6) kind = 'name';
    else if (R(c.nospace) >= 0.9 && distinctRatio >= 0.9 && info.nonEmpty >= 10 && /\d/.test(sample[0])) kind = 'id';
    else kind = 'category';
    res.kind = kind;
    // Text in a script without letter case: the tool cannot tell names from other words, so it asks the user to check.
    res.review = R(c.caseless) >= 0.5 && (kind === 'category' || kind === 'text');
    res.serialDates = kind === 'date' && c.serial > 0;
    res.personal = !!PERSONAL_KINDS[kind] || (kind === 'date' && hint.birth);
    res.freeText = kind === 'text';
    if (kind === 'address') res.qi = true;
    if (PERSONAL_KINDS[kind] && kind !== 'address') res.qi = false;
    return res;
  }

  var ID_PREFIX = [[/staff|employee/, 'EMP'], [/customer|client/, 'CUST'], [/patient/, 'PATIENT'], [/student/, 'STUDENT'], [/member/, 'MEMBER'], [/file|case/, 'CASE']];
  function suggest(cls, header) {
    var k = cls.kind;
    var p = defaultParams();
    var r = { status: 'accept', strategy: 'pseudo', params: p };
    if (k === 'name' || k === 'national_id' || k === 'id' || k === 'email') {
      r.status = 'mask'; r.strategy = 'pseudo'; p.prefix = DEFAULT_PREFIX[k];
      if (k === 'national_id') p.tokenStyle = 'random';
      if (k === 'id') {
        var norm = normalizeColumnName(header);
        for (var i = 0; i < ID_PREFIX.length; i++) if (ID_PREFIX[i][0].test(norm)) { p.prefix = ID_PREFIX[i][1]; break; }
      }
    } else if (k === 'phone') {
      r.status = 'mask'; r.strategy = 'partial'; p.keepN = 2; p.side = 'last'; p.keepSep = true;
    } else if (k === 'address') {
      r.status = 'mask'; r.strategy = 'gen'; p.genMode = 'region';
    } else if (k === 'date') {
      r.status = 'mask';
      if (cls.birth) { r.strategy = 'gen'; p.genMode = 'ageband'; p.width = 5; }
      else r.strategy = 'shift';
    } else if (k === 'money') {
      r.status = 'mask'; r.strategy = 'gen'; p.genMode = 'band'; p.width = 1000;
    } else if (k === 'text') {
      r.status = 'mask'; r.strategy = 'scrub';
    } else if (k === 'empty') {
      r.status = 'hide';
    }
    return r;
  }

  function defaultParams() {
    return {
      prefix: 'CODE', tokenStyle: 'seq', keepN: 4, side: 'last', keepSep: true,
      genMode: 'year', width: 5, firstN: 3, parts: 1, numMode: 'round', roundTo: 100, noisePct: 5, fixedText: '[REMOVED]'
    };
  }

  function cleanPrefix(p) {
    var s = String(p || '').toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return s || 'CODE';
  }

  // ---------- sanitise ----------
  var EMPTY_RE = /^(?:nan|null|none|n\/a|na|#n\/a|-|--|—)$/i;
  function sanitizeValue(v, col, opt) {
    var s = v == null ? '' : String(v);
    if (opt.ctrl) {
      s = s.replace(/_x000D_/g, '').replace(/\r\n|\r|\n|\t/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​‌‍﻿]/g, '');
    }
    if (opt.trim) s = s.replace(/[  ]{2,}/g, ' ').replace(/^[\s ]+|[\s ]+$/g, '');
    if (opt.empty && EMPTY_RE.test(s.trim())) s = '';
    if (!s) return s;
    if (col.kind === 'date' && (opt.dateFmt === 'iso' || opt.dateFmt === 'dmy' || opt.dateFmt === 'mdy' || col.serialDates)) {
      var d = parseDate(s, col.serialDates, null, opt.dateOrder);
      if (d) {
        if (opt.dateFmt === 'iso' || opt.dateFmt === 'dmy' || opt.dateFmt === 'mdy') s = formatDate(d, d.fmt, opt.dateFmt);
        else if (d.fmt.serial) s = formatDate(d, d.fmt, 'iso');
      }
    }
    return s;
  }

  // ---------- numbers ----------
  // Reads 1,234.50 and 1.234,50 and 1 234,50, with an optional currency symbol or three-letter code.
  function parseNumber(s) {
    var t = String(s).trim(), pre = '', suf = '', m;
    if ((m = /^(?:[$€£¥₹]|[A-Za-z]{2,3}\s)\s*/.exec(t))) { pre = m[0]; t = t.slice(pre.length); }
    else if ((m = /(?:\s[A-Za-z]{3}|\s?[$€£¥₹])$/.exec(t))) { suf = m[0]; t = t.slice(0, t.length - suf.length); }
    var us = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(t);
    var eu = !us && /^-?(?:\d{1,3}(?:[. \u00a0]\d{3})+|\d+),\d+$/.test(t);
    if (!us && !eu) return null;
    var clean = eu ? t.replace(/[. \u00a0]/g, '').replace(',', '.') : t.replace(/,/g, '');
    var tm = eu ? /\d([. \u00a0])\d{3}/.exec(t) : null;
    return { v: parseFloat(clean), dec: (clean.split('.')[1] || '').length, pre: pre, suf: suf, comma: us && t.indexOf(',') >= 0, eu: eu, euSep: tm ? tm[1] : '' };
  }
  function fmtNumber(v, dec, info) {
    var s = v.toFixed(dec);
    if (info && info.eu) {
      var ep = s.split('.');
      if (info.euSep) ep[0] = ep[0].replace(/\B(?=(\d{3})+(?!\d))/g, info.euSep);
      s = ep.join(',');
    } else if (info && info.comma) {
      var parts = s.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      s = parts.join('.');
    }
    return (info ? info.pre : '') + s + (info ? info.suf : '');
  }

  // ---------- masking ----------
  // ctx: { seq: Map prefix->{map,next}, random: session Map prefix->{byValue,used},
  //        keyRows: [], keySeen: Set, dict, noise(row,colIdx), shiftDays, now, stats }
  function newContext(session) {
    return {
      seq: new Map(), session: session, keyRows: [], keySeen: new Set(), dict: null,
      stats: { unparsed: {}, tokens: 0, scrubHits: 0 }
    };
  }
  // Codes ignore letter case, so "maria garcia" and "Maria Garcia" get one code. The match file keeps the first spelling.
  function tokenFor(ctx, prefix, style, value, colName) {
    var token, key = fold(value);
    if (style === 'random') {
      var bucket = ctx.session.random.get(prefix);
      if (!bucket) { bucket = { byValue: new Map(), used: new Set() }; ctx.session.random.set(prefix, bucket); }
      token = bucket.byValue.get(key);
      if (!token) {
        do { token = prefix + '_' + randomCode(6); } while (bucket.used.has(token));
        bucket.used.add(token); bucket.byValue.set(key, token);
      }
    } else {
      var ord = ctx.order && ctx.order.get(prefix);
      var b = ctx.seq.get(prefix);
      if (!b) { b = { map: new Map(), next: ord ? ord.size + 1 : 1 }; ctx.seq.set(prefix, b); }
      token = b.map.get(key);
      if (!token) {
        var n = ord && ord.get(key);
        token = prefix + '_' + pad(n || b.next++, 3);
        b.map.set(key, token);
      }
    }
    if (!ctx.keySeen.has(token)) {
      ctx.keySeen.add(token);
      ctx.keyRows.push([token, value, colName]);
      ctx.stats.tokens++;
    }
    return token;
  }
  // Numbers for codes "in order" are dealt out in random order, so a code number never shows a row position.
  // groups: Map prefix -> array of values. Returns Map prefix -> Map(folded value -> number).
  function buildCodeOrder(groups) {
    var order = new Map();
    groups.forEach(function (values, prefix) {
      var seen = new Set(), keys = [];
      values.forEach(function (v) { var k = fold(v); if (v && !seen.has(k)) { seen.add(k); keys.push(k); } });
      for (var i = keys.length - 1; i > 0; i--) { var j = randInt(i + 1); var t = keys[i]; keys[i] = keys[j]; keys[j] = t; }
      var m = new Map();
      keys.forEach(function (k, n) { m.set(k, n + 1); });
      order.set(prefix, m);
    });
    return order;
  }
  function markUnparsed(ctx, col) {
    ctx.stats.unparsed[col.outName] = (ctx.stats.unparsed[col.outName] || 0) + 1;
    return '[?]';
  }

  function partialMask(s, n, side, keepSep) {
    var ch = Array.from(s), len = ch.length, keep = Math.max(0, Math.min(n, len));
    var out = '';
    for (var i = 0; i < len; i++) {
      var kept = side === 'first' ? i < keep : i >= len - keep;
      if (kept) out += ch[i];
      else if (keepSep && /[\s\-\/.@]/.test(ch[i])) out += ch[i];
      else out += '*';
    }
    return out;
  }

  // Does keeping N chars on one side reveal more than the year of a date?
  function partialRevealsDate(sampleValue, col, n, side, order) {
    if (!sampleValue || col.kind !== 'date') return false;
    var d = parseDate(sampleValue, col.serialDates, null, order);
    if (!d) return false;
    var types = [];
    formatDateParts(d, d.fmt, null).forEach(function (p) { for (var i = 0; i < p.v.length; i++) types.push(p.t); });
    var len = types.length, keep = Math.min(n, len);
    for (var i = 0; i < len; i++) {
      var kept = side === 'first' ? i < keep : i >= len - keep;
      if (kept && (types[i] === 'm' || types[i] === 'd')) return true;
    }
    return false;
  }

  function buildDict(entries) {
    // entries: [{text, prefix, style, colName, partial}]
    var map = new Map();
    map.substr = [];
    entries.forEach(function (e) {
      var item = { value: e.text, text: e.text, prefix: e.prefix, style: e.style, colName: e.colName, partial: !!e.partial };
      if (isCaseless(e.text)) { map.substr.push(item); return; }
      var lower = fold(e.text);
      var fw = /[\p{L}\p{N}]+/u.exec(lower);
      if (!fw || fw.index !== 0) return;
      var list = map.get(fw[0]);
      if (!list) { list = []; map.set(fw[0], list); }
      item.lower = lower;
      list.push(item);
    });
    map.forEach(function (list) { list.sort(function (a, b) { return b.lower.length - a.lower.length; }); });
    map.substr.sort(function (a, b) { return b.text.length - a.text.length; });
    return map;
  }
  var WORD_CHAR = /[\p{L}\p{N}]/u;
  // Placeholders must never look like PREFIX_X or PREFIX-X, or restore reads them as codes.
  function scrubText(s, ctx, colName) {
    var out = s;
    out = out.replace(RX.emailG, function () { ctx.stats.scrubHits++; return '[EMAIL]'; });
    out = out.replace(RX.idG, function () { ctx.stats.scrubHits++; return '[ID NO]'; });
    out = out.replace(RX.phoneG, function (m) {
      var digits = m.replace(/\D/g, '').length;
      if (digits < 9 || digits > 15 || /^\d{4}-\d{2}-\d{2}$/.test(m)) return m;
      ctx.stats.scrubHits++; return '[PHONE]';
    });
    var dict = ctx.dict;
    if (!dict || (!dict.size && !dict.substr.length)) return out;
    // Words in a script without spaces or letter case (Chinese, Japanese, Thai) are found anywhere in the text.
    dict.substr.forEach(function (e) {
      if (out.indexOf(e.text) < 0) return;
      var pieces = out.split(e.text);
      ctx.stats.scrubHits += pieces.length - 1;
      out = pieces.join(e.partial ? '[NAME]' : tokenFor(ctx, e.prefix, e.style, e.value, e.colName));
    });
    var lower = fold(out);
    var re = /[\p{L}\p{N}]+/gu, m, res = '', last = 0;
    while ((m = re.exec(lower))) {
      var pos = m.index;
      var cands = dict.get(m[0]);
      if (!cands) continue;
      if (pos > 0 && WORD_CHAR.test(lower[pos - 1])) continue;
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i], end = pos + c.lower.length;
        if (lower.startsWith(c.lower, pos) && (end >= lower.length || !WORD_CHAR.test(lower[end]))) {
          res += out.slice(last, pos) + (c.partial ? '[NAME]' : tokenFor(ctx, c.prefix, c.style, c.value, c.colName));
          ctx.stats.scrubHits++;
          last = end; re.lastIndex = end;
          break;
        }
      }
    }
    return res + out.slice(last);
  }

  // Words of a multi-word name that can identify a person alone: the first and the last word.
  function nameParts(full) {
    var words = full.trim().split(/\s+/).map(function (w) { return w.replace(/^[.,]+|[.,]+$/g, ''); }).filter(Boolean);
    if (words.length < 2) return [];
    var out = [];
    [words[0], words[words.length - 1]].forEach(function (w) {
      if (/^\p{L}+$/u.test(w) && w.length >= (isCaseless(w) ? 2 : 4) && out.indexOf(w) < 0) out.push(w);
    });
    return out;
  }

  function maskValue(s, col, ctx, rowIdx) {
    if (s === '') return '';
    var p = col.params;
    switch (col.strategy) {
      case 'pseudo':
        return tokenFor(ctx, cleanPrefix(p.prefix), p.tokenStyle, s.replace(/\s+/g, ' ').trim(), col.outName);
      case 'partial':
        return partialMask(s, Math.max(0, parseInt(p.keepN, 10) || 0), p.side, p.keepSep);
      case 'gen': {
        var mode = p.genMode;
        if (mode === 'year' || mode === 'ageband') {
          var d = parseDate(s, col.serialDates, ctx.session.now, ctx.session.dateOrder);
          if (!d) return markUnparsed(ctx, col);
          if (mode === 'year') return String(d.y);
          var w = Math.max(1, parseInt(p.width, 10) || 5);
          var age = ageAt(d, ctx.session.now);
          if (w === 1) return String(age);
          var lo = Math.floor(age / w) * w;
          return lo + '-' + (lo + w - 1);
        }
        if (mode === 'band') {
          var nv = parseNumber(s);
          if (!nv) return markUnparsed(ctx, col);
          var bw = Math.abs(parseFloat(p.width)) || 1000;
          var blo = Math.floor(nv.v / bw) * bw;
          var intBand = Number.isInteger(bw) && Number.isInteger(blo);
          return intBand ? (blo + '-' + (blo + bw - 1)) : (blo.toFixed(2) + '-' + (blo + bw).toFixed(2));
        }
        if (mode === 'region') {
          var segs = s.split(/[,;\n]+/).map(function (x) { return x.trim(); }).filter(Boolean);
          if (segs.length < 2) return markUnparsed(ctx, col);
          var keepParts = segs.slice(-Math.max(1, parseInt(p.parts, 10) || 1)).map(function (x) {
            return x.split(/\s+/).filter(function (t) { return !/\d/.test(t); }).join(' ');
          }).filter(Boolean);
          return keepParts.length ? keepParts.join(', ') : '(none)';
        }
        var fn = Math.max(0, parseInt(p.firstN, 10) || 0);
        return Array.from(s).slice(0, fn).join('');
      }
      case 'shift': {
        var dd = parseDate(s, col.serialDates, ctx.session.now, ctx.session.dateOrder);
        if (!dd) return markUnparsed(ctx, col);
        var target = ctx.session.dateFmt === 'iso' || ctx.session.dateFmt === 'dmy' || ctx.session.dateFmt === 'mdy' ? ctx.session.dateFmt : null;
        var sd = ctx.session.shiftMode === 'file' ? ctx.session.shiftDays : ctx.session.rowShift(rowIdx);
        return formatDate(addDays(dd, sd), dd.fmt, target);
      }
      case 'num': {
        var n = parseNumber(s);
        if (!n) return markUnparsed(ctx, col);
        if (p.numMode === 'noise') {
          var pct = Math.abs(parseFloat(p.noisePct)) || 0;
          var u = ctx.session.noise(rowIdx, col.idx);
          return fmtNumber(n.v * (1 + u * pct / 100), n.dec, n);
        }
        var rt = Math.abs(parseFloat(p.roundTo)) || 1;
        var rv = Math.round(n.v / rt) * rt;
        var rdec = rt >= 1 ? 0 : Math.min(10, (String(rt).split('.')[1] || '').length);
        return fmtNumber(rv, rdec, n);
      }
      case 'fixed':
        return String(p.fixedText == null ? '' : p.fixedText);
      case 'scrub':
        return scrubText(s, ctx, col.outName);
      default:
        return s;
    }
  }

  // The code column that restore uses to find each row's date shift: the first masked-with-code column
  // whose output is different in every row. Returns its index, or -1 when none fits.
  function pickAnchor(rows, codeColumns) {
    for (var a = 0; a < codeColumns.length; a++) {
      var ci = codeColumns[a], seen = new Set(), unique = true;
      for (var q = 0; q < rows.length; q++) {
        var tv = rows[q][ci];
        if (!tv || seen.has(tv)) { unique = false; break; }
        seen.add(tv);
      }
      if (unique) return ci;
    }
    return -1;
  }

  // ---------- k-anonymity ----------
  function kAnonymity(rows, qiIdx, k) {
    var groups = new Map();
    rows.forEach(function (r) {
      var key = qiIdx.map(function (i) { return r[i]; }).join('\u0001');
      groups.set(key, (groups.get(key) || 0) + 1);
    });
    var small = [], unique = 0, rowsBelow = 0, minSize = Infinity;
    groups.forEach(function (n, key) {
      if (n < minSize) minSize = n;
      if (n === 1) unique++;
      if (n < k) { rowsBelow += n; small.push({ values: key.split('\u0001'), n: n }); }
    });
    small.sort(function (a, b) { return a.n - b.n; });
    return { groups: groups.size, unique: unique, rowsBelow: rowsBelow, minSize: groups.size ? minSize : 0, small: small, k: k, total: rows.length };
  }

  // ---------- restore ----------
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function parseKeyRows(rows) {
    var key = new Map(), meta = {}, prefixes = new Set(), rowShifts = new Map();
    rows.forEach(function (r, i) {
      if (!r || !r.length) return;
      var a = String(r[0] || '').trim();
      if (!a) return;
      if (a === '#shift') { rowShifts.set(String(r[2] || '').trim().toUpperCase(), parseInt(r[1], 10)); return; }
      if (a.charAt(0) === '#') { meta[a.slice(1)] = r[1] == null ? '' : String(r[1]); return; }
      if (i === 0 && /^code$/i.test(a)) return;
      var tok = a.toUpperCase();
      key.set(tok, r[1] == null ? '' : String(r[1]));
      var pm = /^(.*)_[A-Z0-9]+$/.exec(tok);
      if (pm) prefixes.add(pm[1]);
    });
    return { key: key, meta: meta, rowShifts: rowShifts, prefixes: Array.from(prefixes).sort(function (a, b) { return b.length - a.length; }) };
  }
  function buildRestoreRe(k) {
    if (!k.prefixes.length) return null;
    return new RegExp('(?<![A-Za-z0-9_])(' + k.prefixes.map(escapeRe).join('|') + ')[_-]([A-Za-z0-9]+)(?![A-Za-z0-9_])', 'gi');
  }
  function restoreText(s, k, re, stats) {
    if (!re || !s) return s;
    return String(s).replace(re, function (m, p, id) {
      var t = p.toUpperCase() + '_' + id.toUpperCase();
      if (k.key.has(t)) { stats.replaced++; return k.key.get(t); }
      if (!/\d/.test(id)) return m;
      stats.unknown.add(m);
      return m;
    });
  }
  // Spreadsheet programs run cells that start with = or @ (and + or - before a letter) as formulas.
  function formulaSafe(v) {
    return typeof v === 'string' && /^(?:[=@]|[+-](?![\d.\s()+-]*$))/.test(v) ? "'" + v : v;
  }
  function stripFormulaGuard(v) {
    return typeof v === 'string' && /^'(?:[=@]|[+-](?![\d.\s()+-]*$))/.test(v) ? v.slice(1) : v;
  }

  // Restore a whole table. rows[0] is the header. Returns the new rows and what happened.
  function restoreRows(rows, k, re, opts) {
    var stats = { replaced: 0, unknown: new Set(), noOffset: 0, dateFails: 0, noDateCols: false };
    var header = rows[0] || [];
    var fileDays = parseInt(k.meta.shift_days, 10);
    var rowMode = k.meta.shift_mode === 'row';
    var dateOrder = k.meta.date_order === 'mdy' ? 'mdy' : 'dmy';
    var shiftNames = (k.meta.shifted_date_columns || '').split(' | ').filter(Boolean);
    var doDates = !!opts.dates && (rowMode ? k.rowShifts.size > 0 : !isNaN(fileDays));
    var unshiftCols = {}, anyShiftCol = false;
    var anchorIdx = rowMode && k.meta.anchor_column ? header.indexOf(k.meta.anchor_column) : -1;
    if (doDates) header.forEach(function (h, j) { if (shiftNames.indexOf(String(h)) >= 0) { unshiftCols[j] = 1; anyShiftCol = true; } });
    var out = rows.map(function (r, i) {
      var days = fileDays;
      if (i > 0 && doDates && rowMode) {
        var anc = anchorIdx >= 0 ? String(r[anchorIdx] || '').trim().toUpperCase() : 'ROW:' + i;
        days = k.rowShifts.get(anc);
        if (days === undefined) { days = NaN; if (anyShiftCol) stats.noOffset++; }
      }
      return r.map(function (v, j) {
        if (i === 0) return v;
        v = stripFormulaGuard(v);
        if (unshiftCols[j] && v !== '' && !isNaN(days)) {
          var u = unshiftDate(v, days, dateOrder);
          if (u !== null) return u;
          stats.dateFails++;
        }
        return formulaSafe(restoreText(v, k, re, stats));
      });
    });
    stats.noDateCols = doDates && !anyShiftCol;
    return { rows: out, stats: stats, doDates: doDates, rowMode: rowMode };
  }

  function unshiftDate(s, days, order) {
    var d = parseDate(s, false, null, order);
    if (!d) return null;
    return formatDate(addDays(d, -days), d.fmt, null);
  }

  root.DMLogic = {
    randUnit: randUnit, randomCode: randomCode, randomSample: randomSample, randomShiftDays: randomShiftDays,
    normalizeColumnName: normalizeColumnName, parseDate: parseDate, formatDate: formatDate, addDays: addDays,
    classifyColumn: classifyColumn, headerHint: headerHint, suggest: suggest, defaultParams: defaultParams, cleanPrefix: cleanPrefix,
    sanitizeValue: sanitizeValue, maskValue: maskValue, newContext: newContext, buildDict: buildDict,
    scrubText: scrubText, nameParts: nameParts, looksLikeData: looksLikeData, partialRevealsDate: partialRevealsDate,
    parseNumber: parseNumber, kAnonymity: kAnonymity, parseKeyRows: parseKeyRows,
    buildRestoreRe: buildRestoreRe, restoreText: restoreText, restoreRows: restoreRows, pickAnchor: pickAnchor, buildCodeOrder: buildCodeOrder,
    formulaSafe: formulaSafe,
    KIND_LABEL: KIND_LABEL, DEFAULT_PREFIX: DEFAULT_PREFIX
  };
})(typeof self !== 'undefined' ? self : globalThis);

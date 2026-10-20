const XLSX = require('../vendor/sheetjs/xlsx.full.min.js');
const fs0 = require('fs');
XLSX.readFile = (p, o) => XLSX.read(fs0.readFileSync(p), { type: 'buffer', ...o });
XLSX.writeFile = (wb, p, o) => fs0.writeFileSync(p, XLSX.write(wb, { type: 'buffer', ...o }));
const S = __dirname + '/../samples/';
fs0.mkdirSync(__dirname + '/fixtures', { recursive: true });
// XLS (BIFF8) copy of the sample workbook
const wb = XLSX.readFile(S + 'staff-list-sample.xlsx', { cellNF: true, cellDates: false });
XLSX.writeFile(wb, __dirname + '/fixtures/sample.xls', { bookType: 'biff8' });
// Serial dates stored as General numbers under a date header
const aoa = [['Full Name', 'Date of Birth', 'Hire Date', 'Salary']];
aoa.push(['Test One', 28125, 38346, 3000]);
aoa.push(['Test Two', 33000, 40000, 4500.5]);
aoa.push(['Test Three', 30000, 39000, '']);
const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb2 = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb2, ws, 'Data');
XLSX.writeFile(wb2, __dirname + '/fixtures/serial.xlsx');

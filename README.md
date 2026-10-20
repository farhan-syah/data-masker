# Data Masking Tool

Mask the personal data in a CSV or Excel file, then share it or use it with an AI tool. Everything runs in your browser. Nothing is uploaded.

![The column step: each card shows example values before and after masking](docs/screenshot.png)

## Quick start

1. Download `index.html` and open it in Chrome, Edge, Firefox or Safari. Or use the hosted page if you have one. No install, no account, no internet needed.
2. Press **Try a sample file**, or choose your own CSV or Excel file.
3. Check each column. Download the masked data. Keep the match file private.

The tool is one HTML file. A Content-Security-Policy blocks every network request, so the page cannot send your file anywhere, even when a web host serves it.

## Know what it misses

The tool suggests. You decide. Check every column before you share anything.

- It reads English column names. Names in other languages work only when the values look like names.
- Text in scripts without letter case (Chinese, Arabic, Thai and others) is flagged for you to check. Names inside it are masked when they match a name column.
- Month names must be English. Money must use a decimal point or the common decimal-comma formats.
- **Mask names in notes** finds names that appear in the name columns. It misses nicknames and other spellings. It masks first and last words of a name on their own, so a common word that is also a name can be masked by mistake.
- Masking lowers the risk. It does not change how your organisation classifies the file. Follow your organisation's rules.

## Supported files and browsers

- CSV, TSV and TXT in UTF-8, UTF-16 or another encoding you choose. Excel `.xlsx`, `.xlsm`, `.xlsb`, `.xls` and `.ods`.
- Open a file with the picker or by drag and drop. Choose the sheet and the header row. A file with no header row is supported.
- Dates in day-first or month-first order. The tool picks the order from your values. Change it under **Tidy and date options**.
- Chrome, Edge and Firefox (current versions), and Safari 16.4 or later.

## Steps

1. **Open file.** Choose a file, a sheet and the header row.
2. **Columns.** Choose **Mask**, **Remove** or **Keep** for each column. Each Mask card shows example values before and after masking. Open **Tidy and date options** to set the date order.
3. **Check & download.** Choose the rows and read the preview. Download the column names only, or the masked data (CSV or Excel). Then download the match file.
4. **Risk check.** Read the warnings. Fix every red one. Read each yellow one yourself.
5. **Restore names.** Put real values back into an AI answer with the match file.

The safest output is column names only. Next is a masked sample. Next is totals by group.

## Masking methods

| Method | What it does |
|---|---|
| Replace with code | One consistent code per distinct value, such as `PERSON_001`. Codes are numbered or random. Numbers are dealt out in random order, so a number never shows a row position. Codes ignore letter case, and the match file keeps the first spelling. The prefix is editable. Columns that share a prefix share codes. |
| Hide part | Keep the first or last N characters and star the rest. A red warning shows when a date keeps its month or day. A note shows on a national ID. |
| Change to a range or group | Date to year or age group. Number to a range. Text to its first N characters. Address to its last part, such as the country. |
| Shift dates | Each row shifts by its own random number of days, and intervals within a row stay exact. One shift for the whole file is the other choice. Offsets run 30 to 730 days back. |
| Round or adjust numbers | Round to a step, or change by a small random amount within a percentage. |
| Replace with fixed text | Default `[REMOVED]`. |
| Mask names in notes | Replace names from name columns with their codes. ID numbers, emails, and phone numbers become `[ID NO]`, `[EMAIL]`, and `[PHONE]`. |

The tool suggests a state and a method for each column from English header names and from value patterns. Check every suggestion.

## What the tool recognises

| Kind | Header words and value patterns |
|---|---|
| Person name | `name`, `full name`, `supervisor`. Two or more capitalised words. |
| National ID | `national id`, `SSN`, `passport`, `tax id`. Values such as `123-45-6789`. |
| Reference ID | `employee id`, `customer no`, `patient code`. |
| Email | `email`, `mail`. Values with `@`. |
| Phone | `phone`, `mobile`, `fax`. Values with 7 to 15 digits and a `+`, bracket, space, dot or dash. |
| Address | `address`, `street`, `zip`, `postcode`. A street word or a postcode. |
| Date | `date`, `dob`, `birth`. `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`, `25 Dec 2004`, `December 25, 2004`. |
| Money | `salary`, `amount`, `price`. A symbol or a three-letter currency code, such as `$1,250.00` or `EUR 900.50`. |
| Notes | `notes`, `comments`, `description`. Long text. |

Other languages work as long as the column holds one of these value patterns. Month names must be English.

## Match file

The match file maps each code to the real value. It also holds the date-shift data. The tool names it `MATCH-FILE-<run>-<stamp>-KEEP-ON-THIS-PC.csv`. The masked files carry the same four-character run ID, so you can pair them. The match file always fits the masked data you downloaded last, even when you change settings afterwards.

Format: a CSV with the header `code,original_value,column`. Rows that start with `#` hold settings: `#warning`, `#source_file`, `#generated`, `#run_id`, `#shift_mode` (`row` or `file`), `#shifted_date_columns`, `#date_order` (`dmy` or `mdy`), `#shift_days`, `#anchor_column`. Each `#shift` row holds one row's shift in days and its anchor code.

**Privacy warning:** the match file contains the real personal data. Anyone who has it can undo the masking.

- Keep it on your computer.
- Never upload it. Never send it to an AI tool.
- Do not open and save it in Excel. Excel can change long numbers and leading zeros.
- A dialog asks you to tick a box before the download starts.
- The page warns before you close it when you downloaded masked data but not the match file.

**Restore names** reads the match file, then replaces codes in pasted text or in a CSV or Excel file. Matching ignores case and accepts `_` or `-`. Any prefix in the match file works.

## Limits

- Detection is a suggestion. You must check every column.
- **Mask names in notes** finds only names from the file's name columns, plus ID, email, and phone patterns. It misses nicknames, other spellings, and other personal details.
- A first name found alone in a note becomes `[NAME]`. Restore cannot return it. Common first names that are also words can match.
- Restore returns shifted dates only in CSV or XLSX files. Pasted text keeps shifted dates. In per-row mode, the file must keep the anchor column named in the match file, or the original row order.
- Ambiguous dates such as 03/04/2020 are read in the order set under Tidy and date options. Two-digit years pivot on the current year. Age groups use today's date.
- Month names must be English. Other languages need numeric dates. A value that cannot be read becomes `[?]`, and the page counts them.
- National ID shapes in notes: `123-45-6789`, `123456-12-1234`, UK National Insurance numbers, IBANs and long digit runs. Other shapes stay.
- A masked or restored value that a spreadsheet could run as a formula (it starts with `=` or `@`, or with `+` or `-` before a letter) gets a leading apostrophe.
- The tool does not recalculate Excel formulas. It reads stored cell values. Password-protected workbooks do not open.
- Numbers keep the decimal places of their Excel number format, without thousands separators.
- Restore treats any `PREFIX_XXX` word whose prefix is in the match file as a code. A real word with that shape changes only if the match file holds it.
- The XLSX export has no cell styling. SheetJS Community Edition does not write styles.
- Masking lowers risk. It does not change how your organisation classifies the file. Follow your organisation's rules before you share data.
- Tested in headless Chromium on Linux. Firefox, Safari, Windows and a real GitHub Pages host are not tested.

## Build and test

Requirements: Python 3 and Node.js.

```sh
npm install
npx playwright install chromium
npm run build
npm test
```

- `npm run build` runs `python3 build.py`. It inlines `src/` and the vendored SheetJS into `index.html`. It writes the version from `package.json` into the page. Pass an output path to write elsewhere: `python3 build.py out.html`. Commit the rebuilt `index.html` with every change to `src/`.
- Tests use the Chromium that Playwright installs. Set `CHROMIUM_PATH` to use a system browser, for example `CHROMIUM_PATH=/usr/bin/chromium npm test`.
- `npm test` rebuilds the fixtures, then runs two tests: `tests/logic.test.mjs` (Node only, no browser) and `tests/e2e.mjs` (one browser run). The browser test blocks the network and logs every request. It checks that nothing leaves the page, that no original value reaches a download, that the match file fits the masked data, and that restore returns the real values.
- Downloads and screenshots go to `tests/out/`, which git ignores.
- `samples/` holds fictional data only. `python3 tests/make_samples.py samples` rebuilds it (needs `openpyxl`). `tests/make_fixtures.cjs` rebuilds `sample.xls` and `serial.xlsx` in `tests/fixtures/`, which git ignores.

See `CONTRIBUTING.md` before you open a pull request.

## Third-party notice

The tool inlines SheetJS Community Edition 0.20.3 (`xlsx.full.min.js`), licensed under Apache-2.0. Source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz. The licence text is in `vendor/sheetjs/LICENSE`.

## Licence

MIT. See `LICENSE`.

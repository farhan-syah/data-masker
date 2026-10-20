"""Generate fictional staff lists for the data-masker tool.

Every value is invented. National IDs use area numbers 900 to 999, which the US
never issues. Emails use example.com. Phone numbers use ranges that carriers
reserve for fiction. Names and addresses are made up. Dates use MM/DD/YYYY, so
the tool must detect the date order.

Usage: python3 tests/make_samples.py samples
"""
import csv
import datetime as dt
import random
import sys
import unicodedata
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
rng = random.Random(20261023)

FIRST = ["Maria", "Liam", "Aisha", "Wei", "Priya", "Lars", "Olga", "Chinedu", "Sofia", "Hiroshi",
         "Fatima", "Noah", "Elena", "Mateo", "Amara", "Jin", "Isabella", "Omar", "Hannah", "Diego",
         "Yuki", "Grace", "Ahmed", "Chloe", "Rajesh", "Zoë", "Sven", "Ngozi", "Tariq", "Camille"]
LAST = ["Garcia", "Murphy", "Khan", "Zhang", "Sharma", "Andersson", "Ivanova", "Okafor", "Rossi", "Tanaka",
        "Al-Farsi", "Johnson", "Petrov", "Hernández", "Mensah", "Park", "Silva", "Haddad", "Müller", "Costa",
        "Nakamura", "Brown", "Hassan", "Dubois", "Patel", "O'Connor", "Nielsen", "Adeyemi", "Qureshi", "Laurent"]

JOBS = [
    ("Software Engineer", ["L3", "L4", "L5"]),
    ("Data Analyst", ["L2", "L3"]),
    ("Accountant", ["L2", "L3", "L4"]),
    ("HR Generalist", ["L2", "L3"]),
    ("Operations Manager", ["L5", "L6"]),
    ("Support Specialist", ["L1", "L2"]),
    ("Internal Auditor", ["L3", "L4"]),
    ("Administrative Assistant", ["L1"]),
]
DEPARTMENTS = ["Finance", "Engineering", "Human Resources", "Operations", "Customer Support", "Internal Audit",
               "Legal", "Marketing"]
SALARY = {"1": (28000, 42000), "2": (36000, 58000), "3": (48000, 78000), "4": (62000, 98000),
          "5": (80000, 125000), "6": (105000, 160000)}
STREETS = ["Oak Street", "Maple Avenue", "Park Road", "High Street", "Cedar Lane", "Lake Drive",
           "Sunset Boulevard", "Mill Road", "Station Road", "Elm Court"]
PLACES = [
    ("us", "Springfield", "IL", "62704"), ("us", "Riverton", "UT", "84065"), ("us", "Fairview", "OR", "97024"),
    ("uk", "Bristol", None, "BS1 4DJ"), ("uk", "Leeds", None, "LS1 4AP"),
    ("ca", "Kingston", "ON", "K7L 3N6"), ("au", "Newcastle", "NSW", "2300"),
    ("de", "Bremen", None, "28195"),
]


def ascii_name(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def make_phone():
    kind = rng.choice(["us", "uk", "au"])
    if kind == "us":
        return f"+1 555 010 {rng.randint(1000, 9999)}"
    if kind == "uk":
        return f"+44 7700 900{rng.randint(100, 999)}"
    return f"+61 491 570 {rng.randint(100, 999)}"


def make_address():
    kind, city, region, code = rng.choice(PLACES)
    n = rng.randint(1, 240)
    street = rng.choice(STREETS)
    if kind == "us":
        return f"{n} {street}, {city}, {region} {code}, USA"
    if kind == "uk":
        return f"{n} {street}, {city}, {code}, United Kingdom"
    if kind == "ca":
        return f"{n} {street}, {city}, {region} {code}, Canada"
    if kind == "au":
        return f"{n} {street}, {city} {region} {code}, Australia"
    return f"Hauptstrasse {n}, {code} {city}, Germany"


def fmt_date(d):
    return d.strftime("%m/%d/%Y")


rows = []
names = set()
while len(rows) < 60:
    name = f"{rng.choice(FIRST)} {rng.choice(LAST)}"
    if name in names:
        continue
    names.add(name)
    gender = rng.choice(["M", "F"])
    born = dt.date(1968, 1, 1) + dt.timedelta(days=rng.randint(0, 365 * 32))
    hired = dt.date(max(born.year + 22, 1992), 1, 1) + dt.timedelta(days=rng.randint(0, 3000))
    if hired > dt.date(2025, 12, 31):
        hired = dt.date(2025, rng.randint(1, 12), rng.randint(1, 28))
    job, grades = rng.choice(JOBS)
    grade = rng.choice(grades)
    lo, hi = SALARY[grade[1:]]
    first, last = name.split(" ", 1)
    n = len(rows) + 1
    rows.append({
        "Employee ID": f"E{1000 + n}",
        "Full Name": name,
        "National ID": f"9{rng.randint(10, 99)}-{rng.randint(10, 99)}-{rng.randint(1000, 9999)}",
        "Gender": gender,
        "Job Title": job,
        "Grade": grade,
        "Department": rng.choice(DEPARTMENTS),
        "Date of Birth": born,
        "Hire Date": hired,
        "Email": f"{ascii_name(first)}.{ascii_name(last).replace(chr(39), '').replace('-', '')}{n:02d}@example.com",
        "Phone": make_phone(),
        "Address": make_address(),
        "Salary": round(rng.uniform(lo, hi), 2),
        "Notes": "",
    })

# Free-text notes, some of which name another employee or carry contact data.
NOTES = [
    "On part-time leave until the end of the year.",
    "Seconded to the Operations team for six months.",
    "Waiting for the probation review.",
    "Attended the onboarding course in March.",
    "", "",
    "Currently on probation.",
]
for idx, r in enumerate(rows):
    roll = idx % 9
    if roll == 0:
        other = rows[(idx + 7) % len(rows)]["Full Name"]
        r["Notes"] = f"Covering for {other} as meeting coordinator."
    elif roll == 3:
        other = rows[(idx + 11) % len(rows)]["Full Name"]
        r["Notes"] = f"Supervisor: {other}. Performance review complete."
    elif roll == 5:
        r["Notes"] = f"Call personal number {r['Phone']} if urgent."
    elif roll == 7:
        r["Notes"] = f"Copy of ID {r['National ID']} not yet updated in file."
    else:
        r["Notes"] = rng.choice(NOTES)

headers = list(rows[0].keys())


def cell(h, v):
    if isinstance(v, dt.date):
        return fmt_date(v)
    if isinstance(v, float):
        return f"{v:.2f}"
    return v


with open(OUT / "staff-list-sample.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f, lineterminator="\r\n")
    w.writerow(headers)
    for r in rows:
        w.writerow([cell(h, r[h]) for h in headers])

wb = Workbook()
ws = wb.active
ws.title = "Staff List"
ws.append(["Staff list (FICTIONAL TRAINING DATA)"])
ws["A1"].font = Font(bold=True)
ws.append(headers)
for c in ws[2]:
    c.font = Font(bold=True)
for r in rows:
    ws.append([r[h] for h in headers])
for row in ws.iter_rows(min_row=3):
    for c in row:
        h = headers[c.column - 1]
        if h in ("Date of Birth", "Hire Date"):
            c.number_format = "mm/dd/yyyy"
        elif h == "Salary":
            c.number_format = "#,##0.00"
for col, width in zip("ABCDEFGHIJKLMN", [12, 24, 14, 8, 26, 7, 18, 14, 12, 34, 18, 52, 12, 50]):
    ws.column_dimensions[col].width = width
info = wb.create_sheet("About")
info.append(["FICTIONAL TRAINING DATA. No record stands for a real person."])
info.append(["All names, national IDs, emails, phone numbers and addresses in this file are invented."])
info.append(["National IDs use area numbers 900 to 999, which are never issued."])
wb.save(OUT / "staff-list-sample.xlsx")

# Small sample for the step-by-step walkthrough: 8 rows, 8 columns.
SMALL_HEAD = ["Full Name", "National ID", "Grade", "Department", "Date of Birth", "Hire Date", "Salary", "Notes"]
SMALL = [
    ["Maria Garcia", "912-34-5124", "L4", "Finance", "04/12/1988", "07/01/2014", "4120.00", "Parental leave until 11/30/2026"],
    ["Liam Murphy", "923-45-6031", "L5", "Operations", "09/23/1979", "03/15/2005", "5300.00", ""],
    ["Aisha Khan", "934-56-5302", "L1", "Operations", "01/17/1995", "05/02/2019", "2050.00", "Covering for Liam Murphy while on a course"],
    ["Wei Zhang", "945-67-5468", "L3", "Finance", "06/05/1990", "10/01/2016", "2480.00", ""],
    ["Priya Sharma", "956-78-5599", "L4", "Finance", "11/30/1985", "08/19/2011", "3890.50", "Team lead. Call +1 555 010 4477 if urgent"],
    ["Lars Andersson", "967-89-5712", "L2", "Operations", "02/14/1992", "06/01/2018", "2975.25", ""],
    ["Olga Ivanova", "978-90-5820", "L5", "Finance", "12/01/1975", "09/12/2001", "6100.00", "Supervisor: Maria Garcia"],
    ["Chinedu Okafor", "989-01-5931", "L3", "Operations", "10/09/1983", "04/18/2012", "3320.00", ""],
]
with open(OUT / "staff-list-small.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f, lineterminator="\r\n")
    w.writerow(SMALL_HEAD)
    w.writerows(SMALL)
wb2 = Workbook()
s1 = wb2.active
s1.title = "Staff"
s1.append(SMALL_HEAD)
for c in s1[1]:
    c.font = Font(bold=True)
for r in SMALL:
    month, day, year = (int(x) for x in r[4].split("/"))
    hm, hd, hy = (int(x) for x in r[5].split("/"))
    s1.append([r[0], r[1], r[2], r[3], dt.date(year, month, day), dt.date(hy, hm, hd), float(r[6]), r[7]])
for row in s1.iter_rows(min_row=2):
    row[4].number_format = "yyyy-mm-dd"
    row[5].number_format = "yyyy-mm-dd"
    row[6].number_format = "#,##0.00"
s2 = wb2.create_sheet("About")
s2.append(["FICTIONAL TRAINING DATA. No record stands for a real person."])
wb2.save(OUT / "staff-list-small.xlsx")
print(len(rows), "rows written")

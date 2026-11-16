#!/usr/bin/env python3
"""A GVH Árfigyelő napi Exceljét tömör JSON-ná alakítja a Csipogó árellenőrző appnak.
Használat: arlista.py be.xlsx ki.json"""
import sys, json, datetime
from openpyxl import load_workbook

def cell(v):
    if v is None:
        return ""
    if isinstance(v, float):
        return int(v) if v == int(v) else round(v, 2)
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.isoformat()[:10]
    if isinstance(v, str):
        return v.strip()
    return v

wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
best = []
for ws in wb.worksheets:
    rows = []
    for r in ws.iter_rows(values_only=True):
        r = [cell(v) for v in r]
        while r and r[-1] == "":
            r.pop()
        if r:
            rows.append(r)
    if len(rows) > len(best):
        best = rows
if len(best) < 2:
    sys.exit("Üres az Excel")
out = {"date": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"), "aoa": best}
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(len(best), "sor")

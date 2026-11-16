#!/usr/bin/env python3
"""A GVH Árfigyelő napi Exceljét tömör JSON-ná alakítja a Csipogó árellenőrző appnak.
Használat: arlista.py be.xlsx ki.json

Kimenet: {"date", "chains":[lánc nevek], "p":{kód:[név, kategória, egység, kiszerelés,
          [[láncIndex, minÁr, maxÁr, minEgységár, maxEgységár, boltban, összesBolt], ...], hányLáncban]}}
A kód a vonalkód kezdő nullák nélkül (vagy a lánc saját azonosítója kisbetűvel)."""
import sys, json, datetime
from openpyxl import load_workbook

COLS = {"code": "Termék azonosító", "name": "Termék név", "cat": "Kategória név", "chain": "Üzletlánc név",
        "unit": "Egység", "pack": "Kiszerelés", "min": "Minimum ár", "max": "Maximum ár",
        "umin": "Minimum egységár", "umax": "Maximum egységár", "nchains": "Hány üzletláncban elérhető",
        "nshops": "Hány boltban elérhető", "allshops": "Üzletlánc összes boltja"}

def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        f = float(v)
    else:
        s = str(v).replace(" ", "").replace(" ", "")
        if "," in s:
            s = s.replace(".", "").replace(",", ".")
        try:
            f = float(s)
        except ValueError:
            return None
    return int(f) if f == int(f) else round(f, 2)

def key(v):
    s = str(v).strip()
    if s.isdigit():
        return s.lstrip("0") or "0"
    return s.lower()

wb = load_workbook(sys.argv[1], read_only=True, data_only=True)
rows = max(([list(r) for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets), key=len)
hi = next(i for i, r in enumerate(rows[:30]) if r and COLS["code"] in [str(c).strip() if c is not None else "" for c in r])
head = [str(c).strip() if c is not None else "" for c in rows[hi]]
ix = {k: head.index(v) if v in head else None for k, v in COLS.items()}
missing = [COLS[k] for k in ("code", "name", "min") if ix[k] is None]
if missing:
    sys.exit("Hiányzó oszlop: " + ", ".join(missing) + " | fejléc: " + repr(head))

def g(r, k):
    i = ix[k]
    return r[i] if i is not None and i < len(r) and r[i] is not None else ""

chains, p = [], {}
for r in rows[hi + 1:]:
    if not r or g(r, "code") == "":
        continue
    k = key(g(r, "code"))
    ch = str(g(r, "chain")).strip()
    if ch not in chains:
        chains.append(ch)
    offer = [chains.index(ch), num(g(r, "min")), num(g(r, "max")), num(g(r, "umin")), num(g(r, "umax")),
             num(g(r, "nshops")), num(g(r, "allshops"))]
    if k not in p:
        p[k] = [str(g(r, "name")).strip(), str(g(r, "cat")).strip(), str(g(r, "unit")).strip(),
                num(g(r, "pack")), [], num(g(r, "nchains"))]
    p[k][4].append(offer)
if len(p) < 100:
    sys.exit("Gyanúsan kevés termék: %d" % len(p))
out = {"date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "chains": chains, "p": p}
with open(sys.argv[2], "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
print(len(p), "termék,", len(chains), "lánc")

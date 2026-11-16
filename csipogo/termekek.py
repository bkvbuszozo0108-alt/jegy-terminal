#!/usr/bin/env python3
"""Magyar termék-adatbázis a Csipogó árellenőrző appnak az Open Food Facts nyílt adataiból.
A szabványos bemenetről olvassa a (kicsomagolt) OFF CSV exportot, és a kimeneti mappába 100 kis fájlt ír
(a vonalkód utolsó két számjegye szerint): {kód: [név, márka, kiszerelés]}.
Bekerül: ami Magyarországon kapható (countries: Hungary), vagy magyar (599-es) vonalkódú.
Használat: gunzip -c export.csv.gz | termekek.py kimeneti_mappa   (többször futtatható, összefésül)"""
import sys, csv, json, os, datetime

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
csv.field_size_limit(1 << 30)
shards = {}
for f in os.listdir(out):
    if len(f) == 7 and f.endswith(".json") and f[:2].isdigit():
        shards[f[:2]] = json.load(open(os.path.join(out, f), encoding="utf-8"))

rd = csv.reader(sys.stdin, delimiter="\t", quoting=csv.QUOTE_NONE)
head = next(rd)
col = {n: i for i, n in enumerate(head)}
def pick(*names):
    for n in names:
        if n in col:
            return col[n]
    return None
ci = [pick("code"), pick("product_name", "generic_name"), pick("brands", "brands_en", "brands_tags"), pick("quantity")]
if ci[0] is None or ci[1] is None:
    sys.exit("Hiányzó oszlop (code / product_name); fejléc: " + ", ".join(head[:40]))
cc = [col[n] for n in ("countries_tags", "countries_en", "countries") if n in col]
added = seen = 0
for r in rd:
    seen += 1
    if len(r) <= ci[1]:
        continue
    code = r[ci[0]].strip()
    if not code.isdigit() or not (6 <= len(code) <= 14):
        continue
    hu = code.lstrip("0").startswith("599") or any(i < len(r) and "hungary" in r[i].lower() for i in cc)
    if not hu:
        continue
    name, brand, qty = ((r[i].strip()[:120] if i is not None and i < len(r) else "") for i in ci[1:])
    brand = brand.replace("en:", "").replace("-", " ") if "brands" not in col else brand
    if not name and not brand:
        continue
    key = code.lstrip("0") or "0"
    sh = key[-2:].zfill(2)
    d = shards.setdefault(sh, {})
    if key not in d:
        added += 1
    d[key] = [name, brand.split(",")[0].strip(), qty]

total = 0
for i in range(100):
    sh = "%02d" % i
    d = shards.get(sh, {})
    total += len(d)
    with open(os.path.join(out, sh + ".json"), "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as f:
    json.dump({"date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d"), "count": total}, f)
print(seen, "sor átnézve,", added, "új,", total, "termék összesen")

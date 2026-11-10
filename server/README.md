# Jegyterminál – központi szerver

Egy gépen fut (Windows / Mac / Linux), a terminálok Wi-Fi-n beküldik a beolvasásokat, te böngészőben nézed.

## Indítás
1. Telepítsd a Node.js-t (LTS): https://nodejs.org
2. Töltsd le ezt a repót (Code → Download ZIP), csomagold ki.
3. A `server` mappában: Windows → **start.bat** dupla katt; Mac/Linux → `./start.sh`
4. A fekete ablak kiírja a címet és a **kulcsot** (a `config.json`-ban is megtalálod, átírhatod).

## Terminál beállítása
Terminál → Beállítások → **Szerver címe**: `http://<gép-ip>:8787` (az ablak kiírja) + **Szerver kulcs**.
Onnantól minden beolvasás bemegy, offline-ban sorban áll, és a szerver jelzi, ha egy jegyet másik terminálon már felhasználtak.

## Vezérlőpult
`http://localhost:8787/` a gépen, vagy `http://<gép-ip>:8787/` bárhonnan a hálózaton. Élő lista, napi/terminálonkénti számok, keresés, CSV export.

## Ha a terminál a GitHub Pages-ről (https) fut
A böngésző alapból nem engedi, hogy https oldal http szerverhez kapcsolódjon. Megoldások:
- Zebra / launcher app: engedi (be van állítva).
- Chrome Androidon: a lakat ikon → Engedélyek → „Nem biztonságos tartalom” → Engedélyez.
- Vagy a terminált a szerverről nyisd: `http://<gép-ip>:8787/terminal/` (ez eleve ugyanaz az oldal, azonos címről → nincs tiltás; kamera itt nem megy, csak a hardveres szkenner).

Adatok: `server/data/scans.jsonl` (soronként egy esemény, bármikor menthető).

# Webes szerver Google Táblázatban (nem kell saját gép)

Minden beolvasás egy Google Táblázatba kerül, és kapsz egy webcímet, ami egyben a terminálok szervere és a vezérlőpult. Ingyenes, https, mobilneten is megy.

## Beállítás (egyszer, kb. 5 perc)
1. Nyiss egy új Google Táblázatot: **sheets.new** – nevezd el (pl. „Jegyterminál”).
2. Felül: **Bővítmények → Apps Script**. Töröld, ami a szerkesztőben van, és másold be a `Code.gs` teljes tartalmát.
3. A 3. sorban írd át a kulcsot: `var KULCS = 'sajat-kulcs-123';`  → Mentés (💾).
4. Jobb felül **Telepítés → Új telepítés** → fogaskerék → **Webalkalmazás**:
   - Futtatás: **Én**
   - Hozzáférés: **Bárki**
   → Telepítés. (Első alkalommal engedélyt kér: Engedélyek áttekintése → saját fiók → „Speciális” → „Ugrás a … (nem biztonságos)” → Engedélyezés. Ez a saját scripted, csak a Google figyelmeztet.)
5. Másold ki a **Webalkalmazás URL-jét** (…/exec végű).

## Terminálok
Beállítások → **Szerver címe** = az …/exec cím, **Szerver kulcs** = amit a 3. lépésben írtál → Mentés. Kész: minden beolvasás bemegy, és egy másik terminálon már felhasznált jegyet jelzi.

## Előzmények
- **Vezérlőpult:** nyisd meg az …/exec címet böngészőben, írd be a kulcsot → élő lista, mai számok, terminálonként, keresés (10 mp-enként frissül).
- **Teljes lista, szűrés, export:** maga a Google Táblázat („Beolvasasok” fül) – bárhonnan, telefonról is.

## Ha módosítod a Code.gs-t
Telepítés → Telepítések kezelése → ceruza → Verzió: **Új** → Telepítés (a cím nem változik).

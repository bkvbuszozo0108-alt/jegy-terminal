# Járműnapló – szerver Google Táblázatban

Ez kérdezi le a BKK FUTÁR-t, gyűjti a járműveket, és tárolja a szolgálatokat, bejegyzéseket és fotókat. Ingyenes, nem kell hozzá saját gép.

## Beállítás (egyszer, kb. 5 perc)
1. Nyiss egy új Google Táblázatot: **sheets.new** – nevezd el „Járműnapló”-nak.
2. **Bővítmények → Apps Script**. Töröld, ami a szerkesztőben van, és másold be a `Code.gs` teljes tartalmát.
3. Az elején írd át a két sort:
   - `var KULCS = '...'` → saját jelszó, ezt írod be a telefonon az appba,
   - `var BKK_KULCS = '...'` → a BKK opendata API-kulcsod.
   Mentés (💾).
4. Felül a függvényválasztóban válaszd a **telepites** függvényt → **Futtatás**. Engedélyt kér (Engedélyek áttekintése → saját fiók → „Speciális” → „Ugrás a … projektre” → Engedélyezés). Ez létrehozza a lapokat, és bekapcsolja a 10 percenkénti járműgyűjtést.
5. Jobb felül **Telepítés → Új telepítés** → fogaskerék → **Webalkalmazás**:
   - Futtatás: **Én**
   - Hozzáférés: **Bárki**
   → Telepítés. Másold ki a **Webalkalmazás URL-jét** (…/exec végű).

## Az app
Nyisd meg: https://bkvbuszozo0108-alt.github.io/jegy-terminal/jarmunaplo/
Beállítások → **Szerver címe** = az …/exec cím, **Kulcs** = amit a 3. lépésben írtál → **Kapcsolat tesztelése**.

## Hol vannak az adatok
- **Jarmuvek** lap: minden jármű, amit a rendszer valaha forgalomban látott (rendszám, típus, utolsó járat). A „Pályaszám (kézi)” oszlopot te is kitöltheted.
- **Bejegyzesek** lap: jegyzetek, baleset, sérülés stb.
- **Szolgalat** lap: ki, mikor kezdett és fejezett be.
- **Fotók:** Google Drive → „Járműnapló fotók” mappa. Nem nyilvánosak, az app a kulccsal kéri le őket.

## Ha módosítod a Code.gs-t
Telepítés → Telepítések kezelése → ceruza → Verzió: **Új** → Telepítés (a cím nem változik).

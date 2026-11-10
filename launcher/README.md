# Jegyterminál – Android launcher

Kezdőképernyő-app: bekapcsolás után a jegyterminál fut teljes képernyőn, de minden más app (Google, Chrome, Beállítások…) elérhető az alsó fogantyúból – mint egy rendes Androidon, csak a terminál van „elöl”.

**APK letöltés:** a repó *Releases* oldalán, „launcher” címke → `jegyterminal-launcher.apk` (minden `launcher/` módosításnál a GitHub automatikusan újrafordítja).

## Telepítés
1. APK a telefonra (Chrome-ból letöltve) → telepítés (engedélyezd az „ismeretlen forrás”-t, ha kéri).
2. Nyomd meg a **Home** gombot → „Jegyterminál” → **Mindig**. Innentől ez a kezdőképernyő.
3. Első indításkor kamera-engedély (kamerás telefonon). Zebrán automatikusan létrejön a *JegyTerminal* DataWedge-profil: az oldalsó gomb egyből a terminálba olvas.

## Használat
- **Alsó fogantyú** (vagy felhúzás a képernyő aljáról): alkalmazás-fiók, kereséssel.
- **Fogantyú hosszan + PIN** (alap 0000): terminál címe, PIN, újratöltés, kioszk feloldása.
- **Vissza gomb**: a terminálból nem lép ki.

## Kioszk (Lock Task) mód – opcionális, a legerősebb zár
Gépről, USB-n, friss (fiók nélküli) eszközön:
```
adb shell dpm set-device-owner hu.jegyterminal.launcher/.AdminReceiver
```
Ettől a terminál rögzítve fut, csak a beállításokból (PIN) oldható fel. Visszavonás: `adb shell dpm remove-active-admin hu.jegyterminal.launcher/.AdminReceiver`.

# OKgram

OKgram je prohlížeč fotek a videí. Knihovna je buď ve složce `OKgram` na vašem Google Disku, nebo ve složce v počítači. Je napsaný v **React + TypeScript** a běží v **Electronu** na Windows, Linuxu i macOS ze stejného kódu. Vypadá a nastavuje se stejně jako OKpass a OKfetch.

Popis pro uživatele je v [README o složku výš](../README.md) a v aplikaci pod **?**. Tenhle soubor je pro vývojáře.

## Požadavky

- [Node.js](https://nodejs.org) 20 nebo novější
- pro Google Disk vlastní OAuth klient z Google Cloud (`client_secret.json`, typ **Desktop app**), viz [Google Disk](#google-disk)

## Spuštění ze zdrojových souborů

```bash
npm install
npm run dev
```

Nebo `run.bat` (Windows) či `./run.sh` (Linux, macOS): při prvním spuštění nainstalují závislosti a pak spustí aplikaci.

UI s ukázkovými daty v obyčejném prohlížeči, bez Electronu a bez účtu (náhrada `api.ts` v `tests/preview/`):

```bash
npm run preview:ui
```

Pak otevřete `http://localhost:4790`. Parametry `?welcome` (úvodní obrazovka) a `?drive` (režim Disku).

## Testy

```bash
npm run typecheck
npm test
npm run smoke
```

- `npm test` (vitest): model dat a slučování, filtry a řazení, rozměry obrázků a EXIF, Google Drive REST proti napodobenině API (stránkování, nahrávání po částech s obnovou, opakování při 429/503, obnova tokenu), lokální knihovna a controller nad dočasnou složkou, úplnost překladů.
- `npm run smoke`: sestaví aplikaci a projde ji přes Playwright + Electron (lokální knihovna v dočasné složce, snímky obrazovky do `tests/smoke/output`). Na počítači, kde Windows App Control blokuje nepodepsané programy, se Electron nespustí.

## Instalátory

| Systém | Příkaz | Výstup v `dist/` |
|---|---|---|
| Windows | `npm run dist:win` | `OKgram-Setup-<verze>.exe` |
| Linux | `npm run dist:linux` | `OKgram-<verze>.AppImage` |
| macOS | `npm run dist:mac` (jen na Macu) | `OKgram-<verze>.dmg` |

Instalátory nejsou podepsané (SmartScreen: „Další informace → Přesto spustit“, macOS: pravé tlačítko → Otevřít, Linux: `chmod +x`).

## Zdroje

Knihovna se skládá ze **zdrojů** v panelu vpravo: libovolný počet lokálních složek a Google účtů (i víc účtů najednou). Každý zdroj má název, ikonu, barvu a zaškrtnutí, které filtruje zobrazení. Nahrávání při více zaškrtnutých zdrojích se zeptá, kam soubory uložit. Seznam zdrojů je v `settings.json` počítače (cesty jsou místní), každý Google účet má vlastní token v `tokens/<id zdroje>.bin`.

Starší nastavení s jedním úložištěm se při spuštění převede na jeden zdroj (i s přihlášením).

### Google Disk

Aplikace přibaluje vlastní OAuth klienta `resources/client_secret.json` (typ Desktop app, publikovaný). Uživatel ho nevybírá, jen se přihlásí. Vlastní `client_secret.json` vybraný v aplikaci má přednost. U klienta typu Desktop app Google nepovažuje secret za tajný, proto smí být v instalátoru.

Vlastní klient:

1. V [Google Cloud Console](https://console.cloud.google.com) vytvořte projekt (nebo použijte projekt OKpass) a zapněte **Google Drive API**.
2. **Google Auth Platform**: Branding, Audience **External**, Data Access se scope `.../auth/drive.file`.
3. **Clients → Create client → Desktop app** a stáhněte JSON.
4. V OKgram: *Google Disk → Vybrat client_secret.json… → Přihlásit se přes Google*.

V režimu *Testing* musí být účet v *Test users* a přihlášení vyprší po 7 dnech. Pro trvalé přihlášení aplikaci publikujte (*Audience → Publish app*). Scope `drive.file` není citlivý.

Na Disku vznikne složka **OKgram**: fotky a videa přímo v ní, alba, hvězdičky, rámečky, uživatelské jméno a nastavení v `okgram.json`. Kvůli `drive.file` aplikace vidí jen soubory, které sama nahrála. Soubory nahrané do složky přes web Disku nevidí.

### Lokální složka

Libovolná složka (výchozí `Obrázky/OKgram`). OKgram ukáže podporované soubory ve složce a podsložkách (kromě skrytých) a změny ve složce sleduje. `okgram.json` je přímo ve složce, takže alba putují se složkou (např. přes Syncthing nebo síťový disk). Mazání přesouvá do systémového koše.

## Kde jsou soubory

| | Nastavení, `client_secret.json`, přihlášení, `logs/okgram.log` | Miniatury, offline kopie |
|---|---|---|
| Windows | `%APPDATA%\OKgram` | `%LOCALAPPDATA%\OKgram\cache` |
| Linux | `~/.config/okgram` | `~/.cache/okgram` |
| macOS | `~/Library/Application Support/OKgram` | `~/Library/Caches/OKgram` |

Přihlášení (refresh token) je zašifrované systémovým úložištěm klíčů přes Electron `safeStorage` (Windows DPAPI, macOS Keychain, Linux Secret Service) v `token.bin`. Kde systém úložiště klíčů nemá, je v `token.json` s právy 600.

| Proměnná | Význam |
|---|---|
| `OKGRAM_CONFIG_DIR` | složka s nastavením a přihlášením |
| `OKGRAM_CACHE_DIR` | složka s miniaturami a offline kopií |

## Formáty

- Fotky: PNG, JPG, JPEG, GIF, SVG. Videa: MP4, MOV, MKV, AVI, WEBM.
- Přehrávač je Chromium: MP4/MOV s H.264, WEBM (VP8/VP9/AV1) a většina MKV hrají přímo. AVI a staré kodeky ne. Prohlížeč pak nabídne systémový přehrávač (soubor z Disku se nejdřív stáhne do dočasné složky).

## Struktura projektu

```
src/shared/          typy a kontrakt IPC, model dat (alba, operace, slučování), filtry a řazení, formáty, témata
src/core/            bez Electronu (testovatelné): Google Drive REST, chyby, rozměry obrázků a EXIF, Range, nastavení
src/main/            Electron: okna (knihovna a prohlížeč), OAuth, protokol okgram://, lokální knihovna,
                     controller (stav, ukládání, synchronizace, přenosy), miniatury, cache, log
src/preload/         typované API pro okna (contextIsolation + sandbox)
src/renderer/src/    React: úvodní obrazovka, záložky Média a Alba, prohlížeč, dialogy, nápověda, i18n (cs/en)
tests/               vitest, smoke/ (Playwright + Electron), preview/ (UI v prohlížeči s ukázkovými daty)
```

Technický návrh: [docs/DESIGN.md](docs/DESIGN.md).

## Známé hranice

- `drive.file`: aplikace nevidí soubory, které do složky OKgram nedala sama.
- Alba nejsou složky na Disku, jsou v `okgram.json`. Sdílet odkazem jde jednotlivý soubor, ne album.
- Při úpravě téhož alba na dvou počítačích zároveň vyhraje novější změna celého alba.
- ZIP nepodporuje ZIP64: celý archiv musí být menší než 4 GB.
- Otočení je jen v zobrazení, soubor se nemění.

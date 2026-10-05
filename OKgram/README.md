# OKgram

OKgram je prohlížeč fotek a videí pro Windows, Linux a macOS s alby, hvězdičkami, barevnými rámečky a prezentací. Knihovna je buď ve složce `OKgram` na vašem Google Disku, nebo ve složce v počítači.

**Stažení:** `OKgram-Setup.exe` pro Windows najdete na [apps.opikula.dev](https://apps.opikula.dev). Instalačku si můžete sestavit i sami ze zdrojového kódu, viz [Instalace](#instalace).

| Složka / soubor | Obsah |
|---|---|
| `OKgram - WinLinMac` | zdrojový kód (Electron, React, TypeScript) |
| `OKgram.md` | původní zadání |

## Funkce

- **Dvě úložiště**:
  - *Google Disk*: složka `OKgram` na Disku, na každém počítači stejná knihovna.
  - *Tento počítač*: libovolná složka i s podsložkami, bez přihlášení a bez internetu.
- **Média**:
  - Mřížka nebo seznam, posuvník velikosti miniatur.
  - Hledání podle názvu, filtry Oblíbené, fotky / videa a barevné rámečky.
  - Řazení podle data pořízení, názvu, formátu nebo velikosti.
  - Nahrání tlačítkem nebo přetažením souborů a celých složek do okna.
  - Hromadný výběr (Ctrl+klik, Shift+klik) pro stažení, alba, hvězdičky, ZIP a mazání.
- **Pravé tlačítko**: otevřít, prezentace, stáhnout, hvězdička, barevný rámeček, přidat do alba, otočit, přejmenovat, detaily, odkaz ke sdílení (Disk) nebo cesta k souboru, otevřít v systémové aplikaci, smazat do koše.
- **Alba**:
  - Vlastní ikona a barva, alba v albech, ruční řazení přetahováním.
  - Obálka alba, duplikování, přesun, stažení jako ZIP.
  - Jedna fotka může být ve více albech.
  - Chytrá alba: Oblíbené, Fotky, Videa, Poslední přidané.
- **Prohlížeč v novém okně**:
  - Fotky: zoom kolečkem, posun tažením, 100 % / přizpůsobit, otočení.
  - Videa: vlastní ovládání (přehrát, posuvník, hlasitost, rychlost).
  - Šipky na další a předchozí soubor, detaily, hvězdička a rámeček.
  - Prezentace přes celou obrazovku.
- **Ukládání a synchronizace**:
  - Alba, hvězdičky, rámečky, uživatelské jméno a nastavení vzhledu jsou v `okgram.json` u knihovny.
  - Změny z více počítačů se spojují.
  - Offline se zobrazí naposledy načtené miniatury a změny se odešlou později.
- **Vzhled**:
  - Témata Světlý, Tmavý, OpiKula style a Vlastní (každá barva a prvky okna).
  - Čeština a angličtina.
  - Nápověda pod **?** se záložkami Windows / Linux / macOS.

## Požadavky

- Pro Google Disk: projekt v [Google Cloud Console](https://console.cloud.google.com) se zapnutým Google Drive API a OAuth klientem typu Desktop app. Může to být stejný projekt jako pro OKpass.
- Jen pro sestavení ze zdrojového kódu: [Node.js](https://nodejs.org) 20 nebo novější. Hotová instalačka Node.js nepotřebuje.

## Instalace

### Možnost 1: stáhnout instalačku (Windows)

Stáhněte `OKgram-Setup.exe` na [apps.opikula.dev](https://apps.opikula.dev) a spusťte ho. Nic dalšího instalovat nemusíte, vše potřebné je uvnitř instalačky.

### Možnost 2: ze zdrojového kódu

1. Nainstalujte [Node.js](https://nodejs.org) 20 nebo novější (verzi LTS). Na Windows to jde i příkazem `winget install OpenJS.NodeJS.LTS`.
2. Stáhněte kód přes [Git](https://git-scm.com) příkazem `git clone https://github.com/OpiKula2877/Apps.git`, nebo na GitHubu klikněte na **Code, Download ZIP** a ZIP rozbalte.
3. Vyberte si:

**Sestavit vlastní Setup.exe (Windows):** spusťte dvojklikem `OKgram - WinLinMac/build-setup.bat`. Skript stáhne závislosti, sestaví instalačku a uloží ji jako `Setup\OKgram-Setup.exe` ve složce `Apps`. Když Node.js chybí, nabídne, že ho nainstaluje.

**Spustit bez instalace:** na Windows dvojklikem `OKgram - WinLinMac/run.bat`, na Linuxu a macOS `./run.sh`. Nebo příkazy:

```bash
cd "Apps/OKgram/OKgram - WinLinMac"
npm install
npm run dev
```

**Sestavit instalátor příkazem** (po `npm install`, výsledek je ve složce `dist/`):

| Systém | Příkaz | Výsledek |
|---|---|---|
| Windows | `npm run dist:win` | `OKgram-Setup-<verze>.exe` |
| Linux | `npm run dist:linux` | `OKgram-<verze>.AppImage` |
| macOS (jen na Macu) | `npm run dist:mac` | `OKgram-<verze>.dmg` |

Instalátory nejsou podepsané. Na Windows klikněte na „Další informace, Přesto spustit“. Na macOS otevřete aplikaci poprvé přes pravé tlačítko, Otevřít. Na Linuxu: `chmod +x OKgram-*.AppImage`.

## Přihlášení ke Google Disku

1. V Google Cloud Console zapněte **Google Drive API**.
2. V **Google Auth Platform** vyplňte Branding, v Audience zvolte **External** a v Data Access přidejte scope `.../auth/drive.file`.
3. V **Clients** vytvořte klienta typu **Desktop app** a stáhněte JSON.
4. V OKgram vyberte *Google Disk*, klikněte na *Vybrat client_secret.json…* a pak na *Přihlásit se přes Google*.

V testovacím režimu přidejte svůj účet do *Test users*. Přihlášení pak vyprší po 7 dnech. Pro trvalé přihlášení aplikaci publikujte (*Publish app*).

OKgram používá jen oprávnění `drive.file`, takže vidí pouze soubory, které do Disku nahrál sám. Fotky, které do složky OKgram dáte přes web Google Disku, v aplikaci neuvidíte. Nahrávejte je přes OKgram.

## Omezení

- AVI a videa se staršími kodeky se v aplikaci přehrát nedají. Prohlížeč nabídne systémový přehrávač.
- Sdílet odkazem jde jen jednotlivý soubor, ne celé album.
- ZIP musí být menší než 4 GB.
- Otočení fotky se jen zobrazuje, soubor se nemění.

Podrobnosti pro vývojáře: [OKgram - WinLinMac/README.md](OKgram%20-%20WinLinMac/README.md).

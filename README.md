# Apps

Aplikace vytvořené pomocí Claude Code. Stránka ke stažení: [apps.opikula.dev](https://apps.opikula.dev)

Každou aplikaci můžete získat dvěma způsoby:

1. **Stáhnout hotovou instalačku** (`Setup.exe` pro Windows, `.apk` pro Android) na [apps.opikula.dev](https://apps.opikula.dev). Nic dalšího instalovat nemusíte, vše potřebné je uvnitř instalačky.
2. **Sestavit si ji sami ze zdrojového kódu** přes Node.js, viz [Instalace ze zdrojového kódu](#instalace-ze-zdrojového-kódu). Takhle si aplikaci můžete i jen spustit bez instalace a funguje to i na Linuxu a macOS.

## 1. OKpass

Šifrovaný správce poznámek a hesel pro Windows, Linux, macOS a Android. Data se šifrují přímo ve vašem zařízení a ukládají se do složky `OKpass` na vašem Google Disku.

- Windows: `OKpass-Setup.exe` na [apps.opikula.dev](https://apps.opikula.dev)
- Android: [`OKpass.apk`](OKpass/OKpass%20-%20Android/OKpass.apk)
- Podrobnosti, nastavení Google přihlášení a návod: [OKpass/README.md](OKpass/README.md)

## 2. OKfetch

Chat pro Windows, Linux, macOS a Android, ve kterém zprávy, soubory a skupiny putují přímo mezi zařízeními, bez serveru a bez účtu. Každý kontakt má šifrovaný i nešifrovaný chat, a když přímé spojení nejde, zprávy jdou šifrovaně přes veřejné Nostr relay.

- Windows: `OKfetch-Setup.exe` na [apps.opikula.dev](https://apps.opikula.dev)
- Android: [`OKfetch.apk`](OKfetch/OKfetch%20-%20Android/OKfetch.apk)
- Podrobnosti a návod: [OKfetch/README.md](OKfetch/README.md)

## 3. OKgram

Prohlížeč fotek a videí pro Windows, Linux a macOS s alby, hvězdičkami, barevnými rámečky a prezentací. Knihovna je buď ve složce `OKgram` na vašem Google Disku, nebo ve složce v počítači.

- Windows: `OKgram-Setup.exe` na [apps.opikula.dev](https://apps.opikula.dev)
- Podrobnosti, nastavení Google přihlášení a návod: [OKgram/README.md](OKgram/README.md)

## Instalace ze zdrojového kódu

1. Nainstalujte [Node.js](https://nodejs.org) 20 nebo novější (verzi LTS). Na Windows to jde i příkazem `winget install OpenJS.NodeJS.LTS`.
2. Stáhněte kód. Buď přes [Git](https://git-scm.com):

   ```bash
   git clone https://github.com/OpiKula2877/Apps.git
   ```

   nebo na GitHubu klikněte na **Code, Download ZIP** a ZIP rozbalte (složka se pak jmenuje `Apps-main`).

3. Vyberte si, co chcete udělat:

**Sestavit vlastní Setup.exe (Windows).** Ve složce aplikace spusťte dvojklikem `build-setup.bat`, třeba `OKpass/OKpass - WinLinMac/build-setup.bat`. Skript stáhne závislosti, sestaví instalačku a uloží ji do složky `Setup` vedle tohoto README (např. `Setup\OKpass-Setup.exe`). Soubor [`build-setup.bat`](build-setup.bat) přímo ve složce `Apps` sestaví všechny aplikace najednou. Když Node.js chybí, skript nabídne, že ho nainstaluje.

**Spustit aplikaci bez instalace** (Windows, Linux, macOS):

```bash
cd "Apps/OKpass/OKpass - WinLinMac"
npm install
npm run dev
```

Místo `OKpass` dosaďte `OKfetch` nebo `OKgram`.

**Sestavit instalátor příkazem** (ve stejné složce, po `npm install`, výsledek je ve složce `dist/`):

| Systém | Příkaz | Výsledek |
|---|---|---|
| Windows | `npm run dist:win` | `<Aplikace>-Setup-<verze>.exe` |
| Linux | `npm run dist:linux` | `<Aplikace>-<verze>.AppImage` |
| macOS (jen na Macu) | `npm run dist:mac` | `<Aplikace>-<verze>.dmg` |

Instalátory nejsou podepsané certifikátem. Na Windows klikněte na „Další informace, Přesto spustit“. Na macOS otevřete aplikaci poprvé přes pravé tlačítko, Otevřít. Na Linuxu nastavte souboru práva ke spuštění: `chmod +x *.AppImage`.

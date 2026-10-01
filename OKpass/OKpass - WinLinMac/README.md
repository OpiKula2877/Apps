# OKpass

OKpass je desktopová aplikace pro bezpečné poznámky a hesla s daty na vašem Google Disku. Je napsaná v **React + TypeScript** a běží v **Electronu** na Windows, Linuxu i macOS.

Tato verze nahrazuje Python verzi, která je archivovaná v `../_archiv/OKpass-Python`. Formát souboru trezoru je stejný, takže React verze otevře trezor vytvořený Python verzí. Použije také stávající nastavení a uložené přihlášení.

## Požadavky

- Node.js 20 nebo novější (jen pro sestavení ze zdrojových souborů)
- vlastní OAuth klient z Google Cloud (`client_secret.json`, typ **Desktop app**)

## Spuštění ze zdrojových souborů

```bash
npm install
npm run dev
```

## Instalátory

Každý příkaz níže sestaví instalátor do složky `dist/`.

| Systém | Příkaz | Výstup |
|---|---|---|
| Windows | `npm run dist:win` | `OKpass-Setup-<verze>.exe` |
| Linux | `npm run dist:linux` | `OKpass-<verze>.AppImage` |
| macOS | `npm run dist:mac` (jen na Macu) | `OKpass-<verze>.dmg` |

Instalátory nejsou podepsané:
- Na Windows může SmartScreen ukázat hlášku. Klikněte na „Další informace → Přesto spustit“.
- Na macOS otevřete aplikaci poprvé přes pravé tlačítko → Otevřít.

## První přihlášení

1. V [Google Cloud Console](https://console.cloud.google.com) vytvořte projekt a zapněte **Google Drive API**.
2. Nastavte **OAuth consent screen**: typ External a svůj účet přidejte do *Test users*.
3. Vytvořte **OAuth client ID** typu **Desktop app** a stáhněte JSON.
4. V OKpass klikněte na **Vybrat client_secret.json…** a pak na **Přihlásit se přes Google**.

Podrobný návod se záložkami Windows / Linux / macOS je v aplikaci pod ikonou **?** vpravo dole. Aplikace používá oprávnění `drive.file`, takže vidí jen soubory, které sama vytvořila.

## Kde jsou soubory

| | Nastavení, `client_secret.json`, `token.json` | Šifrovaná offline kopie |
|---|---|---|
| Windows | `%APPDATA%\OKpass` | `%LOCALAPPDATA%\OKpass\cache` |
| Linux | `~/.config/okpass` | `~/.cache/okpass` |
| macOS | `~/Library/Application Support/OKpass` | `~/Library/Caches/OKpass` |

## Struktura projektu

```
src/main/            main proces (veškerá logika a tajemství)
  crypto/            Argon2id + HKDF, formát souboru a sloty (AES-256-GCM), generátor klamných dat
  storage/           model trezoru, session, lokální cache, synchronizace (offline, zálohy)
  drive/             OAuth (loopback + PKCE), Google Drive REST, lokální vývojový backend
  controller.ts      stav aplikace, fronta ukládání, zamčení, odhlášení
  ipc.ts, index.ts   IPC handlery, okno a životní cyklus
src/preload/         typované API pro renderer (contextIsolation + sandbox)
src/shared/          sdílené typy, palety témat, pravidla klíče, generátor hesel
src/renderer/        React UI (stránky, záložky, editor TipTap, dialogy, nápověda)
tests/               vitest (logika, kompatibilita s Pythonem, editor) + smoke/ (Playwright + Electron)
docs/DESIGN.md       technický návrh
```

Renderer nikdy nedostane šifrovací klíče, tokeny ani šifrovaný soubor. Dostane jen obsah trezoru, který zobrazuje.

## Novinka oproti Python verzi

- **Přejmenování polí.** V záznamu hesla můžete přepsat názvy v levém sloupci, včetně *Název / URL*, *Uživatelské jméno* a *Heslo*. Když název smažete, vrátí se výchozí. Přejmenované pole pro heslo zůstane skryté a má dál generátor i měřič síly.

## Testy

```bash
npm test            # unit testy (vitest)
npm run smoke       # sestaví aplikaci a projde ji celou (na chvíli se otevře okno)
npm run typecheck
```

## Vývojový režim

`npm run dev:local` (nebo `--local-dev SLOŽKA`) použije místo Google Disku lokální složku a vynechá OAuth. Soubor `OFFLINE` v této složce simuluje výpadek připojení.

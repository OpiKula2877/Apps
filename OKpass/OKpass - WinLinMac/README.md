# OKpass

OKpass je šifrovaný správce poznámek a hesel s daty na vašem Google Disku. Šifruje se na vašem zařízení, ještě než se cokoli nahraje. Je napsaný v **React + TypeScript** a běží v **Electronu** na Windows, Linuxu i macOS a jako **APK na Androidu**. Počítač a telefon používají stejné jádro, stejný soubor trezoru i stejný klíč. Vypadá a nastavuje se stejně jako OKfetch.

Popis pro uživatele (instalace, přihlášení ke Google, šifrování) je v [README o složku výš](../README.md). Tenhle soubor je pro vývojáře.

## Požadavky

- [Node.js](https://nodejs.org) 20 nebo novější (jen pro sestavení ze zdrojových souborů)
- vlastní OAuth klient z Google Cloud (`client_secret.json`, typ **Desktop app**), viz [První přihlášení](#první-přihlášení)
- na Android navíc JDK 17+, Android SDK 36 a vlastní podpisový klíč, viz [Android (APK)](#android-apk)

## Spuštění ze zdrojových souborů

```bash
npm install
npm run dev
```

Bez Google Disku a bez přihlášení, s daty v lokální složce:

```bash
npm run dev:local
```

`dev:local` (nebo `--local-dev SLOŽKA`) použije místo Disku složku `./dev-drive` a vynechá OAuth. Soubor `OFFLINE` v ní simuluje výpadek připojení.

## Instalátory

Každý příkaz sestaví instalátor do složky `dist/`.

| Systém | Příkaz | Výstup |
|---|---|---|
| Windows | `npm run dist:win` | `OKpass-Setup-<verze>.exe` |
| Linux | `npm run dist:linux` | `OKpass-<verze>.AppImage` |
| macOS | `npm run dist:mac` (jen na Macu) | `OKpass-<verze>.dmg` |

Instalátory nejsou podepsané:
- Na Windows může SmartScreen ukázat hlášku. Klikněte na „Další informace → Přesto spustit“.
- Na macOS otevřete aplikaci poprvé přes pravé tlačítko → Otevřít.
- Na Linuxu nastavte souboru práva ke spuštění: `chmod +x OKpass-*.AppImage`.

## Android (APK)

`npm run apk` uloží `OKpass.apk` do složky `..\OKpass - Android\`. Instalace a ovládání na telefonu jsou popsané v aplikaci pod **?**.

Jak je to postavené:
- UI je stejný React jako na počítači, běží v Capacitoru (WebView) a na šířce telefonu se přepne na mobilní rozložení.
- Jádro (`src/core`: šifrování, trezor, synchronizace) je sdílené beze změny. Jiné jsou jen vstupy platformy v `src/renderer/src/mobile/` (úložiště, přihlášení, tlačítko Zpět).
- Java (`android/app/src/main/java/cz/opikula/okpass/`) přidává přihlášení ke Google, odemykání otiskem prstu a ovládání okna (zákaz snímků obrazovky, zamknutí při odchodu z aplikace).

Sestavení APK:

```bash
npm run apk
```

Potřebuje:
- JDK 17+ (`JAVA_HOME`) a Android SDK 36 (`android/local.properties` nebo `ANDROID_HOME`).
- Vlastní klíč pro podpis. V repozitáři není a nikdy tam nepatří. Vytvoříte ho jednou (JDK obsahuje `keytool`):

  ```bash
  mkdir android/keystore
  keytool -genkeypair -keystore android/keystore/okpass.jks -alias okpass -keyalg RSA -keysize 3072 -validity 10950
  ```

  Pak vytvořte `android/keystore.properties` se svým heslem:

  ```properties
  storeFile=keystore/okpass.jks
  storePassword=VAŠE_HESLO
  keyAlias=okpass
  keyPassword=VAŠE_HESLO
  ```

  **Klíč si zálohujte**: aktualizace se dá nainstalovat přes starou verzi jen se stejným klíčem. Android OAuth klienta v Google Cloudu zaregistrujte s SHA-1 tohoto klíče a balíčkem `cz.opikula.okpass`.

## První přihlášení

1. V [Google Cloud Console](https://console.cloud.google.com) vytvořte projekt a zapněte **Google Drive API**.
2. Nastavte **Google Auth Platform**: Branding (název a e-maily) a Audience. V testovacím režimu přidejte svůj účet do *Test users* (přihlášení pak vyprší po 7 dnech), nebo aplikaci publikujte.
3. Vytvořte **OAuth client ID** typu **Desktop app** a stáhněte JSON.
4. V OKpass klikněte na **Vybrat client_secret.json…** a pak na **Přihlásit se přes Google**.

Podrobný návod se záložkami Windows / Linux / macOS je v aplikaci pod ikonou **?** vpravo dole. Aplikace používá jen oprávnění `drive.file`, takže vidí pouze soubory, které sama vytvořila.

## Kde jsou soubory

| | Nastavení, `client_secret.json`, `token.json` | Šifrovaná offline kopie |
|---|---|---|
| Windows | `%APPDATA%\OKpass` | `%LOCALAPPDATA%\OKpass\cache` |
| Linux | `~/.config/okpass` | `~/.cache/okpass` |
| macOS | `~/Library/Application Support/OKpass` | `~/Library/Caches/OKpass` |

## Proměnné prostředí (testy a vývoj)

| Proměnná | Význam |
|---|---|
| `OKPASS_CONFIG_DIR` | složka s nastavením a přihlášením (přebíjí výchozí umístění) |
| `OKPASS_CACHE_DIR` | složka s offline kopií trezoru |

## Struktura projektu

```
src/core/            TypeScript bez Electronu (sdílené s Androidem, testovatelné)
  vault.ts, vaultFile.ts   model trezoru, formát souboru a sloty (AES-256-GCM, klamný trezor)
  kdf.ts                   Argon2id + HKDF
  session.ts               otevření trezoru, volba slotu podle klíče
  fake.ts                  generátor věrohodných falešných dat pro špatný klíč
  repository.ts            ukládání, offline kopie, zálohy, synchronizace
  controller.ts            stav aplikace, fronta ukládání, zamčení, odhlášení
  driveRest.ts             Google Drive REST
  settings.ts, platform.ts nastavení a rozhraní platformy
src/main/            Electron: okno, IPC, OAuth (loopback + PKCE), lokální cache, vývojový backend
src/preload/         typované API pro renderer (contextIsolation + sandbox)
src/shared/          typy, palety témat, pravidla klíče, generátor hesel
src/renderer/src/    React: stránky, záložky, editor TipTap, dialogy, nápověda, i18n (cs/en)
  mobile/              Android: úložiště, přihlášení, tlačítko Zpět, vývojový backend pro prohlížeč
android/             projekt Capacitoru a Java kód (přihlášení, otisk prstu, okno)
tests/               vitest (logika, kompatibilita s Python verzí, editor, překlady) a smoke/ (Playwright + Electron)
scripts/             sestavení APK, generování ikon
docs/DESIGN.md       technický návrh
```

Renderer nikdy nedostane šifrovací klíče, tokeny ani šifrovaný soubor. Dostane jen obsah trezoru, který zobrazuje.

## Příkazy

| Příkaz | Co dělá |
|---|---|
| `npm run dev` | spustí aplikaci s Google Diskem |
| `npm run dev:local` | spustí aplikaci bez Disku, data v `./dev-drive` |
| `npm run typecheck` | typová kontrola main i rendereru |
| `npm test` | vitest: krypto a formát souboru, session, repozitář, Drive, editor, překlady, generátor hesel |
| `npm run smoke` | sestaví aplikaci a projde ji celou v Electronu (na chvíli se otevře okno) |
| `npm run build:mobile` | sestaví UI pro telefon do `dist-mobile/` |
| `npm run dev:mobile` | UI telefonu v prohlížeči |
| `npm run apk` | sestaví podepsané APK a zkopíruje ho do `..\OKpass - Android\OKpass.apk` |

## Formát trezoru

Soubor trezoru `vault.okp` je stejný jako ve starší Python verzi, takže se otevře i trezor z ní. Tu v repozitáři nenajdete. Popis formátu a šifrování je v [README o složku výš](../README.md#šifrování) a podrobně v `docs/DESIGN.md`. Kompatibilitu hlídá test s ukázkovým trezorem ve `tests/fixtures/`.

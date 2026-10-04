# OKfetch

OKfetch je desktopová P2P aplikace pro šifrované i nešifrované zprávy, soubory a skupiny. Nepotřebuje server, účet ani placenou službu: data jsou jen na vašem počítači a lidi se spojují přímo, přes veřejnou DHT (HyperDHT). Je napsaná v **React + TypeScript** a běží v **Electronu** na Windows, Linuxu i macOS a jako **APK na Androidu** (od verze 10). Telefon a počítač si rozumí: používají stejnou síť i stejný protokol. Vypadá a nastavuje se stejně jako OKpass.

## Požadavky

- Node.js 20 nebo novější (jen pro sestavení ze zdrojových souborů)
- internet; za NAT se spojení vytvoří „děrováním“ přes DHT, žádný port otvírat nemusíte
- když děrování nejde (obě strany za NAT s náhodnými porty, typicky mobilní data), jdou šifrované zprávy přes veřejné Nostr relay servery – zdarma a bez registrace (viz Omezení)

## Spuštění ze zdrojových souborů

```bash
npm install
npm run dev
```

Zkouška s dvěma okny, která se najdou přes lokální DHT (internet netřeba):

```bash
npm run dev:two
```

Data obou oken jsou ve složce `dev-data/`.

## Instalátory

Každý příkaz sestaví instalátor do složky `dist/`.

| Systém | Příkaz | Výstup |
|---|---|---|
| Windows | `npm run dist:win` | `OKfetch-Setup-<verze>.exe` |
| Linux | `npm run dist:linux` | `OKfetch-<verze>.AppImage` |
| macOS | `npm run dist:mac` (jen na Macu) | `OKfetch-<verze>.dmg` |

`dist:win` předem načte `scripts/extract-uninstaller.cjs`. electron-builder pak odinstalátor jen vyčte ze svého pomocného `.exe` a nespouští ho. Spuštění by Smart App Control zablokoval („spawn UNKNOWN“).

Instalátory nejsou podepsané:
- Na Windows může SmartScreen ukázat hlášku. Klikněte na „Další informace → Přesto spustit“.
- Na macOS otevřete aplikaci poprvé přes pravé tlačítko → Otevřít.

## Android (APK)

`npm run apk` uloží `OKfetch.apk` do složky `..\OKfetch - Android\` (v repozitáři na GitHubu APK není, sestavte si ho podle návodu níže). Instalace a ovládání na telefonu jsou popsané v aplikaci pod **?**.

Jak je to postavené:
- UI je stejný React jako na počítači, běží v Capacitoru (WebView) a na šířce telefonu se přepne na mobilní rozložení.
- Jádro (`src/core`) běží beze změny v **Bare Kit** workletu (runtime od autorů Hyperswarm). Jiné jsou jen ochrana klíčů (Android Keystore) a vstup `src/mobile/`.
- Java (`android/app/src/main/java/cz/opikula/okfetch/`) přidává službu na pozadí, notifikace s odpovědí, zámek otiskem prstu, QR skener, sdílení, fotoaparát a systémové dialogy pro soubory.

Sestavení APK (Windows):

```bash
npm run apk
```

Potřebuje:
- JDK 17+ (`JAVA_HOME`, jinak se použije JDK v `%LOCALAPPDATA%\OKpass-build`) a Android SDK 36 (`android/local.properties`).
- Bare Kit pro Android v `android/app/libs/bare-kit/` (`classes.jar` a `jni/`). Je to složka `android/bare-kit` z `prebuilds.zip` vydání [Bare Kit v2.5.5](https://github.com/holepunchto/bare-kit/releases).
- Závislosti workletu: `npm install` ve složce `mobile-worklet/`.
- Vlastní klíč pro podpis. V repozitáři není a nikdy tam nepatří. Vytvoříte ho jednou (JDK obsahuje `keytool`):

  ```bash
  mkdir android/keystore
  keytool -genkeypair -v -keystore android/keystore/okfetch.jks -alias okfetch -keyalg RSA -keysize 4096 -validity 10000
  ```

  Pak vytvořte `android/keystore.properties` se svým heslem:

  ```properties
  storeFile=keystore/okfetch.jks
  storePassword=VAŠE_HESLO
  keyAlias=okfetch
  keyPassword=VAŠE_HESLO
  ```

  **Klíč si zálohujte**: aktualizace se dá nainstalovat přes starou verzi jen se stejným klíčem.

## Jak se přidá kontakt

1. V **Nastavení → Profil** nastavte **heslo pro příjem** a pošlete kamarádovi svůj **identifikátor** a heslo, každé jinou cestou. Telefon může místo opisování naskenovat **QR kód**, který je tamtéž.
2. Kamarád zvolí **Přidat kontakt**, vyplní je a odešle žádost.
3. Vy ji v panelu **Žádosti** přijmete, odmítnete (i s vysvětlením) nebo zablokujete.
4. Vzniknou dva chaty: šifrovaný a nešifrovaný.

Podrobný návod se záložkami Windows / Linux / macOS je v aplikaci pod ikonou **?** vpravo dole.

## Kde jsou soubory

| | Nastavení vzhledu a cesta k úložišti | Data (zprávy, soubory, klíče) |
|---|---|---|
| Windows | `%APPDATA%\OKfetch` | `C:\OKfetch` |
| Linux | `~/.config/okfetch` | `~/.local/share/okfetch` |
| macOS | `~/Library/Application Support/OKfetch-config` | `~/Library/Application Support/OKfetch` |

Cestu k datům změníte v **Nastavení → Úložiště a systém**. Když se do složky nedá zapisovat, aplikace po startu nabídne výběr jiné.

## Proměnné prostředí (testy a vývoj)

| Proměnná | Význam |
|---|---|
| `OKFETCH_DATA_DIR` | složka s daty (přebíjí nastavení) |
| `OKFETCH_CONFIG_DIR` | složka s nastavením; zároveň odděluje instance Electronu |
| `OKFETCH_BOOTSTRAP` | lokální DHT, např. `127.0.0.1:49737` (jinak veřejná HyperDHT) |
| `OKFETCH_FAST_KDF` | lehčí Argon2, jen pro testy |
| `OKFETCH_TEST_PICK_FILE` | okno „Poslat soubor“ vrátí tuto cestu, jen pro testy |
| `OKFETCH_RELAY` | `off` vypne náhradní cestu přes relay (testy na lokální DHT) |
| `OKFETCH_RELAY_URLS` | vlastní seznam relay oddělený čárkou, např. `wss://nos.lol,wss://nostr.mom` |

## Struktura projektu

```
src/core/            čistý TypeScript bez Electronu (testovatelný)
  identity.ts          Ed25519 klíč, identifikátor = z-base-32 veřejného klíče
  encryption/          klíč kontaktu, XChaCha20-Poly1305, důkaz hesla (Argon2id), šifra souborů, ověřovací kód
  network/             Hyperswarm (swarm), rámce protokolu, přítomnost online/offline, diagnostika
    relay/               náhradní cesta přes Nostr relay: podepsané události, zapečetěné pakety, virtuální spojení
  storage/             cesty, atomický zápis JSON, chat jako JSON-lines s kompakcí
  contacts/            žádosti, přijetí/odmítnutí, profil, blokace
  messages/            odeslání, fronta, potvrzení, čtení, mazání
  files_transfer/      nabídka, přijetí/odmítnutí, bloky 64 KiB, kontrola hashe
  groups/              šifrované i nešifrované skupiny, mesh, last-writer-wins
  security/            limit pokusů o heslo
  controller.ts        spojuje služby, třídí příchozí rámce, vydává události pro UI
src/main/            okno, IPC, safeStorage, tray, autostart, notifikace, okfetch-file://
src/preload/         typované API window.okfetch (contextIsolation + sandbox)
src/shared/          typy, palety témat, pravidla hesla, pomocné funkce
src/renderer/src/    React: Fetch, Nastavení, chat, dialogy, nápověda, i18n (cs/en)
  mobile/              Android: most k jádru (mobileApi), tlačítko Zpět, falešné jádro pro testy v prohlížeči
src/mobile/          jádro pro telefon v Bare workletu: řádkový protokol (rpc), ochrana klíčů, záloha, úklid
mobile-worklet/      balíček workletu (vlastní node_modules s bare-*), sestavuje scripts/build-worklet.mjs
android/             projekt Capacitoru a Java kód (služba, notifikace, zámek, QR, sdílení, soubory)
tests/               vitest (jednotkové + integrační přes lokální DHT) a smoke/ (Playwright, 2× Electron)
docs/DESIGN.md       technický návrh
```

## Příkazy

| Příkaz | Co dělá |
|---|---|
| `npm run typecheck` | typová kontrola main i rendereru |
| `npm test` | vitest: krypto, protokol, úložiště, služby jádra, editor, překlady |
| `npm run smoke` | sestaví a spustí 2 instance Electronu, projde kliknutím přidání kontaktu, chat, GIF, výběr, hledání, motivy, nápovědu |
| `npm run smoke:relay` | 2 instance Electronu, každá na vlastní lokální DHT: kontakt a zpráva jen přes veřejné relay (potřebuje internet) |
| `npm run dev:two` | dvě okna k ruční zkoušce |
| `npm run apk` | sestaví podepsané APK a zkopíruje ho do `..\OKfetch - Android\OKfetch.apk` |
| `npm run smoke:mobile` | UI telefonu v prohlížeči (Edge, 375×812) s falešným jádrem: rozložení, Zpět, dialogy, QR, sdílení, nastavení, nápověda |
| `npm run smoke:android` | APK na emulátoru (adb, root) proti jádru v Node přes veřejnou DHT: žádost, zprávy, soubory, notifikace, sdílení, záloha a obnova, zámek |
| `npm run smoke:android:request` | telefon pošle žádost počítači přes „Přidat kontakt“; s `OKFETCH_E2E_RELAY=1` jen přes veřejné relay |
| `OKFETCH_LIVE_RELAYS=1 npx vitest run tests/relayLive.test.ts` | dvě jádra jen přes skutečné veřejné relay: žádost, zprávy, soubor (potřebuje internet) |

## Omezení

- Soubory se posílají jen mezi dvěma online stranami a jen v chatech s kontaktem (ve skupinách se posílají pouze zprávy).
- Přerušený přenos se nepokračuje, odesílá se znovu.
- Telefon přijímá zprávy, jen když OKfetch běží (volba „Běžet na pozadí“). Bez serveru nejsou push notifikace.
- Když jsou obě strany za NAT s náhodnými porty (mobilní data, internet přes mobilního operátora), přímé spojení nevznikne. Pak jde provoz přes veřejné Nostr relay (`nos.lol`, `relay.primal.net`, `nostr.mom`, `relay.damus.io`). Obsah je šifrovaný mezi oběma stranami, relay ale vidí čas, velikost bloků a IP adresu. Soubory jsou přes relay pomalé (desítky KB/s) a provozovatel relay může provoz kdykoli omezit. Vypnout nebo změnit seznam jde v Nastavení → Síť a diagnostika spojení.
- Záloha `.okfb` je zatím jen v Androidu (počítač ji neumí vytvořit ani obnovit).
- APK má 66 MB, protože obsahuje runtime Bare pro tři typy procesorů.
- Návrhy z konce zadání (emoji reakce, citace, úprava zpráv, hlasové zprávy…) nejsou implementované a čekají na souhlas.

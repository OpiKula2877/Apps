# OKfetch

OKfetch je peer-to-peer chat pro šifrované i nešifrované zprávy, soubory a skupiny. Nepotřebuje server, účet ani placenou službu: data jsou jen na vašem počítači a lidé se spojují přímo, přes veřejnou DHT ([HyperDHT](https://github.com/holepunchto/hyperdht)). Když se dvě zařízení nemohou spojit přímo (třeba obě na mobilních datech), jdou šifrované zprávy přes veřejné Nostr relay servery – zdarma a bez registrace. Aplikace je napsaná v **React + TypeScript** a běží v **Electronu** na Windows, Linuxu i macOS a jako **APK na Androidu** (od verze 10). Telefon a počítač si rozumí. Vypadá a nastavuje se stejně jako OKpass.

| Složka | Obsah |
|---|---|
| `OKfetch - WinLinMac` | zdrojový kód pro počítač i Android (Electron, Capacitor, Bare Kit, React, TypeScript), testy a technický návrh v `docs/DESIGN.md` |

## Funkce

- **Kontakty**:
  - Kontakt se přidává identifikátorem (stabilní, nemění se se sítí) a heslem pro příjem, které pošlete jinou cestou.
  - Protistrana žádost přijme, odmítne (i s vysvětlením) nebo zablokuje. Je-li offline, žádost počká.
  - Po pěti špatných heslech se žadatel na 15 minut zablokuje.
  - Ověřovací kód (30 číslic) potvrdí, že mezi vámi nikdo není. Ověřený kontakt má štít.
- **Dva chaty na kontakt**:
  - Šifrovaný: zprávy i soubory jsou zašifrované a na disku je jen šifrový text.
  - Nešifrovaný: o něco rychlejší, běžný text.
- **Zprávy**:
  - Editor s nadpisy, tučným písmem, kurzívou, odkazy a odsazením.
  - Stavy čeká, doručeno a přečteno, „píše…“ a hledání v chatu.
  - Zpráva pro offline kontakt čeká a odešle se po jeho připojení (nejvýše 5000 znaků).
  - Mazání pro mě nebo pro oba (jen vlastní zprávy), i hromadně přes výběr.
- **Soubory**:
  - Příjemce soubor přijme, odmítne nebo odmítne s vysvětlením.
  - Přenos po blocích s kontrolou hashe a ukazatelem průběhu.
  - Obrázky a GIF se zobrazí přímo v chatu.
- **Skupiny**: šifrované i nešifrované, pozvánky, členové se spojují i bez společného kontaktu, název a členy může měnit kdokoli.
- **Spojení odkudkoli**:
  - Nejdřív přímo (HyperDHT, děrování NAT).
  - Když to nejde (obě strany za NAT s náhodnými porty, typicky mobilní data), za pár sekund přes veřejné Nostr relay. Obsah zůstává šifrovaný mezi oběma stranami. U kontaktu je pak „online · přes relay“.
  - V **Nastavení, Síť a diagnostika spojení**: typ sítě, zkušební spojení s kódem chyby, zapnutí relay a jejich seznam.
- **QR kód** identifikátoru v profilu (na telefonu i jeho skenování při přidání kontaktu).
- **Systém**:
  - Klíče chrání operační systém (DPAPI, Keychain, libsecret).
  - Upozornění na nové zprávy, počet nepřečtených, ikona v liště a spuštění se systémem.
  - Cesta k úložišti jde změnit.
- **Vzhled**:
  - Témata Světlý, Tmavý, OpiKula style a Vlastní (u Vlastního jde nastavit každá barva, včetně barev stavu online a offline).
  - Čeština a angličtina.
- **Navíc na Androidu**:
  - Odemykání otiskem prstu (nebo PINem či gestem telefonu) při startu a po návratu z pozadí.
  - Běh na pozadí, notifikace s odpovědí a „Přečteno“ přímo z notifikace.
  - Sdílení do OKfetch z jiných aplikací, fotka z fotoaparátu přímo do chatu.
  - Blokace snímků obrazovky, skrytí obsahu notifikací, motiv podle systému.
  - Záloha a obnova do souboru zamčeného heslem.

## Požadavky

- Připojení k internetu (Wi-Fi, ethernet i mobilní data). Žádný port otvírat nemusíte.
- Pro sestavení ze zdrojových souborů: [Node.js](https://nodejs.org) 20 nebo novější a [Git](https://git-scm.com).

## Instalace: Windows, Linux, macOS

```bash
git clone https://github.com/OpiKula2877/Apps.git
cd "Apps/OKfetch/OKfetch - WinLinMac"
npm install
npm run dev
```

`npm run dev` aplikaci spustí. Instalátor si sestavíte takto (výsledek je ve složce `dist/`):

| Systém | Příkaz | Výsledek |
|---|---|---|
| Windows | `npm run dist:win` | `OKfetch-Setup-<verze>.exe` |
| Linux | `npm run dist:linux` | `OKfetch-<verze>.AppImage` |
| macOS (jen na Macu) | `npm run dist:mac` | `OKfetch-<verze>.dmg` |

Instalátory nejsou podepsané. Na Windows klikněte na „Další informace, Přesto spustit“. Na macOS otevřete aplikaci poprvé přes pravé tlačítko, Otevřít. Na Linuxu nastavte souboru práva ke spuštění: `chmod +x OKfetch-*.AppImage`.

Při prvním spuštění na Windows může Windows Defender Firewall zobrazit okno. Zvolte Povolit přístup (stačí soukromé sítě).

## Instalace: Android

Hotové APK v repozitáři není, sestavíte si ho (zatím jen na Windows):

```bash
cd "Apps/OKfetch/OKfetch - WinLinMac"
npm install
cd mobile-worklet && npm install && cd ..
npm run apk
```

Předtím potřebujete JDK 17+, Android SDK 36, Bare Kit 2.5.5 pro Android a vlastní podpisový klíč. Postup krok za krokem je v [OKfetch - WinLinMac/README.md](OKfetch%20-%20WinLinMac/README.md#android-apk). Výsledek `OKfetch.apk` zkopírujte do telefonu a nainstalujte (povolte instalaci z neznámých zdrojů).

## První spojení

1. V **Nastavení, Profil** nastavte **heslo pro příjem** a pošlete kamarádovi svůj **identifikátor** a heslo, každé jinou cestou (např. identifikátor e-mailem, heslo po telefonu).
2. Kamarád zvolí **Přidat kontakt**, vyplní je a odešle žádost.
3. Vy ji v panelu **Žádosti** přijmete, odmítnete nebo zablokujete.
4. Vzniknou dva chaty: šifrovaný a nešifrovaný.

Podrobný návod se záložkami Windows / Linux / macOS je v aplikaci pod ikonou `?` vpravo dole.

## Kde jsou soubory

| | Nastavení vzhledu a cesta k úložišti | Data (zprávy, soubory, klíče) |
|---|---|---|
| Windows | `%APPDATA%\OKfetch` | `C:\OKfetch` |
| Linux | `~/.config/okfetch` | `~/.local/share/okfetch` |
| macOS | `~/Library/Application Support/OKfetch-config` | `~/Library/Application Support/OKfetch` |

Cestu k datům změníte v **Nastavení, Úložiště a systém**. Když se do složky nedá zapisovat, aplikace po startu nabídne výběr jiné.

## Struktura projektu

```
OKfetch - WinLinMac/
  src/core/          čistý TypeScript bez Electronu (testovatelný)
    identity.ts        Ed25519 klíč, identifikátor = z-base-32 veřejného klíče
    encryption/        klíč kontaktu, XChaCha20-Poly1305, důkaz hesla (Argon2id), šifra souborů, ověřovací kód
    network/           Hyperswarm, rámce protokolu, přítomnost online/offline, diagnostika
      relay/             náhradní cesta přes Nostr relay: podpisy, zapečetěné pakety, virtuální spojení
    storage/           cesty, atomický zápis JSON, chat jako JSON-lines s kompakcí
    contacts/          žádosti, přijetí/odmítnutí, profil, blokace
    messages/          odeslání, fronta, potvrzení, čtení, mazání
    files_transfer/    nabídka, přijetí/odmítnutí, bloky 64 KiB, kontrola hashe
    groups/            šifrované i nešifrované skupiny, mesh, last-writer-wins
    security/          limit pokusů o heslo
    api.ts             tabulka handlerů pro UI
    controller.ts      spojuje služby, třídí příchozí rámce, vydává události pro UI
  src/main/          okno, IPC, safeStorage, tray, autostart, notifikace, okfetch-file://
  src/preload/       typované API window.okfetch (contextIsolation + sandbox)
  src/shared/        typy, palety témat, pravidla hesla, pomocné funkce
  src/renderer/src/  React: Fetch, Nastavení, chat, dialogy, nápověda, překlady (cs/en), mobilní rozložení
  src/mobile/        jádro pro telefon v Bare workletu: řádkový protokol, ochrana klíčů, záloha
  mobile-worklet/    balíček workletu (bare-* závislosti)
  android/           projekt Capacitoru a Java (služba, notifikace, zámek, QR, sdílení, soubory)
  tests/             vitest (jednotkové a integrační přes lokální DHT) a smoke/ (Playwright, 2× Electron)
  docs/DESIGN.md     technický návrh
```

## Vývoj

| Příkaz | Co dělá |
|---|---|
| `npm run typecheck` | typová kontrola main i rendereru |
| `npm test` | vitest: krypto, protokol, úložiště, služby jádra, editor, překlady |
| `npm run smoke` | sestaví a spustí 2 instance Electronu a projde kliknutím přidání kontaktu, chat, GIF, výběr, hledání, motivy i nápovědu |
| `npm run dev:two` | dvě okna s oddělenými daty, která se najdou přes lokální DHT (internet netřeba) |
| `npm run smoke:relay` | 2 instance Electronu na oddělených DHT: kontakt a zprávy jen přes veřejné relay |
| `npm run apk` | sestaví podepsané APK |
| `npm run smoke:mobile` | UI telefonu v prohlížeči (Edge, 375×812) s falešným jádrem |
| `npm run smoke:android` | APK na emulátoru (adb) proti jádru v Node přes veřejnou DHT |

Pro testy a vývoj jde použít proměnné prostředí:

| Proměnná | Význam |
|---|---|
| `OKFETCH_DATA_DIR` | složka s daty (přebíjí nastavení) |
| `OKFETCH_CONFIG_DIR` | složka s nastavením; zároveň odděluje instance Electronu |
| `OKFETCH_BOOTSTRAP` | lokální DHT, např. `127.0.0.1:49737` (jinak veřejná HyperDHT) |
| `OKFETCH_FAST_KDF` | lehčí Argon2, jen pro testy |
| `OKFETCH_TEST_PICK_FILE` | okno „Poslat soubor“ vrátí tuto cestu, jen pro testy |
| `OKFETCH_RELAY` | `off` vypne náhradní cestu přes relay |
| `OKFETCH_RELAY_URLS` | vlastní seznam relay oddělený čárkou |

## Omezení

- Soubory se posílají jen mezi dvěma online stranami a jen v chatech s kontaktem. Ve skupinách se posílají pouze zprávy.
- Přerušený přenos nepokračuje, odesílá se znovu.
- Přes relay vidí provozovatel relay čas, velikost šifrovaných bloků a IP adresu. Soubory jsou přes relay pomalé (desítky KB/s).
- Telefon přijímá zprávy, jen když OKfetch běží (volba „Běžet na pozadí“). Bez serveru nejsou push notifikace.
- Záloha `.okfb` je zatím jen na Androidu.

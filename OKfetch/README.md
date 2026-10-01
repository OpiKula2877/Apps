# OKfetch

OKfetch je peer-to-peer chat pro šifrované i nešifrované zprávy, soubory a skupiny. Nepotřebuje server, účet ani placenou službu: data jsou jen na vašem počítači a lidé se spojují přímo, přes veřejnou DHT ([HyperDHT](https://github.com/holepunchto/hyperdht)). Aplikace je napsaná v **React + TypeScript** a běží v **Electronu** na Windows, Linuxu i macOS. Vypadá a nastavuje se stejně jako OKpass.

| Složka | Obsah |
|---|---|
| `OKfetch - WinLinMac` | zdrojový kód (Electron, React, TypeScript), testy a technický návrh v `docs/DESIGN.md` |

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
- **Systém**:
  - Klíče chrání operační systém (DPAPI, Keychain, libsecret).
  - Upozornění na nové zprávy, počet nepřečtených, ikona v liště a spuštění se systémem.
  - Cesta k úložišti jde změnit.
- **Vzhled**:
  - Témata Světlý, Tmavý, OpiKula style a Vlastní (u Vlastního jde nastavit každá barva, včetně barev stavu online a offline).
  - Čeština a angličtina.

## Požadavky

- Připojení k internetu. Za NAT se spojení vytvoří „děrováním“ přes DHT, žádný port otvírat nemusíte.
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
    network/           Hyperswarm, rámce protokolu, přítomnost online/offline
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
  src/renderer/src/  React: Fetch, Nastavení, chat, dialogy, nápověda, překlady (cs/en)
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

Pro testy a vývoj jde použít proměnné prostředí:

| Proměnná | Význam |
|---|---|
| `OKFETCH_DATA_DIR` | složka s daty (přebíjí nastavení) |
| `OKFETCH_CONFIG_DIR` | složka s nastavením; zároveň odděluje instance Electronu |
| `OKFETCH_BOOTSTRAP` | lokální DHT, např. `127.0.0.1:49737` (jinak veřejná HyperDHT) |
| `OKFETCH_FAST_KDF` | lehčí Argon2, jen pro testy |
| `OKFETCH_TEST_PICK_FILE` | okno „Poslat soubor“ vrátí tuto cestu, jen pro testy |

## Omezení

- Soubory se posílají jen mezi dvěma online stranami a jen v chatech s kontaktem. Ve skupinách se posílají pouze zprávy.
- Přerušený přenos nepokračuje, odesílá se znovu.
- Android zatím není. Hyperswarm tam vyžaduje jiný runtime (Bare), což je samostatná práce.

# OKpass

OKpass je šifrovaný správce poznámek a hesel. Data jsou uložená na vašem Google Disku a šifrují se na vašem zařízení, ještě než se nahrají. Aplikace běží na Windows, Linuxu, macOS a Androidu. Všechny verze používají stejný soubor trezoru i stejný klíč.

| Složka | Obsah |
|---|---|
| `OKpass - WinLinMac` | zdrojový kód (Electron, React, TypeScript), desktop i Android projekt |
| `OKpass - Android` | hotová aplikace pro Android (`OKpass.apk`) |

## Funkce

- **Text**: dokumenty s nadpisy, podnadpisy, tučným písmem, kurzívou a odsazením.
- **Hesla**:
  - Každý záznam má pole Název / URL, Uživatelské jméno a Heslo.
  - Přidat jde libovolné vlastní pole a přejmenovat jde i výchozí pole.
  - Součástí je generátor a měřič síly hesla.
- **Ukládání a synchronizace**:
  - Změny se automaticky ukládají na Google Disk, do složky `OKpass`.
  - Bez internetu aplikace funguje s lokální kopií a změny nahraje, až se připojení vrátí.
  - Na Disku se drží zálohy starších verzí a trezor jde exportovat i importovat jako soubor `.okp`.
- **Zabezpečení**:
  - Aplikace se po nečinnosti sama zamkne.
  - Klamný trezor: druhý klíč otevře jiný obsah.
  - Nesprávný klíč nevyhodí chybu, ale ukáže věrohodná falešná data.
- **Android**:
  - Zamknutí při odchodu z aplikace.
  - Zákaz snímků obrazovky.
- **Vzhled**:
  - Témata Světlý, Tmavý, OpiKula style a Vlastní (u Vlastního jde nastavit každá barva).
  - Čeština a angličtina.

## Požadavky

- Google účet a projekt v [Google Cloud Console](https://console.cloud.google.com) se zapnutým Google Drive API.
- Pro desktop: [Node.js](https://nodejs.org) 20 nebo novější a [Git](https://git-scm.com).
- Pro Android: Android 7.0 nebo novější se službami Google Play.

## Instalace: Windows, Linux, macOS

```bash
git clone https://github.com/OpiKula2877/Apps.git
cd "Apps/OKpass/OKpass - WinLinMac"
npm install
npm run dev
```

`npm run dev` aplikaci spustí. Instalátor si sestavíte takto (výsledek je ve složce `dist/`):

| Systém | Příkaz | Výsledek |
|---|---|---|
| Windows | `npm run dist:win` | `OKpass-Setup-<verze>.exe` |
| Linux | `npm run dist:linux` | `OKpass-<verze>.AppImage` |
| macOS (jen na Macu) | `npm run dist:mac` | `OKpass-<verze>.dmg` |

Instalátory nejsou podepsané. Na Windows klikněte na „Další informace, Přesto spustit“. Na macOS otevřete aplikaci poprvé přes pravé tlačítko, Otevřít. Na Linuxu nastavte souboru práva ke spuštění: `chmod +x OKpass-*.AppImage`.

## Instalace: Android

1. Stáhněte [`OKpass.apk`](OKpass%20-%20Android/OKpass.apk) do telefonu.
2. Otevřete ho a povolte instalaci z neznámých zdrojů.
3. Klepněte na Instalovat. Novější verzi nainstalujete stejně a data zůstanou.

## Nastavení Google přihlášení (jednou)

Desktop i telefon musí mít OAuth klienta ve **stejném** Google Cloud projektu. Jinak telefon neuvidí trezor vytvořený na počítači.

1. V projektu zapněte **Google Drive API** (APIs & Services, Library).
2. **Google Auth Platform, Branding**: vyplňte název aplikace a kontaktní e-maily.
3. **Google Auth Platform, Audience**: klikněte na Publish app. V testovacím režimu je nutné přidat svůj účet do Test users a přihlášení vyprší po 7 dnech.
4. **Desktop klient**:
   - Vytvořte Clients, Create client, Desktop app a stáhněte JSON.
   - V aplikaci klikněte na „Vybrat client_secret.json…“.
5. **Android klient**: vytvořte Clients, Create client, Android s těmito hodnotami:
   - Package name: `cz.opikula.okpass`
   - SHA-1: `33:4C:49:B0:90:8B:B0:89:93:AA:55:74:2A:1F:0B:7A:78:9E:77:44` (otisk podpisu přiloženého APK)

Aplikace používá jen oprávnění `drive.file`, takže vidí pouze soubory, které sama vytvořila. Google kvůli tomuto oprávnění nevyžaduje ověření aplikace. Při přihlášení se může objevit hláška „Google hasn't verified this app“. Pokračujte přes Continue.

Podrobný postup je i v aplikaci pod ikonou `?` vpravo dole.

## Vlastní APK

Pokud si sestavujete vlastní APK, potřebujete vlastní podpisový klíč. Android klienta pak zaregistrujte s jeho SHA-1.

```bash
cd "Apps/OKpass/OKpass - WinLinMac"
mkdir -p android/keystore
keytool -genkeypair -keystore android/keystore/okpass.jks -alias okpass -keyalg RSA -keysize 3072 -validity 10950
```

Vytvořte soubor `android/keystore.properties`:

```
storeFile=keystore/okpass.jks
storePassword=VASE_HESLO
keyAlias=okpass
keyPassword=VASE_HESLO
```

Sestavení:

```bash
npm run apk
```

Potřebujete JDK 21 a Android SDK (platform 36, build-tools 36). APK se uloží do `OKpass/OKpass - Android/OKpass.apk`. Klíč si zálohujte, protože aktualizace musí být podepsané stejným klíčem.

## Odinstalace

| Systém | Aplikace | Lokální data (nastavení, přihlášení, offline kopie) |
|---|---|---|
| Windows | Nastavení, Aplikace, OKpass, Odinstalovat | `%APPDATA%\OKpass`, `%LOCALAPPDATA%\OKpass` |
| Linux | smazat soubor `.AppImage` | `~/.config/okpass`, `~/.cache/okpass` |
| macOS | přetáhnout OKpass z Aplikací do koše | `~/Library/Application Support/OKpass`, `~/Library/Caches/OKpass` |
| Android | podržet ikonu, Odinstalovat | smažou se s aplikací |

Trezor na Google Disku zůstane. Pokud ho nechcete, smažte složku `OKpass` na Disku ručně.

## Šifrování

- Klíč má 1 až 32 znaků (ASCII bez mezer, mezery se nepočítají). Nikde se neukládá a nejde obnovit.
- Z klíče se odvozuje tajemství funkcí Argon2id (128 MiB paměti, 4 iterace, 4 vlákna) se solí souboru. Z něj HKDF-SHA256 odvodí samostatné podklíče.
- Obsah se šifruje algoritmem AES-256-GCM. Šifruje se celý trezor včetně struktury, nic z obsahu není čitelné bez klíče.
- **Formát souboru `vault.okp`**:
  - Hlavička a za ní dva stejně velké sloty.
  - Délka obsahu ve slotu je maskovaná a slot je doplněný náhodnými daty, takže bez klíče vypadá jako šum.
  - Druhý slot obsahuje buď klamný trezor, nebo náhodnou výplň a ty dvě možnosti od sebe nejde rozlišit.
- **Nesprávný klíč** neotevře žádný slot. Aplikace pak deterministicky vygeneruje věrohodná falešná data a nic nezapisuje.
- **Otisk prstu (Android)**: odvozené tajemství je zašifrované klíčem v Android Keystore, který jde použít jen po ověření otiskem. Přidání nového otisku v telefonu uložené tajemství zneplatní.
- **Omezení**: kdo má soubor trezoru, může zkoušet klíče offline. Argon2id to výrazně zpomalí, ale slabý klíč neochrání. Používejte dlouhý, náhodný klíč.

## Vývoj

```bash
npm test               # unit testy
npm run typecheck
npm run smoke          # celý desktop v Electronu
npm run dev:local      # bez Google Disku, data v lokální složce ./dev-drive
```

Struktura kódu:

- `src/core`: šifrování, trezor a synchronizace (sdílené pro desktop i Android)
- `src/main`: Electron
- `src/renderer`: React UI
- `android`: Capacitor projekt s nativními pluginy

Technický popis je v `OKpass - WinLinMac/docs/DESIGN.md`.

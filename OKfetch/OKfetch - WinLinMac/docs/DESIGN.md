# OKfetch – technický návrh

Tento dokument je pro vývojáře. V nápovědě aplikace se nezobrazuje. Zadání je v `../../OKfetch.md`.

## Procesy

- **Main proces** (`src/main`) drží jádro (`src/core/controller.ts`), klíče, síť a všechna data.
- **Preload** zpřístupní typované API `window.okfetch` (`src/shared/ipc.ts`). Metody volané přes `invoke` jsou v seznamu `API_METHODS`; TypeScript ohlídá, že žádná nechybí a že main implementuje každou (`ApiHandlers`). Okno běží s `contextIsolation` a `sandbox`.
- **Renderer** (React) nedrží žádná tajemství. Seznamy (kontakty, skupiny, žádosti) si načítá z IPC a obnovuje je podle událostí jádra (`UiEvent`). Zprávy chatu si žádá po změně `chat`.
- Obsah příchozích zpráv je nedůvěryhodné HTML. Renderer ho před zobrazením čistí přes DOMPurify (jen `p br h1 h2 strong em b i a`, odkazy jen `http(s)`/`mailto`, `data-indent` 0–10). Kliknutí na odkaz otevře systémový prohlížeč přes `shell.openExternal`, a to jen pro `http(s)`/`mailto`.
- CSP rendereru: `default-src 'self'`, obrázky jen `self`, `data:` a `okfetch-file:`.

## Identita a spojení

- Identita je klíčový pár Ed25519. Tajná část je v `identity.json` zabalená přes `safeStorage` (DPAPI / Keychain / libsecret).
- Identifikátor je z-base-32 veřejného klíče (52 znaků). Nemění se se sítí ani IP.
- Spojení vytváří Hyperswarm (`network/swarm.ts`): `joinPeer(klíč)` najde protistranu přes DHT a udělá hole-punching. Transport (Noise) dokazuje veřejný klíč protistrany, takže další handshake identity není potřeba.
- Hyperswarm vzdá explicitního peera po několika pokusech. `PeerNetwork` proto každých 20 s znovu zkusí ty, které chceme a jsou offline (`attempts = 0` + `joinPeer`).
- Přítomnost: online = otevřené spojení (přímé, nebo přes relay – `Peer.via`).
- `diagnostics()` vrací stav DHT, veřejnou adresu, `firewalled`, `randomized` (NAT s náhodnými porty) a stav relay; `probe(klíč)` zkusí `dht.connect` a vrátí kód chyby (např. `HOLEPUNCH_DOUBLE_RANDOMIZED_NATS`). UI je v Nastavení → Síť a diagnostika spojení.
- Rámec: `[u32 délka][u8 typ][payload]`, typ 1 = JSON, typ 2 = blok souboru (`[16 B id][u32 index][data]`). Největší rámec je 1 MiB, větší zavře spojení.

## Náhradní cesta přes relay (`network/relay/`)

Když jsou obě strany za NAT s náhodnými porty, HyperDHT díru neprorazí a nemá vlastní server, který by provoz přenesl. OKfetch proto použije veřejné **Nostr relay** (WebSocket, bez účtu):

- Pokud se kontakt nespojí přímo do 8 s (`afterMs`), `PeerNetwork.scheduleRelay` otevře `RelayLink`. Relay spojení nikdy nenahradí přímé; přímé nahradí relay, jakmile vznikne.
- Paket = efemérní událost kind `21430` (NIP-01, podpis BIP-340 náhodným klíčem, nový při každém spuštění, nesouvisí s identitou). Adresát se hledá podle tagu `#p` = BLAKE2b(`okfetch/v1/mailbox` ‖ veřejný klíč), takže identifikátor na relay není vidět.
- Obsah je zapečetěný XChaCha20-Poly1305 klíčem ze statického X25519 DH (klíče převedené z Ed25519 identit), AD = `okfetch/v1/relay` ‖ od ‖ komu. Relay ani nikdo jiný ho nepřečte ani nepodvrhne.
- `RelayLink` je virtuální spojení se stejným rozhraním jako Noise stream: pořadová čísla, přerovnání, zahození duplikátů, zavření po díře delší než 10 s, `hello` pingy, keepalive 25 s, nečinnost 75 s, bloky 16 KiB a zpětný tlak (fronta 48/12).
- `RelayTransport` posílá na až 3 relay zároveň (stejný paket, příjemce duplikáty zahodí), drží rychlostní limit, při výpadku se znovu připojí s odstupem a relay, které selhává, na chvíli vynechá.
- Telefon (Bare) používá `bare-ws`, počítač globální `WebSocket` z Node/Electronu.

## Kdo smí co (`controller.ts`, `handleFrame`)

| Protistrana | Smí poslat |
|---|---|
| blokovaná | nic (spojení se zavře hned) |
| kontakt | vše |
| člen skupiny (nekontakt) | rámce skupin; zprávy jen do skupin, kde je v soupisu členů |
| cíl mé žádosti | `challenge`, `request_result`, `rack` |
| cizí | `request` po mé výzvě (`challenge`); po 30 s bez aktivity se spojení zavře |

## Přidání kontaktu

1. Žadatel A zná identifikátor a heslo příjemce B. `K = Argon2id(heslo, sůl = BLAKE2b(pubB)[:16])` (64 MiB, 3 iterace).
2. B po spojení pošle `challenge {nonce}`. A odpoví `request {proof, key, username}`:
   - `proof = BLAKE2b(klíč K, "proof" ‖ nonce ‖ pubA ‖ pubB)`
   - `key` = náhodný 16znakový klíč kontaktu zašifrovaný klíčem odvozeným z `K` a `nonce`
3. B ověří proof (konstantní čas) a vybere pokus z `RateLimiter`: 5 špatných hesel na veřejný klíč = blokace na 15 minut, k tomu globální strop 30 špatných pokusů za 15 minut proti zkoušení z nových identit.
4. B žádost uloží a odpoví `received`. A si pamatuje, že žádost dorazila, a už ji neposílá znovu.
5. Přijetí: B uloží kontakt a pošle spolehlivý `request_result {accepted}`. Při odmítnutí jde `declined` s vysvětlením, při blokaci nic.

## Dva chaty na kontakt

- `<identifikátor>:enc` a `<identifikátor>:plain`. Na drátě se chat jmenuje jen `enc` / `plain`; příjemce si jméno chatu složí ze své strany.
- Šifrovaný chat: `html` se šifruje XChaCha20-Poly1305. Klíč = `BLAKE2b(kontext ‖ seřazené veřejné klíče)` s 16znakovým klíčem kontaktu jako klíčem hashe. Přidaná data `okfetch/msg/<chat>/<id>` svazují text s chatem a zprávou. Šifrovaný text je i v `messages.jsonl`.
- Nešifrovaný chat: běžný text. Soubory se posílají jako surové bloky.
- Klíče kontaktů a skupin leží v `contacts.json` / `groups.json` zabalené přes `safeStorage`.

## Spolehlivé doručení

- Rámce s polem `rid` (`msg`, `read`, `del`, `request_result`, `file_*`, `group_*`) se ukládají do `outbox.json` a po každém navázání spojení se posílají znovu v pořadí. Příjemce odpoví `rack`, odesílatel záznam smaže.
- Příjemce je idempotentní: zprávu se stejným id uloží jednou, ale potvrdí pokaždé.
- Zpráva si pamatuje `waiting` (kdo ji ještě nepotvrdil) a `read`. Stav = hodiny (čeká), ✓ (doručeno), ✓✓ (přečteno).
- Limit 5000 znaků platí pro zprávy, které musí čekat, protože aspoň jeden příjemce je offline.
- Mazání: „pro mě“ vyřadí zprávu i z fronty. „Pro oba“ je jen pro vlastní zprávy; příjemce smaže jen zprávy, jejichž autorem je odesílatel `del`.
- Pořadí zpráv určuje Lamportovy hodiny odesílatele, pak čas a id.

## Chat na disku

`chats/<chat>/messages.jsonl`: jeden záznam na řádek (`m` zpráva, `u` změna, `d` náhrobek). Při načtení se záznamy složí; poslední utržený řádek po pádu se přeskočí. Soubor se přepíše (kompakce), když je záznamů víc než trojnásobek zpráv a aspoň 200.

## Soubory

1. `file_offer {id, chat, meta}`; `meta` je JSON (u šifrovaného chatu zašifrovaný) s `name`, `size`, `mime`, `hash` (BLAKE2b-256).
2. Příjemce odpoví `file_accept` nebo `file_reject {feedback}`.
3. Odesílatel čte po 64 KiB a posílá bloky. `Peer.sendBlock` čeká na `drain`, když je buffer plný (zpětný tlak). V šifrovaném chatu se blok šifruje klíčem odvozeným z klíče chatu a id souboru, nonce je číslo bloku.
4. Příjemce zapisuje do `.part`, průběžně počítá hash. Po `file_end` zkontroluje počet bloků, velikost a hash, přejmenuje soubor a odpoví `file_done`.
5. Soubor smí být jen v `files/<chat>/<id>_<bezpečné jméno>`. Protokol `okfetch-file://f/…` obsluhuje jen soubory pod `files/` (`core/storage/safePath.ts`).
6. Přenos, který běžel při ukončení, se zobrazí jako neúspěšný. Pokračování není.

## Skupiny

- Skupina: `{id, name, type, members[], lamport, by}` a 16znakový klíč u šifrovaných.
- Zakladatel pošle členům (kontaktům) `group_invite`; klíč je zabalený klíčem kontaktu. Člen pozvánku přijme (`group_join`) nebo odmítne.
- Mesh: každý člen se spojuje s každým (`joinPeer`). Soupis členů ve skupině opravňuje spojení i mezi lidmi, kteří nejsou kontakty.
- Zpráva se rozešle každému členovi zvlášť; pro offline členy čeká ve frontě. Zpráva je „doručená“, až ji potvrdí všichni.
- Název a členy může měnit kdokoli. Platí poslední zápis: větší `(lamport, veřejný klíč autora)` vyhrává. Odchod = `group_update` bez sebe.

## Bezpečnost – shrnutí

- Tajemství jsou jen v main procesu, zabalená OS (`safeStorage`). Na Linuxu bez peněženky (`basic_text`) ukáže Nastavení varování.
- Heslo pro příjem se nikdy neposílá, jen důkaz o jeho znalosti. Limit pokusů je v `security/rateLimit.ts`.
- Příchozí rámce se kontrolují (velikosti, id, členství) a neznámé typy se zahazují. Chyba v handleru jednoho rámce nezastaví ostatní.
- Ověřovací kód kontaktu (6×5 číslic) vzniká z obou veřejných klíčů; shoduje-li se, není mezi stranami útočník.

## Testy

- `tests/crypto.test.ts`, `storage.test.ts`, `units.test.ts`, `editor.test.ts` (jsdom), `i18n.test.ts` – jednotkové.
- `tests/network.test.ts`, `core.test.ts` – integrační přes lokální DHT (`hyperdht/testnet`): špatné heslo a blokace, přidání kontaktu, zprávy šifrovaně i nešifrovaně, fronta pro offline uzel, mazání, přenos souboru (enc i plain) s hashem, odmítnutí s vysvětlením, skupina o třech členech s přejmenováním od nezakladatele, blokace.
- `tests/relay.test.ts`, `relayTransport.test.ts` – Nostr podpisy, pečetění paketů, `RelayLink` (pořadí, duplikáty, díra, kusy, zpětný tlak) a transport proti falešnému relay (`tests/helpers/fakeRelay.ts`). `network.test.ts` a `core.test.ts` mají i scénář se dvěma oddělenými DHT, kde vše jde přes relay.
- `tests/relayLive.test.ts` – totéž proti skutečným veřejným relay (jen s `OKFETCH_LIVE_RELAYS=1`).
- `tests/smoke/run-smoke.mjs` – dvě instance Electronu přes Playwright.
- `tests/mobile.test.ts`, `backup.test.ts`, `mobileApi.test.ts` – most k jádru, ochrana klíčů na telefonu, obsah QR, záloha (tam a zpět, špatné heslo, useknutý soubor, cesty mimo složku), API telefonu proti workletu v Node.
- `tests/bare.test.ts` – jádro telefonu v runtime **Bare** na Windows (síť je nahrazená sítí v paměti, protože Smart App Control nepustí nepodepsaný `udx-native.bare`): kontakt, zprávy, soubor, úklid kopií, záloha, restart, ztracený klíč.
- `tests/smoke/run-mobile-ui.mjs` – UI telefonu v Edge (375×812, dotyk) s falešným jádrem.
- `tests/smoke/run-android.mjs` – APK na emulátoru proti jádru v Node přes veřejnou HyperDHT, ovládané přes adb a uiautomator.

## Android

Zadání je v `../../docs/superpowers/specs/2026-10-03-okfetch-android-design.md`.

### Vrstvy

```
WebView (Capacitor)        Java                                Bare worklet (Bare Kit)
React UI, mobileApi   ⇄   OkfetchPlugin ⇄ CoreHub (vlákno)  ⇄  src/mobile/main.ts → worklet.ts
window.okfetch             CoreService, Notifier, AppLock,      Core + core/api.ts (stejné jako PC)
                           HostRouter/HostActions, KeyStoreBox
```

- **Protokol** (`src/mobile/rpc.ts`): jeden JSON na řádek. `call` (UI nebo Java → jádro), `reply`, `event` (jádro → všem), `host` (jádro žádá Javu: výběr souboru, otevření, sdílení, uložení, dialog pro zálohu). Id říká, kdo se ptá: `w…` WebView, `j…` Java, `h…` worklet. Bajty jako `{$bytes: base64}`, chybějící argument v poli jako `{$u: 1}`.
- **Start:** `CoreHub` načte `okfetch.bundle` z assets, spustí worklet a pošle `init` (složky a datový klíč). Jádro odpoví stavem `ready`, `keys` (klíč z Keystore chybí) nebo `storage`.
- **Klíče:** 32 náhodných bajtů (datový klíč) leží v `files/config/data_key.bin` zabalené AES-GCM klíčem z Android Keystore, který nejde vyexportovat. Jádro jím šifruje tajemství (`dk:` bloby, XChaCha20-Poly1305). Systémová záloha Androidu je vypnutá (`allowBackup=false`).
- **Úložiště:** `files/okfetch` (data jádra), `files/config/settings.json` (nastavení; Java ho čte při startu a pak sleduje událost `settings`).
- **Soubory:** vybraný soubor, fotka nebo sdílený soubor se zkopíruje do `files/okfetch/outgoing/<token>/<jméno>`. Kopie se smaže, když přenos skončí. Kopie, kterou žádná nabídka nepoužívá, se smaže po hodině. Přijaté obrázky servíruje `OkfetchWebViewClient` z `https://localhost/okfetch-file/f/…`, ale jen soubory pod `files/okfetch/files/`. Obecný přístup Capacitoru k souborům (`/_capacitor_file_`) je vypnutý.
- **Na pozadí:** `CoreService` je služba v popředí (`specialUse`) s trvalou notifikací. Když je volba vypnutá, jádro se zastaví minutu po odchodu z aplikace. Po restartu telefonu ji spustí `BootReceiver`.
- **Notifikace:** `Notifier` reaguje na události `incoming` a `request`, jen když aplikace není na obrazovce. Odpověď a „Přečteno“ obsluhuje `ReplyReceiver`: volá `sendMessage` a `markRead` přímo přes `CoreHub`, bez UI a bez zámku.
- **Zámek:** `AppLock` je nativní překryv nad WebView a `BiometricPrompt` (otisk nebo PIN či gesto). Zamyká při startu a po návratu po „Zamknout po“ minutách. Systémové obrazovky, které aplikace otevře sama (výběr souboru, fotoaparát, sdílení, QR), se za odchod nepočítají.
- **Záloha** (`src/core/backup.ts`): hlavička (magic `OKFB`, sůl, parametry Argon2id, prefix nonce), pak bloky XChaCha20-Poly1305 po 64 KiB. Poslední blok má značku, takže useknutý soubor se pozná. Tajemství (`*Blob`) jsou uvnitř zabalená heslem zálohy a při obnově je znovu zabalí klíč zařízení. Obnova rozbalí data do dočasné složky a stará data nahradí až nakonec.

### UI telefonu

- Rozložení pro telefon platí pro Android a šířku pod 768 px: seznam nebo chat přes celou obrazovku, dialogy přes celou obrazovku, Nastavení jako seznam sekcí.
- Tlačítko Zpět (`mobile/phone.ts`) nejdřív zavře dialog, menu nebo nabídku (pošle Escape), pak nejvnitřnější obrazovku. Na seznamu pošle aplikaci na pozadí.
- Dlouhé podržení: Android posílá ve WebView `contextmenu`, takže menu kontaktu funguje beze změny a podržení zprávy zapne výběr.
- `webFake.ts` a `webNative.ts` nahrazují jádro a Javu v prohlížeči (`npm run dev:mobile`, UI testy).

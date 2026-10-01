# OKfetch – technický návrh

Tento dokument je pro vývojáře. V nápovědě aplikace se nezobrazuje.

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
- Přítomnost: online = otevřené spojení.
- Rámec: `[u32 délka][u8 typ][payload]`, typ 1 = JSON, typ 2 = blok souboru (`[16 B id][u32 index][data]`). Největší rámec je 1 MiB, větší zavře spojení.

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
- `tests/smoke/run-smoke.mjs` – dvě instance Electronu přes Playwright.

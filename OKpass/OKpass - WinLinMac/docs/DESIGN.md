# OKpass (React/Electron) – technický návrh

Tento dokument je pro vývojáře. V nápovědě aplikace se nezobrazuje. Úplná specifikace je v `../docs/superpowers/specs/2026-10-01-okpass-react-design.md`.

## Procesy

- **Main proces** (`src/main`) drží veškerou logiku a tajemství:
  - šifrování
  - session
  - repository
  - OAuth
  - Disk
  - nastavení
- **Preload** zpřístupní typované API `window.okpass` (viz `src/shared/ipc.ts`). Okno běží s `contextIsolation` a `sandbox`.
- **Renderer** (React) dostane jen `VaultData` (dešifrovaný obsah bez `partner`) a stav obrazovky.
  - Úpravy dělá lokálně.
  - Celé `VaultData` posílá přes `vault:save` 1,5 s po poslední změně.
  - Šifrování a uložení zařídí main proces.
- Úložné operace v controlleru běží jedna po druhé přes jednu promise frontu (`serial`).
- Při zavření okna main proces nejdřív požádá renderer o uložení neuložených úprav (`app:flush`). Pak počká na frontu a teprve potom okno zavře.

## Klíč

- Z klíče se odstraní mezery. Pak musí mít 1–32 tisknutelných ASCII znaků (33–126).
- Argon2id (hash-wasm): 128 MiB, 4 iterace, 4 vlákna. Sůl má 16 B, patří k souboru a nemění se.
- HKDF-Expand odvodí z master klíče tři podklíče:
  - `enc` (`okpass/v1/slot-encryption`)
  - `lengthMask` (`okpass/v1/slot-length`)
  - `fakeSeed` (`okpass/v1/decoy-generator`)

## Soubor `vault.okp` (stejný jako Python verze)

```
hlavička: "OKPASS" | verze u8 | memory_kib u32 | iterations u32 | lanes u8 | salt 16 | slot_count u8 (=2) | slot_size u32
sloty:    2 × slot_size
slot:     nonce 12 | (délka ciphertextu XOR HMAC(lengthMask, nonce)[:4]) | AES-GCM(zlib(JSON)) + tag | náhodná výplň
```

- AAD je hlavička bez `slot_size`.
- Velikost slotu je násobek 64 KiB a oba sloty mají vždy stejnou velikost.
- Šifruje se celý trezor včetně struktury.

## JSON trezoru

```json
{"format":1,"profile":{"username":""},"documents":[{"id","title","html","created","modified"}],
 "passwords":[{"id","created","modified","fields":[{"id","kind","name","value"}]}],
 "partner":"<b64 32 B>","decoy_set":false}
```

- `kind` je `title` | `username` | `password` | `custom`.
- `name: null` znamená přeložený výchozí popisek. Od React verze může mít i výchozí pole popisek od uživatele.
- Časy jsou v sekundách.

## Klíč, který neotevře žádný slot

- `generateVault(fakeSeed, jméno vlastníka, e-mail vlastníka)` vytvoří věrohodný obsah.
- PRNG je xoshiro128** se seedem ze `fakeSeed`. Výsledek je deterministický, všechna data jsou před rokem 2026 a obsah nezávisí na jazyku.
- HTML z generátoru má stejnou strukturu jako výstup editoru.
- Taková session nic nezapisuje (`Session.writes === false`). Indikátor přesto ukáže „Uloženo“.
- Falešná data pro daný klíč se liší od Python verze. Změní se jednou při přechodu na tuto verzi a pak zůstanou stejná.

## Klamný trezor

- Skutečný trezor drží master klíč klamného v `partner`. Při každém uložení přešifruje oba sloty s novými nonce.
- Klamný trezor má náhodný `partner` a žádný příznak.
- Session přepíše druhý slot jen tehdy, když ho sama otevřela svým klíčem `partner`. Klamná session (i session bez shody) proto skutečný slot nikdy nepoškodí.
- Známé hranice:
  - GCM tag umožní útočníkovi, který má soubor, zkoušet klíče offline. Argon2id to zpomalí.
  - Kdo zná kód, ví, že soubor má vždy 2 sloty.

## Synchronizace

- `LocalCache` je oddělená pro každý účet (sha256 z `permissionId`). Obsahuje `vault.okp` a `meta.json`.
- Offline: uložení dostane stav `pending` a upload se zkouší každých 60 s.
- Konflikt: vyhraje lokální verze. Verze z Disku se uloží jako `…-conflict.okp`.
- Zálohy:
  - Verze na Disku se zkopíruje dřív, než se přepíše. Poprvé při prvním uložení v session, pak nejvýš jednou za 30 min. Drží se jen N nejnovějších.
  - Obnova a import vždy nejdřív zazálohují aktuální verzi.

## OAuth

- `google-auth-library` OAuth2Client otevře systémový prohlížeč. Loopback server běží na `127.0.0.1:<náhodný port>`, s PKCE (S256) a `state`.
- `token.json` má stejný formát jako v Python verzi: `token`, `refresh_token`, `expiry`, …
- Disk se volá přes REST `fetch` s bearer tokenem z `getAccessToken()`, který token sám obnovuje.
- Mapování chyb (`drive/errors.ts`):
  - 401 / `invalid_grant` → `AuthError` (zpět na přihlášení)
  - síť, 408 / 429 / 5xx → `OfflineError` (cache a pending)
  - cokoli jiného → `BackendError`

## Editor

- TipTap se StarterKitem omezeným na odstavce, H1/H2, tučné a kurzívu, plus rozšíření `Indent` (`data-indent`).
- Editor čte Qt HTML z Python verze: `-qt-block-indent`, `font-weight:700`, `font-style:italic`.
- Zkratky:
  - Tab / Shift+Tab: odsadit / zmenšit odsazení
  - Mod-0/1/2: normální text, nadpis, podnadpis
- Cokoli jiného schéma zahodí, například vložené barvy, písma a seznamy.

## Okno

- Okno je ve výchozím stavu bez systémového rámu a má vlastní TitleBar (`-webkit-app-region: drag`).
- Přepínač „Systémová lišta okna“ otevře okno znovu s `frame: true`. Session zůstává v main procesu.
- Spustit jde jen jedna instance (`requestSingleInstanceLock`), takže dvě okna nikdy nezapisují do stejné cache.

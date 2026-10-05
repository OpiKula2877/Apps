# OKgram – technický návrh

Tento dokument je pro vývojáře. V nápovědě aplikace se nezobrazuje.

## Procesy a okna

- **Main proces** (`src/main`) drží stav celé aplikace v `Controller`:
  - volbu úložiště a přihlášení
  - otevřenou knihovnu (seznam médií a data z `okgram.json`)
  - ukládání, offline frontu a synchronizaci
  - přenosy (nahrávání, stahování, ZIP)
  - nastavení
- **Preload** zpřístupní typované API `window.okgram` (viz `src/shared/ipc.ts`). Okna běží s `contextIsolation` a `sandbox`.
- **Dvě okna** ze stejného rendereru:
  - okno knihovny (záložky Média a Alba)
  - okno prohlížeče (argument `--okgram-viewer`). Je jen jedno a znovu se použije. Hlavní okno mu přes main pošle seznam id a index (`viewer:open` → `viewer:context`).
- Main posílá změny všem oknům: `screen`, `library` (seznam médií), `data`, `status`, `transfers`, `settings`.
- Okna data nemění přímo. Posílají operace `DataOp` (`data:mutate`). Main je aplikuje funkcí `applyOp()` (`src/shared/model.ts`) a výsledek rozešle. Dvě okna se tak nikdy nepřepíšou.

## Protokol `okgram://`

- `okgram://thumb/<id>?v=<verze>` vrací miniaturu z cache, nebo ji vytvoří:
  - Disk: náhled od Google (`thumbnailLink` s bearer tokenem, velikost `=s480`)
  - PNG/JPEG: zmenšení přes `nativeImage` na 480 px
  - GIF a SVG: soubor sám
- `nativeImage` ignoruje EXIF orientaci. Otočené JPEGy (orientace 2–8) a videa bez náhledu proto dostanou 404. Okno pak miniaturu nakreslí samo:
  - fotka: `createImageBitmap` s `imageOrientation: from-image`
  - video: snímek z `<video>`
  - výsledek pošle zpět přes `media:thumbnail`
  - u videa přidá i rozměry a délku (`videos.json` v cache)
- `okgram://media/<id>` streamuje soubor a podporuje hlavičku `Range`, takže převíjení videa stahuje jen potřebné části:
  - Disk: Range se předá do `files/<id>?alt=media`
  - počítač: `fs.createReadStream(start, end)` → 206
- Schéma je `standard, secure, stream, corsEnabled` a odpovědi mají `Access-Control-Allow-Origin: *`. Díky tomu canvas z videa není „tainted“.

## Data (`okgram.json`)

```json
{"app":"okgram","format":1,
 "profile":{"username":"","modified":0},
 "prefs":{…téma, jazyk, miniatury, řazení, prezentace…},"prefs_modified":0,
 "albums":[{"id","name","icon","color","parent","cover","items":[id…],"order","created","modified"}],
 "items":{"<id>":{"star","color","rotation","modified"}},
 "deleted":{"<album id>":time}}
```

- Časy jsou v ms.
- Id média:
  - Disk: id souboru
  - počítač: cesta relativní ke složce s `/`. Přejmenování posílá `rekey`.
- **Slučování** (`mergeData`): u každého alba, položky, profilu i nastavení vyhraje vyšší `modified`.
  - Smazaná alba drží náhrobek (`deleted`, 180 dní), aby se nevrátila.
  - Album, kterému zmizel rodič, se přesune na nejvyšší úroveň.
- **Ukládání**: 1 s po poslední operaci. Postup:
  1. Zjistí revizi souboru (Disk `md5Checksum`, počítač sha1).
  2. Když se liší od poslední známé, stáhne soubor, sloučí ho a teprve pak zapíše.
  3. Offline: stav `pending`, kopie v cache s příznakem, nový pokus každých 60 s.
- Poškozený `okgram.json` se uloží do cache jako `okgram-damaged-<čas>.json` a knihovna začne s prázdnými daty. Přepíše se až s první změnou.
- **Nastavení**: `Prefs` (vzhled, řazení, prezentace) se ukládají s knihovnou, takže jsou stejná na každém počítači.
  - Kopie je i v `settings.json`, aby téma platilo ještě před otevřením knihovny.
  - `DeviceSettings` (úložiště, složky, interval synchronizace, velikost oken, hlasitost) jsou jen v `settings.json`.

## Google Disk

- Scope `drive.file`. Složka `OKgram` v kořeni Disku, média přímo v ní.
- Seznam: `files.list` po 1000 položkách se stránkováním. Pole: rozměry a čas EXIF z `imageMediaMetadata`, délka z `videoMediaMetadata`, `md5Checksum` jako verze.
- Nahrávání je resumable po 8 MiB:
  - Při výpadku se zjistí přijatý rozsah (`Content-Range: bytes */size`) a pokračuje se.
  - `modifiedTime` se nastaví podle souboru, aby řazení podle data sedělo.
- Chyby:
  - 401: obnoví token a zkusí jednou znovu
  - 429/5xx: zopakuje se 3× s rostoucí pauzou
  - pak `OfflineError` (síť, 408, 429, 5xx), `AuthError` (401, `invalid_grant`) nebo `BackendError`
- Smazání nastaví `trashed: true` (koš Disku). Sdílení vytvoří oprávnění `anyone/reader`, zrušení smaže `anyoneWithLink`.

## Lokální složka

- Rekurzivní průchod (hloubka 12, nejvýš 100 000 souborů, bez skrytých složek).
- Rozměry a EXIF čas se čtou z prvních 256 KiB (`core/imageSize.ts`). Cache je podle verze `velikost-mtime`.
- `fs.watch` s `recursive`: změna ve složce obnoví seznam po 1,5 s.
- Nahrání kopíruje soubor do kořene složky s volným názvem a zachová datum souboru.
- Mazání: `shell.trashItem`. Cesty z oken prochází `resolveInside()`, takže nemohou mimo složku.

## OAuth

- Stejné jako OKpass: `google-auth-library`, systémový prohlížeč, loopback `127.0.0.1:<náhodný port>`, PKCE (S256) a `state`.
- Token se ukládá přes `safeStorage` do `token.bin`. Na Linuxu bez úložiště klíčů (`basic_text`) jde do `token.json` s právy 600.

## Okno a vzhled

- Bez systémového rámu, vlastní `TitleBar`. Přepínač „Systémová lišta okna“ obě okna znovu vytvoří.
- Témata, barvy a prvky jsou stejné jako v OKpass (`src/shared/theme.ts`, OK Apps design system). Písmo Cascadia Code.
- Mřížka je virtualizovaná: vykreslují se jen řádky v pohledu.
- Spustit jde jen jedna instance (`requestSingleInstanceLock`).

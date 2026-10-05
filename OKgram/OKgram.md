# Prompt: OKgram – prohlížeč médií nad Google Drive

> **Jak s tímhle souborem pracovat:** Projdi sekci **„Návrhy navíc"** a zaškrtni `[x]` u věcí, které chceš mít v aplikaci. Pak celý soubor vlož do AI. Nezaškrtnuté věci se nebudou dělat.

---

## 1. Zadání

Napiš v **Pythonu** kompletní, plně funkční aplikaci s grafickým rozhraním (**CustomTkinter** nebo **PyQt** – vyber to, co je pro tenhle projekt vhodnější, a krátce zdůvodni proč; důležité je hlavně přehrávání videí, zobrazení SVG a zoom obrázků).

Aplikace se jmenuje **OKgram** a slouží jako **prohlížeč fotek a videí uložených na Google Drive**.

Dodrž přesně specifikaci níže.

---

## 2. Platformy a struktura složek

Podporované systémy: **Windows, Linux, macOS**.

- Pokud program poběží na všech platformách ze stejného kódu, **nedělej samostatné verze** a složku pojmenuj **`OKgram - WinLinMac`**.
- Pokud budou zásadní rozdíly a bude potřeba více programů, udělej **`OKgram - Win`** a **`OKgram - LinMac`**.
- Na začátku odpovědi napiš, kterou variantu jsi zvolil a proč.

---

## 3. Přihlášení a Google Disk

### 3.1 Přihlášení
- Po spuštění se zobrazí okno s přihlášením přes **Google OAuth**.

### 3.2 Synchronizace s Google Drive
- Po přihlášení se aplikace připojí k účtu přes **Google Drive API**.
- Na Disku **automaticky vytvoří složku `OKgram`** (pokud už neexistuje).
- Ve složce `OKgram` vytvoří a spravuje **soubor s daty aplikace** (uživatelské jméno, nastavení, alba, hvězdičky, barevné rámečky atd.).

### 3.3 Správa účtu
- Uživatel se může **odhlásit**.
- Uživatel může **upravit uživatelské jméno**.
- Vše se ukládá na Google Disk.

### 3.4 Nastavení

**a) Téma (Theme)**
- Světlý mód
- Tmavý mód
- **„OpiKula style"** – tematika v červené, černé a jejich odstínech
- **Vlastní** – plně nastavitelné barvy (pozadí, lišty, text, okénka atd.) + možnost zapínat/vypínat vizuální prvky (např. rámeček v liště)

**b) Další nastavení**
- Buď žádné další, nebo přidej něco užitečného, co se sem hodí. **Vždy to uveď jako návrh s checkboxem** (viz sekce 6).

---

## 4. Záložky

### 4.1 Média
- Zobrazuje **všechny nahrané fotky a videa**.
- Podporované formáty:
  - Obrázky: `.png` `.jpg` `.jpeg` `.gif` `.svg`
  - Videa: `.mp4` `.mov` `.mkv` `.avi` `.webm`
- Klasický prohlížeč médií s **vyhledáváním**.
- **Kliknutí** na položku ji otevře v **novém okně aplikace**:
  - obrázek: zobrazení + **přiblížení (zoom)**
  - video: **přehrání** (play/pauza, posuvník, hlasitost)
- **Pravé tlačítko myši** otevře kontextové menu, minimálně:
  - Stáhnout
  - Dát do barevného rámečku
  - Přidat hvězdičku
  - Přidat do alba
  - další potřebné akce viz sekce 6 (návrhy s checkboxem)
- **Řazení:** podle data, podle abecedy, podle formátu.

### 4.2 Album
- Uživatel si vytváří „složky" (alba).
- Musí to být **jednoduché na použití** (simple use).
- U alba lze: **vybrat ikonu, přejmenovat, přesunout** atd.
- Další funkce, které se sem hodí, navrhni v sekci 6.

---

## 5. Požadavky na výstup

1. **Kompletní, plně funkční kód** v Pythonu, rozdělený do přehledných modulů, např.:
   - `gui/` – okna, záložky, dialogy, témata
   - `drive/` – komunikace s Google Drive API, OAuth
   - `security/` – šifrování a bezpečné uložení tokenů
   - `data/` – modely a práce s datovým souborem
   - `main.py` – vstupní bod
2. Soubor **`requirements.txt`**.
3. **Nápověda přímo v GUI:** tlačítko **„?" v kroužku vpravo dole**. Obsah nápovědy:
   - kde co v aplikaci je
   - jak se přihlásit
   - jak zprovoznit Google OAuth (vytvoření projektu, zapnutí Drive API, `credentials.json`)
   - **záložky pro Windows, Linux a macOS** – pouze pokud se postup liší
   - **NE** technické detaily jako fungování šifrovacích klíčů nebo reálná data uživatele
4. Před kódem uveď **stručný přehled struktury projektu** a návod na spuštění.

---

## 6. Návrhy navíc (zaškrtni, co chceš)

> AI: implementuj **pouze zaškrtnuté** položky `[x]`. Pokud tě napadne něco dalšího, co by tam nemělo chybět, **nepřidávej to sám**, ale na konci odpovědi to vypiš jako nový seznam s checkboxy k rozhodnutí.

### Média – kontextové menu a práce se soubory
- [ ] Nahrát fotky/videa z počítače na Drive (tlačítko + drag & drop)
- [ ] Smazat (přesun do koše, s potvrzením)
- [ ] Přejmenovat soubor
- [ ] Zobrazit detaily (velikost, rozlišení, datum, formát)
- [ ] Oblíbené (filtr „pouze s hvězdičkou")
- [ ] Filtr podle barevného rámečku
- [ ] Hromadný výběr více souborů (stáhnout / smazat / do alba najednou)
- [ ] Kopírovat odkaz ke sdílení (Google Drive link)
- [ ] Prezentace (slideshow) přes celou obrazovku
- [ ] Navigace šipkami v prohlížeči (předchozí/další) a klávesové zkratky
- [ ] Miniatury s cache na disku (rychlejší načítání)
- [ ] Otočení obrázku ve prohlížeči
- [ ] Mřížka vs. seznam (přepínač zobrazení) + posuvník velikosti miniatur

### Album
- [ ] Vnořená alba (album v albu)
- [ ] Barva alba vedle ikony
- [ ] Obálka alba (vybraná fotka)
- [ ] Řazení alb (ručně přetahováním / podle názvu / podle data)
- [ ] Duplikovat album
- [ ] Jedna fotka ve více albech
- [ ] Chytrá alba (automaticky: „Oblíbené", „Videa", „Poslední přidané")
- [ ] Stáhnout celé album jako ZIP
- [ ] Sdílet album (odkaz)

### Nastavení
- [ ] Jazyk aplikace (čeština / angličtina)
- [ ] Velikost miniatur v mřížce
- [ ] Výchozí řazení médií
- [ ] Výchozí složka pro stahování
- [ ] Vymazání cache miniatur
- [ ] Zobrazení využití úložiště Google Drive
- [ ] Automatická synchronizace na pozadí (interval)
- [ ] Export / import nastavení (včetně vlastního tématu)

### Bezpečnost a spolehlivost
- [ ] OAuth token uložený v systémovém úložišti (Windows Credential Manager / macOS Keychain / Linux Secret Service přes `keyring`)
- [ ] Šifrování lokální cache a datového souboru
- [ ] Obnova přihlášení při expiraci tokenu bez nutnosti nového přihlášení
- [ ] Práce offline (zobrazení naposledy načtených miniatur)
- [ ] Logování chyb do souboru + hlášení uživateli přívětivými zprávami
- [ ] Ošetření limitů Google API (opakování požadavků, zpožděné načítání)

### Distribuce
- [ ] Skripty pro spuštění (`run.bat`, `run.sh`)
- [ ] Návod na vytvoření spustitelného souboru (PyInstaller)

---

## 7. Pravidla pro AI

- Piš česky (komentáře v kódu a texty v GUI česky, pokud nezaškrtnu jazykovou verzi).
- Kód musí být **spustitelný bez dopisování**; vše, co uživatel musí nastavit sám (Google Cloud projekt, `credentials.json`), popiš krok za krokem.
- Nevymýšlej si neexistující funkce knihoven; používej stabilní a udržované balíčky.
- Pokud narazíš na omezení (např. přehrávání `.mkv`/`.avi` vyžaduje externí kodeky nebo knihovnu), **upozorni na to a nabídni řešení** jako checkbox.
- Na konci odpovědi shrň: co je hotovo, co je třeba nastavit ručně, a seznam dalších návrhů k odsouhlasení.
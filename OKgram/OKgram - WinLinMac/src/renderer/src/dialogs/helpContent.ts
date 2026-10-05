// User guide shown by the "?" button, per language and operating system.
// It explains where things are and how to sign in, not how the app works inside.
import type { Palette } from '../../../shared/theme'

export type OsKey = 'windows' | 'linux' | 'macos'
export const OS_ORDER: OsKey[] = ['windows', 'linux', 'macos']
export const OS_NAMES: Record<OsKey, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }

type Lang = 'cs' | 'en'

const MOD: Record<OsKey, string> = { windows: 'Ctrl', linux: 'Ctrl', macos: '⌘' }

const PATHS: Record<OsKey, { config: string; cache: string; folder: Record<Lang, string>; trash: Record<Lang, string> }> = {
  windows: {
    config: '%APPDATA%\\OKgram',
    cache: '%LOCALAPPDATA%\\OKgram\\cache',
    folder: { cs: 'Obrázky\\OKgram', en: 'Pictures\\OKgram' },
    trash: { cs: 'Koše', en: 'Recycle Bin' }
  },
  linux: {
    config: '~/.config/okgram',
    cache: '~/.cache/okgram',
    folder: { cs: '~/Obrázky/OKgram (nebo ~/Pictures/OKgram)', en: '~/Pictures/OKgram' },
    trash: { cs: 'Koše', en: 'Trash' }
  },
  macos: {
    config: '~/Library/Application Support/OKgram',
    cache: '~/Library/Caches/OKgram',
    folder: { cs: '~/Obrázky/OKgram', en: '~/Pictures/OKgram' },
    trash: { cs: 'Koše', en: 'Trash' }
  }
}

const INSTALL: Record<Lang, Record<OsKey, string>> = {
  cs: {
    windows: `
<ol>
<li>Spusťte instalátor <code>OKgram-Setup.exe</code> a projděte průvodce. Zástupce se objeví v nabídce Start.</li>
<li>Instalátor není podepsaný. Když Windows ukáže „Systém Windows ochránil váš počítač“, klikněte na <i>Další informace → Přesto spustit</i>.</li>
</ol>
<p class="note">Ze zdrojových souborů: nainstalujte Node.js 20 nebo novější a ve složce aplikace spusťte <code>run.bat</code> (nebo <code>npm install</code> a <code>npm run dev</code>). Instalátor vytvoří <code>npm run dist:win</code>.</p>`,
    linux: `
<ol>
<li>Soubor označte jako spustitelný: <code>chmod +x OKgram-*.AppImage</code>.</li>
<li>Spusťte ho dvojklikem nebo z terminálu. Některé distribuce potřebují balík <code>libfuse2</code>.</li>
</ol>
<p class="note">Ze zdrojových souborů: nainstalujte Node.js 20 nebo novější a ve složce aplikace spusťte <code>./run.sh</code> (nebo <code>npm install</code> a <code>npm run dev</code>). AppImage vytvoří <code>npm run dist:linux</code>.</p>`,
    macos: `
<ol>
<li>Otevřete <code>OKgram.dmg</code> a přetáhněte OKgram do složky <i>Aplikace</i>.</li>
<li>Aplikace není podepsaná u Apple. Poprvé ji otevřete pravým tlačítkem → <i>Otevřít</i> a potvrďte.</li>
</ol>
<p class="note">Ze zdrojových souborů: nainstalujte Node.js 20 nebo novější a ve složce aplikace spusťte <code>./run.sh</code> (nebo <code>npm install</code> a <code>npm run dev</code>). Instalátor vytvoří <code>npm run dist:mac</code> (jen na Macu).</p>`
  },
  en: {
    windows: `
<ol>
<li>Run the installer <code>OKgram-Setup.exe</code> and follow the wizard. A shortcut appears in the Start menu.</li>
<li>The installer is not signed. If Windows shows “Windows protected your PC”, click <i>More info → Run anyway</i>.</li>
</ol>
<p class="note">From source: install Node.js 20 or newer and run <code>run.bat</code> in the app folder (or <code>npm install</code> and <code>npm run dev</code>). <code>npm run dist:win</code> builds the installer.</p>`,
    linux: `
<ol>
<li>Make the file executable: <code>chmod +x OKgram-*.AppImage</code>.</li>
<li>Start it with a double click or from a terminal. Some distributions need the <code>libfuse2</code> package.</li>
</ol>
<p class="note">From source: install Node.js 20 or newer and run <code>./run.sh</code> in the app folder (or <code>npm install</code> and <code>npm run dev</code>). <code>npm run dist:linux</code> builds the AppImage.</p>`,
    macos: `
<ol>
<li>Open <code>OKgram.dmg</code> and drag OKgram into <i>Applications</i>.</li>
<li>The app is not signed with Apple. Open it the first time with a right click → <i>Open</i> and confirm.</li>
</ol>
<p class="note">From source: install Node.js 20 or newer and run <code>./run.sh</code> in the app folder (or <code>npm install</code> and <code>npm run dev</code>). <code>npm run dist:mac</code> builds the installer (on a Mac only).</p>`
  }
}

const BODY: Record<Lang, string> = {
  cs: `
<h1>Nápověda OKgram – {os}</h1>

<h2>Co je kde</h2>
<ul>
<li><b>Úvodní obrazovka</b> – vyberete, kde budou fotky a videa: <i>Google Disk</i> nebo <i>Tento počítač</i>.</li>
<li><b>Záložka Média</b> – všechny fotky a videa. Nahoře hledání, filtry, řazení a přepínač mřížka / seznam.</li>
<li><b>Záložka Alba</b> – vlevo chytrá alba a vaše alba, vpravo obsah vybraného alba.</li>
<li><b>Lišta vpravo nahoře</b> – uživatelské jméno, stav ukládání, <i>Nahrát</i>, <i>Obnovit</i> a <i>Nastavení</i>.</li>
<li><b>Prohlížeč</b> – kliknutím na fotku nebo video se otevře v novém okně.</li>
<li><b>?</b> vpravo dole otevře tuto nápovědu.</li>
</ul>

<h2>Instalace a spuštění</h2>
{install}

<h2>Google Disk, nebo tento počítač</h2>
<ul>
<li><b>Google Disk</b>: fotky a videa jsou ve složce <b>OKgram</b> na vašem Disku. Na každém počítači, kde se přihlásíte, vidíte totéž. Alba, hvězdičky, rámečky, uživatelské jméno a nastavení vzhledu jsou v souboru <code>okgram.json</code> ve stejné složce.</li>
<li><b>Tento počítač</b>: fotky a videa jsou ve složce na disku, výchozí je <code>{folder}</code>. Můžete vybrat i jinou složku. OKgram ukáže i soubory v podsložkách. Soubory, které do složky zkopírujete jinak (např. v průzkumníku), se objeví samy. <code>okgram.json</code> je přímo ve složce.</li>
<li>Úložiště změníte v <i>Nastavení → Účet → Změnit úložiště</i>. Fotky se při tom nepřesouvají.</li>
</ul>

<h2>První přihlášení přes Google</h2>
<p>OKgram se k Disku připojuje přes vlastní přístup, který si jednou vytvoříte v Google Cloud. Můžete použít i projekt, který už máte pro OKpass.</p>
<ol>
<li>Otevřete <b>console.cloud.google.com</b> a vytvořte projekt (např. <i>OKgram</i>), nebo vyberte existující.</li>
<li><i>APIs &amp; Services → Library</i>: vyhledejte <b>Google Drive API</b> a klikněte na <i>Enable</i>.</li>
<li><i>Google Auth Platform → Branding</i>: vyplňte název aplikace a e-maily. <i>Audience</i>: typ <b>External</b>.</li>
<li><i>Data Access → Add or remove scopes</i>: přidejte <code>.../auth/drive.file</code>.</li>
<li><i>Clients → Create client</i>, typ aplikace <b>Desktop app</b>. Po vytvoření klikněte na <i>Download JSON</i>.</li>
<li>V OKgram vyberte <i>Google Disk</i>, klikněte na <i>Vybrat client_secret.json…</i> a vyberte stažený soubor.</li>
<li>Klikněte na <i>Přihlásit se přes Google</i>. Otevře se prohlížeč, vyberte účet a povolte přístup. Pokud Google ukáže „Google hasn't verified this app“, klikněte na <i>Continue</i> (je to vaše vlastní aplikace).</li>
<li>Po přihlášení OKgram vytvoří na Disku složku <b>OKgram</b>.</li>
</ol>
<p class="note">V režimu <i>Testing</i> musí být váš účet v <i>Audience → Test users</i> a přihlášení vyprší po 7 dnech. Pro trvalé přihlášení klikněte v <i>Audience</i> na <b>Publish app</b> (stav <i>In production</i>). OKgram používá jen oprávnění <code>drive.file</code>, které Google nepočítá mezi citlivá.</p>
<p class="note"><b>Důležité:</b> s oprávněním <code>drive.file</code> OKgram vidí jen soubory, které do Disku nahrál sám. Fotky, které do složky OKgram dáte přes web Google Disku, v aplikaci neuvidíte. Nahrávejte je tlačítkem <i>Nahrát</i> nebo přetažením do okna.</p>
<p>Přihlášení a nastavení: <code>{config}</code><br>Miniatury a offline kopie: <code>{cache}</code></p>

<h2>Záložka Média</h2>
<ul>
<li><b>Nahrát</b>: tlačítko vpravo nahoře (<code>{mod}+U</code>), nebo přetáhněte soubory či celé složky do okna. Průběh je vidět v panelu přenosů dole.</li>
<li><b>Hledání</b> podle názvu souboru (<code>{mod}+F</code>). Filtry: <i>Oblíbené</i> (jen s hvězdičkou), fotky / videa a barevné tečky pro rámečky.</li>
<li><b>Řazení</b>: podle data, názvu, formátu nebo velikosti, šipkou vedle změníte směr. Datum je datum pořízení fotky, a když ho soubor nemá, datum souboru.</li>
<li><b>Mřížka / seznam</b> a posuvník velikosti miniatur.</li>
<li><b>Kliknutí</b> otevře fotku nebo video v prohlížeči. <b>{mod}+klik</b> nebo zaškrtnutí v rohu miniatury vybere více souborů, <b>Shift+klik</b> vybere rozsah, <code>{mod}+A</code> vše. Pro výběr se nahoře ukáže lišta s hromadnými akcemi.</li>
<li><b>Pravé tlačítko</b>: otevřít, prezentace, stáhnout, hvězdička, barevný rámeček, přidat do alba, otočit, přejmenovat, detaily, odkaz ke sdílení (Disk) nebo cesta k souboru (počítač), otevřít v systémové aplikaci, smazat.</li>
<li><b>Smazat</b> (klávesa <code>Delete</code>) přesune soubor do koše Google Disku, nebo do {trash} v počítači. Odtud ho můžete obnovit.</li>
<li><b>Kopírovat odkaz</b> (Disk) zpřístupní soubor každému, kdo má odkaz. Zrušíte to v menu <i>Zrušit sdílení</i>.</li>
<li><b>Otočení</b> se jen zobrazuje, soubor se nemění.</li>
</ul>

<h2>Záložka Alba</h2>
<ul>
<li><b>Chytrá alba</b> se plní sama: <i>Oblíbené</i>, <i>Fotky</i>, <i>Videa</i> a <i>Poslední přidané</i> (30 dní).</li>
<li><b>Nové album</b>: zadáte název, vyberete ikonu a barvu. Upravit je můžete kdykoli tužkou u názvu alba.</li>
<li><b>Přidání fotek</b>: pravé tlačítko → <i>Přidat do alba</i>, nebo přetáhněte miniatury na album vlevo. Jedna fotka může být ve více albech. Soubory přetažené ze systému do otevřeného alba se nahrají a rovnou přidají.</li>
<li><b>Podalba</b>: tlačítko <i>Nové podalbum</i>, nebo přetáhněte album doprostřed jiného alba. Přetažením na horní či dolní okraj alba změníte pořadí.</li>
<li><b>Pravé tlačítko na albu</b>: prezentace, nové podalbum, upravit, přesunout, duplikovat, stáhnout jako ZIP, smazat. Smazáním alba se fotky nesmažou.</li>
<li><b>Obálka</b>: v albu pravé tlačítko na fotce → <i>Nastavit jako obálku alba</i>.</li>
<li><b>Řazení alb</b> vlevo nad seznamem: ručně (přetahováním), podle názvu nebo podle data.</li>
</ul>

<h2>Prohlížeč</h2>
<ul>
<li>Šipky ← → přepínají na předchozí a další soubor ze seznamu, ze kterého jste prohlížeč otevřeli.</li>
<li>Fotky: kolečko myši přibližuje, tažením posunete, dvojklik přepne 100 % / přizpůsobit.</li>
<li>Videa: přehrát / pozastavit, posuvník, čas, hlasitost a rychlost.</li>
<li><b>Prezentace</b> běží přes celou obrazovku. Délku zobrazení fotky nastavíte v <i>Nastavení → Prohlížení</i>. Videa se přehrají celá.</li>
</ul>

<h2>Formáty</h2>
<ul>
<li>Fotky: <code>PNG JPG JPEG GIF SVG</code>. Videa: <code>MP4 MOV MKV AVI WEBM</code>.</li>
<li>MP4, WEBM a MOV s kodekem H.264 se přehrají přímo v OKgram. MKV většinou také.</li>
<li><b>AVI</b> a videa se staršími kodeky (DivX, Xvid, WMV) přímo přehrát nejde. Prohlížeč pak nabídne <i>Otevřít v systémovém přehrávači</i> (např. VLC). Ze Disku se video nejdřív stáhne do dočasné složky.</li>
</ul>

<h2>Ukládání, synchronizace a offline</h2>
<ul>
<li>Změny alb, hvězdiček a nastavení se ukládají samy. Stav vidíte nahoře: <i>Uloženo</i>, <i>Ukládám…</i>, <i>Offline – čeká na odeslání</i> nebo <i>Chyba ukládání</i>.</li>
<li>Bez internetu vidíte naposledy načtený seznam a miniatury. Změny se odešlou, jakmile bude připojení zpět.</li>
<li>Když totéž upravujete na dvou počítačích, OKgram změny spojí, u každého alba a fotky vyhraje novější úprava.</li>
<li>Seznam se obnovuje sám (výchozí každých 5 minut) a tlačítkem <i>Obnovit</i> (<code>F5</code>).</li>
</ul>

<h2>Nastavení</h2>
<ul>
<li><b>Účet</b> – Google účet a odhlášení, nebo složka v počítači, uživatelské jméno a změna úložiště.</li>
<li><b>Vzhled</b> – jazyk, velikost písma, velikost miniatur, výchozí zobrazení a téma: Světlý, Tmavý, OpiKula style nebo Vlastní (vlastní barvy a prvky okna).</li>
<li><b>Prohlížení</b> – výchozí řazení médií a alb, délka snímku v prezentaci, automatické přehrávání a opakování videí.</li>
<li><b>Úložiště</b> – využití místa, výchozí složka pro stahování, interval synchronizace a vymazání miniatur.</li>
<li><b>Data</b> – export a import nastavení (včetně vlastního tématu) a složka se záznamem chyb.</li>
</ul>

<h2>Klávesové zkratky</h2>
<table>
<tr><td><code>{mod}+1</code> / <code>{mod}+2</code></td><td>Média / Alba</td></tr>
<tr><td><code>{mod}+F</code></td><td>hledat</td></tr>
<tr><td><code>{mod}+U</code></td><td>nahrát</td></tr>
<tr><td><code>{mod}+A</code> / <code>Esc</code></td><td>vybrat vše / zrušit výběr</td></tr>
<tr><td><code>Delete</code></td><td>smazat vybrané</td></tr>
<tr><td><code>F5</code></td><td>obnovit seznam</td></tr>
<tr><td><code>{mod}+,</code></td><td>nastavení</td></tr>
<tr><td colspan="2"><b>V prohlížeči</b></td></tr>
<tr><td><code>←</code> / <code>→</code></td><td>předchozí / další</td></tr>
<tr><td><code>+</code> / <code>-</code> / <code>0</code> / <code>1</code></td><td>přiblížit / oddálit / přizpůsobit / 100 %</td></tr>
<tr><td><code>R</code> / <code>Shift+R</code></td><td>otočit doprava / doleva</td></tr>
<tr><td><code>S</code> / <code>I</code></td><td>hvězdička / detaily</td></tr>
<tr><td><code>Mezerník</code></td><td>přehrát / pozastavit video, jinak prezentace</td></tr>
<tr><td><code>Shift+←</code> / <code>Shift+→</code></td><td>video o 5 s zpět / vpřed</td></tr>
<tr><td><code>F</code> / <code>F5</code> / <code>Esc</code></td><td>celá obrazovka / prezentace / ukončit</td></tr>
</table>
`,
  en: `
<h1>OKgram help – {os}</h1>

<h2>What is where</h2>
<ul>
<li><b>Start screen</b> – choose where photos and videos live: <i>Google Drive</i> or <i>This computer</i>.</li>
<li><b>Media tab</b> – all photos and videos. At the top: search, filters, sorting and the grid / list switch.</li>
<li><b>Albums tab</b> – smart albums and your albums on the left, the chosen album on the right.</li>
<li><b>Top right</b> – user name, save status, <i>Upload</i>, <i>Refresh</i> and <i>Settings</i>.</li>
<li><b>Viewer</b> – a click on a photo or video opens it in a new window.</li>
<li><b>?</b> in the bottom right corner opens this help.</li>
</ul>

<h2>Install and run</h2>
{install}

<h2>Google Drive or this computer</h2>
<ul>
<li><b>Google Drive</b>: photos and videos are in the <b>OKgram</b> folder on your Drive. Every computer you sign in on shows the same. Albums, stars, frames, the user name and the appearance settings are in <code>okgram.json</code> in the same folder.</li>
<li><b>This computer</b>: photos and videos are in a folder on the disk, by default <code>{folder}</code>. You can choose another folder. OKgram also shows files in subfolders. Files you copy into the folder in other ways (e.g. in the file manager) appear by themselves. <code>okgram.json</code> sits in the folder itself.</li>
<li>Change the storage in <i>Settings → Account → Change storage</i>. No files are moved.</li>
</ul>

<h2>First sign-in with Google</h2>
<p>OKgram connects to Drive through your own access, created once in Google Cloud. You can use the project you already have for OKpass.</p>
<ol>
<li>Open <b>console.cloud.google.com</b> and create a project (e.g. <i>OKgram</i>), or pick an existing one.</li>
<li><i>APIs &amp; Services → Library</i>: search for <b>Google Drive API</b> and click <i>Enable</i>.</li>
<li><i>Google Auth Platform → Branding</i>: fill in the app name and e-mails. <i>Audience</i>: type <b>External</b>.</li>
<li><i>Data Access → Add or remove scopes</i>: add <code>.../auth/drive.file</code>.</li>
<li><i>Clients → Create client</i>, application type <b>Desktop app</b>. Then click <i>Download JSON</i>.</li>
<li>In OKgram choose <i>Google Drive</i>, click <i>Choose client_secret.json…</i> and select the downloaded file.</li>
<li>Click <i>Sign in with Google</i>. A browser opens; pick your account and allow access. If Google shows “Google hasn't verified this app”, click <i>Continue</i> (it is your own app).</li>
<li>After signing in, OKgram creates the folder <b>OKgram</b> on your Drive.</li>
</ol>
<p class="note">In <i>Testing</i> mode your account has to be in <i>Audience → Test users</i> and the sign-in ends after 7 days. For a lasting sign-in click <b>Publish app</b> in <i>Audience</i> (status <i>In production</i>). OKgram uses only the <code>drive.file</code> permission, which Google does not count as sensitive.</p>
<p class="note"><b>Important:</b> with <code>drive.file</code> OKgram sees only files it uploaded itself. Photos you put into the OKgram folder through the Google Drive website do not show in the app. Upload them with <i>Upload</i> or by dragging them into the window.</p>
<p>Sign-in and settings: <code>{config}</code><br>Thumbnails and offline copy: <code>{cache}</code></p>

<h2>Media tab</h2>
<ul>
<li><b>Upload</b>: the button in the top right (<code>{mod}+U</code>), or drag files or whole folders into the window. The transfer panel at the bottom shows the progress.</li>
<li><b>Search</b> by file name (<code>{mod}+F</code>). Filters: <i>Favourites</i> (starred only), photos / videos and coloured dots for frames.</li>
<li><b>Sorting</b>: by date, name, format or size; the arrow next to it changes the direction. The date is when the photo was taken, or the file date when the file does not say.</li>
<li><b>Grid / list</b> and the thumbnail size slider.</li>
<li>A <b>click</b> opens the photo or video in the viewer. <b>{mod}+click</b> or the tick in the thumbnail corner selects several files, <b>Shift+click</b> selects a range, <code>{mod}+A</code> everything. A bar with actions for the selection appears at the top.</li>
<li><b>Right click</b>: open, slideshow, download, star, colour frame, add to album, rotate, rename, details, share link (Drive) or file path (computer), open in the system app, delete.</li>
<li><b>Delete</b> (the <code>Delete</code> key) moves the file to the Google Drive trash, or to the {trash} on the computer. You can restore it from there.</li>
<li><b>Copy link</b> (Drive) lets anyone with the link open the file. Undo it with <i>Stop sharing</i> in the menu.</li>
<li><b>Rotation</b> only changes the view; the file stays as it is.</li>
</ul>

<h2>Albums tab</h2>
<ul>
<li><b>Smart albums</b> fill themselves: <i>Favourites</i>, <i>Photos</i>, <i>Videos</i> and <i>Recently added</i> (30 days).</li>
<li><b>New album</b>: type a name, pick an icon and a colour. Change them any time with the pencil next to the album name.</li>
<li><b>Adding photos</b>: right click → <i>Add to album</i>, or drag thumbnails onto an album on the left. One photo can be in many albums. Files dragged from the system into an open album are uploaded and added.</li>
<li><b>Sub-albums</b>: the <i>New sub-album</i> button, or drag an album onto the middle of another one. Dragging onto the upper or lower edge changes the order.</li>
<li><b>Right click on an album</b>: slideshow, new sub-album, edit, move, duplicate, download as ZIP, delete. Deleting an album does not delete its photos.</li>
<li><b>Cover</b>: inside the album, right click a photo → <i>Set as album cover</i>.</li>
<li><b>Album order</b> above the list on the left: manual (drag), by name or by date.</li>
</ul>

<h2>Viewer</h2>
<ul>
<li>The ← → arrows move to the previous and next file of the list you opened the viewer from.</li>
<li>Photos: the mouse wheel zooms, drag to move, double click switches 100 % / fit.</li>
<li>Videos: play / pause, seek bar, time, volume and speed.</li>
<li>The <b>slideshow</b> runs full screen. Set how long a photo stays in <i>Settings → Viewing</i>. Videos play to the end.</li>
</ul>

<h2>Formats</h2>
<ul>
<li>Photos: <code>PNG JPG JPEG GIF SVG</code>. Videos: <code>MP4 MOV MKV AVI WEBM</code>.</li>
<li>MP4, WEBM and MOV with the H.264 codec play right in OKgram. MKV mostly too.</li>
<li><b>AVI</b> and videos with older codecs (DivX, Xvid, WMV) cannot be played inside. The viewer then offers <i>Open in the system player</i> (e.g. VLC). From Drive, the video is downloaded to a temporary folder first.</li>
</ul>

<h2>Saving, sync and offline</h2>
<ul>
<li>Changes to albums, stars and settings are saved automatically. The status at the top shows <i>Saved</i>, <i>Saving…</i>, <i>Offline – waiting to upload</i> or <i>Save error</i>.</li>
<li>Without internet you see the last loaded list and thumbnails. Changes are uploaded once the connection is back.</li>
<li>When you change things on two computers, OKgram joins the changes; for every album and photo the newer change wins.</li>
<li>The list refreshes by itself (every 5 minutes by default) and with <i>Refresh</i> (<code>F5</code>).</li>
</ul>

<h2>Settings</h2>
<ul>
<li><b>Account</b> – the Google account and sign-out, or the folder on the computer; user name and storage change.</li>
<li><b>Appearance</b> – language, font size, thumbnail size, default view and theme: Light, Dark, OpiKula style or Custom (own colours and window elements).</li>
<li><b>Viewing</b> – default sorting of media and albums, slideshow time, video autoplay and loop.</li>
<li><b>Storage</b> – space used, default download folder, sync interval and clearing the thumbnails.</li>
<li><b>Data</b> – export and import of the settings (custom theme included) and the error log folder.</li>
</ul>

<h2>Keyboard shortcuts</h2>
<table>
<tr><td><code>{mod}+1</code> / <code>{mod}+2</code></td><td>Media / Albums</td></tr>
<tr><td><code>{mod}+F</code></td><td>search</td></tr>
<tr><td><code>{mod}+U</code></td><td>upload</td></tr>
<tr><td><code>{mod}+A</code> / <code>Esc</code></td><td>select all / clear selection</td></tr>
<tr><td><code>Delete</code></td><td>delete selected</td></tr>
<tr><td><code>F5</code></td><td>refresh the list</td></tr>
<tr><td><code>{mod}+,</code></td><td>settings</td></tr>
<tr><td colspan="2"><b>In the viewer</b></td></tr>
<tr><td><code>←</code> / <code>→</code></td><td>previous / next</td></tr>
<tr><td><code>+</code> / <code>-</code> / <code>0</code> / <code>1</code></td><td>zoom in / out / fit / 100 %</td></tr>
<tr><td><code>R</code> / <code>Shift+R</code></td><td>rotate right / left</td></tr>
<tr><td><code>S</code> / <code>I</code></td><td>star / details</td></tr>
<tr><td><code>Space</code></td><td>play / pause a video, otherwise slideshow</td></tr>
<tr><td><code>Shift+←</code> / <code>Shift+→</code></td><td>video 5 s back / forward</td></tr>
<tr><td><code>F</code> / <code>F5</code> / <code>Esc</code></td><td>full screen / slideshow / leave</td></tr>
</table>
`
}

export function buildHelp(language: Lang, os: OsKey, colors: Palette): string {
  const style = `<style>.help h1,.help h2{color:${colors.accent}}.help code{background:${colors.surface}}.help .note{color:${colors.text_muted}}</style>`
  const paths = PATHS[os]
  const values: Record<string, string> = {
    os: OS_NAMES[os],
    install: INSTALL[language][os],
    config: paths.config,
    cache: paths.cache,
    folder: paths.folder[language],
    trash: paths.trash[language],
    mod: MOD[os]
  }
  return style + BODY[language].replace(/\{(os|install|config|cache|folder|trash|mod)\}/g, (_m, key: string) => values[key])
}

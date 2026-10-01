// User guide shown by the "?" button (per language and operating system).
// It explains how to use the app and how to sign in, never how the encryption works.
import type { Palette } from '../../../shared/theme'

type DesktopOs = 'windows' | 'linux' | 'macos'
export type OsKey = DesktopOs | 'android'
export const OS_ORDER: OsKey[] = ['windows', 'linux', 'macos', 'android']
export const OS_NAMES: Record<OsKey, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS', android: 'Android' }

const MOD: Record<DesktopOs, string> = { windows: 'Ctrl', linux: 'Ctrl', macos: '⌘' }
const PATHS: Record<DesktopOs, [string, string]> = {
  windows: ['%APPDATA%\\OKpass', '%LOCALAPPDATA%\\OKpass\\cache'],
  linux: ['~/.config/okpass', '~/.cache/okpass'],
  macos: ['~/Library/Application Support/OKpass', '~/Library/Caches/OKpass']
}

const INSTALL: Record<'cs' | 'en', Record<DesktopOs, string>> = {
  cs: {
    windows: `
<ol>
<li>Spusťte instalátor <code>OKpass Setup.exe</code> a projděte průvodce. Zástupce se objeví v nabídce Start.</li>
<li>Pokud Windows zobrazí „Systém Windows ochránil váš počítač“, klikněte na <i>Další informace → Přesto spustit</i>.</li>
</ol>
<p class="note">Ze zdrojových souborů: nainstalujte Node.js 20 nebo novější, ve složce aplikace spusťte <code>npm install</code> a pak <code>npm run dev</code>. Instalátor vytvoří <code>npm run dist:win</code>.</p>`,
    linux: `
<ol>
<li>Soubor <code>OKpass.AppImage</code> označte jako spustitelný: <code>chmod +x OKpass*.AppImage</code>.</li>
<li>Spusťte ho dvojklikem nebo z terminálu. Některé distribuce potřebují balík <code>libfuse2</code>.</li>
</ol>
<p class="note">Ze zdrojových souborů: nainstalujte Node.js 20 nebo novější, ve složce aplikace spusťte <code>npm install</code> a pak <code>npm run dev</code>. AppImage vytvoří <code>npm run dist:linux</code>.</p>`,
    macos: `
<ol>
<li>Otevřete <code>OKpass.dmg</code> a přetáhněte OKpass do složky <i>Aplikace</i>.</li>
<li>Při prvním spuštění klikněte na aplikaci pravým tlačítkem → <i>Otevřít</i> a potvrďte (aplikace není podepsaná u Apple).</li>
</ol>
<p class="note">Ze zdrojových souborů: nainstalujte Node.js 20 nebo novější, ve složce aplikace spusťte <code>npm install</code> a pak <code>npm run dev</code>. Instalátor vytvoří <code>npm run dist:mac</code> (jen na Macu).</p>`
  },
  en: {
    windows: `
<ol>
<li>Run the installer <code>OKpass Setup.exe</code> and follow the wizard. A shortcut appears in the Start menu.</li>
<li>If Windows shows “Windows protected your PC”, click <i>More info → Run anyway</i>.</li>
</ol>
<p class="note">From source: install Node.js 20 or newer, run <code>npm install</code> in the app folder and then <code>npm run dev</code>. <code>npm run dist:win</code> builds the installer.</p>`,
    linux: `
<ol>
<li>Make <code>OKpass.AppImage</code> executable: <code>chmod +x OKpass*.AppImage</code>.</li>
<li>Start it with a double click or from a terminal. Some distributions need the <code>libfuse2</code> package.</li>
</ol>
<p class="note">From source: install Node.js 20 or newer, run <code>npm install</code> in the app folder and then <code>npm run dev</code>. <code>npm run dist:linux</code> builds the AppImage.</p>`,
    macos: `
<ol>
<li>Open <code>OKpass.dmg</code> and drag OKpass into <i>Applications</i>.</li>
<li>On the first start, right-click the app → <i>Open</i> and confirm (the app is not signed with Apple).</li>
</ol>
<p class="note">From source: install Node.js 20 or newer, run <code>npm install</code> in the app folder and then <code>npm run dev</code>. <code>npm run dist:mac</code> builds the installer (on a Mac only).</p>`
  }
}

const BODY = {
  cs: `
<h1>Nápověda OKpass – {os}</h1>

<h2>Co je kde</h2>
<ul>
<li><b>Přihlášení</b> – první obrazovka s tlačítkem <i>Přihlásit se přes Google</i>.</li>
<li><b>Šifrovací klíč</b> – po přihlášení zadáte svůj klíč a kliknete na <i>Odemknout</i>.</li>
<li><b>Hlavní okno</b> – nahoře záložky <i>Text</i> a <i>Hesla</i>, vpravo uživatelské jméno, stav ukládání, tlačítko <i>Nastavení</i> a zámek.</li>
<li><b>?</b> vpravo dole otevře tuto nápovědu.</li>
</ul>

<h2>Instalace a spuštění</h2>
{install}

<h2>První přihlášení přes Google</h2>
<p>Aplikace se k Disku připojuje přes vlastní přístup, který si jednou vytvoříte v Google Cloud:</p>
<ol>
<li>Otevřete <b>console.cloud.google.com</b> a vytvořte nový projekt (např. <i>OKpass</i>).</li>
<li><i>APIs &amp; Services → Library</i>: vyhledejte <b>Google Drive API</b> a klikněte na <i>Enable</i>.</li>
<li><i>OAuth consent screen</i> (Google Auth Platform): typ <b>External</b>, vyplňte název aplikace a e-mail. V části <i>Audience</i> přidejte svůj Google účet mezi <b>Test users</b>.</li>
<li><i>Credentials / Clients → Create credentials → OAuth client ID</i>, typ aplikace <b>Desktop app</b>. Po vytvoření klikněte na <i>Download JSON</i>.</li>
<li>V OKpass klikněte na <i>Vybrat client_secret.json…</i> a vyberte stažený soubor.</li>
<li>Klikněte na <i>Přihlásit se přes Google</i>. Otevře se prohlížeč – vyberte účet a povolte přístup. Pokud se zobrazí „Google hasn't verified this app“, klikněte na <i>Continue</i> (jde o vaši vlastní aplikaci).</li>
<li>Po přihlášení OKpass na Disku vytvoří složku <b>OKpass</b>. Aplikace vidí jen soubory, které sama vytvořila.</li>
</ol>
<p class="note">V testovacím režimu Google platnost přihlášení vyprší po 7 dnech – pak se jen znovu přihlásíte. Pro trvalé přihlášení přepněte v <i>OAuth consent screen</i> stav na <b>In production</b>.</p>
<p>Soubory přihlášení a nastavení: <code>{config}</code><br>Lokální kopie pro offline režim: <code>{cache}</code></p>

<h2>Zadání klíče</h2>
<ul>
<li>Klíč má nejvýše 32 znaků: číslice, malá a velká písmena bez diakritiky a speciální znaky (<code>. ; - _ ! ? * / \`</code> atd.).</li>
<li>Mezery se do klíče nepočítají. Počítadlo pod polem ukazuje počet znaků.</li>
<li>Při prvním spuštění klíč zadáte dvakrát a kliknete na <i>Vytvořit trezor</i>.</li>
<li>Klíč si dobře zapamatujte. Nikde se neukládá a nelze ho obnovit.</li>
</ul>

<h2>Záložka Text</h2>
<ul>
<li><i>Přidat textový dokument</i> vytvoří nový dokument. Seznam vlevo slouží k výběru, pole nad ním k hledání.</li>
<li>Přejmenování: přepište název nad editorem, nebo klikněte na dokument pravým tlačítkem → <i>Přejmenovat</i>.</li>
<li>Panel nástrojů: <i>Normální text</i>, <i>Nadpis</i>, <i>Podnadpis</i>, <b>B</b> tučné, <i>I</i> kurzíva a odsazení.</li>
<li><code>Tab</code> odsadí odstavec, <code>Shift+Tab</code> odsazení zmenší. Enter za nadpisem pokračuje normálním textem.</li>
<li>Koš vpravo nahoře dokument smaže (s potvrzením).</li>
</ul>

<h2>Záložka Hesla</h2>
<ul>
<li><i>Přidat heslo</i> vytvoří záznam s poli <i>Název / URL</i>, <i>Uživatelské jméno</i> a <i>Heslo</i>.</li>
<li>Názvy polí v levém sloupci můžete přepsat – klikněte na název a napište vlastní. Když název smažete, vrátí se výchozí.</li>
<li>Oko zobrazí nebo skryje heslo, ikona kopírování zkopíruje hodnotu do schránky.</li>
<li>Kostka otevře generátor silných hesel, pruh pod heslem ukazuje jeho sílu.</li>
<li><i>Přidat další sloupec</i> přidá vlastní pole (např. PIN, Poznámka). Křížek pole odebere.</li>
<li><i>Smazat záznam</i> odstraní celý záznam (s potvrzením).</li>
</ul>

<h2>Ukládání a offline režim</h2>
<ul>
<li>Změny se ukládají automaticky. Stav vidíte nahoře: <i>Uloženo</i>, <i>Ukládám…</i>, <i>Offline – čeká na odeslání</i> nebo <i>Chyba ukládání</i>.</li>
<li>Bez internetu pracujete s lokální kopií. Změny se na Disk odešlou samy, jakmile bude připojení zpět.</li>
<li>Starší verze se ukládají do složky <i>OKpass/backups</i> na Disku. Obnova je v <i>Nastavení → Data</i>.</li>
</ul>

<h2>Nastavení</h2>
<ul>
<li><b>Účet</b> – uživatelské jméno (ukládá se na Disk) a odhlášení.</li>
<li><b>Vzhled</b> – jazyk, velikost písma a téma: Světlý, Tmavý, OpiKula style nebo Vlastní. U vlastního tématu nastavíte každou barvu a zapnete či vypnete prvky (rámečky, zaoblení, systémová lišta okna…).</li>
<li><b>Zabezpečení</b> – automatické zamčení po nečinnosti (výchozí 15 minut, 0 = vypnuto) a další volby.</li>
<li><b>Data</b> – počet záloh, obnova ze zálohy, export a import souboru <code>.okp</code>.</li>
</ul>

<h2>Zamknutí a odhlášení</h2>
<ul>
<li>Ikona zámku (nebo <code>{mod}+L</code>) zamkne aplikaci a vrátí vás k zadání klíče.</li>
<li>Odhlášení z Google účtu najdete v <i>Nastavení → Účet</i>.</li>
</ul>

<h2>Klávesové zkratky</h2>
<table>
<tr><td><code>{mod}+N</code></td><td>nový dokument / nové heslo</td></tr>
<tr><td><code>{mod}+F</code></td><td>hledat</td></tr>
<tr><td><code>{mod}+S</code></td><td>uložit hned</td></tr>
<tr><td><code>{mod}+L</code></td><td>zamknout</td></tr>
<tr><td><code>{mod}+B</code> / <code>{mod}+I</code></td><td>tučné / kurzíva</td></tr>
<tr><td><code>{mod}+1</code> / <code>{mod}+2</code> / <code>{mod}+0</code></td><td>nadpis / podnadpis / normální text</td></tr>
<tr><td><code>Tab</code> / <code>Shift+Tab</code></td><td>odsadit / zmenšit odsazení</td></tr>
</table>
`,
  en: `
<h1>OKpass help – {os}</h1>

<h2>What is where</h2>
<ul>
<li><b>Sign-in</b> – the first screen with the <i>Sign in with Google</i> button.</li>
<li><b>Encryption key</b> – after signing in, enter your key and click <i>Unlock</i>.</li>
<li><b>Main window</b> – tabs <i>Text</i> and <i>Passwords</i> at the top; on the right the user name, save status, <i>Settings</i> and the lock.</li>
<li><b>?</b> in the bottom right corner opens this help.</li>
</ul>

<h2>Install and run</h2>
{install}

<h2>First sign-in with Google</h2>
<p>The app connects to Drive through your own access, created once in Google Cloud:</p>
<ol>
<li>Open <b>console.cloud.google.com</b> and create a new project (e.g. <i>OKpass</i>).</li>
<li><i>APIs &amp; Services → Library</i>: search for <b>Google Drive API</b> and click <i>Enable</i>.</li>
<li><i>OAuth consent screen</i> (Google Auth Platform): type <b>External</b>, fill in the app name and e-mail. Under <i>Audience</i> add your Google account to <b>Test users</b>.</li>
<li><i>Credentials / Clients → Create credentials → OAuth client ID</i>, application type <b>Desktop app</b>. Then click <i>Download JSON</i>.</li>
<li>In OKpass click <i>Choose client_secret.json…</i> and select the downloaded file.</li>
<li>Click <i>Sign in with Google</i>. A browser opens – pick your account and allow access. If you see “Google hasn't verified this app”, click <i>Continue</i> (it is your own app).</li>
<li>After signing in, OKpass creates the folder <b>OKpass</b> on your Drive. The app only sees files it created itself.</li>
</ol>
<p class="note">In testing mode Google ends the sign-in after 7 days – then just sign in again. For a lasting sign-in, set the status in <i>OAuth consent screen</i> to <b>In production</b>.</p>
<p>Sign-in and settings files: <code>{config}</code><br>Local copy for offline mode: <code>{cache}</code></p>

<h2>Entering the key</h2>
<ul>
<li>The key has at most 32 characters: digits, lower and upper case letters without accents and special characters (<code>. ; - _ ! ? * / \`</code> etc.).</li>
<li>Spaces do not count. The counter below the field shows the number of characters.</li>
<li>On the first start you enter the key twice and click <i>Create vault</i>.</li>
<li>Remember the key well. It is not stored anywhere and cannot be recovered.</li>
</ul>

<h2>Text tab</h2>
<ul>
<li><i>Add text document</i> creates a new document. Pick documents in the list on the left; the field above it searches.</li>
<li>Rename: overwrite the title above the editor, or right-click a document → <i>Rename</i>.</li>
<li>Toolbar: <i>Normal text</i>, <i>Heading</i>, <i>Subheading</i>, <b>B</b> bold, <i>I</i> italic and indentation.</li>
<li><code>Tab</code> indents a paragraph, <code>Shift+Tab</code> reduces it. Enter after a heading continues with normal text.</li>
<li>The bin in the top right deletes the document (with confirmation).</li>
</ul>

<h2>Passwords tab</h2>
<ul>
<li><i>Add password</i> creates an entry with <i>Name / URL</i>, <i>User name</i> and <i>Password</i>.</li>
<li>You can rename the fields in the left column – click a field name and type your own. Clearing the name brings back the default.</li>
<li>The eye shows or hides the password, the copy icon copies the value to the clipboard.</li>
<li>The dice opens the strong password generator; the bar below the password shows its strength.</li>
<li><i>Add another column</i> adds a custom field (e.g. PIN, Note). The cross removes the field.</li>
<li><i>Delete entry</i> removes the whole entry (with confirmation).</li>
</ul>

<h2>Saving and offline mode</h2>
<ul>
<li>Changes are saved automatically. The status at the top shows <i>Saved</i>, <i>Saving…</i>, <i>Offline – waiting to upload</i> or <i>Save error</i>.</li>
<li>Without internet you work with a local copy. Changes are uploaded by themselves once the connection is back.</li>
<li>Older versions are kept in <i>OKpass/backups</i> on your Drive. Restore them in <i>Settings → Data</i>.</li>
</ul>

<h2>Settings</h2>
<ul>
<li><b>Account</b> – user name (stored on Drive) and sign-out.</li>
<li><b>Appearance</b> – language, font size and theme: Light, Dark, OpiKula style or Custom. The custom theme lets you set every colour and switch elements on or off (borders, rounded corners, system title bar…).</li>
<li><b>Security</b> – automatic lock after inactivity (default 15 minutes, 0 = off) and more options.</li>
<li><b>Data</b> – number of backups, restore from a backup, export and import of an <code>.okp</code> file.</li>
</ul>

<h2>Lock and sign-out</h2>
<ul>
<li>The lock icon (or <code>{mod}+L</code>) locks the app and returns you to the key screen.</li>
<li>Signing out of the Google account is in <i>Settings → Account</i>.</li>
</ul>

<h2>Keyboard shortcuts</h2>
<table>
<tr><td><code>{mod}+N</code></td><td>new document / new password</td></tr>
<tr><td><code>{mod}+F</code></td><td>search</td></tr>
<tr><td><code>{mod}+S</code></td><td>save now</td></tr>
<tr><td><code>{mod}+L</code></td><td>lock</td></tr>
<tr><td><code>{mod}+B</code> / <code>{mod}+I</code></td><td>bold / italic</td></tr>
<tr><td><code>{mod}+1</code> / <code>{mod}+2</code> / <code>{mod}+0</code></td><td>heading / subheading / normal text</td></tr>
<tr><td><code>Tab</code> / <code>Shift+Tab</code></td><td>indent / reduce indent</td></tr>
</table>
`
}

const ANDROID: Record<'cs' | 'en', string> = {
  cs: "\n<h1>Nápověda OKpass – Android</h1>\n\n<h2>Co je kde</h2>\n<ul>\n<li><b>Přihlášení</b> – první obrazovka s tlačítkem <i>Přihlásit se přes Google</i>.</li>\n<li><b>Šifrovací klíč</b> – po přihlášení zadáte svůj klíč a klepnete na <i>Odemknout</i> (nebo přiložíte prst).</li>\n<li><b>Hlavní obrazovka</b> – nahoře záložky <i>Text</i> a <i>Hesla</i>, vpravo stav ukládání, <i>Nastavení</i> a zámek.</li>\n<li>Klepnutím na položku v seznamu ji otevřete. Šipkou ← nebo systémovým tlačítkem <i>Zpět</i> se vrátíte na seznam.</li>\n<li><b>?</b> vpravo dole otevře tuto nápovědu.</li>\n</ul>\n\n<h2>Instalace</h2>\n<ol>\n<li>Zkopírujte soubor <code>OKpass.apk</code> do telefonu (kabelem, přes Google Disk, e-mailem…).</li>\n<li>Otevřete ho. Android se zeptá, zda povolit instalaci z tohoto zdroje – povolte to (<i>Nastavení → Aplikace → Speciální přístup → Instalace neznámých aplikací</i>).</li>\n<li>Klepněte na <i>Instalovat</i>. Novější verzi instalujte stejně – data zůstanou.</li>\n</ol>\n\n<h2>První přihlášení přes Google (jednou)</h2>\n<p>Telefon potřebuje v Google Cloud vlastního klienta typu <b>Android</b>. Vytvořte ho ve <b>stejném projektu</b>, který používá OKpass na počítači – jinak telefon neuvidí váš trezor.</p>\n<ol>\n<li>Otevřete <b>console.cloud.google.com</b> a vyberte projekt, který používáte pro OKpass.</li>\n<li><i>APIs &amp; Services → Credentials / Clients → Create credentials → OAuth client ID</i>.</li>\n<li>Application type: <b>Android</b>.</li>\n<li>Package name: <code>cz.opikula.okpass</code></li>\n<li>SHA-1 certificate fingerprint: <code>{sha1}</code></li>\n<li>Klikněte na <i>Create</i>. Nic se nestahuje – telefon Google pozná podle balíčku a podpisu aplikace.</li>\n<li>V OKpass klepněte na <i>Přihlásit se přes Google</i>, vyberte účet a povolte přístup. Váš účet musí být v <i>Test users</i> stejně jako u počítače.</li>\n</ol>\n<p class=\"note\">Pokud přihlášení hlásí chybu, zkontrolujte název balíčku a SHA-1 a počkejte pár minut – Google nového klienta aktivuje se zpožděním.</p>\n\n<h2>Zadání klíče</h2>\n<ul>\n<li>Klíč má nejvýše 32 znaků: číslice, malá a velká písmena bez diakritiky a speciální znaky (<code>. ; - _ ! ? * /</code> atd.).</li>\n<li>Mezery se do klíče nepočítají. Je to stejný klíč jako na počítači.</li>\n<li>Klíč si dobře zapamatujte. Nikde se neukládá a nelze ho obnovit.</li>\n</ul>\n\n<h2>Otisk prstu</h2>\n<ul>\n<li>Po odemčení klíčem: <i>Nastavení → Zabezpečení → Otisk prstu → Zapnout</i> a přiložte prst.</li>\n<li>Příště stačí na obrazovce klíče přiložit prst. Klíč můžete kdykoli zadat i ručně.</li>\n<li>Když v telefonu přidáte nový otisk nebo obnovíte trezor ze zálohy, otisk se vypne – zadejte klíč a zapněte ho znovu.</li>\n</ul>\n\n<h2>Záložka Text</h2>\n<ul>\n<li><i>Přidat textový dokument</i> vytvoří nový dokument. Podržením prstu na dokumentu v seznamu ho přejmenujete nebo smažete.</li>\n<li>Panel nástrojů nad textem: <i>Normální text</i>, <i>Nadpis</i>, <i>Podnadpis</i>, <b>B</b> tučné, <i>I</i> kurzíva a odsazení. Panel jde posouvat do strany.</li>\n</ul>\n\n<h2>Záložka Hesla</h2>\n<ul>\n<li><i>Přidat heslo</i> vytvoří záznam s poli <i>Název / URL</i>, <i>Uživatelské jméno</i> a <i>Heslo</i>.</li>\n<li>Názvy polí můžete přepsat – klepněte na název a napište vlastní. Když ho smažete, vrátí se výchozí.</li>\n<li>Oko zobrazí heslo, ikona kopírování ho zkopíruje, kostka vygeneruje silné heslo.</li>\n<li><i>Přidat další sloupec</i> přidá vlastní pole (PIN, Poznámka…).</li>\n</ul>\n\n<h2>Ukládání a soukromí</h2>\n<ul>\n<li>Změny se ukládají automaticky na Google Disk. Bez internetu se uloží v telefonu a odešlou se samy.</li>\n<li>Když aplikaci opustíte (jiná aplikace, domovská obrazovka, zhasnutí displeje), OKpass se uloží a zamkne.</li>\n<li>Snímky obrazovky jsou v OKpass zakázané a v přehledu otevřených aplikací se obsah nezobrazuje.</li>\n<li><i>Nastavení → Data</i>: export pošle šifrovaný soubor <code>.okp</code> přes nabídku Sdílet, import ho načte zpět.</li>\n</ul>\n",
  en: "\n<h1>OKpass help – Android</h1>\n\n<h2>What is where</h2>\n<ul>\n<li><b>Sign-in</b> – the first screen with <i>Sign in with Google</i>.</li>\n<li><b>Encryption key</b> – after signing in, enter your key and tap <i>Unlock</i> (or use your fingerprint).</li>\n<li><b>Main screen</b> – tabs <i>Text</i> and <i>Passwords</i> at the top; save status, <i>Settings</i> and the lock on the right.</li>\n<li>Tap an item in a list to open it. The ← arrow or the system <i>Back</i> button returns to the list.</li>\n<li><b>?</b> in the bottom right corner opens this help.</li>\n</ul>\n\n<h2>Install</h2>\n<ol>\n<li>Copy <code>OKpass.apk</code> to the phone (cable, Google Drive, e-mail…).</li>\n<li>Open it. Android asks whether to allow installs from this source – allow it (<i>Settings → Apps → Special access → Install unknown apps</i>).</li>\n<li>Tap <i>Install</i>. Install newer versions the same way – your data stays.</li>\n</ol>\n\n<h2>First sign-in with Google (once)</h2>\n<p>The phone needs its own <b>Android</b> client in Google Cloud. Create it in the <b>same project</b> that OKpass on your computer uses – otherwise the phone cannot see your vault.</p>\n<ol>\n<li>Open <b>console.cloud.google.com</b> and pick the project you use for OKpass.</li>\n<li><i>APIs &amp; Services → Credentials / Clients → Create credentials → OAuth client ID</i>.</li>\n<li>Application type: <b>Android</b>.</li>\n<li>Package name: <code>cz.opikula.okpass</code></li>\n<li>SHA-1 certificate fingerprint: <code>{sha1}</code></li>\n<li>Click <i>Create</i>. Nothing is downloaded – Google recognises the app by its package and signature.</li>\n<li>In OKpass tap <i>Sign in with Google</i>, pick your account and allow access. Your account has to be in <i>Test users</i>, the same as for the computer.</li>\n</ol>\n<p class=\"note\">If sign-in fails, check the package name and the SHA-1 and wait a few minutes – Google activates a new client with a delay.</p>\n\n<h2>Entering the key</h2>\n<ul>\n<li>The key has at most 32 characters: digits, letters without accents and special characters (<code>. ; - _ ! ? * /</code> etc.).</li>\n<li>Spaces do not count. It is the same key as on the computer.</li>\n<li>Remember it well. It is not stored anywhere and cannot be recovered.</li>\n</ul>\n\n<h2>Fingerprint</h2>\n<ul>\n<li>After unlocking with the key: <i>Settings → Security → Fingerprint → Turn on</i> and touch the sensor.</li>\n<li>Next time just touch the sensor on the key screen. You can always type the key instead.</li>\n<li>When you add a new fingerprint to the phone or restore the vault from a backup, the fingerprint is switched off – enter the key and turn it on again.</li>\n</ul>\n\n<h2>Text tab</h2>\n<ul>\n<li><i>Add text document</i> creates a document. Touch and hold a document in the list to rename or delete it.</li>\n<li>The toolbar above the text: <i>Normal text</i>, <i>Heading</i>, <i>Subheading</i>, <b>B</b> bold, <i>I</i> italic and indentation. It scrolls sideways.</li>\n</ul>\n\n<h2>Passwords tab</h2>\n<ul>\n<li><i>Add password</i> creates an entry with <i>Name / URL</i>, <i>User name</i> and <i>Password</i>.</li>\n<li>You can rename the fields – tap a field name and type your own. Clearing it brings back the default.</li>\n<li>The eye shows the password, the copy icon copies it, the dice generates a strong one.</li>\n<li><i>Add another column</i> adds a custom field (PIN, Note…).</li>\n</ul>\n\n<h2>Saving and privacy</h2>\n<ul>\n<li>Changes are saved to Google Drive automatically. Without internet they are kept on the phone and uploaded later.</li>\n<li>When you leave the app (other app, home screen, screen off), OKpass saves and locks.</li>\n<li>Screenshots are blocked in OKpass and the recent-apps screen does not show its content.</li>\n<li><i>Settings → Data</i>: export sends the encrypted <code>.okp</code> file through the Share menu, import loads it back.</li>\n</ul>\n"
}

export function buildHelp(language: 'cs' | 'en', os: OsKey, colors: Palette): string {
  const style = `<style>.help h1,.help h2{color:${colors.accent}}.help code{background:${colors.surface}}.help .note{color:${colors.text_muted}}</style>`
  if (os === 'android') return style + ANDROID[language].replace('{sha1}', __SIGNING_SHA1__)
  const [config, cache] = PATHS[os]
  const values: Record<string, string> = { os: OS_NAMES[os], install: INSTALL[language][os], config, cache, mod: MOD[os] }
  const body = BODY[language].replace(/\{(os|install|config|cache|mod)\}/g, (_m, key: string) => values[key])
  return style + body
}

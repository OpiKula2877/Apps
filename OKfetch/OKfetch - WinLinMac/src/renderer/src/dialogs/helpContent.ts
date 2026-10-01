// User guide shown by the "?" button (per language and operating system).
// It explains how to use the app, never how the encryption works inside.
import type { Palette } from '../../../shared/theme'

export type OsKey = 'windows' | 'linux' | 'macos'
export const OS_ORDER: OsKey[] = ['windows', 'linux', 'macos']
export const OS_NAMES: Record<OsKey, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }

const MOD: Record<OsKey, string> = { windows: 'Ctrl', linux: 'Ctrl', macos: '⌘' }

const STORAGE: Record<OsKey, string> = {
  windows: 'C:\\OKfetch',
  linux: '~/.local/share/okfetch',
  macos: '~/Library/Application Support/OKfetch'
}
const SETTINGS: Record<OsKey, string> = {
  windows: '%APPDATA%\\OKfetch',
  linux: '~/.config/okfetch',
  macos: '~/Library/Application Support/OKfetch-config'
}

type Lang = 'cs' | 'en'

const INSTALL: Record<Lang, Record<OsKey, string>> = {
  cs: {
    windows: `
<ol>
<li>Spusťte instalátor <code>OKfetch-Setup.exe</code> a projděte průvodce. Zástupce se objeví v nabídce Start.</li>
<li>Pokud Windows zobrazí „Systém Windows ochránil váš počítač“, klikněte na <i>Další informace → Přesto spustit</i>.</li>
</ol>
<p class="note">Ze zdrojových souborů: nainstalujte Node.js 20 nebo novější, ve složce aplikace spusťte <code>npm install</code> a pak <code>npm run dev</code>. Instalátor vytvoří <code>npm run dist:win</code>.</p>`,
    linux: `
<ol>
<li>Soubor <code>OKfetch.AppImage</code> označte jako spustitelný: <code>chmod +x OKfetch*.AppImage</code>.</li>
<li>Spusťte ho dvojklikem nebo z terminálu. Některé distribuce potřebují balík <code>libfuse2</code>.</li>
</ol>
<p class="note">Ze zdrojových souborů: nainstalujte Node.js 20 nebo novější, ve složce aplikace spusťte <code>npm install</code> a pak <code>npm run dev</code>. AppImage vytvoří <code>npm run dist:linux</code>.</p>`,
    macos: `
<ol>
<li>Otevřete <code>OKfetch.dmg</code> a přetáhněte OKfetch do složky <i>Aplikace</i>.</li>
<li>Při prvním spuštění klikněte na aplikaci pravým tlačítkem → <i>Otevřít</i> a potvrďte (aplikace není podepsaná u Apple).</li>
</ol>
<p class="note">Ze zdrojových souborů: nainstalujte Node.js 20 nebo novější, ve složce aplikace spusťte <code>npm install</code> a pak <code>npm run dev</code>. Instalátor vytvoří <code>npm run dist:mac</code> (jen na Macu).</p>`
  },
  en: {
    windows: `
<ol>
<li>Run the installer <code>OKfetch-Setup.exe</code> and follow the wizard. A shortcut appears in the Start menu.</li>
<li>If Windows shows “Windows protected your PC”, click <i>More info → Run anyway</i>.</li>
</ol>
<p class="note">From source: install Node.js 20 or newer, run <code>npm install</code> in the app folder and then <code>npm run dev</code>. <code>npm run dist:win</code> builds the installer.</p>`,
    linux: `
<ol>
<li>Make <code>OKfetch.AppImage</code> executable: <code>chmod +x OKfetch*.AppImage</code>.</li>
<li>Start it with a double click or from a terminal. Some distributions need the <code>libfuse2</code> package.</li>
</ol>
<p class="note">From source: install Node.js 20 or newer, run <code>npm install</code> in the app folder and then <code>npm run dev</code>. <code>npm run dist:linux</code> builds the AppImage.</p>`,
    macos: `
<ol>
<li>Open <code>OKfetch.dmg</code> and drag OKfetch into <i>Applications</i>.</li>
<li>On the first start, right-click the app → <i>Open</i> and confirm (the app is not signed with Apple).</li>
</ol>
<p class="note">From source: install Node.js 20 or newer, run <code>npm install</code> in the app folder and then <code>npm run dev</code>. <code>npm run dist:mac</code> builds the installer (on a Mac only).</p>`
  }
}

const FIREWALL: Record<Lang, Record<OsKey, string>> = {
  cs: {
    windows: `<p>Při prvním spuštění se může objevit okno <i>Windows Defender Firewall</i>. Zvolte <b>Povolit přístup</b> (soukromé sítě stačí). Bez toho se spojení vytvoří hůř nebo vůbec.</p>`,
    linux: `<p>Aplikace nepotřebuje otevřený port, spojení se navazuje „děrováním“ přes DHT. Když máte přísný firewall, který blokuje i odchozí UDP, povolte ho, např. <code>sudo ufw allow out proto udp from any to any</code>.</p>`,
    macos: `<p>Když macOS zeptá <i>Chcete, aby aplikace OKfetch přijímala příchozí síťová spojení?</i>, zvolte <b>Povolit</b>. Jinak zapněte v <i>Nastavení systému → Síť → Firewall → Možnosti</i>.</p>`
  },
  en: {
    windows: `<p>On the first start the <i>Windows Defender Firewall</i> window may appear. Choose <b>Allow access</b> (private networks are enough). Without it connections are harder or impossible.</p>`,
    linux: `<p>The app needs no open port; connections are made by hole punching through the DHT. If your strict firewall blocks outgoing UDP too, allow it, for example <code>sudo ufw allow out proto udp from any to any</code>.</p>`,
    macos: `<p>If macOS asks <i>Do you want the application OKfetch to accept incoming network connections?</i>, choose <b>Allow</b>. Otherwise enable it in <i>System Settings → Network → Firewall → Options</i>.</p>`
  }
}

const KEYSTORE: Record<Lang, Record<OsKey, string>> = {
  cs: {
    windows: 'Klíče chrání Windows (DPAPI). Jsou vázané na váš uživatelský účet Windows.',
    linux: 'Klíče chrání systémová peněženka (libsecret / GNOME Keyring, KWallet). Bez ní jsou uložené jen obfuskované a v nastavení uvidíte varování.',
    macos: 'Klíče chrání Klíčenka macOS (Keychain).'
  },
  en: {
    windows: 'Keys are protected by Windows (DPAPI) and tied to your Windows user account.',
    linux: 'Keys are protected by the system wallet (libsecret / GNOME Keyring, KWallet). Without one they are only obfuscated and the settings show a warning.',
    macos: 'Keys are protected by the macOS Keychain.'
  }
}

const TRAY: Record<Lang, Record<OsKey, string>> = {
  cs: {
    windows: 'Ikona u hodin (oznamovací oblast). Pravé tlačítko: <i>Otevřít</i> / <i>Ukončit</i>. Spouštění s Windows se zapíná v Nastavení.',
    linux: 'Ikona v systémové liště (potřebuje podporu StatusNotifier, u GNOME rozšíření AppIndicator). Spouštění se systémem vytvoří soubor v <code>~/.config/autostart</code>.',
    macos: 'Ikona v horní liště. Spouštění při přihlášení se zapíná v Nastavení.'
  },
  en: {
    windows: 'An icon next to the clock (notification area). Right-click: <i>Open</i> / <i>Quit</i>. Starting with Windows is turned on in Settings.',
    linux: 'An icon in the system tray (needs StatusNotifier support; GNOME needs the AppIndicator extension). Starting with the system creates a file in <code>~/.config/autostart</code>.',
    macos: 'An icon in the menu bar. Starting at login is turned on in Settings.'
  }
}

const BODY: Record<Lang, string> = {
  cs: `
<h1>Nápověda OKfetch – {os}</h1>

<h2>Co je kde</h2>
<ul>
<li><b>Fetch</b> – kontakty a skupiny vlevo, otevřené chaty vpravo jako záložky.</li>
<li><b>Nastavení</b> – profil, vzhled, zabezpečení, úložiště a systém.</li>
<li>Vpravo nahoře je vaše jméno, stav sítě (Online / Připojování / Offline) a zvonek s počtem čekajících žádostí.</li>
<li><b>?</b> vpravo dole otevře tuto nápovědu.</li>
</ul>

<h2>Instalace</h2>
{install}

<h2>Jak navázat spojení</h2>
<ol>
<li>V <i>Nastavení → Profil</i> si nastavte <b>heslo pro příjem</b> a pošlete kamarádovi <b>identifikátor</b> a heslo – každé <b>jinou cestou</b> (např. identifikátor e-mailem, heslo po telefonu).</li>
<li>Kamarád klikne na <i>Přidat kontakt</i>, vyplní váš identifikátor a heslo a odešle žádost.</li>
<li>Vám se v panelu <i>Žádosti</i> objeví jeho jméno. Kliknete na <i>Přijmout</i>, <i>Odmítnout</i> (volitelně s vysvětlením) nebo <i>Blokovat</i>.</li>
<li>Po přijetí vzniknou dva chaty: <b>šifrovaný</b> a <b>nešifrovaný</b>.</li>
</ol>
<p class="note">Je-li protistrana offline, žádost čeká a odešle se, až bude dostupná. Při pěti špatných heslech v řadě se žadatel na 15 minut zablokuje.</p>

<h2>Šifrovaný a nešifrovaný chat</h2>
<ul>
<li>Řádek se zámkem je <b>šifrovaný</b> chat: zprávy a soubory jsou zašifrované i na disku.</li>
<li>Druhý řádek je <b>nešifrovaný</b> chat: o něco rychlejší a jednodušší, zprávy se ukládají jako běžný text. Hodí se na velké soubory, které nejsou tajné.</li>
<li>Oba chaty používají stejné spojení; v obou je jiná historie.</li>
</ul>

<h2>Zprávy</h2>
<ul>
<li><code>Enter</code> odešle zprávu, <code>Shift+Enter</code> vloží nový řádek.</li>
<li>Panel nástrojů: <i>Normální text</i>, <i>Nadpis</i>, <i>Podnadpis</i>, <b>B</b>, <i>I</i>, odkaz a odsazení. Odkazy se otevírají v prohlížeči.</li>
<li>Stavy zprávy: hodiny = čeká, ✓ doručeno, ✓✓ přečteno. Protistrana vidí „píše…“.</li>
<li><code>{mod}+F</code> hledá v chatu, zvýrazní výskyty a skáče mezi nimi.</li>
</ul>

<h2>Offline a čekající zprávy</h2>
<ul>
<li>Když je protistrana offline, zpráva čeká (hodiny) a odešle se po jejím připojení, ve správném pořadí.</li>
<li>Čekající zpráva může mít nejvýše 5000 znaků; počítadlo se objeví u pole zprávy.</li>
<li>Blok <i>Nedoručeno – čeká na protistranu</i> ukazuje, co se zatím nedoručilo.</li>
<li>Soubor se posílá jen mezi dvěma online stranami. Nabídka offline se zobrazí jako čekající.</li>
</ul>

<h2>Mazání</h2>
<ul>
<li>Tlačítko <i>Vybrat</i> zapne výběr zpráv. <i>Smazat pro mě</i> smaže zprávy jen vám (i čekající).</li>
<li><i>Smazat pro oba</i> smaže vaše zprávy i druhé straně. Je zamčené, jakmile je ve výběru zpráva od někoho jiného.</li>
</ul>

<h2>Soubory a GIF</h2>
<ul>
<li>Sponka vybere soubor. Příjemce ho <i>přijme</i>, <i>odmítne</i> nebo <i>odmítne s vysvětlením</i>, které vám uvidíte v chatu.</li>
<li>Obrázky a GIF (gif, png, jpg, webp) se po přijetí zobrazí přímo v chatu, GIF animovaně. Kliknutím se zvětší.</li>
<li>Po přenosu se ověří kontrolní součet; poškozený soubor se zahodí.</li>
</ul>

<h2>Skupiny</h2>
<ul>
<li><i>Nová skupina</i>: zvolte název, typ (šifrovaná / nešifrovaná) a kontakty. Pozvaní uvidí pozvánku v panelu <i>Žádosti</i>.</li>
<li>Člen skupiny se může spojit i s lidmi, které nemá v kontaktech – stačí, že jsou ve stejné skupině.</li>
<li>Název a členy může měnit kdokoli (platí poslední změna). Pravé tlačítko na skupině: <i>Nastavení skupiny</i>, <i>Opustit</i>.</li>
<li>Ve skupinách se posílají jen zprávy, ne soubory.</li>
</ul>

<h2>Ověřovací kód</h2>
<p>Pravé tlačítko na kontaktu → <i>Ověřit</i>. Obě strany uvidí stejných 30 číslic. Přečtěte si je po telefonu; shodují-li se, nikdo se mezi vás nevklínil. Pak označte kontakt jako ověřený (štít u jména).</p>

<h2>Blokování</h2>
<p>Zablokovaný kontakt se nemůže spojit, nepřijdou od něj zprávy ani žádosti. Seznam a odblokování najdete v <i>Nastavení → Zabezpečení</i>.</p>

<h2>Cesta k úložišti</h2>
<ul>
<li>Data (zprávy, soubory, klíče) jsou jen na vašem počítači ve složce <code>{storage}</code>.</li>
<li>Nastavení vzhledu je v <code>{config}</code>.</li>
<li>Složku můžete změnit v <i>Nastavení → Úložiště a systém</i>; data se přesunou. Když se do složky nedá zapisovat, aplikace nabídne výběr jiné.</li>
</ul>

<h2>Firewall</h2>
{firewall}

<h2>Ikona v liště a spuštění se systémem</h2>
<p>{tray}</p>

<h2>Úložiště klíčů</h2>
<p>{keystore}</p>

<h2>Klávesové zkratky</h2>
<table>
<tr><td><code>Enter</code> / <code>Shift+Enter</code></td><td>odeslat / nový řádek</td></tr>
<tr><td><code>{mod}+F</code></td><td>hledat v chatu</td></tr>
<tr><td><code>{mod}+B</code> / <code>{mod}+I</code></td><td>tučné / kurzíva</td></tr>
<tr><td><code>{mod}+1</code> / <code>{mod}+2</code> / <code>{mod}+0</code></td><td>nadpis / podnadpis / normální text</td></tr>
<tr><td><code>Tab</code> / <code>Shift+Tab</code></td><td>odsadit / zmenšit odsazení</td></tr>
<tr><td><code>Esc</code></td><td>zavřít dialog nebo hledání</td></tr>
</table>
`,
  en: `
<h1>OKfetch help – {os}</h1>

<h2>What is where</h2>
<ul>
<li><b>Fetch</b> – contacts and groups on the left, open chats on the right as tabs.</li>
<li><b>Settings</b> – profile, appearance, security, storage and system.</li>
<li>In the top right: your name, the network status (Online / Connecting / Offline) and a bell with the number of waiting requests.</li>
<li><b>?</b> in the bottom right corner opens this help.</li>
</ul>

<h2>Install</h2>
{install}

<h2>How to connect</h2>
<ol>
<li>In <i>Settings → Profile</i> set a <b>receive password</b> and send your friend your <b>identifier</b> and the password – each <b>by a different route</b> (for example the identifier by e-mail, the password by phone).</li>
<li>Your friend clicks <i>Add contact</i>, enters your identifier and the password and sends the request.</li>
<li>You see their name in the <i>Requests</i> panel. Click <i>Accept</i>, <i>Decline</i> (optionally with an explanation) or <i>Block</i>.</li>
<li>After you accept, two chats exist: an <b>encrypted</b> and a <b>plain</b> one.</li>
</ol>
<p class="note">If the other side is offline, the request waits and is sent once they are reachable. After five wrong passwords in a row the requester is blocked for 15 minutes.</p>

<h2>Encrypted and plain chat</h2>
<ul>
<li>The row with a lock is the <b>encrypted</b> chat: messages and files are encrypted on disk too.</li>
<li>The other row is the <b>plain</b> chat: a little faster and simpler, messages are stored as normal text. Good for big files that are not secret.</li>
<li>Both chats use the same connection; each has its own history.</li>
</ul>

<h2>Messages</h2>
<ul>
<li><code>Enter</code> sends, <code>Shift+Enter</code> inserts a new line.</li>
<li>Toolbar: <i>Normal text</i>, <i>Heading</i>, <i>Subheading</i>, <b>B</b>, <i>I</i>, link and indentation. Links open in your browser.</li>
<li>Message states: clock = waiting, ✓ delivered, ✓✓ read. The other side sees “typing…”.</li>
<li><code>{mod}+F</code> searches the chat, highlights matches and jumps between them.</li>
</ul>

<h2>Offline and waiting messages</h2>
<ul>
<li>If the other side is offline, the message waits (clock) and is sent in order once they connect.</li>
<li>A waiting message can have at most 5000 characters; a counter appears next to the message box.</li>
<li>The block <i>Undelivered – waiting for the other side</i> shows what has not arrived yet.</li>
<li>Files go only between two online sides. An offline offer is shown as waiting.</li>
</ul>

<h2>Deleting</h2>
<ul>
<li>The <i>Select</i> button turns on message selection. <i>Delete for me</i> removes messages only for you (waiting ones too).</li>
<li><i>Delete for both</i> removes your messages on the other side as well. It is locked as soon as the selection contains a message from someone else.</li>
</ul>

<h2>Files and GIFs</h2>
<ul>
<li>The paperclip picks a file. The receiver can <i>accept</i>, <i>decline</i> or <i>decline with an explanation</i>, which you see in the chat.</li>
<li>Images and GIFs (gif, png, jpg, webp) are shown right in the chat after they arrive, GIFs animated. Click to enlarge.</li>
<li>After the transfer a checksum is verified; a damaged file is discarded.</li>
</ul>

<h2>Groups</h2>
<ul>
<li><i>New group</i>: choose a name, a type (encrypted / plain) and contacts. Invited people see the invitation in the <i>Requests</i> panel.</li>
<li>Group members can also connect with people who are not in their contacts – being in the same group is enough.</li>
<li>Anyone can change the name and members (the last change wins). Right-click a group: <i>Group settings</i>, <i>Leave</i>.</li>
<li>Groups carry messages only, not files.</li>
</ul>

<h2>Verification code</h2>
<p>Right-click a contact → <i>Verify</i>. Both sides see the same 30 digits. Read them out over the phone; if they match, nobody sits between you. Then mark the contact as verified (shield next to the name).</p>

<h2>Blocking</h2>
<p>A blocked contact cannot connect, and no messages or requests arrive from them. The list and unblocking are in <i>Settings → Security</i>.</p>

<h2>Storage location</h2>
<ul>
<li>Your data (messages, files, keys) is only on your computer, in <code>{storage}</code>.</li>
<li>Appearance settings are in <code>{config}</code>.</li>
<li>Change the folder in <i>Settings → Storage and system</i>; the data is moved. If the folder cannot be written, the app offers to choose another.</li>
</ul>

<h2>Firewall</h2>
{firewall}

<h2>Tray icon and start with the system</h2>
<p>{tray}</p>

<h2>Key storage</h2>
<p>{keystore}</p>

<h2>Keyboard shortcuts</h2>
<table>
<tr><td><code>Enter</code> / <code>Shift+Enter</code></td><td>send / new line</td></tr>
<tr><td><code>{mod}+F</code></td><td>search in the chat</td></tr>
<tr><td><code>{mod}+B</code> / <code>{mod}+I</code></td><td>bold / italic</td></tr>
<tr><td><code>{mod}+1</code> / <code>{mod}+2</code> / <code>{mod}+0</code></td><td>heading / subheading / normal text</td></tr>
<tr><td><code>Tab</code> / <code>Shift+Tab</code></td><td>indent / reduce indent</td></tr>
<tr><td><code>Esc</code></td><td>close a dialog or the search</td></tr>
</table>
`
}

export function buildHelp(language: Lang, os: OsKey, colors: Palette): string {
  const style = `<style>.help h1,.help h2{color:${colors.accent}}.help code{background:${colors.surface}}.help .note{color:${colors.text_muted}}</style>`
  const values: Record<string, string> = {
    os: OS_NAMES[os],
    install: INSTALL[language][os],
    firewall: FIREWALL[language][os],
    tray: TRAY[language][os],
    keystore: KEYSTORE[language][os],
    storage: STORAGE[os],
    config: SETTINGS[os],
    mod: MOD[os]
  }
  return style + BODY[language].replace(/\{(os|install|firewall|tray|keystore|storage|config|mod)\}/g, (_m, key: string) => values[key])
}

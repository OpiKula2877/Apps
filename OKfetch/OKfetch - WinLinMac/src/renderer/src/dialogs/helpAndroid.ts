// User guide of the Android app (the "?" button on the phone). Only Android, written for a small screen.
import type { Palette } from '../../../shared/theme'

type Lang = 'cs' | 'en'

const BODY: Record<Lang, string> = {
  cs: `
<h1>Nápověda OKfetch – Android</h1>

<h2>Co je kde</h2>
<ul>
<li><b>Seznam</b>: kontakty, skupiny a <i>Žádosti</i>. U každého kontaktu jsou dva chaty: 🔒 <b>šifrovaný</b> a <b>nešifrovaný</b>.</li>
<li>Klepnutím se chat otevře přes celou obrazovku, šipka vlevo nahoře (nebo tlačítko Zpět) vás vrátí na seznam.</li>
<li>Tečka u loga ukazuje připojení: zelená = online.</li>
<li>Ozubené kolo otevře <b>Nastavení</b>.</li>
<li>Podržením prstu na kontaktu nebo skupině otevřete nabídku (přejmenovat, ikona, ověřit, blokovat, odstranit).</li>
</ul>

<h2>Instalace a aktualizace</h2>
<ol>
<li>Zkopírujte <code>OKfetch.apk</code> do telefonu a otevřete ho (ze Stažených nebo ze správce souborů).</li>
<li>Telefon se zeptá, jestli smí aplikace instalovat aplikace: povolte to pro prohlížeč nebo správce souborů.</li>
<li>Pokud Play Protect varuje před neznámou aplikací, zvolte <i>Další podrobnosti → Přesto nainstalovat</i>.</li>
<li>Aktualizace: nainstalujte nové APK přes staré. Data zůstanou.</li>
</ol>
<p class="note">Potřebujete Android 10 nebo novější. Odinstalování aplikace smaže všechna data, nejdřív si udělejte zálohu.</p>

<h2>Jak navázat spojení</h2>
<ol>
<li>V <i>Nastavení → Profil</i> si nastavte <b>heslo pro příjem</b>. Tamtéž je váš <b>identifikátor</b> a <b>QR kód</b>.</li>
<li>Kamarád zvolí <i>Přidat kontakt → Naskenovat QR</i> a namíří telefon na váš QR kód (funguje i QR kód z počítačové verze). Identifikátor jde také opsat nebo poslat zprávou.</li>
<li>Heslo mu řekněte <b>jinou cestou</b>, třeba po telefonu. QR kód heslo neobsahuje.</li>
<li>Žádost se vám objeví v <i>Žádostech</i>: <i>Přijmout</i>, <i>Odmítnout</i> nebo <i>Blokovat</i>.</li>
</ol>
<p class="note">Telefon a počítač si rozumí: kontakt na počítači přidáte stejně.</p>

<h2>Zprávy</h2>
<ul>
<li>Klávesa Enter dělá nový řádek, zprávu odešle tlačítko se šipkou.</li>
<li><b>Aa</b> ukáže formátování: nadpis, podnadpis, tučné, kurzíva, odkaz, odsazení.</li>
<li>Stavy: hodiny = čeká, ✓ doručeno, ✓✓ přečteno. Vidíte i „píše…“.</li>
<li>Lupa nahoře hledá v chatu.</li>
</ul>

<h2>Na pozadí, offline a čekající zprávy</h2>
<ul>
<li>OKfetch nemá server. Zprávy přijímá jen <b>běžící</b> aplikace.</li>
<li>S volbou <i>Nastavení → Pozadí, notifikace a záloha → Běžet na pozadí</i> (zapnuto) je v liště trvalá notifikace „OKfetch běží“ a zprávy chodí i se zavřenou aplikací. Po restartu telefonu se služba spustí sama.</li>
<li>Když volbu vypnete, aplikace přijímá jen otevřená. Zprávy pro vás mezitím počkají u odesílatele a dorazí, až aplikaci otevřete.</li>
<li>Některé telefony (Xiaomi, Huawei, Samsung…) uspávají aplikace. Použijte tlačítko <i>Vypnout optimalizaci baterie</i>; u Xiaomi povolte i <i>Automatické spouštění</i>.</li>
<li>Čekající zpráva může mít nejvýše 5000 znaků.</li>
</ul>

<h2>Notifikace</h2>
<ul>
<li>Z notifikace jde rovnou <b>odpovědět</b> nebo zprávu označit jako <b>přečtenou</b>, i když je aplikace zamčená.</li>
<li><i>Skrýt obsah notifikací</i> ukáže jen „Nová zpráva“ bez jména a textu.</li>
<li>Zvuk a vibrace nastavíte v systému: podržte notifikaci → <i>Nastavení</i> (kanály Zprávy, Žádosti, Služba na pozadí).</li>
</ul>

<h2>Mazání</h2>
<ul>
<li>Podržte zprávu: zapne se výběr. Ťukáním přidáte další zprávy.</li>
<li><i>Smazat pro mě</i> smaže zprávy jen vám. <i>Smazat pro oba</i> smaže vaše zprávy i druhé straně.</li>
</ul>

<h2>Soubory a fotky</h2>
<ul>
<li>Sponka: <i>Soubor</i> nebo <i>Vyfotit</i>. Příjemce soubor přijme nebo odmítne (i s vysvětlením).</li>
<li>Z galerie nebo jiné aplikace: <i>Sdílet → OKfetch</i> a vyberte chat. Soubory jdou jen do chatů s kontaktem, text i do skupin.</li>
<li>Přijatý soubor: <i>Otevřít</i>, <i>Uložit</i> (do Stažených, složka OKfetch) nebo <i>Sdílet</i>. Obrázky a GIF se ukážou přímo v chatu.</li>
<li>Soubor se posílá jen mezi dvěma online stranami.</li>
</ul>

<h2>Skupiny</h2>
<ul>
<li><i>Nová skupina</i>: název, typ (šifrovaná / nešifrovaná) a kontakty. Pozvánka se objeví v <i>Žádostech</i>.</li>
<li>Název a členy může měnit kdokoli. Podržením skupiny otevřete její nastavení nebo ji opustíte.</li>
<li>Ve skupinách se posílají jen zprávy.</li>
</ul>

<h2>Otisk prstu a soukromí</h2>
<ul>
<li><i>Nastavení → Zabezpečení → Odemykat otiskem prstu</i>. Když otisk nejde, odemknete PINem nebo gestem telefonu.</li>
<li><i>Zamknout po</i>: hned, za 1, 5 nebo 15 minut na pozadí.</li>
<li>Zámek chrání obrazovku aplikace. Zprávy se na pozadí přijímají dál.</li>
<li><i>Blokovat snímky obrazovky</i> zakáže snímky a v přehledu aplikací ukáže prázdný náhled.</li>
<li>Klíče jsou chráněné úložištěm klíčů Androidu (Keystore).</li>
</ul>

<h2>Ověřovací kód a blokování</h2>
<p>Podržte kontakt → <i>Ověřit</i>. Obě strany uvidí stejných 30 číslic; přečtěte si je po telefonu. Zablokovaný kontakt se nemůže spojit; odblokujete ho v <i>Nastavení → Zabezpečení</i>.</p>

<h2>Záloha a nový telefon</h2>
<ul>
<li>Data jsou jen v telefonu. Bez zálohy o identitu a chaty při ztrátě telefonu přijdete.</li>
<li><i>Nastavení → Pozadí, notifikace a záloha → Zálohovat</i>: zadejte heslo zálohy (aspoň 8 znaků) a soubor <code>.okfb</code> uložte, třeba na Disk Google nebo do počítače. Přijaté soubory můžete přibalit.</li>
<li>Na novém telefonu nainstalujte OKfetch a zvolte <i>Obnovit</i>: vyberte soubor a zadejte heslo zálohy.</li>
<li>Stejnou identitu nepoužívejte na dvou telefonech zároveň: spojení by se přetahovala.</li>
</ul>

<h2>Mobilní data, Wi-Fi a náhradní cesta</h2>
<ul>
<li>OKfetch se nejdřív zkusí spojit <b>přímo</b> se zařízením protistrany.</li>
<li>Když to nejde (obě strany za NAT s náhodnými porty – typicky mobilní data nebo internet přes mobilního operátora), za pár sekund se zprávy pošlou <b>náhradní cestou přes veřejné Nostr relay servery</b>. Je to zdarma a bez registrace.</li>
<li>Všechno je šifrované mezi vámi a protistranou. Relay vidí jen šifrované bloky, čas a vaši IP adresu. U kontaktu pak uvidíte „online · přes relay“.</li>
<li>Přes relay jsou soubory pomalejší (desítky KB/s – fotka za pár sekund, velké video trvá dlouho). Jakmile jde přímé spojení, aplikace na něj sama přejde.</li>
<li>Náhradní cestu vypnete nebo seznam relay změníte v <i>Nastavení → Pozadí, notifikace a záloha → Síť a diagnostika spojení</i>. Tamtéž zjistíte, proč se kontakt nespojí (<i>Otestovat</i>, <i>Kopírovat diagnostiku</i>).</li>
</ul>

<h2>Tlačítko Zpět</h2>
<p>Zavře dialog nebo nabídku, pak chat nebo sekci Nastavení. Na seznamu pošle aplikaci na pozadí, kde dál přijímá zprávy.</p>
`,
  en: `
<h1>OKfetch help – Android</h1>

<h2>What is where</h2>
<ul>
<li><b>List</b>: contacts, groups and <i>Requests</i>. Every contact has two chats: 🔒 <b>encrypted</b> and <b>plain</b>.</li>
<li>Tap a chat to open it full screen; the arrow in the top left (or the Back button) returns to the list.</li>
<li>The dot next to the logo shows the connection: green = online.</li>
<li>The gear opens <b>Settings</b>.</li>
<li>Hold your finger on a contact or group for its menu (rename, icon, verify, block, remove).</li>
</ul>

<h2>Install and update</h2>
<ol>
<li>Copy <code>OKfetch.apk</code> to the phone and open it (from Downloads or a file manager).</li>
<li>The phone asks whether that app may install apps: allow it for the browser or file manager.</li>
<li>If Play Protect warns about an unknown app, choose <i>More details → Install anyway</i>.</li>
<li>Updates: install the new APK over the old one. The data stays.</li>
</ol>
<p class="note">Android 10 or newer is needed. Uninstalling deletes all data, so make a backup first.</p>

<h2>Connecting with someone</h2>
<ol>
<li>In <i>Settings → Profile</i> set a <b>receive password</b>. Your <b>identifier</b> and <b>QR code</b> are there too.</li>
<li>Your friend chooses <i>Add contact → Scan QR</i> and points the phone at your QR code (the QR code of the desktop version works too). The identifier can also be typed or sent in a message.</li>
<li>Tell them the password <b>another way</b>, for example by phone. The QR code does not contain it.</li>
<li>The request appears in your <i>Requests</i>: <i>Accept</i>, <i>Decline</i> or <i>Block</i>.</li>
</ol>
<p class="note">Phone and computer understand each other: a contact on a computer is added the same way.</p>

<h2>Messages</h2>
<ul>
<li>Enter starts a new line; the arrow button sends.</li>
<li><b>Aa</b> shows formatting: heading, subheading, bold, italic, link, indent.</li>
<li>States: clock = waiting, ✓ delivered, ✓✓ read. You also see “typing…”.</li>
<li>The magnifier at the top searches the chat.</li>
</ul>

<h2>Background, offline and waiting messages</h2>
<ul>
<li>OKfetch has no server. Only a <b>running</b> app receives messages.</li>
<li>With <i>Settings → Background, notifications and backup → Run in background</i> (on), a permanent “OKfetch is running” notification stays in the bar and messages arrive while the app is closed. After a restart of the phone the service starts by itself.</li>
<li>With the option off, the app receives only while open. Messages for you wait at the sender and arrive when you open the app.</li>
<li>Some phones (Xiaomi, Huawei, Samsung…) put apps to sleep. Use <i>Disable battery optimisation</i>; on Xiaomi also allow <i>Autostart</i>.</li>
<li>A waiting message can have at most 5000 characters.</li>
</ul>

<h2>Notifications</h2>
<ul>
<li>You can <b>reply</b> right from the notification or mark the message as <b>read</b>, even while the app is locked.</li>
<li><i>Hide notification content</i> shows only “New message”, without the name and text.</li>
<li>Sound and vibration are set by the system: hold the notification → <i>Settings</i> (channels Messages, Requests, Background service).</li>
</ul>

<h2>Deleting</h2>
<ul>
<li>Hold a message to start selecting; tap more messages to add them.</li>
<li><i>Delete for me</i> deletes them only for you. <i>Delete for both</i> also deletes your messages on the other side.</li>
</ul>

<h2>Files and photos</h2>
<ul>
<li>Paperclip: <i>File</i> or <i>Take photo</i>. The receiver accepts or declines (with an explanation if they like).</li>
<li>From the gallery or another app: <i>Share → OKfetch</i> and pick the chat. Files go only to chats with a contact, text also to groups.</li>
<li>A received file: <i>Open</i>, <i>Save</i> (to Downloads, folder OKfetch) or <i>Share</i>. Images and GIFs show right in the chat.</li>
<li>Files are sent only between two online sides.</li>
</ul>

<h2>Groups</h2>
<ul>
<li><i>New group</i>: name, type (encrypted / plain) and contacts. The invitation appears in <i>Requests</i>.</li>
<li>Anyone can change the name and members. Hold a group for its settings or to leave it.</li>
<li>Groups carry messages only.</li>
</ul>

<h2>Fingerprint and privacy</h2>
<ul>
<li><i>Settings → Security → Unlock with fingerprint</i>. When the fingerprint does not work, the phone PIN or pattern unlocks.</li>
<li><i>Lock after</i>: at once, after 1, 5 or 15 minutes in the background.</li>
<li>The lock protects the app screen. Messages keep arriving in the background.</li>
<li><i>Block screenshots</i> forbids screenshots and blanks the preview in the recent apps.</li>
<li>Keys are protected by the Android key store (Keystore).</li>
</ul>

<h2>Verification code and blocking</h2>
<p>Hold a contact → <i>Verify</i>. Both sides see the same 30 digits; read them to each other by phone. A blocked contact cannot connect; unblock it in <i>Settings → Security</i>.</p>

<h2>Backup and a new phone</h2>
<ul>
<li>The data is only on the phone. Without a backup, a lost phone means a lost identity and chats.</li>
<li><i>Settings → Background, notifications and backup → Back up</i>: enter a backup password (8 characters or more) and save the <code>.okfb</code> file, for example to Google Drive or a computer. Received files can be included.</li>
<li>On the new phone install OKfetch and choose <i>Restore</i>: pick the file and enter the backup password.</li>
<li>Do not use one identity on two phones at once: their connections would fight.</li>
</ul>

<h2>Mobile data, Wi-Fi and the fallback</h2>
<ul>
<li>OKfetch first tries to connect <b>directly</b> to the other device.</li>
<li>When that is not possible (both sides behind NATs with random ports – typically mobile data or internet through a mobile operator), after a few seconds the messages go <b>through public Nostr relays</b> instead. Free, no account.</li>
<li>Everything stays encrypted between you and the other side. Relays see only encrypted blocks, timing and your IP address. The contact then shows “online · through a relay”.</li>
<li>Files are slower through relays (tens of KB/s – a photo takes a few seconds, a large video a long time). As soon as a direct connection works, the app switches to it.</li>
<li>Turn the fallback off or change the relay list in <i>Settings → Background, notifications and backup → Network and connection diagnostics</i>. There you also find out why a contact does not connect (<i>Test</i>, <i>Copy diagnostics</i>).</li>
</ul>

<h2>The Back button</h2>
<p>It closes a dialog or menu, then the chat or the Settings section. On the list it sends the app to the background, where it keeps receiving messages.</p>
`
}

export function buildAndroidHelp(language: Lang, colors: Palette): string {
  const style = `<style>.help h1,.help h2{color:${colors.accent}}.help code{background:${colors.surface}}.help .note{color:${colors.text_muted}}</style>`
  return style + BODY[language]
}

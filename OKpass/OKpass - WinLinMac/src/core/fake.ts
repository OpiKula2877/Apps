// Deterministic generator of plausible vault content.
// The same seed (and account owner) always gives the same vault. The content does
// not depend on the UI language or on the current date.
import type { Field, PasswordEntry, TextDocument } from '../shared/model'
import { readU32 } from './bytes'
import type { Vault } from './vault'

/** xoshiro128** seeded from the 32-byte seed. */
class Rng {
  private s = new Uint32Array(4)

  constructor(seed: Uint8Array) {
    for (let i = 0; i < 4; i++) this.s[i] = (readU32(seed, i * 4) ^ readU32(seed, 16 + i * 4)) >>> 0
    if (!this.s.some((v) => v !== 0)) this.s[0] = 1
  }

  next(): number {
    const s = this.s
    const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0
    const result = Math.imul(rotl(Math.imul(s[1], 5) >>> 0, 7), 9) >>> 0
    const t = (s[1] << 9) >>> 0
    s[2] ^= s[0]
    s[3] ^= s[1]
    s[1] ^= s[2]
    s[0] ^= s[3]
    s[2] ^= t
    s[3] = rotl(s[3], 11)
    return result
  }

  random(): number {
    return this.next() / 2 ** 32
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1))
  }

  choice<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length)]
  }

  sample<T>(items: readonly T[], count: number): T[] {
    const copy = [...items]
    const n = Math.min(count, copy.length)
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(this.random() * (copy.length - i))
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy.slice(0, n)
  }

  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) out[i] = this.next() & 0xff
    return out
  }

  id(): string {
    return Array.from({ length: 4 }, () => this.next().toString(16).padStart(8, '0')).join('')
  }
}

const NAMES: [string, string][] = [
  ['Petr', 'Novák'], ['Jan', 'Svoboda'], ['Tomáš', 'Dvořák'], ['Lukáš', 'Černý'],
  ['Jakub', 'Procházka'], ['Martin', 'Kučera'], ['Ondřej', 'Veselý'], ['David', 'Horák'],
  ['Michal', 'Němec'], ['Filip', 'Marek'], ['Adam', 'Pokorný'], ['Vojtěch', 'Král'],
  ['Jana', 'Nováková'], ['Lucie', 'Svobodová'], ['Tereza', 'Dvořáková'], ['Kateřina', 'Černá'],
  ['Eva', 'Procházková'], ['Barbora', 'Kučerová'], ['Veronika', 'Veselá'], ['Klára', 'Horáková'],
  ['Markéta', 'Němcová'], ['Anna', 'Marková'], ['Michaela', 'Pokorná'], ['Lenka', 'Králová']
]

const SERVICES: [string, string][] = [
  ['Google', 'accounts.google.com'], ['Seznam', 'email.seznam.cz'], ['Facebook', 'facebook.com'],
  ['Instagram', 'instagram.com'], ['Netflix', 'netflix.com'], ['Spotify', 'spotify.com'],
  ['Steam', 'store.steampowered.com'], ['Discord', 'discord.com'], ['GitHub', 'github.com'],
  ['Microsoft', 'login.live.com'], ['Apple ID', 'appleid.apple.com'], ['Alza', 'alza.cz'],
  ['Rohlík', 'rohlik.cz'], ['Mall', 'mall.cz'], ['O2', 'moje.o2.cz'], ['T-Mobile', 't-mobile.cz'],
  ['Vodafone', 'vodafone.cz'], ['ČEZ', 'cez.cz'], ['Twitch', 'twitch.tv'], ['Reddit', 'reddit.com'],
  ['LinkedIn', 'linkedin.com'], ['Dropbox', 'dropbox.com'], ['Epic Games', 'epicgames.com'],
  ['PlayStation', 'playstation.com'], ['Booking.com', 'booking.com'], ['Bolt', 'bolt.eu'],
  ['Wolt', 'wolt.com'], ['Datová schránka', 'mojedatovaschranka.cz'], ['Zásilkovna', 'zasilkovna.cz'],
  ['Heureka', 'heureka.cz'], ['Notino', 'notino.cz'], ['Vinted', 'vinted.cz'], ['YouTube', 'youtube.com'],
  ['Wi-Fi doma', ''], ['Router', '192.168.0.1'], ['Školní systém', 'bakalari.cz']
]

const WORDS = ['heslo', 'kocka', 'pes', 'leto', 'zima', 'praha', 'brno', 'hokej', 'fotbal', 'slunce', 'mesic',
  'drak', 'tygr', 'lev', 'kava', 'pivo', 'auto', 'vlak', 'hora', 'les', 'more', 'rybar', 'klavir']
const CITIES = ['Praha', 'Brno', 'Ostrava', 'Olomouc', 'Plzeň', 'Liberec', 'Zlín', 'Hradec Králové', 'Pardubice']
const DESTINATIONS = ['Chorvatsko', 'Itálie', 'Šumava', 'Krkonoše', 'Rakousko', 'Řecko', 'Slovensko', 'Beskydy', 'Lipno']
const MONTHS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec']
const GROCERIES = ['mléko', 'chléb', 'máslo', 'vejce', 'rohlíky', 'jogurty', 'sýr eidam', 'šunka', 'brambory', 'cibule',
  'rajčata', 'okurka', 'jablka', 'banány', 'těstoviny', 'rýže', 'kuřecí prsa', 'mouka', 'cukr', 'káva',
  'čaj', 'pomerančový džus', 'toaletní papír', 'prášek na praní', 'zubní pasta', 'šampon', 'pečivo']
const TASKS = ['zaplatit nájem', 'objednat se k zubaři', 'vrátit knihy do knihovny', 'zavolat mamce',
  'přezout pneumatiky', 'zrušit předplatné', 'koupit dárek k narozeninám', 'vyřídit pojistku',
  'uklidit sklep', 'opravit kapající kohoutek', 'poslat fakturu', 'zarezervovat restauraci',
  'prodloužit občanku', 'objednat filtr do vysavače', 'zálohovat fotky', 'vyměnit žárovku v kuchyni']
const IDEAS = [
  'Udělat jednoduchou aplikaci na sledování výdajů.',
  'Zkusit pěstovat bylinky na balkoně – bazalka, máta, rozmarýn.',
  'Naplánovat víkendový výlet na kole podél řeky.',
  'Začít chodit dvakrát týdně běhat, ideálně ráno.',
  'Sepsat recepty od babičky, než se zapomenou.',
  'Předělat pokoj – nová police a lepší osvětlení u stolu.',
  'Naučit se základy fotografování a pořídit si pevný objektiv.',
  'Uspořádat grilovačku pro sousedy na konci léta.',
  'Prodat staré věci z půdy přes bazar.',
  'Zkusit kurz keramiky nebo vaření.'
]
const MEETING_LINES = [
  'Probrali jsme aktuální stav projektu a termíny na další měsíc.',
  'Rozpočet zůstává beze změny, případné navýšení se řeší až v příštím kvartálu.',
  'Klient požaduje drobné úpravy v návrhu, hlavní struktura zůstává.',
  'Testování se posouvá o týden kvůli dovoleným.',
  'Dohodli jsme se na pravidelném krátkém callu každé pondělí v 9:00.',
  'Je potřeba aktualizovat dokumentaci a sjednotit názvy souborů.'
]
const RECIPES: Record<string, [string[], string[]]> = {
  Bramboráky: [['brambory', 'vejce', 'česnek', 'majoránka', 'hladká mouka', 'sůl a pepř'],
    ['Brambory nastrouháme najemno a vymačkáme vodu.', 'Přidáme vejce, prolisovaný česnek, koření a mouku.',
      'Smažíme na rozpáleném oleji dozlatova z obou stran.']],
  'Kuřecí kari': [['kuřecí prsa', 'kokosové mléko', 'kari pasta', 'cibule', 'rýže', 'koriandr'],
    ['Cibuli osmahneme, přidáme kari pastu a krátce orestujeme.', 'Přidáme na kostky nakrájené maso a opečeme.',
      'Zalijeme kokosovým mlékem a 15 minut povaříme. Podáváme s rýží.']],
  Palačinky: [['mléko', 'vejce', 'hladká mouka', 'špetka soli', 'olej', 'džem'],
    ['Vše prošleháme na hladké těsto a necháme 15 minut odpočinout.', 'Na pánvi s troškou oleje pečeme tenké palačinky.',
      'Plníme džemem, tvarohem nebo ovocem.']],
  Svíčková: [['hovězí zadní', 'kořenová zelenina', 'smetana', 'cibule', 'nové koření', 'bobkový list'],
    ['Maso prošpikujeme a necháme marinovat v zelenině přes noc.', 'Druhý den maso opečeme, podlijeme a dusíme doměkka.',
      'Zeleninu rozmixujeme, přidáme smetanu a dochutíme citronem a cukrem.']]
}
const BOOKS = ['Saturnin', 'Malý princ', 'Pán prstenů', 'Duna', '1984', 'Hobit', 'Zaklínač', 'Babička',
  'Mistr a Markétka', 'Stopařův průvodce po Galaxii', 'Marťan', 'Jméno růže']
const TRADES = ['Instalatér', 'Elektrikář', 'Malíř', 'Truhlář', 'Automechanik', 'Kominík', 'Zahradník', 'Podlahář']
const SYMBOLS = '!?*.-_#%'
const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Same markup the editor writes, so generated and real documents look identical.
const p = (text: string, indent = 0): string => (indent ? `<p data-indent="${indent}">${text}</p>` : `<p>${text}</p>`)
const h1 = (text: string): string => `<h1>${escapeHtml(text)}</h1>`
const h2 = (text: string): string => `<h2>${escapeHtml(text)}</h2>`

const ascii = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '')

class Generator {
  private rng: Rng
  private first: string
  private last: string
  private firstA: string
  private lastA: string
  private year: number
  private base: number

  constructor(seed: Uint8Array, private ownerName: string, private ownerEmail: string) {
    this.rng = new Rng(seed)
    let [first, last] = this.rng.choice(NAMES)
    const parts = ownerName.trim().split(/\s+/).filter(Boolean)
    if (parts.length >= 2) [first, last] = [parts[0], parts[parts.length - 1]]
    this.ownerName = ownerName.trim()
    this.ownerEmail = ownerEmail.trim()
    this.first = first
    this.last = last
    this.firstA = ascii(first).toLowerCase()
    this.lastA = ascii(last).toLowerCase()
    this.year = this.rng.int(1975, 2006)
    // Fixed reference time between 2023-01 and 2024-08; all dates stay before 2026.
    this.base = 1672531200 + this.rng.int(0, 600) * 86400
  }

  private times(): [number, number] {
    const created = this.base + this.rng.int(0, 300) * 86400 + this.rng.int(0, 86399)
    const modified = created + this.rng.int(0, 120) * 86400 + this.rng.int(0, 86399)
    return [created, modified]
  }

  private nickname(): string {
    return this.rng.choice([this.first, `${this.first} ${this.last[0]}.`, `${this.firstA}${this.rng.int(1, 99)}`, `${this.firstA[0]}${this.lastA}`])
  }

  private usernameFor(url: string): string {
    const rng = this.rng
    const domain = rng.choice(['seznam.cz', 'gmail.com', 'email.cz', 'centrum.cz', 'outlook.com'])
    const variants = [
      `${this.firstA}.${this.lastA}@${domain}`,
      `${this.firstA}.${this.lastA}${String(this.year % 100).padStart(2, '0')}@${domain}`,
      `${this.firstA[0]}${this.lastA}@${domain}`,
      `${this.firstA}${this.lastA.slice(0, 3)}${rng.int(1, 999)}`,
      `${rng.choice(['dark', 'mega', 'super', 'shadow', 'pixel', 'night'])}${rng.choice(['wolf', 'fox', 'hunter', 'rider', 'ninja'])}${rng.int(1, 99)}`
    ]
    if (this.ownerEmail && rng.random() < 0.45) return this.ownerEmail
    return url.endsWith('.cz') ? rng.choice(variants.slice(0, 4)) : rng.choice(variants)
  }

  private password(): string {
    const rng = this.rng
    const style = rng.random()
    if (style < 0.45) {
      const alphabet = LETTERS + SYMBOLS
      return Array.from({ length: rng.int(14, 24) }, () => rng.choice([...alphabet])).join('')
    }
    if (style < 0.75) {
      const word = rng.choice(WORDS)
      const suffix = rng.choice([this.year, rng.int(10, 99), rng.int(2015, 2025)])
      return `${word[0].toUpperCase()}${word.slice(1)}${suffix}${rng.choice([...'!?*.#'])}`
    }
    const words = Array.from({ length: 3 }, () => rng.choice(WORDS))
    return words.join(rng.choice(['-', '.', '_'])) + rng.int(1, 99)
  }

  // --- documents --------------------------------------------------------
  private shopping(): [string, string] {
    const items = this.rng.sample(GROCERIES, this.rng.int(6, 12))
    const half = Math.floor(items.length / 2) + 1
    const html = [h1('Nákupní seznam'), p('<b>Potraviny</b>'), ...items.slice(0, half).map((i) => p(`– ${i}`, 1)),
      p('<b>Ostatní</b>'), ...items.slice(half).map((i) => p(`– ${i}`, 1))]
    return ['Nákupní seznam', html.join('')]
  }

  private meeting(): [string, string] {
    const rng = this.rng
    const title = `Porada ${rng.int(1, 28)}. ${rng.int(1, 12)}.`
    const lines = rng.sample(MEETING_LINES, 3)
    const people = rng.sample(NAMES, 3).map((n) => n[0])
    const tasks = rng.sample(TASKS, 3)
    const html = [h1(title), p(`<i>Přítomni: ${people.join(', ')}</i>`), ...lines.map((l) => p(l)), h2('Úkoly'),
      ...people.map((person, i) => p(`${person}: ${tasks[i]}`, 1))]
    return [title, html.join('')]
  }

  private holiday(): [string, string] {
    const rng = this.rng
    const place = rng.choice(DESTINATIONS)
    const year = 2023 + rng.int(0, 2)
    const day = rng.int(1, 20)
    const month = rng.int(6, 8)
    const html = [
      h1(`Dovolená ${place} ${year}`),
      p(`Termín: <b>${day}. ${month}. – ${day + 7}. ${month}. ${year}</b>`),
      h2('Ubytování'),
      p(`Apartmán pro ${rng.int(2, 5)} osoby, cena cca ${rng.int(8, 30) * 1000} Kč, záloha zaplacena.`),
      h2('Doprava'),
      p(rng.choice(['Autem, vyjet brzo ráno kvůli zácpám.', 'Vlakem s přestupem, jízdenky koupit dopředu.', 'Letecky z Prahy, odbavení online.'])),
      h2('Nezapomenout'),
      ...rng.sample(['pasy', 'nabíječky', 'opalovací krém', 'léky', 'plavky', 'dálniční známka', 'cestovní pojištění', 'adaptér do zásuvky'], 4).map((x) => p(`– ${x}`, 1))
    ]
    return [`Dovolená ${place}`, html.join('')]
  }

  private recipe(): [string, string] {
    const name = this.rng.choice(Object.keys(RECIPES).sort())
    const [ingredients, steps] = RECIPES[name]
    const html = [h1(name), h2('Suroviny'), ...ingredients.map((i) => p(`– ${i}`, 1)), h2('Postup'), ...steps.map((s) => p(s))]
    return [`Recept – ${name}`, html.join('')]
  }

  private tasks(): [string, string] {
    const month = this.rng.choice(MONTHS)
    const lines = this.rng.sample(TASKS, this.rng.int(5, 8)).map((t) => p(`${this.rng.choice(['[x]', '[ ]', '[ ]'])} ${t}`))
    return [`Úkoly na ${month}`, [h1(`Úkoly – ${month}`), ...lines].join('')]
  }

  private ideas(): [string, string] {
    return ['Nápady', [h1('Nápady'), ...this.rng.sample(IDEAS, this.rng.int(3, 6)).map((i) => p(i))].join('')]
  }

  private books(): [string, string] {
    const html = [h1('Knihy na přečtení'), ...this.rng.sample(BOOKS, this.rng.int(4, 7)).map((b) => p(`– <i>${b}</i>`, 1)),
      p(`Půjčit si od ${this.rng.choice(NAMES)[0]} ještě jeden díl.`)]
    return ['Knihy', html.join('')]
  }

  private contacts(): [string, string] {
    const rng = this.rng
    const html = [h1('Kontakty – řemeslníci')]
    for (const trade of rng.sample(TRADES, rng.int(3, 5))) {
      const [first, last] = rng.choice(NAMES)
      const phone = `+420 ${rng.choice(['6', '7'])}${String(rng.int(0, 99)).padStart(2, '0')} ${String(rng.int(0, 999)).padStart(3, '0')} ${String(rng.int(0, 999)).padStart(3, '0')}`
      html.push(p(`<b>${trade}</b> – ${first} ${last}, ${phone}`))
      html.push(p(rng.choice(['Spolehlivý, rychlý.', 'Domluvit se dopředu.', 'Dražší, ale kvalitní.', `Jezdí i do ${rng.choice(CITIES)}.`]), 1))
    }
    return ['Kontakty – řemeslníci', html.join('')]
  }

  private documents(): TextDocument[] {
    const makers = [() => this.shopping(), () => this.meeting(), () => this.holiday(), () => this.recipe(),
      () => this.tasks(), () => this.ideas(), () => this.books(), () => this.contacts()]
    const docs = this.rng.sample(makers, this.rng.int(2, 6)).map((make) => {
      const [title, html] = make()
      const [created, modified] = this.times()
      return { id: this.rng.id(), title, html, created, modified }
    })
    return docs.sort((a, b) => a.created - b.created)
  }

  // --- passwords --------------------------------------------------------
  private field(kind: Field['kind'], value: string, name: string | null = null): Field {
    return { id: this.rng.id(), kind, name, value }
  }

  private entry(name: string, url: string): PasswordEntry {
    const rng = this.rng
    const title = url && rng.random() < 0.4 ? `${name} – ${url}` : url || name
    let user: string
    if (name === 'Router') user = 'admin'
    else if (name === 'Wi-Fi doma') user = `${this.lastA.toUpperCase()}_${rng.choice(['5G', 'NET', 'HOME'])}`
    else user = this.usernameFor(url)
    const fields = [this.field('title', title), this.field('username', user), this.field('password', this.password())]
    if (rng.random() < 0.3) {
      const digits = Array.from({ length: rng.choice([4, 4, 6]) }, () => String(rng.int(0, 9))).join('')
      fields.push(this.field('custom', digits, 'PIN'))
    }
    if (rng.random() < 0.25) {
      const note = rng.choice(['Platí do konce roku.', 'Sdílený účet s rodinou.', 'Dvoufázové ověření přes SMS.',
        'Změnit heslo!', 'Starý účet, nepoužívám.', 'Placený tarif.'])
      fields.push(this.field('custom', note, 'Poznámka'))
    }
    if (rng.random() < 0.1) {
      const codes = Array.from({ length: 4 }, () => String(rng.int(0, 99999999)).padStart(8, '0')).join(' ')
      fields.push(this.field('custom', codes, 'Záložní kódy'))
    }
    const [created, modified] = this.times()
    return { id: rng.id(), created, modified, fields }
  }

  private passwords(): PasswordEntry[] {
    const chosen = this.rng.sample(SERVICES, this.rng.int(6, 16))
    return chosen.map(([name, url]) => this.entry(name, url)).sort((a, b) => a.created - b.created)
  }

  vault(): Vault {
    const username = this.ownerName || this.nickname()
    const documents = this.documents()
    const passwords = this.passwords()
    return { username, documents, passwords, partner: this.rng.bytes(32), decoySet: false }
  }
}

/** Build a plausible vault deterministically from a 32-byte seed and the (non-secret) account owner. */
export function generateVault(seed: Uint8Array, ownerName: string, ownerEmail: string): Vault {
  return new Generator(seed, ownerName, ownerEmail).vault()
}

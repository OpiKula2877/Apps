// Local folder library and the controller working on it (no Electron needed).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/core/settings'
import type { Message, Screen, Settings, SourceDraft } from '../src/shared/ipc'
import type { LibraryData } from '../src/shared/model'
import { Controller } from '../src/main/controller'
import type { Hooks } from '../src/main/hooks'
import { LocalLibrary, resolveInside } from '../src/main/localLibrary'

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000300000002080200000000000000', 'hex')

let root: string
let folder: string
let trash: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'okgram-test-'))
  folder = join(root, 'library')
  trash = join(root, 'trash')
  mkdirSync(join(folder, 'Léto'), { recursive: true })
  mkdirSync(trash)
  writeFileSync(join(folder, 'a.png'), PNG)
  writeFileSync(join(folder, 'Léto', 'b.png'), PNG)
  writeFileSync(join(folder, 'clip.mp4'), Buffer.alloc(1000, 7))
  writeFileSync(join(folder, 'readme.txt'), 'not media')
  mkdirSync(join(folder, '.hidden'))
  writeFileSync(join(folder, '.hidden', 'x.png'), PNG)
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

const toTrash = async (path: string): Promise<void> => renameSync(path, join(trash, `${Date.now()}-${Math.random()}`))

describe('LocalLibrary', () => {
  it('lists supported files in subfolders with sizes, skipping hidden folders', async () => {
    const library = new LocalLibrary(folder, { trash: toTrash })
    const items = await library.listMedia()
    expect(items.map((m) => m.id).sort()).toEqual(['Léto/b.png', 'a.png', 'clip.mp4'])
    expect(items.find((m) => m.id === 'a.png')).toMatchObject({ width: 3, height: 2, kind: 'image', size: PNG.length })
  })

  it('refuses paths outside the folder', () => {
    expect(resolveInside(folder, '../secret.png')).toBeNull()
    expect(resolveInside(folder, 'Léto/b.png')).toBe(join(folder, 'Léto', 'b.png'))
    expect(() => new LocalLibrary(folder, { trash: toTrash }).localPath('../../x')).toThrow()
  })

  it('serves byte ranges for video seeking', async () => {
    const library = new LocalLibrary(folder, { trash: toTrash })
    const whole = await library.open('clip.mp4', null)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-length')).toBe('1000')
    const part = await library.open('clip.mp4', 'bytes=10-19')
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 10-19/1000')
    expect((await part.arrayBuffer()).byteLength).toBe(10)
    expect((await library.open('clip.mp4', 'bytes=5000-')).status).toBe(416)
  })

  it('copies uploads in with a free name, renames and trashes', async () => {
    const library = new LocalLibrary(folder, { trash: toTrash })
    const outside = join(root, 'a.png')
    writeFileSync(outside, PNG)
    const item = await library.upload({ path: outside, name: 'a.png', size: PNG.length, mime: 'image/png', modified: Date.UTC(2020, 0, 1), read: async () => new Uint8Array() }, () => undefined, new AbortController().signal)
    expect(item.id).toBe('a (2).png')
    expect(new Date(item.modified).getUTCFullYear()).toBe(2020)
    await expect(library.rename('a (2).png', 'a.png')).rejects.toThrow('exists')
    const renamed = await library.rename('Léto/b.png', 'moře.png')
    expect(renamed.id).toBe('Léto/moře.png')
    await library.trash('a.png')
    expect(existsSync(join(folder, 'a.png'))).toBe(false)
  })
})

function hooks(overrides: Partial<Hooks> = {}, initial: Record<string, unknown> = {}) {
  const screens: Screen[] = []
  const messages: Message[] = []
  let settings: Settings = { ...defaultSettings(), ...initial } as Settings
  let data: LibraryData | null = null
  const result: Hooks = {
    ui: {
      screen: (s) => screens.push(s),
      library: () => undefined,
      data: (d) => (data = d),
      status: () => undefined,
      message: (m) => messages.push(m),
      transfers: () => undefined,
      settings: () => undefined,
      sources: () => undefined
    },
    loadSettings: () => settings,
    saveSettings: (s) => (settings = s),
    cacheRoot: join(root, 'cache'),
    defaultFolder: folder,
    auth: {
      hasClientSecret: async () => false,
      chooseClientSecret: async () => 'cancel',
      load: async () => null,
      login: async () => {
        throw new Error('no')
      },
      logout: async () => undefined
    },
    makeDrive: () => {
      throw new Error('not in tests')
    },
    makeLocal: (path, subfolders) => new LocalLibrary(path, { trash: toTrash }, subfolders),
    pickFiles: async () => [],
    pickFolder: async () => null,
    pickSaveFile: async () => null,
    pickOpenFile: async () => null,
    writeClipboard: () => undefined,
    openPath: async () => '',
    tempDir: join(root, 'tmp'),
    resizeImage: () => null,
    log: () => undefined,
    ...overrides
  }
  return { hooks: result, screens, messages, settings: () => settings, data: () => data }
}

const readData = (dir = folder) => JSON.parse(readFileSync(join(dir, 'okgram.json'), 'utf8'))
const draft = (path: string, patch: Partial<SourceDraft> = {}): SourceDraft => ({ name: '', icon: 'folder', color: null, path, subfolders: true, ...patch })

async function withSource(h = hooks()) {
  const controller = new Controller(h.hooks)
  await controller.start()
  const added = await controller.addLocalSource(draft(folder))
  if (!added.ok) throw new Error('source not added')
  return { controller, id: added.id, h }
}

describe('Controller with local sources', () => {
  it('starts with no source and adds a folder', async () => {
    const h = hooks()
    const controller = new Controller(h.hooks)
    await controller.start()
    expect(h.screens.at(-1)).toEqual({ name: 'library', session: 1 })
    expect(controller.getSources()).toEqual([])
    const added = await controller.addLocalSource(draft(folder, { name: 'Fotky', color: 'blue' }))
    expect(added.ok).toBe(true)
    const [source] = controller.getSources()
    expect(source).toMatchObject({ kind: 'local', name: 'Fotky', color: 'blue', path: folder, status: 'ready', count: 3 })
    expect(controller.getLibrary().media.every((m) => m.source === source.id && m.id.startsWith(`${source.id}:`))).toBe(true)
    expect(h.settings().sources).toHaveLength(1)
    await controller.shutdown()
  })

  it('refuses a folder twice and a folder it cannot use', async () => {
    const { controller } = await withSource()
    expect(await controller.addLocalSource(draft(folder))).toMatchObject({ ok: false, error: { key: 'source.duplicate_folder' } })
    const file = join(root, 'plain-file')
    writeFileSync(file, 'x')
    expect(await controller.addLocalSource(draft(join(file, 'sub')))).toMatchObject({ ok: false, error: { key: 'local.not_writable' } })
    expect(controller.getSources()).toHaveLength(1)
    await controller.shutdown()
  })

  it('saves stars, albums and the user name into okgram.json of the folder', async () => {
    const { controller, id } = await withSource()
    controller.mutate({ type: 'album.create', id: 'al', name: 'Moře', parent: null, items: [`${id}:a.png`] })
    controller.mutate({ type: 'meta', ids: [`${id}:clip.mp4`], patch: { star: true } })
    controller.mutate({ type: 'profile', username: 'OpiKula' })
    await controller.flush()
    const saved = readData()
    expect(saved.app).toBe('okgram')
    expect(saved.albums[0]).toMatchObject({ name: 'Moře', items: ['a.png'] })
    expect(saved.items['clip.mp4'].star).toBe(true)
    expect(saved.profile.username).toBe('OpiKula')
    expect(controller.getData().albums[0].items).toEqual([`${id}:a.png`])
    await controller.shutdown()
  })

  it('keeps an album with files from two sources, each in its own data file', async () => {
    const second = join(root, 'second')
    mkdirSync(second)
    writeFileSync(join(second, 'z.png'), PNG)
    const { controller, id } = await withSource()
    const other = await controller.addLocalSource(draft(second, { name: 'Druhá' }))
    if (!other.ok) throw new Error('second source')
    controller.mutate({ type: 'album.create', id: 'mix', name: 'Mix', parent: null, items: [`${id}:a.png`, `${other.id}:z.png`] })
    controller.mutate({ type: 'album.create', id: 'sub', name: 'Pod', parent: 'mix' })
    controller.mutate({ type: 'album.update', id: 'mix', patch: { cover: `${other.id}:z.png` } })
    await controller.flush()
    expect(readData().albums.find((a: { id: string }) => a.id === 'mix')).toMatchObject({ items: ['a.png'], cover: null })
    expect(readData(second).albums.find((a: { id: string }) => a.id === 'mix')).toMatchObject({ items: ['z.png'], cover: 'z.png' })
    expect(readData(second).albums.find((a: { id: string }) => a.id === 'sub')?.parent).toBe('mix')
    const album = controller.getData().albums.find((a) => a.id === 'mix')!
    expect(album.items.sort()).toEqual([`${id}:a.png`, `${other.id}:z.png`].sort())
    expect(album.cover).toBe(`${other.id}:z.png`)
    // Removing a source drops its files from the album, not the album.
    expect(await controller.removeSource(other.id)).toBe('done')
    expect(controller.getData().albums.find((a) => a.id === 'mix')?.items).toEqual([`${id}:a.png`])
    expect(existsSync(join(second, 'z.png'))).toBe(true)
    await controller.shutdown()
  })

  it('keeps preferences with the library and joins changes from another computer', async () => {
    const { controller } = await withSource()
    await controller.updateSettings({ theme: 'light', sync_minutes: 0 })
    await controller.flush()
    expect(readData().prefs.theme).toBe('light')
    const other = readData()
    other.albums.push({ id: 'remote', name: 'Odjinud', icon: 'globe', color: null, parent: null, cover: null, items: [], order: 5, created: Date.now(), modified: Date.now() })
    other.prefs = { ...other.prefs, theme: 'dark' }
    other.prefs_modified = Date.now() + 1000
    writeFileSync(join(folder, 'okgram.json'), JSON.stringify(other))
    controller.mutate({ type: 'album.create', id: 'here', name: 'Tady', parent: null })
    await controller.flush()
    expect(readData().albums.map((a: { name: string }) => a.name).sort()).toEqual(['Odjinud', 'Tady'])
    expect(controller.getSettings().theme).toBe('dark')
    await controller.shutdown()
  })

  it('renames and trashes files and keeps the albums right', async () => {
    const { controller, id } = await withSource()
    controller.mutate({ type: 'album.create', id: 'al', name: 'A', parent: null, items: [`${id}:Léto/b.png`] })
    expect(await controller.rename(`${id}:Léto/b.png`, 'a')).toBe('ok')
    expect(await controller.rename(`${id}:a.png`, 'clip')).toBe('ok')
    expect(await controller.rename(`${id}:clip.png`, 'bad/name')).toBe('invalid')
    expect(controller.getData().albums[0].items).toEqual([`${id}:Léto/a.png`])
    expect(await controller.trash([`${id}:Léto/a.png`])).toBe(1)
    expect(controller.getData().albums[0].items).toEqual([])
    await controller.shutdown()
  })

  it('uploads dropped folders into the chosen source and album', async () => {
    const h = hooks()
    const { controller, id } = await withSource(h)
    const drop = join(root, 'drop')
    mkdirSync(join(drop, 'inner'), { recursive: true })
    writeFileSync(join(drop, 'n1.png'), PNG)
    writeFileSync(join(drop, 'inner', 'n2.png'), PNG)
    writeFileSync(join(drop, 'skip.doc'), 'x')
    controller.mutate({ type: 'album.create', id: 'al', name: 'A', parent: null })
    await controller.upload(id, [drop], 'al')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await (controller as unknown as { work: Promise<void> }).work
    expect(controller.getData().albums[0].items.sort()).toEqual([`${id}:n1.png`, `${id}:n2.png`])
    expect(existsSync(join(folder, 'n2.png'))).toBe(true)
    expect(h.messages.some((m) => m.key === 'upload.done')).toBe(true)
    await controller.shutdown()
  })

  it('hides a source without forgetting it and can skip subfolders', async () => {
    const { controller, id } = await withSource()
    await controller.updateSource(id, { enabled: false })
    expect(controller.getSources()[0].enabled).toBe(false)
    await controller.updateSource(id, { subfolders: false })
    expect(controller.getLibrary().media.map((m) => m.id).sort()).toEqual([`${id}:a.png`, `${id}:clip.mp4`])
    await controller.shutdown()
  })

  it('takes over the single folder from older settings', async () => {
    const h = hooks({}, { storage: 'local', local_folder: folder })
    const controller = new Controller({ ...h.hooks, loadSettings: () => ({ storage: 'local', local_folder: folder }) as unknown as Settings })
    await controller.start()
    expect(controller.getSources()).toMatchObject([{ id: 'local0', kind: 'local', path: folder, status: 'ready' }])
    await controller.shutdown()
  })
})

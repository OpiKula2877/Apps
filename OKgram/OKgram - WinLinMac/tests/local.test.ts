// Local folder library and the controller working on it (no Electron needed).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/core/settings'
import type { Message, Screen, Settings } from '../src/shared/ipc'
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

function hooks(overrides: Partial<Hooks> = {}) {
  const screens: Screen[] = []
  const messages: Message[] = []
  let settings: Settings = defaultSettings()
  let data: LibraryData | null = null
  const result: Hooks = {
    ui: {
      screen: (s) => screens.push(s),
      library: () => undefined,
      data: (d) => (data = d),
      status: () => undefined,
      message: (m) => messages.push(m),
      transfers: () => undefined,
      settings: () => undefined
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
    makeLocal: (path) => new LocalLibrary(path, { trash: toTrash }),
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

const readData = () => JSON.parse(readFileSync(join(folder, 'okgram.json'), 'utf8'))

describe('Controller with a local folder', () => {
  it('opens the default folder, saves changes to okgram.json and remembers the choice', async () => {
    const h = hooks()
    const controller = new Controller(h.hooks)
    await controller.start()
    expect(h.screens.at(-1)).toMatchObject({ name: 'welcome', mode: null })
    await controller.openLocal(null)
    expect(h.screens.at(-1)).toMatchObject({ name: 'library', mode: 'local' })
    expect(controller.getLibrary().media).toHaveLength(3)
    expect(h.settings()).toMatchObject({ storage: 'local', local_folder: folder })

    controller.mutate({ type: 'album.create', id: 'al', name: 'Moře', parent: null, items: ['a.png'] })
    controller.mutate({ type: 'meta', ids: ['clip.mp4'], patch: { star: true } })
    controller.mutate({ type: 'profile', username: 'OpiKula' })
    await controller.save()
    const saved = readData()
    expect(saved.app).toBe('okgram')
    expect(saved.albums[0]).toMatchObject({ name: 'Moře', items: ['a.png'] })
    expect(saved.items['clip.mp4'].star).toBe(true)
    expect(saved.profile.username).toBe('OpiKula')
    await controller.shutdown()
  })

  it('keeps preferences in the library and joins changes from another computer', async () => {
    const h = hooks()
    const controller = new Controller(h.hooks)
    await controller.openLocal(folder)
    await controller.updateSettings({ theme: 'light', sync_minutes: 0 })
    await controller.save()
    expect(readData().prefs.theme).toBe('light')

    // another computer edits the same okgram.json meanwhile
    const other = readData()
    other.albums.push({ id: 'remote', name: 'Odjinud', icon: 'globe', color: null, parent: null, cover: null, items: [], order: 5, created: Date.now(), modified: Date.now() })
    other.prefs = { ...other.prefs, theme: 'dark' }
    other.prefs_modified = Date.now() + 1000
    writeFileSync(join(folder, 'okgram.json'), JSON.stringify(other))

    controller.mutate({ type: 'album.create', id: 'here', name: 'Tady', parent: null })
    await controller.save()
    const names = readData().albums.map((a: { name: string }) => a.name).sort()
    expect(names).toEqual(['Odjinud', 'Tady'])
    expect(controller.getSettings().theme).toBe('dark')
    await controller.shutdown()
  })

  it('renames a file and keeps it in its albums', async () => {
    const h = hooks()
    const controller = new Controller(h.hooks)
    await controller.openLocal(folder)
    controller.mutate({ type: 'album.create', id: 'al', name: 'A', parent: null, items: ['Léto/b.png'] })
    expect(await controller.rename('Léto/b.png', 'a')).toBe('ok')
    expect(await controller.rename('a.png', 'clip')).toBe('ok')
    expect(await controller.rename('clip.png', 'bad/name')).toBe('invalid')
    expect(controller.getData().albums[0].items).toEqual(['Léto/a.png'])
    expect(await controller.trash(['Léto/a.png'])).toBe(1)
    expect(controller.getData().albums[0].items).toEqual([])
    await controller.shutdown()
  })

  it('uploads dropped folders and adds the files to an album', async () => {
    const h = hooks()
    const controller = new Controller(h.hooks)
    await controller.openLocal(folder)
    const drop = join(root, 'drop')
    mkdirSync(join(drop, 'inner'), { recursive: true })
    writeFileSync(join(drop, 'n1.png'), PNG)
    writeFileSync(join(drop, 'inner', 'n2.png'), PNG)
    writeFileSync(join(drop, 'skip.doc'), 'x')
    controller.mutate({ type: 'album.create', id: 'al', name: 'A', parent: null })
    await controller.upload([drop], 'al')
    await new Promise((resolve) => setTimeout(resolve, 300))
    await (controller as unknown as { work: Promise<void> }).work
    expect(controller.getData().albums[0].items.sort()).toEqual(['n1.png', 'n2.png'])
    expect(existsSync(join(folder, 'n2.png'))).toBe(true)
    expect(h.messages.some((m) => m.key === 'upload.done')).toBe(true)
    await controller.shutdown()
  })

  it('closes the library and starts on the storage choice next time', async () => {
    const h = hooks()
    const controller = new Controller(h.hooks)
    await controller.openLocal(folder)
    expect(await controller.leave()).toBe('done')
    expect(h.screens.at(-1)).toMatchObject({ name: 'welcome', mode: null })
    expect(h.settings().storage).toBeNull()
  })

  it('reports a folder it cannot use', async () => {
    const file = join(root, 'plain-file')
    writeFileSync(file, 'x')
    const h = hooks()
    const controller = new Controller(h.hooks)
    await controller.openLocal(join(file, 'sub'))
    expect(h.screens.at(-1)).toMatchObject({ name: 'welcome', mode: 'local', connectError: true })
  })
})

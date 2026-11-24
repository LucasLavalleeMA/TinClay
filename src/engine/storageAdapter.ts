import { open, save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import type { Workspace } from '../types/workspace'
import { validatePlotSettings } from './plots'

export const isTauri = () => '__TAURI_INTERNALS__' in window

export interface DocumentFile {
  workspace: Workspace
  path?: string
  name: string
  modified: number
}

interface NativeFile { content: string; path: string; modified: number }
interface BrowserHandle {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{ write(content: string): Promise<void>; close(): Promise<void> }>
  isSameEntry(other: BrowserHandle): Promise<boolean>
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}
interface PickerWindow extends Window {
  showOpenFilePicker?: (options: object) => Promise<BrowserHandle[]>
  showSaveFilePicker?: (options: object) => Promise<BrowserHandle>
}

const browserPrefix = 'browser:'
const pickerTypes = [{ description: 'TinClay workspace', accept: { 'application/json': ['.clay', '.json'] } }]
const fileName = (path: string) => path.split(/[\\/]/).pop() || path
const cancelled = (error: unknown) => error instanceof DOMException && error.name === 'AbortError'

async function handleDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tinclay-files', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('handles')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function browserHandle(path: string, handle?: BrowserHandle): Promise<BrowserHandle | undefined> {
  const db = await handleDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', handle ? 'readwrite' : 'readonly')
      const store = tx.objectStore('handles')
      const request = handle ? store.put(handle, path) : store.get(path)
      request.onerror = () => reject(request.error)
      tx.onabort = () => reject(tx.error)
      tx.oncomplete = () => resolve(handle ?? request.result as BrowserHandle | undefined)
    })
  } finally { db.close() }
}

async function browserHandlePath(handle: BrowserHandle): Promise<string> {
  const db = await handleDatabase()
  let entries: Array<{ path: string; handle: BrowserHandle }>
  try {
    entries = await new Promise((resolve, reject) => {
      const request = db.transaction('handles').objectStore('handles').openCursor()
      const found: Array<{ path: string; handle: BrowserHandle }> = []
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return resolve(found)
        if (typeof cursor.key === 'string') found.push({ path: cursor.key, handle: cursor.value as BrowserHandle })
        cursor.continue()
      }
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
  for (const entry of entries) if (await entry.handle.isSameEntry(handle)) return entry.path
  return `${browserPrefix}${crypto.randomUUID()}`
}

export async function forgetRecentWorkspace(path: string): Promise<void> {
  if (isTauri() || !path.startsWith(browserPrefix)) return
  const db = await handleDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('handles', 'readwrite')
      transaction.objectStore('handles').delete(path)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally { db.close() }
}

async function nativeRead(path: string): Promise<DocumentFile | undefined> {
  const file = await invoke<NativeFile | null>('read_workspace_file', { path })
  return file ? { workspace: parseWorkspace(file.content), path: file.path, name: fileName(file.path), modified: file.modified } : undefined
}

export async function startupWorkspace(): Promise<DocumentFile | undefined> {
  if (!isTauri()) return undefined
  const path = await invoke<string | null>('startup_workspace_path')
  if (!path) return undefined
  const file = await nativeRead(path)
  if (!file) throw new Error(`The startup file could not be found: ${path}`)
  return file
}

export async function openRecentWorkspace(path: string): Promise<DocumentFile | undefined> {
  if (isTauri()) return nativeRead(path)
  const handle = await browserHandle(path)
  if (!handle) return undefined
  if (await handle.queryPermission({ mode: 'read' }) !== 'granted' &&
      await handle.requestPermission({ mode: 'read' }) !== 'granted') throw new Error('Permission to open this file was not granted.')
  try {
    const file = await handle.getFile()
    return { workspace: parseWorkspace(await file.text()), path, name: file.name, modified: file.lastModified }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return undefined
    throw error
  }
}

export async function revealWorkspace(path: string): Promise<void> {
  if (!isTauri()) throw new Error('Opening a file location is not available in a browser.')
  await invoke('reveal_workspace_file', { path })
}

export async function recentModified(path: string): Promise<number | null> {
  return invoke<number | null>('workspace_modified', { path })
}

function validateWorkspace(value: unknown): Workspace {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('blocks' in value) ||
    typeof value.blocks !== 'object' ||
    value.blocks === null
  ) {
    throw new Error('This file is not a valid TinClay workspace.')
  }
  const workspace = value as Workspace
  if (workspace.cellFormats !== undefined) {
    if (typeof workspace.cellFormats !== 'object' || workspace.cellFormats === null || Array.isArray(workspace.cellFormats)) throw new Error('Workspace contains invalid cell formatting.')
    for (const [key, format] of Object.entries(workspace.cellFormats)) {
      if (!/^\d+,\d+$/.test(key) || !format || typeof format !== 'object' || Array.isArray(format) ||
          format.alignment !== undefined && !['left', 'center', 'right'].includes(format.alignment) ||
          [format.textColor, format.fillColor, format.borderColor].some((color) => color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) ||
          format.fontSize !== undefined && (!Number.isInteger(format.fontSize) || format.fontSize < 8 || format.fontSize > 36) ||
          [format.bold, format.italic, format.underline].some((value) => value !== undefined && typeof value !== 'boolean') ||
          format.borderStyle !== undefined && !['solid', 'dashed', 'dotted', 'double'].includes(format.borderStyle) ||
          format.borders !== undefined && (!format.borders || typeof format.borders !== 'object' ||
            ['top', 'right', 'bottom', 'left'].some((side) => typeof format.borders?.[side as keyof typeof format.borders] !== 'boolean'))) {
        throw new Error('Workspace contains invalid cell formatting.')
      }
    }
  }
  if (workspace.columnWidths !== undefined) {
    if (typeof workspace.columnWidths !== 'object' || workspace.columnWidths === null || Array.isArray(workspace.columnWidths) ||
        Object.entries(workspace.columnWidths).some(([key, width]) => !/^\d+$/.test(key) || !Number.isFinite(width) || width < 40 || width > 1000)) {
      throw new Error('Workspace contains invalid column widths.')
    }
  }
  for (const block of Object.values(workspace.blocks)) {
    if (block?.format?.alignment !== undefined && !['left', 'center', 'right'].includes(block.format.alignment)) {
      throw new Error('Workspace contains invalid variable alignment.')
    }
    if (block?.emptyCells !== undefined) {
      if (block.mode !== 'root' || !Array.isArray(block.data) || !Array.isArray(block.emptyCells) ||
          block.emptyCells.some((cell) => !Array.isArray(cell) || cell.length !== 2 ||
            !Number.isSafeInteger(cell[0]) || !Number.isSafeInteger(cell[1]) ||
            cell[0] < 0 || cell[1] < 0 || !Array.isArray(block.data[cell[0]]) || cell[1] >= block.data[cell[0]].length) ||
          new Set(block.emptyCells.map(([row, col]) => `${row},${col}`)).size !== block.emptyCells.length) {
        throw new Error('Workspace contains invalid empty cells.')
      }
    }
  }
  if (workspace.plots !== undefined) {
    if (!Array.isArray(workspace.plots)) throw new Error('Workspace plots must be an array.')
    const ids = new Set<string>()
    for (const plot of workspace.plots) {
      if (
        !plot || typeof plot.id !== 'string' || !plot.id || ids.has(plot.id) ||
        typeof plot.title !== 'string' || typeof plot.xSymbol !== 'string' || typeof plot.ySymbol !== 'string' ||
        !plot.anchor || !Number.isSafeInteger(plot.anchor.row) || plot.anchor.row < 0 ||
        !Number.isSafeInteger(plot.anchor.col) || plot.anchor.col < 0 ||
        !plot.span || !Number.isSafeInteger(plot.span.rows) || plot.span.rows < 1 ||
        !Number.isSafeInteger(plot.span.cols) || plot.span.cols < 1
      ) throw new Error('Workspace contains an invalid plot.')
      if (plot.settings !== undefined && !validatePlotSettings(plot.settings)) throw new Error('Workspace contains invalid plot settings.')
      if (plot.series !== undefined && (!Array.isArray(plot.series) || plot.series.some((entry) =>
        !entry || typeof entry.id !== 'string' || !entry.id || typeof entry.ySymbol !== 'string' ||
        typeof entry.label !== 'string' || typeof entry.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(entry.color)) ||
        new Set(plot.series.map((entry) => entry.id)).size !== plot.series.length)) throw new Error('Workspace contains invalid plot series.')
      ids.add(plot.id)
    }
  }
  return { ...workspace, plots: workspace.plots ?? [], cellFormats: workspace.cellFormats ?? {}, columnWidths: workspace.columnWidths ?? {} }
}

export function parseWorkspace(content: string): Workspace {
  try {
    return validateWorkspace(JSON.parse(content) as unknown)
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Workspace file contains invalid JSON.')
    throw error
  }
}

export async function saveWorkspace(workspace: Workspace, currentPath?: string, defaultName = 'Untitled.clay', saveAs = false): Promise<Omit<DocumentFile, 'workspace'> | undefined> {
  const content = JSON.stringify(workspace, null, 2)
  if (isTauri()) {
    const path = (!saveAs && currentPath) || await save({
      defaultPath: currentPath ?? defaultName,
      filters: [{ name: 'TinClay workspace', extensions: ['clay'] }],
    })
    if (!path) return undefined
    const modified = await invoke<number>('write_workspace_file', { path, content })
    return { path, name: fileName(path), modified }
  }

  const picker = window as PickerWindow
  const existingPath = saveAs ? undefined : currentPath
  if (picker.showSaveFilePicker || existingPath?.startsWith(browserPrefix)) {
    try {
      const handle = existingPath ? await browserHandle(existingPath) : await picker.showSaveFilePicker?.({ suggestedName: defaultName, types: pickerTypes })
      if (!handle) throw new Error('The saved file is no longer available. Choose a new location.')
      if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
          await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Permission to save this file was not granted.')
      const writable = await handle.createWritable()
      await writable.write(content)
      await writable.close()
      const path = existingPath ?? await browserHandlePath(handle)
      await browserHandle(path, handle)
      const file = await handle.getFile()
      return { path, name: file.name, modified: file.lastModified }
    } catch (error) {
      if (cancelled(error)) return undefined
      throw error
    }
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = defaultName
  link.click()
  URL.revokeObjectURL(url)
  return { name: defaultName, modified: Date.now() }
}

export async function loadWorkspace(): Promise<DocumentFile | undefined> {
  if (isTauri()) {
    const path = await open({
      multiple: false,
      filters: [{ name: 'TinClay workspace', extensions: ['clay', 'json'] }],
    })
    if (typeof path !== 'string') return undefined
    const file = await nativeRead(path)
    if (!file) throw new Error(`The selected file could not be found: ${path}`)
    return file
  }
  const picker = window as PickerWindow
  if (picker.showOpenFilePicker) {
    try {
      const [handle] = await picker.showOpenFilePicker({ multiple: false, types: pickerTypes })
      const file = await handle.getFile()
      const workspace = parseWorkspace(await file.text())
      const path = await browserHandlePath(handle)
      await browserHandle(path, handle)
      return { workspace, path, name: file.name, modified: file.lastModified }
    } catch (error) {
      if (cancelled(error)) return undefined
      throw error
    }
  }
  const file = await new Promise<File | undefined>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.clay,.json,application/json'
      input.onchange = () => resolve(input.files?.[0])
      input.oncancel = () => resolve(undefined)
      input.click()
    })
  return file ? { workspace: parseWorkspace(await file.text()), name: file.name, modified: file.lastModified } : undefined
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { newBlankWorkspace } from './templates'
import { saveWorkspace } from './storageAdapter'

const mocks = vi.hoisted(() => ({ save: vi.fn(), invoke: vi.fn() }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: mocks.save }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

describe('saving workspaces', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

  it('saves to the existing file, but Save As prompts and uses the selected path', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    mocks.save.mockResolvedValue('C:\\work\\copy.clay')
    mocks.invoke.mockResolvedValue(100)
    const workspace = newBlankWorkspace()
    const original = 'C:\\work\\original.clay'
    expect((await saveWorkspace(workspace, original))?.path).toBe(original)
    expect(mocks.save).not.toHaveBeenCalled()
    expect((await saveWorkspace(workspace, original, 'original.clay', true))?.path).toBe('C:\\work\\copy.clay')
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: original }))
    expect(mocks.invoke).toHaveBeenLastCalledWith('write_workspace_file', expect.objectContaining({ path: 'C:\\work\\copy.clay' }))
  })

  it('does not write or replace the current file when Save As is cancelled', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} })
    mocks.save.mockResolvedValue(null)
    expect(await saveWorkspace(newBlankWorkspace(), 'C:\\work\\original.clay', 'original.clay', true)).toBeUndefined()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

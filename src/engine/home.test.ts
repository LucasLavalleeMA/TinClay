import { afterEach, describe, expect, it, vi } from 'vitest'
import { recalculateWorkspace } from './dag'
import { readRecentFiles, rememberFile, relativeTime, type RecentFile } from './recentFiles'
import { instantiateTemplate, newBlankWorkspace, templates } from './templates'

describe('Home documents', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('creates independent template copies with working kinetic-energy formulas', () => {
    const first = instantiateTemplate(templates[0])
    const second = instantiateTemplate(templates[0])
    expect(first.blocks.KE.id).not.toBe(second.blocks.KE.id)
    expect(first.plots[0].id).not.toBe(second.plots[0].id)
    first.blocks.m.data[0][0] = 4
    const recalculated = recalculateWorkspace(first.blocks)
    expect(recalculated.KE.data.map((row) => row[0])).toEqual([200, 800, 1800, 3200, 5000])
    expect(second.blocks.m.data[0][0]).toBe(3)
    expect(newBlankWorkspace()).toEqual({ blocks: {}, plots: [], activeFormulaSymbol: '', cellFormats: {}, columnWidths: {} })
  })

  it('deduplicates history, keeps pins, and caps the list without evicting pins first', () => {
    const files: RecentFile[] = Array.from({ length: 30 }, (_, index) => ({
      path: `file${index}`, name: `File ${index}`, accessed: index, modified: index, pinned: index === 29,
    }))
    const updated = rememberFile(files, { path: 'file0', name: 'Updated', accessed: 40, modified: 39 })
    expect(updated).toHaveLength(30)
    expect(updated.filter((file) => file.path === 'file0')).toHaveLength(1)
    expect(updated[0].path).toBe('file29')
    const added = rememberFile(updated, { path: 'new', name: 'New', accessed: 41, modified: 41 })
    expect(added).toHaveLength(30)
    expect(added[0].path).toBe('file29')
    expect(added.some((file) => file.path === 'new')).toBe(true)
    expect(rememberFile(added, { path: 'file29', name: 'Pinned', accessed: 42, modified: 42 })[0].pinned).toBe(true)
  })

  it('formats recent modification times', () => {
    const now = 2_000_000_000_000
    expect(relativeTime(now, now)).toBe('Just now')
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2 hours ago')
    expect(relativeTime(now - 86_400_000, now)).toBe('Yesterday')
  })

  it('surfaces corrupt persisted history instead of silently treating it as empty', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify([{ path: 'example.clay' }]) })
    expect(() => readRecentFiles()).toThrow('Recent file history is invalid')
  })
})

import { open, save } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import type { Workspace } from '../types/workspace'
import { validatePlotSettings } from './plots'

const isTauri = () => '__TAURI_INTERNALS__' in window

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

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const content = JSON.stringify(workspace, null, 2)
  if (isTauri()) {
    const path = await save({
      defaultPath: 'tinclay_workspace.clay',
      filters: [{ name: 'TinClay workspace', extensions: ['clay'] }],
    })
    if (path) await writeTextFile(path, content)
    return
  }

  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'tinclay_workspace.clay'
  link.click()
  URL.revokeObjectURL(url)
}

export async function loadWorkspace(): Promise<Workspace | undefined> {
  let content: string
  if (isTauri()) {
    const path = await open({
      multiple: false,
      filters: [{ name: 'TinClay workspace', extensions: ['clay', 'json'] }],
    })
    if (typeof path !== 'string') return undefined
    content = await readTextFile(path)
  } else {
    content = await new Promise<string>((resolve, reject) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.clay,.json,application/json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return resolve('')
        try {
          resolve(await file.text())
        } catch (error) {
          reject(error)
        }
      }
      input.click()
    })
    if (!content) return undefined
  }
  return parseWorkspace(content)
}

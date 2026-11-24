import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { temporal } from 'zundo'
import type { CellFormat, GridRange, PlotBlock, VariableBlock, Workspace } from '../types/workspace'
import { recalculateWorkspace } from '../engine/dag'
import { isValidSymbol, renameFormulaSymbol } from '../engine/evaluator'
import { inferShape } from '../engine/shapes'
import { assertVacant, blockCells, spatialIndex, type CellAddress } from '../engine/spatial'
import { isEmptyValue } from '../engine/missingValues'
import { formatSelection, moveCellFormats } from '../engine/formatting'
import { DEFAULT_COLUMN_WIDTH } from '../engine/geometry'
import { createDefaultWorkspace } from '../engine/workspace'

interface WorkspaceState extends Workspace {
  setFormula: (symbol: string, formula: string) => void
  editValue: (symbol: string, row: number, col: number, value: number) => void
  editValues: (symbol: string, row: number, col: number, values: number[][]) => void
  resizeBlock: (symbol: string, rows: number, cols: number) => void
  removeVectorEnd: (symbol: string) => void
  clearSelection: (cells: CellAddress[], ranges?: GridRange[]) => void
  updateFormat: (symbol: string, patch: Partial<VariableBlock['format']>) => void
  addBlocks: (blocks: VariableBlock[]) => void
  moveBlock: (symbol: string, anchor: VariableBlock['anchor']) => void
  moveBlocks: (symbols: string[], rowDelta: number, colDelta: number) => void
  formatCells: (ranges: GridRange[], patch: Partial<CellFormat>, border?: 'all' | 'outer' | 'none', clear?: boolean) => void
  setColumnWidth: (col: number, width: number) => void
  renameBlock: (symbol: string, name: string, newSymbol: string, unit: string) => void
  addPlot: (plot: PlotBlock) => void
  updatePlot: (id: string, patch: Partial<Omit<PlotBlock, 'id'>>) => void
  removePlot: (id: string) => void
  replaceWorkspace: (workspace: Workspace) => void
}

function recalculateWithGrowth(
  blocks: Record<string, VariableBlock>,
  oldSizes: Record<string, { rows: number; cols: number }>,
  formats?: Record<string, CellFormat>,
): Record<string, VariableBlock> {
  const updated = recalculateWorkspace(blocks)
  const original = Object.fromEntries(Object.values(updated).map((block) => [block.symbol, { ...block, anchor: { ...block.anchor } }]))
  for (const axis of ['col', 'row'] as const) {
    const growing = Object.values(updated).filter((block) => {
      const old = oldSizes[block.symbol]
      return old && (axis === 'row' ? block.data.length > old.rows : (block.data[0]?.length ?? 0) > old.cols)
    }).sort((a, b) => a.anchor[axis] - b.anchor[axis])

    for (const block of growing) {
      const old = oldSizes[block.symbol]
      const added = blockCells(block, true).filter((cell) =>
        cell.address.role === 'value' && (axis === 'row'
          ? cell.address.row >= old.rows && cell.address.col < old.cols
          : cell.address.col >= old.cols) ||
        axis === 'row' && cell.address.role === 'ghost',
      )
      const queue: Array<{ symbol: string; cells?: ReturnType<typeof blockCells> }> = [{ symbol: block.symbol, cells: added }]
      while (queue.length) {
        const current = queue.shift()!
        const currentCells = current.cells ?? blockCells(updated[current.symbol])
        for (const other of Object.values(updated)) {
          if (other.symbol === current.symbol || other.symbol === block.symbol) continue
          const overlaps = (cells: ReturnType<typeof blockCells>) => cells.some((a) =>
            blockCells(other).some((b) => a.row === b.row && a.col === b.col),
          )
          if (!overlaps(currentCells)) continue
          do {
            other.anchor = { ...other.anchor, [axis]: other.anchor[axis] + 1 }
          } while (overlaps(currentCells) || current.symbol !== block.symbol && overlaps(blockCells(block)))
          queue.push({ symbol: other.symbol })
        }
      }
    }
  }
  if (formats) {
    const moves = Object.values(updated).flatMap((block) => {
      const old = original[block.symbol]
      const rowDelta = block.anchor.row - old.anchor.row
      const colDelta = block.anchor.col - old.anchor.col
      return rowDelta || colDelta ? [{ block: old, rowDelta, colDelta }] : []
    })
    moveCellFormats(formats, moves)
  }
  return updated
}

function sizes(blocks: Record<string, VariableBlock>): Record<string, { rows: number; cols: number }> {
  return Object.fromEntries(Object.values(blocks).map((block) => [block.symbol, {
    rows: block.data.length, cols: block.data[0]?.length ?? 0,
  }]))
}

function sequenceStep(values: number[], present: boolean[]): number | undefined {
  if (values.length < 2 || present.some((value) => !value)) return undefined
  const step = values[1] - values[0]
  if (!Number.isFinite(step)) return undefined
  return values.every((value, index) => {
    if (index === 0) return true
    const difference = value - values[index - 1]
    if (Number.isSafeInteger(value) && Number.isSafeInteger(values[index - 1]) && Number.isSafeInteger(step)) return difference === step
    return Math.abs(difference - step) <= Number.EPSILON * 8 * Math.max(Number.MIN_VALUE, Math.abs(value), Math.abs(values[index - 1]), Math.abs(step))
  }) ? step : undefined
}

function resizeData(block: VariableBlock, rows: number, cols: number): number[][] {
  const missing = new Set(block.emptyCells?.map(([row, col]) => `${row},${col}`))
  const data = block.data.slice(0, rows).map((row) => row.slice(0, cols))
  const present = data.map((row, r) => row.map((_, c) => !block.unfilled && !missing.has(`${r},${c}`)))
  const extend = (values: number[], available: boolean[], length: number) => {
    const step = sequenceStep(values, available)
    const last = values[values.length - 1]
    const originalLength = values.length
    while (values.length < length) {
      const value = step === undefined ? 0 : last + step * (values.length - originalLength + 1)
      if (!Number.isFinite(value)) throw new Error('Expanding the sequence would produce a non-finite value.')
      values.push(value)
      available.push(step !== undefined)
    }
  }
  data.forEach((row, r) => extend(row, present[r], cols))
  const columns = Array.from({ length: cols }, (_, c) => data.map((row) => row[c]))
  const availableColumns = Array.from({ length: cols }, (_, c) => present.map((row) => row[c]))
  columns.forEach((column, c) => extend(column, availableColumns[c], rows))
  return Array.from({ length: rows }, (_, r) => columns.map((column) => column[r]))
}

function writeValues(blocks: Record<string, VariableBlock>, symbol: string, row: number, col: number, values: number[][], formats?: Record<string, CellFormat>): Record<string, VariableBlock> {
  const block = blocks[symbol]
  if (!block) throw new Error('Variable not found.')
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col) || row < 0 || col < 0 ||
      !values.length || !values[0].length || values.some((items) => items.length !== values[0].length || items.some((value) => !Number.isFinite(value)))) {
    throw new Error('Enter a rectangular selection of finite numbers.')
  }
  const before = sizes(blocks)
  const wasColumnVector = block.shape.type === 'vector' && block.shape.orientation === 'col'
  if (block.unfilled) {
    block.emptyCells = block.data.flatMap((items, r) => items.map((_, c): [number, number] => [r, c]))
  }
  block.mode = 'root'
  block.formula = ''
  delete block.unfilled
  const width = Math.max(block.data[0]?.length ?? 0, col + values[0].length)
  while (block.data.length < row + values.length) block.data.push(Array.from({ length: width }, () => 0))
  for (const items of block.data) while (items.length < width) items.push(0)
  values.forEach((items, r) => items.forEach((value, c) => { block.data[row + r][col + c] = value }))
  block.emptyCells = block.emptyCells?.filter(([r, c]) =>
    r < row || r >= row + values.length || c < col || c >= col + values[0].length)
  if (!block.emptyCells?.length) delete block.emptyCells
  block.shape = wasColumnVector && block.data.length === 1 && width === 1
    ? { type: 'vector', length: 1, orientation: 'col' }
    : inferShape(block.data)
  return recalculateWithGrowth(blocks, before, formats)
}

function moveSelectedBlocks(state: Workspace, symbols: string[], rowDelta: number, colDelta: number): void {
  if (!Number.isSafeInteger(rowDelta) || !Number.isSafeInteger(colDelta)) throw new Error('Invalid movement.')
  const selected = [...new Set(symbols)].map((symbol) => {
    const block = state.blocks[symbol]
    if (!block) throw new Error(`Variable ${symbol} not found.`)
    return block
  })
  if (!selected.length || !rowDelta && !colDelta) return
  const selectedSymbols = new Set(selected.map((block) => block.symbol))
  const others = Object.fromEntries(Object.entries(state.blocks).filter(([symbol]) => !selectedSymbols.has(symbol)))
  for (const block of selected) {
    assertVacant({ ...block, anchor: { row: block.anchor.row + rowDelta, col: block.anchor.col + colDelta } }, others)
  }
  if (state.cellFormats) moveCellFormats(state.cellFormats, selected.map((block) => ({ block, rowDelta, colDelta })))
  for (const block of selected) block.anchor = { row: block.anchor.row + rowDelta, col: block.anchor.col + colDelta }
}

export const useWorkspaceStore = create<WorkspaceState>()(
  temporal(
    immer((set) => ({
      ...createDefaultWorkspace(),
      setFormula: (symbol, formula) =>
        set((state) => {
          const block = state.blocks[symbol]
          if (!block) throw new Error('Variable not found.')
          if (!formula.trim()) throw new Error('Formula cannot be empty.')
          const before = sizes(state.blocks)
          block.mode = 'derived'
          delete block.unfilled
          delete block.emptyCells
          block.formula = formula.trim()
          state.blocks = recalculateWithGrowth(state.blocks, before, state.cellFormats)
        }),
      editValue: (symbol, row, col, value) =>
        set((state) => { state.blocks = writeValues(state.blocks, symbol, row, col, [[value]], state.cellFormats) }),
      editValues: (symbol, row, col, values) =>
        set((state) => { state.blocks = writeValues(state.blocks, symbol, row, col, values, state.cellFormats) }),
      resizeBlock: (symbol, rows, cols) =>
        set((state) => {
          const block = state.blocks[symbol]
          if (!block) throw new Error('Variable not found.')
          if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(cols) || rows < 1 || cols < 1) throw new Error('Variable dimensions must be positive integers.')
          if (block.data.length === rows && block.data[0]?.length === cols) return
          const before = sizes(state.blocks)
          const wasColumnVector = block.shape.type === 'vector' && block.shape.orientation === 'col'
          const data = resizeData(block, rows, cols)
          block.mode = 'root'
          block.formula = ''
          block.data = data
          block.emptyCells = block.emptyCells?.filter(([r, c]) => r < rows && c < cols)
          if (!block.emptyCells?.length) delete block.emptyCells
          block.shape = wasColumnVector && rows === 1 && cols === 1
            ? { type: 'vector', length: 1, orientation: 'col' }
            : inferShape(block.data)
          state.blocks = recalculateWithGrowth(state.blocks, before, state.cellFormats)
        }),
      removeVectorEnd: (symbol) =>
        set((state) => {
          const block = state.blocks[symbol]
          if (!block || block.mode !== 'root' || block.shape.type !== 'vector' || block.data.length <= 1) return
          block.data.pop()
          block.emptyCells = block.emptyCells?.filter(([row]) => row < block.data.length)
          if (!block.emptyCells?.length) delete block.emptyCells
          block.shape = { ...block.shape, length: block.data.length }
          state.blocks = recalculateWorkspace(state.blocks)
        }),
      clearSelection: (cells, ranges = []) =>
        set((state) => {
          const removed = new Set(cells.filter((cell) => cell.role === 'label').map((cell) => cell.symbol))
          const selectedCells = new Set(cells.map((cell) => `${cell.symbol}:${cell.role}:${cell.row}:${cell.col}`))
          const clearedKeys = new Set<string>()
          const touched = new Set(cells.map((cell) => cell.symbol))
          for (const [key, address] of spatialIndex(state.blocks)) {
            const [col, row] = key.split(',').map(Number)
            const inRange = ranges.some((range) => col >= range.x && col < range.x + range.width && row >= range.y && row < range.y + range.height)
            if (inRange) touched.add(address.symbol)
            if (removed.has(address.symbol) && address.role !== 'ghost' || selectedCells.has(`${address.symbol}:${address.role}:${address.row}:${address.col}`)) clearedKeys.add(key)
          }
          for (const [key] of Object.entries(state.cellFormats ?? {})) {
            const [col, row] = key.split(',').map(Number)
            if (clearedKeys.has(key) || ranges.some((range) => col >= range.x && col < range.x + range.width && row >= range.y && row < range.y + range.height)) delete state.cellFormats![key]
          }
          for (const symbol of touched) {
            const block = state.blocks[symbol]
            if (block) delete block.format.alignment
          }
          let changed = false
          for (const symbol of removed) {
            if (!state.blocks[symbol]) continue
            delete state.blocks[symbol]
            state.plots.forEach((plot) => {
              if (plot.xSymbol === symbol) plot.xSymbol = ''
              if (plot.ySymbol === symbol) plot.ySymbol = ''
              plot.series?.forEach((entry) => { if (entry.ySymbol === symbol) entry.ySymbol = '' })
            })
            if (state.activeFormulaSymbol === symbol) state.activeFormulaSymbol = ''
            changed = true
          }
          for (const cell of cells) {
            const block = state.blocks[cell.symbol]
            if (cell.role !== 'value' || !block || isEmptyValue(block, cell.row, cell.col) ||
                !block.data[cell.row] || cell.col < 0 || cell.col >= block.data[cell.row].length) continue
            block.mode = 'root'
            block.formula = ''
            block.data[cell.row][cell.col] = 0
            block.emptyCells = [...(block.emptyCells ?? []), [cell.row, cell.col]]
            if (block.emptyCells.length === block.data.length * block.data[0].length) {
              block.unfilled = true
              delete block.emptyCells
            }
            changed = true
          }
          if (changed) state.blocks = recalculateWorkspace(state.blocks)
        }),
      updateFormat: (symbol, patch) =>
        set((state) => {
          const block = state.blocks[symbol]
          if (block) Object.assign(block.format, patch)
        }),
      addBlocks: (blocks) =>
        set((state) => {
          for (const block of blocks) {
            if (!isValidSymbol(block.symbol)) throw new Error(`Invalid or reserved symbol: ${block.symbol}`)
            if (state.blocks[block.symbol]) throw new Error(`The symbol "${block.symbol}" is already in use.`)
            assertVacant(block, state.blocks)
            state.blocks[block.symbol] = block
          }
          state.blocks = recalculateWorkspace(state.blocks)
          for (const block of blocks) {
            assertVacant(state.blocks[block.symbol], state.blocks, block.symbol)
          }
        }),
      moveBlock: (symbol, anchor) =>
        set((state) => {
          const block = state.blocks[symbol]
          if (!block) throw new Error('Variable not found.')
          moveSelectedBlocks(state, [symbol], anchor.row - block.anchor.row, anchor.col - block.anchor.col)
        }),
      moveBlocks: (symbols, rowDelta, colDelta) =>
        set((state) => { moveSelectedBlocks(state, symbols, rowDelta, colDelta) }),
      formatCells: (ranges, patch, border, clear) =>
        set((state) => {
          if (ranges.some((range) => !Number.isSafeInteger(range.x) || !Number.isSafeInteger(range.y) ||
              !Number.isSafeInteger(range.width) || !Number.isSafeInteger(range.height) ||
              range.x < 0 || range.y < 0 || range.width < 1 || range.height < 1) ||
              ranges.reduce((sum, range) => sum + range.width * range.height, 0) > 250000) {
            throw new Error('Select at most 250,000 cells to format at once.')
          }
          if (!ranges.length) return
          if (!state.cellFormats) state.cellFormats = {}
          formatSelection(state.cellFormats, ranges, patch, border, clear)
          if (patch.alignment || clear) {
            const index = spatialIndex(state.blocks)
            const symbols = new Set<string>()
            for (const [key, address] of index) {
              const [col, row] = key.split(',').map(Number)
              if (ranges.some((range) => col >= range.x && col < range.x + range.width && row >= range.y && row < range.y + range.height)) symbols.add(address.symbol)
            }
            for (const symbol of symbols) {
              const block = state.blocks[symbol]
              if (clear) delete block.format.alignment
              else block.format.alignment = patch.alignment
              if (!clear) {
                for (const cell of blockCells(block, true)) {
                  const key = `${cell.col},${cell.row}`
                  const format = state.cellFormats[key]
                  if (index.get(key)?.symbol !== symbol || !format?.alignment) continue
                  delete format.alignment
                  if (!Object.keys(format).length) delete state.cellFormats[key]
                }
              }
            }
          }
        }),
      setColumnWidth: (col, width) =>
        set((state) => {
          if (!Number.isSafeInteger(col) || col < 0 || !Number.isFinite(width) || width < 40 || width > 1000) throw new Error('Column width must be between 40 and 1000 pixels.')
          if ((state.columnWidths?.[col] ?? DEFAULT_COLUMN_WIDTH) === width) return
          if (!state.columnWidths) state.columnWidths = {}
          if (width === DEFAULT_COLUMN_WIDTH) delete state.columnWidths[col]
          else state.columnWidths[col] = width
        }),
      renameBlock: (symbol, name, newSymbol, unit) =>
        set((state) => {
          const block = state.blocks[symbol]
          if (!block) throw new Error('Variable not found.')
          if (!name.trim() || !isValidSymbol(newSymbol)) throw new Error('Enter a name and a valid, non-reserved symbol.')
          if (symbol !== newSymbol && state.blocks[newSymbol]) throw new Error(`The symbol "${newSymbol}" is already in use.`)
          if (symbol !== newSymbol) {
            for (const other of Object.values(state.blocks)) {
              if (other.mode === 'derived' && other.formula.trim()) {
                other.formula = renameFormulaSymbol(other.formula, symbol, newSymbol)
              }
            }
            delete state.blocks[symbol]
            block.symbol = newSymbol
            state.blocks[newSymbol] = block
            state.plots.forEach((plot) => {
              if (plot.xSymbol === symbol) plot.xSymbol = newSymbol
              if (plot.ySymbol === symbol) plot.ySymbol = newSymbol
              plot.series?.forEach((entry) => { if (entry.ySymbol === symbol) entry.ySymbol = newSymbol })
            })
            if (state.activeFormulaSymbol === symbol) state.activeFormulaSymbol = newSymbol
          }
          block.displayName = name.trim()
          block.format.unit = unit.trim() || undefined
          state.blocks = recalculateWorkspace(state.blocks)
        }),
      addPlot: (plot) => set((state) => { state.plots.push(plot) }),
      updatePlot: (id, patch) => set((state) => {
        const plot = state.plots.find((item) => item.id === id)
        if (plot) Object.assign(plot, patch)
      }),
      removePlot: (id) => set((state) => { state.plots = state.plots.filter((plot) => plot.id !== id) }),
      replaceWorkspace: (workspace) =>
        set(() => ({ ...workspace, plots: workspace.plots ?? [], cellFormats: workspace.cellFormats ?? {}, columnWidths: workspace.columnWidths ?? {}, blocks: recalculateWorkspace(workspace.blocks) })),
    })),
    { equality: (past, current) => past === current },
  ),
)

import type { CellFormat, GridRange, VariableBlock } from '../types/workspace'
import type { GridSelection } from '@glideapps/glide-data-grid'

export interface CellAddress {
  symbol: string
  row: number
  col: number
  role: 'label' | 'value' | 'ghost'
}

export function blockCells(block: VariableBlock, ghost = false): Array<{ row: number; col: number; address: CellAddress }> {
  const cells: Array<{ row: number; col: number; address: CellAddress }> = []
  const { row, col } = block.anchor
  if (block.labelPlacement !== 'none') {
    cells.push({ row, col, address: { symbol: block.symbol, row: 0, col: 0, role: 'label' } })
  }
  const startRow = row + (block.labelPlacement === 'above' ? 1 : 0)
  const startCol = col + (block.labelPlacement === 'left' ? 1 : 0)
  block.data.forEach((values, localRow) => values.forEach((_, localCol) => {
    cells.push({
      row: startRow + localRow,
      col: startCol + localCol,
      address: { symbol: block.symbol, row: localRow, col: localCol, role: 'value' },
    })
  }))
  if (ghost && block.mode === 'root' && block.shape.type === 'vector' && block.shape.orientation === 'col') {
    cells.push({
      row: startRow + block.data.length,
      col: startCol,
      address: { symbol: block.symbol, row: block.data.length, col: 0, role: 'ghost' },
    })
  }
  return cells
}

export function spatialIndex(blocks: Record<string, VariableBlock>): Map<string, CellAddress> {
  const index = new Map<string, CellAddress>()
  for (const block of Object.values(blocks)) {
    for (const cell of blockCells(block)) index.set(`${cell.col},${cell.row}`, cell.address)
  }
  for (const block of Object.values(blocks)) {
    for (const cell of blockCells(block, true)) {
      const key = `${cell.col},${cell.row}`
      if (cell.address.role === 'ghost' && !index.has(key)) index.set(key, cell.address)
    }
  }
  return index
}

export function selectedBlockCells(index: Map<string, CellAddress>, selection: GridSelection): CellAddress[] {
  const ranges = selection.current ? [selection.current.range, ...selection.current.rangeStack] : []
  return Array.from(index.entries()).flatMap(([key, address]) => {
    if (address.role === 'ghost') return []
    const [col, row] = key.split(',').map(Number)
    const selected = selection.rows.hasIndex(row) || selection.columns.hasIndex(col) ||
      ranges.some((range) => col >= range.x && col < range.x + range.width && row >= range.y && row < range.y + range.height)
    return selected ? [address] : []
  })
}

export function selectionRanges(selection: GridSelection, columns: number, rows: number): GridRange[] {
  const ranges: GridRange[] = selection.current ? [selection.current.range, ...selection.current.rangeStack] : []
  for (const row of selection.rows) ranges.push({ x: 0, y: row, width: columns, height: 1 })
  for (const col of selection.columns) ranges.push({ x: col, y: 0, width: 1, height: rows })
  return ranges
}

export function blockEdges(index: Map<string, CellAddress>, col: number, row: number): { top: boolean; right: boolean; bottom: boolean; left: boolean } | undefined {
  const cell = index.get(`${col},${row}`)
  if (!cell || cell.role === 'ghost') return undefined
  const outside = (x: number, y: number) => {
    const neighbor = index.get(`${x},${y}`)
    return !neighbor || neighbor.role === 'ghost' || neighbor.symbol !== cell.symbol
  }
  return {
    top: outside(col, row - 1), right: outside(col + 1, row),
    bottom: outside(col, row + 1), left: outside(col - 1, row),
  }
}

export function visibleCellEdges(index: Map<string, CellAddress>, formats: Record<string, CellFormat>, col: number, row: number): CellFormat['borders'] {
  const custom = formats[`${col},${row}`]?.borders
  if (custom) return custom
  const edges = blockEdges(index, col, row)
  if (!edges) return undefined
  return {
    top: edges.top && !formats[`${col},${row - 1}`]?.borders,
    right: edges.right && !formats[`${col + 1},${row}`]?.borders,
    bottom: edges.bottom && !formats[`${col},${row + 1}`]?.borders,
    left: edges.left && !formats[`${col - 1},${row}`]?.borders,
  }
}

export function assertVacant(block: VariableBlock, blocks: Record<string, VariableBlock>, ignoreSymbol?: string): void {
  const occupied = spatialIndex(Object.fromEntries(Object.entries(blocks).filter(([symbol]) => symbol !== ignoreSymbol)))
  for (const cell of blockCells(block)) {
    if (cell.row < 0 || cell.col < 0 || occupied.has(`${cell.col},${cell.row}`)) {
      throw new Error('The variable overlaps another block or lies outside the grid.')
    }
  }
}

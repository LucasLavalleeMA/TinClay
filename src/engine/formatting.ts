import type { CellFormat, GridRange, VariableBlock } from '../types/workspace'
import { blockCells } from './spatial'

export function formatSelection(
  formats: Record<string, CellFormat>,
  ranges: GridRange[],
  patch: Partial<CellFormat>,
  border?: 'all' | 'outer' | 'none',
  clear = false,
): void {
  for (const range of ranges) {
    for (let row = range.y; row < range.y + range.height; row += 1) {
      for (let col = range.x; col < range.x + range.width; col += 1) {
        const key = `${col},${row}`
        if (clear) {
          delete formats[key]
          continue
        }
        const borders = border && {
          top: border === 'all' || border === 'outer' && row === range.y,
          right: border === 'all' || border === 'outer' && col === range.x + range.width - 1,
          bottom: border === 'all' || border === 'outer' && row === range.y + range.height - 1,
          left: border === 'all' || border === 'outer' && col === range.x,
        }
        formats[key] = { ...formats[key], ...patch, ...(borders ? { borders } : {}) }
      }
    }
  }
}

export function moveCellFormats(
  formats: Record<string, CellFormat>,
  moves: Array<{ block: VariableBlock; rowDelta: number; colDelta: number }>,
): void {
  const cells = moves.flatMap(({ block, rowDelta, colDelta }) => blockCells(block).map(({ row, col }) => ({
    from: `${col},${row}`, to: `${col + colDelta},${row + rowDelta}`, format: formats[`${col},${row}`],
  })))
  for (const cell of cells) delete formats[cell.from]
  for (const cell of cells) {
    if (cell.format) formats[cell.to] = cell.format
    else delete formats[cell.to]
  }
}

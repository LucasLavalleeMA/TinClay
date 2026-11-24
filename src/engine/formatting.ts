import type { CellFormat, GridRange, VariableBlock } from '../types/workspace'
import { blockCells } from './spatial'

export const TABLE_STYLES = {
  slate: { label: 'Slate', header: '#46545d', band: '#e7edf0', border: '#b7c5cb' },
  rose: { label: 'Rose', header: '#8a5b5c', band: '#f6e8e7', border: '#d9bcba' },
  teal: { label: 'Teal', header: '#3e696a', band: '#e2f0ef', border: '#aacbc8' },
} as const

export type TableStyle = keyof typeof TABLE_STYLES

export function validateFormatRanges(ranges: GridRange[]): void {
  if (ranges.some((range) => !Number.isSafeInteger(range.x) || !Number.isSafeInteger(range.y) ||
      !Number.isSafeInteger(range.width) || !Number.isSafeInteger(range.height) ||
      range.x < 0 || range.y < 0 || range.width < 1 || range.height < 1) ||
      ranges.reduce((sum, range) => sum + range.width * range.height, 0) > 250000) {
    throw new Error('Select at most 250,000 cells to format at once.')
  }
}

export function formatTableSelection(formats: Record<string, CellFormat>, ranges: GridRange[], style: TableStyle): void {
  const preset = TABLE_STYLES[style]
  if (!preset) throw new Error('Unknown table style.')
  for (const range of ranges) {
    for (let offset = 0; offset < range.height; offset += 1) {
      formatSelection(formats, [{ ...range, y: range.y + offset, height: 1 }], {
        fillColor: offset === 0 ? preset.header : offset % 2 ? preset.band : '#ffffff',
        textColor: offset === 0 ? '#ffffff' : '#202020',
        bold: offset === 0,
        borderStyle: 'solid',
        borderColor: preset.border,
      }, 'all')
    }
  }
}

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

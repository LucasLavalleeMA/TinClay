import Papa from 'papaparse'
import type { VariableBlock } from '../types/workspace'
import { createBlock } from './workspace'
import { isEmptyValue } from './missingValues'

function splitHeader(header: string): { displayName: string; unit?: string } {
  const match = header.trim().match(/^(.*?)\s*\(([^()]*)\)\s*$/)
  return {
    displayName: (match?.[1] ?? header).trim() || 'Variable',
    ...(match?.[2]?.trim() ? { unit: match[2].trim() } : {}),
  }
}

export function toSymbol(displayName: string): string {
  const symbol = displayName.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_')
  const valid = /^[A-Za-z]/.test(symbol) ? symbol : `x_${symbol}`
  return valid || 'Variable'
}

export function importCsv(
  text: string,
  anchor: { row: number; col: number },
  existingSymbols: Iterable<string> = [],
): VariableBlock[] {
  const parsed = Papa.parse<unknown[]>(text, {
    header: false,
    dynamicTyping: true,
    skipEmptyLines: false,
  })
  const errors = parsed.errors.filter((error) => error.code !== 'UndetectableDelimiter')
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.message).join('; '))
  }
  const [headerRow, ...dataRows] = parsed.data
  if (/\r?\n$/.test(text) && dataRows.at(-1)?.every((value) => value === null || value === undefined || value === '')) dataRows.pop()
  if (!headerRow?.length) {
    throw new Error('CSV must include a header row.')
  }
  const headers = headerRow.map((value) => String(value ?? '').trim())

  const used = new Set(existingSymbols)
  return headers.flatMap((header, index) => {
    const values = dataRows.map((row) => row[index])
    const isBlank = (value: unknown) => value === null || value === undefined || value === ''
    if (!values.length || !values.every((value) => isBlank(value) || typeof value === 'number' && Number.isFinite(value))) return []
    const allBlank = values.every(isBlank)

    const details = splitHeader(header)
    const base = toSymbol(details.displayName)
    let symbol = base
    let suffix = 2
    while (used.has(symbol)) symbol = `${base}_${suffix++}`
    used.add(symbol)

    const block = createBlock({
        displayName: details.displayName,
        symbol,
        mode: 'root',
        anchor: { row: anchor.row, col: anchor.col + index },
        data: values.map((value) => [typeof value === 'number' ? value : 0]),
        unfilled: allBlank,
        format: details.unit ? { unit: details.unit } : undefined,
      })
    const emptyCells: Array<[number, number]> = []
    values.forEach((value, row) => { if (isBlank(value)) emptyCells.push([row, 0]) })
    if (emptyCells.length && !allBlank) block.emptyCells = emptyCells
    return [block]
  })
}

export function exportCsv(blocks: VariableBlock[]): string {
  const columns = blocks.filter((block) => block.shape.type !== 'scalar')
  if (columns.length === 0) throw new Error('Select at least one vector or matrix to export.')

  const rows: Record<string, number | ''>[] = []
  const rowCount = Math.max(...columns.map((block) => block.data.length))
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row: Record<string, number | ''> = {}
    for (const block of columns) {
      block.data[rowIndex]?.forEach((value, columnIndex) => {
        const key = block.shape.type === 'matrix'
          ? `${block.displayName}_${columnIndex + 1}`
          : block.displayName
        row[key] = isEmptyValue(block, rowIndex, columnIndex) ? '' : value
      })
    }
    rows.push(row)
  }
  return Papa.unparse(rows, { quotes: (value) => value === '' })
}

export function parseClipboard(text: string): number[][] | undefined {
  const rows = Papa.parse<string[]>(text.trim(), { header: false, skipEmptyLines: true }).data
  if (rows.some((row) => row.some((cell) => !cell.trim()))) return undefined
  const numeric = rows.map((row) => row.map((cell) => Number(cell.trim())))
  if (numeric.length === 0 || numeric.some((row) => row.some((value) => !Number.isFinite(value)))) {
    return undefined
  }
  return numeric
}

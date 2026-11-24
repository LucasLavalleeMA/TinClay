import type { VariableBlock } from '../types/workspace'

export function isEmptyValue(block: VariableBlock, row: number, col: number): boolean {
  return Boolean(block.unfilled || block.emptyCells?.some(([r, c]) => r === row && c === col))
}

export function hasMissingValues(block: VariableBlock): boolean {
  return Boolean(block.unfilled || block.emptyCells?.length)
}

import type { MathNode } from 'mathjs'
import type { VariableBlock } from '../types/workspace'
import { inferShape } from './shapes'
import { math, spreadsheetFunctionName, spreadsheetFunctions } from './spreadsheetFunctions'

const mathMembers = math as unknown as Record<string, unknown>
const ignoredSymbols = new Set(['true', 'false', 'null', 'undefined'])

export function isValidSymbol(symbol: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(symbol) && !(symbol in mathMembers) && !ignoredSymbols.has(symbol)
}

export function renameFormulaSymbol(formula: string, from: string, to: string): string {
  return math.parse(formula).transform((node, path, parent) => {
    if (node.type !== 'SymbolNode' || node.toString() !== from) return node
    if (path === 'fn' && parent?.type === 'FunctionNode' && spreadsheetFunctionName(node.toString())) return node
    if (path === 'object' && parent?.type === 'AccessorNode' && spreadsheetFunctionName(parent.toString())) return node
    return new math.SymbolNode(to)
  }).toString()
}

function parseFormula(formula: string): MathNode {
  return math.parse(formula).transform((node, path, parent) => {
    if (path !== 'fn' || parent?.type !== 'FunctionNode') return node
    const name = spreadsheetFunctionName(node.toString())
    return name ? new math.SymbolNode(name) : node
  })
}

export function getFormulaSymbols(formula: string): string[] {
  const symbols = new Set<string>()
  parseFormula(formula).traverse((node: MathNode) => {
    if (node.type !== 'SymbolNode') return
    const name = node.toString()
    if (ignoredSymbols.has(name) || name in spreadsheetFunctions) return
    if (typeof mathMembers[name] === 'function' || name in mathMembers) return
    symbols.add(name)
  })
  return [...symbols]
}

function toMathValue(block: VariableBlock): number | number[] | number[][] {
  if (block.shape.type === 'scalar') return block.data[0]?.[0] ?? 0
  if (block.shape.type === 'vector') {
    const values = block.data.map((row) => row[0] ?? 0)
    return block.shape.orientation === 'row' ? [values] : values
  }
  return block.data
}

function toRows(value: unknown): number[][] {
  if (typeof value === 'number') return [[value]]
  const array = Array.isArray(value) ? value : (value as { toArray?: () => unknown[] })?.toArray?.()
  if (!Array.isArray(array)) throw new Error('Formula must return numeric data.')
  if (array.length === 0) return []
  if (array.every((item) => typeof item === 'number')) {
    return (array as number[]).map((item) => [item])
  }
  if (array.every((item) => Array.isArray(item))) {
    return (array as unknown[][]).map((row) => {
      if (!row.every((item) => typeof item === 'number')) {
        throw new Error('Formula returned non-numeric data.')
      }
      return row as number[]
    })
  }
  throw new Error('Formula returned inconsistent dimensions.')
}

export function evaluateFormula(
  formula: string,
  blocks: Record<string, VariableBlock>,
): Pick<VariableBlock, 'data' | 'shape'> {
  const scope: Record<string, unknown> = { ...spreadsheetFunctions }
  for (const [symbol, block] of Object.entries(blocks)) {
    scope[symbol] = toMathValue(block)
  }
  const data = toRows(parseFormula(formula).evaluate(scope))
  if (data.some((row) => row.some((value) => !Number.isFinite(value)))) {
    throw new Error('Formula produced a non-finite value.')
  }
  return { data, shape: inferShape(data) }
}

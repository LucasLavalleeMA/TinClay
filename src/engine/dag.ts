import { alg, Graph } from '@dagrejs/graphlib'
import type { VariableBlock } from '../types/workspace'
import { evaluateFormula, getFormulaSymbols } from './evaluator'
import { hasMissingValues } from './missingValues'

export function recalculateWorkspace(
  source: Record<string, VariableBlock>,
): Record<string, VariableBlock> {
  const blocks = Object.fromEntries(
    Object.entries(source).map(([symbol, block]) => [symbol, { ...block, error: undefined }]),
  ) as Record<string, VariableBlock>
  const graph = new Graph({ directed: true })

  for (const symbol of Object.keys(blocks)) graph.setNode(symbol)
  for (const block of Object.values(blocks)) {
    if (block.mode !== 'derived' || !block.formula.trim()) continue
    try {
      for (const dependency of getFormulaSymbols(block.formula)) {
        if (!blocks[dependency]) {
          block.error = `Unknown variable: ${dependency}`
          continue
        }
        graph.setEdge(dependency, block.symbol)
      }
    } catch (error) {
      block.error = error instanceof Error ? error.message : 'Invalid formula.'
    }
  }

  const cycles = alg.findCycles(graph)
  if (cycles.length > 0) {
    for (const symbol of new Set(cycles.flat())) {
      if (blocks[symbol]) blocks[symbol].error = 'Circular dependency detected'
    }
  }

  let order: string[]
  try {
    order = alg.topsort(graph)
  } catch {
    order = Object.keys(blocks)
  }

  for (const symbol of order) {
    const block = blocks[symbol]
    if (block.mode !== 'derived' || !block.formula.trim() || block.error) continue
    const failedDependency = getFormulaSymbols(block.formula).find(
      (dependency) => blocks[dependency]?.error || blocks[dependency] && hasMissingValues(blocks[dependency]),
    )
    if (failedDependency) {
      block.error = hasMissingValues(blocks[failedDependency])
        ? blocks[failedDependency].unfilled ? `Variable ${failedDependency} has no value yet` : `Variable ${failedDependency} has missing values`
        : `Dependency ${failedDependency} has an error`
      continue
    }
    try {
      Object.assign(block, evaluateFormula(block.formula, blocks))
    } catch (error) {
      block.error = error instanceof Error ? error.message : 'Formula evaluation failed.'
    }
  }
  return blocks
}

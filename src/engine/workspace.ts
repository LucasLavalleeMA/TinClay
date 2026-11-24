import type { NumberFormatConfig, VariableBlock, Workspace } from '../types/workspace'
import { recalculateWorkspace } from './dag'
import { inferShape } from './shapes'

export function createBlock(
  input: Pick<VariableBlock, 'displayName' | 'symbol' | 'mode' | 'anchor'> &
    Partial<Pick<VariableBlock, 'data' | 'formula' | 'labelPlacement' | 'unfilled'>> & {
      format?: Partial<NumberFormatConfig>
    },
): VariableBlock {
  const data = input.data ?? [[0]]
  return {
    id: crypto.randomUUID(),
    displayName: input.displayName,
    symbol: input.symbol,
    mode: input.mode,
    formula: input.formula ?? '',
    anchor: input.anchor,
    labelPlacement: input.labelPlacement ?? 'above',
    shape: inferShape(data),
    data,
    ...(input.unfilled ? { unfilled: true } : {}),
    format: {
      style: 'general',
      decimals: 2,
      alignDecimal: false,
      ...input.format,
    },
  }
}

export function createDefaultWorkspace(): Workspace {
  const trials = createBlock({
    displayName: 'Trials',
    symbol: 'Trials',
    mode: 'root',
    anchor: { row: 1, col: 1 },
    data: [[1], [2], [3], [4], [5]],
  })
  const velocity = createBlock({
    displayName: 'Velocity',
    symbol: 'v',
    mode: 'root',
    anchor: { row: 1, col: 2 },
    data: [[10], [20], [30], [40], [50]],
    format: { unit: 'm/s' },
  })
  const mass = createBlock({
    displayName: 'Mass',
    symbol: 'm',
    mode: 'root',
    anchor: { row: 8, col: 1 },
    data: [[3]],
    labelPlacement: 'left',
    format: { unit: 'kg' },
  })
  const energy = createBlock({
    displayName: 'Kinetic Energy',
    symbol: 'KE',
    mode: 'derived',
    formula: '0.5 .* m .* v.^2',
    anchor: { row: 1, col: 3 },
    format: { style: 'number', decimals: 2, alignDecimal: true, unit: 'J' },
  })

  const workspace: Workspace = {
    blocks: Object.fromEntries(
      [trials, velocity, mass, energy].map((block) => [block.symbol, block]),
    ),
    activeFormulaSymbol: 'KE',
    cellFormats: {},
    columnWidths: {},
    plots: [{
      id: crypto.randomUUID(),
      title: 'Kinetic Energy',
      xSymbol: 'v',
      ySymbol: 'KE',
      anchor: { row: 1, col: 5 },
      span: { rows: 10, cols: 4 },
    }],
  }
  workspace.blocks = recalculateWorkspace(workspace.blocks)
  return workspace
}

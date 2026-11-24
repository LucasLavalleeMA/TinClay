import type { VariableBlock } from '../types/workspace'

export function inferShape(data: number[][]): VariableBlock['shape'] {
  if (data.length === 1 && data[0]?.length === 1) return { type: 'scalar' }
  if (data.every((row) => row.length === 1)) {
    return { type: 'vector', length: data.length, orientation: 'col' }
  }
  return { type: 'matrix', rows: data.length, cols: data[0]?.length ?? 0 }
}

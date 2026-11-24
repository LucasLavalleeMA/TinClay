export const DEFAULT_COLUMN_WIDTH = 132

export function viewportOrigin(offsets: readonly number[], col: number, row: number, tx: number, ty: number, rowHeight: number): { x: number; y: number } {
  return { x: 48 - offsets[col] + tx, y: 36 - row * rowHeight + ty }
}

export function columnOffsets(widths: readonly number[]): number[] {
  const offsets = [0]
  for (const width of widths) offsets.push(offsets[offsets.length - 1] + width)
  return offsets
}

export function columnAt(offsets: readonly number[], x: number): number {
  let low = 0, high = offsets.length - 1
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2)
    if (offsets[mid] <= x) low = mid
    else high = mid - 1
  }
  return low
}

export function nearestColumnEdge(offsets: readonly number[], x: number): number {
  const index = columnAt(offsets, Math.max(0, x))
  if (index >= offsets.length - 1) return offsets.length - 1
  return x - offsets[index] < offsets[index + 1] - x ? index : index + 1
}

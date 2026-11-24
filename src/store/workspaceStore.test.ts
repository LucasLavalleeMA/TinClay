import { beforeEach, describe, expect, it } from 'vitest'
import { createBlock, createDefaultWorkspace } from '../engine/workspace'
import { spatialIndex } from '../engine/spatial'
import { useWorkspaceStore } from './workspaceStore'

describe('workspace layout updates', () => {
  beforeEach(() => {
    useWorkspaceStore.setState(createDefaultWorkspace())
    useWorkspaceStore.temporal.getState().clear()
  })

  it('undoes plot settings and series changes', () => {
    const plot = useWorkspaceStore.getState().plots[0]
    useWorkspaceStore.getState().updatePlot(plot.id, { settings: { type: 'bar', barOrientation: 'h' }, series: [{ id: 's1', ySymbol: 'Trials', label: '', color: '#123456' }] })
    expect(useWorkspaceStore.getState().plots[0].settings?.type).toBe('bar')
    useWorkspaceStore.temporal.getState().undo()
    expect(useWorkspaceStore.getState().plots[0].settings).toBeUndefined()
    expect(useWorkspaceStore.getState().plots[0].series).toBeUndefined()
    useWorkspaceStore.temporal.getState().redo()
    expect(useWorkspaceStore.getState().plots[0].series?.[0].ySymbol).toBe('Trials')
  })

  it('aligns whole variables while retaining other cell formats through growth, moves, and undo', () => {
    const { formatCells, editValue, moveBlock } = useWorkspaceStore.getState()
    formatCells([{ x: 2, y: 3, width: 1, height: 1 }], { bold: true, alignment: 'left' })
    formatCells([{ x: 2, y: 4, width: 1, height: 1 }], { alignment: 'center' })
    let state = useWorkspaceStore.getState()
    expect(state.blocks.v.format.alignment).toBe('center')
    expect(state.cellFormats?.['2,3']).toEqual({ bold: true })
    expect(state.cellFormats?.['2,4']).toBeUndefined()
    expect(state.blocks.Trials.format.alignment).toBeUndefined()
    editValue('v', 5, 0, 60)
    moveBlock('v', { row: 20, col: 8 })
    state = useWorkspaceStore.getState()
    expect(state.blocks.v.format.alignment).toBe('center')
    expect(state.blocks.v.data).toHaveLength(6)
    formatCells([{ x: 8, y: 21, width: 1, height: 1 }], {}, undefined, true)
    expect(useWorkspaceStore.getState().blocks.v.format.alignment).toBeUndefined()
    useWorkspaceStore.temporal.getState().undo()
    expect(useWorkspaceStore.getState().blocks.v.format.alignment).toBe('center')
  })

  it('aligns multiple selected variables and keeps empty-cell alignment independent', () => {
    const { formatCells } = useWorkspaceStore.getState()
    formatCells([{ x: 1, y: 1, width: 2, height: 1 }, { x: 8, y: 8, width: 1, height: 1 }], { alignment: 'right' })
    const state = useWorkspaceStore.getState()
    expect(state.blocks.Trials.format.alignment).toBe('right')
    expect(state.blocks.v.format.alignment).toBe('right')
    expect(state.blocks.KE.format.alignment).toBeUndefined()
    expect(state.cellFormats?.['8,8'].alignment).toBe('right')
  })

  it('applies a banded table style to the selection in one undoable step', () => {
    const { formatCells, formatTable } = useWorkspaceStore.getState()
    formatCells([{ x: 2, y: 2, width: 1, height: 1 }], { italic: true })
    useWorkspaceStore.temporal.getState().clear()
    formatTable([{ x: 1, y: 1, width: 3, height: 3 }], 'teal')
    let state = useWorkspaceStore.getState()
    expect(state.cellFormats?.['1,1']).toMatchObject({ fillColor: '#3e696a', textColor: '#ffffff', bold: true })
    expect(state.cellFormats?.['2,2']).toMatchObject({ fillColor: '#e2f0ef', italic: true, bold: false, borders: { top: true, bottom: true, left: true, right: true } })
    expect(state.cellFormats?.['2,3']?.fillColor).toBe('#ffffff')
    expect(state.blocks.KE.formula).toBe('0.5 .* m .* v.^2')
    expect(useWorkspaceStore.temporal.getState().pastStates).toHaveLength(1)
    useWorkspaceStore.temporal.getState().undo()
    state = useWorkspaceStore.getState()
    expect(state.cellFormats?.['1,1']).toBeUndefined()
    expect(state.cellFormats?.['2,2']).toEqual({ italic: true })
    useWorkspaceStore.temporal.getState().redo()
    expect(useWorkspaceStore.getState().cellFormats?.['1,1']?.fillColor).toBe('#3e696a')
    expect(() => formatTable([{ x: 0, y: 0, width: 501, height: 500 }], 'rose')).toThrow(/250,000/)
  })

  it('moves a lower block down when an expanding vector reaches it', () => {
    const { editValue } = useWorkspaceStore.getState()
    editValue('v', 5, 0, 60)
    editValue('v', 6, 0, 70)
    expect(useWorkspaceStore.getState().blocks.m.anchor.row).toBe(10)
    expect(useWorkspaceStore.getState().blocks.KE.data).toHaveLength(7)
    expect(useWorkspaceStore.getState().blocks.KE.data[6][0]).toBe(7350)
    expect(spatialIndex(useWorkspaceStore.getState().blocks).get('2,9')?.role).toBe('ghost')
  })

  it('updates dependencies on root edit and removes only the selected vector end', () => {
    const { editValue, removeVectorEnd } = useWorkspaceStore.getState()
    editValue('v', 0, 0, 12)
    expect(useWorkspaceStore.getState().blocks.KE.data[0][0]).toBe(216)
    removeVectorEnd('v')
    expect(useWorkspaceStore.getState().blocks.v.data).toHaveLength(4)
    expect(useWorkspaceStore.getState().blocks.Trials.data).toHaveLength(5)
    expect(useWorkspaceStore.getState().blocks.KE.data).toHaveLength(4)
  })

  it('moves without rewriting formulas and rejects overlapping moves', () => {
    const { moveBlock } = useWorkspaceStore.getState()
    const formula = useWorkspaceStore.getState().blocks.KE.formula
    moveBlock('v', { row: 12, col: 7 })
    expect(useWorkspaceStore.getState().blocks.v.anchor).toEqual({ row: 12, col: 7 })
    expect(useWorkspaceStore.getState().blocks.KE.formula).toBe(formula)
    expect(() => moveBlock('v', { row: 1, col: 1 })).toThrow(/overlaps/)
  })

  it('renames references and plot bindings while preserving calculations', () => {
    const plot = useWorkspaceStore.getState().plots[0]
    useWorkspaceStore.getState().updatePlot(plot.id, { series: [{ id: 'extra', ySymbol: 'v', label: 'Speed', color: '#123456' }] })
    useWorkspaceStore.getState().renameBlock('v', 'Speed', 'speed', 'm/s')
    const state = useWorkspaceStore.getState()
    expect(state.blocks.v).toBeUndefined()
    expect(state.blocks.KE.formula).toContain('speed')
    expect(state.plots[0].xSymbol).toBe('speed')
    expect(state.plots[0].series?.[0].ySymbol).toBe('speed')
    expect(state.blocks.KE.data.map(([value]) => value)).toEqual([150, 600, 1350, 2400, 3750])
  })

  it('converts a root block to a derived expression', () => {
    useWorkspaceStore.getState().setFormula('m', '2 + 3')
    expect(useWorkspaceStore.getState().blocks.m.mode).toBe('derived')
    expect(useWorkspaceStore.getState().blocks.KE.data[0][0]).toBe(250)
  })

  it('keeps a one-element column vector appendable after edits', () => {
    const { removeVectorEnd, editValue } = useWorkspaceStore.getState()
    for (let i = 0; i < 4; i += 1) removeVectorEnd('v')
    editValue('v', 0, 0, 7)
    const state = useWorkspaceStore.getState()
    expect(state.blocks.v.shape).toEqual({ type: 'vector', length: 1, orientation: 'col' })
    expect(spatialIndex(state.blocks).get('2,3')?.role).toBe('ghost')
  })

  it('expands both dimensions, shifts neighboring blocks, and evaluates matrix formulas', () => {
    const { resizeBlock, editValue, addBlocks } = useWorkspaceStore.getState()
    resizeBlock('v', 5, 2)
    let state = useWorkspaceStore.getState()
    expect(state.blocks.v.data).toEqual([[10, 0], [20, 0], [30, 0], [40, 0], [50, 0]])
    expect(state.blocks.KE.anchor.col).toBe(4)
    resizeBlock('v', 6, 2)
    editValue('v', 5, 1, 4)
    state = useWorkspaceStore.getState()
    expect(state.blocks.v.shape).toEqual({ type: 'matrix', rows: 6, cols: 2 })
    expect(state.blocks.v.data[5]).toEqual([60, 4])
    addBlocks([createBlock({ displayName: 'Double', symbol: 'Double', mode: 'derived', formula: 'v .* 2', anchor: { row: 20, col: 10 } })])
    expect(useWorkspaceStore.getState().blocks.Double.data[5]).toEqual([120, 8])
  })

  it('converts a derived block to editable values when a cell is edited or expanded', () => {
    const { setFormula, editValue, resizeBlock } = useWorkspaceStore.getState()
    setFormula('v', 'Trials .* 10')
    editValue('v', 1, 0, 25)
    let state = useWorkspaceStore.getState()
    expect(state.blocks.v.mode).toBe('root')
    expect(state.blocks.v.formula).toBe('')
    expect(state.blocks.v.data.map(([value]) => value)).toEqual([10, 25, 30, 40, 50])
    expect(state.blocks.KE.data[1][0]).toBe(937.5)
    setFormula('v', 'Trials .* 10')
    resizeBlock('v', 5, 2)
    state = useWorkspaceStore.getState()
    expect(state.blocks.v.mode).toBe('root')
    expect(state.blocks.v.data[1]).toEqual([20, 0])
  })

  it('keeps a name-only variable unfilled until a value is entered', () => {
    const { addBlocks, editValue } = useWorkspaceStore.getState()
    addBlocks([
      createBlock({ displayName: 'Speed Input', symbol: 'Speed_Input', mode: 'root', unfilled: true, anchor: { row: 20, col: 0 } }),
      createBlock({ displayName: 'Result', symbol: 'Result', mode: 'derived', formula: 'Speed_Input * 2', anchor: { row: 20, col: 2 } }),
    ])
    expect(useWorkspaceStore.getState().blocks.Result.error).toMatch(/no value yet/)
    editValue('Speed_Input', 0, 0, 7)
    const state = useWorkspaceStore.getState()
    expect(state.blocks.Speed_Input.unfilled).toBeUndefined()
    expect(state.blocks.Result.error).toBeUndefined()
    expect(state.blocks.Result.data).toEqual([[14]])
  })

  it('resizes both dimensions in one undoable step and restores shifted blocks', () => {
    const { resizeBlock } = useWorkspaceStore.getState()
    resizeBlock('v', 7, 2)
    let state = useWorkspaceStore.getState()
    expect(state.blocks.v.data).toEqual([[10, 0], [20, 0], [30, 0], [40, 0], [50, 0], [60, 0], [70, 0]])
    expect(state.blocks.KE.anchor.col).toBe(4)
    useWorkspaceStore.temporal.getState().undo()
    state = useWorkspaceStore.getState()
    expect(state.blocks.v.data).toEqual([[10], [20], [30], [40], [50]])
    expect(state.blocks.KE.anchor.col).toBe(3)
    expect(state.blocks.KE.data[0][0]).toBe(150)
    useWorkspaceStore.temporal.getState().redo()
    expect(useWorkspaceStore.getState().blocks.v.data).toHaveLength(7)
    expect(useWorkspaceStore.getState().blocks.KE.anchor.col).toBe(4)
    resizeBlock('v', 2, 1)
    expect(useWorkspaceStore.getState().blocks.v.data).toEqual([[10], [20]])
    expect(useWorkspaceStore.temporal.getState().futureStates).toHaveLength(0)
    useWorkspaceStore.temporal.getState().undo()
    expect(useWorkspaceStore.getState().blocks.v.data).toHaveLength(7)
  })

  it('keeps derived values unchanged when resize does not change dimensions', () => {
    const { setFormula, resizeBlock } = useWorkspaceStore.getState()
    setFormula('v', 'Trials .* 10')
    const count = useWorkspaceStore.temporal.getState().pastStates.length
    resizeBlock('v', 5, 1)
    expect(useWorkspaceStore.getState().blocks.v.mode).toBe('derived')
    expect(useWorkspaceStore.temporal.getState().pastStates).toHaveLength(count)
  })

  it('extends arithmetic sequences in both dimensions and recalculates dependents', () => {
    const { addBlocks, resizeBlock } = useWorkspaceStore.getState()
    addBlocks([createBlock({ displayName: 'GridSequence', symbol: 'GridSequence', mode: 'root', anchor: { row: 25, col: 0 }, data: [[1, 2], [3, 4]] })])
    resizeBlock('GridSequence', 3, 3)
    expect(useWorkspaceStore.getState().blocks.GridSequence.data).toEqual([[1, 2, 3], [3, 4, 5], [5, 6, 7]])
    resizeBlock('v', 7, 1)
    expect(useWorkspaceStore.getState().blocks.v.data.map(([value]) => value)).toEqual([10, 20, 30, 40, 50, 60, 70])
    expect(useWorkspaceStore.getState().blocks.KE.data[6][0]).toBe(7350)
    useWorkspaceStore.temporal.getState().undo()
    expect(useWorkspaceStore.getState().blocks.v.data).toHaveLength(5)
    useWorkspaceStore.temporal.getState().redo()
    expect(useWorkspaceStore.getState().blocks.v.data[6][0]).toBe(70)
  })

  it('leaves irregular, single-value and incomplete sequences as zero-filled expansions', () => {
    const { addBlocks, clearSelection, resizeBlock } = useWorkspaceStore.getState()
    addBlocks([
      createBlock({ displayName: 'Irregular', symbol: 'Irregular', mode: 'root', anchor: { row: 25, col: 0 }, data: [[1], [3], [4]] }),
      createBlock({ displayName: 'One', symbol: 'One', mode: 'root', anchor: { row: 25, col: 2 }, data: [[3]] }),
      createBlock({ displayName: 'Incomplete', symbol: 'Incomplete', mode: 'root', anchor: { row: 25, col: 4 }, data: [[1], [2], [3]] }),
      createBlock({ displayName: 'Tiny', symbol: 'Tiny', mode: 'root', anchor: { row: 25, col: 6 }, data: [[1e-20], [2e-20], [4e-20]] }),
      createBlock({ displayName: 'LargeInt', symbol: 'LargeInt', mode: 'root', anchor: { row: 25, col: 8 }, data: [[1e15], [1e15 + 1], [1e15 + 3]] }),
    ])
    clearSelection([{ symbol: 'Incomplete', row: 1, col: 0, role: 'value' }])
    resizeBlock('Irregular', 4, 1)
    resizeBlock('One', 1, 2)
    resizeBlock('Incomplete', 4, 1)
    resizeBlock('Tiny', 4, 1)
    resizeBlock('LargeInt', 4, 1)
    expect(useWorkspaceStore.getState().blocks.Irregular.data[3]).toEqual([0])
    expect(useWorkspaceStore.getState().blocks.One.data).toEqual([[3, 0]])
    expect(useWorkspaceStore.getState().blocks.Incomplete.data[3]).toEqual([0])
    expect(useWorkspaceStore.getState().blocks.Incomplete.emptyCells).toEqual([[1, 0]])
    expect(useWorkspaceStore.getState().blocks.Tiny.data[3]).toEqual([0])
    expect(useWorkspaceStore.getState().blocks.LargeInt.data[3]).toEqual([0])
  })

  it('recognizes decreasing and fractional sequences and rejects non-finite expansions', () => {
    const { addBlocks, resizeBlock } = useWorkspaceStore.getState()
    addBlocks([
      createBlock({ displayName: 'FractionSequence', symbol: 'FractionSequence', mode: 'root', anchor: { row: 25, col: 0 }, data: [[0.3], [0.2], [0.1]] }),
      createBlock({ displayName: 'Huge', symbol: 'Huge', mode: 'root', anchor: { row: 25, col: 2 }, data: [[1e308], [1.5e308]] }),
    ])
    resizeBlock('FractionSequence', 4, 1)
    expect(useWorkspaceStore.getState().blocks.FractionSequence.data[3][0]).toBeCloseTo(0)
    expect(() => resizeBlock('Huge', 3, 1)).toThrow(/non-finite/)
    expect(useWorkspaceStore.getState().blocks.Huge.data).toEqual([[1e308], [1.5e308]])
  })

  it('undoes a rectangular paste and its dependent recalculations in one step', () => {
    useWorkspaceStore.getState().editValues('v', 0, 0, [[11], [22], [33]])
    expect(useWorkspaceStore.getState().blocks.KE.data[0][0]).toBe(181.5)
    expect(useWorkspaceStore.temporal.getState().pastStates).toHaveLength(1)
    useWorkspaceStore.temporal.getState().undo()
    expect(useWorkspaceStore.getState().blocks.v.data.slice(0, 3)).toEqual([[10], [20], [30]])
    expect(useWorkspaceStore.getState().blocks.KE.data[0][0]).toBe(150)
    useWorkspaceStore.temporal.getState().redo()
    expect(useWorkspaceStore.getState().blocks.v.data.slice(0, 3)).toEqual([[11], [22], [33]])
  })

  it('clears selected values without treating them as zero and restores them on refill', () => {
    const { clearSelection, editValues } = useWorkspaceStore.getState()
    clearSelection([
      { symbol: 'v', row: 1, col: 0, role: 'value' },
      { symbol: 'v', row: 3, col: 0, role: 'value' },
    ])
    let state = useWorkspaceStore.getState()
    expect(state.blocks.v.data).toEqual([[10], [0], [30], [0], [50]])
    expect(state.blocks.v.emptyCells).toEqual([[1, 0], [3, 0]])
    expect(state.blocks.KE.error).toMatch(/missing values/)
    expect(useWorkspaceStore.temporal.getState().pastStates).toHaveLength(1)
    useWorkspaceStore.temporal.getState().undo()
    expect(useWorkspaceStore.getState().blocks.v.data[1][0]).toBe(20)
    expect(useWorkspaceStore.getState().blocks.KE.error).toBeUndefined()
    useWorkspaceStore.temporal.getState().redo()
    editValues('v', 1, 0, [[22], [33], [44]])
    state = useWorkspaceStore.getState()
    expect(state.blocks.v.emptyCells).toBeUndefined()
    expect(state.blocks.KE.error).toBeUndefined()
    expect(state.blocks.KE.data[1][0]).toBe(726)
  })

  it('deletes formatting on selected values and empty cells in the same undo step', () => {
    const { formatCells, clearSelection } = useWorkspaceStore.getState()
    formatCells([{ x: 2, y: 3, width: 1, height: 1 }, { x: 8, y: 8, width: 1, height: 1 }], { bold: true, fillColor: '#123456', alignment: 'center' }, 'all')
    formatCells([{ x: 2, y: 4, width: 1, height: 1 }], { italic: true })
    useWorkspaceStore.temporal.getState().clear()
    clearSelection([{ symbol: 'v', row: 1, col: 0, role: 'value' }], [{ x: 2, y: 3, width: 1, height: 1 }, { x: 8, y: 8, width: 1, height: 1 }])
    let state = useWorkspaceStore.getState()
    expect(state.cellFormats?.['2,3']).toBeUndefined()
    expect(state.cellFormats?.['8,8']).toBeUndefined()
    expect(state.cellFormats?.['2,4']?.italic).toBe(true)
    expect(state.blocks.v.format.alignment).toBeUndefined()
    expect(state.blocks.v.emptyCells).toEqual([[1, 0]])
    expect(useWorkspaceStore.temporal.getState().pastStates).toHaveLength(1)
    useWorkspaceStore.temporal.getState().undo()
    state = useWorkspaceStore.getState()
    expect(state.cellFormats?.['2,3']?.fillColor).toBe('#123456')
    expect(state.cellFormats?.['8,8']?.bold).toBe(true)
    expect(state.blocks.v.format.alignment).toBe('center')
    expect(state.blocks.v.emptyCells).toBeUndefined()
  })

  it('clears formatting across a deleted variable without clearing its neighbors', () => {
    const { formatCells, clearSelection } = useWorkspaceStore.getState()
    formatCells([{ x: 2, y: 1, width: 1, height: 6 }, { x: 1, y: 2, width: 1, height: 1 }], { fillColor: '#aabbcc' })
    clearSelection([{ symbol: 'v', row: 0, col: 0, role: 'label' }], [{ x: 2, y: 1, width: 1, height: 1 }])
    const formats = useWorkspaceStore.getState().cellFormats!
    for (let row = 1; row <= 6; row += 1) expect(formats[`2,${row}`]).toBeUndefined()
    expect(formats['1,2']?.fillColor).toBe('#aabbcc')
    useWorkspaceStore.temporal.getState().undo()
    expect(useWorkspaceStore.getState().cellFormats?.['2,6']?.fillColor).toBe('#aabbcc')
  })

  it('deletes variables atomically, unbinds plots, and restores everything with undo', () => {
    const plot = useWorkspaceStore.getState().plots[0]
    useWorkspaceStore.getState().updatePlot(plot.id, { series: [{ id: 'extra', ySymbol: 'v', label: '', color: '#123456' }] })
    useWorkspaceStore.temporal.getState().clear()
    useWorkspaceStore.getState().clearSelection([
      { symbol: 'v', row: 0, col: 0, role: 'label' },
      { symbol: 'v', row: 0, col: 0, role: 'value' },
      { symbol: 'Trials', row: 0, col: 0, role: 'value' },
    ])
    let state = useWorkspaceStore.getState()
    expect(state.blocks.v).toBeUndefined()
    expect(state.plots[0].xSymbol).toBe('')
    expect(state.plots[0].series?.[0].ySymbol).toBe('')
    expect(state.blocks.KE.error).toMatch(/Unknown variable: v/)
    expect(state.blocks.Trials.emptyCells).toEqual([[0, 0]])
    expect(useWorkspaceStore.temporal.getState().pastStates).toHaveLength(1)
    useWorkspaceStore.temporal.getState().undo()
    state = useWorkspaceStore.getState()
    expect(state.blocks.v.data[0][0]).toBe(10)
    expect(state.plots[0].xSymbol).toBe('v')
    expect(state.plots[0].series?.[0].ySymbol).toBe('v')
    expect(state.blocks.Trials.emptyCells).toBeUndefined()
    expect(state.blocks.KE.error).toBeUndefined()
    useWorkspaceStore.temporal.getState().redo()
    expect(useWorkspaceStore.getState().blocks.v).toBeUndefined()
  })

  it('turns cleared derived values into root data and preserves blanks through resize and formula changes', () => {
    const { clearSelection, resizeBlock, editValue, setFormula } = useWorkspaceStore.getState()
    clearSelection([{ symbol: 'KE', row: 1, col: 0, role: 'value' }])
    let block = useWorkspaceStore.getState().blocks.KE
    expect(block.mode).toBe('root')
    expect(block.data.map(([value]) => value)).toEqual([150, 0, 1350, 2400, 3750])
    expect(block.emptyCells).toEqual([[1, 0]])
    resizeBlock('KE', 1, 1)
    block = useWorkspaceStore.getState().blocks.KE
    expect(block.emptyCells).toBeUndefined()
    clearSelection([{ symbol: 'KE', row: 0, col: 0, role: 'value' }])
    expect(useWorkspaceStore.getState().blocks.KE.unfilled).toBe(true)
    resizeBlock('KE', 2, 1)
    editValue('KE', 1, 0, 4)
    block = useWorkspaceStore.getState().blocks.KE
    expect(block.unfilled).toBeUndefined()
    expect(block.emptyCells).toEqual([[0, 0]])
    setFormula('KE', 'm * 2')
    expect(useWorkspaceStore.getState().blocks.KE.emptyCells).toBeUndefined()
    expect(useWorkspaceStore.getState().blocks.KE.data).toEqual([[6]])
  })

  it('formats selected cells and moves multiple variables and their formats in one undo step', () => {
    const { formatCells, moveBlocks } = useWorkspaceStore.getState()
    formatCells([{ x: 1, y: 1, width: 2, height: 2 }], { bold: true, textColor: '#123456', fontSize: 16 }, 'outer')
    let formats = useWorkspaceStore.getState().cellFormats!
    expect(formats['1,1'].borders).toEqual({ top: true, left: true, right: false, bottom: false })
    expect(formats['2,2'].borders).toEqual({ top: false, left: false, right: true, bottom: true })
    useWorkspaceStore.temporal.getState().clear()
    moveBlocks(['Trials', 'v'], 12, 4)
    let state = useWorkspaceStore.getState()
    expect(state.blocks.Trials.anchor).toEqual({ row: 13, col: 5 })
    expect(state.blocks.v.anchor).toEqual({ row: 13, col: 6 })
    expect(state.cellFormats?.['5,13'].textColor).toBe('#123456')
    expect(state.cellFormats?.['6,14'].bold).toBe(true)
    expect(state.cellFormats?.['1,1']).toBeUndefined()
    expect(state.blocks.KE.formula).toContain('v')
    expect(state.plots[0].xSymbol).toBe('v')
    expect(useWorkspaceStore.temporal.getState().pastStates).toHaveLength(1)
    useWorkspaceStore.temporal.getState().undo()
    state = useWorkspaceStore.getState()
    expect(state.blocks.v.anchor).toEqual({ row: 1, col: 2 })
    expect(state.cellFormats?.['1,1'].bold).toBe(true)
    expect(() => moveBlocks(['Trials', 'v'], 0, 1)).toThrow(/overlaps/)
    expect(useWorkspaceStore.getState().blocks.Trials.anchor).toEqual({ row: 1, col: 1 })
    useWorkspaceStore.temporal.getState().redo()
    expect(useWorkspaceStore.getState().blocks.v.anchor).toEqual({ row: 13, col: 6 })
    formats = useWorkspaceStore.getState().cellFormats!
    expect(formats['6,14'].fontSize).toBe(16)
  })

  it('keeps formatting with blocks shifted by growth and stores undoable column widths', () => {
    const { formatCells, resizeBlock, setColumnWidth } = useWorkspaceStore.getState()
    formatCells([{ x: 1, y: 8, width: 2, height: 1 }], { fillColor: '#aabbcc' }, 'all')
    resizeBlock('v', 7, 1)
    const state = useWorkspaceStore.getState()
    const row = state.blocks.m.anchor.row
    expect(row).toBe(10)
    expect(state.cellFormats?.[`1,${row}`].fillColor).toBe('#aabbcc')
    expect(state.cellFormats?.[`2,${row}`].borders?.left).toBe(true)
    const historyCount = useWorkspaceStore.temporal.getState().pastStates.length
    setColumnWidth(2, 132)
    expect(useWorkspaceStore.temporal.getState().pastStates).toHaveLength(historyCount)
    setColumnWidth(2, 220)
    expect(useWorkspaceStore.getState().columnWidths?.['2']).toBe(220)
    useWorkspaceStore.temporal.getState().undo()
    expect(useWorkspaceStore.getState().columnWidths?.['2']).toBeUndefined()
    useWorkspaceStore.temporal.getState().redo()
    expect(useWorkspaceStore.getState().columnWidths?.['2']).toBe(220)
  })
})

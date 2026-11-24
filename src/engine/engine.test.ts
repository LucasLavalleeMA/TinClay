import { describe, expect, it } from 'vitest'
import { CompactSelection } from '@glideapps/glide-data-grid'
import { recalculateWorkspace } from './dag'
import { exportCsv, importCsv, parseClipboard } from './ioAdapter'
import { createBlock, createDefaultWorkspace } from './workspace'
import { parseWorkspace } from './storageAdapter'
import { evaluateFormula, getFormulaSymbols, renameFormulaSymbol } from './evaluator'
import { useWorkspaceStore } from '../store/workspaceStore'
import { blockEdges, selectedBlockCells, spatialIndex, visibleCellEdges } from './spatial'
import { columnAt, columnOffsets, nearestColumnEdge, viewportOrigin } from './geometry'
import { getFormulaSuggestions } from '../components/FormulaSuggestions'
import { makePlotFigure } from './plots'

describe('workspace calculations', () => {
  it('lets explicit borders replace default outlines on both sides of a shared edge', () => {
    const index = spatialIndex(createDefaultWorkspace().blocks)
    const none = { top: false, right: false, bottom: false, left: false }
    expect(visibleCellEdges(index, {}, 1, 1)?.right).toBe(true)
    expect(visibleCellEdges(index, { '2,1': { borders: none } }, 1, 1)?.right).toBe(false)
    expect(visibleCellEdges(index, { '2,1': { borders: none } }, 2, 1)).toEqual(none)
    const custom = { ...none, left: true }
    expect(visibleCellEdges(index, { '2,1': { borders: custom, borderColor: '#112233' } }, 2, 1)).toEqual(custom)
    expect(visibleCellEdges(index, { '2,1': { borders: custom } }, 1, 1)?.right).toBe(false)
  })

  it('calculates the default kinetic-energy example', () => {
    const workspace = createDefaultWorkspace()
    expect(workspace.blocks.KE.error).toBeUndefined()
    expect(workspace.blocks.KE.data.map(([value]) => value)).toEqual([150, 600, 1350, 2400, 3750])
  })

  it('marks every member of a dependency cycle', () => {
    const workspace = createDefaultWorkspace()
    workspace.blocks.KE.formula = 'm .* v.^2 + doubled'
    workspace.blocks.doubled = {
      ...workspace.blocks.KE,
      id: 'doubled',
      symbol: 'doubled',
      displayName: 'Doubled',
      formula: 'KE .* 2',
    }

    const result = recalculateWorkspace(workspace.blocks)
    expect(result.KE.error).toBe('Circular dependency detected')
    expect(result.doubled.error).toBe('Circular dependency detected')
  })

  it('imports numeric CSV columns and makes symbols unique', () => {
    const imported = importCsv(
      'Velocity (m/s),Velocity (m/s),Notes\n10,20,fast\n30,40,slow',
      { row: 1, col: 2 },
    )

    expect(imported.map((block) => block.symbol)).toEqual(['Velocity', 'Velocity_2'])
    expect(imported[0].format.unit).toBe('m/s')
    expect(imported[1].anchor).toEqual({ row: 1, col: 3 })
    expect(imported[0].data).toEqual([[10], [30]])
  })

  it('rejects clipboard content that includes non-numeric cells', () => {
    expect(parseClipboard('1\t2\n3\t4')).toEqual([[1, 2], [3, 4]])
    expect(parseClipboard('1\tname')).toBeUndefined()
    expect(parseClipboard('1\t\n3\t4')).toBeUndefined()
  })

  it('round-trips floating plots and accepts workspaces saved before plots existed', () => {
    const workspace = createDefaultWorkspace()
    expect(parseWorkspace(JSON.stringify(workspace)).plots).toEqual(workspace.plots)
    const old = { blocks: workspace.blocks, activeFormulaSymbol: workspace.activeFormulaSymbol }
    expect(parseWorkspace(JSON.stringify(old)).plots).toEqual([])
    expect(() => parseWorkspace(JSON.stringify({ ...old, plots: [{ id: 'bad' }] }))).toThrow(/invalid plot/)
  })

  it('builds supported plot types from variables and validates incompatible inputs', () => {
    const workspace = createDefaultWorkspace()
    const plot = workspace.plots[0]
    for (const type of ['line', 'scatter', 'bar', 'histogram', 'box', 'area', 'heatmap', 'contour', 'surface'] as const) {
      plot.settings = { type }
      const figure = makePlotFigure(plot, workspace.blocks, false)
      expect(figure.data).toHaveLength(1)
      expect(figure.data[0].type).toBe(type === 'line' || type === 'area' ? 'scatter' : type)
    }
    plot.settings = { type: 'histogram', histogramBins: 4, histogramNorm: 'probability' }
    expect(makePlotFigure(plot, workspace.blocks, false).data[0]).toMatchObject({ x: [150, 600, 1350, 2400, 3750], nbinsx: 4, histnorm: 'probability' })
    plot.settings.histogramBinWidth = 100
    expect(makePlotFigure(plot, workspace.blocks, false).data[0]).toMatchObject({ xbins: { size: 100 } })
    plot.settings = { type: 'bar', barOrientation: 'h' }
    expect(makePlotFigure(plot, workspace.blocks, false).data[0]).toMatchObject({ x: [150, 600, 1350, 2400, 3750], y: [10, 20, 30, 40, 50], orientation: 'h' })
    plot.settings = { type: 'line', xScale: 'log', xMin: 1, xMax: 100, xReverse: true }
    expect(makePlotFigure(plot, workspace.blocks, false).layout.xaxis?.range).toEqual([2, 0])
    plot.settings.xMin = 0
    expect(() => makePlotFigure(plot, workspace.blocks, false)).toThrow(/logarithmic limits/)
    plot.settings = { type: 'line' }
    plot.xSymbol = 'm'
    expect(() => makePlotFigure(plot, workspace.blocks, false)).toThrow(/same number/)
    plot.xSymbol = ''
    expect(makePlotFigure(plot, workspace.blocks, false).data[0]).toMatchObject({ x: [1, 2, 3, 4, 5] })
    workspace.blocks.KE.data[0][0] = 0
    plot.settings = { type: 'line', yScale: 'log' }
    expect(() => makePlotFigure(plot, workspace.blocks, false)).toThrow(/Y data must be positive/)
    plot.settings = { type: 'heatmap' }
    expect(makePlotFigure(plot, workspace.blocks, false).data[0]).toMatchObject({ x: [1], y: [1, 2, 3, 4, 5] })
    plot.settings = { type: 'heatmap', colorMin: 5, colorMax: 1 }
    expect(() => makePlotFigure(plot, workspace.blocks, false)).toThrow(/Color limits/)
  })

  it('persists plot settings and series and rejects invalid settings', () => {
    const workspace = createDefaultWorkspace()
    workspace.plots[0].settings = { type: 'bar', opacity: .4, background: '#112233' }
    workspace.plots[0].series = [{ id: 's1', ySymbol: 'Trials', label: 'Trial', color: '#123456' }]
    const loaded = parseWorkspace(JSON.stringify(workspace))
    expect(loaded.plots[0]).toEqual(workspace.plots[0])
    expect(makePlotFigure(loaded.plots[0], loaded.blocks, false).data).toHaveLength(2)
    workspace.plots[0].settings = { opacity: 3 }
    expect(() => parseWorkspace(JSON.stringify(workspace))).toThrow(/plot settings/)
    workspace.plots[0].settings = {}
    workspace.plots[0].series?.push({ id: 's1', ySymbol: 'v', label: '', color: '#123456' })
    expect(() => parseWorkspace(JSON.stringify(workspace))).toThrow(/plot series/)
  })

  it('round-trips cell formatting and column widths and rejects malformed settings', () => {
    const workspace = createDefaultWorkspace()
    workspace.blocks.v.format.alignment = 'center'
    workspace.cellFormats = { '2,3': { alignment: 'center', textColor: '#aabbcc', bold: true, fontSize: 20, borderStyle: 'dashed', borders: { top: true, right: false, bottom: true, left: false } } }
    workspace.columnWidths = { '2': 240 }
    const loaded = parseWorkspace(JSON.stringify(workspace))
    expect(loaded.blocks.v.format.alignment).toBe('center')
    expect(loaded.cellFormats).toEqual(workspace.cellFormats)
    expect(loaded.columnWidths).toEqual({ '2': 240 })
    workspace.columnWidths = { '2': -1 }
    expect(() => parseWorkspace(JSON.stringify(workspace))).toThrow(/column widths/)
    workspace.columnWidths = {}
    workspace.cellFormats = { '2,3': { fontSize: 100 } }
    expect(() => parseWorkspace(JSON.stringify(workspace))).toThrow(/cell formatting/)
    workspace.cellFormats = {}
    Object.assign(workspace.blocks.v.format, { alignment: 'diagonal' })
    expect(() => parseWorkspace(JSON.stringify(workspace))).toThrow(/variable alignment/)
  })

  it('locates columns and snap edges with unequal column widths', () => {
    const offsets = columnOffsets([100, 200, 80])
    expect(offsets).toEqual([0, 100, 300, 380])
    expect(columnAt(offsets, 299)).toBe(1)
    expect(columnAt(offsets, 300)).toBe(2)
    expect(nearestColumnEdge(offsets, 190)).toBe(1)
    expect(nearestColumnEdge(offsets, 210)).toBe(2)
  })

  it('locates the grid origin from the visible region and fractional translations', () => {
    const offsets = columnOffsets([100, 200, 80])
    expect(viewportOrigin(offsets, 1, 4, -23.5, -12.25, 34)).toEqual({ x: -75.5, y: -112.25 })
    expect(viewportOrigin(columnOffsets([150, 200, 80]), 1, 4, -23.5, -12.25, 34)).toEqual({ x: -125.5, y: -112.25 })
    expect(viewportOrigin(offsets, 0, 0, 0, 0, 34)).toEqual({ x: 48, y: 36 })
  })

  it('suggests supported function names at the caret without suggesting short symbols', () => {
    expect(getFormulaSuggestions('Result = me', 11, true)?.matches).toContain('MEAN')
    expect(getFormulaSuggestions('=std', 4, true)?.matches).toContain('STDDEV')
    expect(getFormulaSuggestions('=tr', 3, true)?.matches).toContain('TRIM')
    expect(getFormulaSuggestions('=m', 2, true)).toBeUndefined()
    expect(getFormulaSuggestions('Mean', 4, false)).toBeUndefined()
    expect(getFormulaSuggestions('=MEAN(v) + st', 13, true)?.matches).toContain('STDEV')
  })

  it('preserves unfilled variables when saving and does not export their placeholder zeros', () => {
    const workspace = createDefaultWorkspace()
    workspace.blocks.Pending = createBlock({
      displayName: 'Pending', symbol: 'Pending', mode: 'root', unfilled: true,
      anchor: { row: 20, col: 0 }, data: [[0], [0]],
    })
    const loaded = parseWorkspace(JSON.stringify(workspace))
    expect(loaded.blocks.Pending.unfilled).toBe(true)
    expect(exportCsv([loaded.blocks.Pending])).not.toContain('0')
  })

  it('round-trips individually cleared cells and exports blanks rather than placeholder zeros', () => {
    const workspace = createDefaultWorkspace()
    workspace.blocks.v.data[1][0] = 0
    workspace.blocks.v.emptyCells = [[1, 0]]
    const loaded = parseWorkspace(JSON.stringify(workspace))
    expect(loaded.blocks.v.emptyCells).toEqual([[1, 0]])
    const csv = exportCsv([loaded.blocks.v])
    expect(csv.replace(/\r/g, '')).toBe('Velocity\n10\n""\n30\n40\n50')
    const imported = importCsv(csv, { row: 0, col: 0 })[0]
    expect(imported.data).toEqual([[10], [0], [30], [40], [50]])
    expect(imported.emptyCells).toEqual([[1, 0]])
    const lastBlank = importCsv('Speed\n1\n""', { row: 0, col: 0 })[0]
    expect(lastBlank.emptyCells).toEqual([[1, 0]])
    const allBlank = importCsv('Speed\n""\n""', { row: 0, col: 0 })[0]
    expect(allBlank.unfilled).toBe(true)
    expect(allBlank.data).toHaveLength(2)
    expect(importCsv('Speed\n1\n', { row: 0, col: 0 })[0].data).toEqual([[1]])
    workspace.blocks.v.emptyCells = [[99, 0]]
    expect(() => parseWorkspace(JSON.stringify(workspace))).toThrow(/invalid empty cells/)
  })

  it('selects block headers and values from ranges, stacked ranges, rows and columns', () => {
    const index = spatialIndex(createDefaultWorkspace().blocks)
    const cells = selectedBlockCells(index, {
      current: { cell: [2, 2], range: { x: 2, y: 2, width: 1, height: 2 }, rangeStack: [{ x: 1, y: 1, width: 1, height: 1 }] },
      rows: CompactSelection.fromSingleSelection(6),
      columns: CompactSelection.fromSingleSelection(3),
    })
    expect(cells).toContainEqual({ symbol: 'Trials', row: 0, col: 0, role: 'label' })
    expect(cells).toContainEqual({ symbol: 'v', row: 1, col: 0, role: 'value' })
    expect(cells).toContainEqual({ symbol: 'Trials', row: 4, col: 0, role: 'value' })
    expect(cells).toContainEqual({ symbol: 'KE', row: 0, col: 0, role: 'label' })
    expect(cells.every((cell) => cell.role !== 'ghost')).toBe(true)
  })

  it('outlines variable cells without joining neighbors or ghost cells', () => {
    const matrix = createBlock({ displayName: 'Matrix', symbol: 'Matrix', mode: 'root', anchor: { row: 0, col: 0 }, data: [[1, 2], [3, 4]] })
    const vector = createBlock({ displayName: 'Vector', symbol: 'Vector', mode: 'root', anchor: { row: 0, col: 2 }, data: [[5], [6]] })
    const index = spatialIndex({ Matrix: matrix, Vector: vector })
    expect(blockEdges(index, 0, 0)).toEqual({ top: true, right: true, bottom: false, left: true })
    expect(blockEdges(index, 0, 1)).toEqual({ top: false, right: false, bottom: false, left: true })
    expect(blockEdges(index, 1, 1)).toEqual({ top: true, right: true, bottom: false, left: false })
    expect(blockEdges(index, 2, 2)).toEqual({ top: false, right: true, bottom: true, left: true })
    expect(blockEdges(index, 2, 3)).toBeUndefined()
  })

  it('aggregates scalars, vectors, matrices and nested calls, regardless of function case', () => {
    const blocks = createDefaultWorkspace().blocks
    expect(evaluateFormula('average(v, m, [1, 2; 3, 4])', blocks).data).toEqual([[16.3]])
    expect(evaluateFormula('MeAn(v, Trials)', blocks).data).toEqual([[16.5]])
    expect(evaluateFormula('SUM(v, m, MAX(Trials))', blocks).data).toEqual([[158]])
    expect(evaluateFormula('COUNT(v, m, [1, 2; 3, 4])', blocks).data).toEqual([[10]])
    expect(evaluateFormula('MEDIAN([1, 4; 2, 3])', blocks).data).toEqual([[2.5]])
    expect(evaluateFormula('PRODUCT(2, 3, 4)', blocks).data).toEqual([[24]])
    expect(evaluateFormula('MATMEAN([1, 2; 3, 4], 1)', blocks).data).toEqual([[2], [3]])
    expect(evaluateFormula('MATSUM([1, 2; 3, 4], 2)', blocks).data).toEqual([[3], [7]])
  })

  it('uses sample and population statistics and reports insufficient data', () => {
    const blocks = createDefaultWorkspace().blocks
    const values = '[2, 4, 4, 4, 5, 5, 7, 9]'
    for (const name of ['STDEV', 'STDDEV', 'STDEV.S', 'STDDEV.S']) {
      expect(evaluateFormula(`${name}(${values})`, blocks).data[0][0]).toBeCloseTo(Math.sqrt(32 / 7))
    }
    for (const name of ['STDEVP', 'STDDEVP', 'STDEV.P', 'STDDEV.P']) {
      expect(evaluateFormula(`${name}(${values})`, blocks).data).toEqual([[2]])
    }
    expect(evaluateFormula(`VAR.S(${values})`, blocks).data[0][0]).toBeCloseTo(32 / 7)
    expect(evaluateFormula(`VAR.P(${values})`, blocks).data).toEqual([[4]])
    expect(() => evaluateFormula('STDDEV(m)', blocks)).toThrow(/at least 2/)
    expect(evaluateFormula('STDEV.P(m)', blocks).data).toEqual([[0]])
    expect(() => evaluateFormula('AVERAGE()', blocks)).toThrow(/at least one/)
  })

  it('evaluates common spreadsheet math and rounds positive and negative decimal places', () => {
    const blocks = createDefaultWorkspace().blocks
    expect(evaluateFormula('ABS(-3) + SQRT(9) + POWER(2, 3) + MOD(-3, 2)', blocks).data).toEqual([[15]])
    expect(evaluateFormula('ROUND(1234.56, -2)', blocks).data).toEqual([[1200]])
    expect(evaluateFormula('ROUND(-1.005, 2)', blocks).data).toEqual([[-1.01]])
    expect(evaluateFormula('ROUNDUP(-1.21, 1)', blocks).data).toEqual([[-1.3]])
    expect(evaluateFormula('ROUNDDOWN(-1.29, 1)', blocks).data).toEqual([[-1.2]])
    expect(evaluateFormula('SUM(ROUND([1.23, 2.67], 1))', blocks).data[0][0]).toBeCloseTo(3.9)
    expect(evaluateFormula('PI()', blocks).data[0][0]).toBe(Math.PI)
  })

  it('trims vectors and matrix rows using inclusive one-based indices', () => {
    const blocks = createDefaultWorkspace().blocks
    expect(evaluateFormula('trim(v, 2, 4)', blocks).data).toEqual([[20], [30], [40]])
    expect(evaluateFormula('TRIM(v, 1, 5)', blocks).data).toEqual([[10], [20], [30], [40], [50]])
    expect(evaluateFormula('TRIM(v, 5, 5)', blocks).data).toEqual([[50]])
    expect(evaluateFormula('TRIM([v], 2, 4)', blocks).data).toEqual([[20, 30, 40]])
    expect(evaluateFormula('TRIM([1, 2; 3, 4; 5, 6], 2, 3)', blocks).data).toEqual([[3, 4], [5, 6]])
    expect(evaluateFormula('TRIM([1, 2; 3, 4], 2, 2)', blocks).data).toEqual([[3, 4]])
    expect(evaluateFormula('TRIM(m, 1, 1)', blocks).data).toEqual([[3]])
    expect(evaluateFormula('MEAN(TRIM(v, 2, 4))', blocks).data).toEqual([[30]])
  })

  it('rejects invalid TRIM arguments and indices', () => {
    const blocks = createDefaultWorkspace().blocks
    for (const formula of ['TRIM(v, 0, 1)', 'TRIM(v, -1, 1)', 'TRIM(v, 2.5, 3)', 'TRIM(v, 4, 3)']) {
      expect(() => evaluateFormula(formula, blocks)).toThrow(/indices must be positive integers/)
    }
    for (const formula of ['TRIM(v, 1, 6)', 'TRIM(m, 1, 2)', 'TRIM([1, 2; 3, 4], 1, 3)']) {
      expect(() => evaluateFormula(formula, blocks)).toThrow(/indices exceed/)
    }
    expect(() => evaluateFormula('TRIM(v, 1)', blocks)).toThrow(/requires data/)
    expect(() => evaluateFormula('TRIM("text", 1, 1)', blocks)).toThrow(/numeric data/)
  })

  it('updates trimmed results when the data or index dependencies change', () => {
    const workspace = createDefaultWorkspace()
    workspace.blocks.Start = createBlock({ displayName: 'Start', symbol: 'Start', mode: 'root', anchor: { row: 20, col: 0 }, data: [[2]] })
    workspace.blocks.Result = createBlock({ displayName: 'Result', symbol: 'Result', mode: 'derived', formula: 'TRIM(v, Start, 4)', anchor: { row: 20, col: 4 } })
    expect(getFormulaSymbols('TRIM(v, Start, 4)')).toEqual(['v', 'Start'])
    useWorkspaceStore.getState().replaceWorkspace(workspace)
    expect(useWorkspaceStore.getState().blocks.Result.data).toEqual([[20], [30], [40]])
    useWorkspaceStore.getState().editValue('v', 1, 0, 25)
    expect(useWorkspaceStore.getState().blocks.Result.data).toEqual([[25], [30], [40]])
    useWorkspaceStore.getState().editValue('Start', 0, 0, 3)
    expect(useWorkspaceStore.getState().blocks.Result.data).toEqual([[30], [40]])
    useWorkspaceStore.getState().editValue('Start', 0, 0, 5)
    expect(useWorkspaceStore.getState().blocks.Result.error).toMatch(/indices/)
  })

  it('tracks aggregate dependencies and preserves function names when variables are renamed', () => {
    const workspace = createDefaultWorkspace()
    workspace.blocks.MEAN = createBlock({ displayName: 'MEAN', symbol: 'MEAN', mode: 'root', anchor: { row: 20, col: 0 }, data: [[5]] })
    workspace.blocks.Result = createBlock({ displayName: 'Result', symbol: 'Result', mode: 'derived', formula: 'MEAN(MEAN, v)', anchor: { row: 20, col: 4 } })
    expect(getFormulaSymbols('MEAN(MEAN, v)')).toEqual(['MEAN', 'v'])
    expect(renameFormulaSymbol('MEAN(MEAN, v)', 'MEAN', 'Input')).toBe('MEAN(Input, v)')
    expect(renameFormulaSymbol('STDEV.S(v)', 'STDEV', 'Input')).toBe('STDEV.S(v)')
    useWorkspaceStore.getState().replaceWorkspace(workspace)
    expect(useWorkspaceStore.getState().blocks.Result.data[0][0]).toBeCloseTo(155 / 6)
    useWorkspaceStore.getState().editValue('v', 0, 0, 20)
    expect(useWorkspaceStore.getState().blocks.Result.data[0][0]).toBeCloseTo(165 / 6)
    useWorkspaceStore.getState().renameBlock('MEAN', 'Input', 'Input', '')
    expect(useWorkspaceStore.getState().blocks.Result.formula).toBe('MEAN(Input, v)')
    expect(useWorkspaceStore.getState().blocks.Result.error).toBeUndefined()
  })
})

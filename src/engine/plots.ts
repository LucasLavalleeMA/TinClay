import type { Data, Layout } from 'plotly.js'
import type { PlotBlock, PlotSettings, VariableBlock } from '../types/workspace'
import { hasMissingValues } from './missingValues'

export const DEFAULT_PLOT_SETTINGS: PlotSettings = {
  type: 'line', xLabel: '', yLabel: '', zLabel: '', showTitle: false, showLegend: false, showGrid: true,
  gridColor: '', tickFontSize: 11, xTickAngle: 0, yTickAngle: 0,
  xScale: 'linear', yScale: 'linear', zScale: 'linear', xReverse: false, yReverse: false, zReverse: false,
  lineColor: '#b4807e', lineWidth: 2, lineDash: 'solid', lineShape: 'linear',
  markerSymbol: 'circle', markerSize: 7, markerLineColor: '#b4807e', markerLineWidth: 0, showMarkers: true, opacity: 1,
  histogramBins: 0, histogramNorm: '', barOrientation: 'v', barMode: 'group', barGap: .2,
  colorScale: 'Viridis', showColorScale: true, fontSize: 11,
  background: '', transparentBackground: false,
}

export function plotSettings(plot: PlotBlock): PlotSettings {
  return { ...DEFAULT_PLOT_SETTINGS, ...plot.settings }
}

export function isMatrixPlot(type: PlotSettings['type']): boolean {
  return type === 'heatmap' || type === 'contour' || type === 'surface'
}

export function validatePlotSettings(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const settings = value as Record<string, unknown>
  const options: Record<string, readonly unknown[]> = {
    type: ['line', 'scatter', 'bar', 'histogram', 'box', 'area', 'heatmap', 'contour', 'surface'],
    xScale: ['linear', 'log'], yScale: ['linear', 'log'], zScale: ['linear', 'log'],
    lineDash: ['solid', 'dash', 'dot', 'dashdot'], lineShape: ['linear', 'spline', 'hv', 'vh'],
    markerSymbol: ['circle', 'square', 'diamond', 'cross', 'x', 'triangle-up'],
    histogramNorm: ['', 'percent', 'probability', 'density', 'probability density'],
    barOrientation: ['v', 'h'], barMode: ['group', 'stack', 'overlay'],
    colorScale: ['Viridis', 'Cividis', 'Jet', 'Hot', 'Blues', 'RdBu'],
  }
  const numbers: Record<string, [number, number, boolean]> = {
    lineWidth: [0, 20, false], markerSize: [1, 50, false], opacity: [0, 1, false],
    markerLineWidth: [0, 10, false], barGap: [0, 1, false],
    histogramBins: [0, 1000, true], fontSize: [8, 36, true],
    histogramBinWidth: [Number.MIN_VALUE, Number.MAX_VALUE, false],
    tickFontSize: [8, 36, true], xTickAngle: [-90, 90, false], yTickAngle: [-90, 90, false],
    xMin: [-Number.MAX_VALUE, Number.MAX_VALUE, false], xMax: [-Number.MAX_VALUE, Number.MAX_VALUE, false],
    yMin: [-Number.MAX_VALUE, Number.MAX_VALUE, false], yMax: [-Number.MAX_VALUE, Number.MAX_VALUE, false],
    zMin: [-Number.MAX_VALUE, Number.MAX_VALUE, false], zMax: [-Number.MAX_VALUE, Number.MAX_VALUE, false],
    colorMin: [-Number.MAX_VALUE, Number.MAX_VALUE, false], colorMax: [-Number.MAX_VALUE, Number.MAX_VALUE, false],
  }
  const booleans = ['showTitle', 'showLegend', 'showGrid', 'xReverse', 'yReverse', 'zReverse', 'showMarkers', 'showColorScale', 'transparentBackground']
  return Object.entries(settings).every(([key, item]) => {
    if (options[key]) return options[key].includes(item)
    if (numbers[key]) {
      const [min, max, integer] = numbers[key]
      return typeof item === 'number' && Number.isFinite(item) && item >= min && item <= max && (!integer || Number.isInteger(item))
    }
    if (booleans.includes(key)) return typeof item === 'boolean'
    if (key === 'xLabel' || key === 'yLabel' || key === 'zLabel') return typeof item === 'string'
    if (['lineColor', 'background', 'gridColor', 'markerLineColor'].includes(key)) return typeof item === 'string' && (['background', 'gridColor'].includes(key) && item === '' || /^#[\da-f]{6}$/i.test(item))
    return false
  })
}

function axisRange(min: number | undefined, max: number | undefined, scale: 'linear' | 'log', reverse: boolean): [number, number] | undefined {
  if (min === undefined && max === undefined) return undefined
  if (min === undefined || max === undefined || min >= max || scale === 'log' && min <= 0) {
    throw new Error('Axis limits require a minimum below the maximum; logarithmic limits must be positive.')
  }
  const bounds: [number, number] = scale === 'log' ? [Math.log10(min), Math.log10(max)] : [min, max]
  return reverse ? [bounds[1], bounds[0]] : bounds
}

export function makePlotFigure(plot: PlotBlock, blocks: Record<string, VariableBlock>, dark: boolean): { data: Data[]; layout: Partial<Layout> } {
  const s = plotSettings(plot)
  const matrix = isMatrixPlot(s.type)
  if (matrix && (s.colorMin !== undefined || s.colorMax !== undefined) &&
      (s.colorMin === undefined || s.colorMax === undefined || s.colorMin >= s.colorMax)) throw new Error('Color limits require a minimum below the maximum.')
  const series = [{ ySymbol: plot.ySymbol, label: plot.ySymbol, color: s.lineColor }, ...(matrix ? [] : plot.series ?? [])]
  const x = blocks[plot.xSymbol]
  const usesX = !matrix && s.type !== 'histogram' && s.type !== 'box'
  const checkScale = (values: number[], scale: 'linear' | 'log', axis: string) => {
    if (scale === 'log' && values.some((value) => value <= 0)) throw new Error(`${axis} data must be positive for a logarithmic axis.`)
  }
  if (usesX && plot.xSymbol && !x) throw new Error(`X variable "${plot.xSymbol}" is missing.`)
  if (usesX && x?.error) throw new Error(`X variable ${plot.xSymbol}: ${x.error}`)
  if (usesX && x && hasMissingValues(x)) throw new Error(`Add values to ${plot.xSymbol} before plotting.`)
  const data: Data[] = series.map((entry) => {
    const y = blocks[entry.ySymbol]
    if (!y) throw new Error(entry.ySymbol ? `Variable "${entry.ySymbol}" is missing.` : 'Choose a Y variable to plot.')
    if (y.error) throw new Error(`Variable ${entry.ySymbol}: ${y.error}`)
    if (hasMissingValues(y)) throw new Error(`Add values to ${entry.ySymbol} before plotting.`)
    const values = y.data.flat()
    const name = entry.label || entry.ySymbol
    const marker = { color: entry.color, size: s.markerSize, symbol: s.markerSymbol, line: { color: s.markerLineColor, width: s.markerLineWidth } }
    const line = { color: entry.color, width: s.lineWidth, dash: s.lineDash, shape: s.lineShape }
    if (matrix) {
      if (s.type === 'surface') checkScale(values, s.zScale, 'Z')
      return { type: s.type === 'heatmap' ? 'heatmap' : s.type === 'contour' ? 'contour' : 'surface', z: y.data, x: (y.data[0] ?? []).map((_, index) => index + 1), y: y.data.map((_, index) => index + 1), colorscale: s.colorScale, showscale: s.showColorScale, opacity: s.opacity, ...(s.colorMin !== undefined && s.colorMax !== undefined ? { zmin: s.colorMin, zmax: s.colorMax } : {}) }
    }
    if (s.type === 'histogram') {
      checkScale(values, s.xScale, 'X')
      return { type: 'histogram', x: values, name, marker: { color: entry.color }, opacity: s.opacity, ...(s.histogramBinWidth ? { xbins: { size: s.histogramBinWidth } } : { nbinsx: s.histogramBins || undefined }), histnorm: s.histogramNorm }
    }
    if (s.type === 'box') {
      checkScale(values, s.yScale, 'Y')
      return { type: 'box', y: values, name, marker: { color: entry.color }, line: { color: entry.color, width: s.lineWidth }, opacity: s.opacity }
    }
    const xValues = x?.data.flat() ?? values.map((_, index) => index + 1)
    if (xValues.length !== values.length) throw new Error(`X and ${entry.ySymbol} must have the same number of values.`)
    const horizontal = s.type === 'bar' && s.barOrientation === 'h'
    checkScale(horizontal ? values : xValues, s.xScale, 'X')
    checkScale(horizontal ? xValues : values, s.yScale, 'Y')
    if (s.type === 'bar') return s.barOrientation === 'h'
      ? { type: 'bar', x: values, y: xValues, name, marker: { color: entry.color }, opacity: s.opacity, orientation: 'h' }
      : { type: 'bar', x: xValues, y: values, name, marker: { color: entry.color }, opacity: s.opacity }
    return { type: 'scatter', x: xValues, y: values, name, mode: s.type === 'scatter' ? 'markers' : s.showMarkers ? 'lines+markers' : 'lines', marker, line, opacity: s.opacity, ...(s.type === 'area' ? { fill: 'tozeroy' as const } : {}) }
  })
  const xRange = axisRange(s.xMin, s.xMax, s.xScale, s.xReverse)
  const yRange = axisRange(s.yMin, s.yMax, s.yScale, s.yReverse)
  const zRange = s.type === 'surface' ? axisRange(s.zMin, s.zMax, s.zScale, s.zReverse) : undefined
  const horizontal = s.type === 'bar' && s.barOrientation === 'h'
  const xLabel = s.xLabel || (matrix ? 'Column' : s.type === 'histogram' || horizontal ? plot.ySymbol : plot.xSymbol || 'Index')
  const yLabel = s.yLabel || (matrix ? 'Row' : s.type === 'histogram' ? s.histogramNorm || 'Count' : horizontal ? plot.xSymbol || 'Index' : plot.ySymbol)
  const axis = (title: string, scale: 'linear' | 'log', range: [number, number] | undefined, reverse: boolean, angle = 0) => ({
    title: { text: title }, type: scale, showgrid: s.showGrid, automargin: true,
    tickfont: { size: s.tickFontSize }, tickangle: angle, ...(s.gridColor ? { gridcolor: s.gridColor } : {}),
    ...(range ? { range } : { autorange: reverse ? 'reversed' as const : true as const }),
  })
  const background = s.transparentBackground ? 'rgba(0,0,0,0)' : s.background || (dark ? '#2b2b2f' : '#ffffff')
  return {
    data,
    layout: {
      autosize: true, margin: { l: 50, r: 12, t: s.showTitle ? 40 : 12, b: 42 },
      title: { text: s.showTitle ? plot.title : '' }, paper_bgcolor: background, plot_bgcolor: background,
      font: { family: 'Segoe UI, sans-serif', size: s.fontSize, color: dark ? '#e5dada' : '#705b5c' },
      xaxis: axis(xLabel, s.xScale, xRange, s.xReverse, s.xTickAngle), yaxis: axis(yLabel, s.yScale, yRange, s.yReverse, s.yTickAngle),
      ...(s.type === 'surface' ? { scene: { xaxis: axis(xLabel, s.xScale, xRange, s.xReverse, s.xTickAngle), yaxis: axis(yLabel, s.yScale, yRange, s.yReverse, s.yTickAngle), zaxis: axis(s.zLabel || plot.ySymbol, s.zScale, zRange, s.zReverse) } } : {}),
      showlegend: s.showLegend, barmode: s.barMode, bargap: s.barGap,
      uirevision: `${plot.id}:${s.type}:${s.xScale}:${s.yScale}:${s.zScale}:${s.xMin}:${s.xMax}:${s.yMin}:${s.yMax}:${s.zMin}:${s.zMax}:${s.xReverse}:${s.yReverse}:${s.zReverse}`,
    },
  }
}

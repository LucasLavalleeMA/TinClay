export type TensorShape =
  | { type: 'scalar' }
  | { type: 'vector'; length: number; orientation: 'col' | 'row' }
  | { type: 'matrix'; rows: number; cols: number }

export interface NumberFormatConfig {
  style: 'general' | 'number' | 'percent' | 'scientific'
  decimals: number
  alignDecimal: boolean
  unit?: string
  alignment?: 'left' | 'center' | 'right'
}

export interface VariableBlock {
  id: string
  displayName: string
  symbol: string
  mode: 'root' | 'derived'
  formula: string
  anchor: { row: number; col: number }
  labelPlacement: 'above' | 'left' | 'none'
  shape: TensorShape
  data: number[][]
  unfilled?: boolean
  emptyCells?: Array<[row: number, col: number]>
  format: NumberFormatConfig
  error?: string
}

export interface PlotBlock {
  id: string
  title: string
  xSymbol: string
  ySymbol: string
  anchor: { row: number; col: number }
  span: { rows: number; cols: number }
  settings?: Partial<PlotSettings>
  series?: PlotSeries[]
}

export interface PlotSeries {
  id: string
  ySymbol: string
  label: string
  color: string
}

export interface PlotSettings {
  type: 'line' | 'scatter' | 'bar' | 'histogram' | 'box' | 'area' | 'heatmap' | 'contour' | 'surface'
  xLabel: string
  yLabel: string
  zLabel: string
  showTitle: boolean
  showLegend: boolean
  showGrid: boolean
  gridColor: string
  tickFontSize: number
  xTickAngle: number
  yTickAngle: number
  xScale: 'linear' | 'log'
  yScale: 'linear' | 'log'
  zScale: 'linear' | 'log'
  xReverse: boolean
  yReverse: boolean
  zReverse: boolean
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  zMin?: number
  zMax?: number
  lineColor: string
  lineWidth: number
  lineDash: 'solid' | 'dash' | 'dot' | 'dashdot'
  lineShape: 'linear' | 'spline' | 'hv' | 'vh'
  markerSymbol: 'circle' | 'square' | 'diamond' | 'cross' | 'x' | 'triangle-up'
  markerSize: number
  markerLineColor: string
  markerLineWidth: number
  showMarkers: boolean
  opacity: number
  histogramBins: number
  histogramBinWidth?: number
  histogramNorm: '' | 'percent' | 'probability' | 'density' | 'probability density'
  barOrientation: 'v' | 'h'
  barMode: 'group' | 'stack' | 'overlay'
  barGap: number
  colorScale: 'Viridis' | 'Cividis' | 'Jet' | 'Hot' | 'Blues' | 'RdBu'
  showColorScale: boolean
  colorMin?: number
  colorMax?: number
  fontSize: number
  background: string
  transparentBackground: boolean
}

export interface CellFormat {
  alignment?: 'left' | 'center' | 'right'
  textColor?: string
  fillColor?: string
  fontSize?: number
  bold?: boolean
  italic?: boolean
  underline?: boolean
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'double'
  borderColor?: string
  borders?: { top: boolean; right: boolean; bottom: boolean; left: boolean }
}

export interface GridRange {
  x: number
  y: number
  width: number
  height: number
}

export interface Workspace {
  blocks: Record<string, VariableBlock>
  activeFormulaSymbol: string
  plots: PlotBlock[]
  cellFormats?: Record<string, CellFormat>
  columnWidths?: Record<string, number>
}

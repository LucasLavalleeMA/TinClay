import { useState } from 'react'
import type { PlotBlock, PlotSeries, PlotSettings, VariableBlock } from '../types/workspace'
import { isMatrixPlot, plotSettings } from '../engine/plots'

interface Props {
  plot: PlotBlock
  blocks: Record<string, VariableBlock>
  onChange: (id: string, patch: Partial<Omit<PlotBlock, 'id'>>) => void
  onClose: () => void
  side: 'left' | 'right'
}

function NumberField({ label, value, min, max, step, optional, onChange }: {
  label: string; value?: number; min?: number; max?: number; step: number | 'any'
  optional?: boolean
  onChange: (value: number | undefined) => void
}) {
  const [edit, setEdit] = useState<{ source: number | undefined; text: string; error: boolean }>()
  const active = edit?.source === value ? edit : undefined
  const draft = active?.text ?? (value === undefined ? '' : String(value))
  return <label>{label}<input type="number" aria-label={label} min={min} max={max} step={step} value={draft} onChange={(event) => setEdit({ source: value, text: event.target.value, error: false })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} onBlur={(event) => {
    if (!draft && (optional || min === undefined && max === undefined)) { setEdit(undefined); onChange(undefined); return }
    if (!draft || !event.currentTarget.validity.valid || !Number.isFinite(Number(draft))) { setEdit({ source: value, text: draft, error: true }); return }
    setEdit(undefined)
    onChange(Number(draft))
  }} />{active?.error && <span className="plot-field-error" role="alert">Enter a valid number.</span>}</label>
}

export function PlotSettingsPanel({ plot, blocks, onChange, onClose, side }: Props) {
  const s = plotSettings(plot)
  const matrix = isMatrixPlot(s.type)
  const symbols = Object.keys(blocks)
  const set = (patch: Partial<PlotSettings>) => onChange(plot.id, { settings: { ...s, ...patch } })
  const setSeries = (series: PlotSeries[]) => onChange(plot.id, { series })
  const series = plot.series ?? []
  const replaceSeries = (id: string, patch: Partial<PlotSeries>) => setSeries(series.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))
  return (
    <aside className={`plot-settings plot-settings-${side}`} aria-label="Plot settings" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
      <header><strong>Plot settings</strong><button type="button" aria-label="Close plot settings" onClick={onClose}>×</button></header>
      <div className="plot-settings-content">
        <fieldset><legend>Chart and data</legend>
          <label>Chart type<select aria-label="Chart type" value={s.type} onChange={(event) => set({ type: event.target.value as PlotSettings['type'] })}>
            <option value="line">Line</option><option value="scatter">Scatter</option><option value="bar">Bar</option><option value="histogram">Histogram</option><option value="box">Box plot</option><option value="area">Area</option><option value="heatmap">Heatmap</option><option value="contour">Contour</option><option value="surface">3D surface</option>
          </select></label>
          <label>Title<input aria-label="Plot title" value={plot.title} onChange={(event) => onChange(plot.id, { title: event.target.value })} /></label>
          <label className="plot-check"><input type="checkbox" checked={s.showTitle} onChange={(event) => set({ showTitle: event.target.checked })} /> Show title inside chart</label>
          {!matrix && s.type !== 'histogram' && s.type !== 'box' && <label>X variable<select aria-label="Plot settings X variable" value={plot.xSymbol} onChange={(event) => onChange(plot.id, { xSymbol: event.target.value })}><option value="">Index (1, 2, …)</option>{symbols.map((symbol) => <option key={symbol}>{symbol}</option>)}</select></label>}
          <label>{matrix ? 'Matrix variable' : s.type === 'histogram' || s.type === 'box' ? 'Sample variable' : 'Y variable'}<select aria-label="Plot settings Y variable" value={plot.ySymbol} onChange={(event) => onChange(plot.id, { ySymbol: event.target.value })}><option value="">None</option>{symbols.map((symbol) => <option key={symbol}>{symbol}</option>)}</select></label>
          {!matrix && <><label className="plot-check"><input type="checkbox" checked={s.showLegend} onChange={(event) => set({ showLegend: event.target.checked })} /> Show legend</label>
            {series.map((entry, index) => <div className="plot-series" key={entry.id}>
              <strong>Series {index + 2}</strong>
              <label>Variable<select aria-label={`Series ${index + 2} variable`} value={entry.ySymbol} onChange={(event) => replaceSeries(entry.id, { ySymbol: event.target.value })}><option value="">None</option>{symbols.map((symbol) => <option key={symbol}>{symbol}</option>)}</select></label>
              <label>Legend label<input aria-label={`Series ${index + 2} label`} value={entry.label} onChange={(event) => replaceSeries(entry.id, { label: event.target.value })} /></label>
              <label>Color<input type="color" aria-label={`Series ${index + 2} color`} value={entry.color} onChange={(event) => replaceSeries(entry.id, { color: event.target.value })} /></label>
              <button type="button" onClick={() => setSeries(series.filter((item) => item.id !== entry.id))}>Remove series</button>
            </div>)}
            <button type="button" onClick={() => {
              const used = new Set([plot.ySymbol, ...series.map((entry) => entry.ySymbol)])
              const ySymbol = symbols.find((symbol) => !used.has(symbol)) ?? plot.ySymbol
              setSeries([...series, { id: crypto.randomUUID(), ySymbol, label: '', color: '#49838a' }])
            }}>+ Add series</button>
          </>}
        </fieldset>
        <fieldset><legend>Axes</legend>
          <label>X label<input aria-label="X axis label" placeholder={matrix ? 'Column' : plot.xSymbol || 'Index'} value={s.xLabel} onChange={(event) => set({ xLabel: event.target.value })} /></label>
          <label>Y label<input aria-label="Y axis label" placeholder={matrix ? 'Row' : plot.ySymbol} value={s.yLabel} onChange={(event) => set({ yLabel: event.target.value })} /></label>
          {s.type === 'surface' && <label>Z label<input aria-label="Z axis label" placeholder={plot.ySymbol} value={s.zLabel} onChange={(event) => set({ zLabel: event.target.value })} /></label>}
          {(s.type === 'surface' ? ['x', 'y', 'z'] as const : ['x', 'y'] as const).map((axis) => <div className="plot-axis" key={axis}>
            <label>{axis.toUpperCase()} scale<select aria-label={`${axis.toUpperCase()} axis scale`} value={s[`${axis}Scale`]} onChange={(event) => set({ [`${axis}Scale`]: event.target.value as 'linear' | 'log' })}><option value="linear">Linear</option><option value="log">Logarithmic</option></select></label>
            <label className="plot-check"><input type="checkbox" checked={s[`${axis}Reverse`]} onChange={(event) => set({ [`${axis}Reverse`]: event.target.checked })} /> Reverse {axis.toUpperCase()} axis</label>
            <div className="plot-field-row">
              <NumberField label={`${axis.toUpperCase()} minimum`} value={s[`${axis}Min`]} step="any" onChange={(value) => set({ [`${axis}Min`]: value })} />
              <NumberField label={`${axis.toUpperCase()} maximum`} value={s[`${axis}Max`]} step="any" onChange={(value) => set({ [`${axis}Max`]: value })} />
            </div>
          </div>)}
          <label className="plot-check"><input type="checkbox" checked={s.showGrid} onChange={(event) => set({ showGrid: event.target.checked })} /> Show grid</label>
          {s.showGrid && <><label>Grid color<input type="color" aria-label="Plot grid color" value={s.gridColor || '#888888'} onChange={(event) => set({ gridColor: event.target.value })} /></label><button type="button" onClick={() => set({ gridColor: '' })}>Use automatic grid color</button></>}
          <NumberField label="Tick font size" value={s.tickFontSize} min={8} max={36} step={1} onChange={(value) => value !== undefined && set({ tickFontSize: value })} />
          <div className="plot-field-row">
            <NumberField label="X tick angle" value={s.xTickAngle} min={-90} max={90} step="any" onChange={(value) => value !== undefined && set({ xTickAngle: value })} />
            <NumberField label="Y tick angle" value={s.yTickAngle} min={-90} max={90} step="any" onChange={(value) => value !== undefined && set({ yTickAngle: value })} />
          </div>
        </fieldset>
        {!matrix && <fieldset><legend>Series appearance</legend>
          <label>Primary color<input type="color" aria-label="Primary series color" value={s.lineColor} onChange={(event) => set({ lineColor: event.target.value })} /></label>
          {(s.type === 'line' || s.type === 'area' || s.type === 'box') && <NumberField label="Line width" value={s.lineWidth} min={0} max={20} step="any" onChange={(value) => value !== undefined && set({ lineWidth: value })} />}
          {(s.type === 'line' || s.type === 'area') && <>
            <label>Line style<select aria-label="Line style" value={s.lineDash} onChange={(event) => set({ lineDash: event.target.value as PlotSettings['lineDash'] })}><option value="solid">Solid</option><option value="dash">Dashed</option><option value="dot">Dotted</option><option value="dashdot">Dash dot</option></select></label>
            <label>Interpolation<select aria-label="Line interpolation" value={s.lineShape} onChange={(event) => set({ lineShape: event.target.value as PlotSettings['lineShape'] })}><option value="linear">Linear</option><option value="spline">Spline</option><option value="hv">Step after</option><option value="vh">Step before</option></select></label>
            <label className="plot-check"><input type="checkbox" checked={s.showMarkers} onChange={(event) => set({ showMarkers: event.target.checked })} /> Show markers</label>
          </>}
          {(s.type === 'scatter' || (s.type === 'line' || s.type === 'area') && s.showMarkers) && <>
            <label>Marker shape<select aria-label="Marker shape" value={s.markerSymbol} onChange={(event) => set({ markerSymbol: event.target.value as PlotSettings['markerSymbol'] })}><option value="circle">Circle</option><option value="square">Square</option><option value="diamond">Diamond</option><option value="cross">Cross</option><option value="x">X</option><option value="triangle-up">Triangle</option></select></label>
            <NumberField label="Marker size" value={s.markerSize} min={1} max={50} step="any" onChange={(value) => value !== undefined && set({ markerSize: value })} />
            <label>Marker outline color<input type="color" aria-label="Marker outline color" value={s.markerLineColor} onChange={(event) => set({ markerLineColor: event.target.value })} /></label>
            <NumberField label="Marker outline width" value={s.markerLineWidth} min={0} max={10} step="any" onChange={(value) => value !== undefined && set({ markerLineWidth: value })} />
          </>}
        </fieldset>}
        {s.type === 'histogram' && <fieldset><legend>Histogram</legend>
          <NumberField label="Bin count (0 = automatic)" value={s.histogramBins} min={0} max={1000} step={1} onChange={(value) => value !== undefined && set({ histogramBins: value })} />
          <NumberField label="Bin width (overrides count)" value={s.histogramBinWidth} min={Number.MIN_VALUE} step="any" optional onChange={(value) => set({ histogramBinWidth: value })} />
          <label>Normalization<select aria-label="Histogram normalization" value={s.histogramNorm} onChange={(event) => set({ histogramNorm: event.target.value as PlotSettings['histogramNorm'] })}><option value="">Count</option><option value="percent">Percent</option><option value="probability">Probability</option><option value="density">Count density</option><option value="probability density">Probability density</option></select></label>
        </fieldset>}
        {s.type === 'bar' && <fieldset><legend>Bars</legend>
          <label>Orientation<select aria-label="Bar orientation" value={s.barOrientation} onChange={(event) => set({ barOrientation: event.target.value as PlotSettings['barOrientation'] })}><option value="v">Vertical</option><option value="h">Horizontal</option></select></label>
          <label>Arrangement<select aria-label="Bar arrangement" value={s.barMode} onChange={(event) => set({ barMode: event.target.value as PlotSettings['barMode'] })}><option value="group">Grouped</option><option value="stack">Stacked</option><option value="overlay">Overlay</option></select></label>
          <NumberField label="Bar gap" value={s.barGap} min={0} max={1} step="any" onChange={(value) => value !== undefined && set({ barGap: value })} />
        </fieldset>}
        {matrix && <fieldset><legend>Color scale</legend>
          <label>Palette<select aria-label="Color scale" value={s.colorScale} onChange={(event) => set({ colorScale: event.target.value as PlotSettings['colorScale'] })}>{['Viridis', 'Cividis', 'Jet', 'Hot', 'Blues', 'RdBu'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="plot-check"><input type="checkbox" checked={s.showColorScale} onChange={(event) => set({ showColorScale: event.target.checked })} /> Show color scale</label>
          <div className="plot-field-row">
            <NumberField label="Color minimum" value={s.colorMin} step="any" onChange={(value) => set({ colorMin: value })} />
            <NumberField label="Color maximum" value={s.colorMax} step="any" onChange={(value) => set({ colorMax: value })} />
          </div>
        </fieldset>}
        <fieldset><legend>Figure</legend>
          <NumberField label="Opacity" value={s.opacity} min={0} max={1} step="any" onChange={(value) => value !== undefined && set({ opacity: value })} />
          <NumberField label="Plot font size" value={s.fontSize} min={8} max={36} step={1} onChange={(value) => value !== undefined && set({ fontSize: value })} />
          <label>Background<input type="color" aria-label="Plot background" value={s.background || '#ffffff'} onChange={(event) => set({ background: event.target.value, transparentBackground: false })} /></label>
          <button type="button" onClick={() => set({ background: '', transparentBackground: false })}>Use theme background</button>
          <label className="plot-check"><input type="checkbox" checked={s.transparentBackground} onChange={(event) => set({ transparentBackground: event.target.checked })} /> Transparent background</label>
        </fieldset>
      </div>
    </aside>
  )
}

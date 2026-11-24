import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { CompactSelection, type GridSelection, type Item } from '@glideapps/glide-data-grid'
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, ArrowRight, Bold, ChartNoAxesCombined, CircleAlert, Eraser, FileDown, FileUp, FolderOpen, Italic, PaintBucket, Plus, Redo2, Save, Trash2, Underline, Undo2 } from 'lucide-react'
import { GridCanvas } from './components/GridCanvas'
import { useFormulaSuggestions } from './components/FormulaSuggestions'
import { exportCsv, importCsv, parseClipboard, toSymbol } from './engine/ioAdapter'
import { isValidSymbol } from './engine/evaluator'
import { selectionRanges, spatialIndex, type CellAddress } from './engine/spatial'
import { loadWorkspace, saveWorkspace } from './engine/storageAdapter'
import { createBlock } from './engine/workspace'
import { isEmptyValue } from './engine/missingValues'
import type { CellFormat } from './types/workspace'
import { useWorkspaceStore } from './store/workspaceStore'
import './App.css'

function coordinate([col, row]: Item): string {
  let number = col + 1
  let letters = ''
  while (number > 0) { number -= 1; letters = String.fromCharCode(65 + number % 26) + letters; number = Math.floor(number / 26) }
  return `${letters}${row + 1}`
}

function nextVariableSymbol(blocks: Record<string, unknown>): string {
  let suffix = 1
  while (blocks[`Variable${suffix}`]) suffix += 1
  return `Variable${suffix}`
}

function App() {
  const { blocks, plots, cellFormats, columnWidths, activeFormulaSymbol, setFormula, editValue, editValues, resizeBlock, clearSelection, updateFormat, addBlocks, moveBlocks, formatCells, setColumnWidth, renameBlock, addPlot, updatePlot, removePlot, replaceWorkspace } = useWorkspaceStore()
  const canUndo = useStore(useWorkspaceStore.temporal, (state) => state.pastStates.length > 0)
  const canRedo = useStore(useWorkspaceStore.temporal, (state) => state.futureStates.length > 0)
  const [selectedCell, setSelectedCell] = useState<Item>([1, 1])
  const [gridSelection, setGridSelection] = useState<GridSelection>({
    current: { cell: [1, 1], range: { x: 1, y: 1, width: 1, height: 1 }, rangeStack: [] },
    rows: CompactSelection.empty(), columns: CompactSelection.empty(),
  })
  const [gridSize, setGridSize] = useState({ columns: 100, rows: 1000 })
  const [gridVersion, setGridVersion] = useState(0)
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>(() => {
    const saved = localStorage.getItem('tinclay-theme')
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  })
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [formulaDraft, setFormulaDraft] = useState<{ key: string; value: string }>()
  const [gridDraft, setGridDraft] = useState<{ item: Item; value: string }>()
  const [nameDraft, setNameDraft] = useState<{ key: string; value: string }>()
  const [notice, setNotice] = useState('')
  const [noticeIsError, setNoticeIsError] = useState(false)
  const [borderStyle, setBorderStyle] = useState<NonNullable<CellFormat['borderStyle']>>('solid')
  const [borderColor, setBorderColor] = useState('#806e6e')
  const csvInput = useRef<HTMLInputElement>(null)
  const formulaInput = useRef<HTMLInputElement>(null)
  const addresses = useMemo(() => spatialIndex(blocks), [blocks])
  const address = addresses.get(`${selectedCell[0]},${selectedCell[1]}`)
  const selected = address ? blocks[address.symbol] : undefined
  const cellFormat = cellFormats?.[`${selectedCell[0]},${selectedCell[1]}`] ?? {}
  const alignment = selected?.format.alignment ?? cellFormat.alignment ?? (address?.role === 'value' && !selected?.format.alignDecimal ? 'right' : undefined)
  const dark = themeMode === 'dark' || themeMode === 'system' && systemDark
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setSystemDark(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem('tinclay-theme', themeMode)
  }, [dark, themeMode])
  const fieldKey = `${selectedCell[0]},${selectedCell[1]},${selected?.id ?? ''}`
  const selectedName = selected ? selected.displayName === selected.symbol ? selected.symbol : `${selected.displayName} (${selected.symbol})` : coordinate(selectedCell)
  const selectedFormula = !selected ? '' : selected.mode === 'derived' ? selected.formula : address?.role === 'ghost' || isEmptyValue(selected, address?.row ?? 0, address?.col ?? 0) ? '' : String(selected.data[address?.row ?? 0]?.[address?.col ?? 0] ?? '')
  const previewing = gridDraft && gridDraft.item[0] === selectedCell[0] && gridDraft.item[1] === selectedCell[1]
  const formula = previewing ? gridDraft.value : formulaDraft?.key === fieldKey ? formulaDraft.value : selectedFormula
  const name = nameDraft?.key === fieldKey ? nameDraft.value : selectedName
  const formulaSuggestions = useFormulaSuggestions(formula, selected?.mode === 'derived' || formula.includes('='), (value) => setFormulaDraft({ key: fieldKey, value }))

  const pickFormulaVariable = (symbol: string): boolean => {
    const input = formulaInput.current
    if (!input || document.activeElement !== input || !(formula.includes('=') || selected?.mode === 'derived')) return false
    const start = input.selectionStart ?? input.value.length
    const end = input.selectionEnd ?? start
    setFormulaDraft({ key: fieldKey, value: input.value.slice(0, start) + symbol + input.value.slice(end) })
    formulaSuggestions.resetHighlight()
    requestAnimationFrame(() => {
      if (document.activeElement === input) input.setSelectionRange(start + symbol.length, start + symbol.length)
    })
    return true
  }

  const showError = (error: unknown) => { setNoticeIsError(true); setNotice(error instanceof Error ? error.message : 'Something went wrong.') }
  const applyCellFormat = (patch: Partial<CellFormat>, border?: 'all' | 'outer' | 'none', clear = false) => {
    try { formatCells(selectionRanges(gridSelection, gridSize.columns, gridSize.rows), patch, border, clear); setNotice('') } catch (error) { showError(error) }
  }
  const selectCell = (item: Item) => {
    if (selectedCell[0] !== item[0] || selectedCell[1] !== item[1]) {
      setSelectedCell(item)
      setFormulaDraft(undefined)
      setNameDraft(undefined)
    }
    setFormulaDraft(undefined)
    setNotice('')
  }
  const createAtCell = (item: Item, text: string) => {
    const input = text.trim()
    if (input.startsWith('=')) {
      const expression = input.slice(1).trim()
      if (!expression) throw new Error('Formula cannot be empty.')
      const symbol = nextVariableSymbol(blocks)
      addBlocks([createBlock({
        displayName: symbol, symbol, mode: 'derived', formula: expression,
        anchor: { row: item[1], col: item[0] },
      })])
    } else {
      const match = input.match(/^([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+)$/s)
      if (match) {
        const [, symbol, expression] = match
        if (!isValidSymbol(symbol)) throw new Error(`Invalid or reserved symbol: ${symbol}`)
        const numeric = expression.trim() !== '' && Number.isFinite(Number(expression))
        addBlocks([createBlock({
          displayName: symbol, symbol, mode: numeric ? 'root' : 'derived',
          anchor: { row: item[1], col: item[0] },
          ...(numeric ? { data: [[Number(expression)]] } : { formula: expression.trim() }),
        })])
      } else if (input && Number.isFinite(Number(input))) {
        const symbol = nextVariableSymbol(blocks)
        addBlocks([createBlock({
          displayName: symbol, symbol, mode: 'root', data: [[Number(input)]],
          anchor: { row: item[1], col: item[0] },
        })])
      } else {
        if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(input)) throw new Error('Enter a variable name or an assignment, for example m = 3.')
        const symbol = toSymbol(input)
        if (!isValidSymbol(symbol)) throw new Error(`Invalid or reserved symbol: ${symbol}`)
        addBlocks([createBlock({
          displayName: input, symbol, mode: 'root', unfilled: true,
          anchor: { row: item[1], col: item[0] },
        })])
      }
    }
    setFormulaDraft(undefined)
    setNotice('')
  }
  const commitFormula = () => {
    try {
      const input = formula.trim()
      if (selected) {
        if (input.startsWith('=') || selected.mode === 'derived' && input && !Number.isFinite(Number(input))) {
          setFormula(selected.symbol, input.startsWith('=') ? input.slice(1) : input)
        } else {
          if (!input || !Number.isFinite(Number(input))) throw new Error('Enter a finite numeric value or a formula starting with =.')
          editValue(selected.symbol, address?.row ?? 0, address?.col ?? 0, Number(input))
        }
      } else createAtCell(selectedCell, input)
      setFormulaDraft(undefined)
      setNotice('')
    } catch (error) { showError(error) }
  }
  const commitName = () => {
    if (!selected) return
    try {
      const match = name.trim().match(/^(.*?)\s*\(([A-Za-z][A-Za-z0-9_]*)\)$/)
      const newName = match ? match[1].trim() : name.trim()
      const newSymbol = match ? match[2] : name.trim()
      renameBlock(selected.symbol, newName, newSymbol, selected.format.unit ?? '')
      setNameDraft(undefined)
      setNotice('')
    } catch (error) { showError(error) }
  }
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      const imported = importCsv(await file.text(), { row: selectedCell[1], col: selectedCell[0] }, Object.keys(blocks))
      if (!imported.length) throw new Error('No numeric CSV columns were found.')
      addBlocks(imported)
      setNoticeIsError(false); setNotice(`Imported ${imported.length} variable(s).`)
    } catch (error) { showError(error) }
  }
  const handlePaste = (item: Item, values: readonly (readonly string[])[], target?: CellAddress) => {
    try {
      const parsed = parseClipboard(values.map((row) => row.join('\t')).join('\n'))
      if (!parsed || parsed.some((row) => row.length !== parsed[0].length)) throw new Error('Paste a rectangular selection of numeric values.')
      if (target && target.role !== 'label' && blocks[target.symbol]) {
        editValues(target.symbol, target.row, target.col, parsed)
      } else {
        const used = new Set(Object.keys(blocks))
        const imported = parsed[0].map((_, columnIndex) => {
          let suffix = columnIndex + 1
          while (used.has(`Pasted${suffix}`)) suffix += 1
          const symbol = `Pasted${suffix}`
          used.add(symbol)
          return createBlock({ displayName: symbol, symbol, mode: 'root', anchor: { row: item[1], col: item[0] + columnIndex }, data: parsed.map((row) => [row[columnIndex]]) })
        })
        addBlocks(imported)
      }
      setNotice('')
    } catch (error) { showError(error) }
  }
  const handleSave = async () => {
    try { await saveWorkspace({ blocks, plots, activeFormulaSymbol, cellFormats, columnWidths }); setNoticeIsError(false); setNotice('Workspace saved.') } catch (error) { showError(error) }
  }
  const handleLoad = async () => {
    try {
      const workspace = await loadWorkspace()
      if (workspace) {
        const item: Item = [0, 0]
        replaceWorkspace(workspace)
        selectCell(item)
        setGridSelection({ current: { cell: item, range: { x: 0, y: 0, width: 1, height: 1 }, rangeStack: [] }, rows: CompactSelection.empty(), columns: CompactSelection.empty() })
        setGridVersion((version) => version + 1)
        setNoticeIsError(false); setNotice('Workspace loaded.')
      }
    } catch (error) { showError(error) }
  }
  const handleExport = () => {
    try {
      const url = URL.createObjectURL(new Blob([exportCsv(Object.values(blocks))], { type: 'text/csv;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url; link.download = 'tinclay_variables.csv'; link.click()
      URL.revokeObjectURL(url)
    } catch (error) { showError(error) }
  }
  const handleAddVariable = () => {
    try {
      const symbol = nextVariableSymbol(blocks)
      addBlocks([createBlock({ displayName: symbol, symbol, mode: 'root', anchor: { row: selectedCell[1], col: selectedCell[0] } })])
    } catch (error) { showError(error) }
  }
  const handleAddPlot = () => {
    const symbols = Object.keys(blocks)
    addPlot({
      id: crypto.randomUUID(), title: 'Chart',
      xSymbol: blocks.v ? 'v' : symbols[0] ?? '', ySymbol: blocks.KE ? 'KE' : symbols[1] ?? symbols[0] ?? '',
      anchor: { row: selectedCell[1], col: selectedCell[0] },
      span: { rows: 10, cols: 4 },
    })
  }
  return (
    <main className="app-shell" onKeyDownCapture={(event) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || !(event.target instanceof HTMLElement)) return
      if (event.target.isContentEditable || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      event.preventDefault()
      event.stopPropagation()
      if (key === 'y' || event.shiftKey) useWorkspaceStore.temporal.getState().redo()
      else useWorkspaceStore.temporal.getState().undo()
    }} onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault() }} onDrop={(event) => {
      const file = Array.from(event.dataTransfer.files).find((candidate) => candidate.name.toLowerCase().endsWith('.csv'))
      if (file) { event.preventDefault(); void importFile(file) }
    }}>
      <nav className="ribbon" aria-label="Workspace tools">
        <div className="ribbon-group" role="group" aria-label="File">
          <div className="ribbon-content">
            <button className="ribbon-primary" aria-label="Open (.clay)" title="Open (.clay)" onClick={() => void handleLoad()}><FolderOpen aria-hidden="true" /> Open</button>
            <button className="ribbon-primary" aria-label="Save (.clay)" title="Save (.clay)" onClick={() => void handleSave()}><Save aria-hidden="true" /> Save</button>
            <div className="ribbon-stack">
              <div className="ribbon-row"><button aria-label="Import CSV" title="Import CSV" onClick={() => csvInput.current?.click()}><FileUp aria-hidden="true" /></button><button aria-label="Export CSV" title="Export CSV" onClick={handleExport}><FileDown aria-hidden="true" /></button></div>
              <div className="ribbon-row"><button aria-label="Undo" disabled={!canUndo} title="Undo (Ctrl+Z)" onClick={() => useWorkspaceStore.temporal.getState().undo()}><Undo2 aria-hidden="true" /></button><button aria-label="Redo" disabled={!canRedo} title="Redo (Ctrl+Y or Ctrl+Shift+Z)" onClick={() => useWorkspaceStore.temporal.getState().redo()}><Redo2 aria-hidden="true" /></button></div>
            </div>
          </div>
          <span className="ribbon-label">File</span>
        </div>
        <div className="ribbon-group" role="group" aria-label="Number">
          <div className="ribbon-stack">
            <div className="ribbon-row">
              <select aria-label="Number format" value={selected?.format.style ?? 'general'} disabled={!selected} onChange={(event) => selected && updateFormat(selected.symbol, { style: event.target.value as 'general' | 'number' | 'percent' | 'scientific' })}>
                <option value="general">General</option><option value="number">Number</option><option value="percent">Percent</option><option value="scientific">Scientific</option>
              </select>
              <label className="unit-control">Unit <input aria-label="Unit" value={selected?.format.unit ?? ''} disabled={!selected} onChange={(event) => selected && updateFormat(selected.symbol, { unit: event.target.value || undefined })} /></label>
            </div>
            <div className="ribbon-row">
              <button aria-label="Increase decimal places" title="Increase decimal places" disabled={!selected} onClick={() => selected && updateFormat(selected.symbol, { decimals: Math.min(12, selected.format.decimals + 1) })}><span className="decimal-icon" aria-hidden="true">.0<ArrowLeft /></span></button>
              <button aria-label="Decrease decimal places" title="Decrease decimal places" disabled={!selected} onClick={() => selected && updateFormat(selected.symbol, { decimals: Math.max(0, selected.format.decimals - 1) })}><span className="decimal-icon" aria-hidden="true">.0<ArrowRight /></span></button>
              <label className="align-control"><input type="checkbox" checked={selected?.format.alignDecimal ?? false} disabled={!selected} onChange={(event) => selected && updateFormat(selected.symbol, { alignDecimal: event.target.checked })} /> Align Decimals</label>
            </div>
          </div>
          <span className="ribbon-label">Number</span>
        </div>
        <div className="ribbon-group" role="group" aria-label="Font">
          <div className="ribbon-stack">
            <div className="ribbon-row">
              <select aria-label="Text size" title="Text size" value={cellFormat.fontSize ?? 13} onChange={(event) => applyCellFormat({ fontSize: Number(event.target.value) })}>
                {Array.from({ length: 29 }, (_, index) => index + 8).map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
              <button title="Bold" aria-label="Bold" aria-pressed={cellFormat.bold ?? false} onClick={() => applyCellFormat({ bold: !cellFormat.bold })}><Bold aria-hidden="true" /></button>
              <button title="Italic" aria-label="Italic" aria-pressed={cellFormat.italic ?? false} onClick={() => applyCellFormat({ italic: !cellFormat.italic })}><Italic aria-hidden="true" /></button>
              <button title="Underline" aria-label="Underline" aria-pressed={cellFormat.underline ?? false} onClick={() => applyCellFormat({ underline: !cellFormat.underline })}><Underline aria-hidden="true" /></button>
            </div>
            <div className="ribbon-row">
              <label className="color-control" title="Text color"><span className="font-color-icon" aria-hidden="true" style={{ borderColor: cellFormat.textColor ?? (dark ? '#ece6e5' : '#202020') }}>A</span><input type="color" aria-label="Text color" value={cellFormat.textColor ?? (dark ? '#ece6e5' : '#202020')} onChange={(event) => applyCellFormat({ textColor: event.target.value })} /></label>
              <label className="color-control" title="Fill color"><PaintBucket aria-hidden="true" style={{ borderColor: cellFormat.fillColor ?? (dark ? '#242427' : '#ffffff') }} /><input type="color" aria-label="Fill color" value={cellFormat.fillColor ?? (dark ? '#242427' : '#ffffff')} onChange={(event) => applyCellFormat({ fillColor: event.target.value })} /></label>
              <button aria-label="Clear cell formatting" title="Clear cell formatting" onClick={() => applyCellFormat({}, undefined, true)}><Eraser aria-hidden="true" /></button>
            </div>
          </div>
          <span className="ribbon-label">Font</span>
        </div>
        <div className="ribbon-group" role="group" aria-label="Alignment">
          <div className="ribbon-stack">
            <div className="ribbon-row">
              <button title="Align left" aria-label="Align left" aria-pressed={alignment === 'left'} onClick={() => applyCellFormat({ alignment: 'left' })}><AlignLeft aria-hidden="true" /></button>
              <button title="Align center" aria-label="Align center" aria-pressed={alignment === 'center'} onClick={() => applyCellFormat({ alignment: 'center' })}><AlignCenter aria-hidden="true" /></button>
              <button title="Align right" aria-label="Align right" aria-pressed={alignment === 'right'} onClick={() => applyCellFormat({ alignment: 'right' })}><AlignRight aria-hidden="true" /></button>
              <select aria-label="Border line style" value={cellFormat.borderStyle ?? borderStyle} onChange={(event) => { const style = event.target.value as NonNullable<CellFormat['borderStyle']>; setBorderStyle(style); applyCellFormat({ borderStyle: style }) }}>
                <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option><option value="double">Double</option>
              </select>
            </div>
            <div className="ribbon-row">
              <label className="color-control border-color-control" title="Border color">Border <input type="color" aria-label="Border color" value={cellFormat.borderColor ?? borderColor} onChange={(event) => { setBorderColor(event.target.value); applyCellFormat({ borderColor: event.target.value }) }} /></label>
              <select aria-label="Apply borders" value="" onChange={(event) => { const value = event.target.value; if (value === 'all' || value === 'outer' || value === 'none') applyCellFormat({ borderStyle: cellFormat.borderStyle ?? borderStyle, borderColor: cellFormat.borderColor ?? borderColor }, value) }}>
                <option value="">Borders</option><option value="all">All borders</option><option value="outer">Outside borders</option><option value="none">No borders</option>
              </select>
            </div>
          </div>
          <span className="ribbon-label">Alignment</span>
        </div>
        <div className="ribbon-group" role="group" aria-label="Math">
          <div className="ribbon-content">
            <button className="ribbon-primary" aria-label="+ Variable" onClick={handleAddVariable}><Plus aria-hidden="true" /> Variable</button>
            <button className="ribbon-primary" aria-label="+ Plot" onClick={handleAddPlot}><ChartNoAxesCombined aria-hidden="true" /> Plot</button>
            <div className="ribbon-stack">
              <div className="ribbon-row"><button aria-label="Delete variable" disabled={!selected} title="Delete selected variable" onClick={() => selected && clearSelection([{ symbol: selected.symbol, row: 0, col: 0, role: 'label' }])}><Trash2 aria-hidden="true" /></button></div>
              <div className="ribbon-row"><select aria-label="Theme" value={themeMode} onChange={(event) => setThemeMode(event.target.value as 'light' | 'dark' | 'system')}><option value="system">Match system</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
            </div>
          </div>
          <span className="ribbon-label">Math</span>
        </div>
        <input ref={csvInput} className="visually-hidden" type="file" accept=".csv,text/csv" onChange={(event) => { void importFile(event.target.files?.[0]); event.currentTarget.value = '' }} />
      </nav>
      <div className="formula-bar" aria-label="Formula bar">
        <input className="name-box" aria-label="Name and symbol" value={name} readOnly={!selected} onChange={(event) => setNameDraft({ key: fieldKey, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitName() } }} />
        <span className="formula-icon">fx</span>
        <input ref={formulaInput} className={`formula-input${previewing ? ' formula-preview' : ''}`} aria-label="Formula or value" aria-autocomplete="list" aria-controls={formulaSuggestions.controls} aria-expanded={Boolean(formulaSuggestions.controls)} role="combobox" value={formula} spellCheck={false} placeholder={selected ? '' : 'Enter a name, assignment, or =formula'} onFocus={formulaSuggestions.onFocus} onSelect={formulaSuggestions.updateCaret} onBlur={formulaSuggestions.onBlur} onChange={(event) => { setFormulaDraft({ key: fieldKey, value: event.target.value }); formulaSuggestions.resetHighlight(); formulaSuggestions.updateCaret(event) }} onKeyDown={(event) => { if (!formulaSuggestions.onKeyDown(event) && event.key === 'Enter') { event.preventDefault(); commitFormula() } }} />
        {formulaSuggestions.menu && <div className="formula-suggestion-anchor">{formulaSuggestions.menu}</div>}
        {selected?.error && <span className="formula-error" role="alert" title={selected.error}><CircleAlert aria-hidden="true" /> {selected.error}</span>}
      </div>
      <GridCanvas key={gridVersion} initialCell={selectedCell} blocks={blocks} plots={plots} cellFormats={cellFormats ?? {}} columnWidths={columnWidths ?? {}} dark={dark} selectedSymbol={selected?.symbol} onSelect={selectCell} onPickVariable={pickFormulaVariable} onSelectionChange={(selection, columns, rows) => { setGridSelection(selection); setGridSize({ columns, rows }) }} onEmptyDraft={setGridDraft} onEmptyCommit={createAtCell} onValueEdit={editValue} onResizeBlock={resizeBlock} onClearSelection={clearSelection} onMoveBlocks={moveBlocks} onColumnWidth={setColumnWidth} onRenameBlock={renameBlock} onPlotChange={updatePlot} onPlotRemove={removePlot} onPasteValues={handlePaste} onError={showError} />
      {notice && <div className="status-message" role="status">{noticeIsError && <CircleAlert aria-hidden="true" />} {notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
    </main>
  )
}

export default App

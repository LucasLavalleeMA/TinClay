import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { CompactSelection, type GridSelection, type Item } from '@glideapps/glide-data-grid'
import { AlignCenter, AlignLeft, AlignRight, ArrowLeft, ArrowRight, Bold, ChartNoAxesCombined, CircleAlert, Eraser, FileDown, FileUp, FolderOpen, Home, Italic, PaintBucket, Plus, Redo2, Save, SaveAll, Trash2, Underline, Undo2 } from 'lucide-react'
import { GridCanvas } from './components/GridCanvas'
import { HomeView } from './components/HomeView'
import { useFormulaSuggestions } from './components/FormulaSuggestions'
import { exportCsv, importCsv, parseClipboard, toSymbol } from './engine/ioAdapter'
import { isValidSymbol } from './engine/evaluator'
import { selectionRanges, spatialIndex, type CellAddress } from './engine/spatial'
import { forgetRecentWorkspace, isTauri, loadWorkspace, openRecentWorkspace, recentModified, revealWorkspace, saveWorkspace, startupWorkspace, type DocumentFile } from './engine/storageAdapter'
import { readRecentFiles, rememberFile, writeRecentFiles, type RecentFile } from './engine/recentFiles'
import { instantiateTemplate, newBlankWorkspace, type Template } from './engine/templates'
import { createBlock } from './engine/workspace'
import { isEmptyValue } from './engine/missingValues'
import { TABLE_STYLES, type TableStyle } from './engine/formatting'
import type { CellFormat, Workspace } from './types/workspace'
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

function currentWorkspace(): Workspace {
  const { blocks, plots, activeFormulaSymbol, cellFormats, columnWidths } = useWorkspaceStore.getState()
  return { blocks, plots, activeFormulaSymbol, cellFormats, columnWidths }
}

function App() {
  const { blocks, plots, cellFormats, columnWidths, setFormula, editValue, editValues, resizeBlock, clearSelection, updateFormat, addBlocks, moveBlocks, formatCells, formatTable, setColumnWidth, renameBlock, addPlot, updatePlot, removePlot, replaceWorkspace } = useWorkspaceStore()
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
  const [symbolDraft, setSymbolDraft] = useState<{ id: string; value: string }>()
  const [initialRecent] = useState(() => {
    try { return { files: readRecentFiles(), error: '' } }
    catch (error) { return { files: [] as RecentFile[], error: error instanceof Error ? error.message : 'Could not load recent files.' } }
  })
  const [notice, setNotice] = useState(initialRecent.error)
  const [noticeIsError, setNoticeIsError] = useState(Boolean(initialRecent.error))
  const [home, setHome] = useState(true)
  const [startupPending, setStartupPending] = useState(isTauri)
  const [hasDocument, setHasDocument] = useState(false)
  const [documentInfo, setDocumentInfo] = useState<{ name: string; path?: string }>({ name: 'Untitled' })
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [unsavedTemplate, setUnsavedTemplate] = useState(false)
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(initialRecent.files)
  const recentRef = useRef<RecentFile[]>(initialRecent.files)
  const [pendingAction, setPendingAction] = useState<{ run: () => Promise<void> }>()
  const [missingFile, setMissingFile] = useState<RecentFile>()
  const [borderStyle, setBorderStyle] = useState<NonNullable<CellFormat['borderStyle']>>('solid')
  const [borderColor, setBorderColor] = useState('#806e6e')
  const csvInput = useRef<HTMLInputElement>(null)
  const formulaInput = useRef<HTMLInputElement>(null)
  const commitEntryRef = useRef<(() => boolean)>()
  const addresses = useMemo(() => spatialIndex(blocks), [blocks])
  const address = addresses.get(`${selectedCell[0]},${selectedCell[1]}`)
  const selected = address ? blocks[address.symbol] : undefined
  const cellFormat = cellFormats?.[`${selectedCell[0]},${selectedCell[1]}`] ?? {}
  const alignment = selected?.format.alignment ?? cellFormat.alignment ?? (address?.role === 'value' && !selected?.format.alignDecimal ? 'right' : undefined)
  const dark = themeMode === 'dark' || themeMode === 'system' && systemDark
  const dirty = hasDocument && (unsavedTemplate || JSON.stringify(currentWorkspace()) !== savedSnapshot || Boolean(formulaDraft || nameDraft || symbolDraft || gridDraft))
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
  useEffect(() => {
    document.title = hasDocument ? `${documentInfo.name}${dirty ? ' *' : ''} — TinClay` : 'TinClay — Spatial Engineering Worksheet'
  }, [hasDocument, documentInfo.name, dirty])
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

  const showError = (error: unknown) => { setNoticeIsError(true); setNotice(error instanceof Error ? error.message : typeof error === 'string' ? error : 'Something went wrong.') }
  const updateRecent = (files: RecentFile[]) => {
    const removed = recentRef.current.filter((item) => !files.some((file) => file.path === item.path) && item.path !== documentInfo.path)
    recentRef.current = files
    setRecentFiles(files)
    try { writeRecentFiles(files) } catch (error) { showError(error) }
    for (const item of removed) void forgetRecentWorkspace(item.path).catch(showError)
  }
  const recordFile = (file: Omit<DocumentFile, 'workspace'>) => {
    if (file.path) updateRecent(rememberFile(recentRef.current, { path: file.path, name: file.name, modified: file.modified, accessed: Date.now() }))
  }
  const applyDocument = (file: DocumentFile, template = false) => {
    replaceWorkspace(file.workspace)
    useWorkspaceStore.temporal.getState().clear()
    const item: Item = [0, 0]
    setSelectedCell(item)
    setGridSelection({ current: { cell: item, range: { x: 0, y: 0, width: 1, height: 1 }, rangeStack: [] }, rows: CompactSelection.empty(), columns: CompactSelection.empty() })
    setFormulaDraft(undefined); setNameDraft(undefined); setSymbolDraft(undefined); setGridDraft(undefined)
    setGridVersion((version) => version + 1)
    setDocumentInfo({ name: file.name, path: file.path })
    setSavedSnapshot(JSON.stringify(currentWorkspace()))
    setUnsavedTemplate(template)
    setHasDocument(true)
    setHome(false)
    setNotice('')
    recordFile(file)
  }
  useEffect(() => {
    let active = true
    void startupWorkspace().then((file) => { if (active && file) applyDocument(file) }).catch((error: unknown) => { if (active) showError(error) }).finally(() => { if (active) setStartupPending(false) })
    return () => { active = false }
  // The startup path must only be consumed once per launch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!home || !isTauri() || !recentRef.current.length) return
    let active = true
    const snapshot = recentRef.current
    void Promise.all(snapshot.map(async (file) => ({ file, modified: await recentModified(file.path) }))).then((results) => {
      if (!active) return
      const updates = new Map(results.map((result) => [result.file.path, result]))
      const files = recentRef.current.map((file) => {
        const result = updates.get(file.path)
        return result && result.modified !== null && result.file.accessed === file.accessed && result.file.modified === file.modified && result.modified !== file.modified
          ? { ...file, modified: result.modified } : file
      })
      if (files.some((file, index) => file !== recentRef.current[index])) updateRecent(files)
    }).catch((error: unknown) => { if (active) showError(error) })
    return () => { active = false }
  // Refresh when Home opens, not when document callbacks change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [home])
  const applyCellFormat = (patch: Partial<CellFormat>, border?: 'all' | 'outer' | 'none', clear = false) => {
    try { formatCells(selectionRanges(gridSelection, gridSize.columns, gridSize.rows), patch, border, clear); setNotice('') } catch (error) { showError(error) }
  }
  const selectCell = (item: Item) => {
    if (selectedCell[0] !== item[0] || selectedCell[1] !== item[1]) {
      setSelectedCell(item)
      setFormulaDraft(undefined)
      setNameDraft(undefined)
      setSymbolDraft(undefined)
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
      return true
    } catch (error) { showError(error); return false }
  }
  const commitName = () => {
    if (!selected) return false
    try {
      const match = name.trim().match(/^(.*?)\s*\(([A-Za-z][A-Za-z0-9_]*)\)$/)
      const newName = match ? match[1].trim() : name.trim()
      const newSymbol = match ? match[2] : name.trim()
      renameBlock(selected.symbol, newName, newSymbol, selected.format.unit ?? '')
      setNameDraft(undefined)
      setNotice('')
      return true
    } catch (error) { showError(error); return false }
  }
  const commitSymbol = () => {
    if (!selected || symbolDraft?.id !== selected.id) return true
    try {
      if (nameDraft?.key === fieldKey && !commitName()) return false
      const current = Object.values(useWorkspaceStore.getState().blocks).find((block) => block.id === selected.id)
      if (!current) throw new Error('Variable not found.')
      const symbol = symbolDraft.value.trim()
      if (symbol !== current.symbol) renameBlock(current.symbol, current.displayName, symbol, current.format.unit ?? '')
      setSymbolDraft(undefined)
      setNotice('')
      return true
    } catch (error) { showError(error); return false }
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
  const handleSave = async (saveAs = false): Promise<boolean> => {
    try {
      if (!commitEntryRef.current) throw new Error('The worksheet is not ready to save.')
      if (!commitEntryRef.current()) return false
      if (formulaDraft?.key === fieldKey && !commitFormula()) return false
      if (symbolDraft && symbolDraft.id === selected?.id) {
        if (!commitSymbol()) return false
      } else if (nameDraft?.key === fieldKey && !commitName()) return false
      const workspace = currentWorkspace()
      const file = await saveWorkspace(workspace, documentInfo.path, `${documentInfo.name.replace(/\.clay$/i, '')}.clay`, saveAs)
      if (!file) return false
      setDocumentInfo({ name: file.name, path: file.path })
      setSavedSnapshot(JSON.stringify(workspace))
      setUnsavedTemplate(false)
      setNoticeIsError(false); setNotice('Workspace saved.')
      recordFile(file)
      return true
    } catch (error) { showError(error); return false }
  }
  const requestReplacement = (run: () => Promise<void>) => {
    if (dirty || document.querySelector('.header-editor')) setPendingAction({ run })
    else void run()
  }
  const handleLoad = async () => {
    try {
      const file = await loadWorkspace()
      if (file) applyDocument(file)
    } catch (error) { showError(error) }
  }
  const openRecent = async (recent: RecentFile) => {
    try {
      const file = await openRecentWorkspace(recent.path)
      if (file) applyDocument(file)
      else setMissingFile(recent)
    } catch (error) { showError(error) }
  }
  const createDocument = async (template?: Template) => {
    try {
      applyDocument({ workspace: template ? instantiateTemplate(template) : newBlankWorkspace(), name: template ? `Untitled - ${template.title}` : 'Untitled', modified: Date.now() }, Boolean(template))
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
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.repeat) return
      const key = event.key.toLowerCase()
      if (key !== 's' && key !== 'o') return
      if (key === 'o' && event.shiftKey) return
      event.preventDefault()
      event.stopPropagation()
      if (startupPending || pendingAction || missingFile) return
      if (key === 'o') requestReplacement(handleLoad)
      else if (hasDocument) void handleSave(event.shiftKey)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  })
  return (<>
    {startupPending ? <div className="startup-message" role="status">Opening TinClay…</div> : home && <HomeView hasDocument={hasDocument} files={recentFiles} onBack={() => setHome(false)} onBlank={() => requestReplacement(() => createDocument())} onTemplate={(template) => requestReplacement(() => createDocument(template))} onBrowse={() => requestReplacement(handleLoad)} onOpen={(file) => requestReplacement(() => openRecent(file))} onPin={(file) => updateRecent(recentRef.current.map((item) => item.path === file.path ? { ...item, pinned: !item.pinned } : item))} onRemove={(file) => updateRecent(recentRef.current.filter((item) => item.path !== file.path))} onReveal={(file) => { void revealWorkspace(file.path).catch(showError) }} />}
    {hasDocument && <main hidden={home} className="app-shell" onKeyDownCapture={(event) => {
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
            <button className="ribbon-primary" aria-label="Home" title="Home" onClick={() => setHome(true)}><Home aria-hidden="true" /> Home</button>
            <button className="ribbon-primary" aria-label="Open (.clay)" title="Open (.clay) (Ctrl+O)" onClick={() => requestReplacement(handleLoad)}><FolderOpen aria-hidden="true" /> Open</button>
            <button className="ribbon-primary" aria-label="Save (.clay)" title="Save (.clay) (Ctrl+S)" onClick={() => void handleSave()}><Save aria-hidden="true" /> Save</button>
            <div className="ribbon-stack">
              <div className="ribbon-row"><button aria-label="Save As (.clay)" title="Save As (Ctrl+Shift+S)" onClick={() => void handleSave(true)}><SaveAll aria-hidden="true" /></button><button aria-label="Import CSV" title="Import CSV" onClick={() => csvInput.current?.click()}><FileUp aria-hidden="true" /></button><button aria-label="Export CSV" title="Export CSV" onClick={handleExport}><FileDown aria-hidden="true" /></button></div>
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
            </div>
            <div className="ribbon-row">
              <button aria-label="Increase decimal places" title="Increase decimal places" disabled={!selected} onClick={() => selected && updateFormat(selected.symbol, { decimals: Math.min(12, selected.format.decimals + 1) })}><span className="decimal-icon" aria-hidden="true">.0<ArrowLeft /></span></button>
              <button aria-label="Decrease decimal places" title="Decrease decimal places" disabled={!selected} onClick={() => selected && updateFormat(selected.symbol, { decimals: Math.max(0, selected.format.decimals - 1) })}><span className="decimal-icon" aria-hidden="true">.0<ArrowRight /></span></button>
              <label className="align-control"><input type="checkbox" checked={selected?.format.alignDecimal ?? false} disabled={!selected} onChange={(event) => selected && updateFormat(selected.symbol, { alignDecimal: event.target.checked })} /> Align Decimals</label>
            </div>
          </div>
          <span className="ribbon-label">Number</span>
        </div>
        <div className="ribbon-group" role="group" aria-label="Variable">
          <div className="ribbon-stack">
            <div className="ribbon-row"><label className="variable-control">Symbol <input aria-label="Variable symbol in ribbon" value={symbolDraft && symbolDraft.id === selected?.id ? symbolDraft.value : selected?.symbol ?? ''} disabled={!selected} onChange={(event) => selected && setSymbolDraft({ id: selected.id, value: event.target.value })} onBlur={() => { commitSymbol() }} onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commitSymbol() }
              else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSymbolDraft(undefined) }
            }} /></label><label className="variable-control">Unit <input aria-label="Unit" value={selected?.format.unit ?? ''} disabled={!selected} onChange={(event) => selected && updateFormat(selected.symbol, { unit: event.target.value || undefined })} /></label></div>
          </div>
          <span className="ribbon-label">Variable</span>
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
        <div className="ribbon-group" role="group" aria-label="Table styles">
          <div className="ribbon-content table-style-gallery">
            {(Object.keys(TABLE_STYLES) as TableStyle[]).map((style) => <button key={style} className="table-style-button" aria-label={`Apply ${TABLE_STYLES[style].label} table style`} title={`Apply ${TABLE_STYLES[style].label} table style to selection`} onClick={() => {
              try { formatTable(selectionRanges(gridSelection, gridSize.columns, gridSize.rows), style); setNotice('') } catch (error) { showError(error) }
            }}><span className="table-style-preview" aria-hidden="true" style={{ '--table-header': TABLE_STYLES[style].header, '--table-band': TABLE_STYLES[style].band } as React.CSSProperties}><i /><i /><i /></span><span>{TABLE_STYLES[style].label}</span></button>)}
          </div>
          <span className="ribbon-label">Table styles</span>
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
        <span className="document-name" title={documentInfo.path ?? documentInfo.name}>{documentInfo.name}{dirty ? ' *' : ''}</span>
        {formulaSuggestions.menu && <div className="formula-suggestion-anchor">{formulaSuggestions.menu}</div>}
        {selected?.error && <span className="formula-error" role="alert" title={selected.error}><CircleAlert aria-hidden="true" /> {selected.error}</span>}
      </div>
      <GridCanvas key={gridVersion} initialCell={selectedCell} blocks={blocks} plots={plots} cellFormats={cellFormats ?? {}} columnWidths={columnWidths ?? {}} dark={dark} selectedSymbol={selected?.symbol} onSelect={selectCell} onPickVariable={pickFormulaVariable} onSelectionChange={(selection, columns, rows) => { setGridSelection(selection); setGridSize({ columns, rows }) }} onEmptyDraft={setGridDraft} commitEntryRef={commitEntryRef} onEmptyCommit={createAtCell} onValueEdit={editValue} onResizeBlock={resizeBlock} onClearSelection={clearSelection} onMoveBlocks={moveBlocks} onColumnWidth={setColumnWidth} onRenameBlock={renameBlock} onPlotChange={updatePlot} onPlotRemove={removePlot} onPasteValues={handlePaste} onError={showError} />
    </main>}
    {notice && <div className="status-message" role="status">{noticeIsError && <CircleAlert aria-hidden="true" />} {notice}<button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}
    {pendingAction && <div className="document-dialog-backdrop"><div className="document-dialog" role="dialog" aria-modal="true" aria-labelledby="save-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape') setPendingAction(undefined) }}><h2 id="save-dialog-title">Save changes to {documentInfo.name}?</h2><p>Your changes will be lost if you don’t save them.</p><div className="document-dialog-actions">
      <button autoFocus onClick={() => setPendingAction(undefined)}>Cancel</button>
      <button onClick={() => { const action = pendingAction.run; setPendingAction(undefined); void action() }}>Don’t Save</button>
      <button className="primary" onClick={() => { void (async () => { if (await handleSave()) { const action = pendingAction.run; setPendingAction(undefined); await action() } })() }}>Save</button>
    </div></div></div>}
    {missingFile && <div className="document-dialog-backdrop"><div className="document-dialog" role="dialog" aria-modal="true" aria-labelledby="missing-dialog-title" onKeyDown={(event) => { if (event.key === 'Escape') setMissingFile(undefined) }}><h2 id="missing-dialog-title">File not found</h2><p>{missingFile.name} may have been moved or deleted. Locate it or remove it from the list.</p><div className="document-dialog-actions">
      <button autoFocus onClick={() => setMissingFile(undefined)}>Cancel</button>
      <button onClick={() => { updateRecent(recentRef.current.filter((item) => item.path !== missingFile.path)); setMissingFile(undefined) }}>Remove from List</button>
      <button className="primary" onClick={() => { const old = missingFile; setMissingFile(undefined); void (async () => { try { const file = await loadWorkspace(); if (file) { updateRecent(recentRef.current.filter((item) => item.path !== old.path)); applyDocument(file); if (file.path && old.pinned) updateRecent(recentRef.current.map((item) => item.path === file.path ? { ...item, pinned: true } : item)) } } catch (error) { showError(error) } })() }}>Locate File</button>
    </div></div></div>}
  </>)
}

export default App

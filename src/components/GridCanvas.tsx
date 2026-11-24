import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import DataEditor, { CompactSelection, GridCellKind, type DataEditorRef, type GridCell, type GridColumn, type GridSelection, type Item } from '@glideapps/glide-data-grid'
import '@glideapps/glide-data-grid/dist/index.css'
import type { CellFormat, GridRange, PlotBlock, VariableBlock } from '../types/workspace'
import { selectionRanges, selectedBlockCells, spatialIndex, visibleCellEdges, type CellAddress } from '../engine/spatial'
import { isEmptyValue } from '../engine/missingValues'
import { columnAt, columnOffsets, DEFAULT_COLUMN_WIDTH, nearestColumnEdge } from '../engine/geometry'
import { useFormulaSuggestions } from './FormulaSuggestions'
import { PlotSettingsPanel } from './PlotSettingsPanel'
import { isMatrixPlot, makePlotFigure, plotSettings } from '../engine/plots'

const Plot = lazy(() => import('react-plotly.js'))
const COLUMN_WIDTH = DEFAULT_COLUMN_WIDTH
const ROW_HEIGHT = 34
const COLS = 100
const ROWS = 1000
const LIGHT_THEME = {
  accentColor: '#ac7775',
  accentLight: 'rgba(255, 255, 255, 0.16)',
  accentFg: '#ffffff',
  textDark: '#202020',
  textMedium: '#686868',
  textHeader: '#ededed',
  textHeaderSelected: '#ffffff',
  bgCell: '#ffffff',
  bgCellMedium: '#f8f8f8',
  bgHeader: '#171717',
  bgHeaderHasFocus: '#4a4a4a',
  bgHeaderHovered: '#383838',
  borderColor: '#d8d8d8',
  horizontalBorderColor: '#e0e0e0',
}
const DARK_THEME = {
  ...LIGHT_THEME, accentColor: '#bd9794',
  textDark: '#ece6e5', textMedium: '#c1b6b5', textHeader: '#d6cccc',
  textHeaderSelected: '#ffffff', bgCell: '#242427', bgCellMedium: '#2b2b2f',
  bgHeader: '#171717', bgHeaderHasFocus: '#4a4a4a', bgHeaderHovered: '#383838',
  borderColor: '#494447', horizontalBorderColor: '#403d40',
}

interface Props {
  initialCell: Item
  blocks: Record<string, VariableBlock>
  plots: PlotBlock[]
  cellFormats: Record<string, CellFormat>
  columnWidths: Record<string, number>
  dark: boolean
  selectedSymbol?: string
  onSelect: (item: Item) => void
  onPickVariable: (symbol: string) => boolean
  onSelectionChange: (selection: GridSelection, columns: number, rows: number) => void
  onEmptyDraft: (draft: { item: Item; value: string } | undefined) => void
  onEmptyCommit: (item: Item, value: string) => void
  onValueEdit: (symbol: string, row: number, col: number, value: number) => void
  onResizeBlock: (symbol: string, rows: number, cols: number) => void
  onClearSelection: (cells: CellAddress[], ranges?: GridRange[]) => void
  onMoveBlocks: (symbols: string[], rowDelta: number, colDelta: number) => void
  onColumnWidth: (col: number, width: number) => void
  onRenameBlock: (symbol: string, name: string, newSymbol: string, unit: string) => void
  onPlotChange: (id: string, patch: Partial<Omit<PlotBlock, 'id'>>) => void
  onPlotRemove: (id: string) => void
  onPasteValues: (item: Item, values: readonly (readonly string[])[], address?: CellAddress) => void
  onError: (error: unknown) => void
}

function columnName(index: number): string {
  let value = index + 1
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + value % 26) + result
    value = Math.floor(value / 26)
  }
  return result
}

export function GridCanvas(props: Props) {
  const { initialCell, blocks, plots, cellFormats, columnWidths, dark, selectedSymbol, onSelect, onPickVariable, onSelectionChange, onEmptyDraft, onEmptyCommit, onValueEdit, onResizeBlock, onClearSelection, onMoveBlocks, onColumnWidth, onRenameBlock, onPlotChange, onPlotRemove, onPasteValues, onError } = props
  const gridRef = useRef<DataEditorRef>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const visibleRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ symbol: string; symbols: string[]; start: Item; startX: number; startY: number; target: Item; moved: boolean }>()
  const suppressSelection = useRef(false)
  const resizeRef = useRef<{ symbol: string; x: number; y: number; originX: number; originY: number; rows: number; cols: number }>()
  const columnResizeRef = useRef<{ primary: number; moved: boolean }>()
  const emptyInputRef = useRef<HTMLInputElement>(null)
  const finishingEmpty = useRef(false)
  const [dragTarget, setDragTarget] = useState<Item>()
  const [dragging, setDragging] = useState(false)
  const [previewWidths, setPreviewWidths] = useState<Record<string, number>>({})
  const [resizePreview, setResizePreview] = useState<{ rows: number; cols: number }>()
  const [size, setSize] = useState<{ width: number; height: number }>()
  const [origin, setOrigin] = useState({ x: 48, y: 36 })
  const [editing, setEditing] = useState<{ symbol: string; name: string; newSymbol: string; unit: string }>()
  const [settingsPlotId, setSettingsPlotId] = useState<string>()
  const [emptyEntry, setEmptyEntry] = useState<{ item: Item; value: string; address?: CellAddress }>()
  const entrySuggestions = useFormulaSuggestions(emptyEntry?.value ?? '', Boolean(emptyEntry && !emptyEntry.address && emptyEntry.value.includes('=')), (value) => {
    if (!emptyEntry) return
    const draft = { ...emptyEntry, value }
    setEmptyEntry(draft)
    onEmptyDraft(draft)
  })
  const [selection, setSelection] = useState<GridSelection>({
    current: { cell: initialCell, range: { x: initialCell[0], y: initialCell[1], width: 1, height: 1 }, rangeStack: [] },
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  })
  const addresses = useMemo(() => spatialIndex(blocks), [blocks])
  const columnCount = Math.max(COLS, ...plots.map((plot) => plot.anchor.col + plot.span.cols + 10), ...Object.values(blocks).map((block) => block.anchor.col + (block.data[0]?.length ?? 1) + 10))
  const rowCount = Math.max(ROWS, ...plots.map((plot) => plot.anchor.row + plot.span.rows + 10), ...Object.values(blocks).map((block) => block.anchor.row + block.data.length + 10))
  const widths = useMemo(() => Array.from({ length: columnCount }, (_, index) => previewWidths[index] ?? columnWidths[index] ?? COLUMN_WIDTH), [columnCount, columnWidths, previewWidths])
  const columns = useMemo<GridColumn[]>(() => widths.map((width, index) => ({ id: `column-${index}`, title: columnName(index), width })), [widths])
  const offsets = useMemo(() => columnOffsets(widths), [widths])
  const edgeAt = (col: number) => offsets[col] ?? offsets[offsets.length - 1] + (col - offsets.length + 1) * COLUMN_WIDTH
  const spanWidth = (col: number, span: number) => edgeAt(col + span) - edgeAt(col)

  const refreshBounds = useCallback(() => {
    const shell = shellRef.current
    if (!shell) return
    const scroll = shell.querySelector('.dvn-scroller')
    const rect = shell.getBoundingClientRect()
    const col = Math.max(0, visibleRef.current.x)
    const row = Math.max(0, visibleRef.current.y)
    const bounds = gridRef.current?.getBounds(col, row)
    const x = bounds && Number.isFinite(bounds.x) ? bounds.x - rect.left - offsets[col] : 48 - (scroll?.scrollLeft ?? 0)
    const y = bounds && Number.isFinite(bounds.y) ? bounds.y - rect.top - row * ROW_HEIGHT : 36 - (scroll?.scrollTop ?? 0)
    setOrigin((current) => current.x === x && current.y === y ? current : { x, y })
  }, [offsets])
  useLayoutEffect(() => {
    if (!shellRef.current) return
    const initial = shellRef.current.getBoundingClientRect()
    if (initial.width > 0 && initial.height > 0) setSize({ width: initial.width, height: initial.height })
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) setSize({ width: rect.width, height: rect.height })
      refreshBounds()
    })
    observer.observe(shellRef.current)
    refreshBounds()
    return () => observer.disconnect()
  }, [refreshBounds])

  const boundsAt = (col: number, row: number) => {
    return { x: origin.x + edgeAt(col), y: origin.y + row * ROW_HEIGHT }
  }
  const itemAt = (clientX: number, clientY: number): Item | undefined => {
    const shell = shellRef.current?.getBoundingClientRect()
    if (!shell || clientX < shell.left + 48 || clientY < shell.top + 36 || clientX >= shell.right || clientY >= shell.bottom) return undefined
    const col = columnAt(offsets, clientX - shell.left - origin.x)
    const row = Math.floor((clientY - shell.top - origin.y) / ROW_HEIGHT)
    return col >= 0 && col < columnCount && row >= 0 && row < rowCount ? [col, row] : undefined
  }

  const getCellContent = (item: Item): GridCell => {
    const address = addresses.get(`${item[0]},${item[1]}`)
    const format = cellFormats[`${item[0]},${item[1]}`]
    const style = {
      ...(format?.fillColor ? { bgCell: format.fillColor } : {}),
      ...(format?.textColor ? { textDark: format.textColor } : {}),
      ...(format?.fontSize || format?.bold || format?.italic ? { baseFontStyle: `${format?.italic ? 'italic ' : ''}${format?.bold ? 'bold ' : ''}${format?.fontSize ?? 13}px` } : {}),
    }
    if (!address) return { kind: GridCellKind.Text, data: '', displayData: '', allowOverlay: false, contentAlign: format?.alignment, themeOverride: style }
    const block = blocks[address.symbol]
    const alignment = block.format.alignment ?? format?.alignment
    if (address.role === 'label') {
      const name = block.displayName === block.symbol ? block.displayName : `${block.displayName} (${block.symbol})`
      const text = `${block.mode === 'derived' ? 'ƒ ' : ''}${name}${block.format.unit ? ` · ${block.format.unit}` : ''}`
      return {
        kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: false, cursor: 'grab',
        contentAlign: alignment,
        themeOverride: { bgCell: block.error ? dark ? '#4a3030' : '#f9eae8' : dark ? '#393438' : '#ffffff', textDark: block.error ? dark ? '#ffb6ad' : '#a5362b' : dark ? '#f0dedd' : '#202020', ...style },
      }
    }
    if (address.role === 'ghost') {
      return { kind: GridCellKind.Number, data: undefined, displayData: '+', allowOverlay: true, contentAlign: alignment, themeOverride: { textDark: dark ? '#c1a8a4' : '#a28b89', bgCell: dark ? '#302b2d' : '#ffffff', ...style } }
    }
    const value = isEmptyValue(block, address.row, address.col) ? undefined : block.data[address.row]?.[address.col] ?? 0
    return {
      kind: GridCellKind.Number, data: value, displayData: value === undefined ? '' : formatValue(value, block),
      allowOverlay: true,
      contentAlign: alignment ?? (block.format.alignDecimal ? undefined : 'right'),
      themeOverride: { ...(block.error ? { bgCell: dark ? '#4a3030' : '#f9eae8', textDark: dark ? '#ffb6ad' : '#a5362b' } : block.mode === 'derived' && dark ? { bgCell: '#2e292c' } : {}), ...style },
    }
  }

  const editedBlock = editing && blocks[editing.symbol]
  const entryBounds = emptyEntry && boundsAt(emptyEntry.item[0], emptyEntry.item[1])
  const editBounds = editedBlock && boundsAt(editedBlock.anchor.col, editedBlock.anchor.row)
  const selectedBlock = selectedSymbol ? blocks[selectedSymbol] : undefined
  const settingsPlot = plots.find((plot) => plot.id === settingsPlotId)
  const settingsPlotLeft = settingsPlot ? boundsAt(settingsPlot.anchor.col, settingsPlot.anchor.row).x : 0
  const settingsPlotRight = settingsPlot ? settingsPlotLeft + spanWidth(settingsPlot.anchor.col, settingsPlot.span.cols) : 0
  const panelWidth = Math.min(320, size?.width ?? 0)
  const overlap = (left: number, right: number) => Math.max(0, Math.min(settingsPlotRight, right) - Math.max(settingsPlotLeft, left))
  const settingsSide = overlap(0, panelWidth) < overlap((size?.width ?? 0) - panelWidth, size?.width ?? 0) ? 'left' : 'right'
  const resizeRows = resizePreview?.rows ?? Math.max(1, selectedBlock?.data.length ?? 0)
  const resizeCols = resizePreview?.cols ?? Math.max(1, selectedBlock?.data[0]?.length ?? 0)
  const blockOrigin = selectedBlock && boundsAt(selectedBlock.anchor.col, selectedBlock.anchor.row)
  const blockWidth = resizeCols + (selectedBlock?.labelPlacement === 'left' ? 1 : 0)
  const blockHeight = resizeRows + (selectedBlock?.labelPlacement === 'above' ? 1 : 0)
  const resizeDimensions = (event: React.PointerEvent) => {
    const current = resizeRef.current
    const block = current && blocks[current.symbol]
    if (!current || !block) return undefined
    const startCol = block.anchor.col + (block.labelPlacement === 'left' ? 1 : 0)
    const startRow = block.anchor.row + (block.labelPlacement === 'above' ? 1 : 0)
    return {
      rows: Math.max(1, Math.min(rowCount - startRow, current.rows + Math.round((event.clientY - current.y - (origin.y - current.originY)) / ROW_HEIGHT))),
      cols: Math.max(1, Math.min(columnCount - startCol, nearestColumnEdge(offsets, offsets[startCol + current.cols] + event.clientX - current.x - (origin.x - current.originX)) - startCol)),
    }
  }
  const updateSelection = (next: GridSelection) => {
    setSelection(next)
    onSelectionChange(next, columnCount, rowCount)
  }
  const applyResize = (block: VariableBlock, rows: number, cols: number) => {
    try {
      onResizeBlock(block.symbol, rows, cols)
      const item: Item = [block.anchor.col, block.anchor.row]
      updateSelection({ current: { cell: item, range: { x: item[0], y: item[1], width: 1, height: 1 }, rangeStack: [] }, rows: CompactSelection.empty(), columns: CompactSelection.empty() })
      onSelect(item)
    } catch (error) { onError(error) }
  }
  const finishEmptyEntry = (cancel = false, focusGrid = false) => {
    if (!emptyEntry || finishingEmpty.current) return
    finishingEmpty.current = true
    try {
      if (!cancel && emptyEntry.value.trim()) {
        if (emptyEntry.address) {
          const value = Number(emptyEntry.value)
          if (!Number.isFinite(value)) throw new Error('Enter a finite numeric value.')
          onValueEdit(emptyEntry.address.symbol, emptyEntry.address.row, emptyEntry.address.col, value)
        } else onEmptyCommit(emptyEntry.item, emptyEntry.value)
      }
      setEmptyEntry(undefined)
      onEmptyDraft(undefined)
      if (cancel) onSelect(emptyEntry.item)
      if (focusGrid) requestAnimationFrame(() => gridRef.current?.focus())
    } catch (error) {
      finishingEmpty.current = false
      onError(error)
      const input = emptyInputRef.current
      if (document.activeElement === input) return
      requestAnimationFrame(() => {
        if (finishingEmpty.current || !input || emptyInputRef.current !== input) return
        const item = emptyEntry.item
        updateSelection({ current: { cell: item, range: { x: item[0], y: item[1], width: 1, height: 1 }, rangeStack: [] }, rows: CompactSelection.empty(), columns: CompactSelection.empty() })
        onSelect(item)
        onError(error)
        input.focus()
      })
    }
  }
  return (
    <div
      className={`grid-shell${dragging ? ' dragging-variable' : ''}`}
      ref={shellRef}
      onScrollCapture={(event) => {
        if (!(event.target instanceof HTMLElement) || !event.target.classList.contains('dvn-scroller')) return
        const x = 48 - event.target.scrollLeft
        const y = 36 - event.target.scrollTop
        setOrigin((current) => current.x === x && current.y === y ? current : { x, y })
      }}
      onPointerDownCapture={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest('.dvn-scroller') || event.button !== 0 || event.ctrlKey || event.metaKey) return
        const item = itemAt(event.clientX, event.clientY)
        const address = item && addresses.get(`${item[0]},${item[1]}`)
        if (address && address.role !== 'ghost') {
          const input = emptyInputRef.current
          if (emptyEntry && !emptyEntry.address && emptyEntry.value.includes('=') && input && document.activeElement === input) {
            const start = input.selectionStart ?? input.value.length
            const end = input.selectionEnd ?? start
            const draft = { ...emptyEntry, value: input.value.slice(0, start) + address.symbol + input.value.slice(end) }
            setEmptyEntry(draft)
            onEmptyDraft(draft)
            entrySuggestions.resetHighlight()
            requestAnimationFrame(() => {
              if (document.activeElement === input) input.setSelectionRange(start + address.symbol.length, start + address.symbol.length)
            })
            event.preventDefault()
            event.stopPropagation()
            return
          }
          if (onPickVariable(address.symbol)) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
        }
        if (item && address?.role === 'label') {
          const selectedCells = selectedBlockCells(addresses, selection)
          const inSelection = selectedCells.some((cell) => cell.symbol === address.symbol)
          const symbols = inSelection ? [...new Set(selectedCells.map((cell) => cell.symbol))] : [address.symbol]
          dragRef.current = { symbol: address.symbol, symbols, start: item, startX: event.clientX, startY: event.clientY, target: item, moved: false }
        }
      }}
      onPointerMoveCapture={(event) => {
        const drag = dragRef.current
        if (!drag || !(event.buttons & 1)) return
        if (event.ctrlKey || event.metaKey) {
          dragRef.current = undefined
          suppressSelection.current = false
          setDragTarget(undefined)
          setDragging(false)
          return
        }
        if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5 && !drag.moved) {
          drag.moved = true
          suppressSelection.current = true
          setDragging(true)
        }
        if (!drag.moved) return
        const item = itemAt(event.clientX, event.clientY)
        if (item) { drag.target = item; setDragTarget(item) }
      }}
      onPointerUpCapture={(event) => {
        const drag = dragRef.current
        dragRef.current = undefined
        setDragTarget(undefined)
        setDragging(false)
        if (drag?.moved && !event.ctrlKey && !event.metaKey) {
          try {
            const rowDelta = drag.target[1] - drag.start[1]
            const colDelta = drag.target[0] - drag.start[0]
            onMoveBlocks(drag.symbols, rowDelta, colDelta)
            const item = drag.target
            const others = drag.symbols.filter((symbol) => symbol !== drag.symbol).map((symbol) => ({
              x: blocks[symbol].anchor.col + colDelta, y: blocks[symbol].anchor.row + rowDelta, width: 1, height: 1,
            }))
            updateSelection({ current: { cell: item, range: { x: item[0], y: item[1], width: 1, height: 1 }, rangeStack: others }, rows: CompactSelection.empty(), columns: CompactSelection.empty() })
            onSelect(item)
          } catch (error) { onError(error) }
          setTimeout(() => { suppressSelection.current = false }, 0)
        } else suppressSelection.current = false
      }}
      onPointerCancelCapture={() => { dragRef.current = undefined; suppressSelection.current = false; setDragTarget(undefined); setDragging(false) }}
      onPointerLeave={() => { dragRef.current = undefined; suppressSelection.current = false; setDragTarget(undefined); setDragging(false) }}
    >
      {size && <DataEditor
        ref={gridRef}
        width={size.width}
        height={size.height}
        initialSize={[size.width, size.height]}
        columns={columns}
        rows={rowCount}
        rowHeight={ROW_HEIGHT}
        keybindings={{ delete: 'Backspace|Delete' }}
        rangeSelect="multi-rect"
        theme={dark ? DARK_THEME : LIGHT_THEME}
        getCellContent={getCellContent}
        minColumnWidth={40}
        maxColumnWidth={1000}
        onColumnResizeStart={(_column, _width, col) => { columnResizeRef.current = { primary: col, moved: false } }}
        onColumnResize={(_column, width, col) => {
          const current = columnResizeRef.current
          if (!current) return
          if (col === current.primary) current.moved = true
          if (current.moved) setPreviewWidths((previous) => ({ ...previous, [col]: width }))
        }}
        onColumnResizeEnd={(_column, width, col) => {
          if (columnResizeRef.current?.moved) {
            try { onColumnWidth(col, width) } catch (error) { onError(error) }
          }
          setPreviewWidths((previous) => {
            const next = { ...previous }
            delete next[col]
            return next
          })
          requestAnimationFrame(refreshBounds)
        }}
        onVisibleRegionChanged={(range) => {
          visibleRef.current = { x: range.x, y: range.y }
          requestAnimationFrame(refreshBounds)
        }}
        gridSelection={dragging ? { rows: CompactSelection.empty(), columns: CompactSelection.empty() } : selection}
        onGridSelectionChange={(next) => {
          if (suppressSelection.current) return
          updateSelection(next)
          if (next.current) onSelect(next.current.cell)
        }}
        onCellClicked={(item, event) => {
          if (suppressSelection.current) return
          onSelect(item)
          const address = addresses.get(`${item[0]},${item[1]}`)
          if (event.isDoubleClick && !event.ctrlKey && !event.metaKey && address?.role === 'label') {
            const block = blocks[address.symbol]
            setEditing({ symbol: block.symbol, name: block.displayName, newSymbol: block.symbol, unit: block.format.unit ?? '' })
          }
        }}
        onCellEdited={(item, cell) => {
          const address = addresses.get(`${item[0]},${item[1]}`)
          if (address && address.role !== 'label' && cell.kind === GridCellKind.Number && typeof cell.data === 'number' && Number.isFinite(cell.data)) {
            try { onValueEdit(address.symbol, address.row, address.col, cell.data) } catch (error) { onError(error) }
          }
        }}
        onKeyDown={(event) => {
          const item = selection.current?.cell
          const address = item && addresses.get(`${item[0]},${item[1]}`)
          if (item && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey &&
              (!address || address.role !== 'label' && (address.role === 'ghost' || isEmptyValue(blocks[address.symbol], address.row, address.col)))) {
            event.cancel()
            event.preventDefault()
            onSelect(item)
            const draft = { item, value: event.key, address }
            finishingEmpty.current = false
            setEmptyEntry(draft)
            onEmptyDraft(draft)
          }
        }}
        onDelete={(selection) => {
          onClearSelection(selectedBlockCells(addresses, selection), selectionRanges(selection, columnCount, rowCount))
          return false
        }}
        onPaste={(item, values) => { onPasteValues(item, values, addresses.get(`${item[0]},${item[1]}`)); return false }}
        drawCell={(args, drawContent) => {
          const address = addresses.get(`${args.col},${args.row}`)
          const block = address && blocks[address.symbol]
          const format = cellFormats[`${args.col},${args.row}`]
          if (address?.role === 'value' && block?.format.alignDecimal && !args.cell.contentAlign && args.cell.kind === GridCellKind.Number) {
            const formatted = args.cell.displayData ?? String(args.cell.data ?? '')
            const decimalIndex = formatted.indexOf('.')
            const integer = decimalIndex === -1 ? formatted : formatted.slice(0, decimalIndex)
            const fraction = decimalIndex === -1 ? '' : formatted.slice(decimalIndex)
            const anchorX = args.rect.x + args.rect.width * 0.62
            args.ctx.save()
            args.ctx.beginPath()
            args.ctx.rect(args.rect.x + 1, args.rect.y + 1, args.rect.width - 2, args.rect.height - 2)
            args.ctx.clip()
            args.ctx.font = `${args.cell.themeOverride?.baseFontStyle ?? args.theme.baseFontStyle} ${args.theme.fontFamily}`
            args.ctx.fillStyle = args.cell.themeOverride?.textDark ?? args.theme.textDark
            args.ctx.textBaseline = 'middle'
            args.ctx.textAlign = 'right'
            args.ctx.fillText(integer, anchorX - 2, args.rect.y + args.rect.height / 2)
            args.ctx.textAlign = 'left'
            args.ctx.fillText(fraction, anchorX + 2, args.rect.y + args.rect.height / 2)
            args.ctx.restore()
          } else {
            drawContent()
          }
          if (format?.underline && (args.cell.kind === GridCellKind.Text || args.cell.kind === GridCellKind.Number)) {
            const text = args.cell.displayData ?? ''
            const { x, y, width, height } = args.rect
            args.ctx.save()
            args.ctx.beginPath()
            args.ctx.rect(x + 1, y + 1, width - 2, height - 2)
            args.ctx.clip()
            args.ctx.font = `${args.cell.themeOverride?.baseFontStyle ?? args.theme.baseFontStyle} ${args.theme.fontFamily}`
            let length = Math.min(args.ctx.measureText(text).width, width - 16)
            let left = args.cell.contentAlign === 'right' ? x + width - 8 - length : args.cell.contentAlign === 'center' ? x + (width - length) / 2 : x + 8
            if (address?.role === 'value' && block?.format.alignDecimal && !args.cell.contentAlign) {
              const decimal = text.indexOf('.')
              const integer = decimal < 0 ? text : text.slice(0, decimal)
              const fraction = decimal < 0 ? '' : text.slice(decimal)
              left = x + width * .62 - 2 - args.ctx.measureText(integer).width
              length = args.ctx.measureText(integer).width + 4 + args.ctx.measureText(fraction).width
            }
            args.ctx.strokeStyle = args.cell.themeOverride?.textDark ?? args.theme.textDark
            args.ctx.beginPath()
            args.ctx.moveTo(left, y + height / 2 + (format.fontSize ?? 13) * .48)
            args.ctx.lineTo(left + length, y + height / 2 + (format.fontSize ?? 13) * .48)
            args.ctx.stroke()
            args.ctx.restore()
          }
          const edges = visibleCellEdges(addresses, cellFormats, args.col, args.row)
          if (edges) {
            const { x, y, width, height } = args.rect
            const left = x + 1, right = x + width - 1, top = y + 1, bottom = y + height - 1
            args.ctx.save()
            args.ctx.strokeStyle = format?.borderColor ?? (block?.error ? '#bd5d54' : dark ? '#9a7f7d' : '#c2a3a0')
            args.ctx.lineWidth = format?.borderStyle === 'double' ? 1 : 1.5
            if (format?.borderStyle === 'dashed') args.ctx.setLineDash([5, 3])
            if (format?.borderStyle === 'dotted') args.ctx.setLineDash([1, 2])
            args.ctx.beginPath()
            if (edges.top) { args.ctx.moveTo(x, top); args.ctx.lineTo(x + width, top) }
            if (edges.right) { args.ctx.moveTo(right, y); args.ctx.lineTo(right, y + height) }
            if (edges.bottom) { args.ctx.moveTo(x, bottom); args.ctx.lineTo(x + width, bottom) }
            if (edges.left) { args.ctx.moveTo(left, y); args.ctx.lineTo(left, y + height) }
            args.ctx.stroke()
            if (format?.borderStyle === 'double') {
              args.ctx.beginPath()
              if (edges.top) { args.ctx.moveTo(x, top + 3); args.ctx.lineTo(x + width, top + 3) }
              if (edges.right) { args.ctx.moveTo(right - 3, y); args.ctx.lineTo(right - 3, y + height) }
              if (edges.bottom) { args.ctx.moveTo(x, bottom - 3); args.ctx.lineTo(x + width, bottom - 3) }
              if (edges.left) { args.ctx.moveTo(left + 3, y); args.ctx.lineTo(left + 3, y + height) }
              args.ctx.stroke()
            }
            args.ctx.restore()
          }
          if (address?.role === 'label' && block?.error) {
            const x = args.rect.x + args.rect.width - 11, y = args.rect.y + 11
            args.ctx.save()
            args.ctx.fillStyle = '#b9524c'
            args.ctx.beginPath()
            args.ctx.arc(x, y, 7, 0, Math.PI * 2)
            args.ctx.fill()
            args.ctx.fillStyle = '#ffffff'
            args.ctx.font = 'bold 10px sans-serif'
            args.ctx.textAlign = 'center'
            args.ctx.textBaseline = 'middle'
            args.ctx.fillText('!', x, y + .5)
            args.ctx.restore()
          }
        }}
        getCellsForSelection={true}
        smoothScrollX smoothScrollY
        rowMarkers={{ kind: 'number', width: 48, theme: { bgCell: '#171717', bgCellMedium: '#171717', textLight: '#ededed', borderColor: '#505050', horizontalBorderColor: '#505050' } }}
      />}
      {dragTarget && dragRef.current?.symbols.map((symbol) => {
        const drag = dragRef.current!
        const block = blocks[symbol]
        const col = block.anchor.col + dragTarget[0] - drag.start[0]
        const row = block.anchor.row + dragTarget[1] - drag.start[1]
        if (col < 0 || row < 0) return null
        const position = boundsAt(col, row)
        const cols = (block.data[0]?.length ?? 1) + (block.labelPlacement === 'left' ? 1 : 0)
        const rows = block.data.length + (block.labelPlacement === 'above' ? 1 : 0)
        return <div key={symbol} className="drag-target" style={{ left: position.x, top: position.y, width: spanWidth(col, cols), height: rows * ROW_HEIGHT }} />
      })}
      {emptyEntry && entryBounds && <input
        ref={emptyInputRef}
        autoFocus
        className="grid-entry"
        aria-label={emptyEntry.address ? 'Value entry' : 'New variable entry'}
        aria-autocomplete="list"
        aria-controls={entrySuggestions.controls}
        aria-expanded={Boolean(entrySuggestions.controls)}
        role="combobox"
        spellCheck={false}
        style={{ left: entryBounds.x, top: entryBounds.y, width: spanWidth(emptyEntry.item[0], 1), height: ROW_HEIGHT, textAlign: emptyEntry.address ? blocks[emptyEntry.address.symbol].format.alignment ?? cellFormats[`${emptyEntry.item[0]},${emptyEntry.item[1]}`]?.alignment ?? 'right' : undefined }}
        value={emptyEntry.value}
        onChange={(event) => {
          const draft = { ...emptyEntry, value: event.target.value }
          setEmptyEntry(draft)
          onEmptyDraft(draft)
          entrySuggestions.resetHighlight()
          entrySuggestions.updateCaret(event)
        }}
        onFocus={entrySuggestions.onFocus}
        onSelect={entrySuggestions.updateCaret}
        onKeyDown={(event) => {
          if (entrySuggestions.onKeyDown(event)) return
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            finishEmptyEntry(event.key === 'Escape', true)
          }
        }}
        onBlur={() => { entrySuggestions.onBlur(); finishEmptyEntry() }}
      />}
      {emptyEntry && entryBounds && entrySuggestions.menu && <div className="grid-suggestion-anchor" style={{ left: entryBounds.x, top: entryBounds.y + ROW_HEIGHT + 120 > (size?.height ?? 0) ? entryBounds.y : entryBounds.y + ROW_HEIGHT, transform: entryBounds.y + ROW_HEIGHT + 120 > (size?.height ?? 0) ? 'translateY(-100%)' : undefined }}>{entrySuggestions.menu}</div>}
      {resizePreview && blockOrigin && selectedBlock && <div className="resize-preview" style={{ left: blockOrigin.x, top: blockOrigin.y, width: spanWidth(selectedBlock.anchor.col, blockWidth), height: blockHeight * ROW_HEIGHT }} />}
      {selectedBlock && blockOrigin && !dragging && (
        <button
          type="button"
          className="variable-resize"
          aria-label={`Resize ${selectedBlock.displayName}`}
          title="Drag to resize rows and columns; arrow keys also resize"
          style={{ left: blockOrigin.x + spanWidth(selectedBlock.anchor.col, blockWidth) - 7, top: blockOrigin.y + blockHeight * ROW_HEIGHT - 7 }}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            resizeRef.current = { symbol: selectedBlock.symbol, x: event.clientX, y: event.clientY, originX: origin.x, originY: origin.y, rows: resizeRows, cols: resizeCols }
          }}
          onPointerMove={(event) => {
            const dimensions = resizeDimensions(event)
            if (dimensions) setResizePreview(dimensions)
          }}
          onPointerUp={(event) => {
            const current = resizeRef.current
            const dimensions = resizeDimensions(event)
            resizeRef.current = undefined
            setResizePreview(undefined)
            if (current && dimensions && (dimensions.rows !== current.rows || dimensions.cols !== current.cols)) {
              const block = blocks[current.symbol]
              if (block) applyResize(block, dimensions.rows, dimensions.cols)
            }
          }}
          onPointerCancel={() => { resizeRef.current = undefined; setResizePreview(undefined) }}
          onKeyDown={(event) => {
            const delta = event.key === 'ArrowDown' ? [1, 0] : event.key === 'ArrowUp' ? [-1, 0] : event.key === 'ArrowRight' ? [0, 1] : event.key === 'ArrowLeft' ? [0, -1] : undefined
            if (!delta) return
            event.preventDefault()
            applyResize(selectedBlock, Math.max(1, resizeRows + delta[0]), Math.max(1, resizeCols + delta[1]))
          }}
        />
      )}
      {editing && editBounds && (
        <form className="header-editor" style={{ left: editBounds.x, top: editBounds.y }} onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setEditing(undefined)
            gridRef.current?.focus()
          }
        }} onSubmit={(event) => {
          event.preventDefault()
          try { onRenameBlock(editing.symbol, editing.name, editing.newSymbol.trim(), editing.unit); setEditing(undefined) } catch (error) { onError(error) }
        }}>
          <label>Name <input autoFocus aria-label="Variable name" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
          <label>Symbol <input aria-label="Variable symbol" value={editing.newSymbol} onChange={(event) => setEditing({ ...editing, newSymbol: event.target.value })} /></label>
          <label>Unit <input aria-label="Variable unit" value={editing.unit} onChange={(event) => setEditing({ ...editing, unit: event.target.value })} /></label>
          <div><button type="submit">Apply</button><button type="button" onClick={() => setEditing(undefined)}>Cancel</button></div>
        </form>
      )}
      {plots.map((plot) => {
        const position = boundsAt(plot.anchor.col, plot.anchor.row)
        if (!position) return null
        return <FloatingPlot key={plot.id} plot={plot} blocks={blocks} position={position} offsets={offsets} dark={dark} columnCount={columnCount} rowCount={rowCount} onChange={onPlotChange} onRemove={onPlotRemove} onSettings={() => setSettingsPlotId(plot.id)} onError={onError} />
      })}
      {settingsPlot && <PlotSettingsPanel key={settingsPlotId} plot={settingsPlot} blocks={blocks} side={settingsSide} onChange={onPlotChange} onClose={() => setSettingsPlotId(undefined)} />}
    </div>
  )
}

function FloatingPlot({ plot, blocks, position, offsets, dark, columnCount, rowCount, onChange, onRemove, onSettings, onError }: {
  plot: PlotBlock; blocks: Record<string, VariableBlock>; position: { x: number; y: number }
  offsets: number[]; dark: boolean
  columnCount: number; rowCount: number
  onChange: Props['onPlotChange']; onRemove: Props['onPlotRemove']
  onSettings: () => void; onError: Props['onError']
}) {
  const drag = useRef<{ x: number; y: number; anchor: PlotBlock['anchor']; span: PlotBlock['span']; resize: boolean }>()
  const [preview, setPreview] = useState<{ x: number; y: number; w: number; h: number }>()
  const width = offsets[plot.anchor.col + plot.span.cols] - offsets[plot.anchor.col]
  const height = plot.span.rows * ROW_HEIGHT
  const numericSymbols = Object.keys(blocks)
  const chartType = plotSettings(plot).type
  let figure: ReturnType<typeof makePlotFigure> | undefined
  let plotError = ''
  try { figure = makePlotFigure(plot, blocks, dark) } catch (error) { plotError = error instanceof Error ? error.message : 'Could not render the chart.' }
  const start = (event: React.PointerEvent, resize: boolean) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, anchor: plot.anchor, span: plot.span, resize }
  }
  const move = (event: React.PointerEvent) => {
    if (!drag.current) return
    const dx = event.clientX - drag.current.x
    const dy = event.clientY - drag.current.y
    setPreview(drag.current.resize
      ? { x: 0, y: 0, w: dx, h: dy }
      : { x: dx, y: dy, w: 0, h: 0 })
  }
  const end = (event: React.PointerEvent) => {
    const current = drag.current
    if (!current) return
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (current.resize) {
      onChange(plot.id, { span: { cols: Math.max(2, Math.min(columnCount - plot.anchor.col, nearestColumnEdge(offsets, offsets[current.anchor.col + current.span.cols] + dx) - current.anchor.col)), rows: Math.max(4, Math.min(rowCount - plot.anchor.row, current.span.rows + Math.round(dy / ROW_HEIGHT))) } })
    } else {
      onChange(plot.id, { anchor: { col: Math.max(0, Math.min(columnCount - plot.span.cols, nearestColumnEdge(offsets, offsets[current.anchor.col] + dx))), row: Math.max(0, Math.min(rowCount - plot.span.rows, current.anchor.row + Math.round(dy / ROW_HEIGHT))) } })
    }
    drag.current = undefined
    setPreview(undefined)
  }
  return (
    <div className="floating-plot" style={{ left: position.x + (preview?.x ?? 0), top: position.y + (preview?.y ?? 0), width: Math.max(80, width + (preview?.w ?? 0)), height: Math.max(ROW_HEIGHT * 4, height + (preview?.h ?? 0)) }}>
      <div className="plot-header">
        <div className="plot-drag" title="Drag to move chart" onPointerDown={(event) => start(event, false)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { drag.current = undefined; setPreview(undefined) }}>{plot.title}</div>
        {!isMatrixPlot(chartType) && chartType !== 'histogram' && chartType !== 'box' && <label>X <select aria-label={`${plot.title} X variable`} value={plot.xSymbol} onChange={(event) => onChange(plot.id, { xSymbol: event.target.value })}><option value="">None</option>{numericSymbols.map((symbol) => <option key={symbol}>{symbol}</option>)}</select></label>}
        <label>Y <select aria-label={`${plot.title} Y variable`} value={plot.ySymbol} onChange={(event) => onChange(plot.id, { ySymbol: event.target.value })}><option value="">None</option>{numericSymbols.map((symbol) => <option key={symbol}>{symbol}</option>)}</select></label>
        <button type="button" className="plot-settings-button" title="Plot settings" aria-label={`Plot settings for ${plot.title}`} onClick={onSettings}><Settings2 aria-hidden="true" /></button>
        <button type="button" title="Remove plot" aria-label="Remove plot" onClick={() => onRemove(plot.id)}>×</button>
      </div>
      {plotError || !figure ? (
        <div className="plot-message" role="alert">{plotError}</div>
      ) : (
        <Suspense fallback={<div className="plot-message">Loading chart…</div>}>
          <Plot
            data={figure.data}
            layout={figure.layout}
            config={{ displayModeBar: true, responsive: true }}
            onError={onError}
            useResizeHandler
            className="plot-body"
          />
        </Suspense>
      )}
      <div className="plot-resize" title="Drag to resize chart" onPointerDown={(event) => start(event, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { drag.current = undefined; setPreview(undefined) }} />
    </div>
  )
}

function formatValue(value: number, block: VariableBlock): string {
  const { style, decimals } = block.format
  if (style === 'scientific') return value.toExponential(decimals)
  if (style === 'percent') return `${(value * 100).toFixed(decimals)}%`
  if (style === 'number') return value.toFixed(decimals)
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals }).format(value)
}

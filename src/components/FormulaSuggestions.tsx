import { useId, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { spreadsheetFunctionNames } from '../engine/spreadsheetFunctions'

export function getFormulaSuggestions(value: string, caret: number, enabled: boolean) {
  if (!enabled) return undefined
  const token = value.slice(0, caret).match(/[A-Za-z][A-Za-z0-9_.]*$/)?.[0]
  if (!token || token.length < 2) return undefined
  const matches = spreadsheetFunctionNames.filter((name) => name.startsWith(token.toUpperCase()))
  return matches.length ? { start: caret - token.length, end: caret, matches } : undefined
}

export function useFormulaSuggestions(value: string, enabled: boolean, onChange: (value: string) => void) {
  const id = useId()
  const [caret, setCaret] = useState(0)
  const caretRef = useRef(0)
  const [focused, setFocused] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const suggestions = focused ? getFormulaSuggestions(value, caret, enabled) : undefined
  const updateCaret = (event: SyntheticEvent<HTMLInputElement>) => {
    const position = event.currentTarget.selectionStart ?? event.currentTarget.value.length
    if (caretRef.current !== position) {
      caretRef.current = position
      setCaret(position)
      setHighlight(-1)
    }
  }
  const complete = (name: string, input: HTMLInputElement) => {
    if (!suggestions) return
    const tail = value.slice(suggestions.end)
    const suffix = tail.startsWith('(') ? '' : '('
    const next = value.slice(0, suggestions.start) + name + suffix + tail
    const position = suggestions.start + name.length + 1
    onChange(next)
    caretRef.current = position
    setCaret(position)
    setHighlight(-1)
    requestAnimationFrame(() => { input.focus(); input.setSelectionRange(position, position) })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!suggestions) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setHighlight((current) => event.key === 'ArrowDown'
        ? (current + 1) % suggestions.matches.length
        : current <= 0 ? suggestions.matches.length - 1 : current - 1)
      return true
    }
    if (event.key === 'Tab' || event.key === 'Enter' && highlight >= 0) {
      event.preventDefault()
      event.stopPropagation()
      complete(suggestions.matches[Math.min(suggestions.matches.length - 1, Math.max(0, highlight))], event.currentTarget)
      return true
    }
    return false
  }
  const menu = suggestions && (
    <div className="formula-suggestions" id={id} role="listbox" aria-label="Function suggestions">
      {suggestions.matches.map((name, index) => (
        <button type="button" role="option" aria-selected={highlight === index} key={name}
          onMouseDown={(event) => {
            event.preventDefault()
            const input = document.activeElement
            if (input instanceof HTMLInputElement) complete(name, input)
          }}>{name}()</button>
      ))}
    </div>
  )
  return {
    menu, onKeyDown, updateCaret, resetHighlight: () => setHighlight(-1),
    onFocus: (event: SyntheticEvent<HTMLInputElement>) => { setFocused(true); setHighlight(-1); updateCaret(event) },
    onBlur: () => { setFocused(false); setHighlight(-1) },
    controls: suggestions ? id : undefined,
  }
}

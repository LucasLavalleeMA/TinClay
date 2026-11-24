import { all, create } from 'mathjs'

export const math = create(all)

type Aggregate = (values: number[]) => number

function requireValues(values: number[], minimum = 1): void {
  if (values.length < minimum) {
    throw new Error(minimum === 1 ? 'The function needs at least one numeric value.' : `The function needs at least ${minimum} numeric values.`)
  }
}

function numericResult(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('The function produced a non-finite numeric value.')
  return value
}

const aggregates: Record<string, Aggregate> = {
  SUM: (values) => values.length ? math.sum(values) : 0,
  PRODUCT: (values) => values.length ? math.prod(values) : 0,
  COUNT: (values) => values.length,
  MIN: (values) => values.length ? math.min(values) : 0,
  MAX: (values) => values.length ? math.max(values) : 0,
  AVERAGE: (values) => { requireValues(values); return math.mean(values) },
  MEDIAN: (values) => { requireValues(values); return math.median(values) },
  STDEV: (values) => { requireValues(values, 2); return numericResult(math.std(values)) },
  STDEVP: (values) => { requireValues(values); return numericResult(math.std(values, 'uncorrected')) },
  VAR: (values) => { requireValues(values, 2); return numericResult(math.variance(values)) },
  VARP: (values) => { requireValues(values); return numericResult(math.variance(values, 'uncorrected')) },
}

const aliases: Record<string, string> = {
  ...Object.fromEntries(Object.keys(aggregates).map((name) => [name, name])),
  MEAN: 'AVERAGE',
  AVG: 'AVERAGE',
  STDDEV: 'STDEV',
  'STDEV.S': 'STDEV',
  'STDDEV.S': 'STDEV',
  'STDEV.P': 'STDEVP',
  'STDDEV.P': 'STDEVP',
  STDDEVP: 'STDEVP',
  'VAR.S': 'VAR',
  'VAR.P': 'VARP',
  ROUND: 'ROUND',
  ROUNDUP: 'ROUNDUP',
  ROUNDDOWN: 'ROUNDDOWN',
  PI: 'PI',
  TRIM: 'TRIM',
}

const mathAliases: Record<string, string> = {
  ABS: 'abs', SQRT: 'sqrt', POWER: 'dotPow', MOD: 'mod',
  EXP: 'exp', LN: 'log', LOG10: 'log10',
  SIN: 'sin', COS: 'cos', TAN: 'tan',
  ASIN: 'asin', ACOS: 'acos', ATAN: 'atan',
  MATMEAN: 'mean', MATSUM: 'sum',
}
export const spreadsheetFunctionNames = [...new Set([...Object.keys(aliases), ...Object.keys(mathAliases)])].sort()

function numericValues(args: unknown[]): number[] {
  const values: number[] = []
  const add = (value: unknown) => {
    if (math.isMatrix(value)) {
      add(value.toArray())
    } else if (Array.isArray(value)) {
      value.forEach(add)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      values.push(value)
    } else {
      throw new Error('Spreadsheet functions require finite numeric values.')
    }
  }
  args.forEach(add)
  return values
}

type NumericArray = number | NumericArray[]

function roundValue(value: unknown, digits: unknown, mode: 'round' | 'up' | 'down'): NumericArray {
  if (typeof digits !== 'number' || !Number.isFinite(digits)) throw new Error('Decimal places must be a finite number.')
  const places = Math.trunc(digits)
  const round = (item: unknown): NumericArray => {
    if (math.isMatrix(item)) return round(item.toArray())
    if (Array.isArray(item)) return item.map(round)
    if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error('Rounding requires a finite numeric value.')
    if (places > 308) return item
    if (places < -308) {
      if (mode === 'up' && item !== 0) throw new Error('Rounding produced a non-finite value.')
      return 0
    }
    const shift = (number: number, amount: number) => {
      const [coefficient, exponent = '0'] = number.toString().split('e')
      return Number(`${coefficient}e${Number(exponent) + amount}`)
    }
    const shifted = shift(item, places)
    if (!Number.isFinite(shifted)) return item
    const rounded = mode === 'up' ? Math.sign(shifted) * Math.ceil(Math.abs(shifted))
      : mode === 'down' ? Math.trunc(shifted) : math.round(shifted)
    return numericResult(shift(rounded, -places))
  }
  return round(value)
}

function rounding(mode: 'round' | 'up' | 'down', args: unknown[]): NumericArray {
  if (args.length < 1 || args.length > 2) throw new Error('Rounding requires a value and optional decimal places.')
  return roundValue(args[0], args.length === 2 ? args[1] : 0, mode)
}

function trim(args: unknown[]): NumericArray {
  if (args.length !== 3) throw new Error('TRIM requires data, a start index, and an end index.')
  const [value, start, end] = args
  if (typeof start !== 'number' || !Number.isSafeInteger(start) ||
      typeof end !== 'number' || !Number.isSafeInteger(end) || start < 1 || end < start) {
    throw new Error('TRIM indices must be positive integers with start no greater than end.')
  }
  const data = math.isMatrix(value) ? value.toArray() : value
  if (typeof data === 'number' && Number.isFinite(data)) {
    if (end > 1) throw new Error('TRIM indices exceed the data length.')
    return data
  }
  if (!Array.isArray(data) || data.length === 0) throw new Error('TRIM requires non-empty numeric data.')
  if (data.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    if (end > data.length) throw new Error('TRIM indices exceed the data length.')
    return data.slice(start - 1, end)
  }
  if (data.every((row) => Array.isArray(row) && row.length > 0 &&
      row.length === data[0].length && row.every((item: unknown) => typeof item === 'number' && Number.isFinite(item)))) {
    const rows: number[][] = data
    const length = rows.length === 1 ? rows[0].length : rows.length
    if (end > length) throw new Error('TRIM indices exceed the data length.')
    return rows.length === 1 ? [rows[0].slice(start - 1, end)] : rows.slice(start - 1, end)
  }
  throw new Error('TRIM requires a rectangular array of finite numeric values.')
}

export function spreadsheetFunctionName(name: string): string | undefined {
  const upper = name.toUpperCase()
  const canonical = aliases[upper]
  return canonical ? `__tinclay_${canonical}` : mathAliases[upper]
}

export const spreadsheetFunctions: Record<string, (...args: unknown[]) => NumericArray> = {
  ...Object.fromEntries(
    Object.entries(aggregates).map(([name, aggregate]) => [
      `__tinclay_${name}`,
      (...args: unknown[]) => aggregate(numericValues(args)),
    ]),
  ),
  __tinclay_ROUND: (...args) => rounding('round', args),
  __tinclay_ROUNDUP: (...args) => rounding('up', args),
  __tinclay_ROUNDDOWN: (...args) => rounding('down', args),
  __tinclay_TRIM: (...args) => trim(args),
  __tinclay_PI: (...args) => {
    if (args.length) throw new Error('PI takes no arguments.')
    return Math.PI
  },
}

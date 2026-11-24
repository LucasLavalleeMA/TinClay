export interface RecentFile {
  path: string
  name: string
  modified: number
  accessed: number
  pinned: boolean
}

const key = 'tinclay-recent-files'
const limit = 30

export function readRecentFiles(): RecentFile[] {
  const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
  if (!Array.isArray(value)) throw new Error('Recent file history is invalid.')
  if (!value.every((item): item is RecentFile =>
    item && typeof item.path === 'string' && typeof item.name === 'string' &&
    Number.isFinite(item.modified) && Number.isFinite(item.accessed) && typeof item.pinned === 'boolean')) {
    throw new Error('Recent file history is invalid.')
  }
  return value.slice(0, limit)
}

export function writeRecentFiles(files: RecentFile[]): void {
  localStorage.setItem(key, JSON.stringify(files.slice(0, limit)))
}

export function rememberFile(files: RecentFile[], file: Omit<RecentFile, 'pinned'>): RecentFile[] {
  const previous = files.find((item) => item.path === file.path)
  const updated = [{ ...file, pinned: previous?.pinned ?? false }, ...files.filter((item) => item.path !== file.path)]
  return updated.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.accessed - a.accessed).slice(0, limit)
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`
  if (elapsed < 86_400_000) {
    const hours = Math.floor(elapsed / 3_600_000)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  }
  if (elapsed < 172_800_000) return 'Yesterday'
  return new Date(timestamp).toLocaleDateString()
}

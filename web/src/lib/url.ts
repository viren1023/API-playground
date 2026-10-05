import type { KeyValueRow } from './protocol'

const rowId = () => crypto.randomUUID()

function isPrivateHost(host: string): boolean {
  const hostname = (host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.replace(/:\d+$/, '')).toLowerCase()
  return hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local') ||
    /^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('Enter a URL.')
  const scheme = /^([a-z][a-z\d+.-]*):\/\//i.exec(trimmed)?.[1].toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') throw new Error('Only HTTP and HTTPS URLs are supported.')
  const withScheme = scheme ? trimmed : `${isPrivateHost(trimmed.split(/[/?#]/, 1)[0]) ? 'http' : 'https'}://${trimmed}`
  let parsed: URL
  try { parsed = new URL(withScheme) } catch { throw new Error('Enter a valid URL.') }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only HTTP and HTTPS URLs are supported.')
  return parsed.toString()
}

export function parseParams(input: string): KeyValueRow[] {
  const hashAt = input.indexOf('#')
  const withoutHash = hashAt >= 0 ? input.slice(0, hashAt) : input
  const questionAt = withoutHash.indexOf('?')
  if (questionAt < 0) return []
  const query = withoutHash.slice(questionAt + 1)
  if (!query) return []
  return query.split('&').map((part) => {
    const split = part.indexOf('=')
    const decode = (value: string) => {
      try { return decodeURIComponent(value.replace(/\+/g, ' ')) } catch { return value }
    }
    const rawKey = split < 0 ? part : part.slice(0, split)
    const rawValue = split < 0 ? '' : part.slice(split + 1)
    return { id: rowId(), key: decode(rawKey), value: decode(rawValue), rawKey, rawValue, enabled: true, hasEquals: split >= 0 }
  })
}

function encodePart(value: string): string {
  return value.split(/(\{\{[^{}]+\}\})/g).map((part) => /^\{\{[^{}]+\}\}$/.test(part) ? part : encodeURIComponent(part)).join('')
}

export function writeParams(input: string, rows: KeyValueRow[]): string {
  const hashAt = input.indexOf('#')
  const hash = hashAt >= 0 ? input.slice(hashAt) : ''
  const withoutHash = hashAt >= 0 ? input.slice(0, hashAt) : input
  const questionAt = withoutHash.indexOf('?')
  const base = questionAt >= 0 ? withoutHash.slice(0, questionAt) : withoutHash
  const query = rows.filter((row) => row.enabled).map((row) => {
    const key = row.dirty ? encodePart(row.key) : row.rawKey ?? encodePart(row.key)
    const value = row.dirty ? encodePart(row.value) : row.rawValue ?? encodePart(row.value)
    return row.hasEquals === false && row.value === '' ? key : `${key}=${value}`
  }).join('&')
  return `${base}${query ? `?${query}` : ''}${hash}`
}

export function buildRequestUrl(input: string, rows: KeyValueRow[]): string {
  const normalized = normalizeUrl(input)
  const withoutHash = normalized.split('#', 1)[0]
  const url = new URL(withoutHash)
  const parsedFromInput = parseParams(input)
  const useRows = rows.length ? rows : parsedFromInput
  const query = useRows.filter((row) => row.enabled).map((row) => {
    const key = row.dirty ? encodePart(row.key) : row.rawKey ?? encodePart(row.key)
    const value = row.dirty ? encodePart(row.value) : row.rawValue ?? encodePart(row.value)
    return row.hasEquals === false && row.value === '' ? key : `${key}=${value}`
  }).join('&')
  url.search = query
  return url.toString()
}
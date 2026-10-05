import type { HeaderRow, RequestDraft, WireBody } from './protocol'

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const FORBIDDEN = /^(host|origin|referer|cookie|content-length|connection|accept-encoding|user-agent|upgrade|proxy-.*|sec-.*)$/i

export function validateHeader(name: string, value: string): string | undefined {
  if (!TOKEN.test(name)) return 'Header name contains invalid characters.'
  if (!/^[\x09\x20-\xFF]*$/.test(value)) return 'Header value must contain only tab or Latin-1 characters, without line breaks.'
  return undefined
}

export function isRestrictedHeader(name: string): boolean { return FORBIDDEN.test(name) }

export function enabledHeaders(rows: HeaderRow[]): [string, string][] {
  return rows.filter((row) => row.enabled).map(({ key, value }) => [key, value])
}

export function inferContentType(draft: RequestDraft): string | undefined {
  if (draft.bodyMode === 'json') return 'application/json'
  if (draft.bodyMode === 'urlencoded') return 'application/x-www-form-urlencoded'
  if (draft.bodyMode === 'raw') return undefined
  return undefined
}

export function normalizeHeaders(rows: HeaderRow[], body: WireBody): [string, string][] {
  let hasContentType = false
  const headers = enabledHeaders(rows).filter(([name]) => {
    if (name.toLowerCase() !== 'content-type') return true
    if (body.kind === 'formdata' || hasContentType) return false
    hasContentType = true
    return true
  })
  if (body.kind === 'urlencoded' && !headers.some(([name]) => name.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
  if (body.kind === 'text' && body.contentType && !headers.some(([name]) => name.toLowerCase() === 'content-type')) headers.push(['Content-Type', body.contentType])
  return headers
}
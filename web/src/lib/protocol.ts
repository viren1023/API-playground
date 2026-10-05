export const PROTOCOL_VERSION = 1
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024
export const MAX_RESPONSE_BYTES = 20 * 1024 * 1024

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type ErrorCode = 'NETWORK' | 'TIMEOUT' | 'CANCELLED' | 'INVALID_REQUEST' | 'BODY_TOO_LARGE' | 'EXTENSION_RELOADED' | 'UNKNOWN'

export type WireBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string; contentType?: string }
  | { kind: 'urlencoded'; pairs: [string, string][] }
  | { kind: 'formdata'; parts: Array<{ type: 'text'; key: string; value: string } | { type: 'file'; key: string; filename: string; mime: string; dataBase64: string }> }

export interface WireRequest {
  method: HttpMethod
  url: string
  headers: [string, string][]
  body: WireBody
  timeoutMs: number
}

export interface WireResponse {
  ok: boolean
  status?: number
  statusText?: string
  url?: string
  redirected?: boolean
  headers?: [string, string][]
  bodyBase64?: string
  bodyBytes?: number
  truncated?: boolean
  contentType?: string
  timing?: { ttfbMs: number; totalMs: number }
  error?: { code: ErrorCode; message: string; hint?: string }
  directMode?: boolean
}

export interface KeyValueRow {
  id: string
  key: string
  value: string
  enabled: boolean
  hasEquals?: boolean
  rawKey?: string
  rawValue?: string
  dirty?: boolean
}

export interface HeaderRow extends KeyValueRow {}

export type BodyMode = 'none' | 'json' | 'raw' | 'urlencoded' | 'formdata'
export interface BodyPart {
  id: string
  key: string
  type: 'text' | 'file'
  value: string
  filename?: string
  mime?: string
  dataBase64?: string
  dataAttached?: boolean
}

export interface RequestDraft {
  method: HttpMethod
  url: string
  params: KeyValueRow[]
  headers: HeaderRow[]
  bodyMode: BodyMode
  bodyText: string
  bodyParams: KeyValueRow[]
  formParts: BodyPart[]
  timeoutMs: number
}

export interface SavedTab {
  id: string
  order: number
  name: string
  request: RequestDraft
  updatedAt: number
}
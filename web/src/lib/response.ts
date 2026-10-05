import { parse, stringify } from 'lossless-json'
import { base64ToBytes } from './base64'
import type { WireResponse } from './protocol'

export type BodyType = 'json' | 'html' | 'xml' | 'text' | 'image' | 'binary'

export function decodeBytes(bytes: Uint8Array, contentType = ''): string {
  const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1]
  try { return new TextDecoder(charset || 'utf-8').decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}

export function classifyBody(bytes: Uint8Array, contentType = ''): BodyType {
  const type = contentType.toLowerCase()
  if (type.includes('image/')) return 'image'
  if (type.includes('json')) return 'json'
  if (type.includes('html')) return 'html'
  if (type.includes('xml')) return 'xml'
  if (bytes.subarray(0, 8192).includes(0)) return 'binary'
  if (type.startsWith('text/') || type.includes('javascript') || type.includes('x-www-form-urlencoded')) return 'text'
  return type ? 'binary' : 'text'
}

export function responseBytes(response: WireResponse): Uint8Array {
  return base64ToBytes(response.bodyBase64 ?? '')
}

export function prettyResponse(text: string): string | undefined {
  if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) return undefined
  try { return stringify(parse(text), null, 2) } catch { return undefined }
}
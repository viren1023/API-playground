import { MAX_REQUEST_BYTES, type BodyPart, type HttpMethod, type RequestDraft, type WireBody } from './protocol'

export function toWireBody(draft: RequestDraft): WireBody {
  if (draft.method === 'GET' || draft.method === 'HEAD' || draft.bodyMode === 'none') return { kind: 'none' }
  if (draft.bodyMode === 'json' || draft.bodyMode === 'raw') return { kind: 'text', text: draft.bodyText, contentType: draft.bodyMode === 'json' ? 'application/json' : undefined }
  if (draft.bodyMode === 'urlencoded') return { kind: 'urlencoded', pairs: draft.bodyParams.filter((row) => row.enabled).map(({ key, value }) => [key, value]) }
  return { kind: 'formdata', parts: draft.formParts.filter((part) => part.key || part.value).map((part: BodyPart) => part.type === 'file'
    ? { type: 'file', key: part.key, filename: part.filename ?? '', mime: part.mime ?? 'application/octet-stream', dataBase64: part.dataBase64 ?? '' }
    : { type: 'text', key: part.key, value: part.value }) }
}

export function requestBodySize(body: WireBody): number {
  if (body.kind === 'none') return 0
  if (body.kind === 'text') return new TextEncoder().encode(body.text).length
  if (body.kind === 'urlencoded') return new TextEncoder().encode(new URLSearchParams(body.pairs).toString()).length
  return body.parts.reduce((size, part) => size + new TextEncoder().encode(part.key).length + (part.type === 'text' ? new TextEncoder().encode(part.value).length : Math.floor(part.dataBase64.length * 3 / 4)), 0)
}

export function validateRequestBody(body: WireBody): void {
  if (requestBodySize(body) > MAX_REQUEST_BYTES) throw new Error('Request body exceeds the 25 MB limit.')
}

export function methodCanHaveBody(method: HttpMethod): boolean { return method !== 'GET' && method !== 'HEAD' }
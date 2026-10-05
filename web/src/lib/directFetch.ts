import { bytesToBase64 } from './base64'
import { MAX_RESPONSE_BYTES, type WireRequest, type WireResponse } from './protocol'

function makeBody(request: WireRequest, headers: Headers): BodyInit | undefined {
  const body = request.body
  if (request.method === 'GET' || request.method === 'HEAD' || body.kind === 'none') return undefined
  if (body.kind === 'text') {
    if (body.contentType && !headers.has('content-type')) headers.set('Content-Type', body.contentType)
    return body.text
  }
  if (body.kind === 'urlencoded') {
    if (!headers.has('content-type')) headers.set('Content-Type', 'application/x-www-form-urlencoded')
    return new URLSearchParams(body.pairs).toString()
  }
  headers.delete('content-type')
  const form = new FormData()
  for (const part of body.parts) {
    if (part.type === 'file') {
      const binary = atob(part.dataBase64)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      form.append(part.key, new Blob([bytes], { type: part.mime }), part.filename)
    } else form.append(part.key, part.value)
  }
  return form
}

export async function directFetch(request: WireRequest, signal?: AbortSignal): Promise<WireResponse> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  let timedOut = false
  const timer = request.timeoutMs ? window.setTimeout(() => { timedOut = true; controller.abort() }, request.timeoutMs) : undefined
  const start = performance.now()
  if (signal?.aborted) controller.abort()
  try {
    const headers = new Headers()
    request.headers.forEach(([name, value]) => headers.append(name, value))
    const response = await fetch(request.url, { method: request.method, headers, body: makeBody(request, headers), credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: controller.signal })
    const ttfbMs = performance.now() - start
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    let receivedBytes = 0
    let truncated = false
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        receivedBytes += value.length
        const allowed = MAX_RESPONSE_BYTES - length
        if (value.length > allowed) {
          if (allowed > 0) chunks.push(value.subarray(0, allowed))
          length += Math.max(allowed, 0)
          truncated = true
          await reader.cancel()
          break
        }
        chunks.push(value)
        length += value.length
      }
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    return {
      ok: true, status: response.status, statusText: response.statusText, url: response.url,
      redirected: response.redirected, headers: Array.from(response.headers.entries()),
      bodyBase64: bytesToBase64(bytes), bodyBytes: receivedBytes, truncated,
      contentType: response.headers.get('content-type') || '', directMode: true,
      timing: { ttfbMs, totalMs: performance.now() - start },
    }
  } catch (error) {
    const cancelled = signal?.aborted
    const code = timedOut ? 'TIMEOUT' : cancelled ? 'CANCELLED' : 'NETWORK'
    return { ok: false, directMode: true, error: { code, message: code === 'CANCELLED' ? 'Request cancelled.' : code === 'TIMEOUT' ? 'Request timed out.' : 'Browser direct request failed.', hint: 'Direct mode requires the server to send CORS headers, and an HTTPS page cannot call http:// targets (mixed content).' } }
  } finally {
    if (timer) window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
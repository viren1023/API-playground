const MAX_REQUEST_BYTES = 25 * 1024 * 1024
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const inFlight = new Map()
const NETWORK_HINT = 'Check that the server is running and reachable; try 127.0.0.1 instead of localhost, avoid 0.0.0.0 and Chrome-blocked ports, and verify DNS, VPN, proxy, or TLS settings.'

function post(port, message) {
  try { port.postMessage(message); return true } catch { return false }
}

function invalid(message, code = 'INVALID_REQUEST') {
  const error = new Error(message)
  error.code = code
  return error
}

function validateRequest(payload) {
  if (!payload || !METHODS.has(payload.method)) throw invalid('Unsupported HTTP method.')
  let url
  try { url = new URL(payload.url) } catch { throw invalid('Enter a valid absolute URL.') }
  if (!['http:', 'https:'].includes(url.protocol)) throw invalid('Only HTTP and HTTPS URLs are supported.')
  if (!Array.isArray(payload.headers)) throw invalid('Invalid request headers.')
  for (const pair of payload.headers) {
    if (!Array.isArray(pair) || pair.length !== 2 || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(pair[0]) || !/^[\x09\x20-\xFF]*$/.test(pair[1])) throw invalid('A request header is invalid.')
  }
  if (!payload.body || !['none', 'text', 'urlencoded', 'formdata'].includes(payload.body.kind)) throw invalid('Invalid request body.')
  const size = bodySize(payload.body)
  if (size > MAX_REQUEST_BYTES) throw invalid('Request body exceeds the 25 MB limit.', 'BODY_TOO_LARGE')
  return { ...payload, url: url.href, timeoutMs: Math.max(0, Math.min(300000, Number(payload.timeoutMs) || 0)) }
}

function base64Size(value) { return Math.floor(value.length * 3 / 4) }

function bodySize(body) {
  if (body.kind === 'none') return 0
  if (body.kind === 'text') {
    if (typeof body.text !== 'string') throw invalid('Invalid text body.')
    return new TextEncoder().encode(body.text).length
  }
  if (body.kind === 'urlencoded') {
    if (!Array.isArray(body.pairs) || body.pairs.some((pair) => !Array.isArray(pair) || pair.length !== 2 || pair.some((value) => typeof value !== 'string'))) throw invalid('Invalid URL-encoded body.')
    return new TextEncoder().encode(new URLSearchParams(body.pairs).toString()).length
  }
  if (!Array.isArray(body.parts)) throw invalid('Invalid form-data body.')
  return body.parts.reduce((sum, part) => {
    if (!part || typeof part.key !== 'string') throw invalid('Invalid form-data field.')
    if (part.type === 'file') {
      if (typeof part.filename !== 'string' || typeof part.mime !== 'string' || typeof part.dataBase64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(part.dataBase64)) throw invalid('Invalid form-data file.')
      const padding = part.dataBase64.endsWith('==') ? 2 : part.dataBase64.endsWith('=') ? 1 : 0
      return sum + new TextEncoder().encode(part.key).length + base64Size(part.dataBase64) - padding
    }
    if (part.type !== 'text' || typeof part.value !== 'string') throw invalid('Invalid form-data field.')
    return sum + new TextEncoder().encode(part.key).length + new TextEncoder().encode(part.value).length
  }, 0)
}

function base64ToBytes(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let offset = 0; offset < binary.length; offset += 1) bytes[offset] = binary.charCodeAt(offset)
  return bytes
}

function bytesToBase64(chunks, length) {
  let binary = ''
  const sliceSize = 0x8000
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.length; offset += sliceSize) {
      const view = chunk.subarray(offset, Math.min(offset + sliceSize, chunk.length))
      binary += String.fromCharCode(...view)
    }
  }
  return btoa(binary.slice(0, length))
}

function makeBody(body, headers) {
  if (body.kind === 'none') return undefined
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
    if (part.type === 'file') form.append(part.key, new Blob([base64ToBytes(part.dataBase64)], { type: part.mime }), part.filename)
    else form.append(part.key, part.value)
  }
  return form
}

async function executeRequest(id, payload, port) {
  let request
  try { request = validateRequest(payload) } catch (error) {
    port.postMessage({ type: 'RESULT', id, result: { ok: false, error: { code: error.code || 'INVALID_REQUEST', message: error.message } } })
    return
  }
  const controller = new AbortController()
  const record = { controller, port, cancelled: false, timedOut: false }
  inFlight.set(id, record)
  let timer
  const heartbeat = setInterval(() => {
    if (!post(port, { type: 'HEARTBEAT', id })) controller.abort()
  }, 20000)
  if (request.timeoutMs) timer = setTimeout(() => { record.timedOut = true; controller.abort() }, request.timeoutMs)
  const start = performance.now()
  try {
    const headers = new Headers()
    let contentTypeSeen = false
    for (const [name, value] of request.headers) {
      if (name.toLowerCase() === 'content-type') {
        if (contentTypeSeen) continue
        contentTypeSeen = true
      }
      headers.append(name, value)
    }
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : makeBody(request.body, headers)
    const response = await fetch(request.url, { method: request.method, headers, body, credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: controller.signal })
    const ttfbMs = performance.now() - start
    const chunks = []
    let bodyBytes = 0
    let truncated = false
    if (response.body) {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const remaining = MAX_RESPONSE_BYTES - bodyBytes
        if (value.length > remaining) {
          if (remaining > 0) chunks.push(value.subarray(0, remaining))
          bodyBytes += value.length
          truncated = true
          await reader.cancel()
          break
        }
        chunks.push(value)
        bodyBytes += value.length
      }
    }
    const retainedBytes = chunks.reduce((size, chunk) => size + chunk.length, 0)
    const bytes = new Uint8Array(retainedBytes)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    post(port, {
      type: 'RESULT', id, result: {
        ok: true, status: response.status, statusText: response.statusText, url: response.url,
        redirected: response.redirected, headers: Array.from(response.headers.entries()),
        bodyBase64: bytesToBase64([bytes], bytes.length), bodyBytes, truncated,
        contentType: response.headers.get('content-type') || '',
        timing: { ttfbMs, totalMs: performance.now() - start },
      },
    })
  } catch (error) {
    const aborted = error && error.name === 'AbortError'
    const code = record.timedOut ? 'TIMEOUT' : record.cancelled || aborted ? 'CANCELLED' : error && error.code || 'NETWORK'
    let message = code === 'TIMEOUT' ? 'Request timed out.' : code === 'CANCELLED' ? 'Request cancelled.' : error && error.message || 'Network request failed.'
    if (code === 'NETWORK') message = 'Network request failed.'
    post(port, { type: 'RESULT', id, result: { ok: false, error: { code, message, hint: code === 'NETWORK' ? NETWORK_HINT : undefined } } })
  } finally {
    clearInterval(heartbeat)
    clearTimeout(timer)
    inFlight.delete(id)
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'api-tester') return
  const owned = new Set()
  port.onMessage.addListener((message) => {
    if (message && message.type === 'SEND_REQUEST' && typeof message.id === 'string') {
      owned.add(message.id)
      void executeRequest(message.id, message.payload, port)
    } else if (message && message.type === 'CANCEL_REQUEST' && owned.has(message.id)) {
      const request = inFlight.get(message.id)
      if (request && request.port === port) { request.cancelled = true; request.controller.abort() }
    }
  })
  port.onDisconnect.addListener(() => {
    for (const [id, request] of inFlight) {
      if (request.port === port) { request.cancelled = true; request.controller.abort(); inFlight.delete(id) }
    }
  })
})
import { PROTOCOL_VERSION, type WireRequest, type WireResponse } from './protocol'

export type ExtensionStatus = 'checking' | 'connected' | 'missing' | 'update'
type ExtensionMessage = { source: 'api-tester-ext'; type: string; id?: string; protocol?: number; version?: string; result?: WireResponse }

const pending = new Map<string, { resolve: (response: WireResponse) => void; timer: number }>()
const subscribers = new Set<(status: ExtensionStatus, version?: string) => void>()
let status: ExtensionStatus = 'checking'
let version: string | undefined
let initialized = false
let checkTimer: number | undefined

function publish(next: ExtensionStatus, nextVersion?: string) {
  status = next
  version = nextVersion
  subscribers.forEach((listener) => listener(status, version))
}

function onMessage(event: MessageEvent<ExtensionMessage>) {
  if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'api-tester-ext') return
  const message = event.data
  if (message.type === 'READY' || message.type === 'PONG') {
    window.clearTimeout(checkTimer)
    publish(message.protocol === PROTOCOL_VERSION ? 'connected' : 'update', message.version)
  }
  if (message.type === 'RESULT' && message.id) {
    const item = pending.get(message.id)
    if (!item) return
    window.clearTimeout(item.timer)
    pending.delete(message.id)
    item.resolve(message.result ?? { ok: false, error: { code: 'UNKNOWN', message: 'The extension returned an empty response.' } })
  }
}

function ping() {
  publish('checking', version)
  window.postMessage({ source: 'api-tester-page', type: 'PING' }, location.origin)
  window.clearTimeout(checkTimer)
  checkTimer = window.setTimeout(() => publish('missing'), 1500)
}

export function watchExtension(listener: (status: ExtensionStatus, version?: string) => void): () => void {
  subscribers.add(listener)
  listener(status, version)
  if (!initialized) {
    initialized = true
    window.addEventListener('message', onMessage)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ping() })
    ping()
  }
  return () => subscribers.delete(listener)
}

export function sendViaExtension(request: WireRequest, cancelSignal?: AbortSignal): Promise<WireResponse> {
  const id = crypto.randomUUID()
  const timeoutMs = request.timeoutMs ? request.timeoutMs + 10000 : 300000
  return new Promise((resolve) => {
    const finish = (response: WireResponse) => {
      window.clearTimeout(timer)
      pending.delete(id)
      cancelSignal?.removeEventListener('abort', cancel)
      resolve(response)
    }
    const cancel = () => {
      window.postMessage({ source: 'api-tester-page', type: 'CANCEL_REQUEST', id }, location.origin)
      finish({ ok: false, error: { code: 'CANCELLED', message: 'Request cancelled.' } })
    }
    const timer = window.setTimeout(() => finish({ ok: false, error: { code: 'TIMEOUT', message: 'No response received from the extension before the safety timeout.' } }), timeoutMs)
    pending.set(id, { resolve: finish, timer })
    if (cancelSignal?.aborted) { cancel(); return }
    cancelSignal?.addEventListener('abort', cancel, { once: true })
    window.postMessage({ source: 'api-tester-page', type: 'SEND_REQUEST', id, payload: request }, location.origin)
  })
}
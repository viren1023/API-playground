(() => {
  const VERSION = '1.0.0'
  const PROTOCOL = 1
  const ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    'https://rainbow-torrone-224dfc.netlify.app',
  ]
  if (!ALLOWED_ORIGINS.includes(location.origin)) return

  const ports = new Map()
  const post = (message) => window.postMessage({ source: 'api-tester-ext', ...message }, location.origin)
  const extensionError = (id) => post({ type: 'RESULT', id, result: { ok: false, error: { code: 'EXTENSION_RELOADED', message: 'The extension connection was lost.', hint: 'Reload this page' } } })

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return
    const data = event.data
    if (!data || data.source !== 'api-tester-page') return
    if (data.type === 'PING') {
      post({ type: 'PONG', version: VERSION, protocol: PROTOCOL })
      return
    }
    if (data.type === 'CANCEL_REQUEST') {
      try { ports.get(data.id)?.postMessage({ type: 'CANCEL_REQUEST', id: data.id }) } catch { /* the worker may already be gone */ }
      return
    }
    if (data.type !== 'SEND_REQUEST' || typeof data.id !== 'string') return

    try {
      const port = chrome.runtime.connect({ name: 'api-tester' })
      ports.set(data.id, port)
      port.onMessage.addListener((message) => {
        if (!message || message.id !== data.id) return
        post(message)
        if (message.type === 'RESULT') {
          ports.delete(data.id)
          try { port.disconnect() } catch { /* already disconnected */ }
        }
      })
      port.onDisconnect.addListener(() => {
        ports.delete(data.id)
        try { if (chrome.runtime.lastError) extensionError(data.id) } catch { extensionError(data.id) }
      })
      port.postMessage({ type: 'SEND_REQUEST', id: data.id, payload: data.payload })
    } catch {
      ports.delete(data.id)
      extensionError(data.id)
    }
  })

  post({ type: 'READY', version: VERSION, protocol: PROTOCOL })
})()
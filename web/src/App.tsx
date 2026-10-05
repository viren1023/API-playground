import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Braces, Check, ChevronDown, Copy, Moon, Plus, Send, Sun, X } from 'lucide-react'
import { loadSavedState, saveState } from './db/db'
import { watchExtension, type ExtensionStatus } from './lib/bridge'
import { bytesToBase64 } from './lib/base64'
import { requestBodySize, toWireBody, validateRequestBody } from './lib/body'
import { formatBytes, prettyJson } from './lib/format'
import { normalizeHeaders } from './lib/headers'
import { buildRequestUrl, normalizeUrl, parseParams, writeParams } from './lib/url'
import { sendRequest, validateHeaderRows } from './lib/sendRequest'
import type { BodyMode, BodyPart, HttpMethod, KeyValueRow, RequestDraft, SavedTab } from './lib/protocol'
import { newTab, useTabs } from './store/tabs'
import KeyValueTable from './components/KeyValueTable'
import ResponsePanel from './components/ResponsePanel'

const CodeView = lazy(() => import('./components/CodeView'))

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const bodyModes: { value: BodyMode; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'json', label: 'JSON' }, { value: 'raw', label: 'Raw' },
  { value: 'urlencoded', label: 'URL encoded' }, { value: 'formdata', label: 'Form data' },
]
const defaultHeaders = (rows: KeyValueRow[]) => rows.some((row) => row.enabled && row.key.toLowerCase() === 'content-type')

export default function App() {
  const tabs = useTabs((state) => state.tabs)
  const activeTabId = useTabs((state) => state.activeTabId)
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const responses = useTabs((state) => state.responses)
  const inFlight = useTabs((state) => state.inFlight)
  const theme = useTabs((state) => state.theme)
  const sendMode = useTabs((state) => state.sendMode)
  const restored = useTabs((state) => state.restored)
  const storageError = useTabs((state) => state.storageError)
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>('checking')
  const [extensionVersion, setExtensionVersion] = useState<string>()
  const [panelTab, setPanelTab] = useState<'params' | 'headers' | 'body' | 'settings'>('params')
  const [urlError, setUrlError] = useState('')
  const [sendError, setSendError] = useState('')
  const [renaming, setRenaming] = useState<string>()
  const [nameDraft, setNameDraft] = useState('')

  const request = activeTab.request
  const response = responses[activeTab.id]
  const flight = inFlight[activeTab.id]
  const body = useMemo(() => toWireBody(request), [request])
  const explicitType = defaultHeaders(request.headers)
  const impliedType = body.kind === 'text' ? body.contentType : body.kind === 'urlencoded' ? 'application/x-www-form-urlencoded' : undefined
  const invalidHeader = validateHeaderRows(request.headers)
  const bodyBytes = requestBodySize(body)

  const updateDraft = (next: RequestDraft) => useTabs.getState().updateDraft(activeTab.id, next)
  const patchDraft = (patch: Partial<RequestDraft>) => updateDraft({ ...request, ...patch })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => watchExtension((status, version) => { setExtensionStatus(status); setExtensionVersion(version) }), [])

  useEffect(() => {
    let alive = true
    loadSavedState().then((saved) => {
      if (!alive) return
      if (saved.tabs.length) {
        const restoredTabs = saved.tabs.map((tab) => ({ ...tab, request: { ...tab.request, formParts: (tab.request.formParts ?? []).map((part) => ({ ...part, dataBase64: undefined, dataAttached: false })) } }))
        useTabs.getState().setTabs(restoredTabs, saved.activeTabId)
      }
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      if (saved.theme === 'dark' || saved.theme === 'light') useTabs.getState().setTheme(saved.theme)
      else useTabs.getState().setTheme(systemTheme)
      if (saved.sendMode === 'direct' || saved.sendMode === 'extension') useTabs.getState().setSendMode(saved.sendMode)
      useTabs.getState().markRestored()
    }).catch(() => {
      if (!alive) return
      useTabs.getState().setStorageError(true)
      useTabs.getState().markRestored()
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (!restored) return
    const timer = window.setTimeout(() => {
      saveState(tabs, activeTabId, theme, sendMode).then(() => useTabs.getState().setStorageError(false)).catch(() => useTabs.getState().setStorageError(true))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [tabs, activeTabId, theme, sendMode, restored])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      } else if (event.key === 'Escape' && inFlight[activeTabId]) {
        inFlight[activeTabId]?.abort()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function handleUrlChange(value: string) {
    setUrlError('')
    try {
      const queryRows = parseParams(value)
      patchDraft({ url: value, params: queryRows })
    } catch { patchDraft({ url: value }) }
  }

  function handleParamsChange(rows: KeyValueRow[]) {
    patchDraft({ params: rows, url: writeParams(request.url, rows) })
  }

  async function submit() {
    if (flight) { flight.abort(); return }
    setSendError('')
    try {
      if (invalidHeader) throw new Error(invalidHeader)
      if (request.formParts.some((part) => part.type === 'file' && !part.dataAttached)) throw new Error('Re-attach each saved file before sending this request.')
      let url: string
      try { url = buildRequestUrl(request.url, request.params); setUrlError('') }
      catch (error) { setUrlError(error instanceof Error ? error.message : 'Enter a valid URL.'); throw error }
      const wireBody = toWireBody(request)
      validateRequestBody(wireBody)
      const wireHeaders = normalizeHeaders(request.headers, wireBody)
      const controller = new AbortController()
      useTabs.getState().setFlight(activeTab.id, controller)
      useTabs.getState().setResponse(activeTab.id, undefined)
      const result = await sendRequest({ method: request.method, url, headers: wireHeaders, body: wireBody, timeoutMs: request.timeoutMs }, sendMode, controller.signal)
      useTabs.getState().setResponse(activeTab.id, result)
      useTabs.getState().setFlight(activeTab.id, undefined)
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Request could not be sent.')
      useTabs.getState().setFlight(activeTab.id, undefined)
    }
  }

  function duplicateTab(tab: SavedTab) {
    useTabs.getState().addTab({ ...tab, id: crypto.randomUUID(), name: `${tab.name} copy`, order: tabs.length, updatedAt: Date.now(), request: structuredClone(tab.request) })
  }

  function closeTab(tab: SavedTab) {
    useTabs.getState().inFlight[tab.id]?.abort()
    useTabs.getState().closeTab(tab.id)
  }

  function renameTab(tab: SavedTab) {
    const name = nameDraft.trim()
    if (name) useTabs.setState((state) => ({ tabs: state.tabs.map((item) => item.id === tab.id ? { ...item, name } : item) }))
    setRenaming(undefined)
  }

  function addPart() {
    patchDraft({ formParts: [...request.formParts, { id: crypto.randomUUID(), key: '', type: 'text', value: '' }] })
  }

  async function attachFile(partId: string, file?: File) {
    if (!file) return
    const withoutCurrentPart = { ...request, formParts: request.formParts.filter((part) => part.id !== partId) }
    if (requestBodySize(toWireBody(withoutCurrentPart)) + file.size > 25 * 1024 * 1024) { setSendError('Request body exceeds the 25 MB limit.'); return }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const dataBase64 = bytesToBase64(bytes)
    const parts = request.formParts.map((part) => part.id === partId ? { ...part, filename: file.name, mime: file.type || 'application/octet-stream', dataBase64, dataAttached: true, value: file.name } : part)
    const next = { ...request, formParts: parts }
    try { validateRequestBody(toWireBody(next)); updateDraft(next); setSendError('') }
    catch { setSendError('Request body exceeds the 25 MB limit.'); }
  }

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-icon"><Braces size={18} /></div><div><strong>Request Lab</strong><span>HTTP WORKBENCH</span></div></div>
      <div className="top-controls">
        <div className={`extension-pill ext-${extensionStatus}`}><span className="pulse-dot" />{extensionStatus === 'connected' ? `Connected v${extensionVersion ?? '1.0.0'}` : extensionStatus === 'update' ? 'Update needed' : extensionStatus === 'checking' ? 'Checking bridge' : 'Not detected'}</div>
        <div className="send-mode" aria-label="Send via"><span>Send via</span><button className={sendMode === 'extension' ? 'active' : ''} onClick={() => useTabs.getState().setSendMode('extension')}>Extension</button><button className={sendMode === 'direct' ? 'active' : ''} onClick={() => useTabs.getState().setSendMode('direct')}>Direct</button></div>
        <button className="icon-button theme-toggle" title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => useTabs.getState().setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>
      </div>
    </header>

    {(extensionStatus === 'missing' || extensionStatus === 'update') && <aside className="notice extension-banner"><div><strong>{extensionStatus === 'update' ? 'Extension protocol mismatch' : 'Bridge extension not detected'}</strong><p>Load the unpacked <code>extension</code> folder in Chromium, then reload this page. Direct mode needs CORS enabled on your server.</p></div><button className="subtle-button" onClick={() => useTabs.getState().setSendMode('direct')}>Use browser direct mode</button></aside>}
    {storageError && <aside className="notice storage-banner"><span>Changes won’t be saved because browser storage is unavailable.</span><button className="icon-button" aria-label="Dismiss storage warning" onClick={() => useTabs.getState().setStorageError(false)}><X size={15} /></button></aside>}

    <section className="workspace">
      <div className="tabstrip">
        <div className="request-tabs">
          {tabs.map((tab) => <div className={`request-tab ${tab.id === activeTab.id ? 'active' : ''}`} key={tab.id} onClick={() => useTabs.getState().setActive(tab.id)} onDoubleClick={() => { setRenaming(tab.id); setNameDraft(tab.name) }}>
            <span className={`method-mini method-${tab.request.method.toLowerCase()}`}>{tab.request.method}</span>
            {renaming === tab.id ? <input autoFocus value={nameDraft} onClick={(event) => event.stopPropagation()} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => renameTab(tab)} onKeyDown={(event) => { if (event.key === 'Enter') renameTab(tab); if (event.key === 'Escape') setRenaming(undefined) }} /> : <span className="tab-name">{tab.name}</span>}
            <button className="tab-close duplicate-tab" aria-label="Duplicate request tab" title="Duplicate tab" onClick={(event) => { event.stopPropagation(); duplicateTab(tab) }}><Copy size={12} /></button><button className="tab-close" aria-label="Close request tab" title="Close tab" onClick={(event) => { event.stopPropagation(); closeTab(tab) }}><X size={13} /></button>
          </div>)}
        </div>
        <button className="icon-button new-tab" disabled={tabs.length >= 20} aria-label="New request tab" title="New request tab" onClick={() => useTabs.getState().addTab(newTab())}><Plus size={16} /></button>
        {tabs.length < 20 && <span className="tab-count">{tabs.length}/20</span>}
      </div>

      <div className="panels-grid">
        <section className="request-panel panel">
          <div className="panel-title"><div className="title-mark request-mark" /><h2>Request</h2><span className="autosave"><Check size={12} /> Local workspace</span></div>
          <div className="request-line">
            <label className={`method-select method-${request.method.toLowerCase()}`}><select aria-label="HTTP method" value={request.method} onChange={(event) => patchDraft({ method: event.target.value as HttpMethod })}>{methods.map((method) => <option key={method}>{method}</option>)}</select><ChevronDown size={14} /></label>
            <div className="url-input-wrap"><input className="url-input" aria-label="Request URL" value={request.url} placeholder="https://api.example.com/resource" onChange={(event) => handleUrlChange(event.target.value)} onBlur={() => { if (!request.url.trim()) { setUrlError('Enter a URL.'); return } try { normalizeUrl(request.url); setUrlError('') } catch (error) { setUrlError(error instanceof Error ? error.message : 'Enter a valid URL.') } }} onKeyDown={(event) => { if (event.key === 'Enter') void submit() }} />{urlError && <small className="field-error url-error">{urlError}</small>}</div>
            <button className={`send-button ${flight ? 'cancel' : ''}`} onClick={() => void submit()}>{flight ? <><X size={16} /> Cancel</> : <><Send size={15} /> Send</>}</button>
          </div>
          <div className="request-tabs-bar">{(['params', 'headers', 'body', 'settings'] as const).map((tab) => <button key={tab} className={panelTab === tab ? 'selected' : ''} onClick={() => setPanelTab(tab)}>{tab === 'settings' ? 'Settings' : tab[0].toUpperCase() + tab.slice(1)}{tab === 'params' && request.params.length > 0 && <span className="count">{request.params.length}</span>}{tab === 'headers' && request.headers.length > 0 && <span className="count">{request.headers.length}</span>}</button>)}</div>
          <div className="request-content">
            {panelTab === 'params' && <><div className="content-heading"><div><strong>Query parameters</strong><span>Synced with URL</span></div><span>{request.params.filter((row) => row.enabled).length} active</span></div><KeyValueTable kind="params" rows={request.params} onChange={handleParamsChange} /></>}
            {panelTab === 'headers' && <><div className="content-heading"><div><strong>Request headers</strong><span>Only enabled headers are sent</span></div>{invalidHeader && <span className="invalid-label">Invalid header</span>}</div>{impliedType && !explicitType && <div className="auto-header"><Check size={13} /> Content-Type will be set automatically to <code>{impliedType}</code></div>}<KeyValueTable kind="headers" rows={request.headers} onChange={(rows) => patchDraft({ headers: rows })} /></>}
            {panelTab === 'body' && <div className="body-panel"><div className="content-heading"><div><strong>Request body</strong><span>{formatBytes(bodyBytes)} / 25 MB</span></div><div className="mode-select">{bodyModes.map((mode) => <button key={mode.value} className={request.bodyMode === mode.value ? 'selected' : ''} onClick={() => patchDraft({ bodyMode: mode.value })}>{mode.label}</button>)}</div></div>{!['GET', 'HEAD'].includes(request.method) ? <>
              {request.bodyMode === 'json' && <><div className="editor-toolbar"><span>application/json</span><button className="text-button" onClick={() => { try { patchDraft({ bodyText: prettyJson(request.bodyText) }); setSendError('') } catch { setSendError('Cannot beautify invalid JSON.') } }}><Braces size={14} /> Beautify</button></div><Suspense fallback={<div className="editor-loading">Opening editor…</div>}><CodeView language="json" value={request.bodyText} onChange={(bodyText) => patchDraft({ bodyText })} height="260px" /></Suspense>{(() => { try { JSON.parse(request.bodyText); return null } catch { return <div className="inline-warning">JSON is invalid. The body can still be sent as text.</div> } })()}</>}
              {request.bodyMode === 'raw' && <><div className="editor-toolbar"><span>text/plain</span></div><Suspense fallback={<div className="editor-loading">Opening editor…</div>}><CodeView value={request.bodyText} onChange={(bodyText) => patchDraft({ bodyText })} height="260px" /></Suspense></>}
              {request.bodyMode === 'urlencoded' && <KeyValueTable kind="encoded" rows={request.bodyParams} onChange={(bodyParams) => patchDraft({ bodyParams })} />}
              {request.bodyMode === 'formdata' && <div className="form-parts"><div className="form-part-head"><span>Key</span><span>Type</span><span>Value</span><span /></div>{request.formParts.map((part) => <div className="form-part" key={part.id}><input aria-label="Form key" value={part.key} placeholder="Key" onChange={(event) => patchDraft({ formParts: request.formParts.map((item) => item.id === part.id ? { ...item, key: event.target.value } : item) })} /><select aria-label="Form value type" value={part.type} onChange={(event) => patchDraft({ formParts: request.formParts.map((item) => item.id === part.id ? { ...item, type: event.target.value as 'text' | 'file', value: '', filename: undefined, dataBase64: undefined, dataAttached: false } : item) })}><option value="text">Text</option><option value="file">File</option></select>{part.type === 'file' ? <label className="file-pick">{part.dataAttached ? `${part.filename} · ${formatBytes(Math.floor((part.dataBase64?.length ?? 0) * 3 / 4))}` : 'Re-attach file'}<input type="file" onChange={(event) => void attachFile(part.id, event.target.files?.[0])} /></label> : <input aria-label="Form value" value={part.value} placeholder="Value" onChange={(event) => patchDraft({ formParts: request.formParts.map((item) => item.id === part.id ? { ...item, value: event.target.value } : item) })} />}<button className="icon-button danger-hover" aria-label="Remove form row" onClick={() => patchDraft({ formParts: request.formParts.filter((item) => item.id !== part.id) })}><X size={14} /></button></div>)}<button className="text-button add-row" onClick={addPart}><Plus size={15} /> Add form field</button>{request.formParts.some((part: BodyPart) => part.type === 'file' && !part.dataAttached) && <p className="muted-note">Re-attach file to send this saved request.</p>}</div>}
            </> : <div className="method-body-note">Body is not sent for this method.</div>}</div>}
            {panelTab === 'settings' && <div className="settings-panel"><label htmlFor="timeout">Request timeout</label><div className="timeout-control"><input id="timeout" type="number" min="0" max="300000" step="1000" value={request.timeoutMs} onChange={(event) => patchDraft({ timeoutMs: Math.max(0, Math.min(300000, Number(event.target.value))) })} /><span>ms</span><button className={`timeout-preset ${request.timeoutMs === 0 ? 'selected' : ''}`} onClick={() => patchDraft({ timeoutMs: 0 })}>No timeout</button></div><p>Allowed range: 0 to 300,000 ms.</p></div>}
          </div>
          <footer className="request-footer">{sendError ? <span className="footer-error">{sendError}</span> : <span>Ctrl / ⌘ + Enter to send</span>}<span>{body.kind !== 'none' ? formatBytes(bodyBytes) : 'No request body'}</span></footer>
        </section>
        <ResponsePanel response={response} method={request.method} />
      </div>
    </section>
    <footer className="app-footer"><span><span className="footer-led" /> All request data stays in this browser</span><span>HTTP / HTTPS · Chromium bridge</span></footer>
  </main>
}
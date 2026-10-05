import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, ExternalLink, FileWarning } from 'lucide-react'
import { base64ToBytes } from '../lib/base64'
import { formatBytes, formatMs } from '../lib/format'
import { classifyBody, decodeBytes, prettyResponse } from '../lib/response'
import type { WireResponse } from '../lib/protocol'
import ErrorCard from './ErrorCard'

export default function ResponsePanel({ response, method }: { response?: WireResponse; method: string }) {
  const [tab, setTab] = useState<'body' | 'headers'>('body')
  const [mode, setMode] = useState<'pretty' | 'raw' | 'preview'>('pretty')
  const [copied, setCopied] = useState(false)
  const bytes = useMemo(() => base64ToBytes(response?.bodyBase64 ?? ''), [response?.bodyBase64])
  const contentType = response?.contentType ?? ''
  const type = classifyBody(bytes, contentType)
  const text = useMemo(() => decodeBytes(bytes, contentType), [bytes, contentType])
  const pretty = type === 'json' ? prettyResponse(text) : undefined
  const display = mode === 'pretty' && pretty ? pretty : text
  const noBody = method === 'HEAD' || response?.status === 204 || response?.status === 304 || bytes.length === 0
  const imageUrl = useMemo(() => type === 'image' && bytes.length ? URL.createObjectURL(new Blob([bytes], { type: contentType })) : undefined, [bytes, contentType, type])
  useEffect(() => () => { if (imageUrl) URL.revokeObjectURL(imageUrl) }, [imageUrl])
  useEffect(() => { if (response) { setTab('body'); setMode(response.contentType?.toLowerCase().startsWith('image/') ? 'preview' : 'pretty') } }, [response])

  const download = () => {
    const blob = new Blob([bytes], { type: contentType || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `response${type === 'json' ? '.json' : type === 'html' ? '.html' : type === 'image' ? '.image' : '.txt'}`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return <section className="response-panel panel">
    <div className="panel-title response-title"><div className="title-mark response-mark" /><h2>Response</h2>{response?.ok && <div className="response-metrics"><span className={`status status-${Math.floor((response.status ?? 0) / 100)}`}>{response.status} {response.statusText}</span><span>{formatMs(response.timing?.totalMs ?? 0)}</span><span>{formatBytes(response.bodyBytes ?? bytes.length)}</span></div>}</div>
    {!response ? <div className="empty-response"><div className="empty-glyph"><ExternalLink size={22} /></div><h3>Waiting for a response</h3><p>Send a request to inspect its status, headers, and body.</p></div> : !response.ok ? <ErrorCard response={response} /> : <>
      {response.truncated && <div className="notice compact-notice"><FileWarning size={15} /> Response exceeded 20 MB; showing the first 20 MB.</div>}
      {response.redirected && <div className="redirect-line">Redirected to <a href={response.url} target="_blank" rel="noreferrer">{response.url}</a></div>}
      <div className="response-tabs"><div className="tab-group"><button className={tab === 'body' ? 'active' : ''} onClick={() => setTab('body')}>Body</button><button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}>Headers <span className="count">{response.headers?.length ?? 0}</span></button></div>{tab === 'body' && !noBody && <div className="body-actions">{type !== 'binary' && <button className="icon-button" title="Copy response" aria-label="Copy response" onClick={() => void copy()}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>}<button className="icon-button" title="Download response" aria-label="Download response" onClick={download}><Download size={15} /></button></div>}</div>
      {tab === 'body' ? noBody ? <div className="no-body">No body</div> : type === 'binary' ? <div className="binary-notice"><FileWarning size={18} /><div><strong>Binary response</strong><span>{formatBytes(bytes.length)} · {contentType || 'unknown content type'}</span></div><button className="icon-button" title="Copy response text" aria-label="Copy response text" onClick={() => void copy()}><Copy size={15} /></button><button className="subtle-button" onClick={download}><Download size={14} /> Download</button></div> : <>
        <div className="view-switch">{type !== 'image' && <><button className={mode === 'pretty' ? 'selected' : ''} onClick={() => setMode('pretty')}>Pretty</button><button className={mode === 'raw' ? 'selected' : ''} onClick={() => setMode('raw')}>Raw</button></>}{(type === 'html' || type === 'image') && <button className={mode === 'preview' ? 'selected' : ''} onClick={() => setMode('preview')}>Preview</button>}</div>
        {type === 'json' && mode === 'pretty' && !pretty && <div className="notice compact-notice">Response is over 5 MB or invalid JSON; showing raw text.</div>}
        {mode === 'preview' && type === 'html' ? <iframe className="html-preview" title="Sandboxed HTML response" sandbox="" srcDoc={text} /> : mode === 'preview' && type === 'image' && imageUrl ? <div className="image-preview"><img src={imageUrl} alt="Response preview" /></div> : <pre className="response-code">{display}</pre>}
      </> : <div className="headers-view">{response.directMode && <div className="notice compact-notice">Browser direct mode exposes only CORS-approved response headers.</div>}<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>{response.headers?.map(([name, value], index) => <tr key={`${name}-${index}`}><td>{name}</td><td>{value}</td></tr>)}</tbody></table><p className="muted-note">Set-Cookie headers are never exposed to JavaScript.</p></div>}
      <div className="size-note">Decoded body size; compressed Content-Length may differ.</div>
    </>}
  </section>
}
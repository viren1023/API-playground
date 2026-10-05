import { Copy, TriangleAlert } from 'lucide-react'
import type { WireResponse } from '../lib/protocol'

const networkHints = [
  'Is the server running, and on that port?',
  'Try 127.0.0.1 instead of localhost; a server bound only to IPv4 or IPv6 can fail on the other.',
  '0.0.0.0 is not a valid address to call. Use 127.0.0.1.',
  'Self-signed HTTPS certificates fail; use HTTP locally or trust the certificate.',
  'Chrome blocks some ports such as 6000, 6665-6669, and 10080.',
  'For public hosts, check DNS, VPN, or proxy settings.',
]

export default function ErrorCard({ response }: { response: WireResponse }) {
  const error = response.error
  const hints = [...(error?.hint ? [error.hint] : []), ...(error?.code === 'NETWORK' ? networkHints : [])]
  const copy = async () => navigator.clipboard.writeText([error?.code, error?.message, ...hints].filter(Boolean).join('\n'))
  return <div className="error-card"><div className="error-heading"><TriangleAlert size={18} /><div><strong>{error?.message ?? 'Request failed.'}</strong><span>{error?.code ?? 'UNKNOWN'}</span></div></div>{hints.length > 0 && <ul>{hints.map((hint) => <li key={hint}>{hint}</li>)}</ul>}<button className="subtle-button" onClick={() => void copy()}><Copy size={14} /> Copy details</button></div>
}
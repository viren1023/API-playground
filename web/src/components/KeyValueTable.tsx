import { Plus, Trash2, TriangleAlert } from 'lucide-react'
import type { KeyValueRow } from '../lib/protocol'
import { isRestrictedHeader, validateHeader } from '../lib/headers'

interface Props {
  rows: KeyValueRow[]
  onChange: (rows: KeyValueRow[]) => void
  kind: 'params' | 'headers' | 'encoded'
}

const createRow = (): KeyValueRow => ({ id: crypto.randomUUID(), key: '', value: '', enabled: true, hasEquals: true, dirty: true })

export default function KeyValueTable({ rows, onChange, kind }: Props) {
  const labels = kind === 'headers' ? ['Header', 'Value'] : ['Key', 'Value']
  const update = (id: string, field: 'key' | 'value' | 'enabled', value: string | boolean) => onChange(rows.map((row) => row.id === id ? { ...row, [field]: value, dirty: true } : row))
  return (
    <div className="kv-wrap">
      <table className="kv-table">
        <thead><tr><th aria-label="Enabled" /><th>{labels[0]}</th><th>{labels[1]}</th><th aria-label="Actions" /></tr></thead>
        <tbody>
          {rows.map((row) => {
            const error = kind === 'headers' ? validateHeader(row.key, row.value) : undefined
            const restricted = kind === 'headers' && isRestrictedHeader(row.key)
            return <tr key={row.id} className={!row.enabled ? 'row-disabled' : error ? 'row-invalid' : ''}>
              <td><input aria-label={`Enable ${row.key || 'row'}`} type="checkbox" checked={row.enabled} onChange={(event) => update(row.id, 'enabled', event.target.checked)} /></td>
              <td><div className="kv-key-wrap"><input aria-label={labels[0]} value={row.key} placeholder="Key" onChange={(event) => update(row.id, 'key', event.target.value)} />{restricted && <span className="header-warning" title="The browser may ignore this header."><TriangleAlert size={14} /></span>}</div></td>
              <td><input aria-label={labels[1]} value={row.value} placeholder="Value" onChange={(event) => update(row.id, 'value', event.target.value)} />{error && <small className="field-error">{error}</small>}</td>
              <td><button className="icon-button danger-hover" aria-label="Delete row" title="Delete row" onClick={() => onChange(rows.filter((item) => item.id !== row.id))}><Trash2 size={15} /></button></td>
            </tr>
          })}
        </tbody>
      </table>
      <button className="text-button add-row" onClick={() => onChange([...rows, createRow()])}><Plus size={15} /> Add {kind === 'headers' ? 'header' : 'parameter'}</button>
    </div>
  )
}
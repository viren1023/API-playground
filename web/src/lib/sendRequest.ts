import { validateRequestBody } from './body'
import { sendViaExtension } from './bridge'
import { directFetch } from './directFetch'
import { validateHeader } from './headers'
import type { HeaderRow, WireRequest, WireResponse } from './protocol'

export type SendMode = 'extension' | 'direct'

export async function sendRequest(request: WireRequest, mode: SendMode, signal?: AbortSignal): Promise<WireResponse> {
  try {
    for (const [name, value] of request.headers) {
      const error = validateHeader(name, value)
      if (error) throw new Error(error)
    }
    validateRequestBody(request.body)
    if (mode === 'extension') return await sendViaExtension(request, signal)
    return await directFetch(request, signal)
  } catch (error) {
    return { ok: false, error: { code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : 'Invalid request.' } }
  }
}

export function validateHeaderRows(rows: HeaderRow[]): string | undefined {
  for (const row of rows) {
    if (!row.enabled) continue
    const error = validateHeader(row.key, row.value)
    if (error) return error
  }
  return undefined
}
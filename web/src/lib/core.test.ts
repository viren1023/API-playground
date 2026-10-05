import { describe, expect, it } from 'vitest'
import { bytesToBase64, base64ToBytes } from './base64'
import { toWireBody } from './body'
import { isRestrictedHeader, normalizeHeaders, validateHeader } from './headers'
import { formatBytes, prettyJson } from './format'
import { classifyBody, decodeBytes } from './response'
import { buildRequestUrl, normalizeUrl, parseParams, writeParams } from './url'
import type { RequestDraft } from './protocol'

const draft = (overrides: Partial<RequestDraft> = {}): RequestDraft => ({ method: 'POST', url: '', params: [], headers: [], bodyMode: 'none', bodyText: '', bodyParams: [], formParts: [], timeoutMs: 30000, ...overrides })

describe('URL utilities', () => {
  it('infers local and public schemes and rejects unsafe schemes', () => {
    expect(normalizeUrl('localhost:3000/ping')).toBe('http://localhost:3000/ping')
    expect(normalizeUrl('10.0.0.4/api')).toBe('http://10.0.0.4/api')
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
    expect(() => normalizeUrl('file:///etc/passwd')).toThrow(/HTTP and HTTPS/)
  })
  it('preserves duplicate, empty, key-only params and fragments', () => {
    const rows = parseParams('https://example.com/?a=1&a=&flag#section')
    expect(rows).toHaveLength(3)
    expect(writeParams('https://example.com/?old=1#section', rows)).toBe('https://example.com/?a=1&a=&flag#section')
    expect(parseParams('https://example.com/#section?not-a-query')).toEqual([])
    expect(buildRequestUrl('https://example.com/?path=a%2Fb&space=a+b&flag#section', parseParams('https://example.com/?path=a%2Fb&space=a+b&flag#section')))
      .toBe('https://example.com/?path=a%2Fb&space=a+b&flag')
  })
})

describe('headers and bodies', () => {
  it('validates header syntax and identifies browser-restricted names', () => {
    expect(validateHeader('X-Trace', 'ok')).toBeUndefined()
    expect(validateHeader('Bad Name', 'x')).toBeDefined()
    expect(validateHeader('X-Test', 'bad\r\nvalue')).toBeDefined()
    expect(isRestrictedHeader('Sec-Fetch-Site')).toBe(true)
  })
  it('omits GET bodies and serializes encoded pairs', () => {
    expect(toWireBody(draft({ method: 'GET', bodyMode: 'json', bodyText: '{}' }))).toEqual({ kind: 'none' })
    expect(toWireBody(draft({ bodyMode: 'urlencoded', bodyParams: [{ id: '1', key: 'a', value: 'b', enabled: true }] }))).toEqual({ kind: 'urlencoded', pairs: [['a', 'b']] })
    expect(normalizeHeaders([{ id: '1', key: 'Content-Type', value: 'a', enabled: true }, { id: '2', key: 'content-type', value: 'b', enabled: true }], { kind: 'text', text: '' })).toEqual([['Content-Type', 'a']])
  })
})

describe('format and response helpers', () => {
  it('handles base64 round trips and readable sizes', () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array()))).toEqual(new Uint8Array())
    expect(base64ToBytes(bytesToBase64(new Uint8Array([239])))).toEqual(new Uint8Array([239]))
    const sample = crypto.getRandomValues(new Uint8Array(4096))
    expect(base64ToBytes(bytesToBase64(sample))).toEqual(sample)
    const large = Uint8Array.from({ length: 5 * 1024 * 1024 }, (_, index) => index % 251)
    const decoded = base64ToBytes(bytesToBase64(large))
    let matches = decoded.length === large.length
    for (let index = 0; matches && index < large.length; index += 1) matches = decoded[index] === large[index]
    expect(matches).toBe(true)
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(prettyJson('{"id":9007199254740993}')).toContain('9007199254740993')
  })
  it('keeps large JSON integers intact and decodes legacy charsets', () => {
    expect(prettyJson('{"id":9007199254740993}')).toContain('9007199254740993')
    expect(decodeBytes(new Uint8Array([0xe9]), 'text/plain; charset=iso-8859-1')).toBe('é')
    expect(decodeBytes(new Uint8Array([0x61]), 'text/plain; charset=unknown-charset')).toBe('a')
    expect(classifyBody(new Uint8Array([0, 1]), 'application/octet-stream')).toBe('binary')
  })
})
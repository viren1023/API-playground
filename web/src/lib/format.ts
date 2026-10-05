import { parse, stringify } from 'lossless-json'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; value >= 1024 && index < units.length; index += 1) { value /= 1024; unit = units[index] }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`
}

export function formatMs(ms: number): string { return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s` }

export function prettyJson(text: string): string {
  const value = parse(text)
  return stringify(value, null, 2) ?? text
}
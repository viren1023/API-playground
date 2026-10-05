import { create } from 'zustand'
import type { RequestDraft, SavedTab, WireResponse } from '../lib/protocol'
import type { SendMode } from '../lib/sendRequest'

const newId = () => crypto.randomUUID()
export const newRequest = (): RequestDraft => ({
  method: 'GET', url: 'http://127.0.0.1:3000/ping', params: [], headers: [], bodyMode: 'none',
  bodyText: '{\n  "message": "hello"\n}', bodyParams: [], formParts: [], timeoutMs: 30000,
})
export const newTab = (name = 'New request'): SavedTab => ({ id: newId(), order: 0, name, request: newRequest(), updatedAt: Date.now() })

interface TabsState {
  tabs: SavedTab[]
  activeTabId: string
  responses: Record<string, WireResponse | undefined>
  inFlight: Record<string, AbortController | undefined>
  theme: 'light' | 'dark'
  sendMode: SendMode
  restored: boolean
  storageError: boolean
  setTabs: (tabs: SavedTab[], activeTabId?: string) => void
  markRestored: () => void
  setStorageError: (value: boolean) => void
  setTheme: (theme: 'light' | 'dark') => void
  setSendMode: (mode: SendMode) => void
  setActive: (id: string) => void
  updateDraft: (id: string, request: RequestDraft) => void
  addTab: (tab?: SavedTab) => void
  closeTab: (id: string) => void
  setResponse: (id: string, response?: WireResponse) => void
  setFlight: (id: string, controller?: AbortController) => void
}

export const useTabs = create<TabsState>((set) => {
  const first = newTab()
  return {
    tabs: [first], activeTabId: first.id, responses: {}, inFlight: {}, theme: 'dark', sendMode: 'extension', restored: false, storageError: false,
    setTabs: (tabs, activeTabId) => set({ tabs: tabs.length ? tabs : [newTab()], activeTabId: activeTabId && tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id ?? newTab().id }),
    markRestored: () => set({ restored: true }),
    setStorageError: (storageError) => set({ storageError }),
    setTheme: (theme) => set({ theme }),
    setSendMode: (sendMode) => set({ sendMode }),
    setActive: (activeTabId) => set({ activeTabId }),
    updateDraft: (id, request) => set((state) => ({ tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, request, updatedAt: Date.now() } : tab) })),
    addTab: (tab = newTab()) => set((state) => state.tabs.length >= 20 ? {} : ({ tabs: [...state.tabs, { ...tab, order: state.tabs.length }], activeTabId: tab.id })),
    closeTab: (id) => set((state) => {
      if (state.tabs.length === 1) return { tabs: [{ ...newTab(), id }], responses: { ...state.responses, [id]: undefined }, inFlight: { ...state.inFlight, [id]: undefined } }
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      return { tabs, activeTabId: state.activeTabId === id ? tabs[Math.max(0, state.tabs.findIndex((tab) => tab.id === id) - 1)].id : state.activeTabId, responses: { ...state.responses, [id]: undefined }, inFlight: { ...state.inFlight, [id]: undefined } }
    }),
    setResponse: (id, response) => set((state) => ({ responses: { ...state.responses, [id]: response } })),
    setFlight: (id, controller) => set((state) => ({ inFlight: { ...state.inFlight, [id]: controller } })),
  }
})
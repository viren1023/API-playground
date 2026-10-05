import Dexie, { type Table } from 'dexie'
import type { RequestDraft, SavedTab } from '../lib/protocol'

interface MetaRecord { key: string; value: unknown }

class ApiTesterDatabase extends Dexie {
  tabs!: Table<SavedTab, string>
  meta!: Table<MetaRecord, string>

  constructor() {
    super('api-tester')
    this.version(1).stores({ tabs: 'id, order, name, updatedAt', meta: 'key' })
  }
}

export const database = new ApiTesterDatabase()

export async function loadSavedState(): Promise<{ tabs: SavedTab[]; activeTabId?: string; theme?: string; sendMode?: string }> {
  const [tabs, records] = await Promise.all([database.tabs.orderBy('order').toArray(), database.meta.toArray()])
  const values = Object.fromEntries(records.map(({ key, value }) => [key, value]))
  return { tabs, activeTabId: values.activeTabId as string | undefined, theme: values.theme as string | undefined, sendMode: values.sendMode as string | undefined }
}

function persistableDraft(request: RequestDraft): RequestDraft {
  return { ...request, formParts: request.formParts.map(({ dataBase64: _data, ...part }) => part) }
}

export async function saveState(tabs: SavedTab[], activeTabId: string, theme: string, sendMode: string): Promise<void> {
  await database.transaction('rw', database.tabs, database.meta, async () => {
    await database.tabs.bulkPut(tabs.map((tab, index) => ({ ...tab, order: index, request: persistableDraft(tab.request), updatedAt: Date.now() })))
    await database.tabs.where('id').noneOf(tabs.map((tab) => tab.id)).delete()
    await database.meta.bulkPut([{ key: 'activeTabId', value: activeTabId }, { key: 'theme', value: theme }, { key: 'sendMode', value: sendMode }])
  })
}
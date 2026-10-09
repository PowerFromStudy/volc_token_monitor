/**
 * 持久化存储
 * 基于 electron-store，存储账号、席位、设置、激活席位
 */
import Store from 'electron-store'
import type { VolcAccount, Seat, AppSettings } from '../../shared/types'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { KeyManager } from '../services/key-manager'

interface StoreSchema {
  accountsRaw: string      // KeyManager 的 JSON (加密)
  seats: Seat[]
  settings: AppSettings
  activeSeatId?: string
}

export class AppStore {
  private store: Store<StoreSchema>
  keyManager: KeyManager

  constructor() {
    this.store = new Store<StoreSchema>({
      name: 'volc-token-monitor',
      defaults: {
        accountsRaw: '{}',
        seats: [],
        settings: DEFAULT_SETTINGS
      }
    })
    this.keyManager = new KeyManager(this.store.get('accountsRaw'))
  }

  // ---------- 账号 ----------
  listAccounts(): VolcAccount[] {
    return this.keyManager.list()
  }

  addAccount(account: Omit<VolcAccount, 'id' | 'createdAt'> & { id?: string }): VolcAccount {
    const a = this.keyManager.add(account)
    this.persistAccounts()
    return a
  }

  updateAccount(id: string, patch: Partial<VolcAccount>): VolcAccount | undefined {
    const a = this.keyManager.update(id, patch)
    this.persistAccounts()
    return a
  }

  removeAccount(id: string): boolean {
    const ok = this.keyManager.remove(id)
    if (ok) this.persistAccounts()
    return ok
  }

  private persistAccounts() {
    this.store.set('accountsRaw', this.keyManager.toJSON())
  }

  // ---------- 席位 ----------
  getSeats(): Seat[] {
    return this.store.get('seats')
  }

  setSeats(seats: Seat[]) {
    this.store.set('seats', seats)
  }

  upsertSeat(seat: Seat) {
    const seats = this.getSeats()
    const idx = seats.findIndex(s => s.seatId === seat.seatId)
    if (idx >= 0) seats[idx] = seat
    else seats.push(seat)
    this.setSeats(seats)
  }

  removeSeatsByAccount(accountId: string) {
    const seats = this.getSeats().filter(s => s.accountId !== accountId)
    this.setSeats(seats)
  }

  // ---------- 设置 ----------
  getSettings(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...this.store.get('settings') }
  }

  setSettings(settings: Partial<AppSettings>) {
    const cur = this.getSettings()
    this.store.set('settings', { ...cur, ...settings })
  }

  // ---------- 激活席位 ----------
  getActiveSeatId(): string | undefined {
    return this.store.get('activeSeatId')
  }

  setActiveSeatId(id: string | undefined) {
    if (id) this.store.set('activeSeatId', id)
    else this.store.delete('activeSeatId')
  }
}

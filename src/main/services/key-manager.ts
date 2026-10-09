/**
 * Key 管理服务 - 加密存储多账号的 AK/SK
 * 使用 AES-256-GCM，密钥从机器指纹派生
 */
import crypto from 'node:crypto'
import { machineIdSync } from 'node-machine-id'
import type { VolcAccount } from '../../shared/types'

const ALGO = 'aes-256-gcm'

/** 从机器 GUID + 用户名派生 32 字节密钥 */
function deriveKey(): Buffer {
  const mid = machineIdSync()
  const user = process.env.USERNAME || process.env.USER || 'default'
  return crypto.scryptSync(`${mid}:${user}:volc-token-monitor`, 'volc-salt', 32)
}

function encrypt(plaintext: string): string {
  const key = deriveKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // iv(12) + tag(16) + ciphertext，base64
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

function decrypt(ciphertext: string): string {
  const key = deriveKey()
  const buf = Buffer.from(ciphertext, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = crypto.createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}

/** 账号存储结构 (明文字段 + 加密 AK/SK) */
interface StoredAccount {
  id: string
  name: string
  accessKeyEnc: string
  secretKeyEnc: string
  edition: 'personal' | 'team'
  remark?: string
  createdAt: number
}

export class KeyManager {
  private store: Record<string, StoredAccount> = {}

  constructor(raw?: string) {
    if (raw) {
      try { this.store = JSON.parse(raw) } catch { this.store = {} }
    }
  }

  toJSON(): string {
    return JSON.stringify(this.store, null, 2)
  }

  /** 列出所有账号 (解密 AK/SK) */
  list(): VolcAccount[] {
    return Object.values(this.store).map(a => ({
      id: a.id,
      name: a.name,
      accessKey: decrypt(a.accessKeyEnc),
      secretKey: decrypt(a.secretKeyEnc),
      edition: a.edition,
      remark: a.remark,
      createdAt: a.createdAt
    }))
  }

  get(id: string): VolcAccount | undefined {
    const a = this.store[id]
    if (!a) return undefined
    return {
      id: a.id,
      name: a.name,
      accessKey: decrypt(a.accessKeyEnc),
      secretKey: decrypt(a.secretKeyEnc),
      edition: a.edition,
      remark: a.remark,
      createdAt: a.createdAt
    }
  }

  add(account: Omit<VolcAccount, 'id' | 'createdAt'> & { id?: string }): VolcAccount {
    const id = account.id || crypto.randomUUID()
    const stored: StoredAccount = {
      id,
      name: account.name,
      accessKeyEnc: encrypt(account.accessKey),
      secretKeyEnc: encrypt(account.secretKey),
      edition: account.edition,
      remark: account.remark,
      createdAt: Date.now()
    }
    this.store[id] = stored
    return this.get(id)!
  }

  update(id: string, patch: Partial<Pick<VolcAccount, 'name' | 'accessKey' | 'secretKey' | 'edition' | 'remark'>>): VolcAccount | undefined {
    const a = this.store[id]
    if (!a) return undefined
    if (patch.name !== undefined) a.name = patch.name
    if (patch.accessKey !== undefined) a.accessKeyEnc = encrypt(patch.accessKey)
    if (patch.secretKey !== undefined) a.secretKeyEnc = encrypt(patch.secretKey)
    if (patch.edition !== undefined) a.edition = patch.edition
    if (patch.remark !== undefined) a.remark = patch.remark
    return this.get(id)
  }

  remove(id: string): boolean {
    if (!this.store[id]) return false
    delete this.store[id]
    return true
  }
}

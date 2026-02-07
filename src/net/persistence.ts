import type { KoiKoiGameState } from '../engine/game'

export type CheckpointRole = 'host' | 'guest'

export interface CheckpointPayload {
  readonly version: number
  readonly state: KoiKoiGameState
  readonly updatedAt: number
  readonly role: CheckpointRole
}

export const CHECKPOINT_KEY_PREFIX = 'hanafuda:p2p:checkpoint'
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000

function getCheckpointKey(roomId: string): string {
  return `${CHECKPOINT_KEY_PREFIX}:${roomId}`
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return null
    }
    return globalThis.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isCheckpointRole(value: unknown): value is CheckpointRole {
  return value === 'host' || value === 'guest'
}

function isValidUpdatedAt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseCheckpointPayload(value: unknown): CheckpointPayload | null {
  if (!isRecord(value)) {
    return null
  }

  const { version, state, updatedAt, role } = value
  if (!isNonNegativeInteger(version)) {
    return null
  }
  if (state === undefined) {
    return null
  }
  if (!isValidUpdatedAt(updatedAt)) {
    return null
  }
  if (!isCheckpointRole(role)) {
    return null
  }

  return {
    version,
    state: state as KoiKoiGameState,
    updatedAt,
    role,
  }
}

export function saveCheckpoint(roomId: string, payload: CheckpointPayload): void {
  const storage = getLocalStorage()
  if (!storage || roomId.length === 0) {
    return
  }

  if (
    !isNonNegativeInteger(payload.version) ||
    payload.state === undefined ||
    !isValidUpdatedAt(payload.updatedAt) ||
    !isCheckpointRole(payload.role)
  ) {
    return
  }

  try {
    storage.setItem(getCheckpointKey(roomId), JSON.stringify(payload))
  } catch {
    // Ignore unavailable storage / quota errors.
  }
}

export function loadCheckpoint(roomId: string): CheckpointPayload | null {
  const storage = getLocalStorage()
  if (!storage || roomId.length === 0) {
    return null
  }

  const key = getCheckpointKey(roomId)
  const raw = storage.getItem(key)
  if (raw === null) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const checkpoint = parseCheckpointPayload(parsed)
  if (!checkpoint) {
    return null
  }

  if (Date.now() - checkpoint.updatedAt > CHECKPOINT_TTL_MS) {
    return null
  }

  return checkpoint
}

export function clearCheckpoint(roomId: string): void {
  const storage = getLocalStorage()
  if (!storage || roomId.length === 0) {
    return
  }

  try {
    storage.removeItem(getCheckpointKey(roomId))
  } catch {
    // Ignore unavailable storage errors.
  }
}

export type SessionMode = 'p2p-host' | 'p2p-guest' | 'cpu'

export interface SessionMeta {
  readonly mode: SessionMode
  readonly roomId?: string
  readonly updatedAt: number
}

const SESSION_KEY = 'hanafuda:p2p:session'

export function saveSessionMeta(meta: SessionMeta): void {
  const storage = getLocalStorage()
  if (!storage) return
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(meta))
  } catch {
    // ignore quota / unavailable
  }
}

export function loadSessionMeta(): SessionMeta | null {
  const storage = getLocalStorage()
  if (!storage) return null
  const raw = storage.getItem(SESSION_KEY)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    const { mode, roomId, updatedAt } = parsed
    if (mode !== 'p2p-host' && mode !== 'p2p-guest' && mode !== 'cpu') return null
    if (roomId !== undefined && typeof roomId !== 'string') return null
    if (!isValidUpdatedAt(updatedAt)) return null
    return { mode, roomId, updatedAt }
  } catch {
    return null
  }
}

export function clearSessionMeta(): void {
  const storage = getLocalStorage()
  if (!storage) return
  try {
    storage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

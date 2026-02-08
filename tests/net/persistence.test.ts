import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNewGame } from '../../src/engine/game'
import {
  CHECKPOINT_TTL_MS,
  clearCheckpoint,
  loadLastGuestRoomId,
  loadLastHostRoomId,
  loadCheckpoint,
  saveCheckpoint,
  saveLastGuestRoomId,
  saveLastHostRoomId,
  type CheckpointPayload,
} from '../../src/net/persistence'

const ROOM_ID = 'room-001'
const HOST_STORAGE_KEY = `hanafuda:p2p:checkpoint:host:${ROOM_ID}`

function createPayload(overrides: Partial<CheckpointPayload> = {}): CheckpointPayload {
  return {
    version: 1,
    state: createNewGame(),
    updatedAt: Date.now(),
    role: 'host',
    ...overrides,
  }
}

beforeEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('checkpoint persistence', () => {
  it('supports save/load roundtrip', () => {
    const payload = createPayload()

    saveCheckpoint(ROOM_ID, payload)
    const loaded = loadCheckpoint(ROOM_ID, 'host')

    expect(loaded).toEqual(payload)
  })

  it('clears stored checkpoint', () => {
    saveCheckpoint(ROOM_ID, createPayload())
    clearCheckpoint(ROOM_ID, 'host')

    expect(loadCheckpoint(ROOM_ID, 'host')).toBeNull()
  })

  it('ignores broken JSON safely', () => {
    localStorage.setItem(HOST_STORAGE_KEY, '{broken-json')

    const run = () => loadCheckpoint(ROOM_ID, 'host')
    expect(run).not.toThrow()
    expect(run()).toBeNull()
  })

  it('invalidates checkpoints past 24h ttl', () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-07T10:00:00.000Z')
    vi.setSystemTime(now)

    saveCheckpoint(
      ROOM_ID,
      createPayload({
        updatedAt: now.getTime() - CHECKPOINT_TTL_MS - 1,
      }),
    )

    expect(loadCheckpoint(ROOM_ID, 'host')).toBeNull()
  })

  it('guards non-negative integer version', () => {
    saveCheckpoint(
      ROOM_ID,
      createPayload({
        version: -1,
      }),
    )

    expect(localStorage.getItem(HOST_STORAGE_KEY)).toBeNull()
    expect(loadCheckpoint(ROOM_ID, 'host')).toBeNull()
  })
})

describe('last host room id persistence', () => {
  it('supports save/load roundtrip', () => {
    saveLastHostRoomId('ROOM-ABC123')

    expect(loadLastHostRoomId()).toBe('ROOM-ABC123')
  })

  it('trims whitespace and rejects empty values', () => {
    saveLastHostRoomId('   ')
    expect(loadLastHostRoomId()).toBe('')

    saveLastHostRoomId('  ROOM-XYZ789  ')
    expect(loadLastHostRoomId()).toBe('ROOM-XYZ789')
  })
})

describe('last guest room id persistence', () => {
  it('supports save/load roundtrip', () => {
    saveLastGuestRoomId('ROOM-GUEST001')

    expect(loadLastGuestRoomId()).toBe('ROOM-GUEST001')
  })

  it('trims whitespace and rejects empty values', () => {
    saveLastGuestRoomId('   ')
    expect(loadLastGuestRoomId()).toBe('')

    saveLastGuestRoomId('  ROOM-GUEST002  ')
    expect(loadLastGuestRoomId()).toBe('ROOM-GUEST002')
  })
})

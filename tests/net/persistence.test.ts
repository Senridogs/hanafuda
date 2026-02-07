import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNewGame } from '../../src/engine/game'
import {
  CHECKPOINT_TTL_MS,
  clearCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  type CheckpointPayload,
} from '../../src/net/persistence'

const ROOM_ID = 'room-001'
const STORAGE_KEY = `hanafuda:p2p:checkpoint:${ROOM_ID}`

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
    const loaded = loadCheckpoint(ROOM_ID)

    expect(loaded).toEqual(payload)
  })

  it('clears stored checkpoint', () => {
    saveCheckpoint(ROOM_ID, createPayload())
    clearCheckpoint(ROOM_ID)

    expect(loadCheckpoint(ROOM_ID)).toBeNull()
  })

  it('ignores broken JSON safely', () => {
    localStorage.setItem(STORAGE_KEY, '{broken-json')

    const run = () => loadCheckpoint(ROOM_ID)
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

    expect(loadCheckpoint(ROOM_ID)).toBeNull()
  })

  it('guards non-negative integer version', () => {
    saveCheckpoint(
      ROOM_ID,
      createPayload({
        version: -1,
      }),
    )

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(loadCheckpoint(ROOM_ID)).toBeNull()
  })
})

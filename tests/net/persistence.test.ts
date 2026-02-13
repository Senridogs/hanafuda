import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createNewGame } from '../../src/engine/game'
import {
  CHECKPOINT_TTL_MS,
  CPU_CHECKPOINT_TTL_MS,
  MATCH_RECORD_KEY,
  PREFERRED_ROUND_COUNT_KEY,
  clearMatchRecords,
  clearCpuCheckpoint,
  clearCheckpoint,
  loadCpuCheckpoint,
  loadLastGuestRoomId,
  loadLastHostRoomId,
  loadCheckpoint,
  loadMatchRecords,
  loadPreferredRoundCount,
  recordMatchResult,
  saveCpuCheckpoint,
  saveCheckpoint,
  saveLastGuestRoomId,
  saveLastHostRoomId,
  savePreferredRoundCount,
  type MatchRecordInput,
  type CpuCheckpointPayload,
  type CheckpointPayload,
} from '../../src/net/persistence'

const ROOM_ID = 'room-001'
const HOST_STORAGE_KEY = `hanafuda:p2p:checkpoint:host:${ROOM_ID}`
const CPU_STORAGE_KEY = 'hanafuda:cpu:checkpoint'
const LEGACY_MATCH_RECORD_KEY = 'hanafuda:match-records'

function createPayload(overrides: Partial<CheckpointPayload> = {}): CheckpointPayload {
  return {
    version: 1,
    state: createNewGame(),
    updatedAt: Date.now(),
    role: 'host',
    ...overrides,
  }
}

function createCpuPayload(overrides: Partial<CpuCheckpointPayload> = {}): CpuCheckpointPayload {
  return {
    state: createNewGame(),
    updatedAt: Date.now(),
    isMatchSurfaceVisible: true,
    ...overrides,
  }
}

function createMatchRecordInput(overrides: Partial<MatchRecordInput> = {}): MatchRecordInput {
  return {
    mode: 'cpu',
    opponentName: 'COM（ふつう）',
    maxRounds: 6,
    playedRounds: 6,
    result: 'win',
    localPlayerId: 'player1',
    player1Name: 'あなた',
    player2Name: 'COM',
    player1Score: 18,
    player2Score: 9,
    roundScoreHistory: [
      { round: 1, player1Points: 6, player2Points: 0 },
      { round: 2, player1Points: 0, player2Points: 3 },
      { round: 3, player1Points: 6, player2Points: 0 },
      { round: 4, player1Points: 0, player2Points: 3 },
      { round: 5, player1Points: 3, player2Points: 0 },
      { round: 6, player1Points: 3, player2Points: 0 },
    ],
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

describe('cpu checkpoint persistence', () => {
  it('supports save/load roundtrip', () => {
    const payload = createCpuPayload()

    saveCpuCheckpoint(payload)
    const loaded = loadCpuCheckpoint()

    expect(loaded).toEqual(payload)
  })

  it('clears stored cpu checkpoint', () => {
    saveCpuCheckpoint(createCpuPayload())
    clearCpuCheckpoint()

    expect(loadCpuCheckpoint()).toBeNull()
  })

  it('ignores malformed payload safely', () => {
    localStorage.setItem(CPU_STORAGE_KEY, JSON.stringify({
      state: createNewGame(),
      updatedAt: Date.now(),
      isMatchSurfaceVisible: 'yes',
    }))

    expect(loadCpuCheckpoint()).toBeNull()
  })

  it('invalidates cpu checkpoint past ttl', () => {
    vi.useFakeTimers()
    const now = new Date('2026-02-07T10:00:00.000Z')
    vi.setSystemTime(now)

    saveCpuCheckpoint(createCpuPayload({
      updatedAt: now.getTime() - CPU_CHECKPOINT_TTL_MS - 1,
    }))

    expect(loadCpuCheckpoint()).toBeNull()
  })
})

describe('preferred round count persistence', () => {
  it('supports save/load roundtrip', () => {
    savePreferredRoundCount(6)
    expect(loadPreferredRoundCount()).toBe(6)
  })

  it('supports plain legacy numeric payload', () => {
    localStorage.setItem('hanafuda:max-rounds', '12')
    expect(loadPreferredRoundCount()).toBe(12)
    expect(loadPreferredRoundCount()).toBe(12)
  })

  it('rejects invalid values safely', () => {
    localStorage.setItem(PREFERRED_ROUND_COUNT_KEY, JSON.stringify({ roundCount: 5 }))
    expect(loadPreferredRoundCount()).toBeNull()
  })
})

describe('match record persistence', () => {
  it('records and loads match history in descending completed order', () => {
    const first = recordMatchResult(createMatchRecordInput({
      completedAt: new Date('2026-02-10T10:00:00.000Z').getTime(),
      result: 'loss',
    }))
    const second = recordMatchResult(createMatchRecordInput({
      completedAt: new Date('2026-02-11T10:00:00.000Z').getTime(),
      result: 'win',
    }))

    const loaded = loadMatchRecords()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(loaded).toHaveLength(2)
    expect(loaded[0]?.result).toBe('win')
    expect(loaded[1]?.result).toBe('loss')
  })

  it('clears stored match records', () => {
    recordMatchResult(createMatchRecordInput())
    clearMatchRecords()
    expect(loadMatchRecords()).toEqual([])
  })

  it('migrates legacy array payload safely', () => {
    const legacyEntry = {
      ...createMatchRecordInput(),
      id: 'legacy-id-1',
      completedAt: Date.now(),
    }
    localStorage.setItem(LEGACY_MATCH_RECORD_KEY, JSON.stringify([legacyEntry]))

    const loaded = loadMatchRecords()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]?.id).toBe('legacy-id-1')
    expect(localStorage.getItem(MATCH_RECORD_KEY)).not.toBeNull()
  })

  it('ignores malformed match payload safely', () => {
    localStorage.setItem(MATCH_RECORD_KEY, '{broken-json')
    expect(loadMatchRecords()).toEqual([])
  })
})

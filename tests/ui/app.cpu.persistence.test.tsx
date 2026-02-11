import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KoiKoiGameState } from '../../src/engine/game'
import { createNewGame } from '../../src/engine/game'

type PeerEvent = 'open' | 'connection' | 'close' | 'disconnected' | 'error'
type ConnectionEvent = 'open' | 'data' | 'close' | 'error'

class MockDataConnection {
  readonly open = false
  private readonly handlers: Record<ConnectionEvent, Array<(...args: unknown[]) => void>> = {
    open: [],
    data: [],
    close: [],
    error: [],
  }

  on(event: ConnectionEvent, handler: (...args: unknown[]) => void): void {
    this.handlers[event].push(handler)
  }

  send(payload: unknown): void {
    void payload
    // no-op
  }

  close(): void {
    for (const handler of this.handlers.close) {
      handler()
    }
  }
}

class MockPeer {
  readonly id: string
  private readonly handlers: Record<PeerEvent, Array<(...args: unknown[]) => void>> = {
    open: [],
    connection: [],
    close: [],
    disconnected: [],
    error: [],
  }

  constructor(id?: string) {
    this.id = id ?? `peer-${Math.random().toString(36).slice(2, 8)}`
    queueMicrotask(() => {
      for (const handler of this.handlers.open) {
        handler(this.id)
      }
    })
  }

  on(event: PeerEvent, handler: (...args: unknown[]) => void): void {
    this.handlers[event].push(handler)
  }

  connect(): MockDataConnection {
    return new MockDataConnection()
  }

  destroy(): void {
    for (const handler of this.handlers.close) {
      handler()
    }
  }
}

vi.mock('peerjs', () => ({
  Peer: MockPeer,
}))

import App from '../../src/App'

const CPU_CHECKPOINT_KEY = 'hanafuda:cpu:checkpoint'

function saveCpuCheckpoint(state: KoiKoiGameState): void {
  window.localStorage.setItem(
    CPU_CHECKPOINT_KEY,
    JSON.stringify({
      state,
      updatedAt: Date.now(),
      isMatchSurfaceVisible: true,
    }),
  )
}

function createCpuGameState(overrides: Partial<KoiKoiGameState> = {}): KoiKoiGameState {
  const base = createNewGame({
    maxRounds: 6,
    enableAI: true,
    aiDifficulty: 'futsuu',
    player1Name: 'あなた',
    player2Name: 'COM',
  })
  return {
    ...base,
    ...overrides,
    config: {
      ...base.config,
      ...(overrides.config ?? {}),
    },
  }
}

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('App cpu checkpoint persistence', () => {
  it('restores cpu match progress after reload', async () => {
    saveCpuCheckpoint(createCpuGameState({ round: 2 }))
    render(<App />)

    await waitFor(() => {
      expect(screen.getByLabelText('対局ボード')).toBeTruthy()
    })
    expect(screen.queryByLabelText('対戦待機中')).toBeNull()
    expect(screen.getByText('第 2 / 6 月')).toBeTruthy()
  })

  it('clears cpu checkpoint when starting a multiplayer match', async () => {
    saveCpuCheckpoint(createCpuGameState({ round: 2 }))
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '部屋を作る' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '部屋を作る' }))

    await waitFor(() => {
      expect(window.localStorage.getItem(CPU_CHECKPOINT_KEY)).toBeNull()
    })
  })

  it('clears cpu checkpoint when the saved match is already finished', async () => {
    saveCpuCheckpoint(createCpuGameState({
      phase: 'gameOver',
      round: 6,
      winner: 'player1',
      roundWinner: 'player1',
      roundReason: 'stop',
      roundPoints: 6,
      roundScoreHistory: [
        { round: 1, player1Points: 6, player2Points: 0 },
        { round: 2, player1Points: 0, player2Points: 3 },
        { round: 3, player1Points: 6, player2Points: 0 },
        { round: 4, player1Points: 0, player2Points: 3 },
        { round: 5, player1Points: 3, player2Points: 0 },
        { round: 6, player1Points: 6, player2Points: 0 },
      ],
    }))
    render(<App />)

    await waitFor(() => {
      expect(window.localStorage.getItem(CPU_CHECKPOINT_KEY)).toBeNull()
    })
  })
})

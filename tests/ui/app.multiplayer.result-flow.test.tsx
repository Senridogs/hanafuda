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

  send(_payload: unknown): void {
    // no-op in tests
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

function createGuestGameOverSnapshot(): KoiKoiGameState {
  const base = createNewGame({
    targetScore: 50,
    maxRounds: 3,
    enableAI: false,
    aiDifficulty: 'futsuu',
    player1Name: 'P1',
    player2Name: 'P2',
  })
  return {
    ...base,
    phase: 'gameOver',
    config: {
      ...base.config,
      maxRounds: 3,
      enableAI: false,
      player1Name: 'P1',
      player2Name: 'P2',
    },
    round: 3,
    winner: 'player1',
    roundWinner: 'player1',
    roundPoints: 8,
    roundReason: 'stop',
    players: [
      {
        ...base.players[0],
        name: 'P1',
        score: 18,
        hand: [],
        captured: [],
        completedYaku: [],
      },
      {
        ...base.players[1],
        name: 'P2',
        score: 9,
        hand: [],
        captured: [],
        completedYaku: [],
      },
    ],
    roundScoreHistory: [
      { round: 1, player1Points: 10, player2Points: 0 },
      { round: 2, player1Points: 0, player2Points: 9 },
      { round: 3, player1Points: 8, player2Points: 0 },
    ],
  }
}

function setupGuestGameOverSession(): void {
  const roomId = 'ROOM-RESULT'
  const snapshot = createGuestGameOverSnapshot()
  window.localStorage.setItem('hanafuda:p2p:last-guest-room-id', roomId)
  window.localStorage.setItem(
    `hanafuda:p2p:checkpoint:guest:${roomId}`,
    JSON.stringify({
      role: 'guest',
      version: 5,
      updatedAt: Date.now(),
      state: snapshot,
    }),
  )
  window.sessionStorage.setItem(
    'hanafuda:p2p:session',
    JSON.stringify({
      mode: 'p2p-guest',
      roomId,
      updatedAt: Date.now(),
    }),
  )
}

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('App multiplayer game-over result flow', () => {
  it('shows last-month summary first and uses 最終結果へ before final overlay', async () => {
    setupGuestGameOverSession()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '月が終了しました' })).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: '最終結果へ' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '次の月へ' })).toBeNull()
    expect(screen.queryByRole('heading', { name: '対局終了' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '最終結果へ' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '対局終了' })).toBeTruthy()
    })
  })

  it('maps final score table rows to player1/player2 correctly on guest screen', async () => {
    setupGuestGameOverSession()
    const { container } = render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '最終結果へ' })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: '最終結果へ' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '対局終了' })).toBeTruthy()
    })

    const rowLabels = Array.from(container.querySelectorAll('.score-table .score-table-player'))
      .map((node) => node.textContent?.trim())
    expect(rowLabels).toEqual(['相手', 'あなた'])

    const totalCells = Array.from(container.querySelectorAll('.score-table tbody .score-table-total'))
      .map((node) => node.textContent?.trim())
    expect(totalCells).toEqual(['18点', '9点'])
  })
})

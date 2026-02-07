import { describe, expect, it } from 'vitest'
import { getCardById } from '../../src/engine/cards'
import type { KoiKoiGameState } from '../../src/engine/game'
import { DEFAULT_CONFIG, type Player } from '../../src/engine/types'
import type {
  ActionMessage,
  NetMessage,
  PlayerId,
  StateMessage,
  TurnCommand,
} from '../../src/net/protocol'
import { GuestSession, HostSession, applyTurnCommand } from '../../src/net/session'
import type { PeerTransport } from '../../src/net/transport.peer'

function card(id: string) {
  const found = getCardById(id)
  if (!found) {
    throw new Error(`Unknown card id: ${id}`)
  }
  return found
}

function createBaseState(): KoiKoiGameState {
  const player1: Player = {
    id: 'player1',
    name: 'あなた',
    hand: [card('jan-hikari')],
    captured: [],
    score: 0,
    completedYaku: [],
  }
  const player2: Player = {
    id: 'player2',
    name: 'COM',
    hand: [card('feb-tane')],
    captured: [],
    score: 0,
    completedYaku: [],
  }

  return {
    phase: 'selectHandCard',
    deck: [card('mar-kasu-1')],
    field: [card('jan-kasu-1'), card('feb-kasu-1')],
    players: [player1, player2],
    currentPlayerIndex: 0,
    drawnCard: null,
    selectedHandCard: null,
    round: 1,
    koikoiCounts: [0, 0],
    newYaku: [],
    winner: null,
    turnHistory: [],
    config: DEFAULT_CONFIG,
    pendingMatches: [],
    pendingSource: null,
    roundWinner: null,
    roundPoints: 0,
    roundReason: null,
    roundStarterIndex: 0,
  }
}

function createRoundEndState(): KoiKoiGameState {
  const base = createBaseState()
  return {
    ...base,
    phase: 'roundEnd',
    roundWinner: 'player1',
    roundPoints: 3,
    roundReason: 'stop',
  }
}

function createAction(from: PlayerId, command: TurnCommand, actionId: string): ActionMessage {
  return {
    type: 'action',
    roomId: 'room-01',
    actionId,
    from,
    command,
  }
}

class FakeTransport implements PeerTransport {
  private readonly messageHandlers = new Set<(message: NetMessage) => void>()
  private readonly statusHandlers = new Set<(status: ReturnType<PeerTransport['getStatus']>) => void>()
  private status: ReturnType<PeerTransport['getStatus']> = 'connected'
  readonly sent: NetMessage[] = []

  onMessage(handler: (message: NetMessage) => void): () => void {
    this.messageHandlers.add(handler)
    return () => {
      this.messageHandlers.delete(handler)
    }
  }

  onStatusChange(handler: (status: ReturnType<PeerTransport['getStatus']>) => void): () => void {
    this.statusHandlers.add(handler)
    return () => {
      this.statusHandlers.delete(handler)
    }
  }

  send(message: NetMessage): boolean {
    this.sent.push(message)
    return true
  }

  close(): void {
    this.status = 'disconnected'
    for (const handler of this.statusHandlers) {
      handler(this.status)
    }
  }

  getStatus(): ReturnType<PeerTransport['getStatus']> {
    return this.status
  }

  emitIncoming(message: NetMessage): void {
    for (const handler of this.messageHandlers) {
      handler(message)
    }
  }
}

describe('host session', () => {
  it('rejects out_of_turn actions', () => {
    const initial = createBaseState()
    const host = new HostSession({
      roomId: 'room-01',
      initialState: initial,
    })

    const response = host.receiveAction(
      createAction('player2', { type: 'playHandCard', cardId: 'jan-hikari' }, 'a-1'),
    )

    expect(response.type).toBe('error')
    if (response.type !== 'error') {
      return
    }
    expect(response.code).toBe('out_of_turn')
    expect(host.getVersion()).toBe(0)
    expect(host.getState()).toBe(initial)
  })

  it('rejects invalid_phase actions', () => {
    const initial = createBaseState()
    const host = new HostSession({
      roomId: 'room-01',
      initialState: initial,
    })

    const response = host.receiveAction(createAction('player1', { type: 'drawStep' }, 'a-2'))

    expect(response.type).toBe('error')
    if (response.type !== 'error') {
      return
    }
    expect(response.code).toBe('invalid_phase')
    expect(host.getVersion()).toBe(0)
    expect(host.getState()).toBe(initial)
  })

  it('increments version for valid commands', () => {
    const initial = createBaseState()
    const host = new HostSession({
      roomId: 'room-01',
      initialState: initial,
    })

    const response = host.receiveAction(
      createAction('player1', { type: 'playHandCard', cardId: 'jan-hikari' }, 'a-3'),
    )

    expect(response.type).toBe('state')
    if (response.type !== 'state') {
      return
    }
    expect(response.version).toBe(1)
    expect(response.lastActionId).toBe('a-3')
    expect(host.getVersion()).toBe(1)
    expect(host.getState()).not.toBe(initial)
  })

  it('does not increment version for illegal commands', () => {
    const initial = createBaseState()
    const host = new HostSession({
      roomId: 'room-01',
      initialState: initial,
    })

    const response = host.receiveAction(
      createAction('player1', { type: 'playHandCard', cardId: 'missing-card' }, 'a-4'),
    )

    expect(response.type).toBe('error')
    if (response.type !== 'error') {
      return
    }
    expect(response.code).toBe('illegal_action')
    expect(host.getVersion()).toBe(0)
    expect(host.getState()).toBe(initial)
  })

  it('applies startNextRound during roundEnd and increments version', () => {
    const initial = createRoundEndState()
    const host = new HostSession({
      roomId: 'room-01',
      initialState: initial,
    })

    const response = host.receiveAction(
      createAction('player1', { type: 'startNextRound' }, 'a-5'),
    )

    expect(response.type).toBe('state')
    if (response.type !== 'state') {
      return
    }
    expect(response.version).toBe(1)
    expect(response.state.phase).toBe('selectHandCard')
    expect(response.state.round).toBe(2)
  })
})

describe('guest session', () => {
  it('sends local commands as actions and updates state/version from state messages', () => {
    const transport = new FakeTransport()
    const initial = createBaseState()
    const guest = new GuestSession({
      roomId: 'room-01',
      playerId: 'player2',
      initialState: initial,
      transport,
    })

    const action = guest.sendCommand({ type: 'drawStep' })
    expect(action.type).toBe('action')
    expect(action.from).toBe('player2')
    expect(action.command.type).toBe('drawStep')
    expect(transport.sent).toHaveLength(1)
    expect((transport.sent[0] as ActionMessage).actionId).toBe(action.actionId)

    const nextState = applyTurnCommand(initial, { type: 'playHandCard', cardId: 'jan-hikari' })
    const update: StateMessage = {
      type: 'state',
      roomId: 'room-01',
      version: 3,
      state: nextState,
      lastActionId: action.actionId,
    }
    transport.emitIncoming(update)

    expect(guest.getVersion()).toBe(3)
    expect(guest.getState()).toBe(nextState)
  })
})

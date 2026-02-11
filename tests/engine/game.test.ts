import { describe, expect, it } from 'vitest'
import { getCardById } from '../../src/engine/cards'
import {
  checkTurn,
  commitDrawToField,
  createNewGame,
  drawStep,
  playHandCard,
  resolveKoiKoi,
  selectDrawMatch,
  selectHandMatch,
  startNextRound,
  type KoiKoiGameState,
} from '../../src/engine/game'
import { DEFAULT_CONFIG, DEFAULT_LOCAL_RULE_SETTINGS, type Player } from '../../src/engine/types'
import { calculateYaku } from '../../src/engine/yaku'

function card(id: string) {
  const found = getCardById(id)
  if (!found) {
    throw new Error(`Unknown card id: ${id}`)
  }
  return found
}

function createTestState(): KoiKoiGameState {
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

function hasFourCardsOfSameMonth(cards: readonly ReturnType<typeof card>[]): boolean {
  const monthCounts = new Map<number, number>()
  for (const item of cards) {
    const count = (monthCounts.get(item.month) ?? 0) + 1
    if (count >= 4) {
      return true
    }
    monthCounts.set(item.month, count)
  }
  return false
}

describe('game flow', () => {
  it('creates a valid opening round', () => {
    const game = createNewGame()
    expect(game.phase).toBe('selectHandCard')
    expect(game.players[0].hand).toHaveLength(8)
    expect(game.players[1].hand).toHaveLength(8)
    expect(game.field).toHaveLength(8)
    expect(game.deck).toHaveLength(24)
    expect(hasFourCardsOfSameMonth(game.field)).toBe(false)
    expect(hasFourCardsOfSameMonth(game.players[0].hand)).toBe(false)
    expect(hasFourCardsOfSameMonth(game.players[1].hand)).toBe(false)
  })

  it('does not allow playing an unmatched card when another hand card can match field', () => {
    const base = createTestState()
    const state: KoiKoiGameState = {
      ...base,
      field: [card('jan-kasu-1'), card('mar-kasu-1')],
      players: [
        { ...base.players[0], hand: [card('jan-hikari'), card('feb-tane')] },
        base.players[1],
      ],
    }

    const result = playHandCard(state, 'feb-tane')
    expect(result).toBe(state)
  })

  it('requires selecting field card before capturing, even with single match', () => {
    const state = createTestState()
    const selected = playHandCard(state, 'jan-hikari')
    expect(selected.phase).toBe('selectFieldMatch')
    expect(selected.players[0].hand).toHaveLength(0)
    expect(selected.selectedHandCard?.id).toBe('jan-hikari')

    const next = selectHandMatch(selected, 'jan-kasu-1')
    expect(next.phase).toBe('drawingDeck')
    expect(next.players[0].captured.map((item) => item.id).sort()).toEqual(['jan-hikari', 'jan-kasu-1'])
    expect(next.field.map((item) => item.id)).toEqual(['feb-kasu-1'])
  })

  it('auto-captures all four cards when hand card matches three field cards', () => {
    const base = createTestState()
    const state: KoiKoiGameState = {
      ...base,
      field: [card('jan-kasu-1'), card('jan-kasu-2'), card('jan-tanzaku'), card('feb-kasu-1')],
      players: [
        { ...base.players[0], hand: [card('jan-hikari')] },
        base.players[1],
      ],
    }

    const result = playHandCard(state, 'jan-hikari')
    expect(result.phase).toBe('drawingDeck')
    expect(result.players[0].captured.map((item) => item.id).sort()).toEqual([
      'jan-hikari',
      'jan-kasu-1',
      'jan-kasu-2',
      'jan-tanzaku',
    ])
    expect(result.field.map((item) => item.id)).toEqual(['feb-kasu-1'])
  })

  it('requires selecting field card after draw, even with single match', () => {
    const base = createTestState()
    const drawingState: KoiKoiGameState = {
      ...base,
      phase: 'drawingDeck',
      deck: [card('jan-hikari')],
      field: [card('jan-kasu-1')],
      players: [
        { ...base.players[0], hand: [], captured: [], completedYaku: [] },
        base.players[1],
      ],
    }

    const revealed = drawStep(drawingState)
    expect(revealed.phase).toBe('drawReveal')
    expect(revealed.drawnCard?.id).toBe('jan-hikari')
    expect(revealed.pendingMatches.map((item) => item.id)).toEqual(['jan-kasu-1'])

    const drawn = commitDrawToField(revealed)
    expect(drawn.phase).toBe('selectDrawMatch')
    expect(drawn.drawnCard?.id).toBe('jan-hikari')
    expect(drawn.pendingMatches.map((item) => item.id)).toEqual(['jan-kasu-1'])

    const resolved = selectDrawMatch(drawn, 'jan-kasu-1')
    expect(resolved.phase).toBe('checkYaku')
    expect(resolved.drawnCard).toBeNull()
    expect(resolved.players[0].captured.map((item) => item.id).sort()).toEqual(['jan-hikari', 'jan-kasu-1'])
    expect(resolved.field).toHaveLength(0)
  })

  it('auto-captures all four cards when drawn card matches three field cards', () => {
    const base = createTestState()
    const state: KoiKoiGameState = {
      ...base,
      phase: 'drawReveal',
      drawnCard: card('jan-hikari'),
      field: [card('jan-kasu-1'), card('jan-kasu-2'), card('jan-tanzaku'), card('feb-kasu-1')],
      pendingSource: 'draw',
      pendingMatches: [card('jan-kasu-1'), card('jan-kasu-2'), card('jan-tanzaku')],
      players: [
        { ...base.players[0], hand: [], captured: [], completedYaku: [] },
        base.players[1],
      ],
    }

    const result = commitDrawToField(state)
    expect(result.phase).toBe('checkYaku')
    expect(result.drawnCard).toBeNull()
    expect(result.players[0].captured.map((item) => item.id).sort()).toEqual([
      'jan-hikari',
      'jan-kasu-1',
      'jan-kasu-2',
      'jan-tanzaku',
    ])
    expect(result.field.map((item) => item.id)).toEqual(['feb-kasu-1'])
  })

  it('reveals drawn card and then places it on field when no match', () => {
    const base = createTestState()
    const drawingState: KoiKoiGameState = {
      ...base,
      phase: 'drawingDeck',
      deck: [card('mar-hikari')],
      field: [card('jan-kasu-1')],
      players: [
        { ...base.players[0], hand: [], captured: [], completedYaku: [] },
        base.players[1],
      ],
    }

    const revealed = drawStep(drawingState)
    expect(revealed.phase).toBe('drawReveal')
    expect(revealed.drawnCard?.id).toBe('mar-hikari')
    expect(revealed.field.map((item) => item.id)).toEqual(['jan-kasu-1'])

    const committed = commitDrawToField(revealed)
    expect(committed.phase).toBe('checkYaku')
    expect(committed.drawnCard).toBeNull()
    expect(committed.field.map((item) => item.id)).toEqual(['jan-kasu-1', 'mar-hikari'])
  })

  it('auto-ends round when a new yaku appears after any koi-koi', () => {
    const base = createTestState()
    const captured = [card('jan-hikari'), card('mar-hikari'), card('aug-hikari')]
    const checkState: KoiKoiGameState = {
      ...base,
      phase: 'checkYaku',
      players: [
        { ...base.players[0], captured, completedYaku: [], hand: [card('apr-kasu-1')] },
        { ...base.players[1], hand: [card('feb-tane')] },
      ],
      koikoiCounts: [0, 1],
    }

    const result = checkTurn(checkState)
    expect(result.phase).toBe('roundEnd')
    expect(result.roundWinner).toBe('player1')
    expect(result.roundPoints).toBe(10)
    expect(result.players[0].score).toBe(10)
  })

  it('auto-ends round when koi-koi player makes another new yaku', () => {
    const base = createTestState()
    const captured = [card('jan-hikari'), card('mar-hikari'), card('aug-hikari')]
    const checkState: KoiKoiGameState = {
      ...base,
      phase: 'checkYaku',
      players: [
        { ...base.players[0], captured, completedYaku: [], hand: [card('apr-kasu-1')] },
        { ...base.players[1], hand: [card('feb-tane')] },
      ],
      koikoiCounts: [1, 0],
    }

    const result = checkTurn(checkState)
    expect(result.phase).toBe('roundEnd')
    expect(result.roundWinner).toBe('player1')
    expect(result.roundPoints).toBe(5)
    expect(result.players[0].score).toBe(5)
  })

  it('doubles round points on stop when total is 7 or more', () => {
    const base = createTestState()
    const captured = [card('jan-hikari'), card('mar-hikari'), card('aug-hikari'), card('nov-hikari'), card('dec-hikari')]
    const yaku = calculateYaku(captured)

    const koikoiState: KoiKoiGameState = {
      ...base,
      phase: 'koikoiDecision',
      players: [
        { ...base.players[0], captured, completedYaku: yaku, hand: [card('apr-kasu-1')] },
        base.players[1],
      ],
      koikoiCounts: [1, 0],
    }
    const result = resolveKoiKoi(koikoiState, 'stop')

    expect(result.phase).toBe('roundEnd')
    expect(result.roundWinner).toBe('player1')
    expect(result.roundPoints).toBe(20)
    expect(result.players[0].score).toBe(20)
  })

  it('doubles round points on stop when opponent already called koi-koi', () => {
    const base = createTestState()
    const captured = [card('jan-hikari'), card('mar-hikari'), card('aug-hikari')]
    const yaku = calculateYaku(captured)

    const koikoiState: KoiKoiGameState = {
      ...base,
      phase: 'koikoiDecision',
      players: [
        { ...base.players[0], captured, completedYaku: yaku, hand: [card('apr-kasu-1')] },
        base.players[1],
      ],
      koikoiCounts: [0, 1],
    }
    const result = resolveKoiKoi(koikoiState, 'stop')

    expect(result.phase).toBe('roundEnd')
    expect(result.roundWinner).toBe('player1')
    expect(result.roundPoints).toBe(10)
    expect(result.players[0].score).toBe(10)
  })

  it('applies both multipliers multiplicatively on stop', () => {
    const base = createTestState()
    const captured = [card('jan-hikari'), card('mar-hikari'), card('aug-hikari'), card('nov-hikari'), card('dec-hikari')]
    const yaku = calculateYaku(captured)

    const koikoiState: KoiKoiGameState = {
      ...base,
      phase: 'koikoiDecision',
      players: [
        { ...base.players[0], captured, completedYaku: yaku, hand: [card('apr-kasu-1')] },
        base.players[1],
      ],
      koikoiCounts: [0, 1],
    }
    const result = resolveKoiKoi(koikoiState, 'stop')

    expect(result.phase).toBe('roundEnd')
    expect(result.roundWinner).toBe('player1')
    expect(result.roundPoints).toBe(40)
    expect(result.players[0].score).toBe(40)
  })

  it('applies additive koi-koi bonus mode when both bonuses are active', () => {
    const base = createTestState()
    const captured = [card('jan-hikari'), card('mar-hikari'), card('aug-hikari'), card('nov-hikari'), card('dec-hikari')]
    const yaku = calculateYaku(captured)

    const koikoiState: KoiKoiGameState = {
      ...base,
      phase: 'koikoiDecision',
      players: [
        { ...base.players[0], captured, completedYaku: yaku, hand: [card('apr-kasu-1')] },
        base.players[1],
      ],
      koikoiCounts: [0, 1],
      config: {
        ...base.config,
        localRules: {
          ...DEFAULT_LOCAL_RULE_SETTINGS,
          koiKoiBonusMode: 'additive',
        },
      },
    }
    const result = resolveKoiKoi(koikoiState, 'stop')

    expect(result.phase).toBe('roundEnd')
    expect(result.roundWinner).toBe('player1')
    expect(result.roundPoints).toBe(30)
    expect(result.players[0].score).toBe(30)
  })

  it('applies no-yaku policy both-zero', () => {
    const base = createTestState()
    const koikoiState: KoiKoiGameState = {
      ...base,
      phase: 'koikoiDecision',
      players: [
        { ...base.players[0], captured: [], completedYaku: [], hand: [card('apr-kasu-1')] },
        base.players[1],
      ],
      config: {
        ...base.config,
        localRules: {
          ...DEFAULT_LOCAL_RULE_SETTINGS,
          noYakuPolicy: 'both-zero',
        },
      },
    }
    const result = resolveKoiKoi(koikoiState, 'stop')

    expect(result.phase).toBe('roundEnd')
    expect(result.roundWinner).toBe('player1')
    expect(result.roundPoints).toBe(0)
    expect(result.players[0].score).toBe(0)
  })

  it('applies no-yaku policy seat-points by parent/child seat', () => {
    const base = createTestState()
    const parentState: KoiKoiGameState = {
      ...base,
      phase: 'koikoiDecision',
      roundStarterIndex: 0,
      currentPlayerIndex: 0,
      players: [
        { ...base.players[0], captured: [], completedYaku: [], hand: [card('apr-kasu-1')] },
        base.players[1],
      ],
      config: {
        ...base.config,
        localRules: {
          ...DEFAULT_LOCAL_RULE_SETTINGS,
          noYakuPolicy: 'seat-points',
          noYakuParentPoints: 3,
          noYakuChildPoints: 1,
        },
      },
    }
    const childState: KoiKoiGameState = {
      ...parentState,
      currentPlayerIndex: 1,
      players: [
        parentState.players[0],
        { ...base.players[1], captured: [], completedYaku: [], hand: [card('may-kasu-1')] },
      ],
    }

    const parentResult = resolveKoiKoi(parentState, 'stop')
    const childResult = resolveKoiKoi(childState, 'stop')

    expect(parentResult.roundPoints).toBe(3)
    expect(childResult.roundPoints).toBe(1)
  })

  it('treats koikoiLimit as declaration limit (not multiplier cap)', () => {
    const base = createTestState()
    const captured = [card('jan-hikari'), card('mar-hikari'), card('aug-hikari')]
    const yaku = calculateYaku(captured)
    const koikoiState: KoiKoiGameState = {
      ...base,
      phase: 'koikoiDecision',
      players: [
        { ...base.players[0], captured, completedYaku: yaku, hand: [card('apr-kasu-1')] },
        base.players[1],
      ],
      koikoiCounts: [1, 0],
      config: {
        ...base.config,
        localRules: {
          ...DEFAULT_LOCAL_RULE_SETTINGS,
          koiKoiBonusMode: 'multiplicative',
          koikoiLimit: 1,
        },
      },
    }

    const result = resolveKoiKoi(koikoiState, 'koikoi')

    expect(result.phase).toBe('roundEnd')
    expect(result.roundWinner).toBe('player1')
    expect(result.roundPoints).toBe(5)
  })

  it('extends game on final-round total tie when overtime is enabled', () => {
    const base = createTestState()
    const regulationTieState: KoiKoiGameState = {
      ...base,
      phase: 'koikoiDecision',
      round: 3,
      roundStarterIndex: 0,
      players: [
        { ...base.players[0], score: 10, captured: [], completedYaku: [], hand: [card('apr-kasu-1')] },
        { ...base.players[1], score: 10, captured: [], completedYaku: [], hand: [card('may-kasu-1')] },
      ],
      config: {
        ...base.config,
        maxRounds: 3,
        localRules: {
          ...DEFAULT_LOCAL_RULE_SETTINGS,
          noYakuPolicy: 'both-zero',
          enableDrawOvertime: true,
          drawOvertimeRounds: 2,
        },
      },
    }
    const limitTieState: KoiKoiGameState = {
      ...regulationTieState,
      round: 5,
    }

    const regulationResult = resolveKoiKoi(regulationTieState, 'stop')
    const limitResult = resolveKoiKoi(limitTieState, 'stop')

    expect(regulationResult.phase).toBe('roundEnd')
    expect(limitResult.phase).toBe('gameOver')
    expect(limitResult.winner).toBeNull()
  })

  it('also doubles for player2 when player1 already called koi-koi', () => {
    const base = createTestState()
    const captured = [card('jan-hikari'), card('mar-hikari'), card('aug-hikari')]
    const yaku = calculateYaku(captured)

    const koikoiState: KoiKoiGameState = {
      ...base,
      phase: 'koikoiDecision',
      currentPlayerIndex: 1,
      players: [
        { ...base.players[0], hand: [card('apr-kasu-1')] },
        { ...base.players[1], captured, completedYaku: yaku, hand: [card('may-kasu-1')] },
      ],
      koikoiCounts: [1, 0],
    }
    const result = resolveKoiKoi(koikoiState, 'stop')

    expect(result.phase).toBe('roundEnd')
    expect(result.roundWinner).toBe('player2')
    expect(result.roundPoints).toBe(10)
    expect(result.players[1].score).toBe(10)
  })

  it('deals next round after round end', () => {
    const base = createTestState()
    const roundEndState: KoiKoiGameState = {
      ...base,
      phase: 'roundEnd',
      roundWinner: 'player2',
      roundPoints: 6,
      players: [
        { ...base.players[0], score: 10, captured: [card('jan-kasu-2')] },
        { ...base.players[1], score: 18, captured: [card('feb-kasu-2')] },
      ],
    }

    const next = startNextRound(roundEndState)
    expect(next.phase).toBe('selectHandCard')
    expect(next.round).toBe(2)
    expect(next.currentPlayerIndex).toBe(1)
    expect(next.players[0].score).toBe(10)
    expect(next.players[1].score).toBe(18)
    expect(next.players[0].hand).toHaveLength(8)
    expect(next.players[1].hand).toHaveLength(8)
  })

  it('keeps starter on exhausted round without winner', () => {
    const base = createTestState()
    const roundEndState: KoiKoiGameState = {
      ...base,
      phase: 'roundEnd',
      roundReason: 'exhausted',
      roundStarterIndex: 1,
      roundWinner: null,
      players: [
        { ...base.players[0], score: 8 },
        { ...base.players[1], score: 13 },
      ],
    }

    const next = startNextRound(roundEndState)
    expect(next.phase).toBe('selectHandCard')
    expect(next.round).toBe(2)
    expect(next.currentPlayerIndex).toBe(1)
    expect(next.players[0].score).toBe(8)
    expect(next.players[1].score).toBe(13)
  })

  it('uses seed to produce deterministic next round deals', () => {
    const base = createTestState()
    const roundEndState: KoiKoiGameState = {
      ...base,
      phase: 'roundEnd',
      roundWinner: 'player1',
      roundPoints: 5,
      players: [
        { ...base.players[0], score: 7 },
        { ...base.players[1], score: 9 },
      ],
    }

    const seed = 20260208
    const nextA = startNextRound(roundEndState, seed)
    const nextB = startNextRound(roundEndState, seed)

    expect(nextA.players[0].hand.map((item) => item.id)).toEqual(nextB.players[0].hand.map((item) => item.id))
    expect(nextA.players[1].hand.map((item) => item.id)).toEqual(nextB.players[1].hand.map((item) => item.id))
    expect(nextA.field.map((item) => item.id)).toEqual(nextB.field.map((item) => item.id))
    expect(nextA.deck.map((item) => item.id)).toEqual(nextB.deck.map((item) => item.id))
  })
})

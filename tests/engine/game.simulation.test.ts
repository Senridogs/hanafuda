import { describe, expect, it } from 'vitest'
import {
  checkTurn,
  commitDrawToField,
  createNewGame,
  drawStep,
  getMatchingFieldCards,
  playHandCard,
  resolveKoiKoi,
  selectDrawMatch,
  selectHandMatch,
  startNextRound,
  type KoiKoiGameState,
} from '../../src/engine/game'
import type { GameConfig } from '../../src/engine/types'

function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function withSeededRandom<T>(seed: number, run: () => T): T {
  const rng = mulberry32(seed)
  const original = Math.random
  Math.random = () => rng()
  try {
    return run()
  } finally {
    Math.random = original
  }
}

function pickOne<T>(items: readonly T[], rng: () => number): T {
  if (items.length === 0) {
    throw new Error('Cannot pick from empty list')
  }
  const index = Math.floor(rng() * items.length)
  return items[Math.max(0, Math.min(index, items.length - 1))]
}

function assertCardConservation(state: KoiKoiGameState): void {
  const ids: string[] = []
  ids.push(...state.deck.map((card) => card.id))
  ids.push(...state.field.map((card) => card.id))
  ids.push(...state.players[0].hand.map((card) => card.id))
  ids.push(...state.players[1].hand.map((card) => card.id))
  ids.push(...state.players[0].captured.map((card) => card.id))
  ids.push(...state.players[1].captured.map((card) => card.id))
  if (state.drawnCard) {
    ids.push(state.drawnCard.id)
  }
  if (state.selectedHandCard) {
    ids.push(state.selectedHandCard.id)
  }

  expect(ids).toHaveLength(48)
  expect(new Set(ids).size).toBe(48)
}

function assertRoundResolutionConsistency(state: KoiKoiGameState): void {
  if (state.phase !== 'roundEnd' && state.phase !== 'gameOver') {
    return
  }

  if (state.roundReason === 'exhausted') {
    expect(state.roundWinner).toBeNull()
    expect(state.roundPoints).toBe(0)
  }
  if (state.roundReason === 'stop') {
    expect(state.roundWinner).not.toBeNull()
    expect(state.roundPoints).toBeGreaterThanOrEqual(1)
  }
}

function assertWinnerConsistency(state: KoiKoiGameState): void {
  if (state.phase !== 'gameOver') {
    return
  }

  const p1 = state.players[0].score
  const p2 = state.players[1].score
  if (p1 === p2) {
    expect(state.winner).toBeNull()
  } else if (p1 > p2) {
    expect(state.winner).toBe('player1')
  } else {
    expect(state.winner).toBe('player2')
  }
}

function nextState(state: KoiKoiGameState, rng: () => number, alwaysStop = false): KoiKoiGameState {
  switch (state.phase) {
    case 'selectHandCard': {
      const player = state.players[state.currentPlayerIndex]
      const matchable = player.hand.filter((card) => getMatchingFieldCards(card, state.field).length > 0)
      const candidates = matchable.length > 0 ? matchable : player.hand
      const selected = pickOne(candidates, rng)
      return playHandCard(state, selected.id)
    }
    case 'selectFieldMatch': {
      const selected = pickOne(state.pendingMatches, rng)
      return selectHandMatch(state, selected.id)
    }
    case 'drawingDeck':
      return drawStep(state)
    case 'drawReveal':
      return commitDrawToField(state)
    case 'selectDrawMatch': {
      const selected = pickOne(state.pendingMatches, rng)
      return selectDrawMatch(state, selected.id)
    }
    case 'checkYaku':
      return checkTurn(state)
    case 'koikoiDecision': {
      const decision = alwaysStop || rng() < 0.7 ? 'stop' : 'koikoi'
      return resolveKoiKoi(state, decision)
    }
    case 'roundEnd':
      return startNextRound(state)
    case 'gameOver':
      return state
    default:
      throw new Error(`Unexpected phase: ${state.phase}`)
  }
}

function runSimulation(seed: number, config: GameConfig, alwaysStop = false): KoiKoiGameState {
  return withSeededRandom(seed, () => {
    const rng = mulberry32(seed ^ 0xa5a5_1f2f)
    let state = createNewGame(config)
    let steps = 0
    let previousScores = [state.players[0].score, state.players[1].score] as const
    let previousRound = state.round

    while (state.phase !== 'gameOver') {
      assertCardConservation(state)
      assertRoundResolutionConsistency(state)
      const next = nextState(state, rng, alwaysStop)
      expect(next).not.toBe(state)

      expect(next.players[0].score).toBeGreaterThanOrEqual(previousScores[0])
      expect(next.players[1].score).toBeGreaterThanOrEqual(previousScores[1])
      expect(next.round).toBeGreaterThanOrEqual(previousRound)

      previousScores = [next.players[0].score, next.players[1].score]
      previousRound = next.round
      state = next
      steps += 1
      if (steps > 4000) {
        throw new Error(`Simulation exceeded step limit (seed=${seed})`)
      }
    }

    assertCardConservation(state)
    assertRoundResolutionConsistency(state)
    assertWinnerConsistency(state)
    return state
  })
}

describe('full-game simulation invariants', () => {
  it('preserves core invariants across deterministic random full games', () => {
    const cfg: GameConfig = {
      targetScore: 50,
      maxRounds: 12,
      enableAI: false,
      aiDifficulty: 'medium',
      player1Name: 'P1',
      player2Name: 'P2',
    }

    for (let seed = 1; seed <= 30; seed += 1) {
      const state = runSimulation(seed, cfg)
      expect(state.phase).toBe('gameOver')
    }
  })

  it('finishes at 12th round by max-round rule when target is unreachable', () => {
    const cfg: GameConfig = {
      targetScore: 999,
      maxRounds: 12,
      enableAI: false,
      aiDifficulty: 'medium',
      player1Name: 'P1',
      player2Name: 'P2',
    }

    for (let seed = 101; seed <= 115; seed += 1) {
      const state = runSimulation(seed, cfg, true)
      expect(state.phase).toBe('gameOver')
      expect(state.round).toBe(12)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { getCardById } from '../../src/engine/cards'
import {
  checkTurn,
  commitDrawToField,
  drawStep,
  playHandCard,
  resolveKoiKoi,
  selectDrawMatch,
  selectHandMatch,
  startNextRound,
  type KoiKoiGameState,
} from '../../src/engine/game'
import { DEFAULT_CONFIG, type GameConfig, type Player } from '../../src/engine/types'
import { calculateYaku } from '../../src/engine/yaku'

function card(id: string) {
  const found = getCardById(id)
  if (!found) {
    throw new Error(`Unknown card id: ${id}`)
  }
  return found
}

function createPlayer(
  id: Player['id'],
  score: number,
  handIds: readonly string[],
  capturedIds: readonly string[] = [],
): Player {
  const captured = capturedIds.map(card)
  return {
    id,
    name: id === 'player1' ? 'あなた' : 'COM',
    hand: handIds.map(card),
    captured,
    score,
    completedYaku: calculateYaku(captured),
  }
}

function makeState(overrides: Partial<KoiKoiGameState> = {}): KoiKoiGameState {
  const players: readonly [Player, Player] = overrides.players ?? [
    createPlayer('player1', 0, ['jan-hikari']),
    createPlayer('player2', 0, ['feb-tane']),
  ]
  return {
    phase: 'selectHandCard',
    deck: [card('mar-kasu-1')],
    field: [card('jan-kasu-1')],
    players,
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
    ...overrides,
  }
}

function config(overrides: Partial<GameConfig>): GameConfig {
  return { ...DEFAULT_CONFIG, ...overrides }
}

describe('game rules and safeguards', () => {
  it('keeps state unchanged for invalid phase actions', () => {
    const base = makeState({ phase: 'selectHandCard' })
    expect(selectHandMatch(base, 'jan-kasu-1')).toBe(base)
    expect(drawStep(base)).toBe(base)
    expect(commitDrawToField(base)).toBe(base)
    expect(selectDrawMatch(base, 'jan-kasu-1')).toBe(base)
    expect(checkTurn(base)).toBe(base)
    expect(resolveKoiKoi(base, 'stop')).toBe(base)
    expect(startNextRound(base)).toBe(base)
  })

  it('keeps state unchanged when selecting a card outside pending match candidates', () => {
    const handMatchState = makeState({
      phase: 'selectFieldMatch',
      pendingSource: 'hand',
      selectedHandCard: card('jan-hikari'),
      pendingMatches: [card('jan-kasu-1')],
      field: [card('jan-kasu-1'), card('feb-kasu-1')],
    })
    expect(selectHandMatch(handMatchState, 'feb-kasu-1')).toBe(handMatchState)

    const drawMatchState = makeState({
      phase: 'selectDrawMatch',
      pendingSource: 'draw',
      drawnCard: card('jan-hikari'),
      pendingMatches: [card('jan-kasu-1')],
      field: [card('jan-kasu-1'), card('feb-kasu-1')],
    })
    expect(selectDrawMatch(drawMatchState, 'feb-kasu-1')).toBe(drawMatchState)
  })

  it('advances turn and clears temporary artifacts when no new yaku appears', () => {
    const state = makeState({
      phase: 'checkYaku',
      selectedHandCard: card('jan-hikari'),
      drawnCard: card('mar-kasu-1'),
      pendingMatches: [card('jan-kasu-1')],
      pendingSource: 'draw',
      players: [
        createPlayer('player1', 0, ['apr-kasu-1'], []),
        createPlayer('player2', 0, ['feb-tane'], []),
      ],
    })

    const next = checkTurn(state)
    expect(next.phase).toBe('selectHandCard')
    expect(next.currentPlayerIndex).toBe(1)
    expect(next.selectedHandCard).toBeNull()
    expect(next.drawnCard).toBeNull()
    expect(next.pendingMatches).toEqual([])
    expect(next.pendingSource).toBeNull()
    expect(next.newYaku).toEqual([])
  })

  it('increments koi-koi count and passes turn on koi-koi decision', () => {
    const captured = ['jan-hikari', 'mar-hikari', 'aug-hikari']
    const state = makeState({
      phase: 'koikoiDecision',
      players: [
        createPlayer('player1', 0, ['apr-kasu-1'], captured),
        createPlayer('player2', 0, ['feb-tane']),
      ],
      currentPlayerIndex: 0,
      koikoiCounts: [0, 0],
    })

    const next = resolveKoiKoi(state, 'koikoi')
    expect(next.phase).toBe('selectHandCard')
    expect(next.currentPlayerIndex).toBe(1)
    expect(next.koikoiCounts).toEqual([1, 0])
    expect(next.turnHistory.at(-1)?.type).toBe('koikoi')
  })

  it('enters gameOver at final round stop and uses updated total for winner', () => {
    const captured = ['jan-hikari', 'mar-hikari', 'aug-hikari']
    const state = makeState({
      phase: 'koikoiDecision',
      round: 12,
      players: [
        createPlayer('player1', 10, ['apr-kasu-1'], captured),
        createPlayer('player2', 14, ['feb-tane']),
      ],
      currentPlayerIndex: 0,
      config: config({ maxRounds: 12 }),
    })

    const next = resolveKoiKoi(state, 'stop')
    expect(next.phase).toBe('gameOver')
    expect(next.roundReason).toBe('stop')
    expect(next.roundWinner).toBe('player1')
    expect(next.roundPoints).toBe(5)
    expect(next.players[0].score).toBe(15)
    expect(next.players[1].score).toBe(14)
    expect(next.winner).toBe('player1')
  })

  it('resolves final-round tie correctly after adding stop points', () => {
    const captured = ['jan-hikari', 'mar-hikari', 'aug-hikari']
    const state = makeState({
      phase: 'koikoiDecision',
      round: 12,
      players: [
        createPlayer('player1', 10, ['apr-kasu-1'], captured),
        createPlayer('player2', 15, ['feb-tane']),
      ],
      currentPlayerIndex: 0,
      config: config({ maxRounds: 12 }),
    })

    const next = resolveKoiKoi(state, 'stop')
    expect(next.phase).toBe('gameOver')
    expect(next.players[0].score).toBe(15)
    expect(next.players[1].score).toBe(15)
    expect(next.winner).toBeNull()
  })

  it('does not end game mid-match even when score increases significantly', () => {
    const captured = ['jan-hikari', 'mar-hikari', 'aug-hikari']
    const state = makeState({
      phase: 'koikoiDecision',
      round: 4,
      players: [
        createPlayer('player1', 10, ['apr-kasu-1'], captured),
        createPlayer('player2', 8, ['feb-tane']),
      ],
      currentPlayerIndex: 0,
      config: config({ maxRounds: 12 }),
    })

    const next = resolveKoiKoi(state, 'stop')
    expect(next.phase).toBe('roundEnd')
    expect(next.roundWinner).toBe('player1')
    expect(next.players[0].score).toBe(15)
    expect(next.winner).toBeNull()
  })

  it('resolves exhausted final round with winner from accumulated scores', () => {
    const state = makeState({
      phase: 'drawingDeck',
      round: 12,
      deck: [],
      players: [
        createPlayer('player1', 9, ['jan-hikari']),
        createPlayer('player2', 13, ['feb-tane']),
      ],
      currentPlayerIndex: 0,
      config: config({ maxRounds: 12 }),
    })

    const next = drawStep(state)
    expect(next.phase).toBe('gameOver')
    expect(next.roundReason).toBe('exhausted')
    expect(next.roundWinner).toBeNull()
    expect(next.roundPoints).toBe(0)
    expect(next.players[0].score).toBe(9)
    expect(next.players[1].score).toBe(13)
    expect(next.winner).toBe('player2')
  })

  it('resolves exhausted final round tie as overall draw', () => {
    const state = makeState({
      phase: 'drawingDeck',
      round: 12,
      deck: [],
      players: [
        createPlayer('player1', 13, ['jan-hikari']),
        createPlayer('player2', 13, ['feb-tane']),
      ],
      currentPlayerIndex: 0,
      config: config({ maxRounds: 12 }),
    })

    const next = drawStep(state)
    expect(next.phase).toBe('gameOver')
    expect(next.roundReason).toBe('exhausted')
    expect(next.winner).toBeNull()
  })

  it('alternates starter after non-exhausted round with no winner', () => {
    const state = makeState({
      phase: 'roundEnd',
      round: 5,
      roundReason: 'draw',
      roundWinner: null,
      roundStarterIndex: 0,
      players: [
        createPlayer('player1', 11, []),
        createPlayer('player2', 11, []),
      ],
    })

    const next = startNextRound(state)
    expect(next.round).toBe(6)
    expect(next.currentPlayerIndex).toBe(1)
  })

  it('rejects unmatched play when a matching hand card exists', () => {
    const state = makeState({
      phase: 'selectHandCard',
      field: [card('jan-kasu-1'), card('mar-kasu-1')],
      players: [
        createPlayer('player1', 0, ['jan-hikari', 'feb-tane']),
        createPlayer('player2', 0, ['apr-kasu-1']),
      ],
    })

    const result = playHandCard(state, 'feb-tane')
    expect(result).toBe(state)
  })

  it('treats yaku point increase as a new yaku event', () => {
    const fiveTane = ['feb-tane', 'apr-tane', 'may-tane', 'aug-tane', 'sep-tane']
    const sixTane = [...fiveTane, 'nov-tane']
    const previousYaku = calculateYaku(fiveTane.map(card))
    const state = makeState({
      phase: 'checkYaku',
      players: [
        {
          ...createPlayer('player1', 0, ['apr-kasu-1'], sixTane),
          completedYaku: previousYaku,
        },
        createPlayer('player2', 0, ['feb-tane']),
      ],
      currentPlayerIndex: 0,
      koikoiCounts: [0, 0],
    })

    const next = checkTurn(state)
    expect(next.phase).toBe('koikoiDecision')
    expect(next.newYaku).toHaveLength(1)
    expect(next.newYaku[0]?.type).toBe('tane')
    expect(next.newYaku[0]?.points).toBe(2)
  })

  it('does not reopen koi-koi decision when completed yaku did not increase', () => {
    const fiveTane = ['feb-tane', 'apr-tane', 'may-tane', 'aug-tane', 'sep-tane']
    const state = makeState({
      phase: 'checkYaku',
      players: [
        createPlayer('player1', 0, ['apr-kasu-1'], fiveTane),
        createPlayer('player2', 0, ['feb-tane']),
      ],
      currentPlayerIndex: 0,
      koikoiCounts: [0, 0],
    })

    const next = checkTurn(state)
    expect(next.phase).toBe('selectHandCard')
    expect(next.currentPlayerIndex).toBe(1)
    expect(next.newYaku).toEqual([])
  })

  it('resolves final-round stop totals and winner correctly across score matrix', () => {
    const scoreCases = [0, 3, 10, 20]
    const basePointCases = [0, 1, 5, 7, 8]
    const starterHand = ['jan-hikari']
    const opponentHand = ['feb-tane']

    for (const currentPlayerIndex of [0, 1] as const) {
      for (const p1Start of scoreCases) {
        for (const p2Start of scoreCases) {
          for (const basePoints of basePointCases) {
            for (const opponentCalledKoiKoi of [0, 1] as const) {
              const p1 = createPlayer('player1', p1Start, starterHand)
              const p2 = createPlayer('player2', p2Start, opponentHand)
              const manualYaku = [{ type: 'kasu', name: 'かす', points: basePoints, cards: [card('jan-kasu-1')] }] as const
              const players =
                currentPlayerIndex === 0
                  ? ([{ ...p1, completedYaku: manualYaku }, p2] as const)
                  : ([p1, { ...p2, completedYaku: manualYaku }] as const)
              const koikoiCounts =
                currentPlayerIndex === 0
                  ? ([0, opponentCalledKoiKoi] as const)
                  : ([opponentCalledKoiKoi, 0] as const)
              const state = makeState({
                phase: 'koikoiDecision',
                round: 12,
                currentPlayerIndex,
                players,
                koikoiCounts,
                config: config({ maxRounds: 12 }),
              })

              const next = resolveKoiKoi(state, 'stop')
              const effectiveBase = Math.max(1, basePoints)
              const highPointMultiplier = effectiveBase >= 7 ? 2 : 1
              const opponentKoiMultiplier = opponentCalledKoiKoi > 0 ? 2 : 1
              const expectedRoundPoints = effectiveBase * highPointMultiplier * opponentKoiMultiplier
              const expectedP1 = p1Start + (currentPlayerIndex === 0 ? expectedRoundPoints : 0)
              const expectedP2 = p2Start + (currentPlayerIndex === 1 ? expectedRoundPoints : 0)
              const expectedWinner =
                expectedP1 === expectedP2 ? null : expectedP1 > expectedP2 ? 'player1' : 'player2'

              expect(next.phase).toBe('gameOver')
              expect(next.roundReason).toBe('stop')
              expect(next.roundWinner).toBe(currentPlayerIndex === 0 ? 'player1' : 'player2')
              expect(next.roundPoints).toBe(expectedRoundPoints)
              expect(next.players[0].score).toBe(expectedP1)
              expect(next.players[1].score).toBe(expectedP2)
              expect(next.winner).toBe(expectedWinner)
            }
          }
        }
      }
    }
  })

  it('resolves final-round exhausted totals and winner correctly across score matrix', () => {
    const scoreCases = [0, 3, 10, 20]

    for (const currentPlayerIndex of [0, 1] as const) {
      for (const p1Start of scoreCases) {
        for (const p2Start of scoreCases) {
          const state = makeState({
            phase: 'drawingDeck',
            round: 12,
            deck: [],
            currentPlayerIndex,
            players: [
              createPlayer('player1', p1Start, ['jan-hikari']),
              createPlayer('player2', p2Start, ['feb-tane']),
            ],
            config: config({ maxRounds: 12 }),
          })

          const next = drawStep(state)
          const expectedWinner =
            p1Start === p2Start ? null : p1Start > p2Start ? 'player1' : 'player2'

          expect(next.phase).toBe('gameOver')
          expect(next.roundReason).toBe('exhausted')
          expect(next.roundWinner).toBeNull()
          expect(next.roundPoints).toBe(0)
          expect(next.players[0].score).toBe(p1Start)
          expect(next.players[1].score).toBe(p2Start)
          expect(next.winner).toBe(expectedWinner)
        }
      }
    }
  })
})

import { describe, expect, it } from 'vitest'
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
import { chooseAiHandCard, chooseAiKoiKoi, chooseAiMatch } from '../../src/engine/ai'
import {
  DEFAULT_CONFIG,
  DEFAULT_LOCAL_RULE_SETTINGS,
  normalizeLocalRuleSettings,
  type GameConfig,
  type HanafudaCard,
  type LocalRuleSettings,
  type LocalRuleSettingsInput,
} from '../../src/engine/types'

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0)
}

function collectAllCards(state: KoiKoiGameState): readonly HanafudaCard[] {
  const floating: HanafudaCard[] = []
  if (state.selectedHandCard) {
    floating.push(state.selectedHandCard)
  }
  if (state.drawnCard) {
    floating.push(state.drawnCard)
  }
  return [
    ...state.deck,
    ...state.field,
    ...state.players[0].hand,
    ...state.players[1].hand,
    ...state.players[0].captured,
    ...state.players[1].captured,
    ...floating,
  ]
}

function assertCardInvariants(state: KoiKoiGameState): void {
  const cards = collectAllCards(state)
  expect(cards).toHaveLength(48)

  const ids = cards.map((card) => card.id)
  expect(new Set(ids).size).toBe(48)
}

function expectedHistoryLength(state: KoiKoiGameState): number {
  if (state.phase === 'roundEnd' || state.phase === 'gameOver') {
    return state.round
  }
  return state.round - 1
}

function assertScoreInvariants(state: KoiKoiGameState): void {
  const history = state.roundScoreHistory
  expect(Array.isArray(history)).toBe(true)
  expect(history.length).toBe(expectedHistoryLength(state))

  for (let i = 0; i < history.length; i += 1) {
    const entry = history[i]
    expect(entry?.round).toBe(i + 1)
    expect(entry?.player1Points).toBeGreaterThanOrEqual(0)
    expect(entry?.player2Points).toBeGreaterThanOrEqual(0)
  }

  const fromHistoryP1 = sum(history.map((entry) => entry.player1Points))
  const fromHistoryP2 = sum(history.map((entry) => entry.player2Points))
  expect(state.players[0].score).toBe(fromHistoryP1)
  expect(state.players[1].score).toBe(fromHistoryP2)
}

function assertWinnerInvariant(state: KoiKoiGameState): void {
  if (state.phase !== 'gameOver') {
    return
  }

  if (state.players[0].score === state.players[1].score) {
    expect(state.winner).toBeNull()
  } else if (state.players[0].score > state.players[1].score) {
    expect(state.winner).toBe('player1')
  } else {
    expect(state.winner).toBe('player2')
  }
}

function nextState(state: KoiKoiGameState): KoiKoiGameState {
  switch (state.phase) {
    case 'selectHandCard': {
      const selected = chooseAiHandCard(state) ?? state.players[state.currentPlayerIndex].hand[0] ?? null
      expect(selected).not.toBeNull()
      return playHandCard(state, selected!.id)
    }
    case 'selectFieldMatch': {
      const selected = chooseAiMatch(state.pendingMatches, state.config.aiDifficulty, state) ?? state.pendingMatches[0] ?? null
      expect(selected).not.toBeNull()
      return selectHandMatch(state, selected!.id)
    }
    case 'drawingDeck':
      return drawStep(state)
    case 'drawReveal':
      return commitDrawToField(state)
    case 'selectDrawMatch': {
      const selected = chooseAiMatch(state.pendingMatches, state.config.aiDifficulty, state) ?? state.pendingMatches[0] ?? null
      expect(selected).not.toBeNull()
      return selectDrawMatch(state, selected!.id)
    }
    case 'checkYaku':
      return checkTurn(state)
    case 'koikoiDecision':
      return resolveKoiKoi(state, chooseAiKoiKoi(state))
    case 'roundEnd':
      return startNextRound(state, state.round * 1000 + state.players[0].score * 7 + state.players[1].score * 11)
    case 'gameOver':
      return state
  }
}

function buildRuleVariants(): readonly LocalRuleSettingsInput[] {
  const base = DEFAULT_LOCAL_RULE_SETTINGS

  const withFlags = (
    partial: Partial<LocalRuleSettings>,
  ): LocalRuleSettingsInput => ({
    ...base,
    ...partial,
    yakuPoints: { ...base.yakuPoints, ...(partial.yakuPoints ?? {}) },
    yakuEnabled: { ...base.yakuEnabled, ...(partial.yakuEnabled ?? {}) },
  })

  return [
    base,
    withFlags({ koiKoiBonusMode: 'none', koikoiLimit: 0 }),
    withFlags({ koiKoiBonusMode: 'additive', opponentKoiBonusFactor: 5, koikoiLimit: 1 }),
    withFlags({ koiKoiBonusMode: 'multiplicative', opponentKoiBonusFactor: 5, koikoiLimit: 12 }),
    withFlags({ noYakuPolicy: 'seat-points', noYakuParentPoints: 2, noYakuChildPoints: 1 }),
    withFlags({ noYakuPolicy: 'seat-points', noYakuParentPoints: 0, noYakuChildPoints: 0 }),
    withFlags({ dealerRotationMode: 'loser' }),
    withFlags({ dealerRotationMode: 'alternate' }),
    withFlags({ enableDrawOvertime: true, drawOvertimeMode: 'fixed', drawOvertimeRounds: 0 }),
    withFlags({ enableDrawOvertime: true, drawOvertimeMode: 'fixed', drawOvertimeRounds: 2 }),
    withFlags({ enableDrawOvertime: true, drawOvertimeMode: 'until-decision' }),
    withFlags({ yakuEnabled: { 'hanami-zake': false }, enableAmeNagare: true }),
    withFlags({ yakuEnabled: { 'tsukimi-zake': false }, enableKiriNagare: true }),
    withFlags({
      yakuPoints: {
        inoshikacho: 9,
        akatan: 8,
        aotan: 7,
        tane: 2,
        tanzaku: 2,
        kasu: 2,
      },
    }),
    withFlags({
      yakuPoints: {
        shiten: 0,
        inoshikacho: 0,
        'hanami-zake': 0,
        'tsukimi-zake': 0,
        akatan: 0,
        aotan: 0,
      },
    }),
    withFlags({
      yakuEnabled: {
        goko: false,
        shiko: false,
        'ame-shiko': false,
        sanko: false,
        shiten: false,
        inoshikacho: false,
        'hanami-zake': false,
        'tsukimi-zake': false,
        akatan: false,
        aotan: false,
        tane: false,
        tanzaku: false,
        kasu: false,
      },
    }),
  ]
}

function runOneSimulation(config: GameConfig, seed: number): KoiKoiGameState {
  const normalized = normalizeLocalRuleSettings(config.localRules)
  let state = createNewGame(config, seed)

  for (let step = 0; step < 8000; step += 1) {
    assertCardInvariants(state)
    assertScoreInvariants(state)
    expect(state.config.localRules).toEqual(normalized)
    assertWinnerInvariant(state)

    if (state.phase === 'gameOver') {
      return state
    }

    state = nextState(state)
  }

  throw new Error(`Simulation did not terminate (seed=${seed})`)
}

describe('rule audit simulation', () => {
  const variants = buildRuleVariants()
  const seeds = [3, 11, 29]
  const rounds = [3, 6] as const

  it('keeps rule consistency across local-rule combinations and rounds', () => {
    for (const maxRounds of rounds) {
      for (const localRules of variants) {
        const normalized = normalizeLocalRuleSettings(localRules)
        for (const seed of seeds) {
          const config: GameConfig = {
            ...DEFAULT_CONFIG,
            maxRounds,
            localRules,
            enableAI: true,
            aiDifficulty: 'futsuu',
          }
          const finalState = runOneSimulation(config, seed)
          expect(finalState.round).toBeGreaterThanOrEqual(maxRounds)
          if (!normalized.enableDrawOvertime || normalized.drawOvertimeMode === 'fixed') {
            const overtimeRounds =
              normalized.enableDrawOvertime && normalized.drawOvertimeMode === 'fixed'
                ? normalized.drawOvertimeRounds
                : 0
            expect(finalState.round).toBeLessThanOrEqual(maxRounds + overtimeRounds)
          }
        }
      }
    }
  }, 60_000)
})

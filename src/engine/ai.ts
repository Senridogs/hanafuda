import type { HanafudaCard } from './types'
import type { KoiKoiDecision, KoiKoiGameState } from './game'
import { getMatchingFieldCards } from './game'
import { getYakuTotalPoints } from './yaku'

const TYPE_PRIORITY: Record<HanafudaCard['type'], number> = {
  hikari: 4,
  tane: 3,
  tanzaku: 2,
  kasu: 1,
}

function sortMatchCandidates(a: HanafudaCard, b: HanafudaCard): number {
  const typePriorityDiff = TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type]
  if (typePriorityDiff !== 0) {
    return typePriorityDiff
  }
  return b.points - a.points
}

export function chooseAiHandCard(state: KoiKoiGameState): HanafudaCard | null {
  const aiPlayer = state.players[state.currentPlayerIndex]
  if (aiPlayer.hand.length === 0) {
    return null
  }

  const ranked = [...aiPlayer.hand].sort((left, right) => {
    const leftMatches = getMatchingFieldCards(left, state.field).length
    const rightMatches = getMatchingFieldCards(right, state.field).length

    const leftScore = leftMatches > 0 ? 100 + leftMatches * 10 + TYPE_PRIORITY[left.type] : -left.points
    const rightScore = rightMatches > 0 ? 100 + rightMatches * 10 + TYPE_PRIORITY[right.type] : -right.points
    return rightScore - leftScore
  })

  return ranked[0] ?? null
}

export function chooseAiMatch(matches: readonly HanafudaCard[]): HanafudaCard | null {
  if (matches.length === 0) {
    return null
  }
  return [...matches].sort(sortMatchCandidates)[0] ?? null
}

export function chooseAiKoiKoi(state: KoiKoiGameState): KoiKoiDecision {
  const player = state.players[state.currentPlayerIndex]
  const currentRoundPoints = getYakuTotalPoints(player.completedYaku)

  if (player.score + currentRoundPoints >= state.config.targetScore) {
    return 'stop'
  }
  if (state.koikoiCounts[state.currentPlayerIndex] >= 2) {
    return 'stop'
  }
  if (currentRoundPoints >= 7) {
    return 'stop'
  }
  if (state.round >= state.config.maxRounds) {
    return 'stop'
  }
  return 'koikoi'
}

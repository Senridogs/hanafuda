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

function getRandomInt(max: number): number {
  return Math.floor(Math.random() * max)
}

// ========== 手札選択 ==========

function chooseHandCard_Yowai(state: KoiKoiGameState): HanafudaCard | null {
  const aiPlayer = state.players[state.currentPlayerIndex]
  if (aiPlayer.hand.length === 0) {
    return null
  }
  // ランダム選択
  return aiPlayer.hand[getRandomInt(aiPlayer.hand.length)] ?? null
}

function chooseHandCard_Futsuu(state: KoiKoiGameState): HanafudaCard | null {
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

function chooseHandCard_Tsuyoi(state: KoiKoiGameState): HanafudaCard | null {
  const aiPlayer = state.players[state.currentPlayerIndex]
  if (aiPlayer.hand.length === 0) {
    return null
  }

  const ranked = [...aiPlayer.hand].sort((left, right) => {
    const leftMatches = getMatchingFieldCards(left, state.field)
    const rightMatches = getMatchingFieldCards(right, state.field)

    // マッチ数が多いほど優先
    if (leftMatches.length !== rightMatches.length) {
      return rightMatches.length - leftMatches.length
    }

    // マッチ数が同じ場合、カード価値で判定
    const leftValue = leftMatches.reduce((sum, card) => sum + card.points, 0) + TYPE_PRIORITY[left.type] * 10
    const rightValue = rightMatches.reduce((sum, card) => sum + card.points, 0) + TYPE_PRIORITY[right.type] * 10

    return rightValue - leftValue
  })

  return ranked[0] ?? null
}

function chooseHandCard_Yabai(state: KoiKoiGameState): HanafudaCard | null {
  const aiPlayer = state.players[state.currentPlayerIndex]
  if (aiPlayer.hand.length === 0) {
    return null
  }

  const ranked = [...aiPlayer.hand].sort((left, right) => {
    const leftMatches = getMatchingFieldCards(left, state.field)
    const rightMatches = getMatchingFieldCards(right, state.field)

    // マッチ数が多いほど優先
    if (leftMatches.length !== rightMatches.length) {
      return rightMatches.length - leftMatches.length
    }

    // マッチ数が同じ場合、マッチカードの質で判定
    const leftMatchValue = leftMatches.reduce((sum, card) => sum + TYPE_PRIORITY[card.type] * 10 + card.points, 0)
    const rightMatchValue = rightMatches.reduce((sum, card) => sum + TYPE_PRIORITY[card.type] * 10 + card.points, 0)

    if (leftMatchValue !== rightMatchValue) {
      return rightMatchValue - leftMatchValue
    }

    // マッチなしの場合、カード価値で判定
    const leftValue = TYPE_PRIORITY[left.type] * 10 + left.points
    const rightValue = TYPE_PRIORITY[right.type] * 10 + right.points

    return rightValue - leftValue
  })

  return ranked[0] ?? null
}

function chooseHandCard_Oni(state: KoiKoiGameState): HanafudaCard | null {
  return chooseHandCard_Yabai(state)
}

function chooseHandCard_Kami(state: KoiKoiGameState): HanafudaCard | null {
  return chooseHandCard_Yabai(state)
}

export function chooseAiHandCard(state: KoiKoiGameState): HanafudaCard | null {
  const difficulty = state.config.aiDifficulty

  switch (difficulty) {
    case 'yowai':
      return chooseHandCard_Yowai(state)
    case 'futsuu':
      return chooseHandCard_Futsuu(state)
    case 'tsuyoi':
      return chooseHandCard_Tsuyoi(state)
    case 'yabai':
      return chooseHandCard_Yabai(state)
    case 'oni':
      return chooseHandCard_Oni(state)
    case 'kami':
      return chooseHandCard_Kami(state)
    default:
      return chooseHandCard_Futsuu(state)
  }
}

// ========== マッチ選択 ==========

function chooseMatch_Yowai(matches: readonly HanafudaCard[]): HanafudaCard | null {
  if (matches.length === 0) {
    return null
  }
  // ランダム選択
  return matches[getRandomInt(matches.length)] ?? null
}

function chooseMatch_Futsuu(matches: readonly HanafudaCard[]): HanafudaCard | null {
  if (matches.length === 0) {
    return null
  }
  return [...matches].sort(sortMatchCandidates)[0] ?? null
}

function chooseMatch_Tsuyoi(matches: readonly HanafudaCard[]): HanafudaCard | null {
  return chooseMatch_Futsuu(matches)
}

function chooseMatch_Yabai(matches: readonly HanafudaCard[]): HanafudaCard | null {
  return chooseMatch_Futsuu(matches)
}

function chooseMatch_Oni(matches: readonly HanafudaCard[]): HanafudaCard | null {
  return chooseMatch_Futsuu(matches)
}

function chooseMatch_Kami(matches: readonly HanafudaCard[]): HanafudaCard | null {
  return chooseMatch_Futsuu(matches)
}

export function chooseAiMatch(matches: readonly HanafudaCard[], difficulty: string): HanafudaCard | null {
  switch (difficulty) {
    case 'yowai':
      return chooseMatch_Yowai(matches)
    case 'futsuu':
      return chooseMatch_Futsuu(matches)
    case 'tsuyoi':
      return chooseMatch_Tsuyoi(matches)
    case 'yabai':
      return chooseMatch_Yabai(matches)
    case 'oni':
      return chooseMatch_Oni(matches)
    case 'kami':
      return chooseMatch_Kami(matches)
    default:
      return chooseMatch_Futsuu(matches)
  }
}

// ========== こいこい判定 ==========

function chooseKoiKoi_Yowai(): KoiKoiDecision {
  // 50%の確率でこいこい
  return Math.random() < 0.5 ? 'koikoi' : 'stop'
}

function chooseKoiKoi_Futsuu(state: KoiKoiGameState): KoiKoiDecision {
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

function chooseKoiKoi_Tsuyoi(state: KoiKoiGameState): KoiKoiDecision {
  const player = state.players[state.currentPlayerIndex]
  const opponent = state.players[1 - state.currentPlayerIndex]
  const currentRoundPoints = getYakuTotalPoints(player.completedYaku)
  const opponentScore = opponent.score

  // スコアが目標に近づいている場合は慎重に
  if (player.score + currentRoundPoints >= state.config.targetScore) {
    return 'stop'
  }

  // 相手のスコアが高い場合はより慎重に
  if (opponentScore > player.score + 20) {
    if (currentRoundPoints >= 5) {
      return 'stop'
    }
  }

  if (state.koikoiCounts[state.currentPlayerIndex] >= 2) {
    return 'stop'
  }
  if (currentRoundPoints >= 8) {
    return 'stop'
  }
  if (state.round >= state.config.maxRounds) {
    return 'stop'
  }
  return 'koikoi'
}

function chooseKoiKoi_Yabai(state: KoiKoiGameState): KoiKoiDecision {
  const player = state.players[state.currentPlayerIndex]
  const opponent = state.players[1 - state.currentPlayerIndex]
  const currentRoundPoints = getYakuTotalPoints(player.completedYaku)

  // 目標スコアに近い場合は必ず止める
  if (player.score + currentRoundPoints >= state.config.targetScore) {
    return 'stop'
  }

  // こいこい2回目以上は止める
  if (state.koikoiCounts[state.currentPlayerIndex] >= 1) {
    return 'stop'
  }

  // 相手が自分より70点以上高い場合は積極的
  if (opponent.score > player.score + 30) {
    if (currentRoundPoints < 12) {
      return 'koikoi'
    }
  }

  // 自分がリードしている場合は慎重に
  if (player.score >= opponent.score) {
    if (currentRoundPoints >= 9) {
      return 'stop'
    }
  }

  // 最終ラウンドの判定
  if (state.round >= state.config.maxRounds) {
    if (player.score + currentRoundPoints >= opponent.score) {
      return 'stop'
    }
    return 'koikoi'
  }

  return currentRoundPoints >= 6 ? 'stop' : 'koikoi'
}

function chooseKoiKoi_Oni(state: KoiKoiGameState): KoiKoiDecision {
  const player = state.players[state.currentPlayerIndex]
  const opponent = state.players[1 - state.currentPlayerIndex]
  const currentRoundPoints = getYakuTotalPoints(player.completedYaku)
  const totalPlayerScore = player.score + currentRoundPoints

  // 目標スコアに到達できる場合は止める
  if (totalPlayerScore >= state.config.targetScore) {
    return 'stop'
  }

  // 自分がすでに勝利している場合は止める
  if (player.score >= state.config.targetScore) {
    return 'stop'
  }

  // こいこい2回目は基本的に止める
  if (state.koikoiCounts[state.currentPlayerIndex] >= 2) {
    return 'stop'
  }

  // 最終ラウンドで相手に勝てる場合は止める
  if (state.round >= state.config.maxRounds) {
    if (totalPlayerScore > opponent.score) {
      return 'stop'
    }
    // 負けている場合は続ける
    return 'koikoi'
  }

  // 相手とのスコア差を考慮
  const scoreDifference = opponent.score - player.score

  if (scoreDifference > 40) {
    // 大きく遅れている場合は積極的
    return 'koikoi'
  }

  if (scoreDifference < -20) {
    // 大きくリードしている場合は慎重に
    return currentRoundPoints >= 8 ? 'stop' : 'koikoi'
  }

  // 通常時
  return currentRoundPoints >= 7 ? 'stop' : 'koikoi'
}

function chooseKoiKoi_Kami(state: KoiKoiGameState): KoiKoiDecision {
  const player = state.players[state.currentPlayerIndex]
  const opponent = state.players[1 - state.currentPlayerIndex]
  const currentRoundPoints = getYakuTotalPoints(player.completedYaku)
  const totalPlayerScore = player.score + currentRoundPoints

  // 目標スコアに到達できる場合は止める
  if (totalPlayerScore >= state.config.targetScore) {
    return 'stop'
  }

  // 自分がすでに勝利している場合は止める
  if (player.score >= state.config.targetScore) {
    return 'stop'
  }

  // こいこい回数が多い場合は止める
  if (state.koikoiCounts[state.currentPlayerIndex] >= 2) {
    return 'stop'
  }

  // 最終ラウンドの判定
  if (state.round >= state.config.maxRounds) {
    // 最後のチャンス：合理的な判断を下す
    const finalOpponentScore = opponent.score
    if (totalPlayerScore > finalOpponentScore) {
      return 'stop'
    }
    // 負けている場合、期待値を計算（完璧な判定）
    return 'koikoi'
  }

  // スコア差と現在のポイント数で最適判定
  const scoreDifference = opponent.score - player.score

  // リスク評価：こいこいで失敗する確率を考慮
  // ポイント数が多いほどリスクは高い
  const riskFactor = currentRoundPoints * 0.15

  if (scoreDifference > 50) {
    // 大きく遅れている：積極的
    return 'koikoi'
  }

  if (scoreDifference < -30) {
    // 大きくリードしている：保守的
    return currentRoundPoints >= 9 - riskFactor ? 'stop' : 'koikoi'
  }

  // 通常時：期待値最大化
  const threshold = 7 + (scoreDifference * 0.01) + riskFactor
  return currentRoundPoints >= threshold ? 'stop' : 'koikoi'
}

export function chooseAiKoiKoi(state: KoiKoiGameState): KoiKoiDecision {
  const difficulty = state.config.aiDifficulty

  switch (difficulty) {
    case 'yowai':
      return chooseKoiKoi_Yowai()
    case 'futsuu':
      return chooseKoiKoi_Futsuu(state)
    case 'tsuyoi':
      return chooseKoiKoi_Tsuyoi(state)
    case 'yabai':
      return chooseKoiKoi_Yabai(state)
    case 'oni':
      return chooseKoiKoi_Oni(state)
    case 'kami':
      return chooseKoiKoi_Kami(state)
    default:
      return chooseKoiKoi_Futsuu(state)
  }
}

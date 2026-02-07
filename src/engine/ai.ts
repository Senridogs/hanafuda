import type { HanafudaCard } from './types'
import type { KoiKoiDecision, KoiKoiGameState } from './game'
import { getMatchingFieldCards } from './game'
import { HANAFUDA_CARDS } from './cards'
import { calculateYaku, getYakuTotalPoints } from './yaku'

const TYPE_PRIORITY: Record<HanafudaCard['type'], number> = {
  hikari: 4,
  tane: 3,
  tanzaku: 2,
  kasu: 1,
}

const INOSHIKACHO_IDS = ['jun-tane', 'jul-tane', 'oct-tane'] as const
const AKATAN_IDS = ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'] as const
const AOTAN_IDS = ['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'] as const
const HANAMI_IDS = ['mar-hikari', 'sep-tane'] as const
const TSUKIMI_IDS = ['aug-hikari', 'sep-tane'] as const

const SPECIAL_COMBO_IDS = new Set<string>([
  ...INOSHIKACHO_IDS,
  ...AKATAN_IDS,
  ...AOTAN_IDS,
  ...HANAMI_IDS,
  ...TSUKIMI_IDS,
  'dec-hikari',
])

interface SearchProfile {
  readonly drawSamples: number
  readonly immediateProgressWeight: number
  readonly immediateCaptureWeight: number
  readonly drawExpectationWeight: number
  readonly fieldRiskWeight: number
  readonly opponentThreatWeight: number
  readonly handPotentialWeight: number
  readonly topN: number
}

const TSUYOI_PROFILE: SearchProfile = {
  drawSamples: 4,
  immediateProgressWeight: 1.0,
  immediateCaptureWeight: 1.9,
  drawExpectationWeight: 0.45,
  fieldRiskWeight: 0.15,
  opponentThreatWeight: 0.08,
  handPotentialWeight: 0.22,
  topN: 2,
}

const YABAI_PROFILE: SearchProfile = {
  drawSamples: 8,
  immediateProgressWeight: 1.05,
  immediateCaptureWeight: 2.2,
  drawExpectationWeight: 0.72,
  fieldRiskWeight: 0.2,
  opponentThreatWeight: 0.14,
  handPotentialWeight: 0.3,
  topN: 1,
}

const ONI_PROFILE: SearchProfile = {
  drawSamples: 8,
  immediateProgressWeight: 1.04,
  immediateCaptureWeight: 2.08,
  drawExpectationWeight: 0.62,
  fieldRiskWeight: 0.18,
  opponentThreatWeight: 0.12,
  handPotentialWeight: 0.28,
  topN: 1,
}

const KAMI_PROFILE: SearchProfile = {
  drawSamples: Number.MAX_SAFE_INTEGER,
  immediateProgressWeight: 1.16,
  immediateCaptureWeight: 2.75,
  drawExpectationWeight: 1.25,
  fieldRiskWeight: 0.44,
  opponentThreatWeight: 0.38,
  handPotentialWeight: 0.56,
  topN: 1,
}

interface HandStepOutcome {
  readonly chosenMatch: HanafudaCard | null
  readonly capturedNow: readonly HanafudaCard[]
  readonly capturedAfter: readonly HanafudaCard[]
  readonly fieldAfter: readonly HanafudaCard[]
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

function removeCardsFromField(field: readonly HanafudaCard[], targets: readonly HanafudaCard[]): HanafudaCard[] {
  const targetIds = new Set(targets.map((card) => card.id))
  return field.filter((card) => !targetIds.has(card.id))
}

function getLegalHandCards(state: KoiKoiGameState): HanafudaCard[] {
  const aiPlayer = state.players[state.currentPlayerIndex]
  if (aiPlayer.hand.length === 0) {
    return []
  }

  const matchable = aiPlayer.hand.filter((card) => getMatchingFieldCards(card, state.field).length > 0)
  return matchable.length > 0 ? matchable : [...aiPlayer.hand]
}

function tacticalCardValue(card: HanafudaCard): number {
  let value = TYPE_PRIORITY[card.type] * 12 + card.points * 2.4
  if (SPECIAL_COMBO_IDS.has(card.id)) {
    value += 11
  }
  if (card.id === 'nov-hikari') {
    value -= 4
  }
  return value
}

function countCardsInSet(captured: readonly HanafudaCard[], ids: readonly string[]): number {
  const capturedIds = new Set(captured.map((card) => card.id))
  return ids.reduce((count, id) => (capturedIds.has(id) ? count + 1 : count), 0)
}

function progressBonus(count: number, points: readonly number[]): number {
  if (count <= 0) {
    return 0
  }
  if (count >= points.length) {
    return points[points.length - 1] ?? 0
  }
  return points[count] ?? 0
}

function evaluateCapturedStrength(captured: readonly HanafudaCard[]): number {
  const yakuPoints = getYakuTotalPoints(calculateYaku(captured))
  const hikariCount = captured.filter((card) => card.type === 'hikari').length
  const taneCount = captured.filter((card) => card.type === 'tane').length
  const tanzakuCount = captured.filter((card) => card.type === 'tanzaku').length
  const kasuCount = captured.filter((card) => card.type === 'kasu').length

  let score = yakuPoints * 280
  score += captured.reduce((sum, card) => sum + tacticalCardValue(card), 0)

  score += hikariCount * hikariCount * 16
  score += taneCount * 10
  score += tanzakuCount * 7
  score += kasuCount * 3

  score += progressBonus(countCardsInSet(captured, INOSHIKACHO_IDS), [0, 10, 34, 86])
  score += progressBonus(countCardsInSet(captured, AKATAN_IDS), [0, 8, 26, 70])
  score += progressBonus(countCardsInSet(captured, AOTAN_IDS), [0, 8, 26, 70])
  score += progressBonus(countCardsInSet(captured, HANAMI_IDS), [0, 12, 46])
  score += progressBonus(countCardsInSet(captured, TSUKIMI_IDS), [0, 12, 46])

  if (taneCount >= 4) {
    score += 16 + (taneCount - 4) * 8
  }
  if (tanzakuCount >= 4) {
    score += 12 + (tanzakuCount - 4) * 6
  }
  if (kasuCount >= 8) {
    score += 10 + (kasuCount - 8) * 4
  }

  const capturedIds = new Set(captured.map((card) => card.id))
  if (capturedIds.has('nov-hikari') && hikariCount === 3) {
    score -= 14
  }

  return score
}

function evaluateFieldDanger(field: readonly HanafudaCard[]): number {
  const byMonth = new Map<number, HanafudaCard[]>()
  for (const card of field) {
    const current = byMonth.get(card.month)
    if (current) {
      current.push(card)
    } else {
      byMonth.set(card.month, [card])
    }
  }

  let danger = 0
  for (const cards of byMonth.values()) {
    const groupValue = cards.reduce((sum, card) => sum + tacticalCardValue(card), 0)
    const multiplier = cards.length >= 3 ? 1.55 : cards.length === 2 ? 1.12 : 0.45
    danger += groupValue * multiplier
  }
  return danger
}

function evaluateFutureHandPotential(hand: readonly HanafudaCard[], field: readonly HanafudaCard[]): number {
  let total = 0
  for (const card of hand) {
    const matches = getMatchingFieldCards(card, field).length
    if (matches > 0) {
      total += tacticalCardValue(card) * (0.45 + matches * 0.2)
    } else {
      total += TYPE_PRIORITY[card.type] * 2.5
    }
  }
  return total
}

function sampleCards(cards: readonly HanafudaCard[], sampleCount: number): readonly HanafudaCard[] {
  if (cards.length <= 1 || sampleCount >= cards.length) {
    return cards
  }

  const samples: HanafudaCard[] = []
  const used = new Set<number>()
  for (let i = 0; i < sampleCount; i += 1) {
    const index = Math.floor((i * cards.length) / sampleCount)
    if (!used.has(index)) {
      const card = cards[index]
      if (card) {
        samples.push(card)
      }
      used.add(index)
    }
  }

  if (samples.length === 0) {
    const first = cards[0]
    return first ? [first] : []
  }
  return samples
}

function buildUnknownDrawCandidates(
  state: KoiKoiGameState,
  knownOwnHand: readonly HanafudaCard[],
  knownField: readonly HanafudaCard[],
  knownOwnCaptured: readonly HanafudaCard[],
): HanafudaCard[] {
  const opponentIndex: 0 | 1 = state.currentPlayerIndex === 0 ? 1 : 0
  const knownIds = new Set<string>()

  for (const card of knownOwnHand) {
    knownIds.add(card.id)
  }
  for (const card of knownField) {
    knownIds.add(card.id)
  }
  for (const card of knownOwnCaptured) {
    knownIds.add(card.id)
  }
  for (const card of state.players[opponentIndex].captured) {
    knownIds.add(card.id)
  }
  if (state.selectedHandCard) {
    knownIds.add(state.selectedHandCard.id)
  }
  if (state.drawnCard) {
    knownIds.add(state.drawnCard.id)
  }

  return HANAFUDA_CARDS.filter((card) => !knownIds.has(card.id))
}

function estimateOpponentCaptureThreat(
  field: readonly HanafudaCard[],
  unknownCandidates: readonly HanafudaCard[],
): number {
  if (field.length === 0 || unknownCandidates.length === 0) {
    return 0
  }

  const unknownByMonth = new Map<number, number>()
  for (const card of unknownCandidates) {
    unknownByMonth.set(card.month, (unknownByMonth.get(card.month) ?? 0) + 1)
  }

  let threat = 0
  for (const card of field) {
    const monthUnknown = unknownByMonth.get(card.month) ?? 0
    const exposure = monthUnknown / 3
    threat += tacticalCardValue(card) * exposure
  }

  return threat
}

function estimateStopPointsFromCaptured(captured: readonly HanafudaCard[], opponentAlreadyKoikoi: boolean): number {
  const basePoints = Math.max(1, getYakuTotalPoints(calculateYaku(captured)))
  let multiplier = 1
  if (basePoints >= 7) {
    multiplier *= 2
  }
  if (opponentAlreadyKoikoi) {
    multiplier *= 2
  }
  return basePoints * multiplier
}

function simulateCapture(
  field: readonly HanafudaCard[],
  capturedBase: readonly HanafudaCard[],
  sourceCard: HanafudaCard,
  matchedCards: readonly HanafudaCard[],
): { capturedNow: readonly HanafudaCard[]; capturedAfter: readonly HanafudaCard[]; fieldAfter: readonly HanafudaCard[] } {
  if (matchedCards.length === 0) {
    return {
      capturedNow: [],
      capturedAfter: capturedBase,
      fieldAfter: [...field, sourceCard],
    }
  }

  const capturedNow: readonly HanafudaCard[] = [sourceCard, ...matchedCards]
  return {
    capturedNow,
    capturedAfter: [...capturedBase, ...capturedNow],
    fieldAfter: removeCardsFromField(field, matchedCards),
  }
}

function enumerateHandStepOutcomes(state: KoiKoiGameState, handCard: HanafudaCard): HandStepOutcome[] {
  const aiPlayer = state.players[state.currentPlayerIndex]
  const matches = getMatchingFieldCards(handCard, state.field)

  if (matches.length === 0) {
    const simulated = simulateCapture(state.field, aiPlayer.captured, handCard, [])
    return [{ chosenMatch: null, ...simulated }]
  }

  if (matches.length === 3) {
    const simulated = simulateCapture(state.field, aiPlayer.captured, handCard, matches)
    return [{ chosenMatch: matches[0] ?? null, ...simulated }]
  }

  if (matches.length === 1) {
    const only = matches[0]
    if (!only) {
      return []
    }
    const simulated = simulateCapture(state.field, aiPlayer.captured, handCard, [only])
    return [{ chosenMatch: only, ...simulated }]
  }

  return matches.map((matchedCard) => {
    const simulated = simulateCapture(state.field, aiPlayer.captured, handCard, [matchedCard])
    return { chosenMatch: matchedCard, ...simulated }
  })
}

function estimateDrawExpectation(
  drawCandidates: readonly HanafudaCard[],
  fieldAfterHand: readonly HanafudaCard[],
  capturedAfterHand: readonly HanafudaCard[],
  profile: SearchProfile,
): number {
  if (drawCandidates.length === 0 || profile.drawSamples <= 0) {
    return 0
  }

  const drawSamples = sampleCards(drawCandidates, Math.min(drawCandidates.length, profile.drawSamples))
  if (drawSamples.length === 0) {
    return 0
  }

  const baselineCaptured = evaluateCapturedStrength(capturedAfterHand)
  const baselineDanger = evaluateFieldDanger(fieldAfterHand)
  let total = 0

  for (const drawCard of drawSamples) {
    const matches = getMatchingFieldCards(drawCard, fieldAfterHand)

    let scenarioBest = Number.NEGATIVE_INFINITY
    if (matches.length === 0) {
      const fieldAfterDraw = [...fieldAfterHand, drawCard]
      scenarioBest = (baselineDanger - evaluateFieldDanger(fieldAfterDraw)) * 0.5
    } else if (matches.length === 3) {
      const simulated = simulateCapture(fieldAfterHand, capturedAfterHand, drawCard, matches)
      const capturedDelta = evaluateCapturedStrength(simulated.capturedAfter) - baselineCaptured
      const cardGain = simulated.capturedNow.reduce((sum, card) => sum + tacticalCardValue(card), 0)
      const dangerRelief = baselineDanger - evaluateFieldDanger(simulated.fieldAfter)
      scenarioBest = capturedDelta + cardGain * 1.2 + dangerRelief * 0.6
    } else {
      for (const match of matches) {
        const simulated = simulateCapture(fieldAfterHand, capturedAfterHand, drawCard, [match])
        const capturedDelta = evaluateCapturedStrength(simulated.capturedAfter) - baselineCaptured
        const cardGain = simulated.capturedNow.reduce((sum, card) => sum + tacticalCardValue(card), 0)
        const dangerRelief = baselineDanger - evaluateFieldDanger(simulated.fieldAfter)
        const scenarioScore = capturedDelta + cardGain * 1.2 + dangerRelief * 0.6
        if (scenarioScore > scenarioBest) {
          scenarioBest = scenarioScore
        }
      }
    }

    total += Number.isFinite(scenarioBest) ? scenarioBest : 0
  }

  return total / drawSamples.length
}

function evaluateHandOutcome(
  state: KoiKoiGameState,
  handCard: HanafudaCard,
  outcome: HandStepOutcome,
  profile: SearchProfile,
): number {
  const aiPlayer = state.players[state.currentPlayerIndex]
  const capturedBeforeScore = evaluateCapturedStrength(aiPlayer.captured)
  const capturedAfterScore = evaluateCapturedStrength(outcome.capturedAfter)
  const capturedDelta = capturedAfterScore - capturedBeforeScore
  const immediateCardGain = outcome.capturedNow.reduce((sum, card) => sum + tacticalCardValue(card), 0)

  const remainingHand = aiPlayer.hand.filter((card) => card.id !== handCard.id)
  const futureHandPotential = evaluateFutureHandPotential(remainingHand, outcome.fieldAfter)
  const drawCandidates = buildUnknownDrawCandidates(state, remainingHand, outcome.fieldAfter, outcome.capturedAfter)
  const drawExpectation = estimateDrawExpectation(drawCandidates, outcome.fieldAfter, outcome.capturedAfter, profile)
  const fieldRisk = evaluateFieldDanger(outcome.fieldAfter)
  const opponentThreat = estimateOpponentCaptureThreat(outcome.fieldAfter, drawCandidates)
  const stopPoints = estimateStopPointsFromCaptured(
    outcome.capturedAfter,
    state.koikoiCounts[state.currentPlayerIndex === 0 ? 1 : 0] > 0,
  )
  const stopPotential = stopPoints * 18

  return capturedDelta * profile.immediateProgressWeight
    + immediateCardGain * profile.immediateCaptureWeight
    + drawExpectation * profile.drawExpectationWeight
    + futureHandPotential * profile.handPotentialWeight
    + stopPotential
    - fieldRisk * profile.fieldRiskWeight
    - opponentThreat * profile.opponentThreatWeight
}

function chooseByProfile(state: KoiKoiGameState, profile: SearchProfile): HanafudaCard | null {
  const legalCards = getLegalHandCards(state)
  if (legalCards.length === 0) {
    return null
  }

  const scored = legalCards
    .map((handCard) => {
      const outcomes = enumerateHandStepOutcomes(state, handCard)
      const bestOutcomeScore = outcomes.reduce((best, outcome) => {
        const score = evaluateHandOutcome(state, handCard, outcome, profile)
        return score > best ? score : best
      }, Number.NEGATIVE_INFINITY)
      return { card: handCard, score: bestOutcomeScore }
    })
    .sort((left, right) => right.score - left.score)

  if (scored.length === 0) {
    return legalCards[0] ?? null
  }

  const topCount = Math.max(1, Math.min(profile.topN, scored.length))
  const picked = scored[getRandomInt(topCount)]
  return picked?.card ?? scored[0]?.card ?? null
}

// ========== 手札選択 ==========

function chooseHandCard_Yowai(state: KoiKoiGameState): HanafudaCard | null {
  const legalCards = getLegalHandCards(state)
  if (legalCards.length === 0) {
    return null
  }
  return legalCards[getRandomInt(legalCards.length)] ?? null
}

function chooseHandCard_Futsuu(state: KoiKoiGameState): HanafudaCard | null {
  const legalCards = getLegalHandCards(state)
  if (legalCards.length === 0) {
    return null
  }

  const ranked = [...legalCards].sort((left, right) => {
    const leftMatches = getMatchingFieldCards(left, state.field).length
    const rightMatches = getMatchingFieldCards(right, state.field).length

    const leftScore = leftMatches > 0 ? 100 + leftMatches * 10 + TYPE_PRIORITY[left.type] : -left.points
    const rightScore = rightMatches > 0 ? 100 + rightMatches * 10 + TYPE_PRIORITY[right.type] : -right.points
    return rightScore - leftScore
  })

  return ranked[0] ?? null
}

function chooseHandCard_Tsuyoi(state: KoiKoiGameState): HanafudaCard | null {
  return chooseByProfile(state, TSUYOI_PROFILE)
}

function chooseHandCard_Yabai(state: KoiKoiGameState): HanafudaCard | null {
  return chooseByProfile(state, YABAI_PROFILE)
}

function chooseHandCard_Oni(state: KoiKoiGameState): HanafudaCard | null {
  return chooseByProfile(state, ONI_PROFILE)
}

function chooseHandCard_Kami(state: KoiKoiGameState): HanafudaCard | null {
  return chooseByProfile(state, KAMI_PROFILE)
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
  return matches[getRandomInt(matches.length)] ?? null
}

function chooseMatch_Futsuu(matches: readonly HanafudaCard[]): HanafudaCard | null {
  if (matches.length === 0) {
    return null
  }
  return [...matches].sort(sortMatchCandidates)[0] ?? null
}

function evaluatePendingMatchChoice(state: KoiKoiGameState, matchedCard: HanafudaCard, profile: SearchProfile): number {
  const aiPlayer = state.players[state.currentPlayerIndex]
  const sourceCard = state.pendingSource === 'hand' ? state.selectedHandCard : state.drawnCard

  if (!sourceCard) {
    return tacticalCardValue(matchedCard)
  }

  const simulated = simulateCapture(state.field, aiPlayer.captured, sourceCard, [matchedCard])
  const capturedBefore = evaluateCapturedStrength(aiPlayer.captured)
  const capturedAfter = evaluateCapturedStrength(simulated.capturedAfter)
  const capturedDelta = capturedAfter - capturedBefore
  const immediateCardGain = simulated.capturedNow.reduce((sum, card) => sum + tacticalCardValue(card), 0)
  const fieldRisk = evaluateFieldDanger(simulated.fieldAfter)
  const drawCandidates = buildUnknownDrawCandidates(state, aiPlayer.hand, simulated.fieldAfter, simulated.capturedAfter)
  const opponentThreat = estimateOpponentCaptureThreat(simulated.fieldAfter, drawCandidates)
  const stopPoints = estimateStopPointsFromCaptured(
    simulated.capturedAfter,
    state.koikoiCounts[state.currentPlayerIndex === 0 ? 1 : 0] > 0,
  )
  const stopPotential = stopPoints * 18

  let score = capturedDelta * profile.immediateProgressWeight
    + immediateCardGain * profile.immediateCaptureWeight
    + stopPotential
    - fieldRisk * profile.fieldRiskWeight
    - opponentThreat * profile.opponentThreatWeight

  if (state.pendingSource === 'hand') {
    const handPotential = evaluateFutureHandPotential(aiPlayer.hand, simulated.fieldAfter)
    const drawExpectation = estimateDrawExpectation(drawCandidates, simulated.fieldAfter, simulated.capturedAfter, profile)
    score += handPotential * profile.handPotentialWeight
    score += drawExpectation * profile.drawExpectationWeight
  }

  return score
}

function chooseMatch_ByProfile(
  matches: readonly HanafudaCard[],
  state: KoiKoiGameState | undefined,
  profile: SearchProfile,
): HanafudaCard | null {
  if (matches.length === 0) {
    return null
  }

  if (!state) {
    return chooseMatch_Futsuu(matches)
  }

  const scored = matches
    .map((card) => ({ card, score: evaluatePendingMatchChoice(state, card, profile) }))
    .sort((left, right) => right.score - left.score)

  if (scored.length === 0) {
    return matches[0] ?? null
  }

  const topCount = Math.max(1, Math.min(profile.topN, scored.length))
  const picked = scored[getRandomInt(topCount)]
  return picked?.card ?? scored[0]?.card ?? null
}

function chooseMatch_Tsuyoi(matches: readonly HanafudaCard[], state: KoiKoiGameState | undefined): HanafudaCard | null {
  return chooseMatch_ByProfile(matches, state, TSUYOI_PROFILE)
}

function chooseMatch_Yabai(matches: readonly HanafudaCard[], state: KoiKoiGameState | undefined): HanafudaCard | null {
  return chooseMatch_ByProfile(matches, state, YABAI_PROFILE)
}

function chooseMatch_Oni(matches: readonly HanafudaCard[], state: KoiKoiGameState | undefined): HanafudaCard | null {
  return chooseMatch_ByProfile(matches, state, ONI_PROFILE)
}

function chooseMatch_Kami(matches: readonly HanafudaCard[], state: KoiKoiGameState | undefined): HanafudaCard | null {
  return chooseMatch_ByProfile(matches, state, KAMI_PROFILE)
}

export function chooseAiMatch(
  matches: readonly HanafudaCard[],
  difficulty: string,
  state?: KoiKoiGameState,
): HanafudaCard | null {
  switch (difficulty) {
    case 'yowai':
      return chooseMatch_Yowai(matches)
    case 'futsuu':
      return chooseMatch_Futsuu(matches)
    case 'tsuyoi':
      return chooseMatch_Tsuyoi(matches, state)
    case 'yabai':
      return chooseMatch_Yabai(matches, state)
    case 'oni':
      return chooseMatch_Oni(matches, state)
    case 'kami':
      return chooseMatch_Kami(matches, state)
    default:
      return chooseMatch_Futsuu(matches)
  }
}

// ========== こいこい判定 ==========

function estimateStopRoundPoints(state: KoiKoiGameState, playerIndex: 0 | 1): number {
  const player = state.players[playerIndex]
  const opponentIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
  const basePoints = Math.max(1, getYakuTotalPoints(player.completedYaku))

  let multiplier = 1
  if (basePoints >= 7) {
    multiplier *= 2
  }
  if (state.koikoiCounts[opponentIndex] > 0) {
    multiplier *= 2
  }

  return basePoints * multiplier
}

function chooseKoiKoi_Yowai(): KoiKoiDecision {
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

  if (player.score + currentRoundPoints >= state.config.targetScore) {
    return 'stop'
  }
  if (state.koikoiCounts[state.currentPlayerIndex] >= 2) {
    return 'stop'
  }
  if (opponent.score > player.score + 18 && currentRoundPoints >= 5) {
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

  if (player.score + currentRoundPoints >= state.config.targetScore) {
    return 'stop'
  }
  if (state.koikoiCounts[state.currentPlayerIndex] >= 1) {
    return 'stop'
  }
  if (opponent.score > player.score + 25 && currentRoundPoints < 10) {
    return 'koikoi'
  }
  if (player.score >= opponent.score && currentRoundPoints >= 7) {
    return 'stop'
  }
  if (state.round >= state.config.maxRounds) {
    return player.score + currentRoundPoints >= opponent.score ? 'stop' : 'koikoi'
  }
  return currentRoundPoints >= 6 ? 'stop' : 'koikoi'
}

function chooseKoiKoi_Oni(state: KoiKoiGameState): KoiKoiDecision {
  const playerIndex = state.currentPlayerIndex
  const opponentIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
  const player = state.players[playerIndex]
  const opponent = state.players[opponentIndex]

  const currentRoundPoints = getYakuTotalPoints(player.completedYaku)
  const stopPoints = estimateStopRoundPoints(state, playerIndex)
  const stopTotal = player.score + stopPoints
  const leadIfStop = stopTotal - opponent.score

  if (stopTotal >= state.config.targetScore) {
    return 'stop'
  }
  if (state.round >= state.config.maxRounds) {
    return leadIfStop > 0 ? 'stop' : 'koikoi'
  }
  if (state.koikoiCounts[playerIndex] >= 2) {
    return 'stop'
  }
  if (stopPoints >= 8) {
    return 'stop'
  }
  if (leadIfStop >= 12 && stopPoints >= 4) {
    return 'stop'
  }

  const deficit = opponent.score - player.score
  if (deficit >= 14) {
    return 'koikoi'
  }

  const turnsLeft = Math.max(0, player.hand.length)
  const expectedGain = 1.6 + turnsLeft * 0.55 + Math.max(0, deficit) * 0.09
  const riskPenalty = stopPoints * (0.58 + turnsLeft * 0.06 + (state.koikoiCounts[opponentIndex] > 0 ? 0.18 : 0))

  const stopUtility = leadIfStop
  const koikoiUtility = player.score + currentRoundPoints + expectedGain - riskPenalty - opponent.score
  return koikoiUtility > stopUtility ? 'koikoi' : 'stop'
}

function chooseKoiKoi_Kami(state: KoiKoiGameState): KoiKoiDecision {
  const playerIndex = state.currentPlayerIndex
  const opponentIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
  const player = state.players[playerIndex]
  const opponent = state.players[opponentIndex]

  const currentRoundPoints = getYakuTotalPoints(player.completedYaku)
  const stopPoints = estimateStopRoundPoints(state, playerIndex)
  const stopTotal = player.score + stopPoints
  const leadIfStop = stopTotal - opponent.score

  if (stopTotal >= state.config.targetScore) {
    return 'stop'
  }
  if (state.round >= state.config.maxRounds) {
    return leadIfStop > 0 ? 'stop' : 'koikoi'
  }

  if (state.koikoiCounts[playerIndex] >= 2) {
    return 'stop'
  }
  if (state.koikoiCounts[playerIndex] >= 1 && stopPoints >= 2) {
    return 'stop'
  }
  if (stopPoints >= 3 && leadIfStop >= 0) {
    return 'stop'
  }

  if (stopPoints >= 8) {
    return 'stop'
  }
  if (leadIfStop >= 18 && stopPoints >= 3) {
    return 'stop'
  }
  if (leadIfStop >= 8 && stopPoints >= 5) {
    return 'stop'
  }

  const deficit = opponent.score - player.score
  if (deficit >= 16) {
    return 'koikoi'
  }

  const turnsLeft = Math.max(0, player.hand.length)
  if (leadIfStop >= 4 && stopPoints >= 2 && turnsLeft <= 3) {
    return 'stop'
  }
  if (turnsLeft <= 1 && stopPoints >= 2) {
    return 'stop'
  }

  const ownPotential = evaluateCapturedStrength(player.captured)
  const oppPotential = evaluateCapturedStrength(opponent.captured)
  const expectedGain = 1.6 + turnsLeft * 0.58 + Math.max(0, deficit) * 0.1 + Math.max(0, ownPotential - oppPotential) * 0.0006
  const riskPenalty = stopPoints * (0.78 + turnsLeft * 0.08 + (state.koikoiCounts[opponentIndex] > 0 ? 0.32 : 0))
    + Math.max(0, oppPotential - ownPotential) * 0.0012

  const stopUtility = leadIfStop
  const koikoiUtility = player.score + currentRoundPoints + expectedGain - riskPenalty - opponent.score
  return koikoiUtility > stopUtility ? 'koikoi' : 'stop'
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

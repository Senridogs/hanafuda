import { createDeck, createSeededRandom, dealCards, drawCard, shuffleDeck } from './deck'
import { DEFAULT_CONFIG, normalizeGameConfig, type GameConfig, type GameState, type HanafudaCard, type Player, type TurnAction, type Yaku } from './types'
import { calculateYaku, getYakuTotalPoints } from './yaku'

type PlayerTuple = readonly [Player, Player]

const DRAW_TYPE_WEIGHT: Record<HanafudaCard['type'], number> = {
  hikari: 12,
  tane: 8,
  tanzaku: 5,
  kasu: 2,
}

interface CpuAssistProfile {
  readonly openingMargin: number
  readonly maxExtraRetries: number
  readonly drawSearchWindow: number
  readonly drawRigChance: number
  readonly openingBias: 'favor-ai' | 'favor-human'
  readonly drawBias: 'best' | 'worst'
}

export type CpuRoundMood = 'hot' | 'normal' | 'cold'

const ROUND_MOOD_BASE: Record<GameConfig['aiDifficulty'], { hot: number; cold: number }> = {
  yowai: { hot: 0.12, cold: 0.35 },
  futsuu: { hot: 0.18, cold: 0.22 },
  tsuyoi: { hot: 0.30, cold: 0.18 },
  yabai: { hot: 0.40, cold: 0.14 },
  oni: { hot: 0.45, cold: 0.15 },
  kami: { hot: 0.50, cold: 0.16 },
}

const DIFFICULTY_SEED_OFFSET: Record<GameConfig['aiDifficulty'], number> = {
  yowai: 11,
  futsuu: 23,
  tsuyoi: 37,
  yabai: 53,
  oni: 71,
  kami: 89,
}

const ONI_CPU_ASSIST_PROFILE: CpuAssistProfile = {
  openingMargin: 5,
  maxExtraRetries: 16,
  drawSearchWindow: 2,
  drawRigChance: 0.20,
  openingBias: 'favor-ai',
  drawBias: 'best',
}

const CPU_ASSIST_BY_DIFFICULTY: Partial<Record<GameConfig['aiDifficulty'], CpuAssistProfile>> = {
  oni: ONI_CPU_ASSIST_PROFILE,
  kami: ONI_CPU_ASSIST_PROFILE,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function mixSeed(seed: number, value: number): number {
  let next = (seed ^ value) >>> 0
  next = Math.imul(next ^ (next >>> 16), 0x7feb352d)
  next = Math.imul(next ^ (next >>> 15), 0x846ca68b)
  return (next ^ (next >>> 16)) >>> 0
}

function buildRoundMoodRoll(
  difficulty: GameConfig['aiDifficulty'],
  round: number,
  maxRounds: number,
  ownScore: number,
  opponentScore: number,
): number {
  let seed = 0x9e37_79b9
  seed = mixSeed(seed, DIFFICULTY_SEED_OFFSET[difficulty])
  seed = mixSeed(seed, round)
  seed = mixSeed(seed, maxRounds)
  seed = mixSeed(seed, ownScore + 97)
  seed = mixSeed(seed, opponentScore + 193)
  return seed / 0x1_0000_0000
}

export function resolveDifficultyRoundMood(
  difficulty: GameConfig['aiDifficulty'],
  round: number,
  maxRounds: number,
  ownScore: number,
  opponentScore: number,
): CpuRoundMood {
  const base = ROUND_MOOD_BASE[difficulty]
  let hot = base.hot
  let cold = base.cold
  const lead = ownScore - opponentScore

  if (lead <= -10) {
    hot += 0.12
    cold -= 0.05
  } else if (lead >= 12) {
    hot -= 0.06
    cold += 0.1
  }

  if (round === maxRounds) {
    hot += 0.05
    cold -= 0.02
  }

  hot = clamp(hot, 0.03, 0.75)
  cold = clamp(cold, 0.03, 0.75)
  if (hot + cold > 0.92) {
    const scale = 0.92 / (hot + cold)
    hot *= scale
    cold *= scale
  }

  const roll = buildRoundMoodRoll(difficulty, round, maxRounds, ownScore, opponentScore)
  if (roll < cold) {
    return 'cold'
  }
  if (roll > 1 - hot) {
    return 'hot'
  }
  return 'normal'
}

function applyRoundMoodToAssistProfile(profile: CpuAssistProfile, mood: CpuRoundMood): CpuAssistProfile {
  if (mood === 'normal') {
    return profile
  }

  const polarity = mood === 'hot' ? 1 : -1
  const openingDirection = profile.openingBias === 'favor-ai' ? 1 : -1
  const drawDirection = profile.drawBias === 'best' ? 1 : -1

  const openingMultiplier = 1 + polarity * openingDirection * 0.28
  const retryMultiplier = 1 + polarity * openingDirection * 0.34
  const drawChanceMultiplier = 1 + polarity * drawDirection * 0.25
  const drawWindowShift = polarity * drawDirection

  return {
    ...profile,
    openingMargin: Math.max(0, Math.round(profile.openingMargin * openingMultiplier)),
    maxExtraRetries: Math.max(0, Math.round(profile.maxExtraRetries * retryMultiplier)),
    drawSearchWindow: Math.round(clamp(profile.drawSearchWindow + drawWindowShift, 1, 5)),
    drawRigChance: clamp(profile.drawRigChance * drawChanceMultiplier, 0.03, 0.93),
  }
}

export type MatchSource = 'hand' | 'draw' | null
export type RoundReason = 'stop' | 'exhausted' | 'draw' | null
export type KoiKoiDecision = 'koikoi' | 'stop'

export interface RoundScoreEntry {
  readonly round: number
  readonly player1Points: number
  readonly player2Points: number
}

export interface KoiKoiGameState extends GameState {
  readonly config: GameConfig
  readonly pendingMatches: readonly HanafudaCard[]
  readonly pendingSource: MatchSource
  readonly roundWinner: Player['id'] | null
  readonly roundPoints: number
  readonly roundReason: RoundReason
  readonly roundStarterIndex: 0 | 1
  readonly roundScoreHistory: readonly RoundScoreEntry[]
}

function createPlayer(id: Player['id'], name: string, score = 0): Player {
  return {
    id,
    name,
    hand: [],
    captured: [],
    score,
    completedYaku: [],
  }
}

function replacePlayer(players: PlayerTuple, index: 0 | 1, nextPlayer: Player): PlayerTuple {
  return index === 0 ? [nextPlayer, players[1]] : [players[0], nextPlayer]
}

function addTurnAction(state: KoiKoiGameState, action: TurnAction): KoiKoiGameState {
  return {
    ...state,
    turnHistory: [...state.turnHistory, action],
  }
}

function clearMatchArtifacts(state: KoiKoiGameState): KoiKoiGameState {
  return {
    ...state,
    selectedHandCard: null,
    drawnCard: null,
    pendingMatches: [],
    pendingSource: null,
  }
}

function clearTurnArtifacts(state: KoiKoiGameState): KoiKoiGameState {
  return {
    ...clearMatchArtifacts(state),
    newYaku: [],
  }
}

function isRoundExhausted(state: KoiKoiGameState): boolean {
  return state.deck.length === 0 || (state.players[0].hand.length === 0 && state.players[1].hand.length === 0)
}

function hasFourCardsOfSameMonth(cards: readonly HanafudaCard[]): boolean {
  const monthCounts = new Map<number, number>()
  for (const card of cards) {
    const nextCount = (monthCounts.get(card.month) ?? 0) + 1
    if (nextCount >= 4) {
      return true
    }
    monthCounts.set(card.month, nextCount)
  }
  return false
}

function requiresRedeal(
  player1Hand: readonly HanafudaCard[],
  player2Hand: readonly HanafudaCard[],
  field: readonly HanafudaCard[],
): boolean {
  return hasFourCardsOfSameMonth(field) || hasFourCardsOfSameMonth(player1Hand) || hasFourCardsOfSameMonth(player2Hand)
}

function getCpuAssistProfile(config: GameConfig): CpuAssistProfile | null {
  if (!config.enableAI) {
    return null
  }
  return CPU_ASSIST_BY_DIFFICULTY[config.aiDifficulty] ?? null
}

function resolveCpuAssistProfileForRound(
  config: GameConfig,
  round: number,
  humanScore: number,
  cpuScore: number,
): CpuAssistProfile | null {
  const normalizedConfig = normalizeGameConfig(config)
  const baseProfile = getCpuAssistProfile(normalizedConfig)
  if (!baseProfile) {
    return null
  }
  const mood = resolveDifficultyRoundMood(
    normalizedConfig.aiDifficulty,
    round,
    normalizedConfig.maxRounds,
    cpuScore,
    humanScore,
  )
  return applyRoundMoodToAssistProfile(baseProfile, mood)
}

function cardTempoValue(card: HanafudaCard): number {
  return DRAW_TYPE_WEIGHT[card.type] * 2 + card.points
}

function evaluateOpeningTempo(hand: readonly HanafudaCard[], field: readonly HanafudaCard[]): number {
  let total = 0
  for (const card of hand) {
    const matches = getMatchingFieldCards(card, field)
    if (matches.length === 0) {
      total += DRAW_TYPE_WEIGHT[card.type]
      continue
    }

    const bestField = matches.reduce((best, current) => Math.max(best, cardTempoValue(current)), 0)
    total += 36 + matches.length * 14 + cardTempoValue(card) + bestField
  }
  return total
}

function passesOpeningBias(
  humanHand: readonly HanafudaCard[],
  aiHand: readonly HanafudaCard[],
  field: readonly HanafudaCard[],
  margin: number,
  bias: CpuAssistProfile['openingBias'],
): boolean {
  const aiTempo = evaluateOpeningTempo(aiHand, field)
  const humanTempo = evaluateOpeningTempo(humanHand, field)
  if (bias === 'favor-human') {
    return aiTempo <= humanTempo - margin
  }
  return aiTempo >= humanTempo + margin
}

function drawImpactScore(card: HanafudaCard, field: readonly HanafudaCard[]): number {
  const matches = getMatchingFieldCards(card, field)
  if (matches.length === 0) {
    return -12 + DRAW_TYPE_WEIGHT[card.type]
  }
  const bestField = matches.reduce((best, current) => Math.max(best, cardTempoValue(current)), 0)
  return 42 + matches.length * 16 + cardTempoValue(card) + bestField
}

function chooseRiggedDrawIndexForCpu(
  deck: readonly HanafudaCard[],
  field: readonly HanafudaCard[],
  searchWindow: number,
  bias: CpuAssistProfile['drawBias'],
): number {
  const boundedWindow = Math.min(deck.length, searchWindow)
  if (boundedWindow <= 1) {
    return 0
  }

  let chosenIndex = 0
  const firstCard = deck[0]
  if (!firstCard) {
    return 0
  }
  let chosenScore = drawImpactScore(firstCard, field)
  for (let index = 1; index < boundedWindow; index += 1) {
    const card = deck[index]
    if (!card) {
      continue
    }
    const score = drawImpactScore(card, field)
    if ((bias === 'best' && score > chosenScore) || (bias === 'worst' && score < chosenScore)) {
      chosenIndex = index
      chosenScore = score
    }
  }

  return chosenIndex
}

function moveDeckIndexToTop(deck: readonly HanafudaCard[], index: number): HanafudaCard[] {
  if (index <= 0 || index >= deck.length) {
    return [...deck]
  }
  const moved = deck[index]
  if (!moved) {
    return [...deck]
  }
  const result = [...deck]
  result.splice(index, 1)
  result.unshift(moved)
  return result
}

function maybeRigDeckForCpu(state: KoiKoiGameState): readonly HanafudaCard[] {
  const assistProfile = resolveCpuAssistProfileForRound(
    state.config,
    state.round,
    state.players[0].score,
    state.players[1].score,
  )
  if (!assistProfile || state.deck.length <= 1) {
    return state.deck
  }
  if (state.currentPlayerIndex !== 1) {
    return state.deck
  }
  if (assistProfile.drawSearchWindow <= 1 || Math.random() > assistProfile.drawRigChance) {
    return state.deck
  }

  const chosenIndex = chooseRiggedDrawIndexForCpu(
    state.deck,
    state.field,
    assistProfile.drawSearchWindow,
    assistProfile.drawBias,
  )
  if (chosenIndex === 0) {
    return state.deck
  }
  return moveDeckIndexToTop(state.deck, chosenIndex)
}

function dealRound(
  players: PlayerTuple,
  config: GameConfig,
  round: number,
  starterIndex: 0 | 1,
  prevRoundScoreHistory: readonly RoundScoreEntry[] = [],
  random: () => number = Math.random,
): KoiKoiGameState {
  const normalizedConfig = normalizeGameConfig(config)
  const assistProfile = resolveCpuAssistProfileForRound(
    normalizedConfig,
    round,
    players[0].score,
    players[1].score,
  )
  let dealt = dealCards(shuffleDeck(createDeck(), random), random)
  let retries = 0
  const retryLimit = 256 + (assistProfile?.maxExtraRetries ?? 0)
  while (
    requiresRedeal(dealt.player1Hand, dealt.player2Hand, dealt.field)
    || (
      assistProfile
      && !passesOpeningBias(
        dealt.player1Hand,
        dealt.player2Hand,
        dealt.field,
        assistProfile.openingMargin,
        assistProfile.openingBias,
      )
    )
  ) {
    dealt = dealCards(shuffleDeck(createDeck(), random), random)
    retries += 1
    if (retries > retryLimit) {
      throw new Error('Failed to find a valid initial deal')
    }
  }
  const player1: Player = {
    ...players[0],
    hand: dealt.player1Hand,
    captured: [],
    completedYaku: [],
  }
  const player2: Player = {
    ...players[1],
    hand: dealt.player2Hand,
    captured: [],
    completedYaku: [],
  }

  return {
    phase: 'selectHandCard',
    deck: dealt.remainingDeck,
    field: dealt.field,
    players: [player1, player2],
    currentPlayerIndex: starterIndex,
    drawnCard: null,
    selectedHandCard: null,
    round,
    koikoiCounts: [0, 0],
    newYaku: [],
    winner: null,
    turnHistory: [],
    config: normalizedConfig,
    pendingMatches: [],
    pendingSource: null,
    roundWinner: null,
    roundPoints: 0,
    roundReason: null,
    roundStarterIndex: starterIndex,
    roundScoreHistory: prevRoundScoreHistory,
  }
}

function getPlayerIndex(playerId: Player['id']): 0 | 1 {
  return playerId === 'player1' ? 0 : 1
}

function determineGameWinner(players: PlayerTuple): Player['id'] | null {
  if (players[0].score === players[1].score) {
    return null
  }
  return players[0].score > players[1].score ? 'player1' : 'player2'
}

function getRoundScoreHistory(state: { readonly roundScoreHistory?: unknown }): readonly RoundScoreEntry[] {
  return Array.isArray(state.roundScoreHistory)
    ? (state.roundScoreHistory as readonly RoundScoreEntry[])
    : []
}

function hasReachedFinalRound(state: KoiKoiGameState, playersAfterRound: PlayerTuple): boolean {
  const normalizedConfig = normalizeGameConfig(state.config)
  if (state.round < normalizedConfig.maxRounds) {
    return false
  }

  const localRules = normalizedConfig.localRules
  const isTie = playersAfterRound[0].score === playersAfterRound[1].score

  if (localRules.enableDrawOvertime) {
    if (localRules.drawOvertimeMode === 'until-decision') {
      return !isTie
    }

    const overtimeRounds = localRules.drawOvertimeRounds
    const lastPlayableRound = normalizedConfig.maxRounds + overtimeRounds
    if (state.round < lastPlayableRound && isTie) {
      return false
    }
  }

  return true
}

function resolveNoYakuPoints(state: KoiKoiGameState, playerIndex: 0 | 1): number {
  const localRules = normalizeGameConfig(state.config).localRules
  if (localRules.noYakuPolicy === 'both-zero') {
    return 0
  }
  if (localRules.noYakuPolicy === 'seat-points') {
    const isParent = state.roundStarterIndex === playerIndex
    return isParent ? localRules.noYakuParentPoints : localRules.noYakuChildPoints
  }
  return 0
}

function getBaseRoundPoints(state: KoiKoiGameState, playerIndex: 0 | 1): number {
  const player = state.players[playerIndex]
  const totalYakuPoints = getYakuTotalPoints(player.completedYaku)
  if (totalYakuPoints > 0) {
    return totalYakuPoints
  }
  return resolveNoYakuPoints(state, playerIndex)
}

function resolveNextStarterIndex(state: KoiKoiGameState): 0 | 1 {
  const dealerRotationMode = normalizeGameConfig(state.config).localRules.dealerRotationMode
  if (dealerRotationMode === 'alternate') {
    return state.roundStarterIndex === 0 ? 1 : 0
  }
  if (!state.roundWinner) {
    if (state.roundReason === 'exhausted') {
      return state.roundStarterIndex
    }
    return state.roundStarterIndex === 0 ? 1 : 0
  }
  const winnerIndex = getPlayerIndex(state.roundWinner)
  if (dealerRotationMode === 'loser') {
    return winnerIndex === 0 ? 1 : 0
  }
  return winnerIndex
}

function finishRound(
  state: KoiKoiGameState,
  winnerId: Player['id'] | null,
  points: number,
  reason: Exclude<RoundReason, null>,
): KoiKoiGameState {
  let nextPlayers = state.players
  if (winnerId) {
    const index = getPlayerIndex(winnerId)
    const winner = nextPlayers[index]
    nextPlayers = replacePlayer(nextPlayers, index, { ...winner, score: winner.score + points })
  }

  // Record round score history
  const roundEntry: RoundScoreEntry = {
    round: state.round,
    player1Points: winnerId === 'player1' ? points : 0,
    player2Points: winnerId === 'player2' ? points : 0,
  }
  const nextRoundScoreHistory = [...getRoundScoreHistory(state), roundEntry]

  const maxRoundsReached = hasReachedFinalRound(state, nextPlayers)
  if (maxRoundsReached) {
    return {
      ...clearTurnArtifacts(state),
      players: nextPlayers,
      phase: 'gameOver',
      winner: determineGameWinner(nextPlayers),
      roundWinner: winnerId,
      roundPoints: points,
      roundReason: reason,
      roundScoreHistory: nextRoundScoreHistory,
    }
  }

  return {
    ...clearTurnArtifacts(state),
    players: nextPlayers,
    phase: 'roundEnd',
    winner: null,
    roundWinner: winnerId,
    roundPoints: points,
    roundReason: reason,
    roundScoreHistory: nextRoundScoreHistory,
  }
}

function finishRoundFromExhaustion(state: KoiKoiGameState): KoiKoiGameState {
  return finishRound(state, null, 0, 'exhausted')
}

function advanceTurn(state: KoiKoiGameState): KoiKoiGameState {
  const nextPlayerIndex = state.currentPlayerIndex === 0 ? 1 : 0
  return {
    ...clearTurnArtifacts(state),
    phase: 'selectHandCard',
    currentPlayerIndex: nextPlayerIndex,
  }
}

function removeFromFieldMany(field: readonly HanafudaCard[], targets: readonly HanafudaCard[]): HanafudaCard[] {
  const targetIds = new Set(targets.map((card) => card.id))
  return field.filter((card) => !targetIds.has(card.id))
}

function removeFromHand(hand: readonly HanafudaCard[], handCardId: string): HanafudaCard[] {
  return hand.filter((card) => card.id !== handCardId)
}

function captureCards(player: Player, cards: readonly HanafudaCard[]): Player {
  return {
    ...player,
    captured: [...player.captured, ...cards],
  }
}

function captureFromField(
  state: KoiKoiGameState,
  sourceCard: HanafudaCard,
  matchedCards: readonly [HanafudaCard, ...HanafudaCard[]],
  phase: 'drawingDeck' | 'checkYaku',
): KoiKoiGameState {
  const player = state.players[state.currentPlayerIndex]
  const capturedCards: readonly HanafudaCard[] = [sourceCard, ...matchedCards]
  const nextPlayer = captureCards(player, capturedCards)
  return addTurnAction(
    {
      ...clearMatchArtifacts(state),
      players: replacePlayer(state.players, state.currentPlayerIndex, nextPlayer),
      field: removeFromFieldMany(state.field, matchedCards),
      phase,
    },
    {
      player: player.id,
      type: 'capture',
      card: sourceCard,
      matchedCard: matchedCards[0],
      capturedCards,
    },
  )
}

function addCardToField(
  state: KoiKoiGameState,
  playerId: Player['id'],
  card: HanafudaCard,
  phase: 'drawingDeck' | 'checkYaku',
): KoiKoiGameState {
  return addTurnAction(
    {
      ...clearMatchArtifacts(state),
      field: [...state.field, card],
      phase,
    },
    { player: playerId, type: 'addToField', card },
  )
}

function markYakuProgress(player: Player, config: GameConfig): { player: Player; newYaku: Yaku[] } {
  const nextYaku = calculateYaku(player.captured, config.localRules)
  const previousByType = new Map(player.completedYaku.map((item) => [item.type, item]))
  const newYaku = nextYaku.filter((item) => {
    const previous = previousByType.get(item.type)
    return !previous || previous.points < item.points
  })

  return {
    player: { ...player, completedYaku: nextYaku },
    newYaku,
  }
}

function evaluateRoundAfterTurn(state: KoiKoiGameState): KoiKoiGameState {
  const normalizedConfig = normalizeGameConfig(state.config)
  const currentPlayer = state.players[state.currentPlayerIndex]
  const evaluated = markYakuProgress(currentPlayer, normalizedConfig)
  let nextState: KoiKoiGameState = {
    ...state,
    config: normalizedConfig,
    players: replacePlayer(state.players, state.currentPlayerIndex, evaluated.player),
    newYaku: evaluated.newYaku,
  }

  const exhausted = isRoundExhausted(nextState)
  const koikoiTriggered = state.koikoiCounts[0] > 0 || state.koikoiCounts[1] > 0
  const forceStopAfterSingleKoiKoi = koikoiTriggered && !normalizedConfig.localRules.enableKoiKoiShowdown
  if (evaluated.newYaku.length > 0) {
    if (exhausted || forceStopAfterSingleKoiKoi) {
      const stopPoints = koikoiTriggered
        ? getStopRoundPoints(nextState, state.currentPlayerIndex)
        : getBaseRoundPoints(nextState, state.currentPlayerIndex)
      return finishRound(nextState, currentPlayer.id, stopPoints, 'stop')
    }

    if (!canDeclareKoiKoi(nextState, state.currentPlayerIndex)) {
      const stopPoints = getStopRoundPoints(nextState, state.currentPlayerIndex)
      return finishRound(nextState, currentPlayer.id, stopPoints, 'stop')
    }

    return {
      ...nextState,
      phase: 'koikoiDecision',
    }
  }

  if (exhausted) {
    return finishRoundFromExhaustion(nextState)
  }

  nextState = advanceTurn(nextState)
  return nextState
}

function isKoiKoiLimitEnabled(state: KoiKoiGameState): boolean {
  const localRules = normalizeGameConfig(state.config).localRules
  return localRules.enableKoiKoiShowdown && localRules.koikoiLimit > 0
}

function canDeclareKoiKoi(state: KoiKoiGameState, playerIndex: 0 | 1): boolean {
  if (!isKoiKoiLimitEnabled(state)) {
    return true
  }
  return state.koikoiCounts[playerIndex] < normalizeGameConfig(state.config).localRules.koikoiLimit
}

function getStopRoundPoints(state: KoiKoiGameState, playerIndex: 0 | 1): number {
  const config = normalizeGameConfig(state.config)
  const localRules = config.localRules
  const opponentIndex: 0 | 1 = playerIndex === 0 ? 1 : 0
  const basePoints = getBaseRoundPoints(state, playerIndex)
  if (basePoints <= 0 || localRules.koiKoiBonusMode === 'none') {
    return basePoints
  }

  const highPointBonus = basePoints >= 7
  const selfKoiCount = state.koikoiCounts[playerIndex]
  const opponentKoiCount = state.koikoiCounts[opponentIndex]
  const hasSelfKoiBonus = selfKoiCount > 0
  const hasOpponentKoiBonus = opponentKoiCount > 0
  if (!highPointBonus && !hasSelfKoiBonus && !hasOpponentKoiBonus) {
    return basePoints
  }

  if (localRules.koiKoiBonusMode === 'additive') {
    const additiveMultiplier =
      1
      + Number(highPointBonus)
      + (hasSelfKoiBonus ? selfKoiCount * Math.max(0, localRules.selfKoiBonusFactor - 1) : 0)
      + (hasOpponentKoiBonus ? opponentKoiCount * Math.max(0, localRules.opponentKoiBonusFactor - 1) : 0)
    return basePoints * additiveMultiplier
  }

  const selfMultiplier = hasSelfKoiBonus ? localRules.selfKoiBonusFactor ** selfKoiCount : 1
  const opponentMultiplier = hasOpponentKoiBonus ? localRules.opponentKoiBonusFactor ** opponentKoiCount : 1
  const multiplier = (highPointBonus ? 2 : 1) * selfMultiplier * opponentMultiplier
  return basePoints * multiplier
}

export function createNewGame(config: GameConfig = DEFAULT_CONFIG, seed?: number): KoiKoiGameState {
  const normalizedConfig = normalizeGameConfig(config)
  const random = seed === undefined ? Math.random : createSeededRandom(seed)
  const starterIndex: 0 | 1 = random() < 0.5 ? 0 : 1
  return dealRound(
    [createPlayer('player1', normalizedConfig.player1Name), createPlayer('player2', normalizedConfig.player2Name)],
    normalizedConfig,
    1,
    starterIndex,
    [],
    random,
  )
}

export function getMatchingFieldCards(
  playedCard: HanafudaCard,
  fieldCards: readonly HanafudaCard[],
): HanafudaCard[] {
  return fieldCards.filter((fieldCard) => fieldCard.month === playedCard.month)
}

export function playHandCard(state: KoiKoiGameState, handCardId: string): KoiKoiGameState {
  if (state.phase !== 'selectHandCard') {
    return state
  }

  const player = state.players[state.currentPlayerIndex]
  const handCard = player.hand.find((card) => card.id === handCardId)
  if (!handCard) {
    return state
  }
  const matches = getMatchingFieldCards(handCard, state.field)
  if (matches.length === 0) {
    const hasOtherMatchingCard = player.hand.some(
      (card) => card.id !== handCard.id && getMatchingFieldCards(card, state.field).length > 0,
    )
    if (hasOtherMatchingCard) {
      return state
    }
  }

  let nextState = addTurnAction(state, {
    player: player.id,
    type: 'playCard',
    card: handCard,
  })
  const nextPlayer: Player = {
    ...player,
    hand: removeFromHand(player.hand, handCardId),
  }
  nextState = {
    ...nextState,
    players: replacePlayer(nextState.players, state.currentPlayerIndex, nextPlayer),
    selectedHandCard: handCard,
  }
  if (matches.length === 0) {
    return addCardToField(nextState, player.id, handCard, 'drawingDeck')
  }

  if (matches.length === 3) {
    return captureFromField(
      nextState,
      handCard,
      matches as [HanafudaCard, HanafudaCard, HanafudaCard],
      'drawingDeck',
    )
  }

  return {
    ...nextState,
    phase: 'selectFieldMatch',
    pendingMatches: matches,
    pendingSource: 'hand',
  }
}

export function selectHandMatch(state: KoiKoiGameState, fieldCardId: string): KoiKoiGameState {
  if (state.phase !== 'selectFieldMatch' || state.pendingSource !== 'hand' || !state.selectedHandCard) {
    return state
  }

  const matched = state.pendingMatches.find((card) => card.id === fieldCardId)
  if (!matched) {
    return state
  }

  return captureFromField(state, state.selectedHandCard, [matched], 'drawingDeck')
}

export function cancelHandSelection(state: KoiKoiGameState, insertIndex: number): KoiKoiGameState {
  if (state.phase !== 'selectFieldMatch' || state.pendingSource !== 'hand' || !state.selectedHandCard) {
    return state
  }

  const selectedCard = state.selectedHandCard
  const player = state.players[state.currentPlayerIndex]
  const nextHand = [...player.hand]
  const boundedIndex = Math.max(0, Math.min(insertIndex, nextHand.length))
  nextHand.splice(boundedIndex, 0, selectedCard)
  const nextPlayer = { ...player, hand: nextHand }
  const nextPlayers =
    state.currentPlayerIndex === 0
      ? ([nextPlayer, state.players[1]] as const)
      : ([state.players[0], nextPlayer] as const)
  const latestHistory = state.turnHistory[state.turnHistory.length - 1]
  const nextHistory =
    latestHistory?.type === 'playCard' && latestHistory.card?.id === selectedCard.id
      ? state.turnHistory.slice(0, -1)
      : state.turnHistory

  return {
    ...state,
    players: nextPlayers,
    phase: 'selectHandCard',
    selectedHandCard: null,
    pendingMatches: [],
    pendingSource: null,
    turnHistory: nextHistory,
  }
}

export function drawStep(state: KoiKoiGameState): KoiKoiGameState {
  if (state.phase !== 'drawingDeck') {
    return state
  }

  const player = state.players[state.currentPlayerIndex]
  const preparedDeck = maybeRigDeckForCpu(state)
  const result = drawCard(preparedDeck)
  if (!result) {
    return finishRoundFromExhaustion(state)
  }

  const drawn = result.card
  let nextState = addTurnAction(
    {
      ...state,
      deck: result.remainingDeck,
      drawnCard: drawn,
    },
    { player: player.id, type: 'drawCard', card: drawn },
  )

  const matches = getMatchingFieldCards(drawn, nextState.field)
  nextState = {
    ...nextState,
    phase: 'drawReveal',
    pendingMatches: matches,
    pendingSource: matches.length > 0 ? 'draw' : null,
  }
  return nextState
}

export function commitDrawToField(state: KoiKoiGameState): KoiKoiGameState {
  if (state.phase !== 'drawReveal' || !state.drawnCard) {
    return state
  }

  if (state.pendingSource === 'draw' && state.pendingMatches.length > 0) {
    if (state.pendingMatches.length === 3) {
      return captureFromField(
        state,
        state.drawnCard,
        state.pendingMatches as [HanafudaCard, HanafudaCard, HanafudaCard],
        'checkYaku',
      )
    }

    return {
      ...state,
      phase: 'selectDrawMatch',
    }
  }

  const playerId = state.players[state.currentPlayerIndex].id
  return addCardToField(state, playerId, state.drawnCard, 'checkYaku')
}

export function selectDrawMatch(state: KoiKoiGameState, fieldCardId: string): KoiKoiGameState {
  if (state.phase !== 'selectDrawMatch' || state.pendingSource !== 'draw' || !state.drawnCard) {
    return state
  }

  const matched = state.pendingMatches.find((card) => card.id === fieldCardId)
  if (!matched) {
    return state
  }

  return captureFromField(state, state.drawnCard, [matched], 'checkYaku')
}

export function checkTurn(state: KoiKoiGameState): KoiKoiGameState {
  if (state.phase !== 'checkYaku') {
    return state
  }
  return evaluateRoundAfterTurn(state)
}

export function resolveKoiKoi(state: KoiKoiGameState, decision: KoiKoiDecision): KoiKoiGameState {
  if (state.phase !== 'koikoiDecision') {
    return state
  }

  const player = state.players[state.currentPlayerIndex]
  if (decision === 'stop') {
    const roundPoints = getStopRoundPoints(state, state.currentPlayerIndex)
    return addTurnAction(
      finishRound(state, player.id, roundPoints, 'stop'),
      { player: player.id, type: 'stop' },
    )
  }

  if (!canDeclareKoiKoi(state, state.currentPlayerIndex)) {
    const roundPoints = getStopRoundPoints(state, state.currentPlayerIndex)
    return addTurnAction(
      finishRound(state, player.id, roundPoints, 'stop'),
      { player: player.id, type: 'stop' },
    )
  }

  const nextKoiKoiCounts: readonly [number, number] =
    state.currentPlayerIndex === 0
      ? [state.koikoiCounts[0] + 1, state.koikoiCounts[1]]
      : [state.koikoiCounts[0], state.koikoiCounts[1] + 1]

  return addTurnAction(
    advanceTurn({
      ...state,
      koikoiCounts: nextKoiKoiCounts,
      newYaku: [],
    }),
    { player: player.id, type: 'koikoi' },
  )
}

export function startNextRound(state: KoiKoiGameState, seed?: number): KoiKoiGameState {
  if (state.phase !== 'roundEnd') {
    return state
  }

  const nextRound = state.round + 1
  const nextStarterIndex = resolveNextStarterIndex(state)

  const carryPlayers: PlayerTuple = [
    { ...state.players[0], hand: [], captured: [], completedYaku: [] },
    { ...state.players[1], hand: [], captured: [], completedYaku: [] },
  ]
  const random = seed === undefined ? Math.random : createSeededRandom(seed)
  return dealRound(carryPlayers, state.config, nextRound, nextStarterIndex, getRoundScoreHistory(state), random)
}

import { createDeck, dealCards, drawCard, shuffleDeck } from './deck'
import { DEFAULT_CONFIG, type GameConfig, type GameState, type HanafudaCard, type Player, type TurnAction, type Yaku } from './types'
import { calculateYaku, getYakuTotalPoints } from './yaku'

type PlayerTuple = readonly [Player, Player]

export type MatchSource = 'hand' | 'draw' | null
export type RoundReason = 'stop' | 'exhausted' | 'draw' | null
export type KoiKoiDecision = 'koikoi' | 'stop'

export interface KoiKoiGameState extends GameState {
  readonly config: GameConfig
  readonly pendingMatches: readonly HanafudaCard[]
  readonly pendingSource: MatchSource
  readonly roundWinner: Player['id'] | null
  readonly roundPoints: number
  readonly roundReason: RoundReason
  readonly roundStarterIndex: 0 | 1
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

function dealRound(
  players: PlayerTuple,
  config: GameConfig,
  round: number,
  starterIndex: 0 | 1,
): KoiKoiGameState {
  let dealt = dealCards(shuffleDeck(createDeck()))
  let retries = 0
  while (requiresRedeal(dealt.player1Hand, dealt.player2Hand, dealt.field)) {
    dealt = dealCards(shuffleDeck(createDeck()))
    retries += 1
    if (retries > 256) {
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
    config,
    pendingMatches: [],
    pendingSource: null,
    roundWinner: null,
    roundPoints: 0,
    roundReason: null,
    roundStarterIndex: starterIndex,
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

  const maxRoundsReached = state.round >= state.config.maxRounds
  const targetReached = nextPlayers.some((player) => player.score >= state.config.targetScore)
  if (maxRoundsReached || targetReached) {
    return {
      ...clearTurnArtifacts(state),
      players: nextPlayers,
      phase: 'gameOver',
      winner: determineGameWinner(nextPlayers),
      roundWinner: winnerId,
      roundPoints: points,
      roundReason: reason,
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

function markYakuProgress(player: Player): { player: Player; newYaku: Yaku[] } {
  const nextYaku = calculateYaku(player.captured)
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
  const currentPlayer = state.players[state.currentPlayerIndex]
  const evaluated = markYakuProgress(currentPlayer)
  let nextState: KoiKoiGameState = {
    ...state,
    players: replacePlayer(state.players, state.currentPlayerIndex, evaluated.player),
    newYaku: evaluated.newYaku,
  }

  const currentPlayerPoints = getYakuTotalPoints(evaluated.player.completedYaku)
  const exhausted = isRoundExhausted(nextState)
  const koikoiTriggered = state.koikoiCounts[0] > 0 || state.koikoiCounts[1] > 0
  if (evaluated.newYaku.length > 0) {
    if (exhausted || koikoiTriggered) {
      const stopPoints = koikoiTriggered
        ? getStopRoundPoints(nextState, state.currentPlayerIndex)
        : Math.max(1, currentPlayerPoints)
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

function getStopRoundPoints(state: KoiKoiGameState, playerIndex: 0 | 1): number {
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

export function createNewGame(config: GameConfig = DEFAULT_CONFIG): KoiKoiGameState {
  return dealRound([createPlayer('player1', config.player1Name), createPlayer('player2', config.player2Name)], config, 1, 0)
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
  const result = drawCard(state.deck)
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

export function startNextRound(state: KoiKoiGameState): KoiKoiGameState {
  if (state.phase !== 'roundEnd') {
    return state
  }

  const nextRound = state.round + 1
  const nextStarterIndex =
    state.roundReason === 'exhausted'
      ? state.roundStarterIndex
      : state.roundWinner
        ? getPlayerIndex(state.roundWinner)
        : state.roundStarterIndex === 0
          ? 1
          : 0

  const carryPlayers: PlayerTuple = [
    { ...state.players[0], hand: [], captured: [], completedYaku: [] },
    { ...state.players[1], hand: [], captured: [], completedYaku: [] },
  ]
  return dealRound(carryPlayers, state.config, nextRound, nextStarterIndex)
}

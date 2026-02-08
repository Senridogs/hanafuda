import type { CardType, HanafudaCard } from './types'
import { HANAFUDA_CARDS } from './cards'

const FINAL_UNDRAWN_ZONE_SIZE = 8
const PRIORITIZED_TYPES: ReadonlySet<CardType> = new Set(['hikari', 'tane', 'tanzaku'])
const STRONG_TAIL_SWAP_BASE_CHANCE = 0.62
const STRONG_TAIL_SWAP_FALLOFF_PER_SWAP = 0.12
const STRONG_TAIL_SWAP_MIN_CHANCE = 0.28
const HIKARI_MONTH_TAIL_SWAP_BASE_CHANCE = 0.46
const HIKARI_MONTH_TAIL_SWAP_FALLOFF_PER_SWAP = 0.08
const HIKARI_MONTH_TAIL_SWAP_MIN_CHANCE = 0.2
const HIKARI_MONTHS: ReadonlySet<number> = new Set(
  HANAFUDA_CARDS.filter((card) => card.type === 'hikari').map((card) => card.month),
)
type RandomFn = () => number
type TailBiasTier = 'strong' | 'hikariMonth' | null

function clampRandomRoll(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  if (value <= 0) {
    return 0
  }
  if (value >= 1) {
    return 1 - Number.EPSILON
  }
  return value
}

export function createSeededRandom(seed: number): RandomFn {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function isPrioritizedCard(card: HanafudaCard): boolean {
  return PRIORITIZED_TYPES.has(card.type)
}

function getTailBiasTier(card: HanafudaCard): TailBiasTier {
  if (isPrioritizedCard(card)) {
    return 'strong'
  }
  if (HIKARI_MONTHS.has(card.month)) {
    return 'hikariMonth'
  }
  return null
}

function pickRandomWeakIndex(weakCandidateIndexes: number[], random: RandomFn): number | null {
  if (weakCandidateIndexes.length === 0) {
    return null
  }
  const pickAt = Math.floor(clampRandomRoll(random()) * weakCandidateIndexes.length)
  const [picked] = weakCandidateIndexes.splice(pickAt, 1)
  return picked ?? null
}

function biasDeckAgainstStrongTail(remainingDeck: readonly HanafudaCard[], random: RandomFn): HanafudaCard[] {
  if (remainingDeck.length <= FINAL_UNDRAWN_ZONE_SIZE) {
    return [...remainingDeck]
  }

  const deck = [...remainingDeck]
  const tailStart = deck.length - FINAL_UNDRAWN_ZONE_SIZE
  const weakCandidateIndexes: number[] = []

  for (let index = 0; index < tailStart; index += 1) {
    if (getTailBiasTier(deck[index]) === null) {
      weakCandidateIndexes.push(index)
    }
  }

  let strongSwapCount = 0
  let hikariMonthSwapCount = 0
  for (let tailIndex = tailStart; tailIndex < deck.length; tailIndex += 1) {
    const tier = getTailBiasTier(deck[tailIndex])
    if (tier === null) {
      continue
    }
    const swapChance =
      tier === 'strong'
        ? Math.max(
            STRONG_TAIL_SWAP_MIN_CHANCE,
            STRONG_TAIL_SWAP_BASE_CHANCE - strongSwapCount * STRONG_TAIL_SWAP_FALLOFF_PER_SWAP,
          )
        : Math.max(
            HIKARI_MONTH_TAIL_SWAP_MIN_CHANCE,
            HIKARI_MONTH_TAIL_SWAP_BASE_CHANCE
              - hikariMonthSwapCount * HIKARI_MONTH_TAIL_SWAP_FALLOFF_PER_SWAP,
          )
    if (clampRandomRoll(random()) >= swapChance) {
      continue
    }
    const weakIndex = pickRandomWeakIndex(weakCandidateIndexes, random)
    if (weakIndex === null) {
      break
    }
    const temp = deck[weakIndex]
    deck[weakIndex] = deck[tailIndex]
    deck[tailIndex] = temp
    if (tier === 'strong') {
      strongSwapCount += 1
    } else {
      hikariMonthSwapCount += 1
    }
  }

  return deck
}

export function createDeck(): HanafudaCard[] {
  return [...HANAFUDA_CARDS]
}

export function shuffleDeck(cards: readonly HanafudaCard[], random: RandomFn = Math.random): HanafudaCard[] {
  const shuffled = [...cards]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(clampRandomRoll(random()) * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

export interface DealResult {
  readonly player1Hand: HanafudaCard[]
  readonly player2Hand: HanafudaCard[]
  readonly field: HanafudaCard[]
  readonly remainingDeck: HanafudaCard[]
}

export function dealCards(deck: readonly HanafudaCard[], random: RandomFn = Math.random): DealResult {
  if (deck.length < 48) {
    throw new Error('Deck must have 48 cards to deal')
  }

  const cards = [...deck]
  const player1Hand: HanafudaCard[] = []
  const player2Hand: HanafudaCard[] = []
  const field: HanafudaCard[] = []

  // 4枚ずつ交互に配る: P1→場→P2→P1→場→P2
  player1Hand.push(...cards.splice(0, 4))
  field.push(...cards.splice(0, 4))
  player2Hand.push(...cards.splice(0, 4))
  player1Hand.push(...cards.splice(0, 4))
  field.push(...cards.splice(0, 4))
  player2Hand.push(...cards.splice(0, 4))

  return {
    player1Hand,
    player2Hand,
    field,
    remainingDeck: biasDeckAgainstStrongTail(cards, random),
  }
}

export function drawCard(
  deck: readonly HanafudaCard[],
): { card: HanafudaCard; remainingDeck: HanafudaCard[] } | null {
  if (deck.length === 0) return null
  const [card, ...remainingDeck] = deck
  return { card, remainingDeck }
}

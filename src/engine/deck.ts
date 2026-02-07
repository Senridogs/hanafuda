import type { HanafudaCard } from './types'
import { HANAFUDA_CARDS } from './cards'

export function createDeck(): HanafudaCard[] {
  return [...HANAFUDA_CARDS]
}

export function shuffleDeck(cards: readonly HanafudaCard[]): HanafudaCard[] {
  const shuffled = [...cards]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
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

export function dealCards(deck: readonly HanafudaCard[]): DealResult {
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
    remainingDeck: cards,
  }
}

export function drawCard(
  deck: readonly HanafudaCard[],
): { card: HanafudaCard; remainingDeck: HanafudaCard[] } | null {
  if (deck.length === 0) return null
  const [card, ...remainingDeck] = deck
  return { card, remainingDeck }
}

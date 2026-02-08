import { describe, expect, it } from 'vitest'
import { createDeck, dealCards } from '../../src/engine/deck'
import type { HanafudaCard } from '../../src/engine/types'

const FULL_DECK = createDeck()
const HIKARI_MONTHS: ReadonlySet<number> = new Set(
  FULL_DECK.filter((card) => card.type === 'hikari').map((card) => card.month),
)

function constantRandom(value: number): () => number {
  return () => value
}

function isTailPriorityCard(card: HanafudaCard): boolean {
  if (card.type !== 'kasu') {
    return true
  }
  return HIKARI_MONTHS.has(card.month)
}

function countTailPriority(cards: readonly HanafudaCard[]): number {
  return cards.filter((card) => isTailPriorityCard(card)).length
}

function countHikariMonthKasu(cards: readonly HanafudaCard[]): number {
  return cards.filter((card) => card.type === 'kasu' && HIKARI_MONTHS.has(card.month)).length
}

function buildArrangedDeck(
  drawFrontSixteen: readonly HanafudaCard[],
  drawTailEight: readonly HanafudaCard[],
): HanafudaCard[] {
  expect(drawFrontSixteen).toHaveLength(16)
  expect(drawTailEight).toHaveLength(8)

  const reservedIds = new Set([...drawFrontSixteen, ...drawTailEight].map((card) => card.id))
  const openingTwentyFour = FULL_DECK.filter((card) => !reservedIds.has(card.id))
  expect(openingTwentyFour).toHaveLength(24)

  const arrangedDeck = [...openingTwentyFour, ...drawFrontSixteen, ...drawTailEight]
  expect(arrangedDeck).toHaveLength(48)
  expect(new Set(arrangedDeck.map((card) => card.id)).size).toBe(48)
  return arrangedDeck
}

describe('dealCards', () => {
  it('can move strong-priority cards out of the final 8 deck slots when luck favors swaps', () => {
    const strongCards = FULL_DECK.filter((card) => card.type !== 'kasu')
    const weakCards = FULL_DECK.filter((card) => !isTailPriorityCard(card))

    const drawFrontSixteen = [...weakCards.slice(0, 14), ...strongCards.slice(8, 10)]
    const drawTailEight = strongCards.slice(0, 8)
    const arrangedDeck = buildArrangedDeck(drawFrontSixteen, drawTailEight)
    const dealt = dealCards(arrangedDeck, constantRandom(0))
    const finalTail = dealt.remainingDeck.slice(-8)

    expect(finalTail).toHaveLength(8)
    expect(finalTail.every((card) => !isTailPriorityCard(card))).toBe(true)
  })

  it('can keep tail-priority cards in tail when luck rejects swaps', () => {
    const strongCards = FULL_DECK.filter((card) => card.type !== 'kasu')
    const weakCards = FULL_DECK.filter((card) => !isTailPriorityCard(card))

    const drawFrontSixteen = [...weakCards.slice(0, 14), ...strongCards.slice(8, 10)]
    const drawTailEight = strongCards.slice(0, 8)
    const arrangedDeck = buildArrangedDeck(drawFrontSixteen, drawTailEight)
    const dealt = dealCards(arrangedDeck, constantRandom(0.99))
    const finalTail = dealt.remainingDeck.slice(-8)

    expect(finalTail).toHaveLength(8)
    expect(countTailPriority(finalTail)).toBe(8)
    expect(finalTail.map((card) => card.id)).toEqual(drawTailEight.map((card) => card.id))
  })

  it('still applies best-effort swaps when weak candidates are limited', () => {
    const tailPriorityCards = FULL_DECK.filter((card) => isTailPriorityCard(card))
    const weakCards = FULL_DECK.filter((card) => !isTailPriorityCard(card))

    const drawFrontSixteen = [...weakCards.slice(0, 3), ...tailPriorityCards.slice(8, 21)]
    const drawTailEight = tailPriorityCards.slice(0, 8)
    const arrangedDeck = buildArrangedDeck(drawFrontSixteen, drawTailEight)
    const dealt = dealCards(arrangedDeck, constantRandom(0))
    const finalTailPriority = countTailPriority(dealt.remainingDeck.slice(-8))

    expect(countTailPriority(drawTailEight)).toBe(8)
    expect(finalTailPriority).toBe(5)
  })

  it('also biases kasu from hikari months away from the final tail', () => {
    const hikariMonthKasu = FULL_DECK.filter(
      (card) => card.type === 'kasu' && HIKARI_MONTHS.has(card.month),
    )
    const weakCards = FULL_DECK.filter((card) => !isTailPriorityCard(card))

    const baseFrontWeak = weakCards.slice(0, 8)
    const reservedIds = new Set([...baseFrontWeak, ...hikariMonthKasu.slice(0, 8)].map((card) => card.id))
    const extraFront = FULL_DECK.filter((card) => !reservedIds.has(card.id)).slice(0, 8)
    const drawFrontSixteen = [...baseFrontWeak, ...extraFront]
    const drawTailEight = hikariMonthKasu.slice(0, 8)
    const arrangedDeck = buildArrangedDeck(drawFrontSixteen, drawTailEight)
    const dealt = dealCards(arrangedDeck, constantRandom(0))
    const finalTail = dealt.remainingDeck.slice(-8)

    expect(countHikariMonthKasu(drawTailEight)).toBe(8)
    expect(countHikariMonthKasu(finalTail)).toBe(0)
  })
})

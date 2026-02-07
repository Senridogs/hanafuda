import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { createNewGame, getMatchingFieldCards } from '../../src/engine/game'

function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function withSeededRandom<T>(seed: number, run: () => T): T {
  const rng = mulberry32(seed)
  const original = Math.random
  Math.random = () => rng()
  try {
    return run()
  } finally {
    Math.random = original
  }
}

type OpeningPattern = {
  readonly seed: number
  readonly unmatchedCardId: string
  readonly matchedCardId: string
}

type CancelPattern = {
  readonly seed: number
  readonly cardId: string
}

function findOpeningPattern(maxSeed = 5000): OpeningPattern {
  for (let seed = 1; seed <= maxSeed; seed += 1) {
    const state = withSeededRandom(seed, () => createNewGame())
    const hand = state.players[0].hand
    const unmatched = hand.find((card) => getMatchingFieldCards(card, state.field).length === 0)
    const matched = hand.find((card) => {
      const matches = getMatchingFieldCards(card, state.field).length
      return matches > 0
    })
    if (unmatched && matched) {
      return { seed, unmatchedCardId: unmatched.id, matchedCardId: matched.id }
    }
  }
  throw new Error('Failed to find deterministic opening pattern')
}

function findCancelableSelectPattern(maxSeed = 5000): CancelPattern {
  for (let seed = 1; seed <= maxSeed; seed += 1) {
    const state = withSeededRandom(seed, () => createNewGame())
    const hand = state.players[0].hand
    const card = hand.find((item) => {
      const matches = getMatchingFieldCards(item, state.field).length
      return matches === 1 || matches === 2
    })
    if (card) {
      return { seed, cardId: card.id }
    }
  }
  throw new Error('Failed to find deterministic cancelable select pattern')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('App interaction safeguards', () => {
  it('rejects unmatched card click when a matching card exists', () => {
    const pattern = findOpeningPattern()
    vi.useFakeTimers()
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))

    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()

    const handRack = container.querySelector('.player-rack')
    const unmatched = handRack?.querySelector<HTMLElement>(`[data-card-id="${pattern.unmatchedCardId}"]`)
    const matched = handRack?.querySelector<HTMLElement>(`[data-card-id="${pattern.matchedCardId}"]`)
    expect(unmatched).toBeTruthy()
    expect(matched).toBeTruthy()

    fireEvent.click(unmatched as HTMLElement)
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()

    fireEvent.click(matched as HTMLElement)
    expect(screen.queryByText('あなたの番: 手札を1枚選択')).toBeNull()
  })

  it('allows canceling hand selection by clicking outside field targets', () => {
    const pattern = findCancelableSelectPattern()
    vi.useFakeTimers()
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))

    const handRack = container.querySelector('.player-rack')
    const selected = handRack?.querySelector<HTMLElement>(`[data-card-id="${pattern.cardId}"]`)
    expect(selected).toBeTruthy()
    fireEvent.click(selected as HTMLElement)
    expect(screen.getByText('同じ月の場札を1枚選択')).toBeTruthy()

    const board = screen.getByLabelText('対局ボード')
    fireEvent.click(board)
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()
  })
})

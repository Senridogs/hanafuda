import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../src/App'
import { createNewGame, getMatchingFieldCards } from '../../src/engine/game'

const originalMatchMedia = window.matchMedia

function mockMatchMedia(matches: boolean): void {
  const mock = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }))
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: mock,
  })
}

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

function startCpuMatch(roundCount: 3 | 6 | 12 = 3): void {
  fireEvent.click(screen.getByRole('button', { name: `${roundCount}月` }))
  fireEvent.click(screen.getByRole('button', { name: 'CPU対戦' }))
}

type OpeningPattern = {
  readonly seed: number
  readonly unmatchedCardId: string
  readonly matchedCardId: string
  readonly matchingFieldCardIds: readonly string[]
}

type CancelPattern = {
  readonly seed: number
  readonly cardId: string
  readonly nonMatchingFieldCardId: string
}

type NoMatchPattern = {
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
      const matchingFieldCardIds = getMatchingFieldCards(matched, state.field).map((card) => card.id)
      return { seed, unmatchedCardId: unmatched.id, matchedCardId: matched.id, matchingFieldCardIds }
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
    if (!card) {
      continue
    }
    const nonMatchingFieldCard = state.field.find((fieldCard) => fieldCard.month !== card.month)
    if (nonMatchingFieldCard) {
      return { seed, cardId: card.id, nonMatchingFieldCardId: nonMatchingFieldCard.id }
    }
  }
  throw new Error('Failed to find deterministic cancelable select pattern')
}

function findNoMatchPattern(maxSeed = 20000): NoMatchPattern {
  for (let seed = 1; seed <= maxSeed; seed += 1) {
    const state = withSeededRandom(seed, () => createNewGame())
    const hand = state.players[0].hand
    if (hand.length === 0) {
      continue
    }
    const hasMatchingCard = hand.some((card) => getMatchingFieldCards(card, state.field).length > 0)
    if (!hasMatchingCard) {
      return { seed, cardId: hand[0].id }
    }
  }
  throw new Error('Failed to find deterministic no-match opening pattern')
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  })
})

describe('App interaction safeguards', () => {
  it('requires selecting round count before starting CPU battle', () => {
    render(<App />)

    const cpuButton = screen.getByRole('button', { name: 'CPU対戦' }) as HTMLButtonElement
    expect(cpuButton.disabled).toBe(true)
    expect(screen.getByText('未選択')).toBeTruthy()
    expect(screen.getByText('月数を選ぶまで対戦を開始できません。')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '6月' }))
    expect(cpuButton.disabled).toBe(false)
  })

  it('rejects unmatched card click when a matching card exists', () => {
    const pattern = findOpeningPattern()
    vi.useFakeTimers()
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))
    startCpuMatch()

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
    startCpuMatch()

    const handRack = container.querySelector('.player-rack')
    const selected = handRack?.querySelector<HTMLElement>(`[data-card-id="${pattern.cardId}"]`)
    expect(selected).toBeTruthy()
    fireEvent.click(selected as HTMLElement)
    expect(screen.getByText('同じ月の場札を1枚選択')).toBeTruthy()

    const board = screen.getByLabelText('対局ボード')
    fireEvent.click(board)
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()
  })

  it('allows canceling hand selection by clicking a non-matching field card', () => {
    const pattern = findCancelableSelectPattern()
    vi.useFakeTimers()
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))
    startCpuMatch()

    const handRack = container.querySelector('.player-rack')
    const selected = handRack?.querySelector<HTMLElement>(`[data-card-id="${pattern.cardId}"]`)
    expect(selected).toBeTruthy()
    fireEvent.click(selected as HTMLElement)
    expect(screen.getByText('同じ月の場札を1枚選択')).toBeTruthy()

    const fieldRack = container.querySelector('.field-rack-inner')
    const nonMatchingField = fieldRack?.querySelector<HTMLElement>(`[data-card-id="${pattern.nonMatchingFieldCardId}"]`)
    expect(nonMatchingField).toBeTruthy()
    fireEvent.click(nonMatchingField as HTMLElement)
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()
  })

  it('allows canceling hand selection by clicking the selected hand card again', () => {
    const pattern = findCancelableSelectPattern()
    vi.useFakeTimers()
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))
    startCpuMatch()

    const handRack = container.querySelector('.player-rack')
    const selected = handRack?.querySelector<HTMLElement>(`[data-card-id="${pattern.cardId}"]`)
    expect(selected).toBeTruthy()
    fireEvent.click(selected as HTMLElement)
    expect(screen.getByText('同じ月の場札を1枚選択')).toBeTruthy()

    const selectedAgain = handRack?.querySelector<HTMLElement>(`[data-card-id="${pattern.cardId}"]`)
    expect(selectedAgain).toBeTruthy()
    fireEvent.click(selectedAgain as HTMLElement)
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()
  })

  it('keeps matching targets highlighted and commits by tapping a highlighted field card in expanded hand mode', () => {
    const pattern = findOpeningPattern()
    vi.useFakeTimers()
    mockMatchMedia(true)
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))
    startCpuMatch()

    const initialHandCard = container.querySelector<HTMLElement>(`.player-rack [data-card-id="${pattern.matchedCardId}"]`)
    expect(initialHandCard).toBeTruthy()
    fireEvent.click(initialHandCard as HTMLElement)
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()

    const expandedHandCard = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.matchedCardId}"]`)
    expect(expandedHandCard).toBeTruthy()
    fireEvent.click(expandedHandCard as HTMLElement)
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()

    const raisedHandCard = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.matchedCardId}"]`)
    expect(raisedHandCard?.classList.contains('raised')).toBe(true)

    for (const fieldCardId of pattern.matchingFieldCardIds) {
      const matchingField = container.querySelector<HTMLElement>(`.field-rack-inner [data-card-id="${fieldCardId}"]`)
      expect(matchingField).toBeTruthy()
      expect(matchingField?.classList.contains('highlighted')).toBe(true)
    }

    const firstTargetId = pattern.matchingFieldCardIds[0]
    expect(firstTargetId).toBeTruthy()
    const firstTarget = container.querySelector<HTMLElement>(`.field-rack-inner [data-card-id="${firstTargetId}"]`)
    expect(firstTarget).toBeTruthy()
    fireEvent.click(firstTarget as HTMLElement)
    expect(screen.queryByText('あなたの番: 手札を1枚選択')).toBeNull()
  })

  it('cancels raised selection without collapsing expanded hand when tapping outside cards', () => {
    const pattern = findOpeningPattern()
    vi.useFakeTimers()
    mockMatchMedia(true)
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))
    startCpuMatch()

    const initialHandCard = container.querySelector<HTMLElement>(`.player-rack [data-card-id="${pattern.matchedCardId}"]`)
    expect(initialHandCard).toBeTruthy()
    fireEvent.click(initialHandCard as HTMLElement)

    const expandedHandCard = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.matchedCardId}"]`)
    expect(expandedHandCard).toBeTruthy()
    fireEvent.click(expandedHandCard as HTMLElement)

    const raisedHandCard = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.matchedCardId}"]`)
    expect(raisedHandCard?.classList.contains('raised')).toBe(true)

    const backdrop = container.querySelector('.hand-expanded-backdrop')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop as HTMLElement)
    vi.advanceTimersByTime(130)

    const expandedRackAfterCancel = container.querySelector('.player-rack.expanded')
    expect(expandedRackAfterCancel).toBeTruthy()
    const raisedAfterCancel = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.matchedCardId}"]`)
    expect(raisedAfterCancel?.classList.contains('raised')).toBe(false)

    for (const fieldCardId of pattern.matchingFieldCardIds) {
      const matchingField = container.querySelector<HTMLElement>(`.field-rack-inner [data-card-id="${fieldCardId}"]`)
      expect(matchingField).toBeTruthy()
      expect(matchingField?.classList.contains('highlighted')).toBe(false)
    }

    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()
  })

  it('uses the same delayed cancel animation when tapping the selected card itself', () => {
    const pattern = findOpeningPattern()
    vi.useFakeTimers()
    mockMatchMedia(true)
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))
    startCpuMatch()

    const initialHandCard = container.querySelector<HTMLElement>(`.player-rack [data-card-id="${pattern.matchedCardId}"]`)
    expect(initialHandCard).toBeTruthy()
    fireEvent.click(initialHandCard as HTMLElement)

    const expandedHandCard = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.matchedCardId}"]`)
    expect(expandedHandCard).toBeTruthy()
    fireEvent.click(expandedHandCard as HTMLElement)

    const raisedBeforeCancel = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.matchedCardId}"]`)
    expect(raisedBeforeCancel?.classList.contains('raised')).toBe(true)
    fireEvent.click(raisedBeforeCancel as HTMLElement)

    const raisedImmediatelyAfterTap = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.matchedCardId}"]`)
    expect(raisedImmediatelyAfterTap?.classList.contains('raised')).toBe(true)
    vi.advanceTimersByTime(130)

    const expandedRackAfterCancel = container.querySelector('.player-rack.expanded')
    expect(expandedRackAfterCancel).toBeTruthy()
    const raisedAfterCancel = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.matchedCardId}"]`)
    expect(raisedAfterCancel?.classList.contains('raised')).toBe(false)
  })

  it('shows empty field slot for unmatched card and commits only by tapping that slot in expanded hand mode', () => {
    const pattern = findNoMatchPattern()
    vi.useFakeTimers()
    mockMatchMedia(true)
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))
    startCpuMatch()

    const initialHandCard = container.querySelector<HTMLElement>(`.player-rack [data-card-id="${pattern.cardId}"]`)
    expect(initialHandCard).toBeTruthy()
    fireEvent.click(initialHandCard as HTMLElement)

    const expandedHandCard = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.cardId}"]`)
    expect(expandedHandCard).toBeTruthy()
    fireEvent.click(expandedHandCard as HTMLElement)

    const emptyFieldSlot = container.querySelector<HTMLElement>('.field-empty-slot-target')
    expect(emptyFieldSlot).toBeTruthy()

    const fieldRow = container.querySelector<HTMLElement>('.field-row')
    expect(fieldRow).toBeTruthy()
    fireEvent.click(fieldRow as HTMLElement)
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()
    expect(screen.queryByText('山札から引いています')).toBeNull()
    expect(container.querySelector('.field-empty-slot-target')).toBeNull()

    const expandedHandCardAgain = container.querySelector<HTMLElement>(`.player-rack.expanded [data-card-id="${pattern.cardId}"]`)
    expect(expandedHandCardAgain).toBeTruthy()
    fireEvent.click(expandedHandCardAgain as HTMLElement)

    const emptyFieldSlotAgain = container.querySelector<HTMLElement>('.field-empty-slot-target')
    expect(emptyFieldSlotAgain).toBeTruthy()
    fireEvent.click(emptyFieldSlotAgain as HTMLElement)
    expect(screen.getByText('山札から引いています')).toBeTruthy()
  })

  it('shows empty field slot for unmatched card and commits only by clicking that slot on desktop', () => {
    const pattern = findNoMatchPattern()
    vi.useFakeTimers()
    mockMatchMedia(false)
    const { container } = withSeededRandom(pattern.seed, () => render(<App />))
    startCpuMatch()

    const handCard = container.querySelector<HTMLElement>(`.player-rack [data-card-id="${pattern.cardId}"]`)
    expect(handCard).toBeTruthy()
    fireEvent.click(handCard as HTMLElement)

    const emptyFieldSlot = container.querySelector<HTMLElement>('.field-empty-slot-target')
    expect(emptyFieldSlot).toBeTruthy()
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()
    expect(screen.queryByText('山札から引いています')).toBeNull()

    const fieldRow = container.querySelector<HTMLElement>('.field-row')
    expect(fieldRow).toBeTruthy()
    fireEvent.click(fieldRow as HTMLElement)
    expect(container.querySelector('.field-empty-slot-target')).toBeNull()
    expect(screen.getByText('あなたの番: 手札を1枚選択')).toBeTruthy()

    const handCardAgain = container.querySelector<HTMLElement>(`.player-rack [data-card-id="${pattern.cardId}"]`)
    expect(handCardAgain).toBeTruthy()
    fireEvent.click(handCardAgain as HTMLElement)

    const emptyFieldSlotAgain = container.querySelector<HTMLElement>('.field-empty-slot-target')
    expect(emptyFieldSlotAgain).toBeTruthy()
    fireEvent.click(emptyFieldSlotAgain as HTMLElement)
    expect(screen.getByText('山札から引いています')).toBeTruthy()
  })
})

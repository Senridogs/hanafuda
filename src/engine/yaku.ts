import type { HanafudaCard, Yaku } from './types'

const INOSHIKACHO_IDS = ['jun-tane', 'jul-tane', 'oct-tane'] as const
const AKATAN_IDS = ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'] as const
const AOTAN_IDS = ['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'] as const

function findCardsByIds(cards: readonly HanafudaCard[], ids: readonly string[]): HanafudaCard[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  return ids.flatMap((id) => {
    const card = byId.get(id)
    return card ? [card] : []
  })
}

function createYaku(
  type: Yaku['type'],
  name: string,
  points: number,
  cards: readonly HanafudaCard[],
): Yaku {
  return { type, name, points, cards }
}

function hasAllCards(cards: readonly HanafudaCard[], ids: readonly string[]): boolean {
  const idSet = new Set(cards.map((card) => card.id))
  return ids.every((id) => idSet.has(id))
}

export function calculateYaku(capturedCards: readonly HanafudaCard[]): Yaku[] {
  const yaku: Yaku[] = []
  const hikariCards = capturedCards.filter((card) => card.type === 'hikari')
  const taneCards = capturedCards.filter((card) => card.type === 'tane')
  const tanzakuCards = capturedCards.filter((card) => card.type === 'tanzaku')
  const kasuCards = capturedCards.filter((card) => card.type === 'kasu')

  const hasRainMan = hikariCards.some((card) => card.id === 'nov-hikari')
  if (hikariCards.length === 5) {
    yaku.push(createYaku('goko', '五光', 10, hikariCards))
  } else if (hikariCards.length === 4) {
    yaku.push(createYaku(hasRainMan ? 'ame-shiko' : 'shiko', hasRainMan ? '雨四光' : '四光', hasRainMan ? 7 : 8, hikariCards))
  } else if (hikariCards.length === 3 && !hasRainMan) {
    yaku.push(createYaku('sanko', '三光', 5, hikariCards))
  }

  if (hasAllCards(capturedCards, INOSHIKACHO_IDS)) {
    yaku.push(createYaku('inoshikacho', '猪鹿蝶', 5, findCardsByIds(capturedCards, INOSHIKACHO_IDS)))
  }

  if (hasAllCards(capturedCards, ['mar-hikari', 'sep-tane'])) {
    yaku.push(createYaku('hanami-zake', '花見で一杯', 5, findCardsByIds(capturedCards, ['mar-hikari', 'sep-tane'])))
  }

  if (hasAllCards(capturedCards, ['aug-hikari', 'sep-tane'])) {
    yaku.push(createYaku('tsukimi-zake', '月見で一杯', 5, findCardsByIds(capturedCards, ['aug-hikari', 'sep-tane'])))
  }

  if (hasAllCards(capturedCards, AKATAN_IDS)) {
    yaku.push(createYaku('akatan', '赤短', 5, findCardsByIds(capturedCards, AKATAN_IDS)))
  }

  if (hasAllCards(capturedCards, AOTAN_IDS)) {
    yaku.push(createYaku('aotan', '青短', 5, findCardsByIds(capturedCards, AOTAN_IDS)))
  }

  if (taneCards.length >= 5) {
    const points = 1 + (taneCards.length - 5)
    yaku.push(createYaku('tane', 'たね', points, taneCards))
  }

  if (tanzakuCards.length >= 5) {
    const points = 1 + (tanzakuCards.length - 5)
    yaku.push(createYaku('tanzaku', 'たんざく', points, tanzakuCards))
  }

  if (kasuCards.length >= 10) {
    const points = 1 + (kasuCards.length - 10)
    yaku.push(createYaku('kasu', 'かす', points, kasuCards))
  }

  return yaku
}

export function getYakuTotalPoints(yaku: readonly Yaku[]): number {
  return yaku.reduce((total, item) => total + item.points, 0)
}


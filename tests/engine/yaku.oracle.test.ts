import { describe, expect, it } from 'vitest'
import { HANAFUDA_CARDS, getCardById } from '../../src/engine/cards'
import { calculateYaku } from '../../src/engine/yaku'
import type { HanafudaCard, Yaku, YakuType } from '../../src/engine/types'

const LIGHT_IDS = ['jan-hikari', 'mar-hikari', 'aug-hikari', 'nov-hikari', 'dec-hikari'] as const
const INOSHIKACHO_IDS = ['jun-tane', 'jul-tane', 'oct-tane'] as const
const AKATAN_IDS = ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'] as const
const AOTAN_IDS = ['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'] as const
const HANAMI_IDS = ['mar-hikari', 'sep-tane'] as const
const TSUKIMI_IDS = ['aug-hikari', 'sep-tane'] as const
const KEY_ORACLE_IDS = [
  ...LIGHT_IDS,
  ...INOSHIKACHO_IDS,
  ...AKATAN_IDS,
  ...AOTAN_IDS,
  'sep-tane',
] as const

function cardsById(ids: readonly string[]): HanafudaCard[] {
  return ids.map((id) => {
    const found = getCardById(id)
    if (!found) {
      throw new Error(`Unknown card id: ${id}`)
    }
    return found
  })
}

function pickByMask(ids: readonly string[], mask: number): string[] {
  return ids.filter((_, index) => (mask & (1 << index)) !== 0)
}

function hasAll(idSet: ReadonlySet<string>, ids: readonly string[]): boolean {
  return ids.every((id) => idSet.has(id))
}

function pickCardsByOrder(byId: ReadonlyMap<string, HanafudaCard>, ids: readonly string[]): HanafudaCard[] {
  return ids.flatMap((id) => {
    const found = byId.get(id)
    return found ? [found] : []
  })
}

function oracleCalculateYaku(capturedCards: readonly HanafudaCard[]): Yaku[] {
  const byId = new Map(capturedCards.map((card) => [card.id, card]))
  const idSet = new Set(capturedCards.map((card) => card.id))

  const hikariCards = capturedCards.filter((card) => card.type === 'hikari')
  const taneCards = capturedCards.filter((card) => card.type === 'tane')
  const tanzakuCards = capturedCards.filter((card) => card.type === 'tanzaku')
  const kasuCards = capturedCards.filter((card) => card.type === 'kasu')

  const yaku: Yaku[] = []

  const hasRain = idSet.has('nov-hikari')
  if (hikariCards.length === 5) {
    yaku.push({ type: 'goko', name: '五光', points: 10, cards: hikariCards })
  } else if (hikariCards.length === 4) {
    if (hasRain) {
      yaku.push({ type: 'ame-shiko', name: '雨四光', points: 7, cards: hikariCards })
    } else {
      yaku.push({ type: 'shiko', name: '四光', points: 8, cards: hikariCards })
    }
  } else if (hikariCards.length === 3 && !hasRain) {
    yaku.push({ type: 'sanko', name: '三光', points: 5, cards: hikariCards })
  }

  if (hasAll(idSet, INOSHIKACHO_IDS)) {
    yaku.push({ type: 'inoshikacho', name: '猪鹿蝶', points: 5, cards: pickCardsByOrder(byId, INOSHIKACHO_IDS) })
  }
  if (hasAll(idSet, HANAMI_IDS)) {
    yaku.push({ type: 'hanami-zake', name: '花見で一杯', points: 5, cards: pickCardsByOrder(byId, HANAMI_IDS) })
  }
  if (hasAll(idSet, TSUKIMI_IDS)) {
    yaku.push({ type: 'tsukimi-zake', name: '月見で一杯', points: 5, cards: pickCardsByOrder(byId, TSUKIMI_IDS) })
  }
  if (hasAll(idSet, AKATAN_IDS)) {
    yaku.push({ type: 'akatan', name: '赤短', points: 5 + (tanzakuCards.length - 3), cards: pickCardsByOrder(byId, AKATAN_IDS) })
  }
  if (hasAll(idSet, AOTAN_IDS)) {
    yaku.push({ type: 'aotan', name: '青短', points: 5 + (tanzakuCards.length - 3), cards: pickCardsByOrder(byId, AOTAN_IDS) })
  }

  if (taneCards.length >= 5) {
    yaku.push({ type: 'tane', name: 'たね', points: taneCards.length - 4, cards: taneCards })
  }
  if (tanzakuCards.length >= 5) {
    yaku.push({ type: 'tanzaku', name: 'たんざく', points: tanzakuCards.length - 4, cards: tanzakuCards })
  }
  if (kasuCards.length >= 10) {
    yaku.push({ type: 'kasu', name: 'かす', points: kasuCards.length - 9, cards: kasuCards })
  }

  return yaku
}

type NormalizedYaku = {
  readonly points: number
  readonly cardIds: readonly string[]
}

function normalizeYaku(yaku: readonly Yaku[]): Map<YakuType, NormalizedYaku> {
  const map = new Map<YakuType, NormalizedYaku>()
  for (const item of yaku) {
    const cardIds = [...item.cards].map((card) => card.id).sort()
    map.set(item.type, { points: item.points, cardIds })
  }
  return map
}

function diffYaku(actual: readonly Yaku[], expected: readonly Yaku[]): string | null {
  const actualMap = normalizeYaku(actual)
  const expectedMap = normalizeYaku(expected)
  const actualTypes = [...actualMap.keys()].sort()
  const expectedTypes = [...expectedMap.keys()].sort()
  if (actualTypes.join(',') !== expectedTypes.join(',')) {
    return `types mismatch (actual=${actualTypes.join('|')}, expected=${expectedTypes.join('|')})`
  }

  for (const type of expectedTypes) {
    const actualItem = actualMap.get(type)
    const expectedItem = expectedMap.get(type)
    if (!actualItem || !expectedItem) {
      return `missing type ${type}`
    }
    if (actualItem.points !== expectedItem.points) {
      return `points mismatch for ${type} (actual=${actualItem.points}, expected=${expectedItem.points})`
    }
    if (actualItem.cardIds.join(',') !== expectedItem.cardIds.join(',')) {
      return `cards mismatch for ${type} (actual=${actualItem.cardIds.join('|')}, expected=${expectedItem.cardIds.join('|')})`
    }
  }

  return null
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

describe('calculateYaku oracle cross-check', () => {
  it('matches the independent oracle across all key-card subsets', () => {
    const keyCards = cardsById(KEY_ORACLE_IDS)
    const mismatches: string[] = []
    for (let mask = 0; mask < (1 << keyCards.length); mask += 1) {
      const ids = pickByMask(KEY_ORACLE_IDS, mask)
      const captured = cardsById(ids)
      const actual = calculateYaku(captured)
      const expected = oracleCalculateYaku(captured)
      const diff = diffYaku(actual, expected)
      if (diff) {
        mismatches.push(`mask=${mask} ids=[${ids.join(',')}]: ${diff}`)
        if (mismatches.length >= 12) {
          break
        }
      }
    }
    expect(mismatches).toEqual([])
  })

  it('matches the independent oracle for deterministic random full-deck subsets', () => {
    const rng = mulberry32(0x5eed2026)
    const mismatches: string[] = []
    for (let index = 0; index < 5000; index += 1) {
      const captured = HANAFUDA_CARDS.filter(() => rng() < 0.5)
      const actual = calculateYaku(captured)
      const expected = oracleCalculateYaku(captured)
      const diff = diffYaku(actual, expected)
      if (diff) {
        const ids = captured.map((card) => card.id).join(',')
        mismatches.push(`sample=${index} size=${captured.length} ids=[${ids}]: ${diff}`)
        if (mismatches.length >= 12) {
          break
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})

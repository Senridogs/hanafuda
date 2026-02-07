import { describe, expect, it } from 'vitest'
import { getCardById, getCardsByType } from '../../src/engine/cards'
import { calculateYaku, getYakuTotalPoints } from '../../src/engine/yaku'
import type { Yaku, YakuType } from '../../src/engine/types'

const HIKARI_IDS = ['jan-hikari', 'mar-hikari', 'aug-hikari', 'nov-hikari', 'dec-hikari'] as const
const INOSHIKACHO_IDS = ['jun-tane', 'jul-tane', 'oct-tane'] as const
const AKATAN_IDS = ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'] as const
const AOTAN_IDS = ['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'] as const
const SAKE_IDS = ['mar-hikari', 'aug-hikari', 'sep-tane'] as const

function cardsById(ids: readonly string[]) {
  return ids.map((id) => {
    const card = getCardById(id)
    if (!card) {
      throw new Error(`Unknown card id: ${id}`)
    }
    return card
  })
}

function pickByMask(ids: readonly string[], mask: number): string[] {
  return ids.filter((_, index) => (mask & (1 << index)) !== 0)
}

function hasType(yaku: readonly Yaku[], type: YakuType): boolean {
  return yaku.some((item) => item.type === type)
}

function pointsByType(yaku: readonly Yaku[], type: YakuType): number | null {
  const found = yaku.find((item) => item.type === type)
  return found ? found.points : null
}

describe('calculateYaku exhaustive branches', () => {
  it('exhaustively validates light-yaku exclusivity across all hikari subsets', () => {
    for (let mask = 0; mask < (1 << HIKARI_IDS.length); mask += 1) {
      const ids = pickByMask(HIKARI_IDS, mask)
      const yaku = calculateYaku(cardsById(ids))
      const lightTypes = ['goko', 'shiko', 'ame-shiko', 'sanko'] as const
      const detected = lightTypes.filter((type) => hasType(yaku, type))

      const count = ids.length
      const hasRain = ids.includes('nov-hikari')
      let expected: YakuType | null = null
      if (count === 5) {
        expected = 'goko'
      } else if (count === 4) {
        expected = hasRain ? 'ame-shiko' : 'shiko'
      } else if (count === 3 && !hasRain) {
        expected = 'sanko'
      }

      if (!expected) {
        expect(detected).toHaveLength(0)
      } else {
        expect(detected).toEqual([expected])
      }
    }
  })

  it('exhaustively validates 猪鹿蝶 trigger set', () => {
    for (let mask = 0; mask < (1 << INOSHIKACHO_IDS.length); mask += 1) {
      const ids = pickByMask(INOSHIKACHO_IDS, mask)
      const yaku = calculateYaku(cardsById(ids))
      expect(hasType(yaku, 'inoshikacho')).toBe(ids.length === INOSHIKACHO_IDS.length)
    }
  })

  it('exhaustively validates 赤短/青短 trigger sets', () => {
    for (let mask = 0; mask < (1 << AKATAN_IDS.length); mask += 1) {
      const ids = pickByMask(AKATAN_IDS, mask)
      const yaku = calculateYaku(cardsById(ids))
      expect(hasType(yaku, 'akatan')).toBe(ids.length === AKATAN_IDS.length)
    }

    for (let mask = 0; mask < (1 << AOTAN_IDS.length); mask += 1) {
      const ids = pickByMask(AOTAN_IDS, mask)
      const yaku = calculateYaku(cardsById(ids))
      expect(hasType(yaku, 'aotan')).toBe(ids.length === AOTAN_IDS.length)
    }
  })

  it('exhaustively validates 花見/月見 pair triggers', () => {
    for (let mask = 0; mask < (1 << SAKE_IDS.length); mask += 1) {
      const ids = pickByMask(SAKE_IDS, mask)
      const yaku = calculateYaku(cardsById(ids))
      const hasMar = ids.includes('mar-hikari')
      const hasAug = ids.includes('aug-hikari')
      const hasSep = ids.includes('sep-tane')
      expect(hasType(yaku, 'hanami-zake')).toBe(hasMar && hasSep)
      expect(hasType(yaku, 'tsukimi-zake')).toBe(hasAug && hasSep)
    }
  })

  it('exhaustively validates progression yaku points by count', () => {
    const taneCards = getCardsByType('tane')
    const tanzakuCards = getCardsByType('tanzaku')
    const kasuCards = getCardsByType('kasu')

    for (let count = 0; count <= taneCards.length; count += 1) {
      const yaku = calculateYaku(taneCards.slice(0, count))
      const expected = count >= 5 ? count - 4 : null
      expect(pointsByType(yaku, 'tane')).toBe(expected)
    }

    for (let count = 0; count <= tanzakuCards.length; count += 1) {
      const yaku = calculateYaku(tanzakuCards.slice(0, count))
      const expected = count >= 5 ? count - 4 : null
      expect(pointsByType(yaku, 'tanzaku')).toBe(expected)
    }

    for (let count = 0; count <= kasuCards.length; count += 1) {
      const yaku = calculateYaku(kasuCards.slice(0, count))
      const expected = count >= 10 ? count - 9 : null
      expect(pointsByType(yaku, 'kasu')).toBe(expected)
    }
  })

  it('validates total points equal the sum of individual yaku points', () => {
    const captured = cardsById([
      'jan-hikari', 'mar-hikari', 'dec-hikari',
      'jun-tane', 'jul-tane', 'oct-tane', 'may-tane', 'feb-tane',
      'jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku',
      'jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku',
      'jan-kasu-1', 'jan-kasu-2', 'feb-kasu-1', 'feb-kasu-2',
      'mar-kasu-1', 'mar-kasu-2', 'apr-kasu-1', 'apr-kasu-2',
      'may-kasu-1', 'may-kasu-2',
    ])
    const yaku = calculateYaku(captured)
    const sum = yaku.reduce((acc, item) => acc + item.points, 0)
    expect(getYakuTotalPoints(yaku)).toBe(sum)
  })
})

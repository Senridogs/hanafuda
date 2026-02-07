import { describe, expect, it } from 'vitest'
import { getCardById, getCardsByType } from '../../src/engine/cards'
import { calculateYaku } from '../../src/engine/yaku'
import { buildYakuProgressEntries, type YakuProgressKey } from '../../src/ui/gameUi'

const HIKARI_IDS = ['jan-hikari', 'mar-hikari', 'aug-hikari', 'nov-hikari', 'dec-hikari'] as const
const HANAMI_IDS = ['mar-hikari', 'sep-tane'] as const
const AKATAN_IDS = ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'] as const
const AOTAN_IDS = ['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'] as const

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

function toEntryMap(entries: readonly ReturnType<typeof buildYakuProgressEntries>[number][]) {
  return new Map<YakuProgressKey, ReturnType<typeof buildYakuProgressEntries>[number]>(
    entries.map((entry) => [entry.key, entry]),
  )
}

describe('buildYakuProgressEntries exhaustive branches', () => {
  it('exhaustively validates 三光 progress behavior across all hikari subsets', () => {
    for (let mask = 0; mask < (1 << HIKARI_IDS.length); mask += 1) {
      const ids = pickByMask(HIKARI_IDS, mask)
      const captured = cardsById(ids)
      const yaku = calculateYaku(captured)
      const entries = buildYakuProgressEntries(captured, yaku)
      const sanko = toEntryMap(entries).get('sanko')

      const hasRain = ids.includes('nov-hikari')
      const hasLightYaku = yaku.some((item) => ['sanko', 'shiko', 'ame-shiko', 'goko'].includes(item.type))
      const nonRainCount = ids.filter((id) => id !== 'nov-hikari').length
      const expectedCurrent = hasRain && !hasLightYaku ? nonRainCount : ids.length

      expect(sanko?.current).toBe(expectedCurrent)
      expect(sanko?.cards.length).toBe(expectedCurrent)
      expect(sanko?.done).toBe(hasLightYaku)
    }
  })

  it('exhaustively validates 花見 progress count and completion', () => {
    for (let mask = 0; mask < (1 << 3); mask += 1) {
      const ids = pickByMask(['mar-hikari', 'aug-hikari', 'sep-tane'], mask)
      const captured = cardsById(ids)
      const yaku = calculateYaku(captured)
      const hanami = toEntryMap(buildYakuProgressEntries(captured, yaku)).get('hanami-zake')
      const current = HANAMI_IDS.reduce((acc, id) => acc + (ids.includes(id) ? 1 : 0), 0)
      const done = ids.includes('mar-hikari') && ids.includes('sep-tane')

      expect(hanami?.current).toBe(current)
      expect(hanami?.done).toBe(done)
    }
  })

  it('exhaustively validates 赤短/青短 progress counts and completion', () => {
    for (let mask = 0; mask < (1 << AKATAN_IDS.length); mask += 1) {
      const ids = pickByMask(AKATAN_IDS, mask)
      const captured = cardsById(ids)
      const yaku = calculateYaku(captured)
      const akatan = toEntryMap(buildYakuProgressEntries(captured, yaku)).get('akatan')
      expect(akatan?.current).toBe(ids.length)
      expect(akatan?.done).toBe(ids.length === AKATAN_IDS.length)
    }

    for (let mask = 0; mask < (1 << AOTAN_IDS.length); mask += 1) {
      const ids = pickByMask(AOTAN_IDS, mask)
      const captured = cardsById(ids)
      const yaku = calculateYaku(captured)
      const aotan = toEntryMap(buildYakuProgressEntries(captured, yaku)).get('aotan')
      expect(aotan?.current).toBe(ids.length)
      expect(aotan?.done).toBe(ids.length === AOTAN_IDS.length)
    }
  })

  it('exhaustively validates threshold progress counters for tane/tanzaku/kasu', () => {
    const taneCards = getCardsByType('tane')
    const tanzakuCards = getCardsByType('tanzaku')
    const kasuCards = getCardsByType('kasu')

    for (let count = 0; count <= taneCards.length; count += 1) {
      const captured = taneCards.slice(0, count)
      const entry = toEntryMap(buildYakuProgressEntries(captured, calculateYaku(captured))).get('tane')
      expect(entry?.current).toBe(count)
      expect(entry?.done).toBe(count >= 5)
    }

    for (let count = 0; count <= tanzakuCards.length; count += 1) {
      const captured = tanzakuCards.slice(0, count)
      const entry = toEntryMap(buildYakuProgressEntries(captured, calculateYaku(captured))).get('tanzaku')
      expect(entry?.current).toBe(count)
      expect(entry?.done).toBe(count >= 5)
    }

    for (let count = 0; count <= kasuCards.length; count += 1) {
      const captured = kasuCards.slice(0, count)
      const entry = toEntryMap(buildYakuProgressEntries(captured, calculateYaku(captured))).get('kasu')
      expect(entry?.current).toBe(count)
      expect(entry?.done).toBe(count >= 10)
    }
  })
})

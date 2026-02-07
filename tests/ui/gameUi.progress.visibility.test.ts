import { describe, expect, it } from 'vitest'
import { getCardById } from '../../src/engine/cards'
import { calculateYaku } from '../../src/engine/yaku'
import { buildVisibleYakuProgressEntries, buildYakuProgressEntries } from '../../src/ui/gameUi'

function cardsById(ids: readonly string[]) {
  return ids.map((id) => {
    const card = getCardById(id)
    if (!card) {
      throw new Error(`Unknown card id: ${id}`)
    }
    return card
  })
}

describe('buildVisibleYakuProgressEntries', () => {
  it('keeps completed yaku visible and groups overlapping done entries', () => {
    const captured = cardsById(['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'])
    const progress = buildYakuProgressEntries(captured, calculateYaku(captured))
    const visible = buildVisibleYakuProgressEntries(progress)
    const tanzaku = visible.find((entry) => entry.key === 'tanzaku')
    const akatan = visible.find((entry) => entry.key === 'akatan')

    expect(tanzaku).toBeDefined()
    expect(tanzaku?.done).toBe(false)
    expect(tanzaku?.cards.length).toBe(3)
    expect(tanzaku?.subEntries?.map((sub) => sub.label)).toEqual(['赤タン'])
    expect(tanzaku?.subEntries?.[0]?.done).toBe(true)
    expect(akatan).toBeUndefined()
  })

  it('hides 五光/四光 before 三光 is ready and keeps 光系 in one row', () => {
    const captured = cardsById(['mar-hikari'])
    const progress = buildYakuProgressEntries(captured, calculateYaku(captured))
    const visible = buildVisibleYakuProgressEntries(progress)

    const goko = visible.find((entry) => entry.key === 'goko')
    const shiko = visible.find((entry) => entry.key === 'shiko')
    const ameShiko = visible.find((entry) => entry.key === 'ame-shiko')
    const sanko = visible.find((entry) => entry.key === 'sanko')
    const hanami = visible.find((entry) => entry.key === 'hanami-zake')

    expect(goko).toBeUndefined()
    expect(shiko).toBeUndefined()
    expect(ameShiko).toBeDefined()
    expect(ameShiko?.subEntries?.map((sub) => sub.label)).toEqual(['三光', '花見で一杯'])
    expect(sanko).toBeUndefined()
    expect(hanami).toBeUndefined()
  })

  it('keeps 光系 in 五光 row even when 三光 is completed, with 花見/月見 as subs', () => {
    const captured = cardsById(['jan-hikari', 'mar-hikari', 'aug-hikari'])
    const progress = buildYakuProgressEntries(captured, calculateYaku(captured))
    const visible = buildVisibleYakuProgressEntries(progress)

    const hanami = visible.find((entry) => entry.key === 'hanami-zake')
    const goko = visible.find((entry) => entry.key === 'goko')

    expect(goko).toBeDefined()
    expect(goko?.done).toBe(false)
    expect(goko?.cards.length).toBe(3)
    expect(goko?.subEntries?.map((sub) => sub.label)).toEqual(['四光', '雨入り四光', '三光', '月見で一杯', '花見で一杯'])
    expect(goko?.subEntries?.find((sub) => sub.label === '三光')?.done).toBe(true)
    expect(hanami).toBeUndefined()
  })

  it('prioritizes 月見で一杯 to 光系 row when 三光 line is visible in that row', () => {
    const captured = cardsById(['aug-hikari'])
    const progress = buildYakuProgressEntries(captured, calculateYaku(captured))
    const visible = buildVisibleYakuProgressEntries(progress)
    const ameShiko = visible.find((entry) => entry.key === 'ame-shiko')
    const goko = visible.find((entry) => entry.key === 'goko')
    const sanko = visible.find((entry) => entry.key === 'sanko')
    const tsukimi = visible.find((entry) => entry.key === 'tsukimi-zake')

    expect(ameShiko).toBeDefined()
    expect(ameShiko?.subEntries?.map((sub) => sub.label)).toEqual(['三光', '月見で一杯'])
    expect(goko).toBeUndefined()
    expect(sanko).toBeUndefined()
    expect(tsukimi).toBeUndefined()
  })

  it('merges タネ5 with 猪鹿蝶 as sub entry', () => {
    const captured = cardsById(['jun-tane', 'jul-tane'])
    const progress = buildYakuProgressEntries(captured, calculateYaku(captured))
    const visible = buildVisibleYakuProgressEntries(progress)
    const tane = visible.find((entry) => entry.key === 'tane')
    const inoshikacho = visible.find((entry) => entry.key === 'inoshikacho')

    expect(tane).toBeDefined()
    expect(tane?.subEntries?.map((sub) => sub.label)).toEqual(['猪鹿蝶'])
    expect(inoshikacho).toBeUndefined()
  })

  it('merges タネ5 with 花見で一杯/月見で一杯 as sub entries', () => {
    const captured = cardsById(['sep-tane'])
    const progress = buildYakuProgressEntries(captured, calculateYaku(captured))
    const visible = buildVisibleYakuProgressEntries(progress)
    const tane = visible.find((entry) => entry.key === 'tane')
    const hanami = visible.find((entry) => entry.key === 'hanami-zake')
    const tsukimi = visible.find((entry) => entry.key === 'tsukimi-zake')

    expect(tane).toBeDefined()
    expect(tane?.subEntries?.map((sub) => sub.label)).toEqual(['花見で一杯', '月見で一杯'])
    expect(hanami).toBeUndefined()
    expect(tsukimi).toBeUndefined()
  })

  it('prioritizes 花見/月見 under 光系 row when 三光 line is visible and cards overlap', () => {
    const withSankoSide = cardsById(['mar-hikari', 'sep-tane'])
    const withSankoProgress = buildVisibleYakuProgressEntries(
      buildYakuProgressEntries(withSankoSide, calculateYaku(withSankoSide)),
    )
    const ameWithSanko = withSankoProgress.find((entry) => entry.key === 'ame-shiko')
    const gokoWithSanko = withSankoProgress.find((entry) => entry.key === 'goko')
    const taneWithSanko = withSankoProgress.find((entry) => entry.key === 'tane')
    expect(ameWithSanko?.subEntries?.map((sub) => sub.label)).toEqual(['三光', '花見で一杯'])
    expect(gokoWithSanko).toBeUndefined()
    expect(taneWithSanko?.subEntries?.map((sub) => sub.label)).toEqual(['月見で一杯'])

    const noSankoSide = cardsById(['nov-hikari', 'mar-hikari', 'sep-tane'])
    const noSankoProgress = buildVisibleYakuProgressEntries(
      buildYakuProgressEntries(noSankoSide, calculateYaku(noSankoSide)),
    )
    const ameNoSanko = noSankoProgress.find((entry) => entry.key === 'ame-shiko')
    const gokoNoSanko = noSankoProgress.find((entry) => entry.key === 'goko')
    const taneNoSanko = noSankoProgress.find((entry) => entry.key === 'tane')
    expect(ameNoSanko?.subEntries?.map((sub) => sub.label)).toEqual(['三光', '花見で一杯'])
    expect(gokoNoSanko).toBeUndefined()
    expect(taneNoSanko?.subEntries?.map((sub) => sub.label)).toEqual(['月見で一杯'])
  })

  it('does not duplicate the same card image across visible rows', () => {
    const captured = cardsById(['jan-hikari', 'mar-hikari', 'aug-hikari', 'sep-tane', 'jun-tane', 'jul-tane', 'oct-tane'])
    const progress = buildYakuProgressEntries(captured, calculateYaku(captured))
    const visible = buildVisibleYakuProgressEntries(progress)
    const cardIds = visible.flatMap((entry) => entry.cards.map((card) => card.id))
    const uniqueIds = new Set(cardIds)

    expect(cardIds.length).toBe(uniqueIds.size)
  })

  it('merges タン5 with 赤タン/青タン as sub entries', () => {
    const captured = cardsById(['jan-tanzaku', 'feb-tanzaku', 'jun-tanzaku', 'sep-tanzaku'])
    const progress = buildYakuProgressEntries(captured, calculateYaku(captured))
    const visible = buildVisibleYakuProgressEntries(progress)
    const tanzaku = visible.find((entry) => entry.key === 'tanzaku')
    const akatan = visible.find((entry) => entry.key === 'akatan')
    const aotan = visible.find((entry) => entry.key === 'aotan')

    expect(tanzaku).toBeDefined()
    expect(tanzaku?.subEntries?.map((sub) => sub.label)).toEqual(['赤タン', '青タン'])
    expect(akatan).toBeUndefined()
    expect(aotan).toBeUndefined()
  })
})

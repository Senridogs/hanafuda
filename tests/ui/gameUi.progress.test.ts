import { describe, expect, it } from 'vitest'
import { getCardById } from '../../src/engine/cards'
import { calculateYaku } from '../../src/engine/yaku'
import { buildYakuProgressEntries, type YakuProgressKey } from '../../src/ui/gameUi'

function cardsById(ids: readonly string[]) {
  return ids.map((id) => {
    const card = getCardById(id)
    if (!card) {
      throw new Error(`Unknown card id: ${id}`)
    }
    return card
  })
}

function toEntryMap(entries: readonly ReturnType<typeof buildYakuProgressEntries>[number][]) {
  return new Map<YakuProgressKey, ReturnType<typeof buildYakuProgressEntries>[number]>(
    entries.map((entry) => [entry.key, entry]),
  )
}

describe('buildYakuProgressEntries', () => {
  it('returns all progress categories with zero baseline', () => {
    const entries = buildYakuProgressEntries([], [])
    const entryMap = toEntryMap(entries)

    expect(entries).toHaveLength(12)
    for (const key of ['goko', 'shiko', 'ame-shiko', 'sanko', 'hanami-zake', 'tsukimi-zake', 'inoshikacho', 'tane', 'akatan', 'aotan', 'tanzaku', 'kasu'] as const) {
      expect(entryMap.get(key)?.current).toBe(0)
      expect(entryMap.get(key)?.done).toBe(false)
    }
  })

  it('shows 三光 progress by non-rain lights when 雨札 is captured before completion', () => {
    const captured = cardsById(['jan-hikari', 'mar-hikari', 'nov-hikari'])
    const entries = buildYakuProgressEntries(captured, calculateYaku(captured))
    const sanko = toEntryMap(entries).get('sanko')

    expect(sanko?.current).toBe(2)
    expect(sanko?.cards.map((card) => card.id)).toEqual(['jan-hikari', 'mar-hikari'])
    expect(sanko?.done).toBe(false)
  })

  it('marks 三光 progress as done when upper light yaku is achieved', () => {
    const captured = cardsById(['jan-hikari', 'mar-hikari', 'aug-hikari', 'dec-hikari'])
    const entries = buildYakuProgressEntries(captured, calculateYaku(captured))
    const sanko = toEntryMap(entries).get('sanko')

    expect(sanko?.current).toBe(4)
    expect(sanko?.done).toBe(true)
  })

  it('tracks 赤短 progress and completion correctly', () => {
    const partial = cardsById(['jan-tanzaku', 'feb-tanzaku'])
    const partialEntries = buildYakuProgressEntries(partial, calculateYaku(partial))
    const partialAkatan = toEntryMap(partialEntries).get('akatan')
    expect(partialAkatan?.current).toBe(2)
    expect(partialAkatan?.done).toBe(false)

    const completed = cardsById(['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'])
    const completedEntries = buildYakuProgressEntries(completed, calculateYaku(completed))
    const completedAkatan = toEntryMap(completedEntries).get('akatan')
    expect(completedAkatan?.current).toBe(3)
    expect(completedAkatan?.done).toBe(true)
  })

  it('tracks threshold yaku progress counts and done flags', () => {
    const captured = cardsById([
      'feb-tane', 'apr-tane', 'may-tane', 'aug-tane', 'sep-tane',
      'apr-tanzaku', 'may-tanzaku', 'jul-tanzaku', 'nov-tanzaku', 'jan-tanzaku',
      'jan-kasu-1', 'jan-kasu-2', 'feb-kasu-1', 'feb-kasu-2', 'mar-kasu-1',
      'mar-kasu-2', 'apr-kasu-1', 'apr-kasu-2', 'may-kasu-1', 'may-kasu-2',
    ])
    const entries = buildYakuProgressEntries(captured, calculateYaku(captured))
    const entryMap = toEntryMap(entries)

    expect(entryMap.get('tane')?.current).toBe(5)
    expect(entryMap.get('tane')?.done).toBe(true)
    expect(entryMap.get('tanzaku')?.current).toBe(5)
    expect(entryMap.get('tanzaku')?.done).toBe(true)
    expect(entryMap.get('kasu')?.current).toBe(10)
    expect(entryMap.get('kasu')?.done).toBe(true)
  })

  it('hides progress for card-set yaku that are impossible due to opponent captures', () => {
    const captured = cardsById(['mar-hikari'])
    const blocked = new Set<string>(['sep-tane'])
    const entries = buildYakuProgressEntries(captured, calculateYaku(captured), blocked)
    const hanami = toEntryMap(entries).get('hanami-zake')

    expect(hanami?.current).toBe(0)
    expect(hanami?.cards).toEqual([])
    expect(hanami?.done).toBe(false)
  })

  it('hides threshold yaku progress when reaching target is impossible', () => {
    const captured = cardsById(['feb-tane', 'apr-tane', 'may-tane', 'aug-tane'])
    const blocked = new Set<string>(['jun-tane', 'jul-tane', 'oct-tane', 'nov-tane', 'sep-tane'])
    const entries = buildYakuProgressEntries(captured, calculateYaku(captured), blocked)
    const tane = toEntryMap(entries).get('tane')

    expect(tane?.current).toBe(0)
    expect(tane?.cards).toEqual([])
    expect(tane?.done).toBe(false)
  })

  it('does not display 花見/月見 progress when disabled by local rule options', () => {
    const captured = cardsById(['mar-hikari', 'aug-hikari', 'sep-tane'])
    const yaku = calculateYaku(captured)
    const entries = buildYakuProgressEntries(
      captured,
      yaku,
      new Set<string>(),
      { enableHanamiZake: false, enableTsukimiZake: false },
    )
    const entryMap = toEntryMap(entries)

    expect(entryMap.get('hanami-zake')?.current).toBe(0)
    expect(entryMap.get('hanami-zake')?.cards).toEqual([])
    expect(entryMap.get('hanami-zake')?.done).toBe(false)
    expect(entryMap.get('tsukimi-zake')?.current).toBe(0)
    expect(entryMap.get('tsukimi-zake')?.cards).toEqual([])
    expect(entryMap.get('tsukimi-zake')?.done).toBe(false)
  })

  it('does not display 花見/月見 progress when blocked by 雨流れ/霧流れ', () => {
    const rainCaptured = cardsById(['mar-hikari', 'aug-hikari', 'sep-tane', 'nov-hikari'])
    const rainEntries = buildYakuProgressEntries(
      rainCaptured,
      calculateYaku(rainCaptured),
      new Set<string>(),
      { enableAmeNagare: true, enableKiriNagare: false },
    )
    const rainMap = toEntryMap(rainEntries)
    expect(rainMap.get('hanami-zake')?.current).toBe(0)
    expect(rainMap.get('tsukimi-zake')?.current).toBe(0)

    const fogCaptured = cardsById(['mar-hikari', 'aug-hikari', 'sep-tane', 'dec-kasu-1'])
    const fogEntries = buildYakuProgressEntries(
      fogCaptured,
      calculateYaku(fogCaptured),
      new Set<string>(),
      { enableAmeNagare: false, enableKiriNagare: true },
    )
    const fogMap = toEntryMap(fogEntries)
    expect(fogMap.get('hanami-zake')?.current).toBe(0)
    expect(fogMap.get('tsukimi-zake')?.current).toBe(0)
  })
})

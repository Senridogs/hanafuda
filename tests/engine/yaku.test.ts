import { describe, expect, it } from 'vitest'
import { getCardById } from '../../src/engine/cards'
import { calculateYaku, getYakuTotalPoints } from '../../src/engine/yaku'
import type { YakuType } from '../../src/engine/types'

function cardsById(ids: readonly string[]) {
  return ids.map((id) => {
    const card = getCardById(id)
    if (!card) {
      throw new Error(`Unknown card id: ${id}`)
    }
    return card
  })
}

function hasYakuType(yaku: ReturnType<typeof calculateYaku>, type: YakuType): boolean {
  return yaku.some((item) => item.type === type)
}

function getYakuPointsByType(yaku: ReturnType<typeof calculateYaku>, type: YakuType): number | null {
  const found = yaku.find((item) => item.type === type)
  return found ? found.points : null
}

describe('calculateYaku', () => {
  it('detects 三光 (rain excluded)', () => {
    const captured = cardsById(['jan-hikari', 'mar-hikari', 'aug-hikari'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'sanko')).toBe(true)
    expect(getYakuPointsByType(yaku, 'sanko')).toBe(5)
    expect(hasYakuType(yaku, 'shiko')).toBe(false)
    expect(hasYakuType(yaku, 'ame-shiko')).toBe(false)
    expect(hasYakuType(yaku, 'goko')).toBe(false)
  })

  it('does not count 三光 when 雨札 is included in three lights', () => {
    const captured = cardsById(['jan-hikari', 'mar-hikari', 'nov-hikari'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'sanko')).toBe(false)
    expect(hasYakuType(yaku, 'shiko')).toBe(false)
    expect(hasYakuType(yaku, 'ame-shiko')).toBe(false)
    expect(hasYakuType(yaku, 'goko')).toBe(false)
  })

  it('detects 四光 and excludes 三光', () => {
    const captured = cardsById(['jan-hikari', 'mar-hikari', 'aug-hikari', 'dec-hikari'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'shiko')).toBe(true)
    expect(getYakuPointsByType(yaku, 'shiko')).toBe(8)
    expect(hasYakuType(yaku, 'sanko')).toBe(false)
    expect(hasYakuType(yaku, 'ame-shiko')).toBe(false)
    expect(hasYakuType(yaku, 'goko')).toBe(false)
  })

  it('detects 雨四光 and excludes 三光', () => {
    const captured = cardsById(['jan-hikari', 'mar-hikari', 'nov-hikari', 'dec-hikari'])
    const yaku = calculateYaku(captured)

    expect(yaku.some((item) => item.type === 'sanko')).toBe(false)
    expect(hasYakuType(yaku, 'shiko')).toBe(false)
    expect(hasYakuType(yaku, 'ame-shiko')).toBe(true)
    expect(getYakuPointsByType(yaku, 'ame-shiko')).toBe(7)
    expect(hasYakuType(yaku, 'goko')).toBe(false)
  })

  it('detects 五光 and excludes lower light yaku', () => {
    const captured = cardsById(['jan-hikari', 'mar-hikari', 'aug-hikari', 'nov-hikari', 'dec-hikari'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'goko')).toBe(true)
    expect(getYakuPointsByType(yaku, 'goko')).toBe(10)
    expect(hasYakuType(yaku, 'shiko')).toBe(false)
    expect(hasYakuType(yaku, 'ame-shiko')).toBe(false)
    expect(hasYakuType(yaku, 'sanko')).toBe(false)
  })

  it('detects 猪鹿蝶', () => {
    const captured = cardsById(['jun-tane', 'jul-tane', 'oct-tane'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'inoshikacho')).toBe(true)
    expect(getYakuPointsByType(yaku, 'inoshikacho')).toBe(5)
  })

  it('detects 花見で一杯', () => {
    const captured = cardsById(['mar-hikari', 'sep-tane'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'hanami-zake')).toBe(true)
    expect(getYakuPointsByType(yaku, 'hanami-zake')).toBe(5)
  })

  it('detects 月見で一杯', () => {
    const captured = cardsById(['aug-hikari', 'sep-tane'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'tsukimi-zake')).toBe(true)
    expect(getYakuPointsByType(yaku, 'tsukimi-zake')).toBe(5)
  })

  it('detects 赤短', () => {
    const captured = cardsById(['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'akatan')).toBe(true)
    expect(getYakuPointsByType(yaku, 'akatan')).toBe(5)
  })

  it('detects 青短', () => {
    const captured = cardsById(['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'aotan')).toBe(true)
    expect(getYakuPointsByType(yaku, 'aotan')).toBe(5)
  })

  it('handles たね progression thresholds and increments', () => {
    const tane4 = calculateYaku(cardsById(['feb-tane', 'apr-tane', 'may-tane', 'aug-tane']))
    const tane5 = calculateYaku(cardsById(['feb-tane', 'apr-tane', 'may-tane', 'aug-tane', 'sep-tane']))
    const tane7 = calculateYaku(cardsById(['feb-tane', 'apr-tane', 'may-tane', 'aug-tane', 'sep-tane', 'nov-tane', 'jun-tane']))

    expect(hasYakuType(tane4, 'tane')).toBe(false)
    expect(getYakuPointsByType(tane5, 'tane')).toBe(1)
    expect(getYakuPointsByType(tane7, 'tane')).toBe(3)
  })

  it('handles たんざく progression thresholds and increments', () => {
    const tanzaku4 = calculateYaku(cardsById(['apr-tanzaku', 'may-tanzaku', 'jul-tanzaku', 'nov-tanzaku']))
    const tanzaku5 = calculateYaku(cardsById(['apr-tanzaku', 'may-tanzaku', 'jul-tanzaku', 'nov-tanzaku', 'jan-tanzaku']))
    const tanzaku7 = calculateYaku(cardsById(['apr-tanzaku', 'may-tanzaku', 'jul-tanzaku', 'nov-tanzaku', 'jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku']))

    expect(hasYakuType(tanzaku4, 'tanzaku')).toBe(false)
    expect(getYakuPointsByType(tanzaku5, 'tanzaku')).toBe(1)
    expect(getYakuPointsByType(tanzaku7, 'tanzaku')).toBe(3)
  })

  it('handles かす progression thresholds and increments', () => {
    const kasu9 = calculateYaku(cardsById([
      'jan-kasu-1', 'jan-kasu-2',
      'feb-kasu-1', 'feb-kasu-2',
      'mar-kasu-1', 'mar-kasu-2',
      'apr-kasu-1', 'apr-kasu-2',
      'may-kasu-1',
    ]))
    const kasu10 = calculateYaku(cardsById([
      'jan-kasu-1', 'jan-kasu-2',
      'feb-kasu-1', 'feb-kasu-2',
      'mar-kasu-1', 'mar-kasu-2',
      'apr-kasu-1', 'apr-kasu-2',
      'may-kasu-1', 'may-kasu-2',
    ]))
    const kasu12 = calculateYaku(cardsById([
      'jan-kasu-1', 'jan-kasu-2',
      'feb-kasu-1', 'feb-kasu-2',
      'mar-kasu-1', 'mar-kasu-2',
      'apr-kasu-1', 'apr-kasu-2',
      'may-kasu-1', 'may-kasu-2',
      'jun-kasu-1', 'jun-kasu-2',
    ]))

    expect(hasYakuType(kasu9, 'kasu')).toBe(false)
    expect(getYakuPointsByType(kasu10, 'kasu')).toBe(1)
    expect(getYakuPointsByType(kasu12, 'kasu')).toBe(3)
  })

  it('allows simultaneous yaku when multiple conditions are met at once', () => {
    const captured = cardsById([
      'jan-hikari', 'mar-hikari', 'dec-hikari',
      'jun-tane', 'jul-tane', 'oct-tane', 'may-tane', 'feb-tane',
    ])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'sanko')).toBe(true)
    expect(hasYakuType(yaku, 'inoshikacho')).toBe(true)
    expect(getYakuPointsByType(yaku, 'tane')).toBe(1)
    expect(getYakuTotalPoints(yaku)).toBe(11)
  })

  it('allows hanami and tsukimi simultaneously via shared sake card', () => {
    const captured = cardsById(['mar-hikari', 'aug-hikari', 'sep-tane'])
    const yaku = calculateYaku(captured)

    expect(hasYakuType(yaku, 'hanami-zake')).toBe(true)
    expect(hasYakuType(yaku, 'tsukimi-zake')).toBe(true)
    expect(getYakuTotalPoints(yaku)).toBe(10)
  })
})

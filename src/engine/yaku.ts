import { DEFAULT_LOCAL_RULE_SETTINGS, normalizeLocalRuleSettings, type HanafudaCard, type LocalRuleSettingsInput, type Yaku } from './types'

const INOSHIKACHO_IDS = ['jun-tane', 'jul-tane', 'oct-tane'] as const
const AKATAN_IDS = ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'] as const
const AOTAN_IDS = ['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'] as const
const RAIN_FLOW_BLOCK_CARD_ID = 'nov-hikari'
const KIRI_FLOW_BLOCK_MONTH = 12

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

function findFourCardsMonthSet(cards: readonly HanafudaCard[]): readonly HanafudaCard[] | null {
  const byMonth = new Map<number, HanafudaCard[]>()
  for (const card of cards) {
    const monthCards = byMonth.get(card.month)
    if (monthCards) {
      monthCards.push(card)
      if (monthCards.length >= 4) {
        return monthCards
      }
      continue
    }
    byMonth.set(card.month, [card])
  }
  return null
}

function getSakeFlowBlockingState(
  capturedCards: readonly HanafudaCard[],
  options: {
    readonly enableHanamiZake: boolean
    readonly enableTsukimiZake: boolean
    readonly enableAmeNagare: boolean
    readonly enableKiriNagare: boolean
  },
): { readonly hanamiBlocked: boolean; readonly tsukimiBlocked: boolean } {
  const hasRainFlowBlock = capturedCards.some((card) => card.id === RAIN_FLOW_BLOCK_CARD_ID)
  const hasKiriFlowBlock = capturedCards.some((card) => card.month === KIRI_FLOW_BLOCK_MONTH)
  const hanamiBlocked = options.enableHanamiZake && options.enableAmeNagare && hasRainFlowBlock
  const tsukimiBlocked = options.enableTsukimiZake && options.enableKiriNagare && hasKiriFlowBlock
  return { hanamiBlocked, tsukimiBlocked }
}

export function calculateYaku(
  capturedCards: readonly HanafudaCard[],
  localRules: LocalRuleSettingsInput = DEFAULT_LOCAL_RULE_SETTINGS,
): Yaku[] {
  const normalizedRules = normalizeLocalRuleSettings(localRules)
  const points = normalizedRules.yakuPoints
  const enabled = normalizedRules.yakuEnabled
  const isYakuEnabled = (type: Yaku['type']): boolean => enabled[type] && points[type] > 0
  const yaku: Yaku[] = []
  const hikariCards = capturedCards.filter((card) => card.type === 'hikari')
  const taneCards = capturedCards.filter((card) => card.type === 'tane')
  const tanzakuCards = capturedCards.filter((card) => card.type === 'tanzaku')
  const kasuCards = capturedCards.filter((card) => card.type === 'kasu')

  const hasRainMan = hikariCards.some((card) => card.id === 'nov-hikari')
  if (hikariCards.length === 5 && isYakuEnabled('goko')) {
    yaku.push(createYaku('goko', '五光', points.goko, hikariCards))
  } else if (hikariCards.length === 4) {
    if (hasRainMan && isYakuEnabled('ame-shiko')) {
      yaku.push(createYaku('ame-shiko', '雨四光', points['ame-shiko'], hikariCards))
    } else if (!hasRainMan && isYakuEnabled('shiko')) {
      yaku.push(createYaku('shiko', '四光', points.shiko, hikariCards))
    }
  } else if (hikariCards.length === 3 && !hasRainMan && isYakuEnabled('sanko')) {
    yaku.push(createYaku('sanko', '三光', points.sanko, hikariCards))
  }

  if (isYakuEnabled('shiten')) {
    const shitenCards = findFourCardsMonthSet(capturedCards)
    if (shitenCards) {
      yaku.push(createYaku('shiten', '四点役', points.shiten, shitenCards))
    }
  }

  if (isYakuEnabled('inoshikacho') && hasAllCards(capturedCards, INOSHIKACHO_IDS)) {
    const yakuPoints = points.inoshikacho + (taneCards.length - 3)
    yaku.push(createYaku('inoshikacho', '猪鹿蝶', yakuPoints, findCardsByIds(capturedCards, INOSHIKACHO_IDS)))
  }

  const { hanamiBlocked, tsukimiBlocked } = getSakeFlowBlockingState(capturedCards, {
    enableHanamiZake: isYakuEnabled('hanami-zake'),
    enableTsukimiZake: isYakuEnabled('tsukimi-zake'),
    enableAmeNagare: normalizedRules.enableAmeNagare,
    enableKiriNagare: normalizedRules.enableKiriNagare,
  })

  if (
    !hanamiBlocked
    && isYakuEnabled('hanami-zake')
    && hasAllCards(capturedCards, ['mar-hikari', 'sep-tane'])
  ) {
    yaku.push(
      createYaku('hanami-zake', '花見で一杯', points['hanami-zake'], findCardsByIds(capturedCards, ['mar-hikari', 'sep-tane'])),
    )
  }

  if (
    !tsukimiBlocked
    && isYakuEnabled('tsukimi-zake')
    && hasAllCards(capturedCards, ['aug-hikari', 'sep-tane'])
  ) {
    yaku.push(
      createYaku('tsukimi-zake', '月見で一杯', points['tsukimi-zake'], findCardsByIds(capturedCards, ['aug-hikari', 'sep-tane'])),
    )
  }

  if (isYakuEnabled('akatan') && hasAllCards(capturedCards, AKATAN_IDS)) {
    const yakuPoints = points.akatan + (tanzakuCards.length - 3)
    yaku.push(createYaku('akatan', '赤短', yakuPoints, findCardsByIds(capturedCards, AKATAN_IDS)))
  }

  if (isYakuEnabled('aotan') && hasAllCards(capturedCards, AOTAN_IDS)) {
    const yakuPoints = points.aotan + (tanzakuCards.length - 3)
    yaku.push(createYaku('aotan', '青短', yakuPoints, findCardsByIds(capturedCards, AOTAN_IDS)))
  }

  if (isYakuEnabled('tane') && taneCards.length >= 5) {
    const yakuPoints = points.tane + (taneCards.length - 5)
    yaku.push(createYaku('tane', 'たね', yakuPoints, taneCards))
  }

  if (isYakuEnabled('tanzaku') && tanzakuCards.length >= 5) {
    const yakuPoints = points.tanzaku + (tanzakuCards.length - 5)
    yaku.push(createYaku('tanzaku', 'たんざく', yakuPoints, tanzakuCards))
  }

  if (isYakuEnabled('kasu') && kasuCards.length >= 10) {
    const yakuPoints = points.kasu + (kasuCards.length - 10)
    yaku.push(createYaku('kasu', 'かす', yakuPoints, kasuCards))
  }

  return yaku
}

export function getYakuTotalPoints(yaku: readonly Yaku[]): number {
  return yaku.reduce((total, item) => total + item.points, 0)
}

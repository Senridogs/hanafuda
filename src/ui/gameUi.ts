import type { KoiKoiGameState } from '../engine/game'
import { HANAFUDA_CARDS, getCardsByType } from '../engine/cards'
import type { HanafudaCard, Yaku } from '../engine/types'

export const AI_PLAYER_INDEX = 1
export const AI_THINK_DELAY_MS = 500
export const SYSTEM_STEP_DELAY_MS = 0

export type TurnIntent = 'play' | 'select-hand-match' | 'select-draw-match' | 'none'

export const AKATAN_IDS = ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'] as const
export const AOTAN_IDS = ['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'] as const
export const HANAMI_IDS = ['mar-hikari', 'sep-tane'] as const
export const TSUKIMI_IDS = ['aug-hikari', 'sep-tane'] as const
export const INOSHIKACHO_IDS = ['jun-tane', 'jul-tane', 'oct-tane'] as const
export const AKATAN_SET = new Set<string>(AKATAN_IDS)
export const AOTAN_SET = new Set<string>(AOTAN_IDS)
export const HANAMI_SET = new Set<string>(HANAMI_IDS)
export const TSUKIMI_SET = new Set<string>(TSUKIMI_IDS)
export const INOSHIKACHO_SET = new Set<string>(INOSHIKACHO_IDS)
const HIKARI_IDS = ['jan-hikari', 'mar-hikari', 'aug-hikari', 'nov-hikari', 'dec-hikari'] as const
const NON_RAIN_HIKARI_IDS = ['jan-hikari', 'mar-hikari', 'aug-hikari', 'dec-hikari'] as const
const TANE_CARD_IDS = getCardsByType('tane').map((card) => card.id)
const TANZAKU_CARD_IDS = getCardsByType('tanzaku').map((card) => card.id)
const KASU_CARD_IDS = getCardsByType('kasu').map((card) => card.id)
const MONTH_CARD_ID_GROUPS: readonly (readonly string[])[] = (() => {
  const byMonth = new Map<number, string[]>()
  for (const card of HANAFUDA_CARDS) {
    const monthCardIds = byMonth.get(card.month)
    if (monthCardIds) {
      monthCardIds.push(card.id)
      continue
    }
    byMonth.set(card.month, [card.id])
  }
  return [...byMonth.values()]
})()
const EMPTY_BLOCKED_CARD_IDS: ReadonlySet<string> = new Set()

export function getTurnIntent(phase: KoiKoiGameState['phase']): TurnIntent {
  if (phase === 'selectHandCard') return 'play'
  if (phase === 'selectFieldMatch') return 'select-hand-match'
  if (phase === 'selectDrawMatch') return 'select-draw-match'
  return 'none'
}

export function formatYaku(yaku: readonly Yaku[]): string {
  if (yaku.length === 0) {
    return 'なし'
  }
  return yaku.map((item) => `${item.name} (${item.points}点)`).join(' / ')
}

export function flattenNewYakuCards(yaku: readonly Yaku[]): HanafudaCard[] {
  const unique = new Map<string, HanafudaCard>()
  for (const item of yaku) {
    for (const card of item.cards) {
      if (!unique.has(card.id)) {
        unique.set(card.id, card)
      }
    }
  }
  return [...unique.values()].slice(0, 6)
}

export function countMatched(capturedIds: ReadonlySet<string>, ids: readonly string[]): number {
  return ids.reduce((acc, id) => acc + (capturedIds.has(id) ? 1 : 0), 0)
}

export function filterCapturedByIds(captured: readonly HanafudaCard[], ids: ReadonlySet<string>): HanafudaCard[] {
  return captured.filter((card) => ids.has(card.id))
}

function countPotentialMatches(
  ids: readonly string[],
  capturedIds: ReadonlySet<string>,
  blockedCardIds: ReadonlySet<string>,
): number {
  return ids.reduce((acc, id) => acc + (capturedIds.has(id) || !blockedCardIds.has(id) ? 1 : 0), 0)
}

function canReachByIds(
  ids: readonly string[],
  target: number,
  capturedIds: ReadonlySet<string>,
  blockedCardIds: ReadonlySet<string>,
): boolean {
  return countPotentialMatches(ids, capturedIds, blockedCardIds) >= target
}

function getBestFourCardsMonthProgress(captured: readonly HanafudaCard[]): readonly HanafudaCard[] {
  const byMonth = new Map<number, HanafudaCard[]>()
  for (const card of captured) {
    const monthCards = byMonth.get(card.month)
    if (monthCards) {
      monthCards.push(card)
      continue
    }
    byMonth.set(card.month, [card])
  }

  let bestMonth = Number.POSITIVE_INFINITY
  let bestCards: readonly HanafudaCard[] = []
  for (const [month, monthCards] of byMonth.entries()) {
    if (monthCards.length > bestCards.length || (monthCards.length === bestCards.length && month < bestMonth)) {
      bestMonth = month
      bestCards = monthCards
    }
  }
  return bestCards
}

function canReachFourCardsYaku(capturedIds: ReadonlySet<string>, blockedCardIds: ReadonlySet<string>): boolean {
  return MONTH_CARD_ID_GROUPS.some((ids) => canReachByIds(ids, 4, capturedIds, blockedCardIds))
}

export type YakuProgressKey =
  | 'goko'
  | 'shiko'
  | 'ame-shiko'
  | 'sanko'
  | 'shiten'
  | 'hanami-zake'
  | 'tsukimi-zake'
  | 'inoshikacho'
  | 'tane'
  | 'akatan'
  | 'aotan'
  | 'tanzaku'
  | 'kasu'

export interface YakuProgressState {
  readonly key: YakuProgressKey
  readonly label: string
  readonly current: number
  readonly target: number
  readonly cards: readonly HanafudaCard[]
  readonly done: boolean
}

export interface VisibleYakuSubProgressState {
  readonly key: YakuProgressKey
  readonly label: string
  readonly current: number
  readonly target: number
  readonly done: boolean
}

export interface VisibleYakuProgressState extends YakuProgressState {
  readonly subEntries?: readonly VisibleYakuSubProgressState[]
}

export interface YakuProgressRuleOptions {
  readonly enableHanamiZake?: boolean
  readonly enableTsukimiZake?: boolean
  readonly enableFourCardsYaku?: boolean
  readonly enableAmeNagare?: boolean
  readonly enableKiriNagare?: boolean
}

export function buildYakuProgressEntries(
  captured: readonly HanafudaCard[],
  yaku: readonly Yaku[],
  blockedCardIds: ReadonlySet<string> = EMPTY_BLOCKED_CARD_IDS,
  ruleOptions: YakuProgressRuleOptions = {},
): readonly YakuProgressState[] {
  const enableHanamiZake = ruleOptions.enableHanamiZake ?? true
  const enableTsukimiZake = ruleOptions.enableTsukimiZake ?? true
  const enableFourCardsYaku = ruleOptions.enableFourCardsYaku ?? false
  const enableAmeNagare = ruleOptions.enableAmeNagare ?? false
  const enableKiriNagare = ruleOptions.enableKiriNagare ?? false
  const completedTypes = new Set(yaku.map((item) => item.type))
  const capturedIds = new Set(captured.map((card) => card.id))
  const hasRainFlowBlock = capturedIds.has('nov-hikari')
  const hasKiriFlowBlock = captured.some((card) => card.month === 12)
  const isSakeBlocked = (enableAmeNagare && hasRainFlowBlock) || (enableKiriNagare && hasKiriFlowBlock)
  const hanamiBlockedByAme = enableHanamiZake && isSakeBlocked
  const tsukimiBlockedByKiri = enableTsukimiZake && isSakeBlocked
  const hasRainMan = capturedIds.has('nov-hikari')
  const gokoDone = completedTypes.has('goko')
  const shikoDone = completedTypes.has('shiko') || gokoDone
  const ameShikoDone = completedTypes.has('ame-shiko') || (gokoDone && hasRainMan)
  const shitenDone = enableFourCardsYaku && completedTypes.has('shiten')
  const sankoDone =
    completedTypes.has('sanko') ||
    shikoDone ||
    ameShikoDone ||
    gokoDone

  const hikariCards = captured.filter((card) => card.type === 'hikari')
  const nonRainHikariCards = hikariCards.filter((card) => card.id !== 'nov-hikari')
  const taneCards = captured.filter((card) => card.type === 'tane')
  const tanzakuCards = captured.filter((card) => card.type === 'tanzaku')
  const kasuCards = captured.filter((card) => card.type === 'kasu')
  const akatanCards = filterCapturedByIds(captured, AKATAN_SET)
  const aotanCards = filterCapturedByIds(captured, AOTAN_SET)
  const hanamiCards = filterCapturedByIds(captured, HANAMI_SET)
  const tsukimiCards = filterCapturedByIds(captured, TSUKIMI_SET)
  const inoshikachoCards = filterCapturedByIds(captured, INOSHIKACHO_SET)

  const sankoProgressCount = hasRainMan && !sankoDone ? nonRainHikariCards.length : hikariCards.length
  const sankoProgressCards = hasRainMan && !sankoDone ? nonRainHikariCards : hikariCards
  const showUpperLightProgress = sankoDone || sankoProgressCount >= 3
  const gokoProgressCount = showUpperLightProgress ? hikariCards.length : 0
  const shikoProgressCount = showUpperLightProgress ? hikariCards.length : 0
  const gokoProgressCards = showUpperLightProgress ? hikariCards : []
  const shikoProgressCards = showUpperLightProgress ? hikariCards : []
  const ameShikoProgressCount = hikariCards.length
  const shitenProgressCards = getBestFourCardsMonthProgress(captured)
  const shitenProgressCount = shitenProgressCards.length
  const akatanCount = countMatched(capturedIds, AKATAN_IDS)
  const aotanCount = countMatched(capturedIds, AOTAN_IDS)
  const hanamiCount = countMatched(capturedIds, HANAMI_IDS)
  const tsukimiCount = countMatched(capturedIds, TSUKIMI_IDS)
  const inoshikachoCount = countMatched(capturedIds, INOSHIKACHO_IDS)
  const canReachGoko = canReachByIds(HIKARI_IDS, 5, capturedIds, blockedCardIds)
  const canReachShiko = canReachByIds(NON_RAIN_HIKARI_IDS, 4, capturedIds, blockedCardIds)
  const canReachAmeShiko =
    (capturedIds.has('nov-hikari') || !blockedCardIds.has('nov-hikari')) &&
    canReachByIds(HIKARI_IDS, 4, capturedIds, blockedCardIds)
  const canReachSanko = canReachByIds(NON_RAIN_HIKARI_IDS, 3, capturedIds, blockedCardIds)
  const canReachShiten = enableFourCardsYaku && canReachFourCardsYaku(capturedIds, blockedCardIds)
  const canReachHanami = enableHanamiZake && !hanamiBlockedByAme && canReachByIds(HANAMI_IDS, 2, capturedIds, blockedCardIds)
  const canReachTsukimi = enableTsukimiZake && !tsukimiBlockedByKiri && canReachByIds(TSUKIMI_IDS, 2, capturedIds, blockedCardIds)
  const canReachInoshikacho = canReachByIds(INOSHIKACHO_IDS, 3, capturedIds, blockedCardIds)
  const canReachTane = canReachByIds(TANE_CARD_IDS, 5, capturedIds, blockedCardIds)
  const canReachAkatan = canReachByIds(AKATAN_IDS, 3, capturedIds, blockedCardIds)
  const canReachAotan = canReachByIds(AOTAN_IDS, 3, capturedIds, blockedCardIds)
  const canReachTanzaku = canReachByIds(TANZAKU_CARD_IDS, 5, capturedIds, blockedCardIds)
  const canReachKasu = canReachByIds(KASU_CARD_IDS, 10, capturedIds, blockedCardIds)

  const showGoko = gokoDone || canReachGoko
  const showShiko = shikoDone || canReachShiko
  const showAmeShiko = ameShikoDone || canReachAmeShiko
  const showSanko = sankoDone || canReachSanko
  const showShiten = enableFourCardsYaku && (shitenDone || canReachShiten)
  const showHanami = enableHanamiZake && !hanamiBlockedByAme && (completedTypes.has('hanami-zake') || canReachHanami)
  const showTsukimi = enableTsukimiZake && !tsukimiBlockedByKiri && (completedTypes.has('tsukimi-zake') || canReachTsukimi)
  const showInoshikacho = completedTypes.has('inoshikacho') || canReachInoshikacho
  const showTane = completedTypes.has('tane') || canReachTane
  const showAkatan = completedTypes.has('akatan') || canReachAkatan
  const showAotan = completedTypes.has('aotan') || canReachAotan
  const showTanzaku = completedTypes.has('tanzaku') || canReachTanzaku
  const showKasu = completedTypes.has('kasu') || canReachKasu

  return [
    {
      key: 'goko',
      label: '五光',
      current: showGoko ? gokoProgressCount : 0,
      target: 5,
      cards: showGoko ? gokoProgressCards : [],
      done: gokoDone,
    },
    {
      key: 'shiko',
      label: '四光',
      current: showShiko ? shikoProgressCount : 0,
      target: 4,
      cards: showShiko ? shikoProgressCards : [],
      done: shikoDone,
    },
    {
      key: 'ame-shiko',
      label: '雨入り四光',
      current: showAmeShiko ? ameShikoProgressCount : 0,
      target: 4,
      cards: showAmeShiko ? hikariCards : [],
      done: ameShikoDone,
    },
    {
      key: 'sanko',
      label: '三光',
      current: showSanko ? sankoProgressCount : 0,
      target: 3,
      cards: showSanko ? sankoProgressCards : [],
      done: sankoDone,
    },
    ...(enableFourCardsYaku ? [
      {
        key: 'shiten' as const,
        label: '四点役',
        current: showShiten ? shitenProgressCount : 0,
        target: 4,
        cards: showShiten ? shitenProgressCards : [],
        done: shitenDone,
      },
    ] : []),
    {
      key: 'hanami-zake',
      label: '花見で一杯',
      current: showHanami ? hanamiCount : 0,
      target: 2,
      cards: showHanami ? hanamiCards : [],
      done: enableHanamiZake && !hanamiBlockedByAme && completedTypes.has('hanami-zake'),
    },
    {
      key: 'tsukimi-zake',
      label: '月見で一杯',
      current: showTsukimi ? tsukimiCount : 0,
      target: 2,
      cards: showTsukimi ? tsukimiCards : [],
      done: enableTsukimiZake && !tsukimiBlockedByKiri && completedTypes.has('tsukimi-zake'),
    },
    {
      key: 'inoshikacho',
      label: '猪鹿蝶',
      current: showInoshikacho ? inoshikachoCount : 0,
      target: 3,
      cards: showInoshikacho ? inoshikachoCards : [],
      done: completedTypes.has('inoshikacho'),
    },
    {
      key: 'tane',
      label: 'タネ5',
      current: showTane ? taneCards.length : 0,
      target: 5,
      cards: showTane ? taneCards : [],
      done: completedTypes.has('tane'),
    },
    {
      key: 'akatan',
      label: '赤タン',
      current: showAkatan ? akatanCount : 0,
      target: 3,
      cards: showAkatan ? akatanCards : [],
      done: completedTypes.has('akatan'),
    },
    {
      key: 'aotan',
      label: '青タン',
      current: showAotan ? aotanCount : 0,
      target: 3,
      cards: showAotan ? aotanCards : [],
      done: completedTypes.has('aotan'),
    },
    {
      key: 'tanzaku',
      label: 'タン5',
      current: showTanzaku ? tanzakuCards.length : 0,
      target: 5,
      cards: showTanzaku ? tanzakuCards : [],
      done: completedTypes.has('tanzaku'),
    },
    {
      key: 'kasu',
      label: 'カス10',
      current: showKasu ? kasuCards.length : 0,
      target: 10,
      cards: showKasu ? kasuCards : [],
      done: completedTypes.has('kasu'),
    },
  ]
}

function hasCardOverlap(a: readonly HanafudaCard[], b: readonly HanafudaCard[]): boolean {
  const idSet = new Set(a.map((card) => card.id))
  return b.some((card) => idSet.has(card.id))
}

export function buildVisibleYakuProgressEntries(
  progressEntries: readonly YakuProgressState[],
  options?: {
    includeDoneCards?: boolean
  },
): readonly VisibleYakuProgressState[] {
  const includeDoneCards = options?.includeDoneCards ?? false
  const displayEntries = progressEntries.filter((entry) => entry.current > 0)
  const indexByKey = new Map(progressEntries.map((entry, index) => [entry.key, index]))
  const byKey = new Map(displayEntries.map((entry) => [entry.key, entry]))
  const consumed = new Set<YakuProgressKey>()
  const visible: VisibleYakuProgressState[] = []

  const mergeRules: readonly (readonly [YakuProgressKey, readonly YakuProgressKey[]])[] = [
    ['tane', ['inoshikacho', 'hanami-zake', 'tsukimi-zake']],
    ['tanzaku', ['akatan', 'aotan']],
  ] as const
  const lightRowKeys: readonly YakuProgressKey[] = ['goko', 'shiko', 'ame-shiko', 'sanko']
  const lightPriorityChildKeys: readonly YakuProgressKey[] = ['tsukimi-zake', 'hanami-zake']

  const lightParent = lightRowKeys
    .map((key) => byKey.get(key))
    .find((entry) => entry && !consumed.has(entry.key))
  if (lightParent) {
    const children: YakuProgressState[] = []
    for (const key of lightRowKeys) {
      if (key === lightParent.key) {
        continue
      }
      const child = byKey.get(key)
      if (!child || consumed.has(child.key)) {
        continue
      }
      if (!hasCardOverlap(lightParent.cards, child.cards)) {
        continue
      }
      children.push(child)
    }
    const hasVisibleSankoLine =
      lightParent.key === 'sanko' ||
      children.some((entry) => entry.key === 'sanko')
    if (hasVisibleSankoLine) {
      for (const childKey of lightPriorityChildKeys) {
        const child = byKey.get(childKey)
        if (!child || consumed.has(child.key) || children.some((entry) => entry.key === child.key)) {
          continue
        }
        if (!hasCardOverlap(lightParent.cards, child.cards)) {
          continue
        }
        children.push(child)
      }
    }
    visible.push({
      ...lightParent,
      cards: lightParent.done && !includeDoneCards ? [] : lightParent.cards,
      subEntries: children.length > 0
        ? children.map((entry) => ({
          key: entry.key,
          label: entry.label,
          current: entry.current,
          target: entry.target,
          done: entry.done,
        }))
        : undefined,
    })
    consumed.add(lightParent.key)
    children.forEach((entry) => consumed.add(entry.key))
  }

  for (const [parentKey, childKeys] of mergeRules) {
    const parent = byKey.get(parentKey)
    if (!parent || consumed.has(parent.key)) {
      continue
    }
    const children: YakuProgressState[] = []
    for (const childKey of childKeys) {
      const child = byKey.get(childKey)
      if (!child || consumed.has(child.key)) {
        continue
      }
      if (!hasCardOverlap(parent.cards, child.cards)) {
        continue
      }
      children.push(child)
    }
    const row: VisibleYakuProgressState = {
      ...parent,
      cards: parent.done && !includeDoneCards ? [] : parent.cards,
      subEntries: children.length > 0
        ? children.map((entry) => ({
          key: entry.key,
          label: entry.label,
          current: entry.current,
          target: entry.target,
          done: entry.done,
        }))
        : undefined,
    }
    visible.push(row)
    consumed.add(parent.key)
    children.forEach((entry) => consumed.add(entry.key))
  }

  for (const entry of displayEntries) {
    if (consumed.has(entry.key)) {
      continue
    }
    visible.push(entry.done && !includeDoneCards ? { ...entry, cards: [] as readonly HanafudaCard[] } : entry)
  }

  const sorted = visible.sort((a, b) => {
    const ia = indexByKey.get(a.key) ?? 999
    const ib = indexByKey.get(b.key) ?? 999
    return ia - ib
  })
  const usedCardIds = new Set<string>()
  return sorted.map((entry) => {
    if (entry.cards.length === 0) {
      return entry
    }
    const uniqueCards = entry.cards.filter((card) => {
      if (usedCardIds.has(card.id)) {
        return false
      }
      usedCardIds.add(card.id)
      return true
    })
    if (uniqueCards.length === entry.cards.length) {
      return entry
    }
    return { ...entry, cards: uniqueCards }
  })
}

export function getPhaseMessage(game: KoiKoiGameState, isAiTurn: boolean): string {
  switch (game.phase) {
    case 'selectHandCard':
      return isAiTurn ? 'COMが手札を選択中' : 'あなたの番: 手札を1枚選択'
    case 'selectFieldMatch':
      return isAiTurn ? 'COMが場札の取り先を選択中' : '同じ月の場札を1枚選択'
    case 'drawingDeck':
      return '山札から引いています'
    case 'drawReveal':
      return '山札の札をめくっています'
    case 'selectDrawMatch':
      return isAiTurn ? 'COMが引き札の取り先を選択中' : '引いた札の取り先を選択'
    case 'checkYaku':
      return '役を判定しています'
    case 'koikoiDecision':
      return isAiTurn ? 'COMがこいこい判断中' : 'こいこい or 上がりを選択'
    case 'roundEnd':
      return game.roundWinner
        ? `${game.roundWinner === 'player1' ? 'あなた' : 'COM'}が ${game.roundPoints}点 獲得`
        : 'この月は引き分け'
    case 'gameOver':
      return game.winner
        ? `対局終了: ${game.winner === 'player1' ? 'あなた' : 'COM'}の勝利`
        : '対局終了: 引き分け'
    default:
      return '対局中'
  }
}

export function stableTilt(seed: string): number {
  let hash = 17
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) % 131
  }
  return (hash % 9) - 4
}

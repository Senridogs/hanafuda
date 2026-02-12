import { AnimatePresence, motion, type MotionStyle } from 'framer-motion'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import {
  clearCpuCheckpoint,
  loadCpuCheckpoint,
  loadLocalRuleSettings,
  loadPreferredRoundCount,
  loadSessionMeta,
  resetLocalRuleSettings,
  saveLocalRuleSettings,
  savePreferredRoundCount,
  saveCpuCheckpoint,
} from './net/persistence'
import './App.css'
import { chooseAiHandCard, chooseAiKoiKoi, chooseAiMatch } from './engine/ai'
import {
  CARD_ART_CREDIT_TEXT,
  CARD_ART_LICENSE_TEXT,
  CARD_ART_LICENSE_URL,
  CARD_ART_MODIFICATION_TEXT,
  CARD_ART_SOURCE_URL,
  getCardImageUrl,
} from './engine/cardArt'
import { HANAFUDA_CARDS } from './engine/cards'
import {
  checkTurn,
  commitDrawToField,
  createNewGame,
  drawStep,
  getMatchingFieldCards,
  playHandCard,
  resolveKoiKoi,
  selectDrawMatch,
  selectHandMatch,
  cancelHandSelection,
  startNextRound,
  type KoiKoiGameState,
  type RoundScoreEntry,
} from './engine/game'
import {
  DEFAULT_CONFIG,
  DEFAULT_LOCAL_RULE_SETTINGS,
  normalizeGameConfig,
  normalizeLocalRuleSettings,
  type HanafudaCard,
  type LocalRuleSettings,
  type Yaku,
  type YakuType,
} from './engine/types'
import { calculateYaku, getYakuTotalPoints } from './engine/yaku'
import { MultiplayerLobby } from './components/MultiplayerLobby'
import { LocalRulePanel } from './components/LocalRulePanel'
import {
  AI_THINK_DELAY_MS,
  SYSTEM_STEP_DELAY_MS,
  buildYakuProgressEntries,
  buildVisibleYakuProgressEntries,
  flattenNewYakuCards,
  getPhaseMessage,
  getTurnIntent,
  stableTilt,
  type TurnIntent,
  type VisibleYakuProgressState,
} from './ui/gameUi'
import { useMultiplayerGame } from './hooks/useMultiplayerGame'
import type { TurnCommand } from './net/protocol'

type CardMoveEffect = {
  id: number
  batchId?: number
  card: HanafudaCard
  fromX: number
  fromY: number
  toX: number
  toY: number
  width: number
  height: number
  viaX?: number
  viaY?: number
  viaWidth?: number
  viaHeight?: number
  via2X?: number
  via2Y?: number
  via2Width?: number
  via2Height?: number
  duration?: number
  toWidth?: number
  toHeight?: number
  rotateStart?: number
  rotateEnd?: number
  zIndex?: number
  hideFieldCardId?: string
  flipFromBack?: boolean
  flipHoldRatio?: number
  flipOnArrival?: boolean
  freezeBeforeMerge?: boolean
  addToFieldHistoryLength?: number
  fromDeck?: boolean
}

type TurnDecisionCallout = {
  id: number
  kind: 'koikoi' | 'stop'
  text: string
  durationMs: number
}

type HandDragState = {
  pointerId: number
  cardId: string
  startX: number
  startY: number
  currentX: number
  currentY: number
  startTime: number
}

type RuleHelpYakuEntry = {
  key: string
  name: string
  condition: string
  points: string
  exampleCardIds?: readonly string[]
}

type RuleHelpPage = {
  key: string
  title: string
  subtitle: string
  content: ReactNode
}

const CPU_HAND_REVEAL_HOLD_RATIO = 0.52
const COMMAND_SEED_RANGE = 0x1_0000_0000
const HAND_LAYOUT_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const HAND_LAYOUT_TRANSITION = { layout: { duration: 0.82, ease: HAND_LAYOUT_EASE } }
const CARD_MOVE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const CARD_HEIGHT_PER_WIDTH = 839 / 512
const CAPTURE_STACK_CARD_WIDTH = 34
const CAPTURE_STACK_OVERLAP_BASE = 0.62
const STAGED_CAPTURE_DURATION = 2.56
const STAGED_CAPTURE_STOP_TIME = 0.36
const STAGED_CAPTURE_FLIP_END_TIME = 0.56
const STAGED_CAPTURE_MERGE_TIME = 0.75
const STAGED_ADD_TO_FIELD_DURATION = 2
const ROUND_COUNT_OPTIONS = [3, 6, 12] as const
const DEFAULT_ROUND_COUNT = 3 as const
const MOBILE_BREAKPOINT_QUERY = '(max-width: 720px)'
const FLICK_MIN_DISTANCE_PX = 38
const FLICK_MIN_SPEED_PX_PER_MS = 0.28
const FLICK_MIN_UPWARD_DELTA_PX = -10
const TAP_MAX_DISTANCE_PX = 10
const TAP_MAX_DURATION_MS = 300
const FIELD_EMPTY_SLOT_TARGET_ID = '__field-empty-slot__'
const EXPANDED_SELECTION_CANCEL_PULSE_MS = 120
const AI_KOIKOI_DECISION_DELAY_MS = 0
const AI_DIFFICULTY_LABELS: Record<string, string> = {
  yowai: 'よわい',
  futsuu: 'ふつう',
  tsuyoi: 'つよい',
  yabai: 'やばい',
  oni: 'おに',
  kami: 'かみ',
}
const YAKU_DROP_TIME_SCALE = 2
const YAKU_DROP_CARD_STAGGER_SECONDS = 0.24 * YAKU_DROP_TIME_SCALE
const YAKU_DROP_CARD_DURATION_SECONDS = 0.72 * YAKU_DROP_TIME_SCALE
const YAKU_DROP_NAME_DURATION_SECONDS = 0.36 * YAKU_DROP_TIME_SCALE
const YAKU_DROP_HOLD_MS = 360
const TURN_DECISION_EFFECT_DURATION_MS = 2400
const OPPONENT_KOIKOI_EFFECT_DURATION_MS = TURN_DECISION_EFFECT_DURATION_MS * 2
const TURN_BANNER_AFTER_KOIKOI_DELAY_MS = TURN_DECISION_EFFECT_DURATION_MS + 140
const PC_YAKU_LIGHT_KEYS = new Set(['goko', 'shiko', 'ame-shiko', 'sanko'])
const PC_YAKU_TANE_KEYS = new Set(['tane', 'inoshikacho', 'hanami-zake', 'tsukimi-zake'])
const PC_YAKU_TAN_KEYS = new Set(['tanzaku', 'akatan', 'aotan'])
const TURN_DECISION_SPARK_INDICES = [0, 1, 2, 3, 4, 5, 6, 7] as const
const RULE_HELP_SWIPE_THRESHOLD_PX = 38
const RULE_HELP_CARD_TYPE_LABELS: Readonly<Record<HanafudaCard['type'], string>> = {
  hikari: '光',
  tane: '種',
  tanzaku: '短冊',
  kasu: 'カス',
}
const RULE_HELP_MONTH_GROUPS = Array.from({ length: 12 }, (_, index) => {
  const month = (index + 1) as HanafudaCard['month']
  return {
    month,
    cards: HANAFUDA_CARDS.filter((card) => card.month === month),
  }
})
const RULE_HELP_HIGH_YAKU_ENTRIES: readonly RuleHelpYakuEntry[] = [
  {
    key: 'goko',
    name: '五光',
    condition: '光札を5枚集める',
    points: '10点',
    exampleCardIds: ['jan-hikari', 'mar-hikari', 'aug-hikari', 'nov-hikari', 'dec-hikari'],
  },
  {
    key: 'shiko',
    name: '四光',
    condition: '光札を4枚（雨札なし）',
    points: '8点',
    exampleCardIds: ['jan-hikari', 'mar-hikari', 'aug-hikari', 'dec-hikari'],
  },
  {
    key: 'ame-shiko',
    name: '雨四光',
    condition: '光札を4枚（柳に小野道風を含む）',
    points: '7点',
    exampleCardIds: ['jan-hikari', 'mar-hikari', 'aug-hikari', 'nov-hikari'],
  },
  {
    key: 'sanko',
    name: '三光',
    condition: '光札を3枚（雨札なし）',
    points: '5点',
    exampleCardIds: ['jan-hikari', 'mar-hikari', 'dec-hikari'],
  },
  {
    key: 'inoshikacho',
    name: '猪鹿蝶',
    condition: '牡丹に蝶・萩に猪・紅葉に鹿',
    points: '5点 + 追加種札で加点',
    exampleCardIds: ['jun-tane', 'jul-tane', 'oct-tane'],
  },
  {
    key: 'hanami-zake',
    name: '花見で一杯',
    condition: '桜に幕 + 菊に盃',
    points: '5点',
    exampleCardIds: ['mar-hikari', 'sep-tane'],
  },
  {
    key: 'tsukimi-zake',
    name: '月見で一杯',
    condition: '芒に月 + 菊に盃',
    points: '5点',
    exampleCardIds: ['aug-hikari', 'sep-tane'],
  },
  {
    key: 'akatan',
    name: '赤短',
    condition: '1/2/3月の赤短を3枚',
    points: '5点 + 追加短冊で加点',
    exampleCardIds: ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'],
  },
  {
    key: 'aotan',
    name: '青短',
    condition: '6/9/10月の青短を3枚',
    points: '5点 + 追加短冊で加点',
    exampleCardIds: ['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'],
  },
] as const
const RULE_HELP_COUNT_YAKU_ENTRIES: readonly RuleHelpYakuEntry[] = [
  {
    key: 'tane',
    name: 'たね',
    condition: '種札を5枚以上',
    points: '1点 + 追加種札で加点',
    exampleCardIds: ['feb-tane', 'apr-tane', 'may-tane', 'jun-tane', 'jul-tane'],
  },
  {
    key: 'tanzaku',
    name: 'たんざく',
    condition: '短冊札を5枚以上',
    points: '1点 + 追加短冊で加点',
    exampleCardIds: ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku', 'jun-tanzaku', 'sep-tanzaku'],
  },
  {
    key: 'kasu',
    name: 'かす',
    condition: 'カス札を10枚以上',
    points: '1点 + 追加カス札で加点',
    exampleCardIds: [
      'jan-kasu-1',
      'jan-kasu-2',
      'feb-kasu-1',
      'feb-kasu-2',
      'mar-kasu-1',
      'mar-kasu-2',
      'apr-kasu-1',
      'apr-kasu-2',
      'may-kasu-1',
      'may-kasu-2',
    ],
  },
] as const
const RULE_HELP_BASIC_YAKU_ENTRIES: readonly RuleHelpYakuEntry[] = [
  ...RULE_HELP_HIGH_YAKU_ENTRIES,
  ...RULE_HELP_COUNT_YAKU_ENTRIES,
]
const RULE_HELP_CARD_ID_MAP = new Map(HANAFUDA_CARDS.map((card) => [card.id, card] as const))
const LOCAL_RULE_YAKU_FIELDS: readonly {
  key: YakuType
  label: string
  condition: string
  exampleCardIds: readonly string[]
}[] = [
  {
    key: 'goko',
    label: '五光',
    condition: '光札を5枚',
    exampleCardIds: ['jan-hikari', 'mar-hikari', 'aug-hikari', 'nov-hikari', 'dec-hikari'],
  },
  {
    key: 'shiko',
    label: '四光',
    condition: '光札を4枚（雨札なし）',
    exampleCardIds: ['jan-hikari', 'mar-hikari', 'aug-hikari', 'dec-hikari'],
  },
  {
    key: 'ame-shiko',
    label: '雨四光',
    condition: '光札を4枚（柳に小野道風を含む）',
    exampleCardIds: ['jan-hikari', 'mar-hikari', 'aug-hikari', 'nov-hikari'],
  },
  {
    key: 'sanko',
    label: '三光',
    condition: '光札を3枚（雨札なし）',
    exampleCardIds: ['jan-hikari', 'mar-hikari', 'dec-hikari'],
  },
  {
    key: 'shiten',
    label: '四点役',
    condition: '同じ月の札4枚',
    exampleCardIds: ['jan-hikari', 'jan-tanzaku', 'jan-kasu-1', 'jan-kasu-2'],
  },
  {
    key: 'inoshikacho',
    label: '猪鹿蝶',
    condition: '牡丹に蝶・萩に猪・紅葉に鹿',
    exampleCardIds: ['jun-tane', 'jul-tane', 'oct-tane'],
  },
  {
    key: 'hanami-zake',
    label: '花見で一杯',
    condition: '桜に幕 + 菊に盃',
    exampleCardIds: ['mar-hikari', 'sep-tane'],
  },
  {
    key: 'tsukimi-zake',
    label: '月見で一杯',
    condition: '芒に月 + 菊に盃',
    exampleCardIds: ['aug-hikari', 'sep-tane'],
  },
  {
    key: 'akatan',
    label: '赤短',
    condition: '1/2/3月の赤短を3枚',
    exampleCardIds: ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku'],
  },
  {
    key: 'aotan',
    label: '青短',
    condition: '6/9/10月の青短を3枚',
    exampleCardIds: ['jun-tanzaku', 'sep-tanzaku', 'oct-tanzaku'],
  },
  {
    key: 'tane',
    label: 'たね',
    condition: '種札を5枚以上',
    exampleCardIds: ['feb-tane', 'apr-tane', 'may-tane', 'jun-tane', 'jul-tane'],
  },
  {
    key: 'tanzaku',
    label: 'たんざく',
    condition: '短冊札を5枚以上',
    exampleCardIds: ['jan-tanzaku', 'feb-tanzaku', 'mar-tanzaku', 'jun-tanzaku', 'sep-tanzaku'],
  },
  {
    key: 'kasu',
    label: 'かす',
    condition: 'カス札を10枚以上',
    exampleCardIds: ['jan-kasu-1', 'jan-kasu-2', 'feb-kasu-1', 'feb-kasu-2', 'mar-kasu-1'],
  },
]

function isRoundCountOption(value: number): value is (typeof ROUND_COUNT_OPTIONS)[number] {
  return ROUND_COUNT_OPTIONS.includes(value as (typeof ROUND_COUNT_OPTIONS)[number])
}

function getInitialRoundCount(): (typeof ROUND_COUNT_OPTIONS)[number] {
  const saved = loadPreferredRoundCount()
  return saved && isRoundCountOption(saved) ? saved : DEFAULT_ROUND_COUNT
}

function getInitialLocalRules(): LocalRuleSettings {
  return normalizeLocalRuleSettings(loadLocalRuleSettings() ?? DEFAULT_LOCAL_RULE_SETTINGS)
}

function areLocalRulesEqual(a: LocalRuleSettings, b: LocalRuleSettings): boolean {
  if (
    a.koiKoiBonusMode !== b.koiKoiBonusMode ||
    a.enableKoiKoiShowdown !== b.enableKoiKoiShowdown ||
    a.selfKoiBonusFactor !== b.selfKoiBonusFactor ||
    a.opponentKoiBonusFactor !== b.opponentKoiBonusFactor ||
    a.drawOvertimeMode !== b.drawOvertimeMode ||
    a.enableHanamiZake !== b.enableHanamiZake ||
    a.enableTsukimiZake !== b.enableTsukimiZake ||
    a.noYakuPolicy !== b.noYakuPolicy ||
    a.noYakuParentPoints !== b.noYakuParentPoints ||
    a.noYakuChildPoints !== b.noYakuChildPoints ||
    a.enableFourCardsYaku !== b.enableFourCardsYaku ||
    a.enableAmeNagare !== b.enableAmeNagare ||
    a.enableKiriNagare !== b.enableKiriNagare ||
    a.koikoiLimit !== b.koikoiLimit ||
    a.dealerRotationMode !== b.dealerRotationMode ||
    a.enableDrawOvertime !== b.enableDrawOvertime ||
    a.drawOvertimeRounds !== b.drawOvertimeRounds
  ) {
    return false
  }
  return (
    a.yakuEnabled.goko === b.yakuEnabled.goko &&
    a.yakuEnabled.shiko === b.yakuEnabled.shiko &&
    a.yakuEnabled['ame-shiko'] === b.yakuEnabled['ame-shiko'] &&
    a.yakuEnabled.sanko === b.yakuEnabled.sanko &&
    a.yakuEnabled.shiten === b.yakuEnabled.shiten &&
    a.yakuEnabled.inoshikacho === b.yakuEnabled.inoshikacho &&
    a.yakuEnabled['hanami-zake'] === b.yakuEnabled['hanami-zake'] &&
    a.yakuEnabled['tsukimi-zake'] === b.yakuEnabled['tsukimi-zake'] &&
    a.yakuEnabled.akatan === b.yakuEnabled.akatan &&
    a.yakuEnabled.aotan === b.yakuEnabled.aotan &&
    a.yakuEnabled.tane === b.yakuEnabled.tane &&
    a.yakuEnabled.tanzaku === b.yakuEnabled.tanzaku &&
    a.yakuEnabled.kasu === b.yakuEnabled.kasu &&
    a.yakuPoints.goko === b.yakuPoints.goko &&
    a.yakuPoints.shiko === b.yakuPoints.shiko &&
    a.yakuPoints['ame-shiko'] === b.yakuPoints['ame-shiko'] &&
    a.yakuPoints.sanko === b.yakuPoints.sanko &&
    a.yakuPoints.shiten === b.yakuPoints.shiten &&
    a.yakuPoints.inoshikacho === b.yakuPoints.inoshikacho &&
    a.yakuPoints['hanami-zake'] === b.yakuPoints['hanami-zake'] &&
    a.yakuPoints['tsukimi-zake'] === b.yakuPoints['tsukimi-zake'] &&
    a.yakuPoints.akatan === b.yakuPoints.akatan &&
    a.yakuPoints.aotan === b.yakuPoints.aotan &&
    a.yakuPoints.tane === b.yakuPoints.tane &&
    a.yakuPoints.tanzaku === b.yakuPoints.tanzaku &&
    a.yakuPoints.kasu === b.yakuPoints.kasu
  )
}

function normalizeLoadedGameState(state: KoiKoiGameState): KoiKoiGameState {
  const config = normalizeGameConfig(state.config)
  const player1 = state.players[0]
  const player2 = state.players[1]
  const roundScoreHistory = Array.isArray((state as { readonly roundScoreHistory?: unknown }).roundScoreHistory)
    ? state.roundScoreHistory
    : []
  return {
    ...state,
    config,
    players: [
      {
        ...player1,
        completedYaku: calculateYaku(player1.captured, config.localRules),
      },
      {
        ...player2,
        completedYaku: calculateYaku(player2.captured, config.localRules),
      },
    ] as const,
    roundScoreHistory,
  }
}

function buildRuleHelpScoringNotes(localRules: LocalRuleSettings): readonly string[] {
  const notes: string[] = []
  switch (localRules.noYakuPolicy) {
    case 'both-zero':
      notes.push('役が1つもない場合は 0点 になります。')
      break
    case 'seat-points':
      notes.push(`役が1つもない場合は 親${localRules.noYakuParentPoints}点 / 子${localRules.noYakuChildPoints}点 です。`)
      break
  }

  if (localRules.koiKoiBonusMode === 'none') {
    notes.push('こいこい時の倍率処理は無効です。')
  } else if (localRules.koiKoiBonusMode === 'additive') {
    notes.push(
      `倍率方式は加算式です（7点以上: +1倍 / 自分こいこい: +${Math.max(0, localRules.selfKoiBonusFactor - 1)}倍/回 / 相手こいこい: +${Math.max(0, localRules.opponentKoiBonusFactor - 1)}倍/回）。`,
    )
  } else {
    notes.push(
      `倍率方式は乗算式です（7点以上: ×2 / 自分こいこい: ×${localRules.selfKoiBonusFactor}/回 / 相手こいこい: ×${localRules.opponentKoiBonusFactor}/回）。`,
    )
  }
  if (localRules.enableKoiKoiShowdown) {
    notes.push('こいこい合戦: 相手がこいこい済みでも、役成立時にこいこいを続行できます。')
  }

  if (localRules.enableKoiKoiShowdown && localRules.koikoiLimit > 0) {
    notes.push(`同一プレイヤーのこいこい回数は ${localRules.koikoiLimit} 回までです。`)
  }
  if (RULE_HELP_BASIC_YAKU_ENTRIES.some((entry) => !localRules.yakuEnabled[entry.key as YakuType])) {
    notes.push('ローカルルールで無効化した役は判定されません。')
  }
  if (localRules.yakuEnabled['hanami-zake'] && localRules.enableAmeNagare) {
    notes.push('雨流れ: 柳に小野道風を取ると花見で一杯は不成立になります。')
  }
  if (localRules.yakuEnabled['tsukimi-zake'] && localRules.enableKiriNagare) {
    notes.push('霧流れ: 桐札を取ると月見で一杯は不成立になります。')
  }
  return notes
}

function createCommandSeed(): number {
  return Math.floor(Math.random() * COMMAND_SEED_RANGE) >>> 0
}

function ensureDeterministicMultiplayerCommand(command: TurnCommand): TurnCommand {
  if (command.type === 'startNextRound') {
    return command.seed === undefined ? { ...command, seed: createCommandSeed() } : command
  }
  if (command.type === 'restartGame') {
    return command.seed === undefined ? { ...command, seed: createCommandSeed() } : command
  }
  return command
}

function getYakuDropRevealDurationMs(cardCount: number): number {
  const normalizedCardCount = Math.max(1, cardCount)
  const cardRevealSeconds =
    YAKU_DROP_CARD_DURATION_SECONDS + YAKU_DROP_CARD_STAGGER_SECONDS * (normalizedCardCount - 1)
  const revealSeconds = Math.max(YAKU_DROP_NAME_DURATION_SECONDS, cardRevealSeconds)
  return Math.round(revealSeconds * 1000) + YAKU_DROP_HOLD_MS
}

function getRuleHelpExampleCards(cardIds: readonly string[] | undefined): readonly HanafudaCard[] {
  if (!cardIds || cardIds.length === 0) {
    return []
  }
  return cardIds.flatMap((cardId) => {
    const card = RULE_HELP_CARD_ID_MAP.get(cardId)
    return card ? [card] : []
  })
}

function getPcYakuEntryRank(key: string): number {
  if (PC_YAKU_LIGHT_KEYS.has(key)) {
    return 0
  }
  if (PC_YAKU_TANE_KEYS.has(key)) {
    return 1
  }
  if (PC_YAKU_TAN_KEYS.has(key)) {
    return 2
  }
  if (key === 'kasu') {
    return 3
  }
  return 4
}

function filterInMatchYakuEntries(entries: readonly VisibleYakuProgressState[]): readonly VisibleYakuProgressState[] {
  return entries.filter((entry) => entry.key !== 'shiten')
}

function buildRoundPointBreakdownLines(game: KoiKoiGameState): readonly string[] {
  if (game.roundReason !== 'stop' || !game.roundWinner) {
    return []
  }

  const localRules = normalizeGameConfig(game.config).localRules
  const winnerIndex: 0 | 1 = game.roundWinner === 'player1' ? 0 : 1
  const winner = game.players[winnerIndex]
  const opponentIndex: 0 | 1 = winnerIndex === 0 ? 1 : 0
  const yaku = [...winner.completedYaku].sort((a, b) => b.points - a.points)
  const yakuTotal = getYakuTotalPoints(winner.completedYaku)
  const isParent = winnerIndex === game.roundStarterIndex
  const basePoints = yakuTotal > 0
    ? yakuTotal
    : localRules.noYakuPolicy === 'both-zero'
      ? 0
      : localRules.noYakuPolicy === 'seat-points'
        ? isParent
          ? localRules.noYakuParentPoints
          : localRules.noYakuChildPoints
        : 0
  const baseLine = yakuTotal > 0
    ? `役合計: ${basePoints}点`
    : localRules.noYakuPolicy === 'both-zero'
      ? '役なし: 双方0点ルールで 0点'
      : localRules.noYakuPolicy === 'seat-points'
        ? `役なし: ${isParent ? `親${localRules.noYakuParentPoints}` : `子${localRules.noYakuChildPoints}`}点`
        : '役なし: 双方0点ルールで 0点'
  const hasHighPointBonus = basePoints >= 7
  const selfKoiCount = game.koikoiCounts[winnerIndex]
  const opponentKoiCount = game.koikoiCounts[opponentIndex]
  const hasSelfKoiBonus = selfKoiCount > 0
  const hasOpponentKoiBonus = opponentKoiCount > 0
  const selfAdditiveBonus = Math.max(0, localRules.selfKoiBonusFactor - 1)
  const opponentAdditiveBonus = Math.max(0, localRules.opponentKoiBonusFactor - 1)
  const expectedMultiplier =
    basePoints <= 0 || localRules.koiKoiBonusMode === 'none'
      ? 1
      : localRules.koiKoiBonusMode === 'additive'
        ? 1
          + Number(hasHighPointBonus)
          + (hasSelfKoiBonus ? selfKoiCount * selfAdditiveBonus : 0)
          + (hasOpponentKoiBonus ? opponentKoiCount * opponentAdditiveBonus : 0)
        : (hasHighPointBonus ? 2 : 1)
          * (hasSelfKoiBonus ? localRules.selfKoiBonusFactor ** selfKoiCount : 1)
          * (hasOpponentKoiBonus ? localRules.opponentKoiBonusFactor ** opponentKoiCount : 1)
  const expectedRoundPoints = basePoints * expectedMultiplier

  const lines: string[] = yaku.length > 0
    ? yaku.map((item) => `${item.name}: ${item.points}点`)
    : ['役なし']
  lines.push(baseLine)

  if (localRules.koiKoiBonusMode === 'none' || basePoints <= 0) {
    lines.push(`最終得点: ${game.roundPoints}点`)
    return lines
  }

  if (hasHighPointBonus) {
    lines.push(localRules.koiKoiBonusMode === 'additive' ? '7点以上ボーナス: +1倍' : '7点以上ボーナス: ×2')
  }
  if (hasSelfKoiBonus) {
    lines.push(
      localRules.koiKoiBonusMode === 'additive'
        ? `自分こいこいボーナス: +${selfAdditiveBonus}倍 × ${selfKoiCount}回`
        : `自分こいこいボーナス: ×${localRules.selfKoiBonusFactor}^${selfKoiCount}`,
    )
  }
  if (hasOpponentKoiBonus) {
    lines.push(
      localRules.koiKoiBonusMode === 'additive'
        ? `相手こいこいボーナス: +${opponentAdditiveBonus}倍 × ${opponentKoiCount}回`
        : `相手こいこいボーナス: ×${localRules.opponentKoiBonusFactor}^${opponentKoiCount}`,
    )
  }

  const hasAnyBonus = hasHighPointBonus
    || (hasSelfKoiBonus && (
      localRules.koiKoiBonusMode === 'multiplicative'
      || selfAdditiveBonus > 0
    ))
    || (hasOpponentKoiBonus && (
      localRules.koiKoiBonusMode === 'multiplicative'
      || opponentAdditiveBonus > 0
    ))
  if (expectedRoundPoints === game.roundPoints && hasAnyBonus) {
    if (localRules.koiKoiBonusMode === 'additive') {
      lines.push(`最終得点: ${basePoints} × ${expectedMultiplier} = ${game.roundPoints}点`)
      return lines
    }
    const multiplierParts: string[] = []
    if (hasHighPointBonus) {
      multiplierParts.push('2')
    }
    if (hasSelfKoiBonus) {
      multiplierParts.push(`${localRules.selfKoiBonusFactor}^${selfKoiCount}`)
    }
    if (hasOpponentKoiBonus) {
      multiplierParts.push(`${localRules.opponentKoiBonusFactor}^${opponentKoiCount}`)
    }
    lines.push(`最終得点: ${basePoints} × ${multiplierParts.join(' × ')} = ${game.roundPoints}点`)
    return lines
  }

  lines.push(`最終得点: ${game.roundPoints}点`)
  return lines
}

function CardTile(props: {
  card: HanafudaCard
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove?: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerUp?: (event: PointerEvent<HTMLButtonElement>) => void
  onPointerCancel?: (event: PointerEvent<HTMLButtonElement>) => void
  selectable?: boolean
  clickable?: boolean
  highlighted?: boolean
  dimmed?: boolean
  hidden?: boolean
  compact?: boolean
  raised?: boolean
  tapPulse?: boolean
  tilt?: number
  dragX?: number
  dragY?: number
  dragging?: boolean
  className?: string
  style?: CSSProperties
  layout?: boolean
}) {
  const {
    card,
    onClick,
    onMouseEnter,
    onMouseLeave,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    selectable = false,
    clickable = selectable,
    highlighted = false,
    dimmed = false,
    hidden = false,
    compact = false,
    raised = false,
    tapPulse = false,
    tilt = 0,
    dragX = 0,
    dragY = 0,
    dragging = false,
    className: extraClassName = '',
    style: extraStyle,
    layout = false,
  } = props
  const layoutTransition = layout ? HAND_LAYOUT_TRANSITION : undefined
  const layoutMode = layout ? 'position' : false
  const tileStyle: MotionStyle = {
    rotate: tilt,
    x: dragX,
    y: raised ? -30 : dragY,
    zIndex: dragging ? 9 : raised ? 10 : undefined,
    ...(extraStyle as MotionStyle),
  }

  const className = [
    'card-tile',
    selectable ? 'selectable' : '',
    highlighted ? 'highlighted' : '',
    dimmed ? 'dimmed' : '',
    compact ? 'compact' : '',
    hidden ? 'hidden' : '',
    dragging ? 'dragging' : '',
    raised ? 'raised' : '',
    extraClassName,
  ]
    .filter(Boolean)
    .join(' ')

  if (hidden) {
    return (
      <motion.div
        className={className}
        style={tileStyle}
        data-card-id={card.id}
        layout={layoutMode}
        transition={layoutTransition}
      >
        <div className="card-back">
          <span>花札</span>
        </div>
      </motion.div>
    )
  }

  return (
    <motion.button
      type="button"
      className={className}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      disabled={!clickable}
      style={tileStyle}
      data-card-id={card.id}
      layout={layoutMode}
      animate={tapPulse ? { scale: [1, 0.95, 1] } : undefined}
      transition={
        tapPulse
          ? {
            ...(layoutTransition ?? {}),
            duration: EXPANDED_SELECTION_CANCEL_PULSE_MS / 1000,
            ease: HAND_LAYOUT_EASE,
          }
          : layoutTransition
      }
      whileHover={selectable ? { y: -8, scale: 1.02 } : undefined}
      whileTap={selectable && !raised ? { scale: 0.95, y: -4 } : undefined}
    >
      <img src={getCardImageUrl(card)} alt={`${card.month}月 ${card.name}`} loading="lazy" />
    </motion.button>
  )
}

function getStableCardRect(node: HTMLElement): DOMRect {
  const rect = node.getBoundingClientRect()
  const computed = window.getComputedStyle(node)
  const cssWidth = Number.parseFloat(computed.width)
  const cssHeight = Number.parseFloat(computed.height)
  const baseWidth = (Number.isFinite(cssWidth) && cssWidth > 0 ? cssWidth : node.offsetWidth) || rect.width
  const baseHeight = (Number.isFinite(cssHeight) && cssHeight > 0 ? cssHeight : node.offsetHeight) || rect.height
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  return new DOMRect(centerX - baseWidth / 2, centerY - baseHeight / 2, baseWidth, baseHeight)
}

function YakuProgressEntry(props: {
  entryKey: string
  label: string
  current: number
  target: number
  cards: readonly HanafudaCard[]
  done: boolean
  subEntries?: readonly {
    key: string
    label: string
    current: number
    target: number
    done: boolean
  }[]
}) {
  const { entryKey, label, current, target, cards, done, subEntries } = props
  const isKasuEntry = entryKey === 'kasu'
  const visibleSlots = cards.length > 0
    ? Array.from({ length: isKasuEntry ? cards.length : target }, (_, index) => cards[index] ?? null)
    : []

  return (
    <div className={`progress-entry ${isKasuEntry ? 'kasu-entry' : ''}`}>
      <div className="progress-entry-head">
        <span className={`matrix-target ${done ? 'done' : ''}`}>
          {label} {Math.min(current, target)}/{target}
        </span>
        {subEntries?.map((sub) => (
          <span key={sub.key} className={`matrix-target sub ${sub.done ? 'done' : ''}`}>
            {sub.label} {Math.min(sub.current, sub.target)}/{sub.target}
          </span>
        ))}
      </div>
      {cards.length > 0 ? (
        <div className={`progress-card-strip ${isKasuEntry ? 'kasu-stack' : ''}`}>
          {visibleSlots.map((card, index) =>
            card ? (
              <img
                key={`${label}-${card.id}-${index}`}
                src={getCardImageUrl(card)}
                alt={`${card.month}月 ${card.name}`}
                loading="lazy"
              />
            ) : (
              <span key={`${label}-slot-${index}`} className="progress-card-slot" aria-hidden="true" />
            ),
          )}
        </div>
      ) : null}
    </div>
  )
}

function RoleYakuPanel(props: {
  captureZoneId: 'player1' | 'player2'
  title: string
  score: number
  captured: readonly HanafudaCard[]
  yaku: readonly Yaku[]
  blockedCardIds: ReadonlySet<string>
  ruleOptions?: {
    enableHanamiZake?: boolean
    enableTsukimiZake?: boolean
    enableFourCardsYaku?: boolean
    enableAmeNagare?: boolean
    enableKiriNagare?: boolean
  }
  active: boolean
  side: 'left' | 'right'
}) {
  const { captureZoneId, title, score, captured, yaku, blockedCardIds, ruleOptions, active, side } = props
  const progressEntries = useMemo(
    () => buildYakuProgressEntries(captured, yaku, blockedCardIds, ruleOptions),
    [blockedCardIds, captured, ruleOptions, yaku],
  )
  const visibleProgressEntries = useMemo(
    () => filterInMatchYakuEntries(buildVisibleYakuProgressEntries(progressEntries, { includeDoneCards: true })),
    [progressEntries],
  )
  const pcOrderedProgressEntries = useMemo(
    () => visibleProgressEntries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => {
        const rankDiff = getPcYakuEntryRank(a.entry.key) - getPcYakuEntryRank(b.entry.key)
        if (rankDiff !== 0) {
          return rankDiff
        }
        return a.index - b.index
      })
      .map((item) => item.entry),
    [visibleProgressEntries],
  )

  return (
    <aside className={`yaku-panel ${side} detailed ${active ? 'active' : ''}`} data-capture-zone={captureZoneId}>
      <div className="panel-player-head">
        <h2 className="panel-player-name">{title}</h2>
        <span className="panel-mini-score">{score}点</span>
      </div>

      {pcOrderedProgressEntries.length > 0 ? (
        <section className="progress-matrix">
          {pcOrderedProgressEntries.map((entry) => (
            <YakuProgressEntry
              key={entry.key}
              entryKey={entry.key}
              label={entry.label}
              current={entry.current}
              target={entry.target}
              cards={entry.cards}
              done={entry.done}
              subEntries={entry.subEntries}
            />
          ))}
        </section>
      ) : null}
    </aside>
  )
}


function MobileYakuRow(props: {
  captured: readonly HanafudaCard[]
  visibleProgressEntries: readonly VisibleYakuProgressState[]
  title: string
  score: number
  active: boolean
  captureZoneId: 'player1' | 'player2'
}) {
  const { captured, visibleProgressEntries, title, score, active, captureZoneId } = props

  // カードタイプ別に分類
  const hikariCards = captured.filter((c) => c.type === 'hikari')
  const taneCards = captured.filter((c) => c.type === 'tane')
  const tanCards = captured.filter((c) => c.type === 'tanzaku')
  const kasuCards = captured.filter((c) => c.type === 'kasu')

  // 役をタイプ別に分類
  const hikariKeys = new Set(['goko', 'shiko', 'ame-shiko', 'sanko', 'hanami-zake', 'tsukimi-zake'])
  const taneKeys = new Set(['inoshikacho', 'tane'])
  const tanKeys = new Set(['akatan', 'aotan', 'tanzaku'])
  const kasuKeys = new Set(['kasu'])

  type MobileYakuEntry = {
    key: string
    label: string
    current: number
    target: number
    done: boolean
    sub: boolean
  }

  const expandEntries = (entries: readonly VisibleYakuProgressState[]) => entries.flatMap((entry) => ([
    {
      key: entry.key,
      label: entry.label,
      current: entry.current,
      target: entry.target,
      done: entry.done,
      sub: false,
    },
    ...(entry.subEntries ?? []).map((subEntry) => ({
      key: `${entry.key}:${subEntry.key}`,
      label: subEntry.label,
      current: subEntry.current,
      target: subEntry.target,
      done: subEntry.done,
      sub: true,
    })),
  ]))

  const hikariEntries = expandEntries(visibleProgressEntries.filter((e) => hikariKeys.has(e.key)))
  const taneEntries = expandEntries(visibleProgressEntries.filter((e) => taneKeys.has(e.key)))
  const tanEntries = expandEntries(visibleProgressEntries.filter((e) => tanKeys.has(e.key)))
  const kasuEntries = expandEntries(visibleProgressEntries.filter((e) => kasuKeys.has(e.key)))

  type MobileYakuGroup = {
    key: string
    cards: readonly HanafudaCard[]
    entries: readonly MobileYakuEntry[]
  }

  const renderRow = (
    groups: readonly MobileYakuGroup[],
  ) => (
    <div className="mobile-yaku-row">
      <div className="mobile-yaku-targets">
        {groups.map((group) => (
          <div key={group.key} className="mobile-yaku-target-group">
            <div className={`mobile-yaku-cards stack ${group.key === 'kasu' ? 'kasu' : ''}`}>
              {group.cards.slice(0, group.key === 'kasu' ? group.cards.length : 5).map((card) => (
                <img key={card.id} src={getCardImageUrl(card)} alt={card.name} className="mobile-yaku-card-icon" />
              ))}
            </div>
            <div className="mobile-yaku-target-list">
              {group.entries.slice(0, 6).map((entry) => (
                <span
                  key={entry.key}
                  className={`mobile-yaku-target ${entry.done ? 'done' : ''} ${entry.current > 0 ? 'active' : ''} ${entry.sub ? 'sub' : ''}`}
                >
                  <span className="mobile-yaku-target-label">{entry.label}</span>
                  <span className="mobile-yaku-target-count">{Math.min(entry.current, entry.target)}/{entry.target}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className={`mobile-yaku-section ${active ? 'active' : ''}`} data-capture-zone={captureZoneId}>
      <div className="mobile-yaku-header">
        <span className="mobile-mini-name">{title}</span>
        <span className="mobile-mini-score">{score}点</span>
      </div>
      {renderRow([{ key: 'hikari', cards: hikariCards, entries: hikariEntries }])}
      {renderRow([
        { key: 'tane', cards: taneCards, entries: taneEntries },
        { key: 'tan', cards: tanCards, entries: tanEntries },
      ])}
      {renderRow([{ key: 'kasu', cards: kasuCards, entries: kasuEntries }])}
    </div>
  )
}



function ScoreTable(props: {
  roundScoreHistory: readonly RoundScoreEntry[]
  player1Name: string
  player2Name: string
  player1TotalScore: number
  player2TotalScore: number
  currentRound: number
  maxRounds: number
  isMobileView: boolean
}) {
  const {
    roundScoreHistory,
    player1Name,
    player2Name,
    player1TotalScore,
    player2TotalScore,
    currentRound,
    maxRounds,
    isMobileView,
  } = props

  // 全ラウンド（完了分 + 未完了分）を表示
  const allRounds = Array.from({ length: maxRounds }, (_, i) => {
    const r = i + 1
    const entry = roundScoreHistory.find((e) => e.round === r)
    return {
      round: r,
      player1Points: entry?.player1Points ?? null,
      player2Points: entry?.player2Points ?? null,
      isCompleted: !!entry,
      isCurrent: r === currentRound && !entry,
    }
  })

  if (isMobileView) {
    return (
      <div className="score-table month-vertical">
        <table>
          <thead>
            <tr>
              <th className="score-table-header-month">月</th>
              <th>{player1Name}</th>
              <th>{player2Name}</th>
            </tr>
          </thead>
          <tbody>
            {allRounds.map((row) => (
              <tr key={row.round} className={row.isCurrent ? 'current-round' : ''}>
                <th scope="row" className="score-table-month">{row.round}月</th>
                <td className={row.player1Points !== null && row.player1Points > 0 ? 'won' : ''}>
                  {row.player1Points !== null ? `${row.player1Points}点` : '-'}
                </td>
                <td className={row.player2Points !== null && row.player2Points > 0 ? 'won' : ''}>
                  {row.player2Points !== null ? `${row.player2Points}点` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">合計</th>
              <td className={`score-table-total ${player1TotalScore > player2TotalScore ? 'leading' : ''}`}>
                {player1TotalScore}点
              </td>
              <td className={`score-table-total ${player2TotalScore > player1TotalScore ? 'leading' : ''}`}>
                {player2TotalScore}点
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    )
  }

  return (
    <div className="score-table month-horizontal">
      <table>
        <thead>
          <tr>
            <th className="score-table-header-player">対戦者</th>
            {allRounds.map((column) => (
              <th
                key={`month-head-${column.round}`}
                className={`score-table-month ${column.isCurrent ? 'current-round' : ''}`}
              >
                {column.round}月
              </th>
            ))}
            <th className="score-table-header-total">合計</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="score-table-player">{player1Name}</th>
            {allRounds.map((column) => (
              <td
                key={`player1-round-${column.round}`}
                className={[
                  column.player1Points !== null && column.player1Points > 0 ? 'won' : '',
                  column.isCurrent ? 'current-round' : '',
                ].filter(Boolean).join(' ')}
              >
                {column.player1Points !== null ? `${column.player1Points}点` : '-'}
              </td>
            ))}
            <td className={`score-table-total ${player1TotalScore > player2TotalScore ? 'leading' : ''}`}>
              {player1TotalScore}点
            </td>
          </tr>
          <tr>
            <th scope="row" className="score-table-player">{player2Name}</th>
            {allRounds.map((column) => (
              <td
                key={`player2-round-${column.round}`}
                className={[
                  column.player2Points !== null && column.player2Points > 0 ? 'won' : '',
                  column.isCurrent ? 'current-round' : '',
                ].filter(Boolean).join(' ')}
              >
                {column.player2Points !== null ? `${column.player2Points}点` : '-'}
              </td>
            ))}
            <td className={`score-table-total ${player2TotalScore > player1TotalScore ? 'leading' : ''}`}>
              {player2TotalScore}点
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function RuleHelpMonthPage(props: {
  startMonth: number
  endMonth: number
  compact?: boolean
}) {
  const { startMonth, endMonth, compact = false } = props
  const groups = RULE_HELP_MONTH_GROUPS.filter((group) => group.month >= startMonth && group.month <= endMonth)

  return (
    <div className={`rule-help-month-grid ${compact ? 'compact' : ''}`}>
      {groups.map((group) => (
        <section key={`month-${group.month}`} className="rule-help-month-section">
          <header className="rule-help-month-head">
            <h3>{group.month}月</h3>
            <p>{group.cards[0]?.flowerName ?? ''}</p>
          </header>
          <div className="rule-help-month-card-list">
            {group.cards.map((card) => (
              <div key={card.id} className="rule-help-month-card-item">
                <img src={getCardImageUrl(card)} alt={`${card.month}月 ${card.name}`} loading="lazy" />
                <span className={`rule-help-card-type ${card.type}`}>{RULE_HELP_CARD_TYPE_LABELS[card.type]}</span>
                <span className="rule-help-card-name">{card.name}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function RuleHelpYakuPage(props: {
  entries: readonly RuleHelpYakuEntry[]
  notes?: readonly string[]
}) {
  const { entries, notes } = props
  return (
    <div className="rule-help-yaku-layout">
      {entries.length > 0 ? (
        <div className="rule-help-yaku-list">
          {entries.map((entry) => {
            const exampleCards = getRuleHelpExampleCards(entry.exampleCardIds)
            const stackedExample = entry.key === 'kasu'
            return (
              <article key={entry.key} className="rule-help-yaku-item">
                <div className="rule-help-yaku-head">
                  <h3>{entry.name}</h3>
                  <span>{entry.points}</span>
                </div>
                <div className="rule-help-yaku-body">
                  {exampleCards.length > 0 ? (
                    <div
                      className={`rule-help-yaku-example${stackedExample ? ' stacked' : ''}`}
                      aria-label={`${entry.name}のカード例`}
                    >
                      {exampleCards.map((card) => (
                        <img
                          key={`${entry.key}-${card.id}`}
                          src={getCardImageUrl(card)}
                          alt={`${card.month}月 ${card.name}`}
                          loading="lazy"
                        />
                      ))}
                    </div>
                  ) : null}
                  <p className="rule-help-yaku-desc">{entry.condition}</p>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}
      {notes && notes.length > 0 ? (
        <ul className="rule-help-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function RoundOverlay(props: {
  title: string
  message: ReactNode
  messageLines?: readonly ReactNode[]
  details?: ReactNode
  primaryActionLabel: string
  onPrimaryAction: () => void
  primaryDisabled?: boolean
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
}) {
  const {
    title,
    message,
    messageLines,
    details,
    primaryActionLabel,
    onPrimaryAction,
    primaryDisabled = false,
    secondaryActionLabel,
    onSecondaryAction,
  } = props

  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>{title}</h2>
        <p>{message}</p>
        {details ? <div className="overlay-details">{details}</div> : null}
        {messageLines && messageLines.length > 0 ? (
          <ul className="overlay-message-list">
            {messageLines.map((line, index) => (
              <li key={`${index}-${String(line)}`}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="overlay-actions">
          <button type="button" className="primary" onClick={onPrimaryAction} disabled={primaryDisabled}>
            {primaryActionLabel}
          </button>
          {secondaryActionLabel && onSecondaryAction ? (
            <button type="button" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function YakuDropEffect(props: {
  cards: readonly HanafudaCard[]
  yaku: readonly Yaku[]
}) {
  const { cards, yaku } = props
  const cardStagger = YAKU_DROP_CARD_STAGGER_SECONDS
  const cardDuration = YAKU_DROP_CARD_DURATION_SECONDS
  const yakuNameDuration = YAKU_DROP_NAME_DURATION_SECONDS
  const yakuLabel = yaku.map((item) => item.name).join(' ・ ')

  return (
    <AnimatePresence>
      {cards.length > 0 ? (
        <motion.div className="yaku-drop-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.p
            className="yaku-drop-yaku-name"
            initial={{ y: -28, opacity: 0, scale: 0.92 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.98 }}
            transition={{ duration: yakuNameDuration, ease: CARD_MOVE_EASE }}
          >
            {yakuLabel}
          </motion.p>
          {cards.map((card, index) => (
            <motion.div
              key={`drop-${card.id}-${index}`}
              className="yaku-drop-card"
              initial={{ y: -260, opacity: 0, rotate: index % 2 === 0 ? -16 : 16 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{
                duration: cardDuration,
                delay: index * cardStagger,
                ease: CARD_MOVE_EASE,
              }}
            >
              <img src={getCardImageUrl(card)} alt={`${card.month}月 ${card.name}`} loading="lazy" />
            </motion.div>
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function TurnDecisionEffect(props: {
  callouts: readonly TurnDecisionCallout[]
  onFinish: (id: number) => void
}) {
  const { callouts, onFinish } = props

  return (
    <AnimatePresence>
      {callouts.map((callout) => {
        const calloutDurationSeconds = callout.durationMs / 1000
        return (
          <motion.div
            key={callout.id}
            className="turn-callout-layer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className={`turn-callout-burst ${callout.kind}`}
              style={{ '--callout-burst-duration': `${calloutDurationSeconds}s` } as CSSProperties}
              initial={{ y: 56, scale: 0.72, opacity: 0 }}
              animate={{ y: [56, 0, 0, -24], scale: [0.72, 1.08, 1.02, 1], opacity: [0, 1, 1, 0] }}
              transition={{
                duration: calloutDurationSeconds,
                times: [0, 0.16, 0.82, 1],
                ease: [0.22, 1, 0.36, 1],
              }}
              onAnimationComplete={() => onFinish(callout.id)}
            >
              <span className="turn-callout-radiance" aria-hidden="true" />
              <span className="turn-callout-flash" aria-hidden="true" />
              <span className="turn-callout-ring outer" aria-hidden="true" />
              <span className="turn-callout-ring inner" aria-hidden="true" />
              <div className="turn-callout-sparks" aria-hidden="true">
                {TURN_DECISION_SPARK_INDICES.map((sparkIndex) => (
                  <span key={`${callout.id}-${sparkIndex}`} />
                ))}
              </div>
              <p className={`turn-callout ${callout.kind}`}>{callout.text}</p>
            </motion.div>
          </motion.div>
        )
      })}
    </AnimatePresence>
  )
}

function CardMoveOverlayEffect(props: {
  effects: readonly CardMoveEffect[]
  onFinish: (id: number) => void
}) {
  const { effects, onFinish } = props

  return (
    <AnimatePresence>
      {effects.map((effect) => {
        const hasVia = effect.viaX !== undefined && effect.viaY !== undefined
        const hasVia2 = effect.via2X !== undefined && effect.via2Y !== undefined
        const viaX = effect.viaX ?? effect.toX
        const viaY = effect.viaY ?? effect.toY
        const viaWidth = effect.viaWidth ?? effect.width
        const viaHeight = effect.viaHeight ?? effect.height
        const via2X = effect.via2X ?? viaX
        const via2Y = effect.via2Y ?? viaY
        const via2Width = effect.via2Width ?? viaWidth
        const via2Height = effect.via2Height ?? viaHeight
        const useStagedCapture = effect.flipOnArrival === true
        const flipOnArrival = effect.flipFromBack && useStagedCapture
        const hold = useStagedCapture ? 0 : Math.min(Math.max(effect.flipHoldRatio ?? 0, 0), 0.62)
        const baseMoveDuration = effect.duration ?? 1.64
        const totalDuration = hold > 0 ? baseMoveDuration / (1 - hold) : baseMoveDuration
        const xTo = effect.toX - effect.fromX
        const yTo = effect.toY - effect.fromY
        const xVia = viaX - effect.fromX
        const yVia = viaY - effect.fromY
        const xVia2 = via2X - effect.fromX
        const yVia2 = via2Y - effect.fromY
        let xFrames: number[]
        let yFrames: number[]
        let rotateFrames: number[]
        let widthFrames: number[]
        let heightFrames: number[]
        let times: number[]
        let floatTimes: number[]
        let floatScaleFrames: number[]
        let flipTimes: number[]
        let flipYFrames: number[]

        if (hold > 0) {
          const viaTime = hold + (1 - hold) * 0.45
          const flipTurnTime = Math.max(0.18, hold - 0.06)
          floatTimes = [0, hold, hold + (1 - hold) * 0.46, 1]
          floatScaleFrames = [1, 1, 1.015, 1]
          flipTimes = [0, flipTurnTime, hold, 1]
          flipYFrames = [0, 180, 180, 180]
          if (hasVia) {
            xFrames = [0, 0, xVia, xTo]
            yFrames = [0, 0, yVia, yTo]
            rotateFrames = [effect.rotateStart ?? -4, effect.rotateStart ?? -4, 0, effect.rotateEnd ?? 0]
            widthFrames = [effect.width, effect.width, viaWidth, effect.toWidth ?? viaWidth]
            heightFrames = [effect.height, effect.height, viaHeight, effect.toHeight ?? viaHeight]
            times = [0, hold, viaTime, 1]
          } else {
            xFrames = [0, 0, xTo]
            yFrames = [0, 0, yTo]
            rotateFrames = [effect.rotateStart ?? -4, effect.rotateStart ?? -4, effect.rotateEnd ?? 0]
            widthFrames = [effect.width, effect.width, effect.toWidth ?? effect.width]
            heightFrames = [effect.height, effect.height, effect.toHeight ?? effect.height]
            times = [0, hold, 1]
          }
        } else if (useStagedCapture) {
          const stopTime = hasVia2 ? STAGED_CAPTURE_STOP_TIME : hasVia ? 0.46 : 0.5
          const flipEndTime = hasVia2 ? STAGED_CAPTURE_FLIP_END_TIME : hasVia ? 0.72 : 0.76
          const mergeTime = hasVia2 ? STAGED_CAPTURE_MERGE_TIME : flipEndTime
          const freezeBeforeMerge = effect.freezeBeforeMerge === true
          if (hasVia2) {
            const stagedRotateStart = effect.rotateStart ?? -4
            const stagedRotateMid = freezeBeforeMerge ? stagedRotateStart : 0
            xFrames = [0, xVia, xVia, xVia2, xTo]
            yFrames = [0, yVia, yVia, yVia2, yTo]
            rotateFrames = [stagedRotateStart, stagedRotateMid, stagedRotateMid, stagedRotateMid, effect.rotateEnd ?? 0]
            widthFrames = [effect.width, viaWidth, viaWidth, via2Width, effect.toWidth ?? via2Width]
            heightFrames = [effect.height, viaHeight, viaHeight, via2Height, effect.toHeight ?? via2Height]
            times = [0, stopTime, flipEndTime, mergeTime, 1]
            floatTimes = [0, stopTime, flipEndTime, mergeTime, 1]
            floatScaleFrames = freezeBeforeMerge
              ? [1, 1, 1, 1, 1]
              : [1, 1.012, 1.012, 1.006, 1]
            flipTimes = flipOnArrival
              ? [0, stopTime, flipEndTime, mergeTime, 1]
              : [0, 1]
            flipYFrames = flipOnArrival
              ? [0, 0, 180, 180, 180]
              : [0, 0]
          } else if (hasVia) {
            const stagedRotateStart = effect.rotateStart ?? -4
            const stagedRotateMid = freezeBeforeMerge ? stagedRotateStart : 0
            xFrames = [0, xVia, xVia, xTo]
            yFrames = [0, yVia, yVia, yTo]
            rotateFrames = [stagedRotateStart, stagedRotateMid, stagedRotateMid, effect.rotateEnd ?? 0]
            widthFrames = [effect.width, viaWidth, viaWidth, effect.toWidth ?? viaWidth]
            heightFrames = [effect.height, viaHeight, viaHeight, effect.toHeight ?? viaHeight]
            times = [0, stopTime, flipEndTime, 1]
            floatTimes = [0, stopTime, flipEndTime, 1]
            floatScaleFrames = freezeBeforeMerge
              ? [1, 1, 1, 1]
              : [1, 1.012, 1.012, 1]
            flipTimes = flipOnArrival
              ? [0, stopTime, flipEndTime, 1]
              : [0, 1]
            flipYFrames = flipOnArrival
              ? [0, 0, 180, 180]
              : [0, 0]
          } else {
            xFrames = [0, xTo, xTo]
            yFrames = [0, yTo, yTo]
            rotateFrames = [effect.rotateStart ?? -4, effect.rotateEnd ?? 0, effect.rotateEnd ?? 0]
            widthFrames = [effect.width, effect.toWidth ?? effect.width, effect.toWidth ?? effect.width]
            heightFrames = [effect.height, effect.toHeight ?? effect.height, effect.toHeight ?? effect.height]
            times = [0, flipEndTime, 1]
            floatTimes = [0, flipEndTime, 1]
            floatScaleFrames = [1, 1.012, 1]
            flipTimes = flipOnArrival
              ? [0, 0.44, flipEndTime, 1]
              : [0, 1]
            flipYFrames = flipOnArrival
              ? [0, 0, 180, 180]
              : [0, 0]
          }
        } else {
          const viaTime = 0.48
          floatTimes = [0, 0.72, 1]
          floatScaleFrames = [1, 1.015, 1]
          flipTimes = [0, 0.2, 0.4, 1]
          flipYFrames = [0, 180, 180, 180]
          if (hasVia) {
            xFrames = [0, xVia, xTo]
            yFrames = [0, yVia, yTo]
            rotateFrames = [effect.rotateStart ?? -4, 0, effect.rotateEnd ?? 0]
            widthFrames = [effect.width, viaWidth, effect.toWidth ?? viaWidth]
            heightFrames = [effect.height, viaHeight, effect.toHeight ?? viaHeight]
            times = [0, viaTime, 1]
          } else {
            xFrames = [0, xTo]
            yFrames = [0, yTo]
            rotateFrames = [effect.rotateStart ?? -4, effect.rotateEnd ?? 0]
            widthFrames = [effect.width, effect.toWidth ?? effect.width]
            heightFrames = [effect.height, effect.toHeight ?? effect.height]
            times = [0, 1]
          }
        }

        return (
          <motion.div
            key={effect.id}
            className="capture-overlay"
            style={{ zIndex: effect.zIndex ?? 3 }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
          >
            <motion.div
              className={`capture-overlay-card ${effect.flipFromBack ? 'hand-bg' : ''}`}
              style={{
                left: effect.fromX,
                top: effect.fromY,
                width: effect.width,
                height: effect.height,
                zIndex: effect.zIndex ?? 3,
              }}
              initial={{
                x: 0,
                y: 0,
                rotate: effect.rotateStart ?? -4,
                width: effect.width,
                height: effect.height,
                opacity: 1,
              }}
              animate={{
                x: xFrames,
                y: yFrames,
                rotate: rotateFrames,
                width: widthFrames,
                height: heightFrames,
                opacity: 1,
              }}
              transition={{
                duration: totalDuration,
                times,
                ease: CARD_MOVE_EASE,
              }}
              onAnimationComplete={() => onFinish(effect.id)}
            >
              <motion.div
                className="capture-overlay-content"
                initial={{ scale: 1 }}
                animate={{ scale: floatScaleFrames }}
                transition={{
                  duration: totalDuration,
                  times: floatTimes,
                  ease: CARD_MOVE_EASE,
                }}
              >
                {effect.flipFromBack ? (
                  <motion.div
                    className="capture-overlay-flip-inner"
                    initial={{ rotateY: 0, y: 0, rotateZ: 0, scale: 1 }}
                    animate={{
                      rotateY: flipYFrames,
                      y: [0, 0, 0, 0],
                      rotateZ: [0, 0, 0, 0],
                      scale: [1, 1, 1, 1],
                    }}
                    transition={{
                      duration: totalDuration,
                      times: flipTimes,
                      ease: CARD_MOVE_EASE,
                    }}
                  >
                    <div className="capture-overlay-face back">
                      <div className="card-back"><span>花札</span></div>
                    </div>
                    <div className="capture-overlay-face front">
                      <img
                        src={getCardImageUrl(effect.card)}
                        alt={`${effect.card.month}月 ${effect.card.name}`}
                        loading="eager"
                      />
                    </div>
                  </motion.div>
                ) : (
                  <img src={getCardImageUrl(effect.card)} alt={`${effect.card.month}月 ${effect.card.name}`} loading="eager" />
                )}
              </motion.div>
            </motion.div>
          </motion.div>
        )
      })}
    </AnimatePresence>
  )
}

function DeckZone(props: {
  deckCount: number
  isDrawing: boolean
  revealedCard: HanafudaCard | null
  isRevealing: boolean
  onRevealComplete?: () => void
}) {
  const { deckCount, isDrawing, revealedCard, isRevealing, onRevealComplete } = props

  return (
    <div className="deck-zone" aria-label="山札">
      <div className="deck-stack">
        <div className="deck-card layer-3">
          <div className="card-back"><span>花札</span></div>
        </div>
        <div className="deck-card layer-2">
          <div className="card-back"><span>花札</span></div>
        </div>
        {revealedCard ? (
          <motion.div
            key={`${revealedCard.id}-${isRevealing ? 'revealing' : 'shown'}`}
            className="deck-card layer-1 revealed"
            data-card-id={revealedCard.id}
            style={{ transformStyle: 'preserve-3d' }}
          >
            <motion.div
              className="deck-flip-shell"
              initial={
                isRevealing
                  ? { rotateY: 0, y: 0, rotateZ: 1, scale: 1 }
                  : { rotateY: 180, y: 0, rotateZ: 0, scale: 1 }
              }
              animate={{ rotateY: 180, y: [0, -6, 0], rotateZ: [1, 0.2, 0], scale: [1, 1.02, 1] }}
              transition={
                isRevealing
                  ? { duration: 1.56, times: [0, 0.55, 1], ease: [0.22, 1, 0.36, 1] }
                  : { duration: 0.16 }
              }
              onAnimationComplete={() => {
                if (isRevealing) {
                  onRevealComplete?.()
                }
              }}
            >
              <div className="deck-flip-face back">
                <div className="card-back"><span>花札</span></div>
              </div>
              <div className="deck-flip-face front">
                <img
                  src={getCardImageUrl(revealedCard)}
                  alt={`${revealedCard.month}月 ${revealedCard.name}`}
                  loading="lazy"
                />
              </div>
            </motion.div>
          </motion.div>
        ) : (
          <div className={`deck-card layer-1 ${isDrawing ? 'drawing' : ''}`}>
            <div className="card-back"><span>花札</span></div>
          </div>
        )}
      </div>
      <p className="deck-count">山札 {deckCount}枚</p>
    </div>
  )
}

function App() {
  const [game, setGame] = useState<KoiKoiGameState>(() => createNewGame({
    ...DEFAULT_CONFIG,
    maxRounds: getInitialRoundCount(),
    localRules: getInitialLocalRules(),
  }))
  const [isBootstrapRestored, setIsBootstrapRestored] = useState(false)
  const [remoteQueueVersion, setRemoteQueueVersion] = useState(0)
  const remoteCommandQueueRef = useRef<TurnCommand[]>([])
  const queueRemoteCommand = useCallback((command: TurnCommand): void => {
    remoteCommandQueueRef.current.push(command)
    setRemoteQueueVersion((current) => current + 1)
  }, [])
  const multiplayer = useMultiplayerGame({ game, setGame, onRemoteCommand: queueRemoteCommand })
  useEffect(() => {
    try {
      const meta = loadSessionMeta()
      if (meta?.mode === 'p2p-host' && meta.roomId) {
        clearCpuCheckpoint()
        multiplayer.startHost(game, meta.roomId, true)
      } else if (meta?.mode === 'p2p-guest' && meta.roomId) {
        clearCpuCheckpoint()
        multiplayer.setJoinRoomId(meta.roomId)
        multiplayer.joinAsGuest(game)
      } else {
        const cpuCheckpoint = loadCpuCheckpoint()
        if (cpuCheckpoint?.isMatchSurfaceVisible) {
          setGame(normalizeLoadedGameState(cpuCheckpoint.state))
          setIsMatchSurfaceVisible(true)
        } else {
          setIsMatchSurfaceVisible(true)
        }
      }
    } catch {
      // ignore
    } finally {
      setIsBootstrapRestored(true)
    }
    // only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [hoveredHandCardId, setHoveredHandCardId] = useState<string | null>(null)
  const [moveEffects, setMoveEffects] = useState<CardMoveEffect[]>([])
  const [turnDecisionCallouts, setTurnDecisionCallouts] = useState<TurnDecisionCallout[]>([])
  const [turnBanner, setTurnBanner] = useState<{ id: number; isLocal: boolean; label: string } | null>(null)
  const turnBannerIdRef = useRef(0)
  const turnBannerDelayTimerRef = useRef<number | null>(null)
  const prevPlayerIndexRef = useRef(game.currentPlayerIndex)
  const [animatedAddToFieldHistoryLength, setAnimatedAddToFieldHistoryLength] = useState(0)
  const [isChromeCollapsed, setIsChromeCollapsed] = useState(false)
  const [isMobileLayout, setIsMobileLayout] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false
    }
    return window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
  })
  const [isLandscapeFullscreen, setIsLandscapeFullscreen] = useState(false)
  const [isLandscapeOrientation, setIsLandscapeOrientation] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.innerWidth > window.innerHeight
  })
  const [ruleHelpViewport, setRuleHelpViewport] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }))
  const appContainerRef = useRef<HTMLDivElement>(null)
  const [isMatchSurfaceVisible, setIsMatchSurfaceVisible] = useState(false)
  const [isFinalResultVisible, setIsFinalResultVisible] = useState(false)
  const [selectedRoundCount, setSelectedRoundCount] = useState<(typeof ROUND_COUNT_OPTIONS)[number]>(() => getInitialRoundCount())
  const [draftLocalRules, setDraftLocalRules] = useState<LocalRuleSettings>(() => getInitialLocalRules())
  const [pendingHandPlaceholder, setPendingHandPlaceholder] = useState<{ card: HanafudaCard; index: number } | null>(null)
  const [pendingAiHandPlaceholder, setPendingAiHandPlaceholder] = useState<{ card: HanafudaCard; index: number } | null>(null)

  const [isScoreTableVisible, setIsScoreTableVisible] = useState(false)
  const [isLocalRulePanelVisible, setIsLocalRulePanelVisible] = useState(false)
  const [isRuleHelpVisible, setIsRuleHelpVisible] = useState(false)
  const [ruleHelpPageIndex, setRuleHelpPageIndex] = useState(0)
  const ruleHelpSwipeStartRef = useRef<{ pointerId: number; x: number; y: number } | null>(null)
  const [isHandExpanded, setIsHandExpanded] = useState(false)
  const expandedHandPlaceholderRef = useRef<HTMLDivElement | null>(null)
  const [expandedRackTop, setExpandedRackTop] = useState<number | null>(null)
  const [expandedSelectedCardId, setExpandedSelectedCardId] = useState<string | null>(null)
  const [expandedSelectionPulseCardId, setExpandedSelectionPulseCardId] = useState<string | null>(null)
  const expandedSelectionPulseTimerRef = useRef<number | null>(null)
  const pendingExpandedFieldSelectionRef = useRef<string | null>(null)
  const [isKoikoiDecisionYakuVisible, setIsKoikoiDecisionYakuVisible] = useState(false)
  const [isKoikoiDecisionChoiceVisible, setIsKoikoiDecisionChoiceVisible] = useState(false)
  const koikoiDecisionSequenceKeyRef = useRef<string | null>(null)
  const koikoiDecisionYakuTimerRef = useRef<number | null>(null)
  const [handDrag, setHandDrag] = useState<HandDragState | null>(null)
  const prevPhaseRef = useRef(game.phase)
  const rectMapRef = useRef<Map<string, DOMRect>>(new Map())
  const prevRectMapRef = useRef<Map<string, DOMRect>>(new Map())
  const lastKnownRectMapRef = useRef<Map<string, DOMRect>>(new Map())
  const prevTurnHistoryLengthRef = useRef(0)
  const animatedFieldReflowHistoryLengthRef = useRef(0)
  const captureEffectIdRef = useRef(1)
  const turnDecisionCalloutIdRef = useRef(1)
  const shownTurnDecisionHistoryLengthRef = useRef(0)
  const moveBatchIdRef = useRef(1)
  const gameRef = useRef<KoiKoiGameState>(game)
  const pendingCaptureGameRef = useRef<KoiKoiGameState | null>(null)
  const skipCaptureHistoryLengthRef = useRef<number | null>(null)
  const moveEffectByIdRef = useRef<Map<number, CardMoveEffect>>(new Map())
  const moveBatchRemainingRef = useRef<Map<number, number>>(new Map())
  const localPlayerIndex = multiplayer.localPlayerIndex
  const opponentPlayerIndex: 0 | 1 = localPlayerIndex === 0 ? 1 : 0

  const humanPlayer = game.players[localPlayerIndex]
  const aiPlayer = game.players[opponentPlayerIndex]
  const aiPanelView = {
    captured: aiPlayer.captured,
    completedYaku: aiPlayer.completedYaku,
    score: aiPlayer.score,
  }
  const humanPanelView = {
    captured: humanPlayer.captured,
    completedYaku: humanPlayer.completedYaku,
    score: humanPlayer.score,
  }
  const activeLocalRules = useMemo(
    () => normalizeLocalRuleSettings(game.config.localRules),
    [game.config.localRules],
  )
  const localRulesForPanel = multiplayer.mode === 'cpu' ? draftLocalRules : activeLocalRules
  const aiBlockedCardIds = useMemo(() => new Set(humanPanelView.captured.map((card) => card.id)), [humanPanelView.captured])
  const humanBlockedCardIds = useMemo(() => new Set(aiPanelView.captured.map((card) => card.id)), [aiPanelView.captured])
  const aiVisibleProgressEntries = useMemo(
    () => filterInMatchYakuEntries(buildVisibleYakuProgressEntries(
      buildYakuProgressEntries(
        aiPanelView.captured,
        aiPanelView.completedYaku,
        aiBlockedCardIds,
        {
          enableHanamiZake: activeLocalRules.yakuEnabled['hanami-zake'],
          enableTsukimiZake: activeLocalRules.yakuEnabled['tsukimi-zake'],
          enableFourCardsYaku: activeLocalRules.yakuEnabled.shiten,
          enableAmeNagare: activeLocalRules.yakuEnabled['hanami-zake'] && activeLocalRules.enableAmeNagare,
          enableKiriNagare: activeLocalRules.yakuEnabled['tsukimi-zake'] && activeLocalRules.enableKiriNagare,
        },
      ),
    )),
    [
      activeLocalRules.enableAmeNagare,
      activeLocalRules.enableKiriNagare,
      activeLocalRules.yakuEnabled['hanami-zake'],
      activeLocalRules.yakuEnabled['tsukimi-zake'],
      activeLocalRules.yakuEnabled.shiten,
      aiBlockedCardIds,
      aiPanelView.captured,
      aiPanelView.completedYaku,
    ],
  )
  const humanVisibleProgressEntries = useMemo(
    () => filterInMatchYakuEntries(buildVisibleYakuProgressEntries(
      buildYakuProgressEntries(
        humanPanelView.captured,
        humanPanelView.completedYaku,
        humanBlockedCardIds,
        {
          enableHanamiZake: activeLocalRules.yakuEnabled['hanami-zake'],
          enableTsukimiZake: activeLocalRules.yakuEnabled['tsukimi-zake'],
          enableFourCardsYaku: activeLocalRules.yakuEnabled.shiten,
          enableAmeNagare: activeLocalRules.yakuEnabled['hanami-zake'] && activeLocalRules.enableAmeNagare,
          enableKiriNagare: activeLocalRules.yakuEnabled['tsukimi-zake'] && activeLocalRules.enableKiriNagare,
        },
      ),
    )),
    [
      activeLocalRules.enableAmeNagare,
      activeLocalRules.enableKiriNagare,
      activeLocalRules.yakuEnabled['hanami-zake'],
      activeLocalRules.yakuEnabled['tsukimi-zake'],
      activeLocalRules.yakuEnabled.shiten,
      humanBlockedCardIds,
      humanPanelView.captured,
      humanPanelView.completedYaku,
    ],
  )
  const clearKoikoiDecisionSequenceTimers = useCallback((): void => {
    if (koikoiDecisionYakuTimerRef.current !== null) {
      window.clearTimeout(koikoiDecisionYakuTimerRef.current)
      koikoiDecisionYakuTimerRef.current = null
    }
  }, [])
  const isLocalTurn = game.currentPlayerIndex === localPlayerIndex
  const isAiTurn = !isLocalTurn
  const isCpuAiTurn = multiplayer.mode === 'cpu' && isAiTurn
  const canAutoAdvance = multiplayer.mode === 'cpu' || isLocalTurn
  const isLobbyConnected = multiplayer.mode !== 'cpu' && multiplayer.connectionStatus === 'connected'
  const hasMatchStarted = game.round > 1 || game.turnHistory.length > 0 || game.phase !== 'selectHandCard'
  const isCpuRuleChangeDeferred = multiplayer.mode === 'cpu' && hasMatchStarted
  const canEditLocalRules = !isLobbyConnected && (multiplayer.mode === 'cpu' || !hasMatchStarted)
  const canSelectRoundCount = !isLobbyConnected && (multiplayer.mode === 'cpu' || !hasMatchStarted)
  const isKoikoiDecisionSequencing = game.phase === 'koikoiDecision' && !isKoikoiDecisionChoiceVisible
  const koikoiEffectActive = turnDecisionCallouts.some((callout) => callout.kind === 'koikoi')
  const stopEffectActive = turnDecisionCallouts.some((callout) => callout.kind === 'stop')
  const interactionLocked = moveEffects.length > 0 || koikoiEffectActive
  const humanDisplayName = multiplayer.mode === 'cpu' ? humanPlayer.name : 'あなた'
  const cpuDifficultyLabel = AI_DIFFICULTY_LABELS[game.config.aiDifficulty] ?? ''
  const opponentDisplayName = multiplayer.mode === 'cpu'
    ? `${aiPlayer.name}（${cpuDifficultyLabel}）`
    : '相手'
  const player1ScoreTableName = multiplayer.mode === 'cpu'
    ? game.players[0].name
    : game.players[0].id === humanPlayer.id ? 'あなた' : '相手'
  const player2ScoreTableName = multiplayer.mode === 'cpu'
    ? game.players[1].name
    : game.players[1].id === humanPlayer.id ? 'あなた' : '相手'
  const player1ScoreTableTotal = game.players[0].score
  const player2ScoreTableTotal = game.players[1].score
  // Use PC layout only when in fullscreen AND landscape orientation
  // Portrait fullscreen keeps mobile layout
  const useMobileViewLayout = isMobileLayout && !(isLandscapeFullscreen && isLandscapeOrientation)
  const isLandscapeMobileRuleHelpMode =
    isLandscapeOrientation && (isMobileLayout || isLandscapeFullscreen)
  const useMobileRuleHelpPagination = isMobileLayout && !isLandscapeMobileRuleHelpMode
  const ruleHelpScoringNotes = useMemo(
    () => buildRuleHelpScoringNotes(activeLocalRules),
    [activeLocalRules],
  )
  const ruleHelpPages = useMemo<readonly RuleHelpPage[]>(() => {
    const monthRanges: ReadonlyArray<readonly [number, number]> = (() => {
      if (!useMobileRuleHelpPagination) {
        return [[1, 12]]
      }
      const estimatedPanelHeight = Math.min(ruleHelpViewport.height * 0.9, 780)
      const monthChromeHeight = 206
      const monthRowHeight = ruleHelpViewport.width <= 360 ? 112 : ruleHelpViewport.width <= 420 ? 104 : 98
      const estimatedMonthsPerPage = Math.floor((estimatedPanelHeight - monthChromeHeight) / monthRowHeight)
      const monthsPerPage = Math.max(1, Math.min(12, estimatedMonthsPerPage))
      const ranges: Array<readonly [number, number]> = []
      for (let startMonth = 1; startMonth <= 12; startMonth += monthsPerPage) {
        ranges.push([startMonth, Math.min(12, startMonth + monthsPerPage - 1)])
      }
      return ranges
    })()

    const monthPages: RuleHelpPage[] = monthRanges.map(([startMonth, endMonth], index) => ({
      key: `months-${index + 1}`,
      title: startMonth === endMonth ? `月札 ${startMonth}月` : `月札 ${startMonth}〜${endMonth}月`,
      subtitle: '札の月を覚える',
      content: <RuleHelpMonthPage startMonth={startMonth} endMonth={endMonth} compact />,
    }))

    const chunkYakuEntries = (
      entries: readonly RuleHelpYakuEntry[],
      chunkSize: number,
    ): RuleHelpYakuEntry[][] => {
      const chunks: RuleHelpYakuEntry[][] = []
      for (let index = 0; index < entries.length; index += chunkSize) {
        chunks.push([...entries.slice(index, index + chunkSize)])
      }
      return chunks
    }

    const yakuPages: RuleHelpPage[] = []
    if (!useMobileRuleHelpPagination) {
      yakuPages.push({
        key: 'yaku-main',
        title: '役一覧（基本役）',
        subtitle: '点数役・枚数役',
        content: <RuleHelpYakuPage entries={RULE_HELP_BASIC_YAKU_ENTRIES} notes={ruleHelpScoringNotes} />,
      })
    } else {
      const estimatedPanelHeight = Math.min(ruleHelpViewport.height * 0.9, 780)
      const yakuChromeHeight = 176
      const yakuRowHeight = ruleHelpViewport.width <= 360 ? 114 : ruleHelpViewport.width <= 420 ? 106 : 100
      const estimatedRowsPerPage = Math.floor((estimatedPanelHeight - yakuChromeHeight) / yakuRowHeight)
      const yakuRowsPerPage = Math.max(2, Math.min(6, estimatedRowsPerPage))
      const basicChunks = chunkYakuEntries(RULE_HELP_BASIC_YAKU_ENTRIES, yakuRowsPerPage)

      basicChunks.forEach((chunk, index) => {
        const totalPages = basicChunks.length
        const isLastChunk = index === totalPages - 1
        yakuPages.push({
          key: `yaku-main-${index + 1}`,
          title: totalPages > 1 ? `役一覧（基本役 ${index + 1}/${totalPages}）` : '役一覧（基本役）',
          subtitle: '点数役・枚数役',
          content: <RuleHelpYakuPage entries={chunk} notes={isLastChunk ? ruleHelpScoringNotes : undefined} />,
        })
      })
    }

    return [
      ...monthPages,
      ...yakuPages,
    ]
  }, [ruleHelpScoringNotes, ruleHelpViewport.height, ruleHelpViewport.width, useMobileRuleHelpPagination])
  const currentRuleHelpPage = ruleHelpPages[ruleHelpPageIndex] ?? ruleHelpPages[0]

  useEffect(() => {
    setRuleHelpPageIndex((current) => Math.min(current, Math.max(0, ruleHelpPages.length - 1)))
  }, [ruleHelpPages.length])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const media = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
    const onChange = (event: MediaQueryListEvent): void => {
      setIsMobileLayout(event.matches)
    }
    setIsMobileLayout(media.matches)
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    }
    media.addListener(onChange)
    return () => media.removeListener(onChange)
  }, [])

  // Track orientation changes (for landscape fullscreen detection)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = (): void => {
      const nextWidth = window.innerWidth
      const nextHeight = window.innerHeight
      setIsLandscapeOrientation(nextWidth > nextHeight)
      setRuleHelpViewport((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current
        }
        return { width: nextWidth, height: nextHeight }
      })
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!isMobileLayout) {
      setHandDrag(null)
      return
    }
    setIsChromeCollapsed(true)
  }, [isMobileLayout])

  useEffect(() => {
    if (interactionLocked) {
      setHandDrag(null)
    }
  }, [interactionLocked])

  const clearExpandedSelectionPulseTimer = useCallback((): void => {
    if (expandedSelectionPulseTimerRef.current === null) {
      return
    }
    window.clearTimeout(expandedSelectionPulseTimerRef.current)
    expandedSelectionPulseTimerRef.current = null
  }, [])

  // 相手の番やinteraction lockで手札拡大と選択状態を自動解除
  useEffect(() => {
    if (isAiTurn || interactionLocked) {
      clearExpandedSelectionPulseTimer()
      setExpandedSelectionPulseCardId(null)
      setIsHandExpanded(false)
      setExpandedSelectedCardId(null)
    }
  }, [clearExpandedSelectionPulseTimer, isAiTurn, interactionLocked])

  // 自分のターン開始時に手札を自動拡大（モバイルのみ、フェーズ切り替わり時のみ）
  useEffect(() => {
    const prevPhase = prevPhaseRef.current
    prevPhaseRef.current = game.phase
    // フェーズがselectHandCardに変わった時のみ自動拡大
    if (useMobileViewLayout && !isAiTurn && !interactionLocked && game.phase === 'selectHandCard' && prevPhase !== 'selectHandCard') {
      setIsHandExpanded(true)
    }
  }, [useMobileViewLayout, isAiTurn, interactionLocked, game.phase])


  useEffect(() => {
    if (multiplayer.connectionStatus === 'connected') {
      setIsMatchSurfaceVisible(true)
      setIsChromeCollapsed(true)
    }
  }, [multiplayer.connectionStatus, multiplayer.mode])

  useEffect(() => {
    if (!isMatchSurfaceVisible && multiplayer.mode === 'cpu') {
      return
    }
    if (multiplayer.mode === 'cpu' && hasMatchStarted) {
      return
    }
    const nextRoundCount = game.config.maxRounds as (typeof ROUND_COUNT_OPTIONS)[number]
    if (!ROUND_COUNT_OPTIONS.includes(nextRoundCount)) {
      return
    }
    setSelectedRoundCount((current) => (current === nextRoundCount ? current : nextRoundCount))
  }, [game.config.maxRounds, hasMatchStarted, isMatchSurfaceVisible, multiplayer.mode])

  useEffect(() => {
    if (multiplayer.mode === 'cpu' && hasMatchStarted) {
      return
    }
    setDraftLocalRules((current) => (areLocalRulesEqual(current, activeLocalRules) ? current : activeLocalRules))
  }, [activeLocalRules, hasMatchStarted, multiplayer.mode])

  useEffect(() => {
    if (!isBootstrapRestored) {
      return
    }
    if (multiplayer.mode !== 'cpu' || !isMatchSurfaceVisible || game.phase === 'gameOver') {
      clearCpuCheckpoint()
      return
    }
    saveCpuCheckpoint({
      state: game,
      updatedAt: Date.now(),
      isMatchSurfaceVisible: true,
    })
  }, [game, isBootstrapRestored, isMatchSurfaceVisible, multiplayer.mode])

  useEffect(() => {
    setIsFinalResultVisible(false)
  }, [game.phase])

  // Fullscreen change event listener to sync state when user exits fullscreen via ESC/back button
  useEffect(() => {
    const onFullscreenChange = (): void => {
      const isCurrentlyFullscreen = !!document.fullscreenElement
      if (!isCurrentlyFullscreen && isLandscapeFullscreen) {
        setIsLandscapeFullscreen(false)
        // Unlock screen orientation when exiting fullscreen
        if (screen.orientation && typeof screen.orientation.unlock === 'function') {
          try {
            screen.orientation.unlock()
          } catch {
            // Ignore errors - orientation unlock not supported
          }
        }
      }
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [isLandscapeFullscreen])

  const enterLandscapeFullscreen = useCallback(async (): Promise<void> => {
    const container = appContainerRef.current
    if (!container) return

    try {
      // Request fullscreen
      await container.requestFullscreen()
      setIsLandscapeFullscreen(true)

      // Try to lock orientation to landscape (only works on supported mobile browsers)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orientation = screen.orientation as any
      if (orientation && typeof orientation.lock === 'function') {
        try {
          await orientation.lock('landscape')
        } catch {
          // Ignore errors - orientation lock not supported on all devices
        }
      }
    } catch {
      // Fullscreen request failed or was denied
    }
  }, [])

  const exitLandscapeFullscreen = useCallback(async (): Promise<void> => {
    if (!document.fullscreenElement) return

    try {
      await document.exitFullscreen()
      setIsLandscapeFullscreen(false)

      // Unlock screen orientation
      if (screen.orientation && typeof screen.orientation.unlock === 'function') {
        try {
          screen.orientation.unlock()
        } catch {
          // Ignore errors
        }
      }
    } catch {
      // Exit fullscreen failed
    }
  }, [])
  const openRuleHelp = useCallback((): void => {
    setIsScoreTableVisible(false)
    setRuleHelpPageIndex(0)
    setIsRuleHelpVisible(true)
  }, [])
  const closeRuleHelp = useCallback((): void => {
    ruleHelpSwipeStartRef.current = null
    setIsRuleHelpVisible(false)
  }, [])
  const goToRuleHelpPage = useCallback((nextIndex: number): void => {
    setRuleHelpPageIndex(() => {
      const maxIndex = Math.max(0, ruleHelpPages.length - 1)
      return Math.min(Math.max(nextIndex, 0), maxIndex)
    })
  }, [ruleHelpPages.length])
  const goToPreviousRuleHelpPage = useCallback((): void => {
    goToRuleHelpPage(ruleHelpPageIndex - 1)
  }, [goToRuleHelpPage, ruleHelpPageIndex])
  const goToNextRuleHelpPage = useCallback((): void => {
    goToRuleHelpPage(ruleHelpPageIndex + 1)
  }, [goToRuleHelpPage, ruleHelpPageIndex])
  const handleRuleHelpPointerDown = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const isSwipePointer = event.pointerType === 'touch' || event.pointerType === 'pen'
    if (!isSwipePointer) {
      return
    }
    if (event.currentTarget.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Ignore capture errors in unsupported browsers.
      }
    }
    ruleHelpSwipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
  }, [])
  const handleRuleHelpPointerUp = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const isSwipePointer = event.pointerType === 'touch' || event.pointerType === 'pen'
    if (!isSwipePointer) {
      return
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Ignore release errors in unsupported browsers.
      }
    }
    const start = ruleHelpSwipeStartRef.current
    ruleHelpSwipeStartRef.current = null
    if (!start || start.pointerId !== event.pointerId) {
      return
    }
    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (Math.abs(deltaX) < RULE_HELP_SWIPE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return
    }
    if (deltaX < 0) {
      goToNextRuleHelpPage()
      return
    }
    goToPreviousRuleHelpPage()
  }, [goToNextRuleHelpPage, goToPreviousRuleHelpPage])
  const handleRuleHelpPointerCancel = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const isSwipePointer = event.pointerType === 'touch' || event.pointerType === 'pen'
    if (!isSwipePointer) {
      return
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // Ignore release errors in unsupported browsers.
      }
    }
    ruleHelpSwipeStartRef.current = null
  }, [])
  const isRuleHelpFirstPage = ruleHelpPageIndex <= 0
  const isRuleHelpLastPage = ruleHelpPageIndex >= ruleHelpPages.length - 1

  useEffect(() => {
    if (!isRuleHelpVisible) {
      ruleHelpSwipeStartRef.current = null
      return
    }
    const maxIndex = Math.max(0, ruleHelpPages.length - 1)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeRuleHelp()
        return
      }
      if (event.key === 'ArrowLeft') {
        setRuleHelpPageIndex((current) => Math.max(0, current - 1))
        return
      }
      if (event.key === 'ArrowRight') {
        setRuleHelpPageIndex((current) => Math.min(maxIndex, current + 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeRuleHelp, isRuleHelpVisible, ruleHelpPages.length])

  useEffect(() => {
    const prev = prevPlayerIndexRef.current
    prevPlayerIndexRef.current = game.currentPlayerIndex
    if (prev === game.currentPlayerIndex) return
    if (game.phase === 'roundEnd' || game.phase === 'gameOver') return

    if (turnBannerDelayTimerRef.current !== null) {
      window.clearTimeout(turnBannerDelayTimerRef.current)
      turnBannerDelayTimerRef.current = null
    }

    const isLocal = game.currentPlayerIndex === localPlayerIndex
    const label = isLocal ? 'あなたの番' : `${opponentDisplayName}の番`
    const nextBanner = {
      id: turnBannerIdRef.current + 1,
      isLocal,
      label,
    }
    turnBannerIdRef.current = nextBanner.id
    const latestAction = game.turnHistory[game.turnHistory.length - 1]
    if (latestAction?.type === 'koikoi') {
      const delayMs =
        latestAction.player === aiPlayer.id
          ? OPPONENT_KOIKOI_EFFECT_DURATION_MS + 140
          : TURN_BANNER_AFTER_KOIKOI_DELAY_MS
      turnBannerDelayTimerRef.current = window.setTimeout(() => {
        setTurnBanner(nextBanner)
        turnBannerDelayTimerRef.current = null
      }, delayMs)
      return
    }
    setTurnBanner(nextBanner)
  }, [aiPlayer.id, game.currentPlayerIndex, game.phase, game.turnHistory, localPlayerIndex, opponentDisplayName])

  useEffect(() => {
    return () => {
      if (turnBannerDelayTimerRef.current !== null) {
        window.clearTimeout(turnBannerDelayTimerRef.current)
      }
    }
  }, [])

  const phaseMessage = useMemo(() => {
    if (game.phase === 'koikoiDecision' && isKoikoiDecisionSequencing) {
      return '役を表示しています'
    }
    if (multiplayer.mode === 'cpu') {
      return getPhaseMessage(game, isCpuAiTurn)
    }

    switch (game.phase) {
      case 'selectHandCard':
        return isLocalTurn ? 'あなたの番: 手札を1枚選択' : '相手が手札を選択中'
      case 'selectFieldMatch':
        return isLocalTurn ? '同じ月の場札を1枚選択' : '相手が場札の取り先を選択中'
      case 'drawingDeck':
        return '山札から引いています'
      case 'drawReveal':
        return '山札の札をめくっています'
      case 'selectDrawMatch':
        return isLocalTurn ? '引いた札の取り先を選択' : '相手が引き札の取り先を選択中'
      case 'checkYaku':
        return '役を判定しています'
      case 'koikoiDecision':
        return isLocalTurn ? 'こいこい or 上がりを選択' : '相手がこいこい判断中'
      case 'roundEnd':
        return game.roundWinner
          ? `${game.roundWinner === humanPlayer.id ? 'あなた' : '相手'}が ${game.roundPoints}点 獲得`
          : 'この月は引き分け'
      case 'gameOver':
        return game.winner
          ? `対局終了: ${game.winner === humanPlayer.id ? 'あなた' : '相手'}の勝利`
          : '対局終了: 引き分け'
      default:
        return '対局中'
    }
  }, [game, humanPlayer.id, isCpuAiTurn, isKoikoiDecisionSequencing, isLocalTurn, multiplayer.mode])
  const roundPointBreakdownLines = useMemo(() => buildRoundPointBreakdownLines(game), [game])
  const sortedNewYaku = useMemo(
    () => [...game.newYaku].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ja')),
    [game.newYaku],
  )
  const koikoiDecisionDropCards = useMemo(
    () => flattenNewYakuCards(sortedNewYaku),
    [sortedNewYaku],
  )
  const koiKoiLimitEnabled = activeLocalRules.koiKoiBonusMode !== 'none' && activeLocalRules.koikoiLimit > 0
  const canDeclareKoiKoiNow = !koiKoiLimitEnabled || game.koikoiCounts[localPlayerIndex] < activeLocalRules.koikoiLimit
  const koikoiDecisionYakuLines = useMemo(() => {
    const lines = sortedNewYaku.map((item) => `${item.name} (${item.points}点)`)
    if (game.phase === 'koikoiDecision' && !isAiTurn && !canDeclareKoiKoiNow) {
      lines.push(`こいこい上限（${activeLocalRules.koikoiLimit}回）に達しているため、上がりのみ選択できます。`)
    }
    return lines
  }, [activeLocalRules.koikoiLimit, canDeclareKoiKoiNow, game.phase, isAiTurn, sortedNewYaku])
  useEffect(() => {
    if (game.phase !== 'koikoiDecision') {
      koikoiDecisionSequenceKeyRef.current = null
      clearKoikoiDecisionSequenceTimers()
      setIsKoikoiDecisionYakuVisible(false)
      setIsKoikoiDecisionChoiceVisible(false)
      return
    }

    const sequenceKey = `${game.round}-${game.currentPlayerIndex}-${game.turnHistory.length}`
    if (koikoiDecisionSequenceKeyRef.current === sequenceKey) {
      return
    }
    koikoiDecisionSequenceKeyRef.current = sequenceKey
    clearKoikoiDecisionSequenceTimers()
    setIsKoikoiDecisionChoiceVisible(false)

    if (koikoiDecisionDropCards.length === 0) {
      setIsKoikoiDecisionYakuVisible(false)
      setIsKoikoiDecisionChoiceVisible(true)
      return
    }

    setIsKoikoiDecisionYakuVisible(true)
    koikoiDecisionYakuTimerRef.current = window.setTimeout(() => {
      setIsKoikoiDecisionYakuVisible(false)
      koikoiDecisionYakuTimerRef.current = null
      setIsKoikoiDecisionChoiceVisible(true)
    }, getYakuDropRevealDurationMs(koikoiDecisionDropCards.length))
  }, [
    clearKoikoiDecisionSequenceTimers,
    game.currentPlayerIndex,
    game.phase,
    game.round,
    game.turnHistory.length,
    koikoiDecisionDropCards.length,
  ])
  useEffect(() => () => clearKoikoiDecisionSequenceTimers(), [clearKoikoiDecisionSequenceTimers])

  const playerIntent: TurnIntent = useMemo(() => getTurnIntent(game.phase), [game.phase])

  const highlightFieldIds = useMemo(
    () => new Set(game.pendingMatches.map((card) => card.id)),
    [game.pendingMatches],
  )

  const matchableHandIds = useMemo(() => {
    if (game.phase !== 'selectHandCard') {
      return new Set<string>()
    }

    return new Set(
      humanPlayer.hand
        .filter((card) => getMatchingFieldCards(card, game.field).length > 0)
        .map((card) => card.id),
    )
  }, [game.phase, humanPlayer.hand, game.field])
  const mustPlayMatchingHandCard = useMemo(
    () => !isAiTurn && !interactionLocked && playerIntent === 'play' && matchableHandIds.size > 0,
    [interactionLocked, isAiTurn, matchableHandIds, playerIntent],
  )
  const currentHumanHandIdSet = useMemo(
    () => new Set(humanPlayer.hand.map((card) => card.id)),
    [humanPlayer.hand],
  )
  const currentAiHandIdSet = useMemo(
    () => new Set(aiPlayer.hand.map((card) => card.id)),
    [aiPlayer.hand],
  )
  useEffect(() => {
    if (!expandedSelectedCardId) {
      clearExpandedSelectionPulseTimer()
      setExpandedSelectionPulseCardId(null)
      return
    }
    if (game.phase !== 'selectHandCard' || !currentHumanHandIdSet.has(expandedSelectedCardId)) {
      clearExpandedSelectionPulseTimer()
      setExpandedSelectionPulseCardId(null)
      setExpandedSelectedCardId(null)
    }
  }, [clearExpandedSelectionPulseTimer, currentHumanHandIdSet, expandedSelectedCardId, game.phase])
  useEffect(() => () => clearExpandedSelectionPulseTimer(), [clearExpandedSelectionPulseTimer])
  const activeMoveCardIdSet = useMemo(
    () => new Set(moveEffects.map((effect) => effect.card.id)),
    [moveEffects],
  )
  const pendingPlaceholderCardId = useMemo(() => {
    if (!pendingHandPlaceholder) {
      return null
    }
    return currentHumanHandIdSet.has(pendingHandPlaceholder.card.id) ? null : pendingHandPlaceholder.card.id
  }, [currentHumanHandIdSet, pendingHandPlaceholder])
  const displayedHumanHand = useMemo(() => {
    if (!pendingHandPlaceholder || !pendingPlaceholderCardId) {
      return humanPlayer.hand
    }
    const next = [...humanPlayer.hand]
    const insertIndex = Math.max(0, Math.min(pendingHandPlaceholder.index, next.length))
    next.splice(insertIndex, 0, pendingHandPlaceholder.card)
    return next
  }, [humanPlayer.hand, pendingHandPlaceholder, pendingPlaceholderCardId])
  const pendingAiPlaceholderCardId = useMemo(() => {
    if (!pendingAiHandPlaceholder) {
      return null
    }
    return currentAiHandIdSet.has(pendingAiHandPlaceholder.card.id) ? null : pendingAiHandPlaceholder.card.id
  }, [currentAiHandIdSet, pendingAiHandPlaceholder])
  const displayedAiHand = useMemo(() => {
    if (!pendingAiHandPlaceholder || !pendingAiPlaceholderCardId) {
      return aiPlayer.hand
    }
    const next = [...aiPlayer.hand]
    const insertIndex = Math.max(0, Math.min(pendingAiHandPlaceholder.index, next.length))
    next.splice(insertIndex, 0, pendingAiHandPlaceholder.card)
    return next
  }, [aiPlayer.hand, pendingAiHandPlaceholder, pendingAiPlaceholderCardId])
  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (!useMobileViewLayout || !isHandExpanded) {
      setExpandedRackTop(null)
      return
    }

    const updateExpandedRackTop = (): void => {
      const top = expandedHandPlaceholderRef.current?.getBoundingClientRect().top
      if (typeof top !== 'number' || !Number.isFinite(top)) {
        return
      }
      setExpandedRackTop(Math.max(0, Math.round(top)))
    }

    const rafId = window.requestAnimationFrame(updateExpandedRackTop)
    window.addEventListener('resize', updateExpandedRackTop)
    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', updateExpandedRackTop)
    }
  }, [useMobileViewLayout, isHandExpanded, displayedHumanHand.length])

  const hoveredFieldTargetIds = useMemo(() => {
    // PC版：ホバー中のカードにマッチする場札を計算
    if (isAiTurn || playerIntent !== 'play' || !hoveredHandCardId) {
      return new Set<string>()
    }
    const hoveredCard = humanPlayer.hand.find((card) => card.id === hoveredHandCardId)
    if (!hoveredCard) {
      return new Set<string>()
    }
    const matches = getMatchingFieldCards(hoveredCard, game.field)
    if (matches.length === 0) {
      return new Set<string>()
    }
    return new Set(matches.map((card) => card.id))
  }, [game.field, hoveredHandCardId, humanPlayer.hand, isAiTurn, playerIntent])
  const expandedSelectedFieldTargetIds = useMemo(() => {
    if (
      !isHandExpanded ||
      !expandedSelectedCardId ||
      isAiTurn ||
      playerIntent !== 'play'
    ) {
      return new Set<string>()
    }
    const selectedCard = humanPlayer.hand.find((card) => card.id === expandedSelectedCardId)
    if (!selectedCard) {
      return new Set<string>()
    }
    const matches = getMatchingFieldCards(selectedCard, game.field)
    return new Set(matches.map((card) => card.id))
  }, [expandedSelectedCardId, game.field, humanPlayer.hand, isAiTurn, isHandExpanded, playerIntent])
  const expandedSelectedNoMatchCardId = useMemo(() => {
    const allowSelectedCardFieldCommit = isHandExpanded || !useMobileViewLayout
    if (
      !allowSelectedCardFieldCommit ||
      !expandedSelectedCardId ||
      isAiTurn ||
      playerIntent !== 'play'
    ) {
      return null
    }
    const selectedCard = humanPlayer.hand.find((card) => card.id === expandedSelectedCardId)
    if (!selectedCard) {
      return null
    }
    const matches = getMatchingFieldCards(selectedCard, game.field)
    return matches.length === 0 ? selectedCard.id : null
  }, [expandedSelectedCardId, game.field, humanPlayer.hand, isAiTurn, isHandExpanded, playerIntent, useMobileViewLayout])

  const dropYaku = useMemo(
    () => (game.phase === 'koikoiDecision' && isKoikoiDecisionYakuVisible ? sortedNewYaku : []),
    [game.phase, isKoikoiDecisionYakuVisible, sortedNewYaku],
  )
  const dropCards = useMemo(
    () => (game.phase === 'koikoiDecision' && isKoikoiDecisionYakuVisible ? koikoiDecisionDropCards : []),
    [game.phase, isKoikoiDecisionYakuVisible, koikoiDecisionDropCards],
  )
  const deckRevealCard = useMemo(() => {
    if (game.phase !== 'drawReveal' && game.phase !== 'selectDrawMatch') {
      return null
    }
    if (!game.drawnCard) {
      return null
    }
    const movingFromDeck = moveEffects.some(
      (effect) => effect.fromDeck && effect.card.id === game.drawnCard?.id,
    )
    return movingFromDeck ? null : game.drawnCard
  }, [game.drawnCard, game.phase, moveEffects])
  const hiddenFieldCardIds = useMemo(() => {
    const hidden = new Set<string>()
    moveEffects.forEach((effect) => {
      if (effect.hideFieldCardId) {
        hidden.add(effect.hideFieldCardId)
      }
    })
    const historyLength = game.turnHistory.length
    const latest = game.turnHistory[historyLength - 1]
    if (
      moveEffects.length === 0 &&
      latest?.type === 'addToField' &&
      latest.card &&
      historyLength > animatedAddToFieldHistoryLength
    ) {
      hidden.add(latest.card.id)
    }
    return hidden
  }, [animatedAddToFieldHistoryLength, game.turnHistory, moveEffects])

  useEffect(() => {
    gameRef.current = game
  }, [game])

  useEffect(() => {
    const historyLength = game.turnHistory.length
    if (historyLength < shownTurnDecisionHistoryLengthRef.current) {
      shownTurnDecisionHistoryLengthRef.current = historyLength
    }
    if (historyLength === 0 || historyLength <= shownTurnDecisionHistoryLengthRef.current) {
      return
    }
    shownTurnDecisionHistoryLengthRef.current = historyLength

    const latest = game.turnHistory[historyLength - 1]
    if (latest.type !== 'koikoi' && latest.type !== 'stop') {
      return
    }

    const label = latest.type === 'koikoi' ? 'こいこい！' : 'あがり！'
    const callout: TurnDecisionCallout = {
      id: turnDecisionCalloutIdRef.current,
      kind: latest.type,
      text: label,
      durationMs:
        latest.type === 'koikoi' && latest.player === aiPlayer.id
          ? OPPONENT_KOIKOI_EFFECT_DURATION_MS
          : TURN_DECISION_EFFECT_DURATION_MS,
    }
    turnDecisionCalloutIdRef.current += 1
    setTurnDecisionCallouts((current) => [...current, callout])
  }, [aiPlayer.id, game.players, game.turnHistory, humanPlayer.id, multiplayer.mode])

  useEffect(() => {
    const preloaders = HANAFUDA_CARDS.map((card) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = getCardImageUrl(card)
      return img
    })
    return () => {
      preloaders.forEach((img) => {
        img.src = ''
      })
    }
  }, [])

  useEffect(() => {
    if (!pendingPlaceholderCardId) {
      return
    }
    const hasActiveMove = moveEffects.some((effect) => effect.card.id === pendingPlaceholderCardId)
    if (hasActiveMove) {
      return
    }
    const latest = game.turnHistory[game.turnHistory.length - 1]
    if (!latest?.card || latest.card.id !== pendingPlaceholderCardId) {
      return
    }
    if (latest.type !== 'capture' && latest.type !== 'addToField') {
      return
    }
    const timer = window.setTimeout(() => {
      setPendingHandPlaceholder(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [game.turnHistory, moveEffects, pendingPlaceholderCardId])

  useEffect(() => {
    if (!pendingAiPlaceholderCardId) {
      return
    }
    const hasActiveMove = moveEffects.some((effect) => effect.card.id === pendingAiPlaceholderCardId)
    if (hasActiveMove) {
      return
    }
    const latest = game.turnHistory[game.turnHistory.length - 1]
    if (!latest?.card || latest.card.id !== pendingAiPlaceholderCardId) {
      return
    }
    if (latest.type !== 'capture' && latest.type !== 'addToField') {
      return
    }
    const timer = window.setTimeout(() => {
      setPendingAiHandPlaceholder(null)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [game.turnHistory, moveEffects, pendingAiPlaceholderCardId])

  const collectCardRects = useCallback((): Map<string, DOMRect> => {
    const map = new Map<string, DOMRect>()
    const nodes = document.querySelectorAll<HTMLElement>('[data-card-id]')
    nodes.forEach((node) => {
      const cardId = node.dataset.cardId
      if (!cardId) {
        return
      }
      map.set(cardId, getStableCardRect(node))
    })
    return map
  }, [])

  const appendMoveEffects = useCallback((effects: readonly CardMoveEffect[]) => {
    if (effects.length === 0) {
      return
    }
    const batchId = moveBatchIdRef.current
    moveBatchIdRef.current += 1
    const batchedEffects = effects.map((effect) => ({ ...effect, batchId }))
    moveBatchRemainingRef.current.set(batchId, batchedEffects.length)
    batchedEffects.forEach((effect) => {
      moveEffectByIdRef.current.set(effect.id, effect)
    })
    setMoveEffects((current) => [...current, ...batchedEffects])
  }, [])

  useLayoutEffect(() => {
    prevRectMapRef.current = rectMapRef.current
    rectMapRef.current = collectCardRects()
    const merged = new Map(lastKnownRectMapRef.current)
    rectMapRef.current.forEach((rect, cardId) => {
      merged.set(cardId, rect)
    })
    lastKnownRectMapRef.current = merged
  }, [collectCardRects, game])

  const buildCaptureMoveEffects = useCallback((playerId: 'player1' | 'player2', source: 'hand' | 'draw', card: HanafudaCard, matchedCard: HanafudaCard): CardMoveEffect[] | null => {
    const currentRects = collectCardRects()
    const knownRects = lastKnownRectMapRef.current
    const sourceRect = currentRects.get(card.id) ?? knownRects.get(card.id)
    const matchedRect = currentRects.get(matchedCard.id) ?? knownRects.get(matchedCard.id)
    if (!sourceRect || !matchedRect) {
      return null
    }

    const captureZone = document.querySelector<HTMLElement>(`[data-capture-zone="${playerId}"]`)
    const captureZoneRect = captureZone?.getBoundingClientRect()
    if (!captureZoneRect) {
      return null
    }

    // 獲得ゾーンの中央に移動するように調整
    const zoneBaseX = captureZoneRect.left + captureZoneRect.width * 0.5
    const zoneBaseY = captureZoneRect.top + Math.min(captureZoneRect.height * 0.5, 60)
    const randomSeed = captureEffectIdRef.current * 17
    const targetCardWidth = CAPTURE_STACK_CARD_WIDTH
    const targetCardHeight = targetCardWidth * CARD_HEIGHT_PER_WIDTH
    const overlap = targetCardWidth * (CAPTURE_STACK_OVERLAP_BASE + (randomSeed % 7) * 0.01)
    const randomYOffset = ((randomSeed % 5) - 2) * 2
    const randomRotate = ((randomSeed % 9) - 4) * 1.2
    const centerLeftA = zoneBaseX - overlap / 2
    const centerLeftB = zoneBaseX + overlap / 2

    const isAiHiddenHandCapture = playerId === aiPlayer.id && source === 'hand'
    const useArrivalFlip = isAiHiddenHandCapture && useMobileViewLayout
    const hiddenHandHold = isAiHiddenHandCapture && !useArrivalFlip ? CPU_HAND_REVEAL_HOLD_RATIO : 0
    const concealTargetDuringHiddenFlip = isAiHiddenHandCapture && !useArrivalFlip
    const revealStopWidth = sourceRect.width
    const revealStopHeight = sourceRect.height
    const yakuStopX = zoneBaseX - revealStopWidth / 2
    const yakuStopY = zoneBaseY - revealStopHeight * 0.34
    const playedViaX = useArrivalFlip ? yakuStopX : matchedRect.left
    const playedViaY = useArrivalFlip ? yakuStopY : matchedRect.top
    const playedViaWidth = useArrivalFlip ? revealStopWidth : matchedRect.width
    const playedViaHeight = useArrivalFlip ? revealStopHeight : matchedRect.height
    const matchedCardTilt = stableTilt(matchedCard.id)
    const effectFromPlayed: CardMoveEffect = {
      id: captureEffectIdRef.current,
      card,
      fromX: sourceRect.left,
      fromY: sourceRect.top,
      viaX: playedViaX,
      viaY: playedViaY,
      viaWidth: playedViaWidth,
      viaHeight: playedViaHeight,
      via2X: useArrivalFlip ? matchedRect.left : undefined,
      via2Y: useArrivalFlip ? matchedRect.top : undefined,
      via2Width: useArrivalFlip ? matchedRect.width : undefined,
      via2Height: useArrivalFlip ? matchedRect.height : undefined,
      toX: centerLeftA - targetCardWidth / 2,
      toY: zoneBaseY + randomYOffset,
      width: sourceRect.width,
      height: sourceRect.height,
      toWidth: targetCardWidth,
      toHeight: targetCardHeight,
      rotateStart: -6,
      rotateEnd: randomRotate,
      duration: useArrivalFlip ? STAGED_CAPTURE_DURATION : 1.8,
      zIndex: 5,
      hideFieldCardId: matchedCard.id,
      flipFromBack: isAiHiddenHandCapture,
      flipHoldRatio: hiddenHandHold > 0 ? hiddenHandHold : undefined,
      flipOnArrival: useArrivalFlip,
      fromDeck: source === 'draw',
    }
    captureEffectIdRef.current += 1

    const fieldRotateStart = useArrivalFlip
      ? matchedCardTilt
      : concealTargetDuringHiddenFlip
        ? matchedCardTilt
        : 4
    const effectFromField: CardMoveEffect = {
      id: captureEffectIdRef.current,
      card: matchedCard,
      fromX: matchedRect.left,
      fromY: matchedRect.top,
      viaX: matchedRect.left,
      viaY: matchedRect.top,
      viaWidth: matchedRect.width,
      viaHeight: matchedRect.height,
      via2X: useArrivalFlip ? matchedRect.left : undefined,
      via2Y: useArrivalFlip ? matchedRect.top : undefined,
      via2Width: useArrivalFlip ? matchedRect.width : undefined,
      via2Height: useArrivalFlip ? matchedRect.height : undefined,
      toX: centerLeftB - targetCardWidth / 2,
      toY: zoneBaseY - randomYOffset,
      width: matchedRect.width,
      height: matchedRect.height,
      toWidth: targetCardWidth,
      toHeight: targetCardHeight,
      rotateStart: fieldRotateStart,
      rotateEnd: concealTargetDuringHiddenFlip ? matchedCardTilt - randomRotate * 0.35 : -randomRotate * 0.8,
      duration: useArrivalFlip ? STAGED_CAPTURE_DURATION : 1.8,
      zIndex: 4,
      hideFieldCardId: matchedCard.id,
      flipHoldRatio: hiddenHandHold > 0 ? hiddenHandHold : undefined,
      flipOnArrival: useArrivalFlip,
      freezeBeforeMerge: useArrivalFlip,
    }
    captureEffectIdRef.current += 1
    return [effectFromPlayed, effectFromField]
  }, [aiPlayer.id, collectCardRects, useMobileViewLayout])

  const resolveCaptureSelection = useCallback((fieldCardId: string, source: 'hand' | 'draw'): void => {
    const current = gameRef.current
    const next = source === 'hand' ? selectHandMatch(current, fieldCardId) : selectDrawMatch(current, fieldCardId)
    if (next === current) {
      return
    }

    const latest = next.turnHistory[next.turnHistory.length - 1]
    if (latest?.type === 'capture' && latest.card && latest.matchedCard) {
      const effects = buildCaptureMoveEffects(latest.player, source, latest.card, latest.matchedCard)
      if (effects && effects.length > 0) {
        pendingCaptureGameRef.current = next
        appendMoveEffects(effects)
        return
      }
    }

    setGame(next)
  }, [appendMoveEffects, buildCaptureMoveEffects])

  const executeTurnCommandLocal = useCallback((command: TurnCommand): void => {
    switch (command.type) {
      case 'playHandCard':
        {
          const current = gameRef.current
          if (current.currentPlayerIndex !== localPlayerIndex) {
            const opponent = current.players[current.currentPlayerIndex]
            const handIndex = opponent.hand.findIndex((card) => card.id === command.cardId)
            if (handIndex >= 0) {
              const card = opponent.hand[handIndex]
              if (card) {
                setPendingAiHandPlaceholder({ card, index: handIndex })
              }
            }
          }
        }
        setGame((current) => playHandCard(current, command.cardId))
        return
      case 'selectHandMatch':
        resolveCaptureSelection(command.fieldCardId, 'hand')
        return
      case 'cancelHandSelection':
        setGame((current) => cancelHandSelection(current, command.insertIndex))
        return
      case 'drawStep':
        setGame((current) => drawStep(current))
        return
      case 'commitDrawToField':
        setGame((current) => commitDrawToField(current))
        return
      case 'selectDrawMatch':
        resolveCaptureSelection(command.fieldCardId, 'draw')
        return
      case 'checkTurn':
        setGame((current) => checkTurn(current))
        return
      case 'resolveKoiKoi':
        setGame((current) => resolveKoiKoi(current, command.decision))
        return
      case 'startNextRound':
        setGame((current) => startNextRound(current, command.seed))
        return
      case 'readyNextRound':
        return
      case 'restartGame':
        setGame((current) => createNewGame({
          ...current.config,
          maxRounds: command.maxRounds,
          ...(command.localRules ? { localRules: normalizeLocalRuleSettings(command.localRules) } : {}),
        }, command.seed))
        return
    }
  }, [localPlayerIndex, resolveCaptureSelection])

  const executeTurnCommand = useCallback((command: TurnCommand): boolean => {
    if (multiplayer.mode === 'cpu') {
      executeTurnCommandLocal(command)
      return true
    }

    const normalizedCommand = ensureDeterministicMultiplayerCommand(command)
    const sent = multiplayer.sendTurnCommand(normalizedCommand)
    if (!sent) {
      return false
    }
    // Host is authoritative. Guest applies actions only after host relays them back.
    if (multiplayer.mode === 'p2p-host') {
      executeTurnCommandLocal(normalizedCommand)
    }
    return true
  }, [executeTurnCommandLocal, multiplayer])

  useEffect(() => {
    if (multiplayer.mode === 'cpu' || interactionLocked) {
      return
    }
    if (remoteCommandQueueRef.current.length === 0) {
      return
    }
    const [nextCommand] = remoteCommandQueueRef.current.splice(0, 1)
    if (!nextCommand) {
      return
    }
    executeTurnCommandLocal(nextCommand)
    if (remoteCommandQueueRef.current.length > 0) {
      setRemoteQueueVersion((current) => current + 1)
    }
  }, [executeTurnCommandLocal, interactionLocked, multiplayer.mode, remoteQueueVersion])

  useLayoutEffect(() => {
    const historyLength = game.turnHistory.length
    if (historyLength <= prevTurnHistoryLengthRef.current) {
      prevTurnHistoryLengthRef.current = historyLength
      return
    }

    const latest = game.turnHistory[historyLength - 1]
    // ネットワーク遅延時もアニメーションを飛ばさないようにするため、
    // skipCaptureHistoryLengthRefは、moveEffectsが完全に空になってからクリアされるまでのみ有効にする
    // つまり、複数のアニメーションバッチが処理中の場合は、skipを無視する
    if (skipCaptureHistoryLengthRef.current === historyLength && latest?.type === 'capture' && moveEffects.length === 0) {
      skipCaptureHistoryLengthRef.current = null
      prevTurnHistoryLengthRef.current = historyLength
      return
    }
    prevTurnHistoryLengthRef.current = historyLength
    if (!latest) {
      return
    }

    const currentRects = rectMapRef.current
    const prevRects = prevRectMapRef.current
    const knownRects = lastKnownRectMapRef.current
    if (latest.type === 'capture' && latest.card && latest.matchedCard) {
      const previous = game.turnHistory[historyLength - 2]
      const source: 'hand' | 'draw' =
        previous?.type === 'drawCard' && previous.card?.id === latest.card.id
          ? 'draw'
          : 'hand'
      const effects = buildCaptureMoveEffects(latest.player, source, latest.card, latest.matchedCard)
      if (effects && effects.length > 0) {
        appendMoveEffects(effects)
      }
      return
    }

    if (latest.type === 'addToField' && latest.card) {
      const sourceRect = prevRects.get(latest.card.id) ?? knownRects.get(latest.card.id)
      const targetRect = currentRects.get(latest.card.id)
      if (!sourceRect || !targetRect) {
        return
      }
      const previous = game.turnHistory[historyLength - 2]
      const fromCpuHand =
        latest.player === 'player2' &&
        previous?.type === 'playCard' &&
        previous.card?.id === latest.card.id
      const useStagedAddToField = fromCpuHand && useMobileViewLayout
      const cardTilt = stableTilt(latest.card.id)
      let viaX: number | undefined
      let viaY: number | undefined
      let viaWidth: number | undefined
      let viaHeight: number | undefined
      let rotateStart = cardTilt
      let duration = 1.32
      let flipHoldRatio = fromCpuHand ? CPU_HAND_REVEAL_HOLD_RATIO : undefined
      let flipOnArrival: boolean | undefined

      if (useStagedAddToField) {
        const captureZone = document.querySelector<HTMLElement>(`[data-capture-zone="${latest.player}"]`)
        const captureZoneRect = captureZone?.getBoundingClientRect()
        if (captureZoneRect) {
          const zoneBaseX = captureZoneRect.left + captureZoneRect.width * 0.5
          const zoneBaseY = captureZoneRect.top + Math.min(captureZoneRect.height * 0.5, 60)
          const stopCardWidth = sourceRect.width
          const stopCardHeight = sourceRect.height
          viaX = zoneBaseX - stopCardWidth / 2
          viaY = zoneBaseY - stopCardHeight * 0.34
          viaWidth = stopCardWidth
          viaHeight = stopCardHeight
          rotateStart = -6
          duration = STAGED_ADD_TO_FIELD_DURATION
          flipHoldRatio = undefined
          flipOnArrival = true
        }
      }

      const effect: CardMoveEffect = {
        id: captureEffectIdRef.current,
        card: latest.card,
        fromX: sourceRect.left,
        fromY: sourceRect.top,
        viaX,
        viaY,
        viaWidth,
        viaHeight,
        toX: targetRect.left,
        toY: targetRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
        toWidth: targetRect.width,
        toHeight: targetRect.height,
        rotateStart,
        rotateEnd: cardTilt,
        duration,
        zIndex: 6,
        hideFieldCardId: latest.card.id,
        flipFromBack: fromCpuHand,
        flipHoldRatio,
        flipOnArrival,
        addToFieldHistoryLength: historyLength,
        fromDeck: previous?.type === 'drawCard' && previous.card?.id === latest.card.id,
      }
      captureEffectIdRef.current += 1
      appendMoveEffects([effect])
      return
    }
  }, [appendMoveEffects, buildCaptureMoveEffects, game.turnHistory, moveEffects, useMobileViewLayout])

  useLayoutEffect(() => {
    if (interactionLocked || pendingCaptureGameRef.current) {
      return
    }
    const historyLength = game.turnHistory.length
    if (historyLength === 0 || historyLength <= animatedFieldReflowHistoryLengthRef.current) {
      return
    }
    const latest = game.turnHistory[historyLength - 1]
    const shouldAnimateReflow = latest?.type === 'capture' || latest?.type === 'addToField'
    if (!shouldAnimateReflow) {
      return
    }

    const currentRects = rectMapRef.current
    const prevRects = prevRectMapRef.current
    const knownRects = lastKnownRectMapRef.current
    const effects: CardMoveEffect[] = []
    for (const card of game.field) {
      if (latest?.type === 'addToField' && latest.card?.id === card.id) {
        continue
      }
      const fromRect = prevRects.get(card.id) ?? knownRects.get(card.id)
      const toRect = currentRects.get(card.id)
      if (!fromRect || !toRect) {
        continue
      }
      const movedDistance = Math.hypot(toRect.left - fromRect.left, toRect.top - fromRect.top)
      if (movedDistance < 0.75) {
        continue
      }
      const tilt = stableTilt(card.id)
      effects.push({
        id: captureEffectIdRef.current,
        card,
        fromX: fromRect.left,
        fromY: fromRect.top,
        toX: toRect.left,
        toY: toRect.top,
        width: fromRect.width,
        height: fromRect.height,
        rotateStart: tilt,
        rotateEnd: tilt,
        duration: 0.66,
        zIndex: 3,
        hideFieldCardId: card.id,
      })
      captureEffectIdRef.current += 1
    }

    animatedFieldReflowHistoryLengthRef.current = historyLength
    if (effects.length === 0) {
      return
    }
    appendMoveEffects(effects)
  }, [appendMoveEffects, game.field, game.turnHistory, interactionLocked])

  useLayoutEffect(() => {
    if (moveEffects.length > 0) {
      return
    }
    const pending = pendingCaptureGameRef.current
    if (!pending) {
      return
    }
    pendingCaptureGameRef.current = null
    skipCaptureHistoryLengthRef.current = pending.turnHistory.length
    setGame(pending)
  }, [moveEffects.length])

  useEffect(() => {
    if (!isCpuAiTurn || game.phase !== 'selectHandCard' || interactionLocked) {
      return
    }

    const timer = window.setTimeout(() => {
      const current = gameRef.current
      if (current.phase !== 'selectHandCard' || current.currentPlayerIndex !== opponentPlayerIndex) {
        return
      }
      const aiCard = chooseAiHandCard(current)
      if (aiCard) {
        executeTurnCommand({ type: 'playHandCard', cardId: aiCard.id })
      }
    }, AI_THINK_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [executeTurnCommand, game.phase, interactionLocked, isCpuAiTurn, opponentPlayerIndex])

  useEffect(() => {
    if (!isCpuAiTurn || game.phase !== 'selectFieldMatch' || interactionLocked) {
      return
    }

    const timer = window.setTimeout(() => {
      const current = gameRef.current
      if (current.phase !== 'selectFieldMatch' || current.currentPlayerIndex !== opponentPlayerIndex) {
        return
      }
      const match = chooseAiMatch(current.pendingMatches, current.config.aiDifficulty, current)
      if (match) {
        executeTurnCommand({ type: 'selectHandMatch', fieldCardId: match.id })
      }
    }, AI_THINK_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [executeTurnCommand, game.phase, interactionLocked, isCpuAiTurn, opponentPlayerIndex])

  useEffect(() => {
    if (!canAutoAdvance || game.phase !== 'drawingDeck' || interactionLocked) {
      return
    }

    const timer = window.setTimeout(() => {
      executeTurnCommand({ type: 'drawStep' })
    }, SYSTEM_STEP_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [canAutoAdvance, executeTurnCommand, game.phase, interactionLocked])

  useEffect(() => {
    if (!isCpuAiTurn || game.phase !== 'selectDrawMatch' || interactionLocked) {
      return
    }

    const timer = window.setTimeout(() => {
      const current = gameRef.current
      if (current.phase !== 'selectDrawMatch' || current.currentPlayerIndex !== opponentPlayerIndex) {
        return
      }
      const match = chooseAiMatch(current.pendingMatches, current.config.aiDifficulty, current)
      if (match) {
        executeTurnCommand({ type: 'selectDrawMatch', fieldCardId: match.id })
      }
    }, AI_THINK_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [executeTurnCommand, game.phase, interactionLocked, isCpuAiTurn, opponentPlayerIndex])

  useEffect(() => {
    if (!canAutoAdvance || game.phase !== 'checkYaku' || interactionLocked) {
      return
    }

    const timer = window.setTimeout(() => {
      executeTurnCommand({ type: 'checkTurn' })
    }, SYSTEM_STEP_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [canAutoAdvance, executeTurnCommand, game.phase, interactionLocked])

  useEffect(() => {
    if (!isCpuAiTurn || game.phase !== 'koikoiDecision' || interactionLocked || isKoikoiDecisionSequencing) {
      return
    }

    const timer = window.setTimeout(() => {
      const current = gameRef.current
      if (current.phase !== 'koikoiDecision' || current.currentPlayerIndex !== opponentPlayerIndex) {
        return
      }
      executeTurnCommand({ type: 'resolveKoiKoi', decision: chooseAiKoiKoi(current) })
    }, AI_KOIKOI_DECISION_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [executeTurnCommand, game.phase, interactionLocked, isCpuAiTurn, isKoikoiDecisionSequencing, opponentPlayerIndex])

  const handlePlayCard = useCallback((card: HanafudaCard): void => {
    if (isAiTurn || interactionLocked || playerIntent !== 'play') {
      return
    }
    if (mustPlayMatchingHandCard && !matchableHandIds.has(card.id)) {
      return
    }
    const handIndex = humanPlayer.hand.findIndex((handCard) => handCard.id === card.id)
    if (handIndex >= 0) {
      setPendingHandPlaceholder({ card, index: handIndex })
    }
    executeTurnCommand({ type: 'playHandCard', cardId: card.id })
  }, [
    executeTurnCommand,
    humanPlayer.hand,
    interactionLocked,
    isAiTurn,
    matchableHandIds,
    mustPlayMatchingHandCard,
    playerIntent,
  ])

  const closeExpandedHand = useCallback((): void => {
    clearExpandedSelectionPulseTimer()
    setExpandedSelectionPulseCardId(null)
    setIsHandExpanded(false)
    setExpandedSelectedCardId(null)
  }, [clearExpandedSelectionPulseTimer])
  useEffect(() => {
    if (useMobileViewLayout || !isHandExpanded) {
      return
    }
    closeExpandedHand()
  }, [closeExpandedHand, isHandExpanded, useMobileViewLayout])
  useEffect(() => {
    if (!isHandExpanded || game.phase !== 'koikoiDecision') {
      return
    }
    closeExpandedHand()
  }, [closeExpandedHand, game.phase, isHandExpanded])
  const clearExpandedHandSelection = useCallback((): void => {
    clearExpandedSelectionPulseTimer()
    setExpandedSelectionPulseCardId(null)
    setExpandedSelectedCardId(null)
  }, [clearExpandedSelectionPulseTimer])
  const cancelExpandedHandSelection = useCallback((): void => {
    if (!expandedSelectedCardId) {
      return
    }
    clearExpandedSelectionPulseTimer()
    const targetCardId = expandedSelectedCardId
    setExpandedSelectionPulseCardId(targetCardId)
    expandedSelectionPulseTimerRef.current = window.setTimeout(() => {
      setExpandedSelectedCardId((current) => (current === targetCardId ? null : current))
      setExpandedSelectionPulseCardId((current) => (current === targetCardId ? null : current))
      expandedSelectionPulseTimerRef.current = null
    }, EXPANDED_SELECTION_CANCEL_PULSE_MS)
  }, [clearExpandedSelectionPulseTimer, expandedSelectedCardId])

  const tryCommitExpandedSelectedCardToField = useCallback((targetFieldCardId?: string): boolean => {
    const canCommitSelectedCard = isHandExpanded || !useMobileViewLayout
    if (
      !canCommitSelectedCard ||
      !expandedSelectedCardId ||
      isAiTurn ||
      interactionLocked ||
      playerIntent !== 'play'
    ) {
      return false
    }

    const selectedCard = humanPlayer.hand.find((card) => card.id === expandedSelectedCardId)
    if (!selectedCard) {
      setExpandedSelectedCardId(null)
      return false
    }

    const matches = getMatchingFieldCards(selectedCard, game.field)
    if (matches.length > 0) {
      if (!targetFieldCardId) {
        return false
      }
      const matchedTarget = matches.find((card) => card.id === targetFieldCardId)
      if (!matchedTarget) {
        return false
      }
      const matchedTargetId = matchedTarget.id
      pendingExpandedFieldSelectionRef.current = matchedTargetId
      clearExpandedHandSelection()
      handlePlayCard(selectedCard)
      return true
    }

    if (targetFieldCardId !== FIELD_EMPTY_SLOT_TARGET_ID) {
      return false
    }
    pendingExpandedFieldSelectionRef.current = null
    clearExpandedHandSelection()
    handlePlayCard(selectedCard)
    return true
  }, [
    clearExpandedHandSelection,
    executeTurnCommand,
    expandedSelectedCardId,
    game.field,
    handlePlayCard,
    humanPlayer.hand,
    interactionLocked,
    isAiTurn,
    isHandExpanded,
    playerIntent,
    useMobileViewLayout,
  ])
  const handleEmptyFieldSlotClick = useCallback((event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    if (!expandedSelectedNoMatchCardId) {
      return
    }
    tryCommitExpandedSelectedCardToField(FIELD_EMPTY_SLOT_TARGET_ID)
  }, [expandedSelectedNoMatchCardId, tryCommitExpandedSelectedCardToField])

  useEffect(() => {
    const pendingFieldCardId = pendingExpandedFieldSelectionRef.current
    if (!pendingFieldCardId) {
      return
    }
    if (game.phase !== 'selectFieldMatch' || game.pendingSource !== 'hand') {
      return
    }
    if (!game.pendingMatches.some((card) => card.id === pendingFieldCardId)) {
      pendingExpandedFieldSelectionRef.current = null
      return
    }
    pendingExpandedFieldSelectionRef.current = null
    executeTurnCommand({ type: 'selectHandMatch', fieldCardId: pendingFieldCardId })
  }, [executeTurnCommand, game.pendingMatches, game.pendingSource, game.phase])

  const handleExpandedHandCardClick = useCallback((card: HanafudaCard): void => {
    if (!isHandExpanded) {
      setIsHandExpanded(true)
      return
    }
    if (isAiTurn || interactionLocked || playerIntent !== 'play') {
      return
    }
    if (mustPlayMatchingHandCard && !matchableHandIds.has(card.id)) {
      return
    }
    if (expandedSelectedCardId === card.id) {
      cancelExpandedHandSelection()
      return
    }
    clearExpandedSelectionPulseTimer()
    setExpandedSelectionPulseCardId(null)
    setExpandedSelectedCardId(card.id)
  }, [
    cancelExpandedHandSelection,
    clearExpandedSelectionPulseTimer,
    expandedSelectedCardId,
    interactionLocked,
    isAiTurn,
    isHandExpanded,
    matchableHandIds,
    mustPlayMatchingHandCard,
    playerIntent,
  ])
  const handleDesktopHandCardClick = useCallback((card: HanafudaCard): void => {
    if (isAiTurn || interactionLocked || playerIntent !== 'play') {
      return
    }
    if (mustPlayMatchingHandCard && !matchableHandIds.has(card.id)) {
      return
    }
    if (expandedSelectedCardId === card.id) {
      clearExpandedHandSelection()
      return
    }

    const matches = getMatchingFieldCards(card, game.field)
    if (matches.length > 0) {
      clearExpandedHandSelection()
      handlePlayCard(card)
      return
    }

    clearExpandedSelectionPulseTimer()
    setExpandedSelectionPulseCardId(null)
    setExpandedSelectedCardId(card.id)
  }, [
    clearExpandedHandSelection,
    clearExpandedSelectionPulseTimer,
    expandedSelectedCardId,
    game.field,
    handlePlayCard,
    interactionLocked,
    isAiTurn,
    matchableHandIds,
    mustPlayMatchingHandCard,
    playerIntent,
  ])

  const handleHandPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>, card: HanafudaCard): void => {
    // 手札拡大モード中はドラッグ処理をスキップ（クリックで選択/プレイする）
    if (isHandExpanded) {
      return
    }
    if (!isMobileLayout || isAiTurn || interactionLocked || playerIntent !== 'play') {
      return
    }
    if (mustPlayMatchingHandCard && !matchableHandIds.has(card.id)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setHandDrag({
      pointerId: event.pointerId,
      cardId: card.id,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      startTime: performance.now(),
    })
  }, [interactionLocked, isAiTurn, isHandExpanded, isMobileLayout, matchableHandIds, mustPlayMatchingHandCard, playerIntent])

  const handleHandPointerMove = useCallback((event: PointerEvent<HTMLButtonElement>): void => {
    setHandDrag((current) => {
      if (!current || current.pointerId !== event.pointerId) {
        return current
      }
      return {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY,
      }
    })
  }, [])

  const finishHandPointerGesture = useCallback((event: PointerEvent<HTMLButtonElement>, card: HanafudaCard, canceled: boolean): void => {
    if (!isMobileLayout) {
      return
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setHandDrag((current) => {
      if (!current || current.pointerId !== event.pointerId || current.cardId !== card.id) {
        return current
      }
      if (!canceled) {
        const dx = current.currentX - current.startX
        const dy = current.currentY - current.startY
        const distance = Math.hypot(dx, dy)
        const elapsed = Math.max(1, performance.now() - current.startTime)
        const speed = distance / elapsed
        const isFlick =
          distance >= FLICK_MIN_DISTANCE_PX &&
          speed >= FLICK_MIN_SPEED_PX_PER_MS &&
          dy <= FLICK_MIN_UPWARD_DELTA_PX
        const isTap = distance <= TAP_MAX_DISTANCE_PX && elapsed <= TAP_MAX_DURATION_MS
        if (isFlick || isTap) {
          // 非拡大状態では拡大のみ（カードは出さない）
          if (!isHandExpanded) {
            setIsHandExpanded(true)
          } else {
            handlePlayCard(card)
          }
        }
      }
      return null
    })
  }, [handlePlayCard, isHandExpanded, isMobileLayout])

  const handleCancelHandSelection = useCallback((): void => {
    if (
      isAiTurn ||
      interactionLocked ||
      game.phase !== 'selectFieldMatch' ||
      game.pendingSource !== 'hand' ||
      !game.selectedHandCard
    ) {
      return
    }

    const player = game.players[game.currentPlayerIndex]
    const placeholderIndex =
      pendingHandPlaceholder?.card.id === game.selectedHandCard?.id
        ? pendingHandPlaceholder.index
        : player.hand.length
    executeTurnCommand({ type: 'cancelHandSelection', insertIndex: placeholderIndex })
    setPendingHandPlaceholder(null)
  }, [executeTurnCommand, game.currentPlayerIndex, game.pendingSource, game.phase, game.players, game.selectedHandCard, interactionLocked, isAiTurn, pendingHandPlaceholder])

  const handleBoardClick = useCallback((event: MouseEvent<HTMLElement>): void => {
    // 拡大中は、手札外クリックで選択解除/縮小（場札選択中は維持）
    const target = event.target as HTMLElement | null
    const tappedHandCard = Boolean(target?.closest('.player-rack [data-card-id]'))
    if (
      !isHandExpanded &&
      expandedSelectedCardId &&
      playerIntent === 'play' &&
      !tappedHandCard
    ) {
      clearExpandedHandSelection()
    }
    const tappedFieldCardForSelection = Boolean(target?.closest('.field-rack-inner [data-card-id]'))
    const keepExpandedForFieldSelection =
      isHandExpanded &&
      playerIntent === 'select-hand-match' &&
      tappedFieldCardForSelection
    if (
      isHandExpanded &&
      playerIntent === 'play' &&
      expandedSelectedFieldTargetIds.size > 0 &&
      tappedFieldCardForSelection
    ) {
      return
    }
    if (
      isHandExpanded &&
      playerIntent !== 'select-hand-match' &&
      target &&
      !target.closest('.player-rack') &&
      !keepExpandedForFieldSelection
    ) {
      if (expandedSelectedCardId) {
        cancelExpandedHandSelection()
      } else {
        closeExpandedHand()
      }
    }
    // 拡大中は、通常時のみここで処理を打ち切る。
    // select-hand-match中は「閉じる」より「選択キャンセル」を優先する。
    if (isHandExpanded && playerIntent !== 'select-hand-match') {
      return
    }

    if (
      isAiTurn ||
      interactionLocked ||
      game.phase !== 'selectFieldMatch' ||
      game.pendingSource !== 'hand'
    ) {
      return
    }
    if (!target) {
      return
    }
    if (target.closest('.field-rack-inner')) {
      const tappedFieldCard = target.closest('[data-card-id]')
      if (!tappedFieldCard) {
        handleCancelHandSelection()
      }
      return
    }
    handleCancelHandSelection()
  }, [
    closeExpandedHand,
    game.pendingSource,
    game.phase,
    clearExpandedHandSelection,
    handleCancelHandSelection,
    interactionLocked,
    isAiTurn,
    isHandExpanded,
    expandedSelectedCardId,
    cancelExpandedHandSelection,
    expandedSelectedFieldTargetIds,
    playerIntent,
    tryCommitExpandedSelectedCardToField,
  ])

  const handleAppPointerDown = useCallback((event: PointerEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement | null
    if (!target) {
      return
    }
    if (!target.closest('.lobby-input')) {
      const active = document.activeElement
      if (active instanceof HTMLElement && active.matches('input, textarea, [contenteditable="true"]')) {
        active.blur()
      }
    }
    if (isChromeCollapsed) {
      return
    }
    if (
      target.closest('.app-chrome-panel') ||
      target.closest('.header-settings-toggle-button') ||
      target.closest('.score-table-overlay') ||
      target.closest('.local-rule-overlay') ||
      target.closest('.rule-help-overlay')
    ) {
      return
    }
    setIsChromeCollapsed(true)
  }, [isChromeCollapsed])

  const handleFieldCard = (card: HanafudaCard): void => {
    if (isAiTurn || interactionLocked) {
      return
    }

    if (playerIntent === 'play' && isHandExpanded && expandedSelectedCardId) {
      if (tryCommitExpandedSelectedCardToField(card.id)) {
        return
      }
      return
    }

    if (playerIntent === 'select-hand-match') {
      if (highlightFieldIds.has(card.id)) {
        executeTurnCommand({ type: 'selectHandMatch', fieldCardId: card.id })
      } else {
        handleCancelHandSelection()
      }
      return
    }

    if (playerIntent === 'select-draw-match') {
      executeTurnCommand({ type: 'selectDrawMatch', fieldCardId: card.id })
    }
  }

  const resetTransientUiState = useCallback((): void => {
    setPendingHandPlaceholder(null)
    setPendingAiHandPlaceholder(null)
    setHandDrag(null)
    setMoveEffects([])
    setTurnDecisionCallouts([])
    setAnimatedAddToFieldHistoryLength(0)
    setRemoteQueueVersion(0)
    setIsLocalRulePanelVisible(false)
    setIsRuleHelpVisible(false)
    setRuleHelpPageIndex(0)
    remoteCommandQueueRef.current = []
    pendingCaptureGameRef.current = null
    skipCaptureHistoryLengthRef.current = null
    moveEffectByIdRef.current.clear()
    moveBatchRemainingRef.current.clear()
  }, [])

  const handleSwitchToCpu = useCallback((): void => {
    clearCpuCheckpoint()
    setIsMatchSurfaceVisible(true)
    setIsChromeCollapsed(true)
    resetTransientUiState()
    multiplayer.teardownToCpu()
    setGame(createNewGame({
      ...game.config,
      maxRounds: selectedRoundCount,
      localRules: localRulesForPanel,
      enableAI: true,
      player1Name: DEFAULT_CONFIG.player1Name,
      player2Name: DEFAULT_CONFIG.player2Name,
    }))
  }, [game.config, localRulesForPanel, multiplayer, resetTransientUiState, selectedRoundCount])

  const handleChangeAiDifficulty = useCallback((difficulty: 'yowai' | 'futsuu' | 'tsuyoi' | 'yabai' | 'oni' | 'kami'): void => {
    if (multiplayer.mode !== 'cpu') {
      return
    }
    setGame((prev) => ({
      ...prev,
      config: { ...prev.config, aiDifficulty: difficulty },
    }))
  }, [multiplayer.mode])

  const handleStartHost = useCallback((): void => {
    clearCpuCheckpoint()
    setIsMatchSurfaceVisible(false)
    setIsChromeCollapsed(false)  // 部屋作成時はヘッダーを隠さない
    resetTransientUiState()
    const initial = createNewGame({
      ...game.config,
      maxRounds: selectedRoundCount,
      localRules: localRulesForPanel,
      enableAI: false,
      player1Name: 'あなた',
      player2Name: '相手',
    })
    setGame(initial)
    multiplayer.startHost(initial, undefined, false)
  }, [game.config, localRulesForPanel, multiplayer, resetTransientUiState, selectedRoundCount])

  const handleJoinGuest = useCallback((): void => {
    clearCpuCheckpoint()
    setIsMatchSurfaceVisible(false)
    setIsChromeCollapsed(isMobileLayout)
    resetTransientUiState()
    const initial = createNewGame({
      ...game.config,
      localRules: localRulesForPanel,
      enableAI: false,
      player1Name: '相手',
      player2Name: 'あなた',
    })
    setGame(initial)
    multiplayer.joinAsGuest(initial)
  }, [game.config, isMobileLayout, localRulesForPanel, multiplayer, resetTransientUiState])

  const handleLeaveMultiplayer = useCallback((): void => {
    clearCpuCheckpoint()
    setIsMatchSurfaceVisible(false)
    setIsChromeCollapsed(isMobileLayout)
    resetTransientUiState()
    multiplayer.leaveMultiplayer()
    const restoredRoundCount = getInitialRoundCount()
    const restoredLocalRules = getInitialLocalRules()
    setSelectedRoundCount(restoredRoundCount)
    setGame(createNewGame({
      ...DEFAULT_CONFIG,
      maxRounds: restoredRoundCount,
      localRules: restoredLocalRules,
      enableAI: true,
      player1Name: DEFAULT_CONFIG.player1Name,
      player2Name: DEFAULT_CONFIG.player2Name,
    }))
  }, [isMobileLayout, multiplayer, resetTransientUiState])

  const restartWithConfig = useCallback((nextConfig: KoiKoiGameState['config']): void => {
    resetTransientUiState()
    if (multiplayer.mode === 'cpu') {
      setGame(createNewGame(nextConfig))
      return
    }
    if (multiplayer.mode === 'p2p-host') {
      const initial = createNewGame({
        ...nextConfig,
        enableAI: false,
        player1Name: 'あなた',
        player2Name: '相手',
      })
      setGame(initial)
      multiplayer.startHost(initial, multiplayer.roomId, false)
      return
    }
    multiplayer.reconnect(gameRef.current)
  }, [multiplayer, resetTransientUiState])

  const applyLocalRuleChange = useCallback((nextRules: LocalRuleSettings): void => {
    const normalized = normalizeLocalRuleSettings(nextRules)
    if (isLobbyConnected) {
      return
    }
    saveLocalRuleSettings(normalized)
    setDraftLocalRules((current) => (areLocalRulesEqual(current, normalized) ? current : normalized))
    if (multiplayer.mode === 'cpu') {
      if (hasMatchStarted) {
        return
      }
      setGame((prev) => ({
        ...prev,
        config: { ...prev.config, localRules: normalized },
      }))
      return
    }
    if (hasMatchStarted) {
      return
    }
    restartWithConfig({
      ...game.config,
      localRules: normalized,
    })
  }, [game.config, hasMatchStarted, isLobbyConnected, multiplayer.mode, restartWithConfig])

  const handleChangeYakuPoint = useCallback((yakuType: YakuType, rawValue: string): void => {
    const parsed = Number.parseInt(rawValue, 10)
    const nextValue = Number.isFinite(parsed) ? parsed : 0
    applyLocalRuleChange(
      normalizeLocalRuleSettings({
        ...localRulesForPanel,
        yakuPoints: {
          ...localRulesForPanel.yakuPoints,
          [yakuType]: nextValue,
        },
      }),
    )
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeYakuEnabled = useCallback((yakuType: YakuType, enabled: boolean): void => {
    const nextRules = normalizeLocalRuleSettings({
      ...localRulesForPanel,
      yakuEnabled: {
        ...localRulesForPanel.yakuEnabled,
        [yakuType]: enabled,
      },
    })

    if (!enabled) {
      if (yakuType === 'hanami-zake') {
        applyLocalRuleChange({ ...nextRules, enableAmeNagare: false })
        return
      }
      if (yakuType === 'tsukimi-zake') {
        applyLocalRuleChange({ ...nextRules, enableKiriNagare: false })
        return
      }
    }
    applyLocalRuleChange(nextRules)
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeKoiKoiBonusMode = useCallback((mode: LocalRuleSettings['koiKoiBonusMode']): void => {
    applyLocalRuleChange({
      ...localRulesForPanel,
      koiKoiBonusMode: mode,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleToggleKoiKoiShowdown = useCallback((enabled: boolean): void => {
    applyLocalRuleChange({
      ...localRulesForPanel,
      enableKoiKoiShowdown: enabled,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeSelfKoiBonusFactor = useCallback((rawValue: string): void => {
    const parsed = Number.parseInt(rawValue, 10)
    const nextValue = Number.isFinite(parsed) ? parsed : DEFAULT_LOCAL_RULE_SETTINGS.selfKoiBonusFactor
    applyLocalRuleChange({
      ...localRulesForPanel,
      selfKoiBonusFactor: nextValue,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeOpponentKoiBonusFactor = useCallback((rawValue: string): void => {
    const parsed = Number.parseInt(rawValue, 10)
    const nextValue = Number.isFinite(parsed) ? parsed : DEFAULT_LOCAL_RULE_SETTINGS.opponentKoiBonusFactor
    applyLocalRuleChange({
      ...localRulesForPanel,
      opponentKoiBonusFactor: nextValue,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeNoYakuPolicy = useCallback((policy: LocalRuleSettings['noYakuPolicy']): void => {
    applyLocalRuleChange({
      ...localRulesForPanel,
      noYakuPolicy: policy,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeNoYakuParentPoints = useCallback((rawValue: string): void => {
    const parsed = Number.parseInt(rawValue, 10)
    const nextValue = Number.isFinite(parsed) ? parsed : DEFAULT_LOCAL_RULE_SETTINGS.noYakuParentPoints
    applyLocalRuleChange({
      ...localRulesForPanel,
      noYakuParentPoints: nextValue,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeNoYakuChildPoints = useCallback((rawValue: string): void => {
    const parsed = Number.parseInt(rawValue, 10)
    const nextValue = Number.isFinite(parsed) ? parsed : DEFAULT_LOCAL_RULE_SETTINGS.noYakuChildPoints
    applyLocalRuleChange({
      ...localRulesForPanel,
      noYakuChildPoints: nextValue,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleToggleAmeNagare = useCallback((enabled: boolean): void => {
    if (!localRulesForPanel.yakuEnabled['hanami-zake']) {
      return
    }
    applyLocalRuleChange({
      ...localRulesForPanel,
      enableAmeNagare: enabled,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleToggleKiriNagare = useCallback((enabled: boolean): void => {
    if (!localRulesForPanel.yakuEnabled['tsukimi-zake']) {
      return
    }
    applyLocalRuleChange({
      ...localRulesForPanel,
      enableKiriNagare: enabled,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeKoikoiLimit = useCallback((rawValue: string): void => {
    const parsed = Number.parseInt(rawValue, 10)
    const nextValue = Number.isFinite(parsed) ? parsed : DEFAULT_LOCAL_RULE_SETTINGS.koikoiLimit
    applyLocalRuleChange({
      ...localRulesForPanel,
      koikoiLimit: nextValue,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeDealerRotationMode = useCallback((mode: LocalRuleSettings['dealerRotationMode']): void => {
    applyLocalRuleChange({
      ...localRulesForPanel,
      dealerRotationMode: mode,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleToggleDrawOvertime = useCallback((enabled: boolean): void => {
    applyLocalRuleChange({
      ...localRulesForPanel,
      enableDrawOvertime: enabled,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeDrawOvertimeMode = useCallback((mode: LocalRuleSettings['drawOvertimeMode']): void => {
    applyLocalRuleChange({
      ...localRulesForPanel,
      drawOvertimeMode: mode,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleChangeDrawOvertimeRounds = useCallback((rawValue: string): void => {
    const parsed = Number.parseInt(rawValue, 10)
    const nextValue = Number.isFinite(parsed) ? parsed : DEFAULT_LOCAL_RULE_SETTINGS.drawOvertimeRounds
    applyLocalRuleChange({
      ...localRulesForPanel,
      drawOvertimeRounds: nextValue,
    })
  }, [applyLocalRuleChange, localRulesForPanel])

  const handleRestart = useCallback((): void => {
    if (isLobbyConnected) {
      const currentMaxRounds = ROUND_COUNT_OPTIONS.includes(game.config.maxRounds as (typeof ROUND_COUNT_OPTIONS)[number])
        ? (game.config.maxRounds as (typeof ROUND_COUNT_OPTIONS)[number])
        : DEFAULT_ROUND_COUNT
      resetTransientUiState()
      executeTurnCommand({
        type: 'restartGame',
        maxRounds: currentMaxRounds,
        localRules: activeLocalRules,
      })
      return
    }
    if (multiplayer.mode === 'cpu') {
      restartWithConfig({
        ...game.config,
        maxRounds: selectedRoundCount,
        localRules: localRulesForPanel,
      })
      return
    }
    restartWithConfig(game.config)
  }, [
    activeLocalRules,
    executeTurnCommand,
    game.config,
    isLobbyConnected,
    localRulesForPanel,
    multiplayer.mode,
    resetTransientUiState,
    restartWithConfig,
    selectedRoundCount,
  ])

  const handleResetLocalRulesToDefaults = useCallback((): void => {
    if (!canEditLocalRules) {
      return
    }

    const defaultRoundCount = DEFAULT_ROUND_COUNT
    const defaultRules = normalizeLocalRuleSettings(DEFAULT_LOCAL_RULE_SETTINGS)
    resetLocalRuleSettings()
    saveLocalRuleSettings(defaultRules)
    savePreferredRoundCount(defaultRoundCount)
    setDraftLocalRules(defaultRules)
    setSelectedRoundCount(defaultRoundCount)

    if (multiplayer.mode === 'cpu') {
      if (hasMatchStarted) {
        return
      }
      setGame((prev) => ({
        ...prev,
        config: {
          ...prev.config,
          maxRounds: defaultRoundCount,
          localRules: defaultRules,
        },
      }))
      return
    }

    if (!isMatchSurfaceVisible) {
      applyLocalRuleChange(defaultRules)
      return
    }

    resetTransientUiState()
    executeTurnCommand({
      type: 'restartGame',
      maxRounds: defaultRoundCount,
      localRules: defaultRules,
    })
  }, [
    applyLocalRuleChange,
    canEditLocalRules,
    executeTurnCommand,
    hasMatchStarted,
    isMatchSurfaceVisible,
    multiplayer.mode,
    resetTransientUiState,
  ])

  const handleSelectRoundCount = useCallback((maxRounds: (typeof ROUND_COUNT_OPTIONS)[number]): void => {
    if (!canSelectRoundCount) {
      return
    }
    setSelectedRoundCount(maxRounds)
    savePreferredRoundCount(maxRounds)
    if (multiplayer.mode === 'cpu') {
      if (hasMatchStarted) {
        return
      }
      setGame((prev) => ({
        ...prev,
        config: { ...prev.config, maxRounds },
      }))
      return
    }
    if (!isMatchSurfaceVisible || !canSelectRoundCount || game.config.maxRounds === maxRounds) {
      return
    }
    resetTransientUiState()
    executeTurnCommand({ type: 'restartGame', maxRounds, localRules: activeLocalRules })
  }, [
    activeLocalRules,
    canSelectRoundCount,
    executeTurnCommand,
    game.config,
    hasMatchStarted,
    isMatchSurfaceVisible,
    multiplayer.mode,
    resetTransientUiState,
  ])
  const handleRequestNextRound = useCallback((): void => {
    setPendingHandPlaceholder(null)
    setPendingAiHandPlaceholder(null)
    if (multiplayer.mode === 'cpu') {
      executeTurnCommand({ type: 'startNextRound' })
      return
    }
    if (multiplayer.connectionStatus !== 'connected') {
      return
    }
    executeTurnCommand({ type: 'startNextRound' })
  }, [
    executeTurnCommand,
    multiplayer.connectionStatus,
    multiplayer.mode,
  ])
  const showingLastRoundSummary = game.phase === 'roundEnd' || (game.phase === 'gameOver' && !isFinalResultVisible)
  const roundEndPrimaryActionLabel = game.phase === 'gameOver' ? '最終結果へ' : '次の月へ'
  const roundEndPrimaryActionDisabled = game.phase === 'roundEnd'
    ? multiplayer.mode !== 'cpu' && multiplayer.connectionStatus !== 'connected'
    : false
  const handleRoundEndPrimaryAction = useCallback((): void => {
    if (game.phase === 'gameOver') {
      setIsFinalResultVisible(true)
      return
    }
    handleRequestNextRound()
  }, [game.phase, handleRequestNextRound])
  const roundEndMessageLines = roundPointBreakdownLines


  const fieldRow = (
    <div className="field-row">
      <DeckZone
        deckCount={game.deck.length}
        isDrawing={game.phase === 'drawingDeck'}
        revealedCard={deckRevealCard}
        isRevealing={game.phase === 'drawReveal'}
        onRevealComplete={
          canAutoAdvance
            ? () => executeTurnCommand({ type: 'commitDrawToField' })
            : undefined
        }
      />
      <div className="field-rack">
        <div className="card-rack field-rack-inner">
          {game.field.map((card) => {
            if (hiddenFieldCardIds.has(card.id)) {
              return (
                <div
                  key={card.id}
                  className="card-tile card-slot-placeholder"
                  data-card-id={card.id}
                  style={{ rotate: `${stableTilt(card.id)}deg` }}
                  aria-hidden="true"
                />
              )
            }
            const selectingField = !isAiTurn && !interactionLocked && (playerIntent === 'select-hand-match' || playerIntent === 'select-draw-match')
            const selectingExpandedFieldTarget =
              !isAiTurn &&
              !interactionLocked &&
              playerIntent === 'play' &&
              isHandExpanded &&
              expandedSelectedFieldTargetIds.size > 0
            const selectable = (selectingField && highlightFieldIds.has(card.id)) || (selectingExpandedFieldTarget && expandedSelectedFieldTargetIds.has(card.id))
            const clickable =
              (selectingField && (playerIntent === 'select-hand-match' || selectable)) ||
              (selectingExpandedFieldTarget && expandedSelectedFieldTargetIds.has(card.id))
            // PC版：ホバー中の手札にマッチする場札をハイライト
            const hoveringHand = !isAiTurn && !interactionLocked && playerIntent === 'play' && hoveredFieldTargetIds.size > 0
            const hoverHighlighted = hoveringHand && hoveredFieldTargetIds.has(card.id)
            const dimmed = (selectingField || selectingExpandedFieldTarget) && !selectable
            const highlighted = selectable || hoverHighlighted

            return (
              <CardTile
                key={card.id}
                card={card}
                selectable={selectable}
                clickable={clickable}
                highlighted={highlighted}
                dimmed={dimmed}
                tilt={stableTilt(card.id)}
                onClick={() => handleFieldCard(card)}
              />
            )
          })}
          {expandedSelectedNoMatchCardId ? (
            <button
              type="button"
              className="field-empty-slot-target"
              aria-label="この場所に場へ出す"
              onClick={handleEmptyFieldSlotClick}
            />
          ) : null}
        </div>
      </div>
    </div>
  )

  return (
    <main ref={appContainerRef} className={`app ${isChromeCollapsed ? 'chrome-collapsed' : ''}`} onPointerDown={handleAppPointerDown}>
      {!isLocalRulePanelVisible ? (
        <section className={`app-chrome ${isChromeCollapsed ? 'collapsed' : 'expanded'}`}>
          <div className={`chrome-toggle-row ${!useMobileViewLayout ? 'desktop-controls' : ''}`}>
            {isMobileLayout && !isLandscapeFullscreen ? (
              <button
                type="button"
                className="fullscreen-button compact"
                onClick={enterLandscapeFullscreen}
              >
                フルスクリーン
              </button>
            ) : null}
            {isLandscapeFullscreen ? (
              <button
                type="button"
                className="fullscreen-button active"
                onClick={exitLandscapeFullscreen}
              >
                通常表示に戻す
              </button>
            ) : null}
            <button
              type="button"
              className="chrome-toggle-button"
              onClick={() => {
                setIsRuleHelpVisible(false)
                setIsScoreTableVisible((current) => !current)
              }}
            >
              {isScoreTableVisible ? '点数表を閉じる' : '点数表'}
            </button>
            <button
              type="button"
              className="chrome-toggle-button header-settings-toggle-button"
              onClick={() => setIsChromeCollapsed((current) => !current)}
              aria-expanded={!isChromeCollapsed}
            >
              {isChromeCollapsed ? 'ヘッダー/設定を開く' : 'ヘッダー/設定を閉じる'}
            </button>
          </div>

          {!isChromeCollapsed ? (
            <div className="app-chrome-panel">
              <header className="topbar">
                <h1>花札 こいこい</h1>
                <button
                  type="button"
                  className="lobby-local-rule-button"
                  onClick={() => {
                    setIsRuleHelpVisible(false)
                    setIsScoreTableVisible(false)
                    setIsLocalRulePanelVisible(true)
                  }}
                >
                  ローカルルール
                </button>
              </header>
              <span className="visually-hidden" aria-live="polite">{phaseMessage}</span>

              <section className="cpu-battle-section">
                <div className="cpu-battle-controls">
                  <button
                    type="button"
                    className="cpu-start-button"
                    onClick={handleSwitchToCpu}
                  >
                    CPU対戦
                  </button>
                  <div className="difficulty-selector">
                    <div className="difficulty-buttons">
                      {(['yowai', 'futsuu', 'tsuyoi', 'yabai', 'oni', 'kami'] as const).map((difficulty) => (
                        <button
                          key={difficulty}
                          type="button"
                          className={`difficulty-button ${game.config.aiDifficulty === difficulty ? 'active' : ''}`}
                          onClick={() => handleChangeAiDifficulty(difficulty)}
                        >
                          {AI_DIFFICULTY_LABELS[difficulty]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <MultiplayerLobby
                mode={multiplayer.mode}
                connectionStatus={multiplayer.connectionStatus}
                connectionLogs={multiplayer.connectionLogs}
                roomId={multiplayer.roomId}
                hostRoomId={multiplayer.hostRoomId}
                onHostRoomIdChange={multiplayer.setHostRoomId}
                joinRoomId={multiplayer.joinRoomId}
                onJoinRoomIdChange={multiplayer.setJoinRoomId}
                onStartHost={handleStartHost}
                onJoinGuest={handleJoinGuest}
                onReconnect={() => multiplayer.reconnect(gameRef.current)}
                onLeave={handleLeaveMultiplayer}
              />
              <p className="app-chrome-credit">
                {CARD_ART_CREDIT_TEXT}
                {' '}
                <a href={CARD_ART_SOURCE_URL} target="_blank" rel="noreferrer">出典</a>
                {' | '}
                <a href={CARD_ART_LICENSE_URL} target="_blank" rel="noreferrer">{CARD_ART_LICENSE_TEXT}</a>
                {' | '}
                {CARD_ART_MODIFICATION_TEXT}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      <button
        type="button"
        className={`rule-help-fab ${isRuleHelpVisible ? 'active' : ''}`}
        onClick={openRuleHelp}
        aria-haspopup="dialog"
        aria-expanded={isRuleHelpVisible}
        aria-controls="rule-help-panel"
      >
        札/役ガイド
      </button>

      {isMatchSurfaceVisible ? (
        <section className={`table-layout ${useMobileViewLayout ? 'mobile' : ''}`}>
          {!useMobileViewLayout ? (
            <RoleYakuPanel
              captureZoneId={aiPlayer.id}
              title={opponentDisplayName}
              score={aiPanelView.score}
              captured={aiPanelView.captured}
              yaku={aiPanelView.completedYaku}
              blockedCardIds={aiBlockedCardIds}
              ruleOptions={{
                enableHanamiZake: activeLocalRules.yakuEnabled['hanami-zake'],
                enableTsukimiZake: activeLocalRules.yakuEnabled['tsukimi-zake'],
                enableFourCardsYaku: activeLocalRules.yakuEnabled.shiten,
                enableAmeNagare: activeLocalRules.yakuEnabled['hanami-zake'] && activeLocalRules.enableAmeNagare,
                enableKiriNagare: activeLocalRules.yakuEnabled['tsukimi-zake'] && activeLocalRules.enableKiriNagare,
              }}
              active={game.currentPlayerIndex === opponentPlayerIndex}
              side="left"
            />
          ) : null}

          <section className={`board-center ${useMobileViewLayout ? 'mobile' : ''}`} aria-label="対局ボード" onClick={handleBoardClick}>
            <div className="mobile-round-indicator" aria-label="現在の月">
              {`第 ${game.round} / ${game.config.maxRounds} 月`}
            </div>
            <div className={`card-rack opponent-rack ${useMobileViewLayout ? 'hand-flat' : ''} ${game.currentPlayerIndex === opponentPlayerIndex ? 'active-turn' : ''}`}>
              {displayedAiHand.map((card) => {
                const isPlaceholder = pendingAiPlaceholderCardId === card.id
                const hasActiveMove = activeMoveCardIdSet.has(card.id)
                const baseTilt = useMobileViewLayout ? 0 : stableTilt(card.id)
                if (isPlaceholder) {
                  if (!hasActiveMove) {
                    return (
                      <CardTile
                        key={`${card.id}-ai-pending`}
                        card={card}
                        hidden
                        tilt={baseTilt}
                        layout
                      />
                    )
                  }
                  return (
                    <motion.div
                      key={`${card.id}-ai-placeholder`}
                      className="card-tile card-slot-placeholder hand-slot-placeholder"
                      style={{ rotate: baseTilt }}
                      layout="position"
                      transition={HAND_LAYOUT_TRANSITION}
                      aria-hidden="true"
                    />
                  )
                }
                return (
                  <CardTile
                    key={card.id}
                    card={card}
                    hidden
                    tilt={baseTilt}
                    layout
                  />
                )
              })}
            </div>

            {/* 相手の役（モバイルのみ・相手の手札の下） */}
            {useMobileViewLayout ? (
              <MobileYakuRow
                captured={aiPanelView.captured}
                visibleProgressEntries={aiVisibleProgressEntries}
                title={opponentDisplayName}
                score={aiPanelView.score}
                active={game.currentPlayerIndex === opponentPlayerIndex}
                captureZoneId={aiPlayer.id}
              />
            ) : null}

            {/* 場（中央） */}
            {fieldRow}

            {/* 手札拡大時の背景オーバーレイ（選択中は選択解除、未選択時は閉じる） */}
            {useMobileViewLayout && isHandExpanded && (
              <div
                className="hand-expanded-backdrop"
                onTouchEnd={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (playerIntent === 'select-hand-match') {
                    handleCancelHandSelection()
                    return
                  }
                  if (!tryCommitExpandedSelectedCardToField()) {
                    if (expandedSelectedCardId) {
                      cancelExpandedHandSelection()
                    } else {
                      closeExpandedHand()
                    }
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (playerIntent === 'select-hand-match') {
                    handleCancelHandSelection()
                    return
                  }
                  if (!tryCommitExpandedSelectedCardToField()) {
                    if (expandedSelectedCardId) {
                      cancelExpandedHandSelection()
                    } else {
                      closeExpandedHand()
                    }
                  }
                }}
              />
            )}

            {/* 手札拡大時のレイアウト維持用プレースホルダー */}
            {useMobileViewLayout && isHandExpanded && (
              <div
                ref={expandedHandPlaceholderRef}
                className="card-rack player-rack hand-flat player-rack-placeholder"
                onTouchEnd={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (playerIntent === 'select-hand-match') {
                    handleCancelHandSelection()
                    return
                  }
                  if (expandedSelectedCardId) {
                    cancelExpandedHandSelection()
                  } else {
                    closeExpandedHand()
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (playerIntent === 'select-hand-match') {
                    handleCancelHandSelection()
                    return
                  }
                  if (expandedSelectedCardId) {
                    cancelExpandedHandSelection()
                  } else {
                    closeExpandedHand()
                  }
                }}
              >
                {displayedHumanHand.map((card) => (
                  <div key={`placeholder-${card.id}`} className="card-tile card-slot-placeholder" />
                ))}
              </div>
            )}

            <div
              className={`card-rack player-rack ${useMobileViewLayout ? 'hand-flat' : ''} ${game.currentPlayerIndex === localPlayerIndex ? 'active-turn' : ''} ${useMobileViewLayout && isHandExpanded ? 'expanded' : ''} ${useMobileViewLayout && isHandExpanded && expandedRackTop !== null ? 'expanded-top-aligned' : ''}`}
              style={
                useMobileViewLayout && isHandExpanded && expandedRackTop !== null
                  ? ({ '--expanded-rack-top': `${expandedRackTop}px` } as CSSProperties)
                  : undefined
              }
              onClick={useMobileViewLayout ? (event) => {
                const target = event.target as HTMLElement | null
                const tappedCard = Boolean(target?.closest('[data-card-id]'))

                if (isHandExpanded) {
                  if (!tappedCard) {
                    event.stopPropagation()
                    if (playerIntent === 'select-hand-match') {
                      handleCancelHandSelection()
                    } else {
                      if (expandedSelectedCardId) {
                        cancelExpandedHandSelection()
                      } else {
                        closeExpandedHand()
                      }
                    }
                  }
                  return
                }

                if (isAiTurn || interactionLocked) return
                setIsHandExpanded(true)
              } : undefined}
            >
              {displayedHumanHand.map((card) => {
                const isPlaceholder = pendingPlaceholderCardId === card.id
                const baseTilt = useMobileViewLayout ? 0 : stableTilt(card.id)
                const dragging = handDrag?.cardId === card.id
                const dragX = dragging ? handDrag.currentX - handDrag.startX : 0
                const dragY = dragging ? handDrag.currentY - handDrag.startY : 0
                if (isPlaceholder) {
                  if (
                    game.phase === 'selectFieldMatch' &&
                    game.pendingSource === 'hand' &&
                    !activeMoveCardIdSet.has(card.id)
                  ) {
                    return (
                      <CardTile
                        key={`${card.id}-selected`}
                        card={card}
                        selectable
                        clickable
                        highlighted
                        tilt={baseTilt}
                        layout
                        onClick={handleCancelHandSelection}
                      />
                    )
                  }
                  return (
                    <motion.div
                      key={`${card.id}-placeholder`}
                      className="card-tile card-slot-placeholder hand-slot-placeholder"
                      style={{ rotate: baseTilt }}
                      layout="position"
                      transition={HAND_LAYOUT_TRANSITION}
                      aria-hidden="true"
                    />
                  )
                }
                const selectable = !isAiTurn && !interactionLocked && playerIntent === 'play'
                const highlighted = selectable && matchableHandIds.has(card.id)
                const dimmed = false
                const selectedForFieldCommit =
                  expandedSelectedCardId === card.id &&
                  (isHandExpanded || !useMobileViewLayout)

                return (
                  <CardTile
                    key={card.id}
                    card={card}
                    selectable={selectable}
                    highlighted={highlighted}
                    dimmed={dimmed}
                    raised={selectedForFieldCommit}
                    tapPulse={selectedForFieldCommit && expandedSelectionPulseCardId === card.id}
                    tilt={baseTilt}
                    dragX={dragX}
                    dragY={dragY}
                    dragging={dragging}
                    layout
                    onMouseEnter={
                      useMobileViewLayout
                        ? undefined
                        : () => setHoveredHandCardId(card.id)
                    }
                    onMouseLeave={
                      useMobileViewLayout
                        ? undefined
                        : () => setHoveredHandCardId((current) => (current === card.id ? null : current))
                    }
                    onPointerDown={
                      useMobileViewLayout
                        ? (event) => handleHandPointerDown(event, card)
                        : undefined
                    }
                    onPointerMove={useMobileViewLayout ? handleHandPointerMove : undefined}
                    onPointerUp={
                      useMobileViewLayout
                        ? (event) => finishHandPointerGesture(event, card, false)
                        : undefined
                    }
                    onPointerCancel={
                      useMobileViewLayout
                        ? (event) => finishHandPointerGesture(event, card, true)
                        : undefined
                    }
                    onClick={
                      useMobileViewLayout
                        ? () => handleExpandedHandCardClick(card)
                        : () => handleDesktopHandCardClick(card)
                    }
                  />
                )
              })}
            </div>

            {/* 自分の役（モバイルのみ・手札の下） */}
            {useMobileViewLayout ? (
              <MobileYakuRow
                captured={humanPanelView.captured}
                visibleProgressEntries={humanVisibleProgressEntries}
                title={humanDisplayName}
                score={humanPanelView.score}
                active={game.currentPlayerIndex === localPlayerIndex}
                captureZoneId={humanPlayer.id}
              />
            ) : null}
          </section>

          {!useMobileViewLayout ? (
            <RoleYakuPanel
              captureZoneId={humanPlayer.id}
              title={humanDisplayName}
              score={humanPanelView.score}
              captured={humanPanelView.captured}
              yaku={humanPanelView.completedYaku}
              blockedCardIds={humanBlockedCardIds}
              ruleOptions={{
                enableHanamiZake: activeLocalRules.yakuEnabled['hanami-zake'],
                enableTsukimiZake: activeLocalRules.yakuEnabled['tsukimi-zake'],
                enableFourCardsYaku: activeLocalRules.yakuEnabled.shiten,
                enableAmeNagare: activeLocalRules.yakuEnabled['hanami-zake'] && activeLocalRules.enableAmeNagare,
                enableKiriNagare: activeLocalRules.yakuEnabled['tsukimi-zake'] && activeLocalRules.enableKiriNagare,
              }}
              active={game.currentPlayerIndex === localPlayerIndex}
              side="right"
            />
          ) : null}
        </section>
      ) : (
        <section className="table-placeholder" aria-label="対戦待機中">
          <p>CPU対戦を開始するか、通信接続が確立すると対戦盤面が表示されます。</p>
        </section>
      )}

      {isScoreTableVisible ? (
        <section className="score-table-overlay" role="presentation" onClick={() => setIsScoreTableVisible(false)}>
          <section className="score-table-panel" aria-label="点数表パネル" onClick={(event) => event.stopPropagation()}>
            <div className="score-table-panel-head">
              <h2>点数表</h2>
              <button type="button" className="score-table-close-button" onClick={() => setIsScoreTableVisible(false)}>
                閉じる
              </button>
            </div>
            <ScoreTable
              roundScoreHistory={game.roundScoreHistory}
              player1Name={player1ScoreTableName}
              player2Name={player2ScoreTableName}
              player1TotalScore={player1ScoreTableTotal}
              player2TotalScore={player2ScoreTableTotal}
              currentRound={game.round}
              maxRounds={game.config.maxRounds}
              isMobileView={useMobileViewLayout}
            />
          </section>
        </section>
      ) : null}

      <LocalRulePanel
        isOpen={isLocalRulePanelVisible}
        canEdit={canEditLocalRules}
        isDeferredApply={isCpuRuleChangeDeferred}
        roundCountOptions={ROUND_COUNT_OPTIONS}
        selectedRoundCount={selectedRoundCount}
        localRules={localRulesForPanel}
        yakuFields={LOCAL_RULE_YAKU_FIELDS}
        onClose={() => setIsLocalRulePanelVisible(false)}
        onResetToDefaults={handleResetLocalRulesToDefaults}
        onSelectRoundCount={handleSelectRoundCount}
        onChangeYakuEnabled={handleChangeYakuEnabled}
        onChangeYakuPoint={handleChangeYakuPoint}
        onChangeKoiKoiBonusMode={handleChangeKoiKoiBonusMode}
        onToggleKoiKoiShowdown={handleToggleKoiKoiShowdown}
        onChangeSelfKoiBonusFactor={handleChangeSelfKoiBonusFactor}
        onChangeOpponentKoiBonusFactor={handleChangeOpponentKoiBonusFactor}
        onChangeNoYakuPolicy={handleChangeNoYakuPolicy}
        onChangeNoYakuParentPoints={handleChangeNoYakuParentPoints}
        onChangeNoYakuChildPoints={handleChangeNoYakuChildPoints}
        onToggleAmeNagare={handleToggleAmeNagare}
        onToggleKiriNagare={handleToggleKiriNagare}
        onChangeKoikoiLimit={handleChangeKoikoiLimit}
        onChangeDealerRotationMode={handleChangeDealerRotationMode}
        onToggleDrawOvertime={handleToggleDrawOvertime}
        onChangeDrawOvertimeMode={handleChangeDrawOvertimeMode}
        onChangeDrawOvertimeRounds={handleChangeDrawOvertimeRounds}
      />

      {isRuleHelpVisible && currentRuleHelpPage ? (
        <section className="rule-help-overlay" role="presentation" onClick={closeRuleHelp}>
          <section
            id="rule-help-panel"
            className="rule-help-panel"
            role="dialog"
            aria-modal="true"
            aria-label="札と役ガイド"
            onClick={(event) => event.stopPropagation()}
            onPointerDown={handleRuleHelpPointerDown}
            onPointerUp={handleRuleHelpPointerUp}
            onPointerCancel={handleRuleHelpPointerCancel}
          >
            <div className="rule-help-panel-head">
              <div className="rule-help-panel-title">
                <h2>札/役ガイド</h2>
                <p>
                  {ruleHelpPageIndex + 1}/{ruleHelpPages.length} {currentRuleHelpPage.subtitle}
                </p>
              </div>
              <button type="button" className="score-table-close-button" onClick={closeRuleHelp}>
                閉じる
              </button>
            </div>

            <div className="rule-help-carousel">
              <div
                className="rule-help-track"
                style={{ transform: `translateX(-${ruleHelpPageIndex * 100}%)` }}
              >
                {ruleHelpPages.map((page) => (
                  <article
                    key={page.key}
                    className="rule-help-page"
                    aria-hidden={page.key !== currentRuleHelpPage.key}
                  >
                    <h3>{page.title}</h3>
                    <div className="rule-help-page-body">
                      {page.content}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="rule-help-nav">
              <button
                type="button"
                className="rule-help-nav-button"
                onClick={goToPreviousRuleHelpPage}
                disabled={isRuleHelpFirstPage}
              >
                前へ
              </button>
              <div className="rule-help-dot-row" aria-label="ガイドページ">
                {ruleHelpPages.map((page, index) => (
                  <button
                    key={page.key}
                    type="button"
                    className={`rule-help-dot ${index === ruleHelpPageIndex ? 'active' : ''}`}
                    onClick={() => goToRuleHelpPage(index)}
                    aria-label={`${index + 1}ページ目へ`}
                  />
                ))}
              </div>
              <button
                type="button"
                className="rule-help-nav-button"
                onClick={goToNextRuleHelpPage}
                disabled={isRuleHelpLastPage}
              >
                次へ
              </button>
            </div>
          </section>
        </section>
      ) : null}

      <YakuDropEffect
        cards={dropCards}
        yaku={dropYaku}
      />
      <AnimatePresence>
        {turnBanner ? (
          <motion.div
            key={turnBanner.id}
            className="turn-banner-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <motion.div
              className={`turn-banner ${turnBanner.isLocal ? 'your-turn' : 'opponent-turn'}`}
              initial={{ scale: 0.6, opacity: 0, y: 20 }}
              animate={{ scale: [0.6, 1.08, 1], opacity: [0, 1, 1, 1, 0], y: [20, 0, 0, 0, -10] }}
              transition={{ duration: 1.6, times: [0, 0.18, 0.35, 0.75, 1], ease: [0.22, 1, 0.36, 1] }}
              onAnimationComplete={() => setTurnBanner(null)}
            >
              <span className="turn-banner-text">{turnBanner.label}</span>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <TurnDecisionEffect
        callouts={turnDecisionCallouts}
        onFinish={(id) => {
          setTurnDecisionCallouts((current) => current.filter((callout) => callout.id !== id))
        }}
      />
      <CardMoveOverlayEffect
        effects={moveEffects}
        onFinish={(id) => {
          const finishedEffect = moveEffectByIdRef.current.get(id)
          if (!finishedEffect) {
            return
          }
          const batchId = finishedEffect.batchId
          if (batchId === undefined) {
            moveEffectByIdRef.current.delete(id)
            if (pendingPlaceholderCardId && finishedEffect.card.id === pendingPlaceholderCardId) {
              setPendingHandPlaceholder(null)
            }
            if (finishedEffect.addToFieldHistoryLength !== undefined) {
              setAnimatedAddToFieldHistoryLength((current) =>
                Math.max(current, finishedEffect.addToFieldHistoryLength ?? current),
              )
            }
            setMoveEffects((current) => current.filter((effect) => effect.id !== id))
            return
          }

          const remaining = (moveBatchRemainingRef.current.get(batchId) ?? 1) - 1
          if (remaining > 0) {
            moveBatchRemainingRef.current.set(batchId, remaining)
            return
          }
          moveBatchRemainingRef.current.delete(batchId)

          const finishedBatch: CardMoveEffect[] = []
          for (const [effectId, effect] of moveEffectByIdRef.current.entries()) {
            if (effect.batchId === batchId) {
              finishedBatch.push(effect)
              moveEffectByIdRef.current.delete(effectId)
            }
          }

          if (
            pendingPlaceholderCardId &&
            finishedBatch.some((effect) => effect.card.id === pendingPlaceholderCardId)
          ) {
            setPendingHandPlaceholder(null)
          }
          if (
            pendingAiPlaceholderCardId &&
            finishedBatch.some((effect) => effect.card.id === pendingAiPlaceholderCardId)
          ) {
            setPendingAiHandPlaceholder(null)
          }

          const maxAddToFieldHistoryLength = finishedBatch.reduce<number | null>(
            (maxValue, effect) => {
              if (effect.addToFieldHistoryLength === undefined) {
                return maxValue
              }
              if (maxValue === null) {
                return effect.addToFieldHistoryLength
              }
              return Math.max(maxValue, effect.addToFieldHistoryLength)
            },
            null,
          )
          if (maxAddToFieldHistoryLength !== null) {
            setAnimatedAddToFieldHistoryLength((current) =>
              Math.max(current, maxAddToFieldHistoryLength),
            )
          }

          setMoveEffects((current) => current.filter((effect) => effect.batchId !== batchId))
        }}
      />

      {game.phase === 'koikoiDecision' && !isAiTurn && isKoikoiDecisionChoiceVisible ? (
        <RoundOverlay
          title="役がそろいました"
          message="新規役:"
          messageLines={koikoiDecisionYakuLines}
          primaryActionLabel="ここで上がる"
          onPrimaryAction={() => executeTurnCommand({ type: 'resolveKoiKoi', decision: 'stop' })}
          secondaryActionLabel={canDeclareKoiKoiNow ? 'こいこいする' : undefined}
          onSecondaryAction={
            canDeclareKoiKoiNow
              ? () => executeTurnCommand({ type: 'resolveKoiKoi', decision: 'koikoi' })
              : undefined
          }
        />
      ) : null}

      {showingLastRoundSummary && !stopEffectActive ? (
        <RoundOverlay
          title="月が終了しました"
          message={
            game.roundWinner
              ? `${game.roundWinner === humanPlayer.id ? 'あなた' : '相手'}の勝利。${game.roundPoints}点を獲得しました。`
              : 'この月は引き分けです。'
          }
          messageLines={roundEndMessageLines}
          primaryActionLabel={roundEndPrimaryActionLabel}
          onPrimaryAction={handleRoundEndPrimaryAction}
          primaryDisabled={roundEndPrimaryActionDisabled}
        />
      ) : null}

      {game.phase === 'gameOver' && !stopEffectActive && isFinalResultVisible ? (
        <RoundOverlay
          title="対局終了"
          message={
            game.winner
              ? `${game.winner === humanPlayer.id ? 'あなた' : '相手'}の勝利です。`
              : '最終結果は引き分けです。'
          }
          details={
            <ScoreTable
              roundScoreHistory={game.roundScoreHistory}
              player1Name={player1ScoreTableName}
              player2Name={player2ScoreTableName}
              player1TotalScore={player1ScoreTableTotal}
              player2TotalScore={player2ScoreTableTotal}
              currentRound={game.round}
              maxRounds={game.round}
              isMobileView={useMobileViewLayout}
            />
          }
          primaryActionLabel="もう一度遊ぶ"
          onPrimaryAction={handleRestart}
        />
      ) : null}
    </main>
  )
}

export default App

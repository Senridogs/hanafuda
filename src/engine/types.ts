export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export type CardType = 'hikari' | 'tane' | 'tanzaku' | 'kasu'

export type TanzakuVariant = 'aka' | 'ao' | 'normal'

export interface HanafudaCard {
  readonly id: string
  readonly month: Month
  readonly type: CardType
  readonly name: string
  readonly monthName: string
  readonly flowerName: string
  readonly points: number
  readonly tanzakuVariant?: TanzakuVariant
  readonly emoji: string
}

export interface Player {
  readonly id: 'player1' | 'player2'
  readonly name: string
  readonly hand: readonly HanafudaCard[]
  readonly captured: readonly HanafudaCard[]
  readonly score: number
  readonly completedYaku: readonly Yaku[]
}

export type GamePhase =
  | 'waiting'
  | 'dealing'
  | 'selectHandCard'
  | 'selectFieldMatch'
  | 'drawingDeck'
  | 'drawReveal'
  | 'selectDrawMatch'
  | 'checkYaku'
  | 'koikoiDecision'
  | 'roundEnd'
  | 'gameOver'

export interface GameState {
  readonly phase: GamePhase
  readonly deck: readonly HanafudaCard[]
  readonly field: readonly HanafudaCard[]
  readonly players: readonly [Player, Player]
  readonly currentPlayerIndex: 0 | 1
  readonly drawnCard: HanafudaCard | null
  readonly selectedHandCard: HanafudaCard | null
  readonly round: number
  readonly koikoiCounts: readonly [number, number]
  readonly newYaku: readonly Yaku[]
  readonly winner: 'player1' | 'player2' | null
  readonly turnHistory: readonly TurnAction[]
}

export interface Yaku {
  readonly type: YakuType
  readonly name: string
  readonly points: number
  readonly cards: readonly HanafudaCard[]
}

export type YakuType =
  | 'goko'
  | 'shiko'
  | 'ame-shiko'
  | 'sanko'
  | 'shiten'
  | 'inoshikacho'
  | 'hanami-zake'
  | 'tsukimi-zake'
  | 'akatan'
  | 'aotan'
  | 'tane'
  | 'tanzaku'
  | 'kasu'

export type KoiKoiBonusMode = 'none' | 'multiplicative' | 'additive'
export type NoYakuPolicy = 'both-zero' | 'seat-points'
export type DealerRotationMode = 'winner' | 'loser' | 'alternate'
export type DrawOvertimeMode = 'fixed' | 'until-decision'

export type YakuPointTable = Readonly<Record<YakuType, number>>
export type YakuEnabledTable = Readonly<Record<YakuType, boolean>>

export interface LocalRuleSettings {
  readonly yakuPoints: YakuPointTable
  readonly yakuEnabled: YakuEnabledTable
  readonly koiKoiBonusMode: KoiKoiBonusMode
  readonly enableKoiKoiShowdown: boolean
  readonly selfKoiBonusFactor: number
  readonly opponentKoiBonusFactor: number
  readonly enableHanamiZake: boolean
  readonly enableTsukimiZake: boolean
  readonly noYakuPolicy: NoYakuPolicy
  readonly noYakuParentPoints: number
  readonly noYakuChildPoints: number
  readonly enableFourCardsYaku: boolean
  readonly enableAmeNagare: boolean
  readonly enableKiriNagare: boolean
  readonly koikoiLimit: number
  readonly dealerRotationMode: DealerRotationMode
  readonly enableDrawOvertime: boolean
  readonly drawOvertimeMode: DrawOvertimeMode
  readonly drawOvertimeRounds: number
}

export interface LocalRuleSettingsInput {
  readonly yakuPoints?: Partial<Record<YakuType, number>>
  readonly yakuEnabled?: Partial<Record<YakuType, boolean>>
  readonly koiKoiBonusMode?: KoiKoiBonusMode
  readonly enableKoiKoiShowdown?: boolean
  readonly selfKoiBonusFactor?: number
  readonly opponentKoiBonusFactor?: number
  readonly enableHanamiZake?: boolean
  readonly enableTsukimiZake?: boolean
  readonly noYakuPolicy?: NoYakuPolicy
  readonly noYakuParentPoints?: number
  readonly noYakuChildPoints?: number
  readonly enableFourCardsYaku?: boolean
  readonly enableAmeNagare?: boolean
  readonly enableKiriNagare?: boolean
  readonly koikoiLimit?: number
  readonly dealerRotationMode?: DealerRotationMode
  readonly enableDrawOvertime?: boolean
  readonly drawOvertimeMode?: DrawOvertimeMode
  readonly drawOvertimeRounds?: number
}

export interface TurnAction {
  readonly player: 'player1' | 'player2'
  readonly type: 'playCard' | 'drawCard' | 'capture' | 'addToField' | 'koikoi' | 'stop'
  readonly card?: HanafudaCard
  readonly matchedCard?: HanafudaCard
  readonly capturedCards?: readonly HanafudaCard[]
}

export interface GameConfig {
  readonly maxRounds: number
  readonly enableAI: boolean
  readonly aiDifficulty: 'yowai' | 'futsuu' | 'tsuyoi' | 'yabai' | 'oni' | 'kami'
  readonly player1Name: string
  readonly player2Name: string
  readonly localRules: LocalRuleSettings
}

const MIN_YAKU_POINTS = 0
const MAX_YAKU_POINTS = 99
const MIN_MULTIPLIER_FACTOR = 1
const MAX_MULTIPLIER_FACTOR = 5
const MIN_KOIKOI_LIMIT = 0
const MAX_KOIKOI_LIMIT = 12
const MIN_OVERTIME_ROUNDS = 0
const MAX_OVERTIME_ROUNDS = 12
const DEFAULT_MAX_ROUNDS = 3
const DEFAULT_ENABLE_AI = true
const DEFAULT_AI_DIFFICULTY: GameConfig['aiDifficulty'] = 'futsuu'
const DEFAULT_PLAYER1_NAME = 'あなた'
const DEFAULT_PLAYER2_NAME = 'COM'

export const DEFAULT_YAKU_POINTS: YakuPointTable = {
  goko: 10,
  shiko: 8,
  'ame-shiko': 7,
  sanko: 5,
  shiten: 4,
  inoshikacho: 5,
  'hanami-zake': 5,
  'tsukimi-zake': 5,
  akatan: 5,
  aotan: 5,
  tane: 1,
  tanzaku: 1,
  kasu: 1,
}

export const DEFAULT_YAKU_ENABLED: YakuEnabledTable = {
  goko: true,
  shiko: true,
  'ame-shiko': true,
  sanko: true,
  shiten: false,
  inoshikacho: true,
  'hanami-zake': true,
  'tsukimi-zake': true,
  akatan: true,
  aotan: true,
  tane: true,
  tanzaku: true,
  kasu: true,
}

export const DEFAULT_LOCAL_RULE_SETTINGS: LocalRuleSettings = {
  yakuPoints: DEFAULT_YAKU_POINTS,
  yakuEnabled: DEFAULT_YAKU_ENABLED,
  koiKoiBonusMode: 'multiplicative',
  enableKoiKoiShowdown: false,
  selfKoiBonusFactor: 1,
  opponentKoiBonusFactor: 2,
  enableHanamiZake: true,
  enableTsukimiZake: true,
  noYakuPolicy: 'both-zero',
  noYakuParentPoints: 0,
  noYakuChildPoints: 0,
  enableFourCardsYaku: false,
  enableAmeNagare: false,
  enableKiriNagare: false,
  koikoiLimit: 0,
  dealerRotationMode: 'winner',
  enableDrawOvertime: false,
  drawOvertimeMode: 'fixed',
  drawOvertimeRounds: 0,
}

function normalizeYakuPointValue(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const normalized = Math.floor(value)
  if (normalized < MIN_YAKU_POINTS) {
    return MIN_YAKU_POINTS
  }
  if (normalized > MAX_YAKU_POINTS) {
    return MAX_YAKU_POINTS
  }
  return normalized
}

export function normalizeYakuPointTable(
  yakuPoints?: Partial<Record<YakuType, number>>,
): YakuPointTable {
  return {
    goko: normalizeYakuPointValue(yakuPoints?.goko, DEFAULT_YAKU_POINTS.goko),
    shiko: normalizeYakuPointValue(yakuPoints?.shiko, DEFAULT_YAKU_POINTS.shiko),
    'ame-shiko': normalizeYakuPointValue(yakuPoints?.['ame-shiko'], DEFAULT_YAKU_POINTS['ame-shiko']),
    sanko: normalizeYakuPointValue(yakuPoints?.sanko, DEFAULT_YAKU_POINTS.sanko),
    shiten: normalizeYakuPointValue(yakuPoints?.shiten, DEFAULT_YAKU_POINTS.shiten),
    inoshikacho: normalizeYakuPointValue(yakuPoints?.inoshikacho, DEFAULT_YAKU_POINTS.inoshikacho),
    'hanami-zake': normalizeYakuPointValue(yakuPoints?.['hanami-zake'], DEFAULT_YAKU_POINTS['hanami-zake']),
    'tsukimi-zake': normalizeYakuPointValue(yakuPoints?.['tsukimi-zake'], DEFAULT_YAKU_POINTS['tsukimi-zake']),
    akatan: normalizeYakuPointValue(yakuPoints?.akatan, DEFAULT_YAKU_POINTS.akatan),
    aotan: normalizeYakuPointValue(yakuPoints?.aotan, DEFAULT_YAKU_POINTS.aotan),
    tane: normalizeYakuPointValue(yakuPoints?.tane, DEFAULT_YAKU_POINTS.tane),
    tanzaku: normalizeYakuPointValue(yakuPoints?.tanzaku, DEFAULT_YAKU_POINTS.tanzaku),
    kasu: normalizeYakuPointValue(yakuPoints?.kasu, DEFAULT_YAKU_POINTS.kasu),
  }
}

function normalizeYakuEnabledValue(value: unknown, fallback: boolean): boolean {
  if (typeof value !== 'boolean') {
    return fallback
  }
  return value
}

export function normalizeYakuEnabledTable(
  yakuEnabled?: Partial<Record<YakuType, boolean>>,
): YakuEnabledTable {
  return {
    goko: normalizeYakuEnabledValue(yakuEnabled?.goko, DEFAULT_YAKU_ENABLED.goko),
    shiko: normalizeYakuEnabledValue(yakuEnabled?.shiko, DEFAULT_YAKU_ENABLED.shiko),
    'ame-shiko': normalizeYakuEnabledValue(yakuEnabled?.['ame-shiko'], DEFAULT_YAKU_ENABLED['ame-shiko']),
    sanko: normalizeYakuEnabledValue(yakuEnabled?.sanko, DEFAULT_YAKU_ENABLED.sanko),
    shiten: normalizeYakuEnabledValue(yakuEnabled?.shiten, DEFAULT_YAKU_ENABLED.shiten),
    inoshikacho: normalizeYakuEnabledValue(yakuEnabled?.inoshikacho, DEFAULT_YAKU_ENABLED.inoshikacho),
    'hanami-zake': normalizeYakuEnabledValue(yakuEnabled?.['hanami-zake'], DEFAULT_YAKU_ENABLED['hanami-zake']),
    'tsukimi-zake': normalizeYakuEnabledValue(yakuEnabled?.['tsukimi-zake'], DEFAULT_YAKU_ENABLED['tsukimi-zake']),
    akatan: normalizeYakuEnabledValue(yakuEnabled?.akatan, DEFAULT_YAKU_ENABLED.akatan),
    aotan: normalizeYakuEnabledValue(yakuEnabled?.aotan, DEFAULT_YAKU_ENABLED.aotan),
    tane: normalizeYakuEnabledValue(yakuEnabled?.tane, DEFAULT_YAKU_ENABLED.tane),
    tanzaku: normalizeYakuEnabledValue(yakuEnabled?.tanzaku, DEFAULT_YAKU_ENABLED.tanzaku),
    kasu: normalizeYakuEnabledValue(yakuEnabled?.kasu, DEFAULT_YAKU_ENABLED.kasu),
  }
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const normalized = Math.floor(value)
  if (normalized < min) {
    return min
  }
  if (normalized > max) {
    return max
  }
  return normalized
}

export function normalizeLocalRuleSettings(settings?: LocalRuleSettingsInput): LocalRuleSettings {
  const mode: KoiKoiBonusMode =
    settings?.koiKoiBonusMode === 'additive'
      ? 'additive'
      : settings?.koiKoiBonusMode === 'none'
        ? 'none'
        : 'multiplicative'
  const noYakuPolicy: NoYakuPolicy =
    settings?.noYakuPolicy === 'both-zero'
      ? 'both-zero'
      : settings?.noYakuPolicy === 'seat-points'
        ? 'seat-points'
        : 'both-zero'
  const dealerRotationMode: DealerRotationMode =
    settings?.dealerRotationMode === 'loser'
      ? 'loser'
      : settings?.dealerRotationMode === 'alternate'
        ? 'alternate'
        : 'winner'
  const drawOvertimeMode: DrawOvertimeMode =
    settings?.drawOvertimeMode === 'until-decision'
      ? 'until-decision'
      : 'fixed'
  const normalizedYakuEnabledBase = normalizeYakuEnabledTable(settings?.yakuEnabled)
  const normalizedYakuEnabled: YakuEnabledTable = {
    ...normalizedYakuEnabledBase,
    'hanami-zake':
      typeof settings?.yakuEnabled?.['hanami-zake'] === 'boolean'
        ? normalizedYakuEnabledBase['hanami-zake']
        : settings?.enableHanamiZake ?? normalizedYakuEnabledBase['hanami-zake'],
    'tsukimi-zake':
      typeof settings?.yakuEnabled?.['tsukimi-zake'] === 'boolean'
        ? normalizedYakuEnabledBase['tsukimi-zake']
        : settings?.enableTsukimiZake ?? normalizedYakuEnabledBase['tsukimi-zake'],
    shiten:
      typeof settings?.yakuEnabled?.shiten === 'boolean'
        ? normalizedYakuEnabledBase.shiten
        : settings?.enableFourCardsYaku ?? normalizedYakuEnabledBase.shiten,
  }
  return {
    yakuPoints: normalizeYakuPointTable(settings?.yakuPoints),
    yakuEnabled: normalizedYakuEnabled,
    koiKoiBonusMode: mode,
    enableKoiKoiShowdown: settings?.enableKoiKoiShowdown ?? DEFAULT_LOCAL_RULE_SETTINGS.enableKoiKoiShowdown,
    selfKoiBonusFactor: normalizeInteger(
      settings?.selfKoiBonusFactor,
      DEFAULT_LOCAL_RULE_SETTINGS.selfKoiBonusFactor,
      MIN_MULTIPLIER_FACTOR,
      MAX_MULTIPLIER_FACTOR,
    ),
    opponentKoiBonusFactor: normalizeInteger(
      settings?.opponentKoiBonusFactor,
      DEFAULT_LOCAL_RULE_SETTINGS.opponentKoiBonusFactor,
      MIN_MULTIPLIER_FACTOR,
      MAX_MULTIPLIER_FACTOR,
    ),
    enableHanamiZake: normalizedYakuEnabled['hanami-zake'],
    enableTsukimiZake: normalizedYakuEnabled['tsukimi-zake'],
    noYakuPolicy,
    noYakuParentPoints: normalizeInteger(
      settings?.noYakuParentPoints,
      DEFAULT_LOCAL_RULE_SETTINGS.noYakuParentPoints,
      MIN_YAKU_POINTS,
      MAX_YAKU_POINTS,
    ),
    noYakuChildPoints: normalizeInteger(
      settings?.noYakuChildPoints,
      DEFAULT_LOCAL_RULE_SETTINGS.noYakuChildPoints,
      MIN_YAKU_POINTS,
      MAX_YAKU_POINTS,
    ),
    enableFourCardsYaku: normalizedYakuEnabled.shiten,
    enableAmeNagare: settings?.enableAmeNagare ?? false,
    enableKiriNagare: settings?.enableKiriNagare ?? false,
    koikoiLimit: normalizeInteger(
      settings?.koikoiLimit,
      DEFAULT_LOCAL_RULE_SETTINGS.koikoiLimit,
      MIN_KOIKOI_LIMIT,
      MAX_KOIKOI_LIMIT,
    ),
    dealerRotationMode,
    enableDrawOvertime: settings?.enableDrawOvertime ?? false,
    drawOvertimeMode,
    drawOvertimeRounds: normalizeInteger(
      settings?.drawOvertimeRounds,
      DEFAULT_LOCAL_RULE_SETTINGS.drawOvertimeRounds,
      MIN_OVERTIME_ROUNDS,
      MAX_OVERTIME_ROUNDS,
    ),
  }
}

export interface GameConfigInput {
  readonly maxRounds?: number
  readonly enableAI?: boolean
  readonly aiDifficulty?: GameConfig['aiDifficulty']
  readonly player1Name?: string
  readonly player2Name?: string
  readonly localRules?: LocalRuleSettingsInput
}

function normalizeRoundCount(rounds: unknown): number {
  if (typeof rounds !== 'number' || !Number.isFinite(rounds)) {
    return DEFAULT_MAX_ROUNDS
  }
  const rounded = Math.floor(rounds)
  if (rounded <= 0) {
    return DEFAULT_MAX_ROUNDS
  }
  return rounded
}

function normalizeDifficulty(
  difficulty: unknown,
): GameConfig['aiDifficulty'] {
  if (
    difficulty === 'yowai'
    || difficulty === 'futsuu'
    || difficulty === 'tsuyoi'
    || difficulty === 'yabai'
    || difficulty === 'oni'
    || difficulty === 'kami'
  ) {
    return difficulty
  }
  return DEFAULT_AI_DIFFICULTY
}

function normalizePlayerName(name: unknown, fallback: string): string {
  if (typeof name !== 'string') {
    return fallback
  }
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

export function normalizeGameConfig(config?: GameConfigInput | GameConfig): GameConfig {
  return {
    maxRounds: normalizeRoundCount(config?.maxRounds),
    enableAI: config?.enableAI ?? DEFAULT_ENABLE_AI,
    aiDifficulty: normalizeDifficulty(config?.aiDifficulty),
    player1Name: normalizePlayerName(config?.player1Name, DEFAULT_PLAYER1_NAME),
    player2Name: normalizePlayerName(config?.player2Name, DEFAULT_PLAYER2_NAME),
    localRules: normalizeLocalRuleSettings(config?.localRules),
  }
}

export const DEFAULT_CONFIG: GameConfig = {
  maxRounds: DEFAULT_MAX_ROUNDS,
  enableAI: DEFAULT_ENABLE_AI,
  aiDifficulty: DEFAULT_AI_DIFFICULTY,
  player1Name: DEFAULT_PLAYER1_NAME,
  player2Name: DEFAULT_PLAYER2_NAME,
  localRules: DEFAULT_LOCAL_RULE_SETTINGS,
}

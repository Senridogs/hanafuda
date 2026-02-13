import type { KoiKoiGameState, RoundScoreEntry } from '../engine/game'
import { normalizeLocalRuleSettings, type LocalRuleSettings, type LocalRuleSettingsInput } from '../engine/types'

export type CheckpointRole = 'host' | 'guest'

export interface CheckpointPayload {
  readonly version: number
  readonly state: KoiKoiGameState
  readonly updatedAt: number
  readonly role: CheckpointRole
}

export const CHECKPOINT_KEY_PREFIX = 'hanafuda:p2p:checkpoint'
export const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000
const CPU_CHECKPOINT_KEY = 'hanafuda:cpu:checkpoint'
export const CPU_CHECKPOINT_TTL_MS = CHECKPOINT_TTL_MS
export const LOCAL_RULE_SETTINGS_STORAGE_VERSION = 1
export const LOCAL_RULE_SETTINGS_KEY_PREFIX = 'hanafuda:local-rules'
export const LOCAL_RULE_SETTINGS_KEY = `${LOCAL_RULE_SETTINGS_KEY_PREFIX}:v${LOCAL_RULE_SETTINGS_STORAGE_VERSION}`
const LEGACY_LOCAL_RULE_SETTINGS_KEY = LOCAL_RULE_SETTINGS_KEY_PREFIX
export const PREFERRED_ROUND_COUNT_STORAGE_VERSION = 1
export const PREFERRED_ROUND_COUNT_KEY_PREFIX = 'hanafuda:round-count'
export const PREFERRED_ROUND_COUNT_KEY = `${PREFERRED_ROUND_COUNT_KEY_PREFIX}:v${PREFERRED_ROUND_COUNT_STORAGE_VERSION}`
const LEGACY_PREFERRED_ROUND_COUNT_KEY = 'hanafuda:max-rounds'
export const MATCH_RECORD_STORAGE_VERSION = 1
export const MATCH_RECORD_KEY_PREFIX = 'hanafuda:match-records'
export const MATCH_RECORD_KEY = `${MATCH_RECORD_KEY_PREFIX}:v${MATCH_RECORD_STORAGE_VERSION}`
const LEGACY_MATCH_RECORD_KEY = MATCH_RECORD_KEY_PREFIX
const MAX_MATCH_RECORD_COUNT = 120

export interface CpuCheckpointPayload {
  readonly state: KoiKoiGameState
  readonly updatedAt: number
  readonly isMatchSurfaceVisible: boolean
}

function getCheckpointKey(roomId: string, role?: CheckpointRole): string {
  if (role) {
    return `${CHECKPOINT_KEY_PREFIX}:${role}:${roomId}`
  }
  return `${CHECKPOINT_KEY_PREFIX}:${roomId}`
}

function getLocalStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return null
    }
    return globalThis.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isCheckpointRole(value: unknown): value is CheckpointRole {
  return value === 'host' || value === 'guest'
}

function isValidUpdatedAt(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseCheckpointPayload(value: unknown): CheckpointPayload | null {
  if (!isRecord(value)) {
    return null
  }

  const { version, state, updatedAt, role } = value
  if (!isNonNegativeInteger(version)) {
    return null
  }
  if (state === undefined) {
    return null
  }
  if (!isValidUpdatedAt(updatedAt)) {
    return null
  }
  if (!isCheckpointRole(role)) {
    return null
  }

  return {
    version,
    state: state as KoiKoiGameState,
    updatedAt,
    role,
  }
}

function parseCpuCheckpointPayload(value: unknown): CpuCheckpointPayload | null {
  if (!isRecord(value)) {
    return null
  }

  const { state, updatedAt, isMatchSurfaceVisible } = value
  if (state === undefined) {
    return null
  }
  if (!isValidUpdatedAt(updatedAt)) {
    return null
  }
  if (typeof isMatchSurfaceVisible !== 'boolean') {
    return null
  }

  return {
    state: state as KoiKoiGameState,
    updatedAt,
    isMatchSurfaceVisible,
  }
}

const LOCAL_RULE_TOP_LEVEL_KEYS = [
  'yakuPoints',
  'yakuEnabled',
  'koiKoiBonusMode',
  'enableKoiKoiShowdown',
  'selfKoiBonusFactor',
  'opponentKoiBonusFactor',
  'enableHanamiZake',
  'enableTsukimiZake',
  'noYakuPolicy',
  'noYakuParentPoints',
  'noYakuChildPoints',
  'enableFourCardsYaku',
  'enableAmeNagare',
  'enableKiriNagare',
  'koikoiLimit',
  'dealerRotationMode',
  'enableDrawOvertime',
  'drawOvertimeMode',
  'drawOvertimeRounds',
] as const

const LOCAL_RULE_YAKU_POINT_KEYS = [
  'goko',
  'shiko',
  'ame-shiko',
  'sanko',
  'shiten',
  'inoshikacho',
  'hanami-zake',
  'tsukimi-zake',
  'akatan',
  'aotan',
  'tane',
  'tanzaku',
  'kasu',
] as const

const LOCAL_RULE_YAKU_ENABLED_KEYS = [
  'goko',
  'shiko',
  'ame-shiko',
  'sanko',
  'shiten',
  'inoshikacho',
  'hanami-zake',
  'tsukimi-zake',
  'akatan',
  'aotan',
  'tane',
  'tanzaku',
  'kasu',
] as const

interface LocalRuleSettingsStoragePayload {
  readonly version: number
  readonly updatedAt: number
  readonly localRules: LocalRuleSettings
}

export type MatchRecordMode = 'cpu' | 'p2p-host' | 'p2p-guest'
export type MatchRecordResult = 'win' | 'loss' | 'draw'

export interface MatchRecord {
  readonly id: string
  readonly mode: MatchRecordMode
  readonly opponentName: string
  readonly maxRounds: number
  readonly playedRounds: number
  readonly result: MatchRecordResult
  readonly localPlayerId: 'player1' | 'player2'
  readonly player1Name: string
  readonly player2Name: string
  readonly player1Score: number
  readonly player2Score: number
  readonly roundScoreHistory: readonly RoundScoreEntry[]
  readonly completedAt: number
}

export interface MatchRecordInput {
  readonly mode: MatchRecordMode
  readonly opponentName: string
  readonly maxRounds: number
  readonly playedRounds: number
  readonly result: MatchRecordResult
  readonly localPlayerId: 'player1' | 'player2'
  readonly player1Name: string
  readonly player2Name: string
  readonly player1Score: number
  readonly player2Score: number
  readonly roundScoreHistory: readonly RoundScoreEntry[]
  readonly completedAt?: number
}

interface MatchRecordStoragePayload {
  readonly version: number
  readonly updatedAt: number
  readonly records: readonly MatchRecord[]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value)
}

function hasAnyLocalRuleKey(value: Record<string, unknown>): boolean {
  return LOCAL_RULE_TOP_LEVEL_KEYS.some((key) => key in value)
}

function extractLocalRuleSettingsInput(value: unknown): LocalRuleSettingsInput | null {
  if (!isPlainRecord(value)) {
    return null
  }

  if (hasAnyLocalRuleKey(value)) {
    return value as LocalRuleSettingsInput
  }

  const nested = value.localRules
  if (!isPlainRecord(nested)) {
    return null
  }
  if (!hasAnyLocalRuleKey(nested)) {
    return null
  }
  return nested as LocalRuleSettingsInput
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export type PreferredRoundCount = 3 | 6 | 12

function isPreferredRoundCount(value: unknown): value is PreferredRoundCount {
  return value === 3 || value === 6 || value === 12
}

function isPlayerId(value: unknown): value is 'player1' | 'player2' {
  return value === 'player1' || value === 'player2'
}

function isMatchRecordMode(value: unknown): value is MatchRecordMode {
  return value === 'cpu' || value === 'p2p-host' || value === 'p2p-guest'
}

function isMatchRecordResult(value: unknown): value is MatchRecordResult {
  return value === 'win' || value === 'loss' || value === 'draw'
}

function normalizeName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function parseRoundScoreHistory(value: unknown, maxRounds: number): RoundScoreEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  const byRound = new Map<number, RoundScoreEntry>()
  for (const item of value) {
    if (!isRecord(item)) {
      continue
    }
    const round = item.round
    const player1Points = item.player1Points
    const player2Points = item.player2Points
    if (
      !isNonNegativeInteger(round)
      || round === 0
      || round > maxRounds
      || !isNonNegativeInteger(player1Points)
      || !isNonNegativeInteger(player2Points)
    ) {
      continue
    }
    byRound.set(round, {
      round,
      player1Points,
      player2Points,
    })
  }

  return [...byRound.values()].sort((a, b) => a.round - b.round)
}

function parseMatchRecord(value: unknown): MatchRecord | null {
  if (!isPlainRecord(value)) {
    return null
  }
  const id = normalizeName(value.id, '')
  if (id.length === 0) {
    return null
  }
  if (!isMatchRecordMode(value.mode) || !isMatchRecordResult(value.result) || !isPlayerId(value.localPlayerId)) {
    return null
  }
  if (
    !isNonNegativeInteger(value.maxRounds)
    || value.maxRounds === 0
    || !isNonNegativeInteger(value.playedRounds)
    || !isNonNegativeInteger(value.player1Score)
    || !isNonNegativeInteger(value.player2Score)
    || !isValidUpdatedAt(value.completedAt)
  ) {
    return null
  }

  const maxRounds = Math.max(1, value.maxRounds)
  const roundScoreHistory = parseRoundScoreHistory(value.roundScoreHistory, maxRounds)
  const maxRecordedRound = roundScoreHistory.reduce((maxValue, entry) => Math.max(maxValue, entry.round), 0)
  const playedRounds = Math.min(
    maxRounds,
    Math.max(1, Math.max(maxRecordedRound, value.playedRounds)),
  )

  return {
    id,
    mode: value.mode,
    opponentName: normalizeName(value.opponentName, '相手'),
    maxRounds,
    playedRounds,
    result: value.result,
    localPlayerId: value.localPlayerId,
    player1Name: normalizeName(value.player1Name, 'player1'),
    player2Name: normalizeName(value.player2Name, 'player2'),
    player1Score: value.player1Score,
    player2Score: value.player2Score,
    roundScoreHistory,
    completedAt: value.completedAt,
  }
}

function extractMatchRecords(value: unknown): MatchRecord[] {
  const rawRecords = Array.isArray(value)
    ? value
    : isPlainRecord(value) && Array.isArray(value.records)
      ? value.records
      : isPlainRecord(value) && Array.isArray(value.matches)
        ? value.matches
        : []
  const records = rawRecords
    .map((item) => parseMatchRecord(item))
    .filter((item): item is MatchRecord => Boolean(item))
    .sort((a, b) => b.completedAt - a.completedAt)

  return records.slice(0, MAX_MATCH_RECORD_COUNT)
}

function saveMatchRecords(records: readonly MatchRecord[]): void {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }
  const payload: MatchRecordStoragePayload = {
    version: MATCH_RECORD_STORAGE_VERSION,
    updatedAt: Date.now(),
    records: records.slice(0, MAX_MATCH_RECORD_COUNT),
  }
  try {
    storage.setItem(MATCH_RECORD_KEY, JSON.stringify(payload))
  } catch {
    // Ignore unavailable storage / quota errors.
  }
}

function createMatchRecordId(completedAt: number): string {
  const entropy = Math.random().toString(36).slice(2, 10)
  return `${completedAt.toString(36)}-${entropy}`
}

export function recordMatchResult(input: MatchRecordInput): MatchRecord | null {
  if (
    !isMatchRecordMode(input.mode)
    || !isMatchRecordResult(input.result)
    || !isPlayerId(input.localPlayerId)
    || !isNonNegativeInteger(input.maxRounds)
    || input.maxRounds === 0
    || !isNonNegativeInteger(input.playedRounds)
    || !isNonNegativeInteger(input.player1Score)
    || !isNonNegativeInteger(input.player2Score)
  ) {
    return null
  }

  const maxRounds = Math.max(1, input.maxRounds)
  const roundScoreHistory = parseRoundScoreHistory(input.roundScoreHistory, maxRounds)
  const maxRecordedRound = roundScoreHistory.reduce((maxValue, entry) => Math.max(maxValue, entry.round), 0)
  const playedRounds = Math.min(
    maxRounds,
    Math.max(1, Math.max(maxRecordedRound, input.playedRounds)),
  )
  const completedAt = isValidUpdatedAt(input.completedAt) ? input.completedAt : Date.now()
  const record: MatchRecord = {
    id: createMatchRecordId(completedAt),
    mode: input.mode,
    opponentName: normalizeName(input.opponentName, '相手'),
    maxRounds,
    playedRounds,
    result: input.result,
    localPlayerId: input.localPlayerId,
    player1Name: normalizeName(input.player1Name, 'player1'),
    player2Name: normalizeName(input.player2Name, 'player2'),
    player1Score: input.player1Score,
    player2Score: input.player2Score,
    roundScoreHistory,
    completedAt,
  }

  const existing = loadMatchRecords()
  saveMatchRecords([record, ...existing])
  return record
}

export function loadMatchRecords(): MatchRecord[] {
  const storage = getLocalStorage()
  if (!storage) {
    return []
  }

  const candidateKeys = [MATCH_RECORD_KEY, LEGACY_MATCH_RECORD_KEY]
  for (const key of candidateKeys) {
    const raw = storage.getItem(key)
    if (raw === null) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    const records = extractMatchRecords(parsed)
    const shouldRewrite = key !== MATCH_RECORD_KEY
      || !isPlainRecord(parsed)
      || !Array.isArray(parsed.records)
      || parsed.records.length !== records.length
    if (shouldRewrite) {
      saveMatchRecords(records)
      if (key !== MATCH_RECORD_KEY) {
        try {
          storage.removeItem(key)
        } catch {
          // ignore unavailable storage errors.
        }
      }
    }
    return records
  }

  return []
}

export function clearMatchRecords(): void {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }
  try {
    storage.removeItem(MATCH_RECORD_KEY)
    storage.removeItem(LEGACY_MATCH_RECORD_KEY)
  } catch {
    // Ignore unavailable storage errors.
  }
}

function hasCompleteYakuPointTable(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false
  }
  return LOCAL_RULE_YAKU_POINT_KEYS.every((key) => isFiniteNumber(value[key]))
}

function hasCompleteYakuEnabledTable(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false
  }
  return LOCAL_RULE_YAKU_ENABLED_KEYS.every((key) => typeof value[key] === 'boolean')
}

function hasCompleteLocalRuleSettings(value: unknown): boolean {
  if (!isPlainRecord(value)) {
    return false
  }
  return (
    hasCompleteYakuPointTable(value.yakuPoints)
    && hasCompleteYakuEnabledTable(value.yakuEnabled)
    && typeof value.koiKoiBonusMode === 'string'
    && typeof value.enableKoiKoiShowdown === 'boolean'
    && isFiniteNumber(value.selfKoiBonusFactor)
    && isFiniteNumber(value.opponentKoiBonusFactor)
    && typeof value.enableHanamiZake === 'boolean'
    && typeof value.enableTsukimiZake === 'boolean'
    && typeof value.noYakuPolicy === 'string'
    && isFiniteNumber(value.noYakuParentPoints)
    && isFiniteNumber(value.noYakuChildPoints)
    && typeof value.enableFourCardsYaku === 'boolean'
    && typeof value.enableAmeNagare === 'boolean'
    && typeof value.enableKiriNagare === 'boolean'
    && isFiniteNumber(value.koikoiLimit)
    && typeof value.dealerRotationMode === 'string'
    && typeof value.enableDrawOvertime === 'boolean'
    && typeof value.drawOvertimeMode === 'string'
    && isFiniteNumber(value.drawOvertimeRounds)
  )
}

export function saveLocalRuleSettings(settings: LocalRuleSettingsInput): void {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }

  const payload: LocalRuleSettingsStoragePayload = {
    version: LOCAL_RULE_SETTINGS_STORAGE_VERSION,
    updatedAt: Date.now(),
    localRules: normalizeLocalRuleSettings(settings),
  }

  try {
    storage.setItem(LOCAL_RULE_SETTINGS_KEY, JSON.stringify(payload))
  } catch {
    // Ignore unavailable storage / quota errors.
  }
}

export function loadLocalRuleSettings(): LocalRuleSettings | null {
  const storage = getLocalStorage()
  if (!storage) {
    return null
  }

  const candidateKeys = [LOCAL_RULE_SETTINGS_KEY, LEGACY_LOCAL_RULE_SETTINGS_KEY]
  for (const key of candidateKeys) {
    const raw = storage.getItem(key)
    if (raw === null) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    const settingsInput = extractLocalRuleSettingsInput(parsed)
    if (!settingsInput) {
      continue
    }

    const normalized = normalizeLocalRuleSettings(settingsInput)
    const normalizedSource = isPlainRecord(parsed) && isPlainRecord(parsed.localRules)
      ? parsed.localRules
      : settingsInput
    const shouldRewrite = key !== LOCAL_RULE_SETTINGS_KEY || !hasCompleteLocalRuleSettings(normalizedSource)
    if (shouldRewrite) {
      saveLocalRuleSettings(normalized)
      if (key !== LOCAL_RULE_SETTINGS_KEY) {
        try {
          storage.removeItem(key)
        } catch {
          // ignore unavailable storage errors.
        }
      }
    }

    return normalized
  }

  return null
}

export function resetLocalRuleSettings(): void {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }

  try {
    storage.removeItem(LOCAL_RULE_SETTINGS_KEY)
    storage.removeItem(LEGACY_LOCAL_RULE_SETTINGS_KEY)
  } catch {
    // Ignore unavailable storage errors.
  }
}

export function savePreferredRoundCount(roundCount: PreferredRoundCount): void {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }

  try {
    storage.setItem(PREFERRED_ROUND_COUNT_KEY, JSON.stringify({
      version: PREFERRED_ROUND_COUNT_STORAGE_VERSION,
      updatedAt: Date.now(),
      roundCount,
    }))
  } catch {
    // Ignore unavailable storage / quota errors.
  }
}

export function loadPreferredRoundCount(): PreferredRoundCount | null {
  const storage = getLocalStorage()
  if (!storage) {
    return null
  }

  const candidateKeys = [PREFERRED_ROUND_COUNT_KEY, LEGACY_PREFERRED_ROUND_COUNT_KEY]
  for (const key of candidateKeys) {
    const raw = storage.getItem(key)
    if (raw === null) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      const numeric = Number.parseInt(raw, 10)
      if (isPreferredRoundCount(numeric)) {
        savePreferredRoundCount(numeric)
        if (key !== PREFERRED_ROUND_COUNT_KEY) {
          try {
            storage.removeItem(key)
          } catch {
            // ignore unavailable storage errors.
          }
        }
        return numeric
      }
      continue
    }

    if (isPreferredRoundCount(parsed)) {
      savePreferredRoundCount(parsed)
      if (key !== PREFERRED_ROUND_COUNT_KEY) {
        try {
          storage.removeItem(key)
        } catch {
          // ignore unavailable storage errors.
        }
      }
      return parsed
    }

    if (!isPlainRecord(parsed)) {
      continue
    }
    const roundCount = parsed.roundCount
    if (!isPreferredRoundCount(roundCount)) {
      continue
    }
    if (key !== PREFERRED_ROUND_COUNT_KEY) {
      savePreferredRoundCount(roundCount)
      try {
        storage.removeItem(key)
      } catch {
        // ignore unavailable storage errors.
      }
    }
    return roundCount
  }

  return null
}

export function saveCheckpoint(roomId: string, payload: CheckpointPayload): void {
  const storage = getLocalStorage()
  if (!storage || roomId.length === 0) {
    return
  }

  if (
    !isNonNegativeInteger(payload.version) ||
    payload.state === undefined ||
    !isValidUpdatedAt(payload.updatedAt) ||
    !isCheckpointRole(payload.role)
  ) {
    return
  }

  try {
    storage.setItem(getCheckpointKey(roomId, payload.role), JSON.stringify(payload))
  } catch {
    // Ignore unavailable storage / quota errors.
  }
}

export function loadCheckpoint(roomId: string, role?: CheckpointRole): CheckpointPayload | null {
  const storage = getLocalStorage()
  if (!storage || roomId.length === 0) {
    return null
  }

  const key = getCheckpointKey(roomId, role)
  const raw = storage.getItem(key)
  if (raw === null) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const checkpoint = parseCheckpointPayload(parsed)
  if (!checkpoint) {
    return null
  }

  if (Date.now() - checkpoint.updatedAt > CHECKPOINT_TTL_MS) {
    return null
  }

  return checkpoint
}

export function clearCheckpoint(roomId: string, role?: CheckpointRole): void {
  const storage = getLocalStorage()
  if (!storage || roomId.length === 0) {
    return
  }

  try {
    storage.removeItem(getCheckpointKey(roomId, role))
  } catch {
    // Ignore unavailable storage errors.
  }
}

export function saveCpuCheckpoint(payload: CpuCheckpointPayload): void {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }
  if (
    payload.state === undefined
    || !isValidUpdatedAt(payload.updatedAt)
    || typeof payload.isMatchSurfaceVisible !== 'boolean'
  ) {
    return
  }
  try {
    storage.setItem(CPU_CHECKPOINT_KEY, JSON.stringify(payload))
  } catch {
    // ignore quota / unavailable
  }
}

export function loadCpuCheckpoint(): CpuCheckpointPayload | null {
  const storage = getLocalStorage()
  if (!storage) {
    return null
  }
  const raw = storage.getItem(CPU_CHECKPOINT_KEY)
  if (raw === null) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const checkpoint = parseCpuCheckpointPayload(parsed)
  if (!checkpoint) {
    return null
  }
  if (Date.now() - checkpoint.updatedAt > CPU_CHECKPOINT_TTL_MS) {
    return null
  }
  return checkpoint
}

export function clearCpuCheckpoint(): void {
  const storage = getLocalStorage()
  if (!storage) {
    return
  }
  try {
    storage.removeItem(CPU_CHECKPOINT_KEY)
  } catch {
    // ignore unavailable storage
  }
}

export type SessionMode = 'p2p-host' | 'p2p-guest' | 'cpu'

export interface SessionMeta {
  readonly mode: SessionMode
  readonly roomId?: string
  readonly updatedAt: number
}

const SESSION_KEY = 'hanafuda:p2p:session'
const LAST_HOST_ROOM_ID_KEY = 'hanafuda:p2p:last-host-room-id'
const LAST_GUEST_ROOM_ID_KEY = 'hanafuda:p2p:last-guest-room-id'

function getSessionStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined' || !('sessionStorage' in globalThis)) {
      return null
    }
    return globalThis.sessionStorage
  } catch {
    return null
  }
}

export function saveSessionMeta(meta: SessionMeta): void {
  const storage = getSessionStorage()
  if (!storage) return
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(meta))
  } catch {
    // ignore quota / unavailable
  }
}

export function loadSessionMeta(): SessionMeta | null {
  const storage = getSessionStorage()
  if (!storage) return null
  const raw = storage.getItem(SESSION_KEY)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    const { mode, roomId, updatedAt } = parsed
    if (mode !== 'p2p-host' && mode !== 'p2p-guest' && mode !== 'cpu') return null
    if (roomId !== undefined && typeof roomId !== 'string') return null
    if (!isValidUpdatedAt(updatedAt)) return null
    return { mode, roomId, updatedAt }
  } catch {
    return null
  }
}

export function clearSessionMeta(): void {
  const storage = getSessionStorage()
  if (!storage) return
  try {
    storage.removeItem(SESSION_KEY)
  } catch {
    // ignore
  }
}

export function saveLastHostRoomId(roomId: string): void {
  const storage = getLocalStorage()
  const normalized = roomId.trim()
  if (!storage || normalized.length === 0) return
  try {
    storage.setItem(LAST_HOST_ROOM_ID_KEY, normalized)
  } catch {
    // ignore quota / unavailable
  }
}

export function loadLastHostRoomId(): string {
  const storage = getLocalStorage()
  if (!storage) return ''
  try {
    const value = storage.getItem(LAST_HOST_ROOM_ID_KEY)
    if (typeof value !== 'string') return ''
    return value.trim()
  } catch {
    return ''
  }
}

export function saveLastGuestRoomId(roomId: string): void {
  const storage = getLocalStorage()
  const normalized = roomId.trim()
  if (!storage || normalized.length === 0) return
  try {
    storage.setItem(LAST_GUEST_ROOM_ID_KEY, normalized)
  } catch {
    // ignore quota / unavailable
  }
}

export function loadLastGuestRoomId(): string {
  const storage = getLocalStorage()
  if (!storage) return ''
  try {
    const value = storage.getItem(LAST_GUEST_ROOM_ID_KEY)
    if (typeof value !== 'string') return ''
    return value.trim()
  } catch {
    return ''
  }
}

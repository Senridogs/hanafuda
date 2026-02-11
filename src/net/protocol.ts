import { z } from 'zod'
import type { KoiKoiGameState } from '../engine/game'

export const playerIdSchema = z.enum(['player1', 'player2'])
export type PlayerId = z.infer<typeof playerIdSchema>

export const koiKoiDecisionSchema = z.enum(['koikoi', 'stop'])
const koiKoiBonusModeSchema = z.enum(['none', 'multiplicative', 'additive'])
const noYakuPolicySchema = z.enum(['both-zero', 'seat-points'])
const dealerRotationModeSchema = z.enum(['winner', 'loser', 'alternate'])
const drawOvertimeModeSchema = z.enum(['fixed', 'until-decision'])
const commandSeedSchema = z.number().int().nonnegative().max(0xffff_ffff)
const yakuPointValueSchema = z.number().int().min(0).max(99)
const yakuPointsSchema = z.object({
  goko: yakuPointValueSchema,
  shiko: yakuPointValueSchema,
  'ame-shiko': yakuPointValueSchema,
  sanko: yakuPointValueSchema,
  shiten: yakuPointValueSchema,
  inoshikacho: yakuPointValueSchema,
  'hanami-zake': yakuPointValueSchema,
  'tsukimi-zake': yakuPointValueSchema,
  akatan: yakuPointValueSchema,
  aotan: yakuPointValueSchema,
  tane: yakuPointValueSchema,
  tanzaku: yakuPointValueSchema,
  kasu: yakuPointValueSchema,
})
const yakuEnabledSchema = z.object({
  goko: z.boolean(),
  shiko: z.boolean(),
  'ame-shiko': z.boolean(),
  sanko: z.boolean(),
  shiten: z.boolean(),
  inoshikacho: z.boolean(),
  'hanami-zake': z.boolean(),
  'tsukimi-zake': z.boolean(),
  akatan: z.boolean(),
  aotan: z.boolean(),
  tane: z.boolean(),
  tanzaku: z.boolean(),
  kasu: z.boolean(),
})
const localRuleSettingsInputSchema = z.object({
  yakuPoints: yakuPointsSchema.partial().optional(),
  yakuEnabled: yakuEnabledSchema.partial().optional(),
  koiKoiBonusMode: koiKoiBonusModeSchema.optional(),
  enableKoiKoiShowdown: z.boolean().optional(),
  selfKoiBonusFactor: z.number().int().min(1).max(5).optional(),
  opponentKoiBonusFactor: z.number().int().min(1).max(5).optional(),
  enableHanamiZake: z.boolean().optional(),
  enableTsukimiZake: z.boolean().optional(),
  noYakuPolicy: noYakuPolicySchema.optional(),
  noYakuParentPoints: yakuPointValueSchema.optional(),
  noYakuChildPoints: yakuPointValueSchema.optional(),
  enableFourCardsYaku: z.boolean().optional(),
  enableAmeNagare: z.boolean().optional(),
  enableKiriNagare: z.boolean().optional(),
  koikoiLimit: z.number().int().min(0).max(12).optional(),
  dealerRotationMode: dealerRotationModeSchema.optional(),
  enableDrawOvertime: z.boolean().optional(),
  drawOvertimeMode: drawOvertimeModeSchema.optional(),
  drawOvertimeRounds: z.number().int().min(0).max(12).optional(),
})

export const turnCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('playHandCard'),
    cardId: z.string().min(1),
  }),
  z.object({
    type: z.literal('selectHandMatch'),
    fieldCardId: z.string().min(1),
  }),
  z.object({
    type: z.literal('cancelHandSelection'),
    insertIndex: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('drawStep'),
  }),
  z.object({
    type: z.literal('commitDrawToField'),
  }),
  z.object({
    type: z.literal('selectDrawMatch'),
    fieldCardId: z.string().min(1),
  }),
  z.object({
    type: z.literal('checkTurn'),
  }),
  z.object({
    type: z.literal('resolveKoiKoi'),
    decision: koiKoiDecisionSchema,
  }),
  z.object({
    type: z.literal('startNextRound'),
    seed: commandSeedSchema.optional(),
  }),
  z.object({
    type: z.literal('readyNextRound'),
    playerId: playerIdSchema,
  }),
  z.object({
    type: z.literal('restartGame'),
    maxRounds: z.union([z.literal(3), z.literal(6), z.literal(12)]),
    localRules: localRuleSettingsInputSchema.optional(),
    seed: commandSeedSchema.optional(),
  }),
])
export type TurnCommand = z.infer<typeof turnCommandSchema>

const roomIdSchema = z.string().min(1)
const actionIdSchema = z.string().min(1)

export const helloMessageSchema = z.object({
  type: z.literal('hello'),
  roomId: roomIdSchema,
  peerId: z.string().min(1),
  resumeVersion: z.number().int().nonnegative().optional(),
})

export const actionMessageSchema = z.object({
  type: z.literal('action'),
  roomId: roomIdSchema,
  actionId: actionIdSchema,
  from: playerIdSchema,
  command: turnCommandSchema,
})

export const stateMessageSchema = z.object({
  type: z.literal('state'),
  roomId: roomIdSchema,
  version: z.number().int().nonnegative(),
  state: z.unknown(),
  lastActionId: actionIdSchema.optional(),
})

export const netErrorCodeSchema = z.enum(['illegal_action', 'out_of_turn', 'invalid_phase', 'unknown'])
export type NetErrorCode = z.infer<typeof netErrorCodeSchema>

export const errorMessageSchema = z.object({
  type: z.literal('error'),
  roomId: roomIdSchema,
  code: netErrorCodeSchema,
  message: z.string().min(1),
})

export const pingMessageSchema = z.object({
  type: z.literal('ping'),
  t: z.number(),
})

export const pongMessageSchema = z.object({
  type: z.literal('pong'),
  t: z.number(),
})

const parsedNetMessageSchema = z.discriminatedUnion('type', [
  helloMessageSchema,
  actionMessageSchema,
  stateMessageSchema,
  errorMessageSchema,
  pingMessageSchema,
  pongMessageSchema,
])

type ParsedNetMessage = z.infer<typeof parsedNetMessageSchema>

export type HelloMessage = z.infer<typeof helloMessageSchema>

export type ActionMessage = z.infer<typeof actionMessageSchema>

export interface StateMessage extends Omit<z.infer<typeof stateMessageSchema>, 'state'> {
  readonly state: KoiKoiGameState
}

export type ErrorMessage = z.infer<typeof errorMessageSchema>

export type PingMessage = z.infer<typeof pingMessageSchema>

export type PongMessage = z.infer<typeof pongMessageSchema>

export type NetMessage = HelloMessage | ActionMessage | StateMessage | ErrorMessage | PingMessage | PongMessage

export function parseNetMessage(value: unknown): NetMessage | null {
  const parsed = parsedNetMessageSchema.safeParse(value)
  if (!parsed.success) {
    return null
  }
  return coerceParsedNetMessage(parsed.data)
}

export function isNetMessage(value: unknown): value is NetMessage {
  return parseNetMessage(value) !== null
}

function coerceParsedNetMessage(message: ParsedNetMessage): NetMessage {
  if (message.type === 'state') {
    return {
      ...message,
      state: message.state as KoiKoiGameState,
    }
  }
  return message
}

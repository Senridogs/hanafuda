import { describe, expect, it } from 'vitest'
import { parseNetMessage, turnCommandSchema } from '../../src/net/protocol'

describe('net protocol schema', () => {
  it('parses valid action messages', () => {
    const payload = {
      type: 'action',
      roomId: 'room-001',
      actionId: 'action-1',
      from: 'player1',
      command: {
        type: 'playHandCard',
        cardId: 'jan-hikari',
      },
    }
    const parsed = parseNetMessage(payload)
    expect(parsed).not.toBeNull()
    expect(parsed?.type).toBe('action')
    if (!parsed || parsed.type !== 'action') {
      return
    }
    expect(parsed.command.type).toBe('playHandCard')
  })

  it('rejects invalid turn commands', () => {
    const invalidCommand = {
      type: 'resolveKoiKoi',
      decision: 'again',
    }
    const parsed = turnCommandSchema.safeParse(invalidCommand)
    expect(parsed.success).toBe(false)
  })

  it('accepts readyNextRound commands', () => {
    const parsed = turnCommandSchema.safeParse({
      type: 'readyNextRound',
      playerId: 'player2',
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts seeded startNextRound commands', () => {
    const parsed = turnCommandSchema.safeParse({
      type: 'startNextRound',
      seed: 123456789,
    })
    expect(parsed.success).toBe(true)
  })

  it('accepts restartGame command with local rules', () => {
    const parsed = turnCommandSchema.safeParse({
      type: 'restartGame',
      maxRounds: 6,
      localRules: {
        yakuPoints: {
          goko: 10,
          shiko: 8,
          'ame-shiko': 7,
          sanko: 5,
          inoshikacho: 5,
          'hanami-zake': 5,
          'tsukimi-zake': 5,
          akatan: 5,
          aotan: 5,
          tane: 1,
          tanzaku: 1,
          kasu: 1,
        },
        koiKoiBonusMode: 'additive',
        enableHanamiZake: false,
        enableTsukimiZake: true,
      },
    })
    expect(parsed.success).toBe(true)
  })
})

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
})

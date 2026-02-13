import { describe, expect, it } from 'vitest'
import { buildRuleHelpScoringNotes } from '../../src/App'
import { DEFAULT_LOCAL_RULE_SETTINGS, type LocalRuleSettings } from '../../src/engine/types'

function buildSettings(overrides: Partial<LocalRuleSettings>): LocalRuleSettings {
  return {
    ...DEFAULT_LOCAL_RULE_SETTINGS,
    ...overrides,
  }
}

describe('buildRuleHelpScoringNotes local rule reflection', () => {
  it.each([
    ['winner', '親の決め方: 勝者が次の親'],
    ['loser', '親の決め方: 敗者が次の親'],
    ['alternate', '親の決め方: 毎局交代'],
  ] as const)('reflects dealerRotationMode=%s', (dealerRotationMode, expected) => {
    const notes = buildRuleHelpScoringNotes(buildSettings({ dealerRotationMode }))

    expect(notes).toContain(expected)
  })

  it('reflects no-yaku seat points values', () => {
    const notes = buildRuleHelpScoringNotes(
      buildSettings({
        noYakuPolicy: 'seat-points',
        noYakuParentPoints: 7,
        noYakuChildPoints: 3,
      }),
    )

    expect(notes).toContain('役が1つもない場合は 親7点 / 子3点 です。')
  })

  it('reflects no-yaku zero policy', () => {
    const notes = buildRuleHelpScoringNotes(buildSettings({ noYakuPolicy: 'both-zero' }))

    expect(notes).toContain('役が1つもない場合は 0点 になります。')
  })

  it.each([
    [false, '延長戦: 無効'],
    [true, '延長戦: サドンデス（引き分けが出るまで1局ずつ）'],
  ] as const)('reflects draw overtime toggle=%s', (enableDrawOvertime, expected) => {
    const notes = buildRuleHelpScoringNotes(
      buildSettings({
        enableDrawOvertime,
        drawOvertimeMode: 'until-decision',
      }),
    )

    expect(notes).toContain(expected)
  })

  it('reflects fixed draw overtime rounds', () => {
    const notes = buildRuleHelpScoringNotes(
      buildSettings({
        enableDrawOvertime: true,
        drawOvertimeMode: 'fixed-rounds',
        drawOvertimeRounds: 4,
      }),
    )

    expect(notes).toContain('延長戦: 固定局数（4局）')
  })
})

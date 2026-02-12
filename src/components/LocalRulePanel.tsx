import { useState, type ReactNode } from 'react'
import { getCardImageUrl } from '../engine/cardArt'
import { getCardById } from '../engine/cards'
import type { HanafudaCard, LocalRuleSettings, YakuType } from '../engine/types'
import './LocalRulePanel.css'

type RoundCountOption = 3 | 6 | 12

type RuleSectionKey = 'round' | 'yaku' | 'multiplier' | 'koikoi' | 'noYaku' | 'overtime'

interface LocalRulePanelProps {
  readonly isOpen: boolean
  readonly canEdit: boolean
  readonly isDeferredApply: boolean
  readonly roundCountOptions: readonly RoundCountOption[]
  readonly selectedRoundCount: RoundCountOption
  readonly localRules: LocalRuleSettings
  readonly yakuFields: readonly {
    key: YakuType
    label: string
    condition: string
    exampleCardIds: readonly string[]
  }[]
  readonly onClose: () => void
  readonly onResetToDefaults: () => void
  readonly onSelectRoundCount: (value: RoundCountOption) => void
  readonly onChangeYakuEnabled: (yakuType: YakuType, enabled: boolean) => void
  readonly onChangeYakuPoint: (yakuType: YakuType, rawValue: string) => void
  readonly onChangeKoiKoiBonusMode: (mode: LocalRuleSettings['koiKoiBonusMode']) => void
  readonly onToggleKoiKoiShowdown: (enabled: boolean) => void
  readonly onChangeSelfKoiBonusFactor: (rawValue: string) => void
  readonly onChangeOpponentKoiBonusFactor: (rawValue: string) => void
  readonly onChangeNoYakuPolicy: (policy: LocalRuleSettings['noYakuPolicy']) => void
  readonly onChangeNoYakuParentPoints: (rawValue: string) => void
  readonly onChangeNoYakuChildPoints: (rawValue: string) => void
  readonly onToggleAmeNagare: (enabled: boolean) => void
  readonly onToggleKiriNagare: (enabled: boolean) => void
  readonly onChangeKoikoiLimit: (rawValue: string) => void
  readonly onChangeDealerRotationMode: (mode: LocalRuleSettings['dealerRotationMode']) => void
  readonly onToggleDrawOvertime: (enabled: boolean) => void
  readonly onChangeDrawOvertimeMode: (mode: LocalRuleSettings['drawOvertimeMode']) => void
  readonly onChangeDrawOvertimeRounds: (rawValue: string) => void
}

function Stepper(props: {
  readonly value: number
  readonly min: number
  readonly max: number
  readonly disabled: boolean
  readonly onChange: (rawValue: string) => void
}) {
  const { value, min, max, disabled, onChange } = props
  return (
    <span className="stepper">
      <button
        type="button"
        className="stepper-btn"
        onClick={() => onChange(String(Math.max(min, value - 1)))}
        disabled={disabled || value <= min}
        aria-label="減らす"
      >
        −
      </button>
      <span className="stepper-value">{value}</span>
      <button
        type="button"
        className="stepper-btn"
        onClick={() => onChange(String(Math.min(max, value + 1)))}
        disabled={disabled || value >= max}
        aria-label="増やす"
      >
        +
      </button>
    </span>
  )
}

function RuleSection(props: {
  readonly id: RuleSectionKey
  readonly title: string
  readonly summary: string
  readonly open: boolean
  readonly onToggle: (id: RuleSectionKey) => void
  readonly children: ReactNode
}) {
  const { id, title, summary, open, onToggle, children } = props

  return (
    <section className={`local-rule-section-card local-rule-accordion-item ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="local-rule-accordion-trigger"
        onClick={() => onToggle(id)}
        aria-expanded={open}
      >
        <span className="local-rule-accordion-title-wrap">
          <span className="local-rule-accordion-title">{title}</span>
          <span className="local-rule-accordion-summary">{summary}</span>
        </span>
        <span className={`local-rule-accordion-caret ${open ? 'open' : ''}`} aria-hidden="true">▽</span>
      </button>
      {open ? <div className="local-rule-accordion-content">{children}</div> : null}
    </section>
  )
}

function toCardExamples(exampleCardIds: readonly string[]): readonly HanafudaCard[] {
  return exampleCardIds
    .map((id) => getCardById(id))
    .filter((card): card is HanafudaCard => Boolean(card))
}

export function LocalRulePanel(props: LocalRulePanelProps) {
  const {
    isOpen,
    canEdit,
    isDeferredApply,
    roundCountOptions,
    selectedRoundCount,
    localRules,
    yakuFields,
    onClose,
    onResetToDefaults,
    onSelectRoundCount,
    onChangeYakuEnabled,
    onChangeYakuPoint,
    onChangeKoiKoiBonusMode,
    onToggleKoiKoiShowdown,
    onChangeSelfKoiBonusFactor,
    onChangeOpponentKoiBonusFactor,
    onChangeNoYakuPolicy,
    onChangeNoYakuParentPoints,
    onChangeNoYakuChildPoints,
    onToggleAmeNagare,
    onToggleKiriNagare,
    onChangeKoikoiLimit,
    onChangeDealerRotationMode,
    onToggleDrawOvertime,
    onChangeDrawOvertimeMode,
    onChangeDrawOvertimeRounds,
  } = props

  const [openSections, setOpenSections] = useState<Record<RuleSectionKey, boolean>>({
    round: true,
    yaku: true,
    multiplier: true,
    koikoi: true,
    noYaku: false,
    overtime: false,
  })

  if (!isOpen) {
    return null
  }

  const toggleSection = (id: RuleSectionKey): void => {
    setOpenSections((current) => ({
      ...current,
      [id]: !current[id],
    }))
  }

  const usesMultiplierMode = localRules.koiKoiBonusMode !== 'none'
  const usesSeatPointNoYaku = localRules.noYakuPolicy === 'seat-points'
  const usesDrawOvertime = localRules.enableDrawOvertime
  const isUnlimitedOvertime = localRules.drawOvertimeMode === 'until-decision'
  const footerNote = canEdit
    ? isDeferredApply
      ? 'CPU対戦中の変更は保存され、次に対戦を開始したときから反映されます。'
      : '変更内容は次の配札から適用されます。'
    : '通信対戦中は設定を固定し、現在値のみ確認できます。'

  return (
    <section className="local-rule-overlay" role="presentation" onClick={onClose}>
      <section
        className="local-rule-panel"
        role="dialog"
        aria-modal="true"
        aria-label="ローカルルール"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="local-rule-panel-head">
          <div className="local-rule-panel-title">
            <h2>ローカルルール</h2>
            <p>項目を開いて、変更内容を確認しながら調整できます。</p>
          </div>
          <div className="local-rule-panel-head-actions">
            <span className={`local-rule-edit-state ${canEdit ? 'editable' : 'locked'}`}>
              {canEdit ? '編集可能' : '閲覧のみ'}
            </span>
            <button type="button" className="score-table-close-button" onClick={onClose}>
              閉じる
            </button>
          </div>
        </div>

        <div className="local-rule-panel-body">
          <RuleSection
            id="round"
            title="月数設定"
            summary="対局全体の月数"
            open={openSections.round}
            onToggle={toggleSection}
          >
            <div className="round-count-selector" aria-label="月数選択">
              {roundCountOptions.map((roundCount) => (
                <button
                  key={roundCount}
                  type="button"
                  className={`round-count-button ${selectedRoundCount === roundCount ? 'active' : ''}`}
                  onClick={() => onSelectRoundCount(roundCount)}
                  disabled={!canEdit}
                >
                  {roundCount}月
                </button>
              ))}
            </div>
            <p className="local-rule-setting-help">長い対局ほど逆転の余地が増えます。</p>
          </RuleSection>

          <RuleSection
            id="yaku"
            title="役一覧"
            summary="有効/無効と点数"
            open={openSections.yaku}
            onToggle={toggleSection}
          >
            <div className="local-rule-yaku-row local-rule-yaku-row-head" aria-hidden="true">
              <span className="local-rule-yaku-col-enabled">有効</span>
              <span className="local-rule-yaku-col-name">役名</span>
              <span className="local-rule-yaku-col-cards">カード</span>
              <span className="local-rule-yaku-col-detail">役詳細</span>
            </div>
            <div className="local-rule-yaku-list">
              {yakuFields.map((field) => {
                const exampleCards = toCardExamples(field.exampleCardIds)
                const point = localRules.yakuPoints[field.key]
                const enabled = field.key === 'shiten'
                  ? localRules.enableFourCardsYaku
                  : field.key === 'hanami-zake'
                    ? localRules.enableHanamiZake
                    : field.key === 'tsukimi-zake'
                      ? localRules.enableTsukimiZake
                      : localRules.yakuEnabled[field.key]
                const isHanami = field.key === 'hanami-zake'
                const isTsukimi = field.key === 'tsukimi-zake'

                return (
                  <article key={field.key} className="local-rule-yaku-item">
                    <div className="local-rule-yaku-main-row">
                      <label className="local-rule-yaku-col-enabled local-rule-yaku-enable-check">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(event) => onChangeYakuEnabled(field.key, event.target.checked)}
                          disabled={!canEdit}
                        />
                      </label>
                      <span className={`local-rule-yaku-col-name local-rule-yaku-name ${enabled ? '' : 'disabled'}`}>{field.label}</span>
                      <div className="local-rule-yaku-col-cards local-rule-yaku-example" aria-label={`${field.label} の成立札例`}>
                        {exampleCards.map((card) => (
                          <img
                            key={`${field.key}-${card.id}`}
                            src={getCardImageUrl(card)}
                            alt={`${card.month}月 ${card.name}`}
                            loading="lazy"
                          />
                        ))}
                      </div>
                      <div className="local-rule-yaku-col-detail local-rule-yaku-detail-wrap">
                        <p className={`local-rule-yaku-detail ${enabled ? '' : 'disabled'}`}>{field.condition}</p>
                        <div className="local-rule-yaku-detail-stepper">
                          <Stepper
                            value={point}
                            min={0}
                            max={99}
                            disabled={!canEdit || !enabled}
                            onChange={(raw) => onChangeYakuPoint(field.key, raw)}
                          />
                        </div>
                      </div>
                    </div>
                    {isHanami ? (
                      <div className="local-rule-yaku-flow-row">
                        <label className="local-rule-flow-toggle">
                          <input
                            type="checkbox"
                            checked={localRules.enableAmeNagare}
                            onChange={(event) => onToggleAmeNagare(event.target.checked)}
                            disabled={!canEdit || !enabled}
                          />
                          <span>雨流れを有効</span>
                        </label>
                        <p className="local-rule-flow-help">
                          有効時は、柳に小野道風（11月の光札）を取っている間、花見で一杯は成立しません。
                        </p>
                      </div>
                    ) : null}
                    {isTsukimi ? (
                      <div className="local-rule-yaku-flow-row">
                        <label className="local-rule-flow-toggle">
                          <input
                            type="checkbox"
                            checked={localRules.enableKiriNagare}
                            onChange={(event) => onToggleKiriNagare(event.target.checked)}
                            disabled={!canEdit || !enabled}
                          />
                          <span>霧流れを有効</span>
                        </label>
                        <p className="local-rule-flow-help">
                          有効時は、桐札（12月札）を取っている間、月見で一杯は成立しません。
                        </p>
                      </div>
                    ) : null}
                    {!enabled ? <p className="local-rule-yaku-disabled-note">この役は無効です。</p> : null}
                    {enabled && point === 0 ? <p className="local-rule-yaku-disabled-note">0点のため、この役は成立しません。</p> : null}
                  </article>
                )
              })}
            </div>
            <p className="local-rule-setting-help">役を無効にすると判定対象から外れます。</p>
          </RuleSection>

          <RuleSection
            id="multiplier"
            title="倍率方式"
            summary="加算式/乗算式"
            open={openSections.multiplier}
            onToggle={toggleSection}
          >
            <div className="local-rule-row">
              <label className="local-rule-mode-item">
                <span>方式</span>
                <select
                  value={localRules.koiKoiBonusMode}
                  onChange={(event) =>
                    onChangeKoiKoiBonusMode(event.target.value as LocalRuleSettings['koiKoiBonusMode'])
                  }
                  disabled={!canEdit}
                >
                  <option value="none">倍率なし</option>
                  <option value="additive">加算式</option>
                  <option value="multiplicative">乗算式</option>
                </select>
              </label>
            </div>
            <div className="local-rule-info-box">
              <p className="local-rule-info-box-line">倍率なし: ボーナス倍率を適用しない</p>
              <p className="local-rule-info-box-line">加算: 基本点 × (1 + ボーナス数)</p>
              <p className="local-rule-info-box-line">乗算: 基本点 × 各倍率の積</p>
            </div>
          </RuleSection>

          <RuleSection
            id="koikoi"
            title="こいこい設定"
            summary="合戦と倍率"
            open={openSections.koikoi}
            onToggle={toggleSection}
          >
            <div className="local-rule-stack">
              <label className="local-rule-toggle-item">
                <input
                  type="checkbox"
                  checked={localRules.enableKoiKoiShowdown}
                  onChange={(event) => onToggleKoiKoiShowdown(event.target.checked)}
                  disabled={!canEdit}
                />
                <span>こいこい合戦</span>
              </label>
              <div className="local-rule-row local-rule-inline-row">
                <div className="local-rule-mode-item">
                  <span>自分こいこい倍率</span>
                  <Stepper
                    value={localRules.selfKoiBonusFactor}
                    min={1}
                    max={5}
                    disabled={!canEdit || !usesMultiplierMode}
                    onChange={onChangeSelfKoiBonusFactor}
                  />
                </div>
                <div className="local-rule-mode-item">
                  <span>相手こいこい倍率</span>
                  <Stepper
                    value={localRules.opponentKoiBonusFactor}
                    min={1}
                    max={5}
                    disabled={!canEdit || !usesMultiplierMode}
                    onChange={onChangeOpponentKoiBonusFactor}
                  />
                </div>
              </div>
              <div className="local-rule-mode-item">
                <span>こいこい上限数（1人あたり）</span>
                <Stepper
                  value={localRules.koikoiLimit}
                  min={0}
                  max={12}
                  disabled={!canEdit || !localRules.enableKoiKoiShowdown}
                  onChange={onChangeKoikoiLimit}
                />
              </div>
            </div>
            <div className="local-rule-info-box">
              <p className="local-rule-info-box-line">合戦OFF: こいこい後に次の役が出たら上がり確定</p>
              <p className="local-rule-info-box-line">合戦ON: 互いにこいこいを続けられる</p>
              <p className="local-rule-info-box-line">上限数: 合戦ON時のみ有効（0で上限なし）</p>
            </div>
          </RuleSection>

          <RuleSection
            id="noYaku"
            title="役なし上がり/親設定"
            summary="役なし時の清算と親の回し方"
            open={openSections.noYaku}
            onToggle={toggleSection}
          >
            <div className="local-rule-stack">
              <label className="local-rule-mode-item">
                <span>親の回し方</span>
                <select
                  value={localRules.dealerRotationMode}
                  onChange={(event) =>
                    onChangeDealerRotationMode(event.target.value as LocalRuleSettings['dealerRotationMode'])
                  }
                  disabled={!canEdit}
                >
                  <option value="winner">勝者が親</option>
                  <option value="loser">敗者が親</option>
                  <option value="alternate">順番に交代</option>
                </select>
              </label>

              <label className="local-rule-mode-item">
                <span>役なし</span>
                <select
                  value={localRules.noYakuPolicy}
                  onChange={(event) =>
                    onChangeNoYakuPolicy(event.target.value as LocalRuleSettings['noYakuPolicy'])
                  }
                  disabled={!canEdit}
                >
                  <option value="both-zero">双方0点</option>
                  <option value="seat-points">親子点数</option>
                </select>
              </label>

              <div className="local-rule-row local-rule-inline-row">
                <div className="local-rule-mode-item">
                  <span>親点</span>
                  <Stepper
                    value={localRules.noYakuParentPoints}
                    min={0}
                    max={99}
                    disabled={!canEdit || !usesSeatPointNoYaku}
                    onChange={onChangeNoYakuParentPoints}
                  />
                </div>
                <div className="local-rule-mode-item">
                  <span>子点</span>
                  <Stepper
                    value={localRules.noYakuChildPoints}
                    min={0}
                    max={99}
                    disabled={!canEdit || !usesSeatPointNoYaku}
                    onChange={onChangeNoYakuChildPoints}
                  />
                </div>
              </div>
            </div>
            <div className="local-rule-info-box">
              <p className="local-rule-info-box-line">双方0点: 役なし時は両者0点</p>
              <p className="local-rule-info-box-line">親子点数: 役なし時に親点/子点を適用</p>
            </div>
          </RuleSection>

          <RuleSection
            id="overtime"
            title="引き分け延長"
            summary="同点時の追加月"
            open={openSections.overtime}
            onToggle={toggleSection}
          >
            <div className="local-rule-stack">
              <label className="local-rule-toggle-item">
                <input
                  type="checkbox"
                  checked={localRules.enableDrawOvertime}
                  onChange={(event) => onToggleDrawOvertime(event.target.checked)}
                  disabled={!canEdit}
                />
                <span>延長を有効</span>
              </label>
              <div className="local-rule-row local-rule-inline-row">
                <label className="local-rule-mode-item">
                  <span>延長方式</span>
                  <select
                    value={localRules.drawOvertimeMode}
                    onChange={(event) =>
                      onChangeDrawOvertimeMode(event.target.value as LocalRuleSettings['drawOvertimeMode'])
                    }
                    disabled={!canEdit || !usesDrawOvertime}
                  >
                    <option value="fixed">回数指定</option>
                    <option value="until-decision">勝負が決まるまで</option>
                  </select>
                </label>
                <div className="local-rule-mode-item">
                  <span>延長回数</span>
                  <Stepper
                    value={localRules.drawOvertimeRounds}
                    min={0}
                    max={12}
                    disabled={!canEdit || !usesDrawOvertime || isUnlimitedOvertime}
                    onChange={onChangeDrawOvertimeRounds}
                  />
                </div>
              </div>
            </div>
            <div className="local-rule-info-box">
              <p className="local-rule-info-box-line">回数指定: 指定した回数だけ延長する</p>
              <p className="local-rule-info-box-line">勝負が決まるまで: 同点のあいだ自動で延長する</p>
            </div>
          </RuleSection>
          <div className="local-rule-reset-area">
            <p className="local-rule-panel-note">{footerNote}</p>
            <button type="button" className="local-rule-reset-button" onClick={onResetToDefaults} disabled={!canEdit}>
              デフォルトに戻す
            </button>
          </div>
        </div>

        <div className="local-rule-panel-footer">
          <button type="button" className="local-rule-close-button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </section>
    </section>
  )
}

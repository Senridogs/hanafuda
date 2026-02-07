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
import { loadSessionMeta } from './net/persistence'
import './App.css'
import { chooseAiHandCard, chooseAiKoiKoi, chooseAiMatch } from './engine/ai'
import { getCardImageUrl } from './engine/cardArt'
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
import { DEFAULT_CONFIG, type HanafudaCard, type Yaku } from './engine/types'
import { getYakuTotalPoints } from './engine/yaku'
import { MultiplayerLobby } from './components/MultiplayerLobby'
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
  duration?: number
  toWidth?: number
  toHeight?: number
  rotateStart?: number
  rotateEnd?: number
  zIndex?: number
  hideFieldCardId?: string
  flipFromBack?: boolean
  flipHoldRatio?: number
  addToFieldHistoryLength?: number
  fromDeck?: boolean
}

type TurnDecisionCallout = {
  id: number
  kind: 'koikoi' | 'stop'
  text: string
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

const CPU_HAND_REVEAL_HOLD_RATIO = 0.52
const HAND_LAYOUT_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const HAND_LAYOUT_TRANSITION = { layout: { duration: 0.82, ease: HAND_LAYOUT_EASE } }
const CARD_MOVE_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1]
const CARD_HEIGHT_PER_WIDTH = 839 / 512
const CAPTURE_STACK_CARD_WIDTH = 34
const CAPTURE_STACK_OVERLAP_BASE = 0.62
const ROUND_COUNT_OPTIONS = [3, 6, 12] as const
const MOBILE_BREAKPOINT_QUERY = '(max-width: 720px)'
const FLICK_MIN_DISTANCE_PX = 38
const FLICK_MIN_SPEED_PX_PER_MS = 0.28
const FLICK_MIN_UPWARD_DELTA_PX = -10
const TAP_MAX_DISTANCE_PX = 10
const TAP_MAX_DURATION_MS = 300
const FIELD_EMPTY_SLOT_TARGET_ID = '__field-empty-slot__'
const EXPANDED_SELECTION_CANCEL_PULSE_MS = 120
const TURN_DECISION_EFFECT_DURATION_MS = 2400
const TURN_DECISION_EFFECT_DURATION_SECONDS = TURN_DECISION_EFFECT_DURATION_MS / 1000
const TURN_BANNER_AFTER_KOIKOI_DELAY_MS = TURN_DECISION_EFFECT_DURATION_MS + 140
const PC_YAKU_LIGHT_KEYS = new Set(['goko', 'shiko', 'ame-shiko', 'sanko'])
const PC_YAKU_TANE_KEYS = new Set(['tane', 'inoshikacho', 'hanami-zake', 'tsukimi-zake'])
const PC_YAKU_TAN_KEYS = new Set(['tanzaku', 'akatan', 'aotan'])
const TURN_DECISION_SPARK_INDICES = [0, 1, 2, 3, 4, 5, 6, 7] as const

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

function buildRoundPointBreakdownLines(game: KoiKoiGameState): readonly string[] | undefined {
  if (game.roundReason !== 'stop' || !game.roundWinner) {
    return undefined
  }

  const winnerIndex: 0 | 1 = game.roundWinner === 'player1' ? 0 : 1
  const winner = game.players[winnerIndex]
  const opponentIndex: 0 | 1 = winnerIndex === 0 ? 1 : 0
  const yaku = [...winner.completedYaku].sort((a, b) => b.points - a.points)
  const basePoints = Math.max(1, getYakuTotalPoints(winner.completedYaku))

  const canApplyHighPointBonus = basePoints >= 7
  const canApplyOpponentKoiBonus = game.koikoiCounts[opponentIndex] > 0
  const multiplierCandidates = [
    { highPointBonus: false, opponentKoiBonus: false },
    { highPointBonus: true, opponentKoiBonus: false },
    { highPointBonus: false, opponentKoiBonus: true },
    { highPointBonus: true, opponentKoiBonus: true },
  ].filter((candidate) => {
    if (candidate.highPointBonus && !canApplyHighPointBonus) {
      return false
    }
    if (candidate.opponentKoiBonus && !canApplyOpponentKoiBonus) {
      return false
    }
    return true
  })

  const matchedMultiplier = multiplierCandidates.find((candidate) => {
    const total =
      basePoints
      * (candidate.highPointBonus ? 2 : 1)
      * (candidate.opponentKoiBonus ? 2 : 1)
    return total === game.roundPoints
  })

  const lines: string[] = yaku.length > 0
    ? yaku.map((item) => `${item.name}: ${item.points}文`)
    : ['役なし: 1文']
  lines.push(`役合計: ${basePoints}文`)

  if (matchedMultiplier) {
    const appliedMultipliers: number[] = []
    if (matchedMultiplier.highPointBonus) {
      lines.push('7文以上ボーナス: ×2')
      appliedMultipliers.push(2)
    }
    if (matchedMultiplier.opponentKoiBonus) {
      lines.push('相手こいこいボーナス: ×2')
      appliedMultipliers.push(2)
    }
    if (appliedMultipliers.length > 0) {
      lines.push(`最終得点: ${basePoints} × ${appliedMultipliers.join(' × ')} = ${game.roundPoints}文`)
    } else {
      lines.push(`最終得点: ${game.roundPoints}文`)
    }
    return lines
  }

  lines.push(`最終得点: ${game.roundPoints}文`)
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
  active: boolean
  side: 'left' | 'right'
}) {
  const { captureZoneId, title, score, captured, yaku, blockedCardIds, active, side } = props
  const progressEntries = useMemo(
    () => buildYakuProgressEntries(captured, yaku, blockedCardIds),
    [captured, yaku, blockedCardIds],
  )
  const visibleProgressEntries = useMemo(
    () => buildVisibleYakuProgressEntries(progressEntries),
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
        <span className="panel-mini-score">{score}文</span>
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
            <div className="mobile-yaku-cards stack">
              {group.cards.slice(0, 5).map((card) => (
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
        <span>{title}</span>
        <span className="mobile-mini-score">{score}文</span>
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
}) {
  const {
    roundScoreHistory,
    player1Name,
    player2Name,
    player1TotalScore,
    player2TotalScore,
    currentRound,
    maxRounds,
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

  return (
    <div className="score-table">
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
              <td className="score-table-month">{row.round}月</td>
              <td className={row.player1Points !== null && row.player1Points > 0 ? 'won' : ''}>
                {row.player1Points !== null ? `${row.player1Points}文` : '-'}
              </td>
              <td className={row.player2Points !== null && row.player2Points > 0 ? 'won' : ''}>
                {row.player2Points !== null ? `${row.player2Points}文` : '-'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="score-table-total">
            <td>合計</td>
            <td className={player1TotalScore > player2TotalScore ? 'leading' : ''}>
              {player1TotalScore}文
            </td>
            <td className={player2TotalScore > player1TotalScore ? 'leading' : ''}>
              {player2TotalScore}文
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function RoundOverlay(props: {
  title: string
  message: ReactNode
  messageLines?: readonly ReactNode[]
  primaryActionLabel: string
  onPrimaryAction: () => void
  secondaryActionLabel?: string
  onSecondaryAction?: () => void
}) {
  const {
    title,
    message,
    messageLines,
    primaryActionLabel,
    onPrimaryAction,
    secondaryActionLabel,
    onSecondaryAction,
  } = props

  return (
    <div className="overlay">
      <div className="overlay-card">
        <h2>{title}</h2>
        <p>{message}</p>
        {messageLines && messageLines.length > 0 ? (
          <ul className="overlay-message-list">
            {messageLines.map((line, index) => (
              <li key={`${index}-${String(line)}`}>{line}</li>
            ))}
          </ul>
        ) : null}
        <div className="overlay-actions">
          <button type="button" className="primary" onClick={onPrimaryAction}>
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

function YakuDropEffect(props: { cards: readonly HanafudaCard[] }) {
  const { cards } = props

  return (
    <AnimatePresence>
      {cards.length > 0 ? (
        <motion.div className="yaku-drop-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.p
            className="yaku-drop-title"
            initial={{ y: -30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
          >
            役成立！
          </motion.p>
          {cards.map((card, index) => (
            <motion.div
              key={`drop-${card.id}-${index}`}
              className="yaku-drop-card"
              initial={{ y: -260, opacity: 0, rotate: index % 2 === 0 ? -16 : 16 }}
              animate={{ y: 0, opacity: 1, rotate: 0 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 95, damping: 22, delay: index * 0.24 }}
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
      {callouts.map((callout) => (
        <motion.div
          key={callout.id}
          className="turn-callout-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className={`turn-callout-burst ${callout.kind}`}
            initial={{ y: 56, scale: 0.72, opacity: 0 }}
            animate={{ y: [56, 0, 0, -24], scale: [0.72, 1.08, 1.02, 1], opacity: [0, 1, 1, 0] }}
            transition={{
              duration: TURN_DECISION_EFFECT_DURATION_SECONDS,
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
      ))}
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
        const viaX = effect.viaX ?? effect.toX
        const viaY = effect.viaY ?? effect.toY
        const viaWidth = effect.viaWidth ?? effect.width
        const viaHeight = effect.viaHeight ?? effect.height
        const hold = Math.min(Math.max(effect.flipHoldRatio ?? 0, 0), 0.62)
        const baseMoveDuration = effect.duration ?? 1.64
        const totalDuration = hold > 0 ? baseMoveDuration / (1 - hold) : baseMoveDuration
        const viaTime = hold + (1 - hold) * 0.45
        const floatTimes = hold > 0 ? [0, hold, hold + (1 - hold) * 0.46, 1] : [0, 0.72, 1]
        const floatScaleFrames = hold > 0 ? [1, 1, 1.015, 1] : [1, 1.015, 1]
        const flipTurnTime = hold > 0 ? Math.max(0.18, hold - 0.06) : 0.38
        const flipTimes = hold > 0
          ? [0, flipTurnTime, hold, 1]
          : [0, 0.2, 0.4, 1]
        const xFrames = hasVia
          ? hold > 0
            ? [0, 0, viaX - effect.fromX, effect.toX - effect.fromX]
            : [0, viaX - effect.fromX, effect.toX - effect.fromX]
          : hold > 0
            ? [0, 0, effect.toX - effect.fromX]
            : [0, effect.toX - effect.fromX]
        const yFrames = hasVia
          ? hold > 0
            ? [0, 0, viaY - effect.fromY, effect.toY - effect.fromY]
            : [0, viaY - effect.fromY, effect.toY - effect.fromY]
          : hold > 0
            ? [0, 0, effect.toY - effect.fromY]
            : [0, effect.toY - effect.fromY]
        const rotateFrames = hasVia
          ? hold > 0
            ? [effect.rotateStart ?? -4, effect.rotateStart ?? -4, 0, effect.rotateEnd ?? 0]
            : [effect.rotateStart ?? -4, 0, effect.rotateEnd ?? 0]
          : hold > 0
            ? [effect.rotateStart ?? -4, effect.rotateStart ?? -4, effect.rotateEnd ?? 0]
            : [effect.rotateStart ?? -4, effect.rotateEnd ?? 0]
        const widthFrames = hasVia
          ? hold > 0
            ? [effect.width, effect.width, viaWidth, effect.toWidth ?? viaWidth]
            : [effect.width, viaWidth, effect.toWidth ?? viaWidth]
          : hold > 0
            ? [effect.width, effect.width, effect.toWidth ?? effect.width]
            : [effect.width, effect.toWidth ?? effect.width]
        const heightFrames = hasVia
          ? hold > 0
            ? [effect.height, effect.height, viaHeight, effect.toHeight ?? viaHeight]
            : [effect.height, viaHeight, effect.toHeight ?? viaHeight]
          : hold > 0
            ? [effect.height, effect.height, effect.toHeight ?? effect.height]
            : [effect.height, effect.toHeight ?? effect.height]
        const times = hasVia
          ? hold > 0
            ? [0, hold, viaTime, 1]
            : [0, 0.48, 1]
          : hold > 0
            ? [0, hold, 1]
            : [0, 1]

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
                      rotateY: [0, 180, 180, 180],
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
  const [game, setGame] = useState<KoiKoiGameState>(() => createNewGame())
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
      if (!meta) return
      if (meta.mode === 'p2p-host' && meta.roomId) {
        multiplayer.startHost(game, meta.roomId, true)
        return
      }
      if (meta.mode === 'p2p-guest' && meta.roomId) {
        multiplayer.setJoinRoomId(meta.roomId)
        multiplayer.joinAsGuest(game)
      }
    } catch {
      // ignore
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
  const appContainerRef = useRef<HTMLDivElement>(null)
  const [isMatchSurfaceVisible, setIsMatchSurfaceVisible] = useState(false)
  const [pendingHandPlaceholder, setPendingHandPlaceholder] = useState<{ card: HanafudaCard; index: number } | null>(null)
  const [pendingAiHandPlaceholder, setPendingAiHandPlaceholder] = useState<{ card: HanafudaCard; index: number } | null>(null)

  const [isScoreTableVisible, setIsScoreTableVisible] = useState(false)
  const [isHandExpanded, setIsHandExpanded] = useState(false)
  const expandedHandPlaceholderRef = useRef<HTMLDivElement | null>(null)
  const [expandedRackTop, setExpandedRackTop] = useState<number | null>(null)
  const [expandedSelectedCardId, setExpandedSelectedCardId] = useState<string | null>(null)
  const [expandedSelectionPulseCardId, setExpandedSelectionPulseCardId] = useState<string | null>(null)
  const expandedSelectionPulseTimerRef = useRef<number | null>(null)
  const pendingExpandedFieldSelectionRef = useRef<string | null>(null)
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

  const activePlayer = game.players[game.currentPlayerIndex]
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
  const aiBlockedCardIds = useMemo(() => new Set(humanPanelView.captured.map((card) => card.id)), [humanPanelView.captured])
  const humanBlockedCardIds = useMemo(() => new Set(aiPanelView.captured.map((card) => card.id)), [aiPanelView.captured])
  const aiVisibleProgressEntries = useMemo(
    () => buildVisibleYakuProgressEntries(buildYakuProgressEntries(aiPanelView.captured, aiPanelView.completedYaku, aiBlockedCardIds)),
    [aiPanelView.captured, aiPanelView.completedYaku, aiBlockedCardIds],
  )
  const humanVisibleProgressEntries = useMemo(
    () => buildVisibleYakuProgressEntries(buildYakuProgressEntries(humanPanelView.captured, humanPanelView.completedYaku, humanBlockedCardIds)),
    [humanPanelView.captured, humanPanelView.completedYaku, humanBlockedCardIds],
  )
  const isLocalTurn = game.currentPlayerIndex === localPlayerIndex
  const isAiTurn = !isLocalTurn
  const isCpuAiTurn = multiplayer.mode === 'cpu' && isAiTurn
  const canAutoAdvance = multiplayer.mode === 'cpu' || isLocalTurn
  const isLobbyConnected = multiplayer.mode !== 'cpu' && multiplayer.connectionStatus === 'connected'
  const koikoiEffectActive = turnDecisionCallouts.some((callout) => callout.kind === 'koikoi')
  const interactionLocked = moveEffects.length > 0 || koikoiEffectActive
  const humanDisplayName = multiplayer.mode === 'cpu' ? humanPlayer.name : 'あなた'
  const opponentDisplayName = multiplayer.mode === 'cpu' ? aiPlayer.name : '相手'
  // Use PC layout only when in fullscreen AND landscape orientation
  // Portrait fullscreen keeps mobile layout
  const useMobileViewLayout = isMobileLayout && !(isLandscapeFullscreen && isLandscapeOrientation)

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
      setIsLandscapeOrientation(window.innerWidth > window.innerHeight)
    }
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
    if (multiplayer.mode === 'cpu') {
      setIsMatchSurfaceVisible(true)
      return
    }
    if (multiplayer.connectionStatus === 'connected') {
      setIsMatchSurfaceVisible(true)
      setIsChromeCollapsed(true)
    }
  }, [multiplayer.connectionStatus, multiplayer.mode])

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
      turnBannerDelayTimerRef.current = window.setTimeout(() => {
        setTurnBanner(nextBanner)
        turnBannerDelayTimerRef.current = null
      }, TURN_BANNER_AFTER_KOIKOI_DELAY_MS)
      return
    }
    setTurnBanner(nextBanner)
  }, [game.currentPlayerIndex, game.phase, game.turnHistory, localPlayerIndex, opponentDisplayName])

  useEffect(() => {
    return () => {
      if (turnBannerDelayTimerRef.current !== null) {
        window.clearTimeout(turnBannerDelayTimerRef.current)
      }
    }
  }, [])

  const phaseMessage = useMemo(() => {
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
          ? `${game.roundWinner === humanPlayer.id ? 'あなた' : '相手'}が ${game.roundPoints}文 獲得`
          : 'この月は引き分け'
      case 'gameOver':
        return game.winner
          ? `対局終了: ${game.winner === humanPlayer.id ? 'あなた' : '相手'}の勝利`
          : '対局終了: 引き分け'
      default:
        return '対局中'
    }
  }, [game, humanPlayer.id, isCpuAiTurn, isLocalTurn, multiplayer.mode])
  const roundPointBreakdownLines = useMemo(
    () => buildRoundPointBreakdownLines(game),
    [game],
  )
  const koikoiDecisionYakuLines = useMemo(() => {
    return [...game.newYaku]
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ja'))
      .map((item) => `${item.name} (${item.points}文)`)
  }, [game.newYaku])

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
    if (
      !isHandExpanded ||
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
  }, [expandedSelectedCardId, game.field, humanPlayer.hand, isAiTurn, isHandExpanded, playerIntent])

  const dropCards = useMemo(
    () => (game.phase === 'koikoiDecision' ? flattenNewYakuCards(game.newYaku) : []),
    [game.phase, game.newYaku],
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

    const actorName = multiplayer.mode === 'cpu'
      ? game.players.find((player) => player.id === latest.player)?.name ?? 'プレイヤー'
      : (latest.player === humanPlayer.id ? 'あなた' : '相手')
    const shouldShowActorName = multiplayer.mode === 'cpu' || latest.player !== humanPlayer.id
    const label = latest.type === 'koikoi' ? 'こいこい！' : 'あがり！'
    const callout: TurnDecisionCallout = {
      id: turnDecisionCalloutIdRef.current,
      kind: latest.type,
      text: shouldShowActorName ? `${actorName} ${label}` : label,
    }
    turnDecisionCalloutIdRef.current += 1
    setTurnDecisionCallouts((current) => [...current, callout])
  }, [game.players, game.turnHistory, humanPlayer.id, multiplayer.mode])

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

    const hiddenHandHold = playerId === aiPlayer.id && source === 'hand' ? CPU_HAND_REVEAL_HOLD_RATIO : 0
    const concealTargetDuringHiddenFlip = playerId === aiPlayer.id && source === 'hand'
    const matchedCardTilt = stableTilt(matchedCard.id)
    const effectFromPlayed: CardMoveEffect = {
      id: captureEffectIdRef.current,
      card,
      fromX: sourceRect.left,
      fromY: sourceRect.top,
      viaX: matchedRect.left,
      viaY: matchedRect.top,
      viaWidth: matchedRect.width,
      viaHeight: matchedRect.height,
      toX: centerLeftA - targetCardWidth / 2,
      toY: zoneBaseY + randomYOffset,
      width: sourceRect.width,
      height: sourceRect.height,
      toWidth: targetCardWidth,
      toHeight: targetCardHeight,
      rotateStart: -6,
      rotateEnd: randomRotate,
      duration: 1.8,
      zIndex: 5,
      hideFieldCardId: matchedCard.id,
      flipFromBack: hiddenHandHold > 0,
      flipHoldRatio: hiddenHandHold > 0 ? hiddenHandHold : undefined,
      fromDeck: source === 'draw',
    }
    captureEffectIdRef.current += 1

    const effectFromField: CardMoveEffect = {
      id: captureEffectIdRef.current,
      card: matchedCard,
      fromX: matchedRect.left,
      fromY: matchedRect.top,
      viaX: matchedRect.left,
      viaY: matchedRect.top,
      viaWidth: matchedRect.width,
      viaHeight: matchedRect.height,
      toX: centerLeftB - targetCardWidth / 2,
      toY: zoneBaseY - randomYOffset,
      width: matchedRect.width,
      height: matchedRect.height,
      toWidth: targetCardWidth,
      toHeight: targetCardHeight,
      rotateStart: concealTargetDuringHiddenFlip ? matchedCardTilt : 4,
      rotateEnd: concealTargetDuringHiddenFlip ? matchedCardTilt - randomRotate * 0.35 : -randomRotate * 0.8,
      duration: 1.8,
      zIndex: 4,
      hideFieldCardId: matchedCard.id,
      flipHoldRatio: hiddenHandHold > 0 ? hiddenHandHold : undefined,
    }
    captureEffectIdRef.current += 1
    return [effectFromPlayed, effectFromField]
  }, [aiPlayer.id, collectCardRects])

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
        setGame((current) => startNextRound(current))
        return
      case 'restartGame':
        setGame((current) => createNewGame({
          ...current.config,
          maxRounds: command.maxRounds,
        }))
        return
    }
  }, [localPlayerIndex, resolveCaptureSelection])

  const executeTurnCommand = useCallback((command: TurnCommand): void => {
    if (multiplayer.mode === 'cpu') {
      executeTurnCommandLocal(command)
      return
    }

    if (multiplayer.mode === 'p2p-host' && multiplayer.connectionStatus !== 'connected') {
      executeTurnCommandLocal(command)
      return
    }

    const sent = multiplayer.sendTurnCommand(command)
    if (!sent) {
      return
    }
    executeTurnCommandLocal(command)
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
      const cardTilt = stableTilt(latest.card.id)

      const effect: CardMoveEffect = {
        id: captureEffectIdRef.current,
        card: latest.card,
        fromX: sourceRect.left,
        fromY: sourceRect.top,
        toX: targetRect.left,
        toY: targetRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
        rotateStart: cardTilt,
        rotateEnd: cardTilt,
        duration: 1.32,
        zIndex: 6,
        hideFieldCardId: latest.card.id,
        flipFromBack: fromCpuHand,
        flipHoldRatio: fromCpuHand ? CPU_HAND_REVEAL_HOLD_RATIO : undefined,
        addToFieldHistoryLength: historyLength,
        fromDeck: previous?.type === 'drawCard' && previous.card?.id === latest.card.id,
      }
      captureEffectIdRef.current += 1
      appendMoveEffects([effect])
      return
    }
  }, [appendMoveEffects, buildCaptureMoveEffects, game.turnHistory, moveEffects])

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
      const match = chooseAiMatch(current.pendingMatches)
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
      const match = chooseAiMatch(current.pendingMatches)
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
    if (!isCpuAiTurn || game.phase !== 'koikoiDecision' || interactionLocked) {
      return
    }

    const timer = window.setTimeout(() => {
      const current = gameRef.current
      if (current.phase !== 'koikoiDecision' || current.currentPlayerIndex !== opponentPlayerIndex) {
        return
      }
      executeTurnCommand({ type: 'resolveKoiKoi', decision: chooseAiKoiKoi(current) })
    }, AI_THINK_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [executeTurnCommand, game.phase, interactionLocked, isCpuAiTurn, opponentPlayerIndex])

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
    if (
      !isHandExpanded ||
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
    if (!target || target.closest('.lobby-input')) {
      return
    }
    const active = document.activeElement
    if (active instanceof HTMLElement && active.matches('input, textarea, [contenteditable="true"]')) {
      active.blur()
    }
  }, [])

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
    remoteCommandQueueRef.current = []
    pendingCaptureGameRef.current = null
    skipCaptureHistoryLengthRef.current = null
    moveEffectByIdRef.current.clear()
    moveBatchRemainingRef.current.clear()
  }, [])

  const handleSwitchToCpu = useCallback((): void => {
    setIsMatchSurfaceVisible(true)
    setIsChromeCollapsed(true)
    resetTransientUiState()
    multiplayer.teardownToCpu()
    setGame(createNewGame({
      ...game.config,
      enableAI: true,
      player1Name: DEFAULT_CONFIG.player1Name,
      player2Name: DEFAULT_CONFIG.player2Name,
    }))
  }, [game.config, multiplayer, resetTransientUiState])

  const handleStartHost = useCallback((): void => {
    setIsMatchSurfaceVisible(false)
    setIsChromeCollapsed(false)  // 部屋作成時はヘッダーを隠さない
    resetTransientUiState()
    const initial = createNewGame({
      ...game.config,
      enableAI: false,
      player1Name: 'あなた',
      player2Name: '相手',
    })
    setGame(initial)
    multiplayer.startHost(initial)
  }, [game.config, isMobileLayout, multiplayer, resetTransientUiState])

  const handleJoinGuest = useCallback((): void => {
    setIsMatchSurfaceVisible(false)
    setIsChromeCollapsed(isMobileLayout)
    resetTransientUiState()
    const initial = createNewGame({
      ...game.config,
      enableAI: false,
      player1Name: '相手',
      player2Name: 'あなた',
    })
    setGame(initial)
    multiplayer.joinAsGuest(initial)
  }, [game.config, isMobileLayout, multiplayer, resetTransientUiState])

  const handleLeaveMultiplayer = useCallback((): void => {
    setIsMatchSurfaceVisible(false)
    setIsChromeCollapsed(isMobileLayout)
    resetTransientUiState()
    multiplayer.leaveMultiplayer()
    setGame(createNewGame({
      ...game.config,
      enableAI: true,
      player1Name: DEFAULT_CONFIG.player1Name,
      player2Name: DEFAULT_CONFIG.player2Name,
    }))
  }, [game.config, isMobileLayout, multiplayer, resetTransientUiState])

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

  const handleRestart = useCallback((): void => {
    if (isLobbyConnected) {
      return
    }
    restartWithConfig(game.config)
  }, [game.config, isLobbyConnected, restartWithConfig])

  const hasMatchStarted = game.round > 1 || game.turnHistory.length > 0 || game.phase !== 'selectHandCard'
  const canSelectRoundCount = !hasMatchStarted && !isLobbyConnected
  const handleSelectRoundCount = useCallback((maxRounds: (typeof ROUND_COUNT_OPTIONS)[number]): void => {
    if (!canSelectRoundCount || game.config.maxRounds === maxRounds) {
      return
    }
    if (multiplayer.mode !== 'cpu') {
      const sent = multiplayer.sendTurnCommand({ type: 'restartGame', maxRounds })
      if (!sent) {
        return
      }
      resetTransientUiState()
      setGame((current) => createNewGame({
        ...current.config,
        maxRounds,
      }))
      return
    }
    restartWithConfig({
      ...game.config,
      maxRounds,
    })
  }, [canSelectRoundCount, game.config, multiplayer, resetTransientUiState, restartWithConfig])


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
        <div className="draw-slot" />

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
      <section className="app-chrome">
        <div className="chrome-toggle-row">
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
            onClick={() => setIsScoreTableVisible((current) => !current)}
          >
            {isScoreTableVisible ? '点数表を閉じる' : '点数表'}
          </button>
          <button
            type="button"
            className="chrome-toggle-button"
            onClick={() => setIsChromeCollapsed((current) => !current)}
            aria-expanded={!isChromeCollapsed}
          >
            {isChromeCollapsed ? 'ヘッダー/設定を開く' : 'ヘッダー/設定を閉じる'}
          </button>
        </div>

        {!isChromeCollapsed ? (
          <>
            <header className="topbar">
              <div>
                <h1>花札 こいこい</h1>
                <p>第 {game.round} / {game.config.maxRounds} 月</p>
              </div>
              <div className="topbar-actions">
                {game.phase !== 'roundEnd' && game.phase !== 'gameOver' && game.phase !== 'waiting' && game.phase !== 'dealing' ? (
                  <span className={`turn-badge ${isLocalTurn ? 'your-turn' : 'opponent-turn'}`}>
                    {isLocalTurn ? 'あなたの番' : `${opponentDisplayName}の番`}
                  </span>
                ) : null}
                <span className="phase-chip">{phaseMessage}</span>
                <div className="round-count-selector" aria-label="月数選択">
                  {ROUND_COUNT_OPTIONS.map((roundCount) => (
                    <button
                      key={roundCount}
                      type="button"
                      className={`round-count-button ${game.config.maxRounds === roundCount ? 'active' : ''}`}
                      onClick={() => handleSelectRoundCount(roundCount)}
                      disabled={!canSelectRoundCount}
                    >
                      {roundCount}月
                    </button>
                  ))}
                </div>
                <button type="button" onClick={handleRestart} disabled={isLobbyConnected}>
                  最初から
                </button>
              </div>
            </header>

            <MultiplayerLobby
              mode={multiplayer.mode}
              connectionStatus={multiplayer.connectionStatus}
              connectionLogs={multiplayer.connectionLogs}
              roomId={multiplayer.roomId}
              joinRoomId={multiplayer.joinRoomId}
              onJoinRoomIdChange={multiplayer.setJoinRoomId}
              onSwitchToCpu={handleSwitchToCpu}
              onStartHost={handleStartHost}
              onJoinGuest={handleJoinGuest}
              onReconnect={() => multiplayer.reconnect(gameRef.current)}
              onLeave={handleLeaveMultiplayer}
            />
          </>
        ) : null}
      </section>

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
              active={game.currentPlayerIndex === opponentPlayerIndex}
              side="left"
            />
          ) : null}

          <section className={`board-center ${useMobileViewLayout ? 'mobile' : ''}`} aria-label="対局ボード" onClick={handleBoardClick}>
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
              className={`card-rack player-rack ${useMobileViewLayout ? 'hand-flat' : ''} ${game.currentPlayerIndex === localPlayerIndex ? 'active-turn' : ''} ${isHandExpanded ? 'expanded' : ''} ${isHandExpanded && expandedRackTop !== null ? 'expanded-top-aligned' : ''}`}
              style={
                isHandExpanded && expandedRackTop !== null
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

                return (
                  <CardTile
                    key={card.id}
                    card={card}
                    selectable={selectable}
                    highlighted={highlighted}
                    dimmed={dimmed}
                    raised={isHandExpanded && expandedSelectedCardId === card.id}
                    tapPulse={isHandExpanded && expandedSelectionPulseCardId === card.id}
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
                        : () => handlePlayCard(card)
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
        <section className="score-table-panel" aria-label="点数表パネル">
          <div className="score-table-panel-head">
            <h2>点数表</h2>
            <button type="button" className="score-table-close-button" onClick={() => setIsScoreTableVisible(false)}>
              閉じる
            </button>
          </div>
          <ScoreTable
            roundScoreHistory={game.roundScoreHistory}
            player1Name={humanDisplayName}
            player2Name={opponentDisplayName}
            player1TotalScore={humanPlayer.score}
            player2TotalScore={aiPlayer.score}
            currentRound={game.round}
            maxRounds={game.config.maxRounds}
          />
        </section>
      ) : null}

      <YakuDropEffect cards={dropCards} />
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

      {game.phase === 'koikoiDecision' && !isAiTurn ? (
        <RoundOverlay
          title="役がそろいました"
          message={`現在 ${getYakuTotalPoints(activePlayer.completedYaku)}文。新規役:`}
          messageLines={koikoiDecisionYakuLines}
          primaryActionLabel="ここで上がる"
          onPrimaryAction={() => executeTurnCommand({ type: 'resolveKoiKoi', decision: 'stop' })}
          secondaryActionLabel="こいこいする"
          onSecondaryAction={() => executeTurnCommand({ type: 'resolveKoiKoi', decision: 'koikoi' })}
        />
      ) : null}

      {game.phase === 'roundEnd' ? (
        <RoundOverlay
          title="月が終了しました"
          message={
            game.roundWinner
              ? `${game.roundWinner === humanPlayer.id ? 'あなた' : '相手'}の勝利。${game.roundPoints}文を獲得しました。`
              : 'この月は引き分けです。'
          }
          messageLines={roundPointBreakdownLines}
          primaryActionLabel="次の月へ"
          onPrimaryAction={() => {
            setPendingHandPlaceholder(null)
            setPendingAiHandPlaceholder(null)
            executeTurnCommand({ type: 'startNextRound' })
          }}
        />
      ) : null}

      {game.phase === 'gameOver' ? (
        <RoundOverlay
          title="対局終了"
          message={
            game.winner
              ? `${game.winner === humanPlayer.id ? 'あなた' : '相手'}の勝利です。`
              : '最終結果は引き分けです。'
          }
          messageLines={roundPointBreakdownLines}
          primaryActionLabel="もう一度遊ぶ"
          onPrimaryAction={handleRestart}
        />
      ) : null}
    </main>
  )
}

export default App

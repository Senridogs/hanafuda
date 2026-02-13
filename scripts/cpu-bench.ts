import {
  checkTurn,
  commitDrawToField,
  createNewGame,
  drawStep,
  playHandCard,
  resolveKoiKoi,
  selectDrawMatch,
  selectHandMatch,
  startNextRound,
  type KoiKoiGameState,
} from '../src/engine/game.ts'
import { chooseAiHandCard, chooseAiKoiKoi, chooseAiMatch } from '../src/engine/ai.ts'
import type { GameConfig, LocalRuleSettingsInput } from '../src/engine/types.ts'
import { DEFAULT_LOCAL_RULE_SETTINGS } from '../src/engine/types.ts'

type Difficulty = 'yowai' | 'futsuu' | 'tsuyoi' | 'yabai' | 'oni' | 'kami'

interface RulePreset {
  readonly name: string
  readonly localRules: LocalRuleSettingsInput
}

const RULE_PRESETS: readonly RulePreset[] = [
  {
    name: 'デフォルト (multiplicative)',
    localRules: {},
  },
  {
    name: 'additive bonus',
    localRules: { koiKoiBonusMode: 'additive' },
  },
  {
    name: 'bonus なし',
    localRules: { koiKoiBonusMode: 'none' },
  },
  {
    name: '雨流れ+霧流れ',
    localRules: { enableAmeNagare: true, enableKiriNagare: true },
  },
  {
    name: '自こいこいx2 + 相手x2',
    localRules: { selfKoiBonusFactor: 2, opponentKoiBonusFactor: 2 },
  },
  {
    name: '親子有利 + alternate dealer',
    localRules: {
      noYakuPolicy: 'seat-points',
      noYakuParentPoints: 2,
      noYakuChildPoints: 1,
      dealerRotationMode: 'alternate',
    },
  },
]

const LADDER: readonly [Difficulty, Difficulty][] = [
  ['yowai', 'futsuu'],
  ['futsuu', 'tsuyoi'],
  ['tsuyoi', 'yabai'],
  ['yabai', 'oni'],
  ['oni', 'kami'],
]

function mulberry32(seed: number): () => number {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function withSeededRandom<T>(seed: number, run: () => T): T {
  const rng = mulberry32(seed)
  const original = Math.random
  Math.random = () => rng()
  try {
    return run()
  } finally {
    Math.random = original
  }
}

function withDifficulty(state: KoiKoiGameState, difficulty: Difficulty): KoiKoiGameState {
  return { ...state, config: { ...state.config, aiDifficulty: difficulty } }
}

function step(state: KoiKoiGameState, p1d: Difficulty, cpud: Difficulty): KoiKoiGameState {
  const d = state.currentPlayerIndex === 0 ? p1d : cpud
  switch (state.phase) {
    case 'selectHandCard': {
      const picked = chooseAiHandCard(withDifficulty(state, d))
      return picked ? playHandCard(state, picked.id) : state
    }
    case 'selectFieldMatch': {
      const match = chooseAiMatch(state.pendingMatches, d, withDifficulty(state, d))
      return match ? selectHandMatch(state, match.id) : state
    }
    case 'drawingDeck':
      return drawStep(state)
    case 'drawReveal':
      return commitDrawToField(state)
    case 'selectDrawMatch': {
      const match = chooseAiMatch(state.pendingMatches, d, withDifficulty(state, d))
      return match ? selectDrawMatch(state, match.id) : state
    }
    case 'checkYaku':
      return checkTurn(state)
    case 'koikoiDecision':
      return resolveKoiKoi(state, chooseAiKoiKoi(withDifficulty(state, d)))
    case 'roundEnd':
      return startNextRound(state)
    case 'gameOver':
      return state
    default:
      return state
  }
}

interface MatchStats {
  readonly winner: 'player1' | 'player2' | 'draw'
  readonly p1Score: number
  readonly p2Score: number
  readonly margin: number
  readonly totalRounds: number
  readonly koikoiCountP1: number
  readonly koikoiCountP2: number
  readonly leadChanges: number
  readonly yakuCountP1: number
  readonly yakuCountP2: number
}

function runMatchWithStats(
  seed: number,
  p1d: Difficulty,
  cpud: Difficulty,
  maxRounds: number,
  assistEnabled: boolean,
  localRules: LocalRuleSettingsInput,
): MatchStats {
  return withSeededRandom(seed, () => {
    const config: GameConfig = {
      targetScore: 50,
      maxRounds,
      enableAI: assistEnabled,
      aiDifficulty: cpud,
      player1Name: 'P1',
      player2Name: 'CPU',
      localRules: { ...DEFAULT_LOCAL_RULE_SETTINGS, ...localRules },
    }

    let state = createNewGame(config)
    let guard = 0
    let koikoiP1 = 0
    let koikoiP2 = 0
    let yakuP1 = 0
    let yakuP2 = 0
    let leadChanges = 0
    let prevLeader: 'p1' | 'p2' | 'tie' = 'tie'

    while (state.phase !== 'gameOver') {
      const prev = state
      const next = step(state, p1d, cpud)

      // Count koikoi declarations
      if (prev.phase === 'koikoiDecision' && next.phase === 'selectHandCard') {
        if (prev.currentPlayerIndex === 0) koikoiP1++
        else koikoiP2++
      }

      // Count yaku completions
      if (prev.phase === 'checkYaku' && next.phase === 'koikoiDecision') {
        if (prev.currentPlayerIndex === 0) yakuP1++
        else yakuP2++
      }

      // Track lead changes at round boundaries
      if ((next.phase === 'roundEnd' || next.phase === 'gameOver') && prev.phase !== 'roundEnd' && prev.phase !== 'gameOver') {
        const s1 = next.players[0].score
        const s2 = next.players[1].score
        const leader: 'p1' | 'p2' | 'tie' = s1 > s2 ? 'p1' : s2 > s1 ? 'p2' : 'tie'
        if (leader !== 'tie' && prevLeader !== 'tie' && leader !== prevLeader) {
          leadChanges++
        }
        if (leader !== 'tie') prevLeader = leader
      }

      if (next === state) {
        guard++
        if (guard > 4000) break
      } else {
        guard = 0
      }
      state = next
    }

    const p1Score = state.players[0].score
    const p2Score = state.players[1].score
    return {
      winner: state.winner ?? 'draw',
      p1Score,
      p2Score,
      margin: Math.abs(p1Score - p2Score),
      totalRounds: state.round,
      koikoiCountP1: koikoiP1,
      koikoiCountP2: koikoiP2,
      leadChanges,
      yakuCountP1: yakuP1,
      yakuCountP2: yakuP2,
    }
  })
}

interface AggregatedResult {
  p1Wins: number
  cpuWins: number
  draws: number
  cpuRate: number
  avgMargin: number
  closeGames: number
  blowouts: number
  avgLeadChanges: number
  avgKoikoiTotal: number
  avgYakuTotal: number
}

function runMatchup(
  p1d: Difficulty,
  cpud: Difficulty,
  maxRounds: number,
  seeds: number,
  assistEnabled: boolean,
  localRules: LocalRuleSettingsInput,
): AggregatedResult {
  let p1Wins = 0, cpuWins = 0, draws = 0
  let totalMargin = 0, closeGames = 0, blowouts = 0
  let totalLeadChanges = 0, totalKoikoi = 0, totalYaku = 0

  for (let seed = 1; seed <= seeds; seed++) {
    const s = runMatchWithStats(seed, p1d, cpud, maxRounds, assistEnabled, localRules)
    if (s.winner === 'player1') p1Wins++
    else if (s.winner === 'player2') cpuWins++
    else draws++

    totalMargin += s.margin
    if (s.margin <= 3) closeGames++
    if (s.margin >= 20) blowouts++
    totalLeadChanges += s.leadChanges
    totalKoikoi += s.koikoiCountP1 + s.koikoiCountP2
    totalYaku += s.yakuCountP1 + s.yakuCountP2
  }

  const total = p1Wins + cpuWins + draws
  return {
    p1Wins, cpuWins, draws,
    cpuRate: total === 0 ? 0 : (cpuWins / total) * 100,
    avgMargin: total === 0 ? 0 : totalMargin / total,
    closeGames,
    blowouts,
    avgLeadChanges: total === 0 ? 0 : totalLeadChanges / total,
    avgKoikoiTotal: total === 0 ? 0 : totalKoikoi / total,
    avgYakuTotal: total === 0 ? 0 : totalYaku / total,
  }
}

function pad(s: string, n: number): string {
  return s.padEnd(n)
}

function runFullBench(seeds: number, maxRounds: number, assistEnabled: boolean): void {
  for (const preset of RULE_PRESETS) {
    console.log(`\n${'='.repeat(70)}`)
    console.log(`  ${preset.name}  |  ${maxRounds}月戦  |  seeds=${seeds}  |  assist=${assistEnabled ? 'ON' : 'OFF'}`)
    console.log('='.repeat(70))
    console.log(
      `${pad('対戦', 22)} ${pad('上位勝率', 8)} ${pad('平均点差', 8)} ${pad('接戦', 6)} ${pad('大差', 6)} ${pad('逆転', 6)} ${pad('こいこい', 8)} ${pad('役数', 6)}`,
    )
    console.log('-'.repeat(70))

    for (const [lower, upper] of LADDER) {
      const r = runMatchup(lower, upper, maxRounds, seeds, assistEnabled, preset.localRules)
      console.log(
        `${pad(`${lower} vs ${upper}`, 22)} `
        + `${pad(r.cpuRate.toFixed(1) + '%', 8)} `
        + `${pad(r.avgMargin.toFixed(1), 8)} `
        + `${pad(String(r.closeGames), 6)} `
        + `${pad(String(r.blowouts), 6)} `
        + `${pad(r.avgLeadChanges.toFixed(2), 6)} `
        + `${pad(r.avgKoikoiTotal.toFixed(1), 8)} `
        + `${pad(r.avgYakuTotal.toFixed(1), 6)}`,
      )
    }
  }
}

function runPlayerSimulation(seeds: number, maxRounds: number): void {
  const header = `${pad('対戦', 24)} ${pad('CPU勝率', 8)} ${pad('平均点差', 8)} ${pad('接戦', 5)} ${pad('大差', 5)} ${pad('逆転', 6)} ${pad('こいこい', 8)}`

  for (const humanLevel of ['futsuu', 'tsuyoi'] as const) {
    console.log(`\n${'='.repeat(65)}`)
    console.log(`  人間想定(${humanLevel}) vs CPU  |  ${maxRounds}月戦  |  seeds=${seeds}  |  assist=ON`)
    console.log('='.repeat(65))
    console.log(header)
    console.log('-'.repeat(65))
    for (const cpuLevel of ['tsuyoi', 'yabai', 'oni', 'kami'] as Difficulty[]) {
      const r = runMatchup(humanLevel, cpuLevel, maxRounds, seeds, true, {})
      console.log(
        `${pad(`${humanLevel} vs ${cpuLevel}`, 24)} `
        + `${pad(r.cpuRate.toFixed(1) + '%', 8)} `
        + `${pad(r.avgMargin.toFixed(1), 8)} `
        + `${pad(String(r.closeGames), 5)} `
        + `${pad(String(r.blowouts), 5)} `
        + `${pad(r.avgLeadChanges.toFixed(2), 6)} `
        + `${pad(r.avgKoikoiTotal.toFixed(1), 8)}`,
      )
    }
  }
}

const seeds = 200
console.log('■ 人間想定 vs CPU（面白さ指標）')
runPlayerSimulation(seeds, 12)
runPlayerSimulation(seeds, 6)

console.log('\n\n■ 12月戦 ルール別ラダー assist ON')
runFullBench(seeds, 12, true)

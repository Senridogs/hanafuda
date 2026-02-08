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
import type { GameConfig, YakuType } from '../src/engine/types.ts'

type Difficulty = 'yowai' | 'futsuu' | 'tsuyoi' | 'yabai' | 'oni' | 'kami'
type Winner = 'player1' | 'player2' | 'draw'

type SidePolicy = {
  readonly hand: Difficulty
  readonly match: Difficulty
  readonly koi: Difficulty
}

type RoundYakuSnapshot = {
  readonly p1Yaku: readonly YakuType[]
  readonly p2Yaku: readonly YakuType[]
}

type MatchResult = {
  readonly winner: Winner
  readonly rounds: readonly RoundYakuSnapshot[]
}

const LEVELS: readonly Difficulty[] = ['yowai', 'futsuu', 'tsuyoi', 'yabai', 'oni', 'kami']
const LADDER: readonly [Difficulty, Difficulty][] = [
  ['yowai', 'futsuu'],
  ['futsuu', 'tsuyoi'],
  ['tsuyoi', 'yabai'],
  ['yabai', 'oni'],
  ['oni', 'kami'],
]
const RARE_YAKU: readonly YakuType[] = ['goko', 'shiko', 'ame-shiko', 'hanami-zake', 'tsukimi-zake']
const MAJOR_YAKU: readonly YakuType[] = ['goko', 'shiko', 'ame-shiko', 'sanko', 'inoshikacho', 'akatan', 'aotan']

const DEFAULTS = {
  ladderSeeds: 1500,
  yakuSeeds: 2500,
  ablationSeeds: 1200,
} as const

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
  return {
    ...state,
    config: {
      ...state.config,
      aiDifficulty: difficulty,
    },
  }
}

function difficultyPolicy(difficulty: Difficulty): SidePolicy {
  return { hand: difficulty, match: difficulty, koi: difficulty }
}

function step(state: KoiKoiGameState, p1Policy: SidePolicy, cpuPolicy: SidePolicy): KoiKoiGameState {
  const currentPolicy = state.currentPlayerIndex === 0 ? p1Policy : cpuPolicy

  switch (state.phase) {
    case 'selectHandCard': {
      const picked = chooseAiHandCard(withDifficulty(state, currentPolicy.hand))
      return picked ? playHandCard(state, picked.id) : state
    }
    case 'selectFieldMatch': {
      const match = chooseAiMatch(state.pendingMatches, currentPolicy.match, withDifficulty(state, currentPolicy.match))
      return match ? selectHandMatch(state, match.id) : state
    }
    case 'drawingDeck':
      return drawStep(state)
    case 'drawReveal':
      return commitDrawToField(state)
    case 'selectDrawMatch': {
      const match = chooseAiMatch(state.pendingMatches, currentPolicy.match, withDifficulty(state, currentPolicy.match))
      return match ? selectDrawMatch(state, match.id) : state
    }
    case 'checkYaku':
      return checkTurn(state)
    case 'koikoiDecision':
      return resolveKoiKoi(state, chooseAiKoiKoi(withDifficulty(state, currentPolicy.koi)))
    case 'roundEnd':
      return startNextRound(state)
    case 'gameOver':
      return state
    default:
      return state
  }
}

function runMatch(
  seed: number,
  p1Policy: SidePolicy,
  cpuPolicy: SidePolicy,
  maxRounds: number,
  assistEnabled: boolean,
): MatchResult {
  return withSeededRandom(seed, () => {
    const config: GameConfig = {
      targetScore: 50,
      maxRounds,
      enableAI: assistEnabled,
      aiDifficulty: cpuPolicy.hand,
      player1Name: 'P1',
      player2Name: 'CPU',
    }

    let state = createNewGame(config)
    let guard = 0
    let lastCollectedRound = 0
    const rounds: RoundYakuSnapshot[] = []

    while (state.phase !== 'gameOver') {
      if ((state.phase === 'roundEnd' || state.phase === 'gameOver') && state.round > lastCollectedRound) {
        rounds.push({
          p1Yaku: state.players[0].completedYaku.map((y) => y.type),
          p2Yaku: state.players[1].completedYaku.map((y) => y.type),
        })
        lastCollectedRound = state.round
      }

      const next = step(state, p1Policy, cpuPolicy)
      if (next === state) {
        guard += 1
        if (guard > 4000) {
          throw new Error(`Stalled game seed=${seed}`)
        }
      } else {
        guard = 0
      }
      state = next
    }

    if ((state.phase === 'roundEnd' || state.phase === 'gameOver') && state.round > lastCollectedRound) {
      rounds.push({
        p1Yaku: state.players[0].completedYaku.map((y) => y.type),
        p2Yaku: state.players[1].completedYaku.map((y) => y.type),
      })
    }

    return {
      winner: state.winner ?? 'draw',
      rounds,
    }
  })
}

function evaluateWinrate(
  p1Policy: SidePolicy,
  cpuPolicy: SidePolicy,
  rounds: number,
  seeds: number,
  assistEnabled: boolean,
): { p1Wins: number; cpuWins: number; draws: number; p1Rate: number; cpuRate: number } {
  let p1Wins = 0
  let cpuWins = 0
  let draws = 0

  for (let seed = 1; seed <= seeds; seed += 1) {
    const result = runMatch(seed, p1Policy, cpuPolicy, rounds, assistEnabled)
    if (result.winner === 'player1') {
      p1Wins += 1
    } else if (result.winner === 'player2') {
      cpuWins += 1
    } else {
      draws += 1
    }
  }

  const total = p1Wins + cpuWins + draws
  return {
    p1Wins,
    cpuWins,
    draws,
    p1Rate: total === 0 ? 0 : (p1Wins / total) * 100,
    cpuRate: total === 0 ? 0 : (cpuWins / total) * 100,
  }
}

function runLadder(rounds: number, seeds: number, assistEnabled: boolean): void {
  console.log(`\\n== ladder rounds=${rounds} seeds=${seeds} assist=${assistEnabled ? 'on' : 'off'} ==`)
  for (const [prev, next] of LADDER) {
    const r = evaluateWinrate(
      difficultyPolicy(prev),
      difficultyPolicy(next),
      rounds,
      seeds,
      assistEnabled,
    )
    console.log(
      `cpu(${next}) vs p1(${prev}): cpu=${r.cpuWins} p1=${r.p1Wins} draw=${r.draws} cpuRate=${r.cpuRate.toFixed(1)}%`,
    )
  }
}

function runBestVsLevels(rounds: number, seeds: number, assistEnabled: boolean): void {
  console.log(`\\n== best-policy(p1=kami) rounds=${rounds} seeds=${seeds} assist=${assistEnabled ? 'on' : 'off'} ==`)
  const p1 = difficultyPolicy('kami')
  for (const level of LEVELS) {
    const r = evaluateWinrate(p1, difficultyPolicy(level), rounds, seeds, assistEnabled)
    console.log(
      `p1(kami) vs cpu(${level}): p1=${r.p1Wins} cpu=${r.cpuWins} draw=${r.draws} p1Rate=${r.p1Rate.toFixed(1)}% cpuRate=${r.cpuRate.toFixed(1)}%`,
    )
  }
}

function runYakuDistribution(
  label: string,
  p1Policy: SidePolicy,
  cpuPolicy: SidePolicy,
  rounds: number,
  seeds: number,
  assistEnabled: boolean,
): void {
  const counts = new Map<YakuType, number>()
  let playerRounds = 0
  let roundsWithRare = 0
  let roundsWithMajor = 0
  let roundSamples = 0

  for (let seed = 1; seed <= seeds; seed += 1) {
    const result = runMatch(seed, p1Policy, cpuPolicy, rounds, assistEnabled)
    for (const snapshot of result.rounds) {
      const roundUnion = new Set<YakuType>([...snapshot.p1Yaku, ...snapshot.p2Yaku])
      if (RARE_YAKU.some((y) => roundUnion.has(y))) {
        roundsWithRare += 1
      }
      if (MAJOR_YAKU.some((y) => roundUnion.has(y))) {
        roundsWithMajor += 1
      }
      roundSamples += 1

      for (const y of snapshot.p1Yaku) {
        counts.set(y, (counts.get(y) ?? 0) + 1)
      }
      for (const y of snapshot.p2Yaku) {
        counts.set(y, (counts.get(y) ?? 0) + 1)
      }
      playerRounds += 2
    }
  }

  const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const rareRate = roundSamples === 0 ? 0 : (roundsWithRare / roundSamples) * 100
  const majorRate = roundSamples === 0 ? 0 : (roundsWithMajor / roundSamples) * 100
  console.log(`\\n== ${label} rounds=${rounds} seeds=${seeds} assist=${assistEnabled ? 'on' : 'off'} ==`)
  console.log(`player-round samples=${playerRounds}, round samples=${roundSamples}`)
  console.log(`any rare-yaku in round: ${rareRate.toFixed(2)}%`)
  console.log(`any major-yaku in round: ${majorRate.toFixed(2)}%`)
  for (const [yaku, count] of ordered) {
    const pct = playerRounds === 0 ? 0 : (count / playerRounds) * 100
    const per1000 = playerRounds === 0 ? 0 : (count / playerRounds) * 1000
    console.log(`${yaku}: count=${count} rate=${pct.toFixed(2)}% per1000=${per1000.toFixed(1)}`)
  }
}

function runAblation(rounds: number, seeds: number): void {
  const policies: readonly { name: string; policy: SidePolicy }[] = [
    { name: 'futsuu-all', policy: difficultyPolicy('futsuu') },
    { name: 'futsuu + kami-koi', policy: { hand: 'futsuu', match: 'futsuu', koi: 'kami' } },
    { name: 'kami-hm + futsuu-koi', policy: { hand: 'kami', match: 'kami', koi: 'futsuu' } },
    { name: 'tsuyoi-hm + futsuu-koi', policy: { hand: 'tsuyoi', match: 'tsuyoi', koi: 'futsuu' } },
    { name: 'kami-all', policy: difficultyPolicy('kami') },
  ]

  for (const cpu of ['oni', 'kami'] as const) {
    console.log(`\\n== ablation cpu=${cpu} rounds=${rounds} seeds=${seeds} assist=off ==`)
    for (const p of policies) {
      const r = evaluateWinrate(p.policy, difficultyPolicy(cpu), rounds, seeds, false)
      console.log(`${p.name}: p1=${r.p1Wins} cpu=${r.cpuWins} draw=${r.draws} p1Rate=${r.p1Rate.toFixed(1)}%`)
    }
  }
}

function getIntArg(args: readonly string[], key: string, fallback: number): number {
  const hit = args.find((arg) => arg.startsWith(`--${key}=`))
  if (!hit) {
    return fallback
  }
  const parsed = Number.parseInt(hit.split('=')[1] ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getBoolArg(args: readonly string[], key: string, fallback: boolean): boolean {
  const hit = args.find((arg) => arg.startsWith(`--${key}=`))
  if (!hit) {
    return fallback
  }
  const raw = hit.split('=')[1]
  if (raw === 'true' || raw === '1' || raw === 'on') {
    return true
  }
  if (raw === 'false' || raw === '0' || raw === 'off') {
    return false
  }
  return fallback
}

export function main(argv: readonly string[]): void {
  const [mode = 'ladder', ...args] = argv
  if (mode === 'ladder') {
    const seeds = getIntArg(args, 'seeds', DEFAULTS.ladderSeeds)
    const assist = getBoolArg(args, 'assist', true)
    runLadder(6, seeds, assist)
    runLadder(12, seeds, assist)
    runBestVsLevels(6, seeds, assist)
    runBestVsLevels(12, seeds, assist)
    return
  }
  if (mode === 'yaku') {
    const seeds = getIntArg(args, 'seeds', DEFAULTS.yakuSeeds)
    runYakuDistribution('baseline futsuu vs futsuu', difficultyPolicy('futsuu'), difficultyPolicy('futsuu'), 12, seeds, false)
    runYakuDistribution('current futsuu vs kami', difficultyPolicy('futsuu'), difficultyPolicy('kami'), 12, seeds, true)
    runYakuDistribution('strategy-only futsuu vs kami', difficultyPolicy('futsuu'), difficultyPolicy('kami'), 12, seeds, false)
    return
  }
  if (mode === 'ablation') {
    const seeds = getIntArg(args, 'seeds', DEFAULTS.ablationSeeds)
    runAblation(6, seeds)
    runAblation(12, seeds)
    return
  }

  throw new Error(`Unknown mode: ${mode}. Use ladder|yaku|ablation`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
}

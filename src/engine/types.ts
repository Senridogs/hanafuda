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
  | 'inoshikacho'
  | 'hanami-zake'
  | 'tsukimi-zake'
  | 'akatan'
  | 'aotan'
  | 'tane'
  | 'tanzaku'
  | 'kasu'

export interface TurnAction {
  readonly player: 'player1' | 'player2'
  readonly type: 'playCard' | 'drawCard' | 'capture' | 'addToField' | 'koikoi' | 'stop'
  readonly card?: HanafudaCard
  readonly matchedCard?: HanafudaCard
  readonly capturedCards?: readonly HanafudaCard[]
}

export interface GameConfig {
  readonly targetScore: number
  readonly maxRounds: number
  readonly enableAI: boolean
  readonly aiDifficulty: 'yowai' | 'futsuu' | 'tsuyoi' | 'yabai' | 'oni' | 'kami'
  readonly player1Name: string
  readonly player2Name: string
}

export const DEFAULT_CONFIG: GameConfig = {
  targetScore: 50,
  maxRounds: 3,
  enableAI: true,
  aiDifficulty: 'futsuu',
  player1Name: 'あなた',
  player2Name: 'COM',
}

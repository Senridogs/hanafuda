import {
  createNewGame,
  checkTurn,
  commitDrawToField,
  drawStep,
  playHandCard,
  resolveKoiKoi,
  selectDrawMatch,
  selectHandMatch,
  cancelHandSelection,
  startNextRound,
  type KoiKoiGameState,
} from '../engine/game'
import type {
  ActionMessage,
  ErrorMessage,
  NetErrorCode,
  NetMessage,
  PlayerId,
  StateMessage,
  TurnCommand,
} from './protocol'
import type { PeerTransport } from './transport.peer'

type Unsubscribe = () => void

const COMMAND_PHASE_REQUIREMENTS: Partial<Record<TurnCommand['type'], KoiKoiGameState['phase']>> = {
  playHandCard: 'selectHandCard',
  selectHandMatch: 'selectFieldMatch',
  cancelHandSelection: 'selectFieldMatch',
  drawStep: 'drawingDeck',
  commitDrawToField: 'drawReveal',
  selectDrawMatch: 'selectDrawMatch',
  checkTurn: 'checkYaku',
  resolveKoiKoi: 'koikoiDecision',
  startNextRound: 'roundEnd',
}

function getCurrentPlayerId(state: KoiKoiGameState): PlayerId {
  return state.players[state.currentPlayerIndex].id
}

function createStateMessage(
  roomId: string,
  state: KoiKoiGameState,
  version: number,
  lastActionId?: string,
): StateMessage {
  return {
    type: 'state',
    roomId,
    version,
    state,
    ...(lastActionId ? { lastActionId } : {}),
  }
}

function createErrorMessage(roomId: string, code: NetErrorCode, message: string): ErrorMessage {
  return {
    type: 'error',
    roomId,
    code,
    message,
  }
}

function isAllowedInCurrentPhase(state: KoiKoiGameState, command: TurnCommand): boolean {
  const requiredPhase = COMMAND_PHASE_REQUIREMENTS[command.type]
  return requiredPhase ? requiredPhase === state.phase : true
}

function assertNever(value: never): never {
  throw new Error(`Unhandled turn command: ${JSON.stringify(value)}`)
}

export function applyTurnCommand(state: KoiKoiGameState, command: TurnCommand): KoiKoiGameState {
  switch (command.type) {
    case 'playHandCard':
      return playHandCard(state, command.cardId)
    case 'selectHandMatch':
      return selectHandMatch(state, command.fieldCardId)
    case 'cancelHandSelection':
      return cancelHandSelection(state, command.insertIndex)
    case 'drawStep':
      return drawStep(state)
    case 'commitDrawToField':
      return commitDrawToField(state)
    case 'selectDrawMatch':
      return selectDrawMatch(state, command.fieldCardId)
    case 'checkTurn':
      return checkTurn(state)
    case 'resolveKoiKoi':
      return resolveKoiKoi(state, command.decision)
    case 'startNextRound':
      return startNextRound(state)
    case 'restartGame':
      return createNewGame({
        ...state.config,
        maxRounds: command.maxRounds,
      })
    default:
      return assertNever(command)
  }
}

export interface HostSessionOptions {
  readonly roomId: string
  readonly initialState: KoiKoiGameState
  readonly initialVersion?: number
  readonly transport?: PeerTransport
}

export class HostSession {
  private state: KoiKoiGameState
  private version: number
  private readonly roomId: string
  private readonly transport: PeerTransport | null
  private readonly unsubscribeTransportMessage: Unsubscribe | null

  constructor(options: HostSessionOptions) {
    this.roomId = options.roomId
    this.state = options.initialState
    this.version = options.initialVersion ?? 0
    this.transport = options.transport ?? null

    if (!this.transport) {
      this.unsubscribeTransportMessage = null
      return
    }

    this.unsubscribeTransportMessage = this.transport.onMessage((message) => {
      const response = this.handleMessage(message)
      if (!response) {
        return
      }
      this.transport?.send(response)
    })
  }

  getState(): KoiKoiGameState {
    return this.state
  }

  getVersion(): number {
    return this.version
  }

  getSnapshot(): { readonly state: KoiKoiGameState; readonly version: number } {
    return {
      state: this.state,
      version: this.version,
    }
  }

  handleMessage(message: NetMessage): StateMessage | ErrorMessage | null {
    if (message.type !== 'action') {
      return null
    }
    return this.handleAction(message)
  }

  receiveAction(message: ActionMessage): StateMessage | ErrorMessage {
    return this.handleAction(message)
  }

  handleAction(message: ActionMessage): StateMessage | ErrorMessage {
    if (message.roomId !== this.roomId) {
      return createErrorMessage(this.roomId, 'unknown', 'Room ID mismatch')
    }

    if (message.command.type !== 'restartGame') {
      const currentPlayerId = getCurrentPlayerId(this.state)
      if (message.from !== currentPlayerId) {
        return createErrorMessage(
          this.roomId,
          'out_of_turn',
          `Current player is ${currentPlayerId}, but received action from ${message.from}`,
        )
      }
    }

    if (!isAllowedInCurrentPhase(this.state, message.command)) {
      return createErrorMessage(
        this.roomId,
        'invalid_phase',
        `Cannot execute ${message.command.type} during phase ${this.state.phase}`,
      )
    }

    const nextState = applyTurnCommand(this.state, message.command)
    if (nextState === this.state) {
      return createErrorMessage(
        this.roomId,
        'illegal_action',
        `Action ${message.command.type} was rejected by game rules`,
      )
    }

    this.state = nextState
    this.version += 1
    return createStateMessage(this.roomId, this.state, this.version, message.actionId)
  }

  close(): void {
    this.unsubscribeTransportMessage?.()
  }
}

export interface GuestSessionOptions {
  readonly roomId: string
  readonly playerId: PlayerId
  readonly initialState: KoiKoiGameState
  readonly initialVersion?: number
  readonly transport?: PeerTransport
  readonly actionIdFactory?: () => string
}

export class GuestSession {
  private state: KoiKoiGameState
  private version: number
  private readonly roomId: string
  private readonly playerId: PlayerId
  private readonly transport: PeerTransport | null
  private readonly actionIdFactory: (() => string) | null
  private actionSequence = 0
  private lastError: ErrorMessage | null = null
  private readonly unsubscribeTransportMessage: Unsubscribe | null

  constructor(options: GuestSessionOptions) {
    this.roomId = options.roomId
    this.playerId = options.playerId
    this.state = options.initialState
    this.version = options.initialVersion ?? 0
    this.transport = options.transport ?? null
    this.actionIdFactory = options.actionIdFactory ?? null

    if (!this.transport) {
      this.unsubscribeTransportMessage = null
      return
    }

    this.unsubscribeTransportMessage = this.transport.onMessage((message) => {
      this.handleMessage(message)
    })
  }

  getState(): KoiKoiGameState {
    return this.state
  }

  getVersion(): number {
    return this.version
  }

  getLastError(): ErrorMessage | null {
    return this.lastError
  }

  getSnapshot(): { readonly state: KoiKoiGameState; readonly version: number } {
    return {
      state: this.state,
      version: this.version,
    }
  }

  sendCommand(command: TurnCommand): ActionMessage {
    return this.submit(command)
  }

  submit(command: TurnCommand): ActionMessage {
    const action: ActionMessage = {
      type: 'action',
      roomId: this.roomId,
      actionId: this.createActionId(),
      from: this.playerId,
      command,
    }
    this.transport?.send(action)
    return action
  }

  handleMessage(message: NetMessage): void {
    if (message.type === 'state') {
      if (message.roomId !== this.roomId) {
        return
      }
      if (message.version < this.version) {
        return
      }
      this.state = message.state
      this.version = message.version
      return
    }

    if (message.type === 'error') {
      if (message.roomId !== this.roomId) {
        return
      }
      this.lastError = message
    }
  }

  close(): void {
    this.unsubscribeTransportMessage?.()
  }

  private createActionId(): string {
    if (this.actionIdFactory) {
      return this.actionIdFactory()
    }
    this.actionSequence += 1
    return `${this.playerId}-${this.actionSequence}`
  }
}

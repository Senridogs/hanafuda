import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createNewGame, type KoiKoiGameState } from '../engine/game'
import { calculateYaku } from '../engine/yaku'
import type { Player } from '../engine/types'
import type { ActionMessage, NetMessage, TurnCommand } from '../net/protocol'
import {
  clearCheckpoint,
  loadLastGuestRoomId,
  loadLastHostRoomId,
  loadCheckpoint,
  saveLastGuestRoomId,
  saveCheckpoint,
  saveLastHostRoomId,
  saveSessionMeta,
  clearSessionMeta,
} from '../net/persistence'
import { createGuestTransport, createHostTransport, type PeerTransport } from '../net/transport.peer'

export type MultiplayerMode = 'cpu' | 'p2p-host' | 'p2p-guest'
export type ConnectionStatus = ReturnType<PeerTransport['getStatus']>

interface UseMultiplayerGameOptions {
  readonly game: KoiKoiGameState
  readonly setGame: Dispatch<SetStateAction<KoiKoiGameState>>
  readonly onRemoteCommand?: (command: TurnCommand) => void
}

type Unsubscribe = () => void

interface NetworkSession {
  readonly transport: PeerTransport
  readonly subscriptions: Unsubscribe[]
}

const DEFAULT_CONNECTION_STATUS: ConnectionStatus = 'disconnected'
const MAX_RECENT_ACTION_IDS = 256
const HOST_ERROR_RECOVERY_DELAY_MS = 1500
const HOST_FULL_RECOVERY_DELAY_MS = 30000
const GUEST_AUTO_RECOVERY_DELAY_MS = 1200
const HEARTBEAT_INTERVAL_MS = 2000
const HEARTBEAT_TIMEOUT_MS = 6000

function generateRoomId(): string {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `ROOM-${random}`
}

function getLocalPlayerId(mode: MultiplayerMode): 'player1' | 'player2' | null {
  if (mode === 'p2p-host') {
    return 'player1'
  }
  if (mode === 'p2p-guest') {
    return 'player2'
  }
  return null
}

function isOutOfTurnAllowedCommand(command: TurnCommand): boolean {
  return command.type === 'restartGame' || command.type === 'startNextRound' || command.type === 'readyNextRound'
}

function compactStateForSnapshot(state: KoiKoiGameState): KoiKoiGameState {
  const player1 = state.players[0]
  const player2 = state.players[1]
  const hasHeavyPayload =
    state.turnHistory.length > 0 || state.newYaku.length > 0 || player1.completedYaku.length > 0 || player2.completedYaku.length > 0
  if (!hasHeavyPayload) {
    return state
  }
  const compactPlayers: readonly [Player, Player] = [
    {
      ...player1,
      completedYaku: [],
    },
    {
      ...player2,
      completedYaku: [],
    },
  ]
  return {
    ...state,
    players: compactPlayers,
    newYaku: [],
    turnHistory: [],
  }
}

function hydrateStateSnapshot(state: KoiKoiGameState): KoiKoiGameState {
  const player1 = state.players[0]
  const player2 = state.players[1]
  const hydratedPlayers: readonly [Player, Player] = [
    {
      ...player1,
      completedYaku: calculateYaku(player1.captured),
    },
    {
      ...player2,
      completedYaku: calculateYaku(player2.captured),
    },
  ]
  return {
    ...state,
    players: hydratedPlayers,
  }
}

export function useMultiplayerGame(options: UseMultiplayerGameOptions) {
  const { game, setGame, onRemoteCommand } = options
  const [mode, setMode] = useState<MultiplayerMode>('cpu')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(DEFAULT_CONNECTION_STATUS)
  const [connectionLogs, setConnectionLogs] = useState<string[]>([])
  const [roomId, setRoomId] = useState('')
  const [hostRoomId, setHostRoomId] = useState(() => loadLastHostRoomId())
  const [joinRoomId, setJoinRoomId] = useState(() => loadLastGuestRoomId())

  const networkSessionRef = useRef<NetworkSession | null>(null)
  const hostRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const guestRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastInboundAtRef = useRef(0)
  const actionSequenceRef = useRef(0)
  const versionRef = useRef(0)
  const modeRef = useRef<MultiplayerMode>('cpu')
  const roomIdRef = useRef('')
  const gameRef = useRef(game)
  const onRemoteCommandRef = useRef<((command: TurnCommand) => void) | undefined>(onRemoteCommand)
  const recentActionIdsRef = useRef<string[]>([])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    roomIdRef.current = roomId
  }, [roomId])

  useEffect(() => {
    gameRef.current = game
  }, [game])

  useEffect(() => {
    onRemoteCommandRef.current = onRemoteCommand
  }, [onRemoteCommand])

  const clearHostRecoveryTimer = useCallback(() => {
    if (hostRecoveryTimerRef.current === null) {
      return
    }
    clearTimeout(hostRecoveryTimerRef.current)
    hostRecoveryTimerRef.current = null
  }, [])

  const clearGuestRecoveryTimer = useCallback(() => {
    if (guestRecoveryTimerRef.current === null) {
      return
    }
    clearTimeout(guestRecoveryTimerRef.current)
    guestRecoveryTimerRef.current = null
  }, [])

  const clearHeartbeatTimer = useCallback(() => {
    if (heartbeatTimerRef.current === null) {
      return
    }
    clearInterval(heartbeatTimerRef.current)
    heartbeatTimerRef.current = null
  }, [])

  const markNetworkInbound = useCallback(() => {
    lastInboundAtRef.current = Date.now()
  }, [])

  const shutdownNetwork = useCallback(() => {
    clearHostRecoveryTimer()
    clearGuestRecoveryTimer()
    clearHeartbeatTimer()
    networkSessionRef.current?.subscriptions.forEach((unsubscribe) => unsubscribe())
    networkSessionRef.current?.transport.close()
    networkSessionRef.current = null
    recentActionIdsRef.current = []
  }, [clearGuestRecoveryTimer, clearHeartbeatTimer, clearHostRecoveryTimer])

  const appendConnectionLog = useCallback((message: string): void => {
    const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false })
    setConnectionLogs((current) => {
      const next = [...current, `[${timestamp}] ${message}`]
      if (next.length > 40) {
        return next.slice(next.length - 40)
      }
      return next
    })
  }, [])

  const forceConnectionError = useCallback((reason: string): void => {
    appendConnectionLog(reason)
    shutdownNetwork()
    setConnectionStatus('error')
  }, [appendConnectionLog, shutdownNetwork])

  const softDisconnect = useCallback((reason: string): void => {
    appendConnectionLog(reason)
    clearHeartbeatTimer()
    networkSessionRef.current?.transport.resetConnection()
    setConnectionStatus('disconnected')
  }, [appendConnectionLog, clearHeartbeatTimer])

  const teardownToCpu = useCallback(() => {
    shutdownNetwork()
    setMode('cpu')
    setConnectionStatus(DEFAULT_CONNECTION_STATUS)
    setConnectionLogs([])
    setRoomId('')
  }, [shutdownNetwork])

  useEffect(() => {
    return () => {
      shutdownNetwork()
    }
  }, [shutdownNetwork])

  useEffect(() => {
    if (!roomId || mode === 'cpu') {
      return
    }
    saveCheckpoint(roomId, {
      role: mode === 'p2p-host' ? 'host' : 'guest',
      state: game,
      version: versionRef.current,
      updatedAt: Date.now(),
    })
  }, [game, mode, roomId])

  const sendSnapshot = useCallback((transport: PeerTransport, targetRoomId: string): void => {
    const snapshot = compactStateForSnapshot(gameRef.current)
    transport.send({
      type: 'state',
      roomId: targetRoomId,
      version: versionRef.current,
      state: snapshot,
    })
  }, [])

  useEffect(() => {
    clearHeartbeatTimer()
    if (mode === 'cpu' || connectionStatus !== 'connected') {
      return
    }
    lastInboundAtRef.current = Date.now()
    const currentMode = mode
    heartbeatTimerRef.current = setInterval(() => {
      const network = networkSessionRef.current
      if (!network) {
        return
      }
      const now = Date.now()
      if (now - lastInboundAtRef.current > HEARTBEAT_TIMEOUT_MS) {
        const reason = `接続監視: 応答なし (${Math.round(HEARTBEAT_TIMEOUT_MS / 1000)}秒)`
        if (currentMode === 'p2p-host') {
          softDisconnect(reason)
        } else {
          forceConnectionError(reason)
        }
        return
      }
      const sent = network.transport.send({ type: 'ping', t: now })
      if (!sent) {
        const reason = '接続監視: ping送信失敗'
        if (currentMode === 'p2p-host') {
          softDisconnect(reason)
        } else {
          forceConnectionError(reason)
        }
      }
    }, HEARTBEAT_INTERVAL_MS)

    return clearHeartbeatTimer
  }, [clearHeartbeatTimer, connectionStatus, forceConnectionError, mode, softDisconnect])

  const applyRestartGame = useCallback((maxRounds: 3 | 6 | 12, seed?: number): void => {
    const nextState = createNewGame({
      ...gameRef.current.config,
      maxRounds,
    }, seed)
    gameRef.current = nextState
    setGame(nextState)
  }, [setGame])

  const startHost = useCallback((
    initialState: KoiKoiGameState,
    fixedRoomId?: string,
    restoreFromCheckpoint = true,
  ) => {
    const nextRoomId = fixedRoomId?.trim() || hostRoomId.trim() || generateRoomId()
    const restored = restoreFromCheckpoint ? loadCheckpoint(nextRoomId, 'host') : null
    const restoredState = restored ? restored.state : initialState
    const restoredVersion = restored ? restored.version : 0

    shutdownNetwork()
    gameRef.current = restoredState
    versionRef.current = restoredVersion
    setGame(restoredState)

    const transport = createHostTransport({
      roomId: nextRoomId,
    })
    appendConnectionLog(`ホスト開始: room=${nextRoomId}`)
    setMode('p2p-host')
    setRoomId(nextRoomId)
    setHostRoomId(nextRoomId)
    saveLastHostRoomId(nextRoomId)
    try {
      saveSessionMeta({ mode: 'p2p-host', roomId: nextRoomId, updatedAt: Date.now() })
    } catch {
      // ignore
    }
    setConnectionStatus(transport.getStatus())

    const subscriptions: Unsubscribe[] = []
    subscriptions.push(transport.onStatusChange((status) => {
      setConnectionStatus(status)
      appendConnectionLog(`状態: ${status}`)
      if (status !== 'connected') {
        return
      }
      markNetworkInbound()
      sendSnapshot(transport, nextRoomId)
    }))
    subscriptions.push(transport.onError((message) => {
      appendConnectionLog(message)
    }))
    subscriptions.push(transport.onMessage((message: NetMessage) => {
      if ('roomId' in message && message.roomId !== nextRoomId) {
        return
      }
      markNetworkInbound()

      if (message.type === 'hello') {
        sendSnapshot(transport, nextRoomId)
        return
      }

      if (message.type === 'ping') {
        transport.send({ type: 'pong', t: message.t })
        return
      }
      if (message.type === 'pong') {
        return
      }

      if (message.type === 'action') {
        if (recentActionIdsRef.current.includes(message.actionId)) {
          return
        }
        recentActionIdsRef.current.push(message.actionId)
        if (recentActionIdsRef.current.length > MAX_RECENT_ACTION_IDS) {
          recentActionIdsRef.current.shift()
        }
        appendConnectionLog(`受信: ${message.command.type}`)
        if (message.from === 'player1') {
          return
        }
        versionRef.current += 1
        if (message.command.type === 'restartGame') {
          applyRestartGame(message.command.maxRounds, message.command.seed)
          sendSnapshot(transport, nextRoomId)
          return
        }
        onRemoteCommandRef.current?.(message.command)
        transport.send(message)
        return
      }
    }))

    networkSessionRef.current = {
      transport,
      subscriptions,
    }
  }, [appendConnectionLog, applyRestartGame, hostRoomId, markNetworkInbound, sendSnapshot, setGame, shutdownNetwork])

  const joinAsGuest = useCallback((initialState: KoiKoiGameState) => {
    const targetRoomId = (joinRoomId.trim() || roomIdRef.current).trim()
    if (targetRoomId.length === 0) {
      return false
    }

    const restored = loadCheckpoint(targetRoomId, 'guest')
    const restoredState = restored ? restored.state : initialState
    const restoredVersion = restored ? restored.version : 0

    shutdownNetwork()
    gameRef.current = restoredState
    versionRef.current = restoredVersion
    setGame(restoredState)

    const transport = createGuestTransport({
      roomId: targetRoomId,
    })
    appendConnectionLog(`ゲスト参加開始: room=${targetRoomId}`)

    setMode('p2p-guest')
    setRoomId(targetRoomId)
    setJoinRoomId(targetRoomId)
    saveLastGuestRoomId(targetRoomId)
    try {
      saveSessionMeta({ mode: 'p2p-guest', roomId: targetRoomId, updatedAt: Date.now() })
    } catch {
      // ignore
    }
    setConnectionStatus(transport.getStatus())

    const subscriptions: Unsubscribe[] = []
    subscriptions.push(transport.onStatusChange((status) => {
      setConnectionStatus(status)
      appendConnectionLog(`状態: ${status}`)
      if (status !== 'connected') {
        return
      }
      markNetworkInbound()
      transport.send({
        type: 'hello',
        roomId: targetRoomId,
        peerId: 'guest',
        resumeVersion: versionRef.current,
      })
    }))
    subscriptions.push(transport.onError((message) => {
      appendConnectionLog(message)
    }))
    subscriptions.push(transport.onMessage((message) => {
      if ('roomId' in message && message.roomId !== targetRoomId) {
        return
      }
      markNetworkInbound()

      if (message.type === 'state') {
        versionRef.current = message.version
        const hydrated = hydrateStateSnapshot(message.state)
        gameRef.current = hydrated
        setGame(hydrated)
        return
      }

      if (message.type === 'ping') {
        transport.send({ type: 'pong', t: message.t })
        return
      }
      if (message.type === 'pong') {
        return
      }

      if (message.type === 'action') {
        if (recentActionIdsRef.current.includes(message.actionId)) {
          return
        }
        recentActionIdsRef.current.push(message.actionId)
        if (recentActionIdsRef.current.length > MAX_RECENT_ACTION_IDS) {
          recentActionIdsRef.current.shift()
        }
        appendConnectionLog(`受信: ${message.command.type}`)
        versionRef.current += 1
        if (message.command.type === 'restartGame') {
          applyRestartGame(message.command.maxRounds, message.command.seed)
          return
        }
        onRemoteCommandRef.current?.(message.command)
      }
    }))

    networkSessionRef.current = {
      transport,
      subscriptions,
    }
    return true
  }, [appendConnectionLog, applyRestartGame, joinRoomId, markNetworkInbound, setGame, shutdownNetwork])

  const sendTurnCommand = useCallback((command: TurnCommand): boolean => {
    if (modeRef.current === 'cpu') {
      appendConnectionLog(`送信スキップ(cpu): ${command.type}`)
      return false
    }

    const activeRoomId = roomIdRef.current
    if (activeRoomId.length === 0) {
      appendConnectionLog(`送信失敗: roomIdが空 (${command.type})`)
      return false
    }

    const network = networkSessionRef.current
    if (!network) {
      appendConnectionLog(`送信失敗: ネットワーク未初期化 (${command.type})`)
      return false
    }

    const localPlayerId = getLocalPlayerId(modeRef.current)
    if (!localPlayerId) {
      appendConnectionLog(`送信失敗: ローカルプレイヤー不明 (${command.type})`)
      return false
    }
    const currentState = gameRef.current
    const currentPlayerId = currentState.players[currentState.currentPlayerIndex].id
    if (!isOutOfTurnAllowedCommand(command) && currentPlayerId !== localPlayerId) {
      appendConnectionLog(`送信拒否: 手番外 (${command.type})`)
      return false
    }
    actionSequenceRef.current += 1
    const action: ActionMessage = {
      type: 'action',
      roomId: activeRoomId,
      actionId: `${modeRef.current}-${actionSequenceRef.current}`,
      from: localPlayerId,
      command,
    }
    const sent = network.transport.send(action)
    if (sent) {
      if (modeRef.current === 'p2p-host') {
        versionRef.current += 1
      }
      appendConnectionLog(`送信: ${command.type}`)
    } else {
      appendConnectionLog(`送信失敗: transport未接続 (${command.type})`)
    }
    return sent
  }, [appendConnectionLog])

  const reconnect = useCallback((fallbackState: KoiKoiGameState) => {
    if (modeRef.current === 'p2p-host') {
      startHost(fallbackState, roomIdRef.current)
      return
    }
    if (modeRef.current === 'p2p-guest') {
      joinAsGuest(fallbackState)
    }
  }, [joinAsGuest, startHost])

  const leaveMultiplayer = useCallback(() => {
    const currentRoomId = roomIdRef.current
    const currentRole = modeRef.current === 'p2p-host' ? 'host' : 'guest'
    if (currentRoomId.length > 0) {
      clearCheckpoint(currentRoomId, currentRole as 'host' | 'guest')
    }
    try {
      clearSessionMeta()
    } catch {
      // ignore
    }
    teardownToCpu()
  }, [teardownToCpu])

  useEffect(() => {
    clearHostRecoveryTimer()
    if (mode !== 'p2p-host') {
      return
    }
    if (connectionStatus !== 'disconnected' && connectionStatus !== 'error') {
      return
    }

    const activeRoomId = roomIdRef.current.trim()
    if (activeRoomId.length === 0) {
      return
    }

    if (connectionStatus === 'error') {
      // Peer is destroyed (PeerJS error, reload "ID taken", etc.) — rebuild quickly.
      appendConnectionLog(`ホスト復旧中: room=${activeRoomId}`)
      hostRecoveryTimerRef.current = setTimeout(() => {
        hostRecoveryTimerRef.current = null
        startHost(gameRef.current, activeRoomId, true)
      }, HOST_ERROR_RECOVERY_DELAY_MS)
    } else {
      // softDisconnect keeps the peer alive — guest can reconnect immediately.
      // Full rebuild only as a 30-second fallback if nothing happens.
      appendConnectionLog(`ホスト待機中 (peer維持): room=${activeRoomId}`)
      hostRecoveryTimerRef.current = setTimeout(() => {
        hostRecoveryTimerRef.current = null
        appendConnectionLog(`ホスト完全復旧: room=${activeRoomId}`)
        startHost(gameRef.current, activeRoomId, false)
      }, HOST_FULL_RECOVERY_DELAY_MS)
    }

    return clearHostRecoveryTimer
  }, [appendConnectionLog, clearHostRecoveryTimer, connectionStatus, mode, startHost])

  useEffect(() => {
    clearGuestRecoveryTimer()
    if (mode !== 'p2p-guest') {
      return
    }
    if (connectionStatus !== 'disconnected' && connectionStatus !== 'error') {
      return
    }

    const activeRoomId = roomIdRef.current.trim()
    if (activeRoomId.length === 0) {
      return
    }

    appendConnectionLog(`ゲスト再接続を試行します: room=${activeRoomId}`)
    guestRecoveryTimerRef.current = setTimeout(() => {
      guestRecoveryTimerRef.current = null
      joinAsGuest(gameRef.current)
    }, GUEST_AUTO_RECOVERY_DELAY_MS)

    return clearGuestRecoveryTimer
  }, [appendConnectionLog, clearGuestRecoveryTimer, connectionStatus, joinAsGuest, mode])

  const localPlayerIndex: 0 | 1 = mode === 'p2p-guest' ? 1 : 0
  const canAutoAdvance = mode === 'cpu' || mode === 'p2p-host'
  const isMultiplayer = mode !== 'cpu'

  return {
    mode,
    connectionStatus,
    connectionLogs,
    roomId,
    hostRoomId,
    setHostRoomId,
    joinRoomId,
    setJoinRoomId,
    startHost,
    joinAsGuest,
    leaveMultiplayer,
    teardownToCpu,
    reconnect,
    sendTurnCommand,
    localPlayerIndex,
    canAutoAdvance,
    isMultiplayer,
  }
}

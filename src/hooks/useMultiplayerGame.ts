import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { createNewGame, type KoiKoiGameState } from '../engine/game'
import type { ActionMessage, NetMessage, TurnCommand } from '../net/protocol'
import {
  clearCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
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

export function useMultiplayerGame(options: UseMultiplayerGameOptions) {
  const { game, setGame, onRemoteCommand } = options
  const [mode, setMode] = useState<MultiplayerMode>('cpu')
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(DEFAULT_CONNECTION_STATUS)
  const [connectionLogs, setConnectionLogs] = useState<string[]>([])
  const [roomId, setRoomId] = useState('')
  const [joinRoomId, setJoinRoomId] = useState('')

  const networkSessionRef = useRef<NetworkSession | null>(null)
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

  const shutdownNetwork = useCallback(() => {
    networkSessionRef.current?.subscriptions.forEach((unsubscribe) => unsubscribe())
    networkSessionRef.current?.transport.close()
    networkSessionRef.current = null
    recentActionIdsRef.current = []
  }, [])

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

  const teardownToCpu = useCallback(() => {
    shutdownNetwork()
    setMode('cpu')
    setConnectionStatus(DEFAULT_CONNECTION_STATUS)
    setConnectionLogs([])
    setRoomId('')
    setJoinRoomId('')
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
    transport.send({
      type: 'state',
      roomId: targetRoomId,
      version: versionRef.current,
      state: gameRef.current,
    })
  }, [])

  const applyRestartGame = useCallback((maxRounds: 3 | 6 | 12): void => {
    const nextState = createNewGame({
      ...gameRef.current.config,
      maxRounds,
    })
    gameRef.current = nextState
    setGame(nextState)
  }, [setGame])

  const startHost = useCallback((
    initialState: KoiKoiGameState,
    fixedRoomId?: string,
    restoreFromCheckpoint = true,
  ) => {
    const nextRoomId = fixedRoomId?.trim() || generateRoomId()
    const restored = restoreFromCheckpoint ? loadCheckpoint(nextRoomId) : null
    const restoredState = restored && restored.role === 'host' ? restored.state : initialState
    const restoredVersion = restored && restored.role === 'host' ? restored.version : 0

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
    setJoinRoomId(nextRoomId)
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
      sendSnapshot(transport, nextRoomId)
    }))
    subscriptions.push(transport.onError((message) => {
      appendConnectionLog(message)
    }))
    subscriptions.push(transport.onMessage((message: NetMessage) => {
      if ('roomId' in message && message.roomId !== nextRoomId) {
        return
      }

      if (message.type === 'hello') {
        sendSnapshot(transport, nextRoomId)
        return
      }

      if (message.type === 'ping') {
        transport.send({ type: 'pong', t: message.t })
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
        if (message.from === 'player1') {
          return
        }
        versionRef.current += 1
        if (message.command.type === 'restartGame') {
          applyRestartGame(message.command.maxRounds)
          sendSnapshot(transport, nextRoomId)
          return
        }
        onRemoteCommandRef.current?.(message.command)
        return
      }
    }))

    networkSessionRef.current = {
      transport,
      subscriptions,
    }
  }, [appendConnectionLog, applyRestartGame, sendSnapshot, setGame, shutdownNetwork])

  const joinAsGuest = useCallback((initialState: KoiKoiGameState) => {
    const targetRoomId = (joinRoomId.trim() || roomIdRef.current).trim()
    if (targetRoomId.length === 0) {
      return false
    }

    const restored = loadCheckpoint(targetRoomId)
    const restoredState = restored && restored.role === 'guest' ? restored.state : initialState
    const restoredVersion = restored && restored.role === 'guest' ? restored.version : 0

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

      if (message.type === 'state') {
        versionRef.current = message.version
        gameRef.current = message.state
        setGame(message.state)
        return
      }

      if (message.type === 'ping') {
        transport.send({ type: 'pong', t: message.t })
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
        if (message.from === 'player2') {
          return
        }
        versionRef.current += 1
        if (message.command.type === 'restartGame') {
          applyRestartGame(message.command.maxRounds)
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
  }, [appendConnectionLog, applyRestartGame, joinRoomId, setGame, shutdownNetwork])

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
    if (command.type !== 'restartGame' && currentPlayerId !== localPlayerId) {
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
      versionRef.current += 1
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
    if (currentRoomId.length > 0) {
      clearCheckpoint(currentRoomId)
    }
    try {
      clearSessionMeta()
    } catch {
      // ignore
    }
    teardownToCpu()
  }, [teardownToCpu])

  const localPlayerIndex: 0 | 1 = mode === 'p2p-guest' ? 1 : 0
  const canAutoAdvance = mode === 'cpu' || mode === 'p2p-host'
  const isMultiplayer = mode !== 'cpu'

  return {
    mode,
    connectionStatus,
    connectionLogs,
    roomId,
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

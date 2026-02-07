import { Peer, type DataConnection, type PeerConnectOption, type PeerJSOption } from 'peerjs'
import { parseNetMessage, type NetMessage } from './protocol'

type TransportStatus = 'connecting' | 'connected' | 'disconnected' | 'error'
type MessageHandler = (message: NetMessage) => void
type StatusHandler = (status: TransportStatus) => void
type ErrorHandler = (message: string) => void

type PeerErrorLike = { message: string }

export interface DataConnectionLike {
  readonly open: boolean
  on(event: 'open', handler: () => void): void
  on(event: 'data', handler: (payload: unknown) => void): void
  on(event: 'close', handler: () => void): void
  on(event: 'error', handler: (error: unknown) => void): void
  send(payload: unknown): void
  close(): void
}

export interface PeerLike {
  readonly id: string
  on(event: 'open', handler: (id: string) => void): void
  on(event: 'connection', handler: (connection: DataConnectionLike) => void): void
  on(event: 'close', handler: () => void): void
  on(event: 'disconnected', handler: (currentId: string) => void): void
  on(event: 'error', handler: (error: PeerErrorLike) => void): void
  connect?(peerId: string, options?: PeerConnectOption): DataConnectionLike
  destroy(): void
}

export type PeerFactory = (id: string | undefined, options?: PeerJSOption) => PeerLike

export interface PeerTransport {
  onMessage(handler: MessageHandler): () => void
  onStatusChange(handler: StatusHandler): () => void
  onError(handler: ErrorHandler): () => void
  send(message: NetMessage): boolean
  close(): void
  getStatus(): TransportStatus
}

export interface HostTransportOptions {
  readonly roomId: string
  readonly peerOptions?: PeerJSOption
  readonly peerFactory?: PeerFactory
}

export interface GuestTransportOptions {
  readonly roomId: string
  readonly peerOptions?: PeerJSOption
  readonly connectOptions?: PeerConnectOption
  readonly peerFactory?: PeerFactory
}

const DEFAULT_CONNECT_OPTIONS: PeerConnectOption = {
  reliable: true,
  serialization: 'json',
}

const GUEST_CONNECT_TIMEOUT_MS = 20000

const defaultPeerFactory: PeerFactory = (id, options) => {
  if (id !== undefined) {
    return new Peer(id, options) as unknown as PeerLike
  }
  if (options) {
    return new Peer(options) as unknown as PeerLike
  }
  return new Peer() as unknown as PeerLike
}

export function createHostTransport(options: HostTransportOptions): PeerTransport {
  const peerFactory = options.peerFactory ?? defaultPeerFactory
  const peer = peerFactory(options.roomId, options.peerOptions)
  return createTransportCore(peer, {
    role: 'host',
  })
}

export function createGuestTransport(options: GuestTransportOptions): PeerTransport {
  const peerFactory = options.peerFactory ?? defaultPeerFactory
  const peer = peerFactory(undefined, options.peerOptions)
  return createTransportCore(peer, {
    role: 'guest',
    roomId: options.roomId,
    connectOptions: options.connectOptions ?? DEFAULT_CONNECT_OPTIONS,
  })
}

function createTransportCore(
  peer: PeerLike,
  context:
    | {
      readonly role: 'host'
    }
    | {
      readonly role: 'guest'
      readonly roomId: string
      readonly connectOptions: PeerConnectOption
    },
): PeerTransport {
  const messageHandlers = new Set<MessageHandler>()
  const statusHandlers = new Set<StatusHandler>()
  const errorHandlers = new Set<ErrorHandler>()
  let status: TransportStatus = 'connecting'
  let currentConnection: DataConnectionLike | null = null
  let closed = false
  let guestConnectTimeoutId: ReturnType<typeof setTimeout> | null = null

  const toErrorText = (error: unknown): string => {
    if (error instanceof Error && error.message) {
      return error.message
    }
    if (typeof error === 'string') {
      return error
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      return (error as { message: string }).message
    }
    return 'unknown error'
  }

  const emitError = (message: string): void => {
    for (const handler of errorHandlers) {
      handler(message)
    }
  }

  const clearGuestConnectTimeout = (): void => {
    if (guestConnectTimeoutId === null) {
      return
    }
    clearTimeout(guestConnectTimeoutId)
    guestConnectTimeoutId = null
  }

  const setStatus = (nextStatus: TransportStatus): void => {
    if (closed) {
      return
    }
    if (status === nextStatus) {
      return
    }
    status = nextStatus
    for (const handler of statusHandlers) {
      handler(status)
    }
  }

  const closeConnection = (connection: DataConnectionLike | null): void => {
    if (!connection) {
      return
    }
    try {
      connection.close()
    } catch {
      // Ignore shutdown errors from stale data channels.
    }
  }

  const bindConnection = (connection: DataConnectionLike): void => {
    closeConnection(currentConnection)
    currentConnection = connection

    connection.on('open', () => {
      clearGuestConnectTimeout()
      setStatus('connected')
    })
    connection.on('data', (payload) => {
      const message = parseNetMessage(payload)
      if (!message) {
        return
      }
      for (const handler of messageHandlers) {
        handler(message)
      }
    })
    connection.on('close', () => {
      clearGuestConnectTimeout()
      if (closed) {
        return
      }
      if (currentConnection === connection) {
        currentConnection = null
      }
      setStatus('disconnected')
    })
    connection.on('error', (error) => {
      emitError(`データ接続エラー: ${toErrorText(error)}`)
      clearGuestConnectTimeout()
      setStatus('error')
    })

    if (connection.open) {
      clearGuestConnectTimeout()
      setStatus('connected')
    }
  }

  peer.on('open', () => {
    if (context.role !== 'guest' || closed) {
      return
    }
    if (!peer.connect) {
      setStatus('error')
      return
    }
    const connection = peer.connect(context.roomId, context.connectOptions)
    bindConnection(connection)
    clearGuestConnectTimeout()
    guestConnectTimeoutId = setTimeout(() => {
      if (closed || status === 'connected') {
        return
      }
      emitError(`接続タイムアウト (${Math.round(GUEST_CONNECT_TIMEOUT_MS / 1000)}秒)`)
      setStatus('error')
    }, GUEST_CONNECT_TIMEOUT_MS)
  })

  peer.on('connection', (connection) => {
    if (context.role !== 'host' || closed) {
      return
    }
    if (currentConnection && currentConnection.open) {
      // Keep exactly one active guest by replacing the previous data channel.
      // This makes host-side recovery robust when the previous channel became stale.
      closeConnection(currentConnection)
      currentConnection = null
    }
    bindConnection(connection)
  })

  peer.on('error', (error) => {
    emitError(`Peerエラー: ${toErrorText(error)}`)
    clearGuestConnectTimeout()
    setStatus('error')
  })

  peer.on('disconnected', () => {
    clearGuestConnectTimeout()
    setStatus('disconnected')
  })

  peer.on('close', () => {
    clearGuestConnectTimeout()
    setStatus('disconnected')
  })

  return {
    onMessage(handler) {
      messageHandlers.add(handler)
      return () => {
        messageHandlers.delete(handler)
      }
    },
    onStatusChange(handler) {
      statusHandlers.add(handler)
      return () => {
        statusHandlers.delete(handler)
      }
    },
    onError(handler) {
      errorHandlers.add(handler)
      return () => {
        errorHandlers.delete(handler)
      }
    },
    send(message) {
      if (!currentConnection || !currentConnection.open || closed) {
        return false
      }
      try {
        currentConnection.send(message)
        return true
      } catch {
        setStatus('error')
        return false
      }
    },
    close() {
      if (closed) {
        return
      }
      closed = true
      clearGuestConnectTimeout()
      closeConnection(currentConnection)
      currentConnection = null
      try {
        peer.destroy()
      } catch {
        // Ignore teardown errors.
      }
      status = 'disconnected'
    },
    getStatus() {
      return status
    },
  }
}

// Keep direct PeerJS types reachable from this module for downstream callers.
export type PeerJsDataConnection = DataConnection

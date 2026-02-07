import { afterEach, describe, expect, it } from 'vitest'
import type { NetMessage } from '../../src/net/protocol'
import {
  createGuestTransport,
  createHostTransport,
  type DataConnectionLike,
  type PeerFactory,
  type PeerLike,
} from '../../src/net/transport.peer'

type PeerEvent = 'open' | 'connection' | 'close' | 'disconnected' | 'error'
type ConnectionEvent = 'open' | 'data' | 'close' | 'error'

class FakeDataConnection implements DataConnectionLike {
  open = false
  private remote: FakeDataConnection | null = null
  private readonly handlers: Record<ConnectionEvent, Array<(...args: unknown[]) => void>> = {
    open: [],
    data: [],
    close: [],
    error: [],
  }

  on(event: ConnectionEvent, handler: (...args: unknown[]) => void): void {
    this.handlers[event].push(handler)
  }

  send(payload: unknown): void {
    if (!this.open || !this.remote) {
      return
    }
    queueMicrotask(() => {
      this.remote?.emit('data', payload)
    })
  }

  close(): void {
    if (!this.open) {
      return
    }
    this.open = false
    this.emit('close')
    const remote = this.remote
    this.remote = null
    if (remote && remote.remote === this) {
      remote.remote = null
      if (remote.open) {
        remote.open = false
        remote.emit('close')
      }
    }
  }

  attachRemote(remote: FakeDataConnection): void {
    this.remote = remote
  }

  emit(event: ConnectionEvent, ...args: unknown[]): void {
    for (const handler of this.handlers[event]) {
      handler(...args)
    }
  }
}

class FakePeer implements PeerLike {
  static peers = new Map<string, FakePeer>()
  static sequence = 0

  readonly id: string
  private readonly handlers: Record<PeerEvent, Array<(...args: unknown[]) => void>> = {
    open: [],
    connection: [],
    close: [],
    disconnected: [],
    error: [],
  }

  constructor(id?: string) {
    const resolvedId = id ?? `peer-${FakePeer.sequence + 1}`
    FakePeer.sequence += 1
    this.id = resolvedId
    FakePeer.peers.set(this.id, this)
    queueMicrotask(() => {
      this.emit('open', this.id)
    })
  }

  on(event: PeerEvent, handler: (...args: unknown[]) => void): void {
    this.handlers[event].push(handler)
  }

  connect(peerId: string): DataConnectionLike {
    const target = FakePeer.peers.get(peerId)
    const local = new FakeDataConnection()
    if (!target) {
      queueMicrotask(() => {
        this.emit('error', new Error('peer-not-found'))
      })
      return local
    }
    const remote = new FakeDataConnection()
    local.attachRemote(remote)
    remote.attachRemote(local)
    queueMicrotask(() => {
      local.open = true
      remote.open = true
      local.emit('open')
      remote.emit('open')
      target.emit('connection', remote)
    })
    return local
  }

  destroy(): void {
    FakePeer.peers.delete(this.id)
    this.emit('close')
  }

  private emit(event: PeerEvent, ...args: unknown[]): void {
    for (const handler of this.handlers[event]) {
      handler(...args)
    }
  }
}

const fakePeerFactory: PeerFactory = (id) => new FakePeer(id)

async function flushMicrotasks(cycles = 4): Promise<void> {
  for (let i = 0; i < cycles; i += 1) {
    await Promise.resolve()
  }
}

afterEach(() => {
  FakePeer.peers.clear()
  FakePeer.sequence = 0
})

describe('peer transport', () => {
  it('connects host/guest and delivers valid messages only', async () => {
    const host = createHostTransport({
      roomId: 'room-01',
      peerFactory: fakePeerFactory,
    })
    const guest = createGuestTransport({
      roomId: 'room-01',
      peerFactory: fakePeerFactory,
    })

    const received: NetMessage[] = []
    host.onMessage((message) => {
      received.push(message)
    })

    await flushMicrotasks()
    expect(host.getStatus()).toBe('connected')
    expect(guest.getStatus()).toBe('connected')

    const sentValid = guest.send({
      type: 'ping',
      t: 100,
    })
    expect(sentValid).toBe(true)
    await flushMicrotasks()
    expect(received).toHaveLength(1)
    expect(received[0]?.type).toBe('ping')

    const sentInvalid = guest.send({ type: 'bad-packet' } as unknown as NetMessage)
    expect(sentInvalid).toBe(true)
    await flushMicrotasks()
    expect(received).toHaveLength(1)

    guest.close()
    host.close()
  })

  it('host keeps a single active guest by replacing older connection', async () => {
    const host = createHostTransport({
      roomId: 'room-02',
      peerFactory: fakePeerFactory,
    })
    const guest1 = createGuestTransport({
      roomId: 'room-02',
      peerFactory: fakePeerFactory,
    })

    await flushMicrotasks()
    expect(host.getStatus()).toBe('connected')
    expect(guest1.getStatus()).toBe('connected')

    const received: NetMessage[] = []
    host.onMessage((message) => {
      received.push(message)
    })

    const guest2 = createGuestTransport({
      roomId: 'room-02',
      peerFactory: fakePeerFactory,
    })
    await flushMicrotasks(8)

    expect(host.getStatus()).toBe('connected')
    expect(guest1.getStatus()).toBe('disconnected')
    expect(guest2.getStatus()).toBe('connected')

    const sentFromGuest1 = guest1.send({ type: 'ping', t: 1 })
    const sentFromGuest2 = guest2.send({ type: 'ping', t: 2 })
    expect(sentFromGuest1).toBe(false)
    expect(sentFromGuest2).toBe(true)

    await flushMicrotasks()
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({ type: 'ping', t: 2 })

    guest2.close()
    guest1.close()
    host.close()
  })
})

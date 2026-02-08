import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNewGame } from '../../src/engine/game'

type PeerEvent = 'open' | 'connection' | 'close' | 'disconnected' | 'error'

class MockPeer {
  readonly id: string
  private readonly handlers: Record<PeerEvent, Array<(...args: unknown[]) => void>> = {
    open: [],
    connection: [],
    close: [],
    disconnected: [],
    error: [],
  }

  constructor(id?: string) {
    this.id = id ?? `peer-${Math.random().toString(36).slice(2, 8)}`
    queueMicrotask(() => {
      this.emit('open', this.id)
    })
  }

  on(event: PeerEvent, handler: (...args: unknown[]) => void): void {
    this.handlers[event].push(handler)
  }

  destroy(): void {
    this.emit('close')
  }

  connect() {
    throw new Error('MockPeer.connect is not implemented for this test')
  }

  private emit(event: PeerEvent, ...args: unknown[]): void {
    for (const handler of this.handlers[event]) {
      handler(...args)
    }
  }
}

vi.mock('peerjs', () => ({
  Peer: MockPeer,
}))

import App from '../../src/App'

afterEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
})

describe('App multiplayer host round selection', () => {
  it('keeps month selection enabled when creating a host manually after stale checkpoint remains', async () => {
    const roomId = 'ROOM-RESTORE'
    const staleState = { ...createNewGame(), round: 2 }
    window.localStorage.setItem('hanafuda:p2p:last-host-room-id', roomId)
    window.localStorage.setItem(
      `hanafuda:p2p:checkpoint:host:${roomId}`,
      JSON.stringify({
        role: 'host',
        version: 4,
        updatedAt: Date.now(),
        state: staleState,
      }),
    )

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '6月' }))
    fireEvent.click(screen.getByRole('button', { name: '部屋を作る' }))

    await waitFor(() => {
      expect(screen.getByText('参加待ち: 相手の接続を待っています')).toBeTruthy()
    })

    const month12Button = screen.getByRole('button', { name: '12月' }) as HTMLButtonElement
    expect(month12Button.disabled).toBe(false)
    fireEvent.click(month12Button)

    const selectedState = document.querySelector('.lobby-round-selector-state')
    expect(selectedState?.textContent).toBe('12月')
  })

  it('keeps room inputs when leaving multiplayer', async () => {
    window.localStorage.setItem('hanafuda:p2p:last-host-room-id', 'ROOM-HOST')
    window.localStorage.setItem('hanafuda:p2p:last-guest-room-id', 'ROOM-GUEST')

    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: '6月' }))
    fireEvent.click(screen.getByRole('button', { name: '部屋を作る' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '通信を終了' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: '通信を終了' }))

    await waitFor(() => {
      expect(screen.getByText('月数を選択して対戦を開始')).toBeTruthy()
    })

    const cpuButton = screen.getByRole('button', { name: 'CPU対戦' }) as HTMLButtonElement
    expect(cpuButton.disabled).toBe(true)
    expect(screen.getByText('未選択')).toBeTruthy()

    const hostInput = screen.getByPlaceholderText('作成する部屋ID（空欄で自動生成）') as HTMLInputElement
    const joinInput = screen.getByPlaceholderText('参加する部屋ID') as HTMLInputElement
    expect(hostInput.value).toBe('ROOM-HOST')
    expect(joinInput.value).toBe('ROOM-GUEST')

    expect(window.localStorage.getItem('hanafuda:p2p:last-host-room-id')).toBe('ROOM-HOST')
    expect(window.localStorage.getItem('hanafuda:p2p:last-guest-room-id')).toBe('ROOM-GUEST')
  })
})

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { MultiplayerMode } from '../hooks/useMultiplayerGame'

type RoundCountOption = 3 | 6 | 12

interface MultiplayerLobbyProps {
  readonly mode: MultiplayerMode
  readonly connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error'
  readonly connectionLogs?: readonly string[]
  readonly roomId: string
  readonly hostRoomId: string
  readonly onHostRoomIdChange: (value: string) => void
  readonly joinRoomId: string
  readonly onJoinRoomIdChange: (value: string) => void
  readonly onSwitchToCpu: () => void
  readonly onStartHost: () => void
  readonly onJoinGuest: () => void
  readonly onReconnect: () => void
  readonly onLeave: () => void
  readonly roundCountOptions: readonly RoundCountOption[]
  readonly selectedRoundCount: RoundCountOption | null
  readonly canSelectRoundCount: boolean
  readonly onSelectRoundCount: (value: RoundCountOption) => void
  readonly showCopyButton?: boolean
}

function connectionStatusLabel(status: MultiplayerLobbyProps['connectionStatus']): string {
  switch (status) {
    case 'connecting':
      return '接続中'
    case 'connected':
      return '接続済み'
    case 'disconnected':
      return '未接続'
    case 'error':
      return '接続エラー'
  }
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fallback below.
    }
  }

  if (typeof document === 'undefined') {
    return false
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()

  let copied = false
  try {
    copied = document.execCommand('copy')
  } catch {
    copied = false
  }
  document.body.removeChild(textarea)
  return copied
}

export function MultiplayerLobby(props: MultiplayerLobbyProps) {
  const {
    mode,
    connectionStatus,
    connectionLogs = [],
    roomId,
    hostRoomId,
    onHostRoomIdChange,
    joinRoomId,
    onJoinRoomIdChange,
    onSwitchToCpu,
    onStartHost,
    onJoinGuest,
    onReconnect,
    onLeave,
    roundCountOptions,
    selectedRoundCount,
    canSelectRoundCount,
    onSelectRoundCount,
    showCopyButton = true,
  } = props

  const isMultiplayer = mode !== 'cpu'
  const isCpuMode = mode === 'cpu'
  const isHostMode = mode === 'p2p-host'
  const isConnectedSession = isMultiplayer && connectionStatus === 'connected'
  const isHostWaitingForGuest = isHostMode && connectionStatus !== 'connected'
  const showRoundSelectionWarning = mode === 'cpu' && selectedRoundCount === null
  const disableCpuStartButton = isMultiplayer || selectedRoundCount === null
  const disableHostCreateButton = isMultiplayer || selectedRoundCount === null
  const disableJoinControls = isMultiplayer || isHostMode
  const canCopyRoomId = isHostWaitingForGuest && roomId.length > 0
  const [copiedRoomId, setCopiedRoomId] = useState<string | null>(null)
  const copied = copiedRoomId === roomId
  const copyTimerRef = useRef<number | null>(null)

  const handleCopyRoomId = useCallback(async (): Promise<void> => {
    if (!canCopyRoomId) {
      return
    }
    const success = await copyTextToClipboard(roomId)
    if (!success) {
      return
    }
    setCopiedRoomId(roomId)
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedRoomId(null)
      copyTimerRef.current = null
    }, 1400)
  }, [canCopyRoomId, roomId])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  return (
    <section className="multiplayer-lobby" aria-label="通信対戦">
      <div className="lobby-row">
        <button
          type="button"
          className={mode === 'cpu' ? 'primary' : ''}
          onClick={onSwitchToCpu}
          disabled={disableCpuStartButton}
        >
          CPU対戦
        </button>
      </div>

      <div className={`lobby-round-selector ${showRoundSelectionWarning ? 'required' : ''}`}>
        <div className="lobby-round-selector-head">
          <span>月数</span>
          <span className={`lobby-round-selector-state ${selectedRoundCount === null ? 'unselected' : ''}`}>
            {selectedRoundCount === null ? '未選択' : `${selectedRoundCount}月`}
          </span>
        </div>
        <div className="round-count-selector" aria-label="月数選択" aria-invalid={showRoundSelectionWarning}>
          {roundCountOptions.map((roundCount) => (
            <button
              key={roundCount}
              type="button"
              className={`round-count-button ${selectedRoundCount === roundCount ? 'active' : ''}`}
              onClick={() => onSelectRoundCount(roundCount)}
              disabled={!canSelectRoundCount}
            >
              {roundCount}月
            </button>
          ))}
        </div>
        <p className={`lobby-round-selector-note ${showRoundSelectionWarning ? 'warning' : ''}`}>
          {showRoundSelectionWarning ? '月数を選ぶまで対戦を開始できません。' : '対戦前に月数を選択してください。'}
        </p>
      </div>

      {isCpuMode ? (
        <div className="lobby-section">
          <p className="lobby-section-title">部屋を作成</p>
          <div className="lobby-row">
            <input
              className="lobby-input"
              value={hostRoomId}
              onChange={(event: ChangeEvent<HTMLInputElement>) => onHostRoomIdChange(event.target.value)}
              placeholder="作成する部屋ID（空欄で自動生成）"
              autoComplete="off"
              spellCheck={false}
              disabled={isMultiplayer}
            />
            <button
              type="button"
              className=""
              onClick={onStartHost}
              disabled={disableHostCreateButton}
            >
              部屋を作る
            </button>
          </div>
          <p className="lobby-section-note">IDを空欄のまま作成すると自動で割り当てます。</p>
        </div>
      ) : null}

      {isConnectedSession ? null : isHostMode ? (
        <div className="lobby-row">
          <p className="lobby-waiting">参加待ち: 相手の接続を待っています</p>
        </div>
      ) : (
        <div className="lobby-section">
          <p className="lobby-section-title">部屋に参加</p>
          <div className="lobby-row">
            <input
              className="lobby-input"
              value={joinRoomId}
              onChange={(event: ChangeEvent<HTMLInputElement>) => onJoinRoomIdChange(event.target.value)}
              placeholder="参加する部屋ID"
              autoComplete="off"
              spellCheck={false}
              disabled={disableJoinControls}
            />
            <button
              type="button"
              className={mode === 'p2p-guest' ? 'primary' : ''}
              onClick={onJoinGuest}
              disabled={disableJoinControls}
            >
              参加する
            </button>
          </div>
        </div>
      )}

      <div className="lobby-status">
        <span>状態: {connectionStatusLabel(connectionStatus)}</span>
        {!isConnectedSession && roomId ? <code>部屋: {roomId}</code> : null}
        {canCopyRoomId && showCopyButton ? (
          <button
            type="button"
            className="lobby-copy-button"
            onClick={() => {
              void handleCopyRoomId()
            }}
          >
            {copied ? 'コピー済み' : 'IDをコピー'}
          </button>
        ) : null}
      </div>

      {isMultiplayer ? (
        <div className="lobby-row">
          <button type="button" onClick={onReconnect}>再接続</button>
          <button type="button" onClick={onLeave}>通信を終了</button>
        </div>
      ) : null}

      {connectionLogs.length > 0 ? (
        <details className="lobby-log" open={connectionStatus === 'error'}>
          <summary>接続ログ</summary>
          <ul className="lobby-log-list">
            {[...connectionLogs].reverse().map((line, index) => (
              <li key={`${line}-${index}`} className="lobby-log-item">{line}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}

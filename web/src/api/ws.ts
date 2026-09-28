import { useEffect, useRef } from 'react'
import type { RunStatus, Tick } from './types'

export interface StatusMessage {
  type: 'run.status'
  runId: number
  status: RunStatus
  verdict?: string
  endReason?: string
}

const backoff = [1000, 2000, 5000]

/**
 * Subscribes to one run over /api/v1/ws. Reconnects with 1s, 2s, then 5s delays and
 * calls onReconnect so the page can refetch what it missed.
 */
export function useRunStream(
  runId: number,
  enabled: boolean,
  handlers: { onTick: (t: Tick) => void; onStatus: (s: StatusMessage) => void; onReconnect: () => void },
) {
  const h = useRef(handlers)
  useEffect(() => {
    h.current = handlers
  })

  useEffect(() => {
    if (!enabled) return
    let ws: WebSocket | null = null
    let attempt = 0
    let timer: number | undefined
    let closed = false

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      ws = new WebSocket(`${proto}//${location.host}/api/v1/ws`)
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'subscribe', runId }))
        if (attempt > 0) h.current.onReconnect()
        attempt = 0
      }
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as Tick | StatusMessage
        if (msg.runId !== runId) return
        if (msg.type === 'run.tick') h.current.onTick(msg)
        else if (msg.type === 'run.status') h.current.onStatus(msg)
      }
      ws.onclose = () => {
        if (closed) return
        timer = window.setTimeout(connect, backoff[Math.min(attempt, backoff.length - 1)])
        attempt++
      }
    }
    connect()
    return () => {
      closed = true
      window.clearTimeout(timer)
      ws?.close()
    }
  }, [runId, enabled])
}

import { connection as WebSocketConnection } from 'websocket'
import { CallSession } from '../types'

export interface ServerState {
  activeCalls: Map<string, CallSession>
  activeConnections: Map<string, WebSocketConnection>
}

export interface ServerConfig {
  port: number
  host: string
}

export interface WebSocketHandlers {
  onMessage: (connection: WebSocketConnection, message: any) => Promise<void>
  onClose: (connection: WebSocketConnection, reasonCode: number, description: string) => void
  onError: (connection: WebSocketConnection, error: Error) => void
} 
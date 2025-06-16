import http from 'http'
import logger from '../utils/logger'
import { ServerState } from './types'

export function setupShutdownHandlers(server: http.Server, state: ServerState) {
  const shutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully`)
    
    // Close all WebSocket connections
    for (const [id, connection] of state.activeConnections) {
      logger.info('Closing WebSocket connection', { connectionId: id })
      try {
        connection.close()
      } catch (err) {
        logger.error('Error closing WebSocket connection', { error: err })
      }
    }
    
    server.close((err) => {
      if (err) {
        logger.error('Error during server shutdown', { error: err })
        process.exit(1)
      }
      logger.info('Server closed')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack })
    process.exit(1)
  })
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled rejection', { reason, promise })
    process.exit(1)
  })
} 
import fastify from 'fastify'
import http from 'http'
import config from './config'
import { TwilioService } from './services/twilio'
import { DeepgramService } from './services/deepgram'
import { AIService } from './services/ai'
import { ElevenLabsService } from './services/elevenlabs'
import { ToolService } from './services/tools'
import logger from './utils/logger'
import { registerPlugins } from './server/plugins'
import { setupHttpRoutes } from './server/http'
import { setupWebSocketServer } from './server/websocket'
import { setupShutdownHandlers } from './server/shutdown'
import { ServerState } from './server/types'

// Services
const twilioService = new TwilioService()
const deepgramService = new DeepgramService()
const aiService = new AIService()
const elevenlabsService = new ElevenLabsService()
const toolService = new ToolService(twilioService)

// In-memory storage
const serverState: ServerState = {
  activeCalls: new Map(),
  activeConnections: new Map()
}

// Create Fastify app for HTTP routes
const app = fastify({
  logger: {
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    }
  },
  // Add JSON body parser configuration
  bodyLimit: 30 * 1024 * 1024, // 30MB
  trustProxy: true
})

async function start() {
  try {
    // Register plugins
    await registerPlugins(app)

    // Setup HTTP routes
    setupHttpRoutes(app, twilioService)

    // Build Fastify app
    await app.ready()

    // Create HTTP server
    const server = http.createServer()

    // Handle HTTP requests with Fastify
    server.on('request', (req, res) => {
      app.server.emit('request', req, res)
    })

    // Setup WebSocket server
    setupWebSocketServer(server, serverState, {
      twilio: twilioService,
      deepgram: deepgramService,
      ai: aiService,
      elevenlabs: elevenlabsService,
      tools: toolService
    })

    // Setup shutdown handlers
    setupShutdownHandlers(server, serverState)

    // Start the combined server
    server.listen(config.server.port, '0.0.0.0', () => {
      logger.info(`Server listening at http://0.0.0.0:${config.server.port}`)
      logger.info(`WebSocket server ready for Twilio media streams`)
      logger.info(`🤖 AI Services initialized: Deepgram + OpenAI + ElevenLabs`)
    })

  } catch (error) {
    logger.error('Failed to start server', { error })
    process.exit(1)
  }
}

start()
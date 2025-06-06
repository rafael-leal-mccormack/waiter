import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import { v4 as uuidv4 } from 'uuid'
import config from './config'
import logger from './utils/logger'
import { TwilioService } from './services/twilio'
import { DeepgramService } from './services/deepgram'
import { ElevenLabsService } from './services/elevenlabs'
import { AIService } from './services/ai'
import {
  TwilioMediaMessage,
  TwilioStartMessage,
  TwilioStopMessage,
  WebSocketMessage,
  CallSession,
  CallStatus
} from './types'

// Initialize services
const twilioService = new TwilioService()
const deepgramService = new DeepgramService()
const elevenLabsService = new ElevenLabsService()
const aiService = new AIService()

// Store active call sessions
const activeCalls = new Map<string, CallSession>()

// Create Fastify instance
const fastify = Fastify({
  logger: logger,
  trustProxy: true
})

// Register plugins
async function registerPlugins() {
  await fastify.register(cors, {
    origin: true
  })

  await fastify.register(helmet, {
    contentSecurityPolicy: false
  })

  await fastify.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow
  })

  await fastify.register(websocket)
}

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: config.server.environment
  }
})

// Twilio webhook for incoming calls
fastify.post('/webhook/call', async (request, reply) => {
  try {
    const { CallSid, From, To, CallStatus } = request.body as any

    logger.info('Incoming call webhook', {
      callSid: CallSid,
      from: From,
      to: To,
      status: CallStatus
    })

    // Generate WebSocket URL for media streaming
    const streamUrl = `wss://${request.headers.host}/websocket/media`
    
    // Generate TwiML response
    const twiml = twilioService.generateConnectTwiML(streamUrl)

    reply.type('text/xml')
    return twiml
  } catch (error) {
    logger.error('Error handling call webhook', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    reply.code(500)
    return { error: 'Internal server error' }
  }
})

// Make outbound call endpoint
fastify.post('/api/call', async (request, reply) => {
  try {
    const { phoneNumber } = request.body as { phoneNumber: string }

    if (!phoneNumber) {
      reply.code(400)
      return { error: 'Phone number is required' }
    }

    const webhookUrl = `https://${request.headers.host}/webhook/call`
    const call = await twilioService.makeCall(phoneNumber, webhookUrl)

    return {
      success: true,
      callSid: call.sid,
      status: call.status
    }
  } catch (error) {
    logger.error('Error making outbound call', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    reply.code(500)
    return { error: 'Failed to make call' }
  }
})

// WebSocket handler for media streaming
fastify.register(async function (fastify) {
  fastify.get('/websocket/media', { websocket: true }, (connection, request) => {
    let callSession: CallSession | null = null
    let deepgramConnection: any = null
    let isProcessingAudio = false

    logger.info('WebSocket connection established')

    connection.on('message', async (message: Buffer) => {
      try {
        const data: WebSocketMessage = JSON.parse(message.toString())

        switch (data.event) {
          case 'connected':
            logger.info('WebSocket connected')
            break

          case 'start':
            await handleCallStart(data as TwilioStartMessage)
            break

          case 'media':
            await handleMediaData(data as TwilioMediaMessage)
            break

          case 'stop':
            await handleCallStop(data as TwilioStopMessage)
            break

          default:
            logger.debug('Unknown WebSocket event', { event: data.event })
        }
      } catch (error) {
        logger.error('Error processing WebSocket message', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    })

    connection.on('close', () => {
      logger.info('WebSocket connection closed')
      cleanup()
    })

    connection.on('error', (error: Error) => {
      logger.error('WebSocket error', { error: error.message })
      cleanup()
    })

    async function handleCallStart(data: TwilioStartMessage) {
      const { streamSid, accountSid, callSid } = data.start

      logger.info('Call started', { callSid, streamSid })

      // Create call session
      callSession = {
        callSid,
        phoneNumber: '', // Will be populated from call details
        status: CallStatus.CONNECTED,
        startTime: new Date(),
        transcripts: [],
        aiResponses: []
      }

      activeCalls.set(callSid, callSession)

      // Initialize Deepgram connection
      deepgramConnection = deepgramService.createLiveTranscription()
      
      deepgramService.setupEventHandlers(deepgramConnection, {
        onTranscript: async (result) => {
          if (!callSession || !result.isFinal) return

          logger.info('Received final transcript', {
            callSid,
            transcript: result.text
          })

          // Add transcript to session
          callSession.transcripts.push({
            text: result.text,
            timestamp: new Date(),
            isFinal: result.isFinal,
            confidence: result.confidence,
            speaker: 'user'
          })

          // Process with AI if not currently processing
          if (!isProcessingAudio) {
            await processUserMessage(result.text)
          }
        },
        onError: (error) => {
          logger.error('Deepgram error', { error: error.message, callSid })
        }
      })
    }

    async function handleMediaData(data: TwilioMediaMessage) {
      if (!deepgramConnection || !data.media.payload) return

      try {
        // Decode base64 audio data
        const audioBuffer = Buffer.from(data.media.payload, 'base64')
        
        // Send to Deepgram for transcription
        deepgramService.sendAudio(deepgramConnection, audioBuffer)
      } catch (error) {
        logger.error('Error processing media data', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    async function handleCallStop(data: TwilioStopMessage) {
      const { callSid } = data.stop

      logger.info('Call ended', { callSid })

      if (callSession) {
        callSession.status = CallStatus.ENDED
        callSession.endTime = new Date()
        
        // Generate conversation summary
        try {
          const summary = await aiService.getConversationSummary(callSid)
          logger.info('Call summary generated', { callSid, summary })
        } catch (error) {
          logger.error('Failed to generate call summary', {
            callSid,
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }

      cleanup()
    }

    async function processUserMessage(transcript: string) {
      if (!callSession) return

      isProcessingAudio = true

      try {
        // Generate AI response
        const aiResponse = await aiService.generateResponse(
          transcript,
          callSession.callSid
        )

        logger.info('Generated AI response', {
          callSid: callSession.callSid,
          response: aiResponse
        })

        // Convert to speech
        const audioBuffer = await elevenLabsService.textToSpeech(aiResponse)

        // Add AI response to session
        callSession.aiResponses.push({
          text: aiResponse,
          timestamp: new Date(),
          processingTime: 0 // TODO: Calculate actual processing time
        })

        // Send audio back to caller via WebSocket
        const audioBase64 = audioBuffer.toString('base64')
        const mediaMessage = {
          event: 'media',
          streamSid: callSession.callSid,
          media: {
            payload: audioBase64
          }
        }

        connection.send(JSON.stringify(mediaMessage))

      } catch (error) {
        logger.error('Error processing user message', {
          callSid: callSession.callSid,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      } finally {
        isProcessingAudio = false
      }
    }

    function cleanup() {
      if (deepgramConnection) {
        deepgramService.closeConnection(deepgramConnection)
        deepgramConnection = null
      }

      if (callSession) {
        aiService.clearConversationHistory(callSession.callSid)
        activeCalls.delete(callSession.callSid)
      }
    }
  })
})

// Get active calls
fastify.get('/api/calls', async (request, reply) => {
  const calls = Array.from(activeCalls.values())
  return {
    activeCalls: calls.length,
    calls: calls.map(call => ({
      callSid: call.callSid,
      phoneNumber: call.phoneNumber,
      status: call.status,
      startTime: call.startTime,
      duration: call.endTime
        ? call.endTime.getTime() - call.startTime.getTime()
        : Date.now() - call.startTime.getTime()
    }))
  }
})

// Get call details
fastify.get('/api/calls/:callSid', async (request, reply) => {
  const { callSid } = request.params as { callSid: string }
  const call = activeCalls.get(callSid)

  if (!call) {
    reply.code(404)
    return { error: 'Call not found' }
  }

  return call
})

// Get service statistics
fastify.get('/api/stats', async (request, reply) => {
  const aiStats = aiService.getStats()
  
  return {
    activeCalls: activeCalls.size,
    ai: aiStats,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  }
})

// Start server
async function start() {
  try {
    await registerPlugins()

    const address = await fastify.listen({
      port: config.server.port,
      host: config.server.host
    })

    logger.info(`Server listening on ${address}`)
    
    // Periodic cleanup
    setInterval(() => {
      aiService.cleanupOldConversations(24)
    }, 60 * 60 * 1000) // Every hour

  } catch (error) {
    logger.error('Error starting server', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully')
  await fastify.close()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully')
  await fastify.close()
  process.exit(0)
})

// Start the server
start()
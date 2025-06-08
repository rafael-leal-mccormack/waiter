import fastify from 'fastify'
import formbody from '@fastify/formbody'
import http from 'http'
import { server as WebSocketServer, request as WebSocketRequest, connection as WebSocketConnection } from 'websocket'
import config from './config'
import { TwilioService } from './services/twilio'
import { DeepgramService } from './services/deepgram'
import { AIService } from './services/ai'
import { ElevenLabsService } from './services/elevenlabs'
import logger from './utils/logger'
import {
  CallSession,
  CallStatus,
  TwilioStartMessage,
  TwilioMediaMessage,
  TwilioStopMessage
} from './types'

// Services
const twilioService = new TwilioService()
const deepgramService = new DeepgramService()
const aiService = new AIService()
const elevenlabsService = new ElevenLabsService()

// In-memory storage
const activeCalls = new Map<string, CallSession>()
const activeConnections = new Map<string, WebSocketConnection>()

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
  }
})

async function registerPlugins() {
  try {
    // Register form body parser
    await app.register(formbody)
    
    logger.info('Plugins registered successfully')
  } catch (error) {
    logger.error('Failed to register plugins', { error })
    throw error
  }
}

// Health check endpoint
app.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// Twilio webhook handler
app.post('/webhook/call', async (request, reply) => {
  try {
    logger.info('Twilio webhook received')
    logger.info('Incoming call webhook')

    // Generate WebSocket URL for media streaming
    // Use wss:// for ngrok (HTTPS) or any forwarded HTTPS, ws:// for local development
    const isSecure = request.headers['x-forwarded-proto'] === 'https' || 
                     request.headers.host?.includes('ngrok') ||
                     request.protocol === 'https' ||
                     request.headers.host?.includes('.ngrok-free.app');
    const protocol = isSecure ? 'wss' : 'ws';
    const streamUrl = `${protocol}://${request.headers.host}/websocket/media`;
    
    logger.info('Generated stream URL', { 
      streamUrl, 
      protocol, 
      host: request.headers.host,
      xForwardedProto: request.headers['x-forwarded-proto'],
      requestProtocol: request.protocol 
    });
    
    // Generate TwiML response
    const twiml = twilioService.generateStartTwiML(streamUrl);

    reply.type('text/xml');
    return twiml;
  } catch (error) {
    logger.error('Error handling call webhook', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    reply.code(500);
    return { error: 'Internal server error' };
  }
});

// Make outbound call endpoint
app.post('/api/call', async (request, reply) => {
  try {
    const body = request.body as any;
    const phoneNumber = body?.phoneNumber;

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

async function start() {
  try {
    // Register plugins
    await registerPlugins()

    // Build Fastify app
    await app.ready()

    // Create HTTP server
    const server = http.createServer()

    // Handle HTTP requests with Fastify
    server.on('request', (req, res) => {
      app.server.emit('request', req, res)
    })

    // Create WebSocket server using standard library
    const wsServer = new WebSocketServer({
      httpServer: server,
      autoAcceptConnections: false
    })

    // WebSocket connection handler - using standard library like Twilio samples
    wsServer.on('request', (request: WebSocketRequest) => {
      // Check if this is the media stream path
      if (request.resourceURL.pathname !== '/websocket/media') {
        request.reject(404, 'Not Found')
        return
      }

      logger.info('📨 WEBSOCKET CONNECTION REQUEST!', {
        path: request.resourceURL.pathname,
        origin: request.origin,
        remoteAddress: request.remoteAddress
      })

      // Accept the connection
      const connection = request.accept(null, request.origin)
      const connectionId = Date.now().toString()
      
      logger.info('🔗 WebSocket connection accepted', { connectionId })
      
      // Store connection for cleanup
      activeConnections.set(connectionId, connection)
      
      let callSession: CallSession | null = null
      let streamSid: string | null = null
      let connectionTimeout: NodeJS.Timeout | null = null
      let deepgramConnection: any = null
      let conversationBuffer = ''
      let lastSpeechTime = Date.now()

      // Set a timeout to close stale connections
      connectionTimeout = setTimeout(() => {
        logger.info('WebSocket connection timeout - closing stale connection', { connectionId })
        cleanup()
        try {
          connection.close()
        } catch (err) {
          logger.error('Error closing WebSocket', { error: err })
        }
      }, 2 * 60 * 1000) // 2 minutes

      // Handle incoming messages
      connection.on('message', async (message: any) => {
        if (message.type === 'utf8') {
          const msgStr = message.utf8Data
          // Only log non-media messages to reduce noise
          logger.debug('📨 WEBSOCKET MESSAGE RECEIVED!', { 
            connectionId,
            messageLength: msgStr.length
          })
          
          try {
            const data = JSON.parse(msgStr)
            // Only log important events, not media packets
            if (data.event !== 'media') {
              logger.info('📋 Parsed WebSocket event', { 
                connectionId,
                event: data.event
              })
            }

            switch (data.event) {
              case 'connected':
                logger.info('🔌 Twilio connected to WebSocket', { connectionId })
                break

              case 'start':
                logger.info('🚀 Call stream started', { 
                  connectionId, 
                  callSid: data.start?.callSid,
                  streamSid: data.start?.streamSid 
                })
                await handleCallStart(data as TwilioStartMessage)
                break

              case 'media':
                // Only log media events at debug level to reduce noise
                logger.debug('🎵 Audio media received', { 
                  connectionId,
                  track: data.media?.track,
                  payloadLength: data.media?.payload?.length || 0
                })
                await handleMediaData(data as TwilioMediaMessage)
                break

              case 'stop':
                logger.info('⏹️ Call stream stopped', { connectionId })
                await handleCallStop(data as TwilioStopMessage)
                break
              
              case 'mark':
                console.log('🎯 Mark message received from Twilio:', {
                  markName: data.mark?.name,
                  message: 'Audio playback completed or buffer cleared'
                })
                break

              default:
                logger.info('❓ Unknown event', { connectionId, event: data.event, data })
            }
          } catch (error) {
            logger.error('❌ Error processing WebSocket message', {
              connectionId,
              error: error instanceof Error ? error.message : 'Unknown error',
              rawMessage: msgStr
            })
          }
        } else if (message.type === 'binary') {
          logger.info('Binary message received (not supported)', { connectionId })
        }
      })

      connection.on('close', (reasonCode: number, description: string) => {
        logger.info('🔌 WebSocket connection closed', { 
          connectionId, 
          reasonCode, 
          description 
        })
        cleanup()
      })

      connection.on('error', (error: Error) => {
        logger.error('❌ WebSocket error', { 
          connectionId, 
          error: error.message 
        })
        cleanup()
      })

      async function handleCallStart(data: TwilioStartMessage) {
        const { streamSid: msgStreamSid, callSid } = data.start
        streamSid = msgStreamSid

        logger.info('Call started', { callSid, streamSid })

        // Clear timeout when session starts
        if (connectionTimeout) {
          clearTimeout(connectionTimeout)
          connectionTimeout = null
        }

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
        try {
          deepgramConnection = deepgramService.createLiveTranscription()
          
          deepgramService.setupEventHandlers(deepgramConnection, {
            onOpen: () => {
              logger.info('🎤 Deepgram connection opened', { callSid })
            },
            onTranscript: async (result) => {
              // Only log final transcripts to reduce noise
              if (result.isFinal && result.text.trim()) {
                logger.info('📝 Final transcript received', { 
                  callSid, 
                  text: result.text, 
                  confidence: result.confidence 
                })
                
                // Log the actual transcript text clearly
                logger.info(`🗣️ User said: "${result.text}"`)

                // Store transcript
                if (callSession) {
                  callSession.transcripts.push({
                    text: result.text,
                    timestamp: new Date(),
                    isFinal: result.isFinal,
                    confidence: result.confidence || 0,
                    speaker: 'user'
                  })
                }

                // Buffer conversation to handle multiple quick statements
                conversationBuffer += result.text + ' '
                lastSpeechTime = Date.now()

                // Wait a bit for more speech, then process
                setTimeout(async () => {
                  if (Date.now() - lastSpeechTime >= 1500 && conversationBuffer.trim()) {
                    await processConversation(conversationBuffer.trim())
                    conversationBuffer = ''
                  }
                }, 1500)
              }
            },
            onError: (error) => {
              logger.error('❌ Deepgram error', { callSid, error: error.message })
            },
            onClose: () => {
              logger.info('🎤 Deepgram connection closed', { callSid })
            }
          })

          logger.info('✅ Deepgram connection created', { callSid, streamSid })
        } catch (error) {
          logger.error('❌ Failed to create Deepgram connection', { 
            callSid, 
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }

        // Send initial greeting after a brief delay to ensure connection is stable
        setTimeout(async () => {
          try {
            const greeting = "Hello! Welcome to our automated restaurant booking service. How can I help you today?"
            console.log('📢 Sending initial greeting:', greeting)
            
            const greetingAudio = await elevenlabsService.textToSpeech(greeting)
            await sendAudioToTwilio(greetingAudio)
            
            logger.info('📢 Initial greeting sent', { callSid })
          } catch (error) {
            logger.error('❌ Failed to send initial greeting', {
              callSid,
              error: error instanceof Error ? error.message : 'Unknown error'
            })
          }
        }, 1000) // 1 second delay to ensure WebSocket is ready
      }

      async function handleMediaData(data: TwilioMediaMessage) {
        const { payload, track } = data.media
        
        if (!streamSid || !deepgramConnection) {
          logger.warn('Received media data before stream/Deepgram ready')
          return
        }

        try {
          // Convert base64 to buffer and send to Deepgram
          const audioBuffer = Buffer.from(payload, 'base64')
          deepgramService.sendAudio(deepgramConnection, audioBuffer)
          
          // Removed noisy audio logging - only log errors
        } catch (error) {
          logger.error('❌ Error processing audio data', {
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }

      async function processConversation(userMessage: string) {
        if (!callSession || !streamSid) {
          logger.warn('Cannot process conversation - no active session')
          return
        }

        try {
          logger.info('🤖 Processing conversation', { 
            callSid: callSession.callSid, 
            userMessage: userMessage.substring(0, 100) 
          })

          // Generate AI response
          const aiResponse = await aiService.generateResponse(
            userMessage, 
            callSession.callSid,
            {
              maxTokens: 100, // Keep responses short for phone calls
              temperature: 0.7
            }
          )

          logger.info('🤖 AI response generated', { 
            callSid: callSession.callSid, 
            response: aiResponse.substring(0, 100) 
          })
          
          // Log the full AI response for debugging
          console.log('🤖 FULL AI RESPONSE:', aiResponse)

          // Store AI response
          callSession.aiResponses.push({
            text: aiResponse,
            timestamp: new Date(),
            processingTime: 0 // TODO: Calculate actual processing time
          })

          // Convert to speech
          console.log('📝 Converting to speech:', aiResponse)
          const audioBuffer = await elevenlabsService.textToSpeech(aiResponse)
          
          logger.info('🔊 Audio generated', { 
            callSid: callSession.callSid,
            audioSize: audioBuffer.length 
          })
          
          console.log('🔊 Audio buffer details:', {
            size: audioBuffer.length,
            type: audioBuffer.constructor.name,
            firstBytes: audioBuffer.slice(0, 10).toString('hex'),
            lastBytes: audioBuffer.slice(-10).toString('hex')
          })
          
          // Save audio file for testing (temporary debug)
          const fs = require('fs')
          const testFilePath = `/tmp/test_audio_${Date.now()}.wav`
          fs.writeFileSync(testFilePath, audioBuffer)
          console.log('🎧 Test audio saved to:', testFilePath)

          // Send audio back to Twilio
          await sendAudioToTwilio(audioBuffer)

        } catch (error) {
          logger.error('❌ Error processing conversation', {
            callSid: callSession?.callSid,
            error: error instanceof Error ? error.message : 'Unknown error'
          })

          // Send fallback response
          try {
            const fallbackAudio = await elevenlabsService.textToSpeech("I'm sorry, I didn't catch that. Could you please repeat?")
            await sendAudioToTwilio(fallbackAudio)
          } catch (fallbackError) {
            logger.error('❌ Error sending fallback response', { 
              error: fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
            })
          }
        }
      }

      async function sendAudioToTwilio(audioBuffer: Buffer) {
        if (!connection || !streamSid) {
          logger.warn('Cannot send audio - no connection or streamSid')
          return
        }

        // Check if WebSocket connection is still open
        if (connection.state !== 'open') {
          logger.warn('Cannot send audio - WebSocket connection not open', { 
            state: connection.state 
          })
          return
        }

        try {
          // Send audio in chunks - Twilio may prefer smaller payloads for real-time streaming
          const CHUNK_SIZE = 8000 // 8KB chunks (approximately 1 second of 8kHz μ-law audio)
          let chunkIndex = 0
          
          console.log(`📡 Sending audio in ${Math.ceil(audioBuffer.length / CHUNK_SIZE)} chunks...`)
          
          for (let i = 0; i < audioBuffer.length; i += CHUNK_SIZE) {
            const chunk = audioBuffer.slice(i, i + CHUNK_SIZE)
            const base64Chunk = chunk.toString('base64')
            
            const audioMessage = {
              event: 'media',
              streamSid: streamSid,
              media: {
                payload: base64Chunk
              }
            }

            connection.sendUTF(JSON.stringify(audioMessage))
            console.log(`📡 Chunk ${chunkIndex + 1}: ${chunk.length} bytes → ${base64Chunk.length} base64`)
            chunkIndex++
          }
          
          // Send a mark message to track when audio finishes playing
          const markMessage = {
            event: 'mark',
            streamSid: streamSid,
            mark: {
              name: `audio_${Date.now()}`
            }
          }
          
          connection.sendUTF(JSON.stringify(markMessage))
          
          logger.info('🔊 Audio sent to Twilio', { 
            streamSid,
            audioSize: audioBuffer.length,
            chunks: chunkIndex
          })
          
          console.log('📍 Mark message sent:', markMessage.mark.name)
        } catch (error) {
          logger.error('❌ Error sending audio to Twilio', {
            error: error instanceof Error ? error.message : 'Unknown error'
          })
        }
      }

      async function handleCallStop(data: TwilioStopMessage) {
        const { callSid } = data.stop
        
        logger.info('Call ended', { callSid, streamSid })
        
        if (callSession) {
          callSession.status = CallStatus.ENDED
          callSession.endTime = new Date()

          // Generate conversation summary
          try {
            const summary = await aiService.getConversationSummary(callSid)
            logger.info('📋 Conversation summary', { callSid, summary })
          } catch (error) {
            logger.error('❌ Error generating summary', { 
              callSid,
              error: error instanceof Error ? error.message : 'Unknown error'
            })
          }

          // Clean up AI conversation history
          aiService.clearConversationHistory(callSid)
        }

        cleanup()
      }

      function cleanup() {
        if (connectionTimeout) {
          clearTimeout(connectionTimeout)
          connectionTimeout = null
        }

        if (deepgramConnection) {
          try {
            deepgramService.closeConnection(deepgramConnection)
          } catch (error) {
            logger.error('❌ Error closing Deepgram connection', { error })
          }
          deepgramConnection = null
        }
        
        activeConnections.delete(connectionId)
        
        if (callSession) {
          activeCalls.delete(callSession.callSid)
        }
        
        logger.info('🧹 WebSocket connection cleanup completed', { connectionId })
      }
    })

    // Start the combined server
    server.listen(config.server.port, '0.0.0.0', () => {
      logger.info(`Server listening at http://0.0.0.0:${config.server.port}`)
      logger.info(`WebSocket server ready for Twilio media streams`)
      logger.info(`🤖 AI Services initialized: Deepgram + OpenAI + ElevenLabs`)
    })

    // Graceful shutdown
    const shutdown = (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`)
      
      // Close all WebSocket connections
      for (const [id, connection] of activeConnections) {
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

  } catch (error) {
    logger.error('Failed to start server', { error })
    process.exit(1)
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack })
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise })
  process.exit(1)
})

start()
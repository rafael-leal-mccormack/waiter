import fastify from 'fastify'
import formbody from '@fastify/formbody'
import cors from '@fastify/cors'
import http from 'http'
import { server as WebSocketServer, request as WebSocketRequest, connection as WebSocketConnection } from 'websocket'
import config from './config'
import { TwilioService } from './services/twilio'
import { DeepgramService } from './services/deepgram'
import { AIService } from './services/ai'
import { ElevenLabsService } from './services/elevenlabs'
import { ToolService } from './services/tools'
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
const toolService = new ToolService(twilioService)

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
  },
  // Add JSON body parser configuration
  bodyLimit: 30 * 1024 * 1024, // 30MB
  trustProxy: true
})

// Register CORS with proper configuration
app.register(cors, {
  // put your options here
  origin: true,
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
})

async function registerPlugins() {
  try {
    // Register form body parser
    await app.register(formbody)
    
    // Register JSON parser explicitly
    app.addContentTypeParser('application/json', { parseAs: 'string' }, function (req, body, done) {
      try {
        const json = JSON.parse(body as string)
        done(null, json)
      } catch (err) {
        done(err as Error, undefined)
      }
    })
    
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
    logger.info('Received call request', {
      body: request.body,
      headers: request.headers,
      contentType: request.headers['content-type'],
      method: request.method,
      url: request.url,
      bodyType: typeof request.body,
      bodyKeys: request.body ? Object.keys(request.body) : []
    });

    const body = request.body as any;
    // Accept both phone_number and phoneNumber
    const phoneNumber = body?.phoneNumber || body?.phone_number;

    logger.info('Parsed phone number', { 
      phoneNumber,
      bodyKeys: Object.keys(body || {}),
      rawBody: JSON.stringify(body)
    });

    if (!phoneNumber) {
      logger.warn('Phone number missing from request', { 
        body,
        contentType: request.headers['content-type'],
        bodyType: typeof request.body
      });
      reply.code(400)
      return { error: 'Phone number is required' }
    }

    const webhookUrl = `https://${request.headers.host}/webhook/call`
    const call = await twilioService.makeCall(phoneNumber, webhookUrl)

    // Get detailed call status
    const callDetails = await twilioService.getCall(call.sid)
    logger.info('Call details after initiation', {
      callSid: call.sid,
      status: call.status,
      direction: callDetails.direction,
      answeredBy: callDetails.answeredBy,
      duration: callDetails.duration,
      errorCode: callDetails.errorCode,
      errorMessage: callDetails.errorMessage,
      from: callDetails.from,
      to: callDetails.to,
      parentCallSid: callDetails.parentCallSid,
      queueTime: callDetails.queueTime,
      startTime: callDetails.startTime,
      endTime: callDetails.endTime
    })

    return {
      callSid: call.sid,
      status: call.status,
      details: {
        direction: callDetails.direction,
        answeredBy: callDetails.answeredBy,
        errorCode: callDetails.errorCode,
        errorMessage: callDetails.errorMessage
      }
    }
  } catch (error) {
    logger.error('Error making outbound call', {
      error: error instanceof Error ? error.message : 'Unknown error',
      body: request.body
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
                logger.info('🎯 Mark message received from Twilio:', {
                  markName: data.mark?.name,
                  message: data.mark?.message
                })
                break

              default:
                logger.info('❓ Unknown event', { 
                  connectionId, 
                  event: data.event, 
                  data: JSON.stringify(data) 
                })
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
                  if (Date.now() - lastSpeechTime >= 1000 && conversationBuffer.trim()) {
                    await processConversation(conversationBuffer.trim())
                    conversationBuffer = ''
                  }
                }, 1000)
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

          // Get available tools
          const availableTools = toolService.getAvailableTools()

          // Generate initial AI response with tools
          const aiResponse = await aiService.generateResponseWithTools(
            userMessage, 
            callSession.callSid,
            {
              maxTokens: 100,
              temperature: 0.7,
              tools: availableTools
            }
          )

          logger.info('🤖 AI response generated', { 
            callSid: callSession.callSid, 
            response: aiResponse.text.substring(0, 100),
            hasToolCalls: !!aiResponse.toolCalls,
            toolCount: aiResponse.toolCalls?.length || 0
          })
          
          // Log the full AI response for debugging
          console.log('🤖 FULL AI RESPONSE:', aiResponse)

          // Store AI response
          callSession.aiResponses.push({
            text: aiResponse.text,
            timestamp: new Date(),
            processingTime: 0
          })

          // Convert to speech and send initial response
          console.log('📝 Converting to speech:', aiResponse.text)
          const initialAudioBuffer = await elevenlabsService.textToSpeech(aiResponse.text)
          
          logger.info('🔊 Audio generated', { 
            callSid: callSession.callSid,
            audioSize: initialAudioBuffer.length 
          })

          // If we have tool calls, we need to wait for the audio to finish playing
          if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
            // Create a promise that resolves when the audio finishes playing
            const audioPlaybackComplete = new Promise<void>((resolve) => {
              const markName = `audio_${Date.now()}`
              let markHandler: ((data: any) => void) | null = null
              
              // Set up mark message handler
              markHandler = (data: any) => {
                try {
                  const message = JSON.parse(data.utf8Data)
                  if (message.event === 'mark' && message.mark?.name === markName) {
                    logger.info('🎯 Audio playback completed, proceeding with tool calls', { 
                      markName,
                      message: message.mark.message 
                    })
                    if (markHandler) {
                      connection.removeListener('message', markHandler)
                    }
                    resolve()
                  }
                } catch (error) {
                  logger.error('Error processing mark message', { error })
                }
              }
              
              // Listen for mark message
              connection.on('message', markHandler)
              
              // Set a timeout in case we never get the mark message
              const timeout = setTimeout(() => {
                logger.warn('Timeout waiting for audio playback completion', { markName })
                if (markHandler) {
                  connection.removeListener('message', markHandler)
                }
                resolve() // Resolve anyway to prevent hanging
              }, 10000) // 10 second timeout
              
              // Send audio with mark
              sendAudioToTwilio(initialAudioBuffer, markName).catch(error => {
                logger.error('Failed to send audio', { error })
                clearTimeout(timeout)
                if (markHandler) {
                  connection.removeListener('message', markHandler)
                }
                resolve() // Resolve anyway to prevent hanging
              })
            })

            // Wait for audio to finish playing
            await audioPlaybackComplete
            logger.info('Proceeding with tool calls after audio playback')

            // Now execute tool calls and collect results
            let toolResults: { tool: string; success: boolean; message: string; data?: any }[] = []
            
            for (const toolCall of aiResponse.toolCalls) {
              logger.info('Executing tool call', { 
                tool: toolCall.name,
                args: toolCall.args
              })
              
              const result = await toolService.executeToolCall(callSession.callSid, toolCall)
              toolResults.push({ tool: toolCall.name, ...result })
              
              logger.info('Tool execution result', { 
                callSid: callSession.callSid,
                tool: toolCall.name,
                success: result.success,
                message: result.message
              })
              
              // If the tool was a hang_up_call and it succeeded, we can stop processing
              if (toolCall.name === 'hang_up_call' && result.success) {
                logger.info('Call ended successfully via tool call', { callSid: callSession.callSid })
                return
              }
            }

            // Generate follow-up response using tool results
            if (toolResults.length > 0) {
              const followUpPrompt = `You are a helpful restaurant assistant. The user asked: "${userMessage}"

Here is our restaurant's menu information:

${toolResults.map(r => {
  if (r.tool === 'search_restaurant' && r.success && r.data) {
    // Split the menu into sections based on the "--" separator
    const menuSections: string[] = r.data.split('--').map((section: string) => section.trim())
    
    return `Menu Information:
${menuSections.map((section: string) => {
  // Get the first line as the section title
  const lines: string[] = section.split('\n')
  const title: string = lines[0]?.trim() || 'Other Items'  // Fallback if first line is undefined
  const items: string[] = lines.slice(1)
    .filter((line: string) => line.trim())
    .map((line: string) => line.trim())
  
  return `${title}:
${items.map((item: string) => `- ${item}`).join('\n')}`
}).join('\n\n')}

IMPORTANT DIETARY GUIDELINES:
1. A dish is NOT vegetarian just because it contains vegetables
2. A dish is vegetarian ONLY if it contains NO meat, poultry, or seafood
3. If a dish contains any of these ingredients, it is NOT vegetarian:
   - Chicken (including "chicken breast", "chicken pieces", etc.)
   - Beef (including "steak", "ribs", etc.)
   - Pork (including "pork chops", "ham", etc.)
   - Seafood (including "shrimp", "salmon", "fish", etc.)
   - Any other meat products

Please analyze the user's question and provide a helpful response using this menu information. Follow these guidelines:

1. For dietary preference questions (vegetarian, vegan, etc.):
   - ONLY suggest dishes that are TRULY suitable for that diet
   - If you're unsure about a dish's ingredients, DO NOT suggest it
   - If there are no suitable options, clearly state that
   - NEVER assume a dish is vegetarian just because it has vegetables
   - If asked about vegetarian options and none are available, say: "I apologize, but I don't see any vegetarian options on our current menu. Would you like me to help you find dishes that could be modified to be vegetarian, or would you prefer to speak with our staff about special dietary requirements?"

2. For specific dish or category questions:
   - Look for relevant items in the menu
   - Provide details about the dishes, including ingredients and sides
   - If multiple items match, list a few options
   - Be specific about what comes with each dish

3. If the user's question isn't directly answered by the menu:
   - Acknowledge that
   - Suggest some popular or notable dishes
   - Offer to help them find something specific
   - If it's a dietary question with no suitable options, be honest about it

4. Keep your response:
   - Natural and conversational
   - Focused on the most relevant information
   - Concise but informative
   - Helpful in guiding their decision
   - Honest about limitations or lack of options`
  } else {
    return `Tool: ${r.tool}
Status: ${r.success ? 'Success' : 'Failed'}
Message: ${r.message}
${r.data ? `Data: ${r.data}` : ''}`
  }
}).join('\n\n')}`

              const followUpResponse = await aiService.generateResponse(
                followUpPrompt,
                callSession.callSid,
                {
                  maxTokens: 250,  // Increased to allow for more detailed menu responses
                  temperature: 0.7
                }
              )

              logger.info('🤖 Follow-up response generated', {
                callSid: callSession.callSid,
                response: followUpResponse.substring(0, 100)
              })

              // Convert follow-up response to speech
              console.log('📝 Converting follow-up to speech:', followUpResponse)
              const followUpAudio = await elevenlabsService.textToSpeech(followUpResponse)
              await sendAudioToTwilio(followUpAudio)
            }
          } else {
            // If no tool calls, just send the initial audio
            await sendAudioToTwilio(initialAudioBuffer)
          }

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

      async function sendAudioToTwilio(audioBuffer: Buffer, markName?: string) {
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
          // Send audio in smaller chunks for faster streaming
          const CHUNK_SIZE = 4000 // Reduced from 8000 to 4000 bytes (approximately 0.5 seconds of 8kHz μ-law audio)
          let chunkIndex = 0
          
          console.log(`📡 Sending audio in ${Math.ceil(audioBuffer.length / CHUNK_SIZE)} chunks...`)
          
          // Send chunks with minimal delay between them
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

            // Send chunk immediately without artificial delays
            connection.sendUTF(JSON.stringify(audioMessage))
            chunkIndex++
          }

          // Send mark message immediately after last chunk
          const markMessage = {
              event: 'mark',
            streamSid: streamSid,
              mark: {
              name: markName || `audio_${Date.now()}`
              }
          }

          connection.sendUTF(JSON.stringify(markMessage))
          
          logger.info('🔊 Audio sent to Twilio', { 
            streamSid,
            audioSize: audioBuffer.length,
            chunks: chunkIndex,
            markName: markMessage.mark.name,
            chunkSize: CHUNK_SIZE
          })
        } catch (error) {
          logger.error('❌ Error sending audio to Twilio', {
            error: error instanceof Error ? error.message : 'Unknown error'
          })
          throw error
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
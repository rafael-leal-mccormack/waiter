import { server as WebSocketServer, request as WebSocketRequest, connection as WebSocketConnection } from 'websocket'
import http from 'http'
import logger from '../utils/logger'
import { ServerState } from './types'
import { TwilioService } from '../services/twilio'
import { DeepgramService } from '../services/deepgram'
import { AIService } from '../services/ai'
import { ElevenLabsService } from '../services/elevenlabs'
import { ToolService } from '../services/tools'
import { CallSession, CallStatus, TwilioStartMessage, TwilioMediaMessage, TwilioStopMessage } from '../types'

export function setupWebSocketServer(
  server: http.Server,
  state: ServerState,
  services: {
    twilio: TwilioService
    deepgram: DeepgramService
    ai: AIService
    elevenlabs: ElevenLabsService
    tools: ToolService
  }
) {
  const wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
  })

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
    state.activeConnections.set(connectionId, connection)
    
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

      state.activeCalls.set(callSid, callSession)

      // Initialize Deepgram connection
      try {
        deepgramConnection = services.deepgram.createLiveTranscription()

        services.deepgram.setupEventHandlers(deepgramConnection, {
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
        
          const greetingAudio = await services.elevenlabs.textToSpeech(greeting)
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
        services.deepgram.sendAudio(deepgramConnection, audioBuffer)
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
        const availableTools = services.tools.getAvailableTools()

        // Generate initial AI response with tools
        const aiResponse = await services.ai.generateResponseWithTools(
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
        const initialAudioBuffer = await services.elevenlabs.textToSpeech(aiResponse.text)
        
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
            
            const result = await services.tools.executeToolCall(callSession.callSid, toolCall)
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

            const followUpResponse = await services.ai.generateResponse(
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
            const followUpAudio = await services.elevenlabs.textToSpeech(followUpResponse)
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
          const fallbackAudio = await services.elevenlabs.textToSpeech("I'm sorry, I didn't catch that. Could you please repeat?")
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

        // // Generate conversation summary
        // try {
        //   const summary = await services.ai.getConversationSummary(callSid)
        //   logger.info('📋 Conversation summary', { callSid, summary })
        // } catch (error) {
        //   logger.error('❌ Error generating summary', { 
        //     callSid,
        //     error: error instanceof Error ? error.message : 'Unknown error'
        //   })
        // }

        // Clean up AI conversation history
        services.ai.clearConversationHistory(callSid)
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
          services.deepgram.closeConnection(deepgramConnection)
        } catch (error) {
          logger.error('❌ Error closing Deepgram connection', { error })
        }
        deepgramConnection = null
      }
      
      state.activeConnections.delete(connectionId)
      
      if (callSession) {
        state.activeCalls.delete(callSession.callSid)
      }
      
      logger.info('🧹 WebSocket connection cleanup completed', { connectionId })
    }
  })
} 
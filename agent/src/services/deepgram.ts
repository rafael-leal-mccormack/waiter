import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk'
import config from '../config'
import logger from '../utils/logger'
import { DeepgramEventHandlers, DeepgramTranscriptResult } from '../types'

export class DeepgramService {
  private client: ReturnType<typeof createClient>
  private logger: typeof logger

  constructor() {
    this.client = createClient(config.deepgram.apiKey)
    this.logger = logger.child({ service: 'deepgram' })
  }

  /**
   * Create a real-time transcription connection
   */
  createLiveTranscription(options: Record<string, any> = {}) {
    const connectionOptions = {
      ...config.deepgram.config,
      ...options
    }

    try {
      const connection = this.client.listen.live(connectionOptions)
      
      this.logger.info('Created Deepgram live transcription connection', {
        options: connectionOptions
      })
      
      return connection
    } catch (error) {
      this.logger.error('Failed to create Deepgram connection', {
        error: error instanceof Error ? error.message : 'Unknown error',
        options: connectionOptions
      })
      throw error
    }
  }

  /**
   * Setup event handlers for live transcription
   */
  setupEventHandlers(
    connection: ReturnType<typeof this.createLiveTranscription>, 
    handlers: DeepgramEventHandlers = {}
  ): void {
    const {
      onTranscript = () => {},
      onError = () => {},
      onClose = () => {},
      onOpen = () => {},
      onMetadata = () => {}
    } = handlers

    connection.on(LiveTranscriptionEvents.Open, () => {
      this.logger.info('Deepgram connection opened')
      onOpen()
    })

    connection.on(LiveTranscriptionEvents.Close, () => {
      this.logger.info('Deepgram connection closed')
      onClose()
    })

    connection.on(LiveTranscriptionEvents.Error, (error: Error) => {
      this.logger.error('Deepgram connection error', { error: error.message })
      onError(error)
    })

    connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      try {
        const transcript = data.channel?.alternatives?.[0]?.transcript
        const isFinal = data.is_final
        const confidence = data.channel?.alternatives?.[0]?.confidence

        if (transcript && transcript.trim()) {
          this.logger.debug('Received transcript', {
            transcript,
            isFinal,
            confidence
          })
          
          const result: DeepgramTranscriptResult = {
            text: transcript,
            isFinal,
            confidence,
            rawData: data
          }
          
          onTranscript(result)
        }
      } catch (error) {
        this.logger.error('Error processing transcript', { 
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        onError(error instanceof Error ? error : new Error('Unknown transcript processing error'))
      }
    })

    connection.on(LiveTranscriptionEvents.Metadata, (data: any) => {
      this.logger.debug('Received metadata', { metadata: data })
      onMetadata(data)
    })
  }

  /**
   * Send audio data to Deepgram for transcription
   */
  sendAudio(connection: ReturnType<typeof this.createLiveTranscription>, audioData: Buffer): void {
    try {
      if (connection.getReadyState() === 1) { // WebSocket.OPEN
        connection.send(audioData)
      } else {
        this.logger.warn('Attempted to send audio to closed Deepgram connection')
      }
    } catch (error) {
      this.logger.error('Failed to send audio to Deepgram', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  /**
   * Close Deepgram connection
   */
  closeConnection(connection: ReturnType<typeof this.createLiveTranscription>): void {
    try {
      if (connection && connection.getReadyState() !== 3) { // Not CLOSED
        connection.finish()
        this.logger.info('Deepgram connection close requested')
      }
    } catch (error) {
      this.logger.error('Error closing Deepgram connection', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  /**
   * Transcribe pre-recorded audio file
   */
  async transcribeFile(audio: Buffer | string, options: Record<string, any> = {}): Promise<any> {
    try {
      const response = await this.client.listen.prerecorded.transcribeFile(
        audio,
        {
          ...config.deepgram.config,
          ...options
        }
      )

      this.logger.info('File transcription completed', {
        duration: response.result?.metadata?.duration
      })

      return response.result
    } catch (error) {
      this.logger.error('File transcription failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  /**
   * Get connection status
   */
  getConnectionStatus(connection: ReturnType<typeof this.createLiveTranscription>): number {
    return connection.getReadyState()
  }
}
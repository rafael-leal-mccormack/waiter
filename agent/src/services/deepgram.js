const { createClient } = require('@deepgram/sdk')
const config = require('../config')
const logger = require('../utils/logger')

class DeepgramService {
  constructor() {
    this.client = createClient(config.deepgram.apiKey)
    this.logger = logger.child({ service: 'deepgram' })
  }

  /**
   * Create a real-time transcription connection
   * @param {Object} options - Additional configuration options
   * @returns {Object} Deepgram live connection
   */
  createLiveTranscription(options = {}) {
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
        error: error.message,
        options: connectionOptions
      })
      throw error
    }
  }

  /**
   * Setup event handlers for live transcription
   * @param {Object} connection - Deepgram connection
   * @param {Object} handlers - Event handler functions
   */
  setupEventHandlers(connection, handlers = {}) {
    const {
      onTranscript = () => {},
      onError = () => {},
      onClose = () => {},
      onOpen = () => {},
      onMetadata = () => {}
    } = handlers

    connection.on('open', () => {
      this.logger.info('Deepgram connection opened')
      onOpen()
    })

    connection.on('close', () => {
      this.logger.info('Deepgram connection closed')
      onClose()
    })

    connection.on('error', (error) => {
      this.logger.error('Deepgram connection error', { error: error.message })
      onError(error)
    })

    connection.on('Results', (data) => {
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
          
          onTranscript({
            text: transcript,
            isFinal,
            confidence,
            rawData: data
          })
        }
      } catch (error) {
        this.logger.error('Error processing transcript', { error: error.message })
        onError(error)
      }
    })

    connection.on('Metadata', (data) => {
      this.logger.debug('Received metadata', { metadata: data })
      onMetadata(data)
    })
  }

  /**
   * Send audio data to Deepgram for transcription
   * @param {Object} connection - Deepgram connection
   * @param {Buffer} audioData - Audio data buffer
   */
  sendAudio(connection, audioData) {
    try {
      if (connection.getReadyState() === 1) { // WebSocket.OPEN
        connection.send(audioData)
      } else {
        this.logger.warn('Attempted to send audio to closed Deepgram connection')
      }
    } catch (error) {
      this.logger.error('Failed to send audio to Deepgram', {
        error: error.message
      })
    }
  }

  /**
   * Close Deepgram connection
   * @param {Object} connection - Deepgram connection to close
   */
  closeConnection(connection) {
    try {
      if (connection && connection.getReadyState() !== 3) { // Not CLOSED
        connection.requestClose()
        this.logger.info('Deepgram connection close requested')
      }
    } catch (error) {
      this.logger.error('Error closing Deepgram connection', {
        error: error.message
      })
    }
  }

  /**
   * Transcribe pre-recorded audio file
   * @param {Buffer|string} audio - Audio data or file path
   * @param {Object} options - Transcription options
   * @returns {Promise<Object>} Transcription result
   */
  async transcribeFile(audio, options = {}) {
    try {
      const response = await this.client.listen.prerecorded.transcribeFile(
        audio,
        {
          ...config.deepgram.config,
          ...options
        }
      )

      this.logger.info('File transcription completed', {
        duration: response.results?.metadata?.duration
      })

      return response.results
    } catch (error) {
      this.logger.error('File transcription failed', {
        error: error.message
      })
      throw error
    }
  }
}

module.exports = DeepgramService
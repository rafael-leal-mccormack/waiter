const { ElevenLabsApi, ElevenLabsApiResponseError } = require('elevenlabs')
const config = require('../config')
const logger = require('../utils/logger')

class ElevenLabsService {
  constructor() {
    this.client = new ElevenLabsApi({
      apiKey: config.elevenlabs.apiKey
    })
    this.logger = logger.child({ service: 'elevenlabs' })
  }

  /**
   * Convert text to speech
   * @param {string} text - Text to convert to speech
   * @param {Object} options - Additional options for TTS
   * @returns {Promise<Buffer>} Audio buffer
   */
  async textToSpeech(text, options = {}) {
    try {
      const voiceId = options.voiceId || config.elevenlabs.voiceId
      const modelId = options.modelId || config.elevenlabs.config.model_id
      const voiceSettings = {
        ...config.elevenlabs.config.voice_settings,
        ...options.voiceSettings
      }

      this.logger.info('Converting text to speech', {
        textLength: text.length,
        voiceId,
        modelId
      })

      const audioStream = await this.client.textToSpeech.convert(voiceId, {
        model_id: modelId,
        text,
        voice_settings: voiceSettings
      })

      // Convert stream to buffer
      const chunks = []
      for await (const chunk of audioStream) {
        chunks.push(chunk)
      }
      
      const audioBuffer = Buffer.concat(chunks)
      
      this.logger.info('Text to speech conversion completed', {
        audioSize: audioBuffer.length,
        textLength: text.length
      })

      return audioBuffer
    } catch (error) {
      this.logger.error('Text to speech conversion failed', {
        text: text.substring(0, 100),
        error: error.message
      })
      
      if (error instanceof ElevenLabsApiResponseError) {
        this.logger.error('ElevenLabs API error details', {
          status: error.status,
          body: error.body
        })
      }
      
      throw error
    }
  }

  /**
   * Stream text to speech (for real-time applications)
   * @param {string} text - Text to convert
   * @param {Object} options - TTS options
   * @returns {Promise<ReadableStream>} Audio stream
   */
  async streamTextToSpeech(text, options = {}) {
    try {
      const voiceId = options.voiceId || config.elevenlabs.voiceId
      const modelId = options.modelId || config.elevenlabs.config.model_id
      const voiceSettings = {
        ...config.elevenlabs.config.voice_settings,
        ...options.voiceSettings
      }

      this.logger.info('Starting text to speech stream', {
        textLength: text.length,
        voiceId,
        modelId
      })

      const audioStream = await this.client.textToSpeech.convertAsStream(voiceId, {
        model_id: modelId,
        text,
        voice_settings: voiceSettings
      })

      return audioStream
    } catch (error) {
      this.logger.error('Text to speech streaming failed', {
        text: text.substring(0, 100),
        error: error.message
      })
      throw error
    }
  }

  /**
   * Get available voices
   * @returns {Promise<Array>} List of available voices
   */
  async getVoices() {
    try {
      const response = await this.client.voices.getAll()
      this.logger.info('Retrieved available voices', {
        count: response.voices?.length || 0
      })
      return response.voices || []
    } catch (error) {
      this.logger.error('Failed to get voices', { error: error.message })
      throw error
    }
  }

  /**
   * Get voice details
   * @param {string} voiceId - Voice ID to get details for
   * @returns {Promise<Object>} Voice details
   */
  async getVoice(voiceId) {
    try {
      const voice = await this.client.voices.get(voiceId)
      this.logger.info('Retrieved voice details', { voiceId })
      return voice
    } catch (error) {
      this.logger.error('Failed to get voice details', {
        voiceId,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Get user info (for quota and usage tracking)
   * @returns {Promise<Object>} User information
   */
  async getUserInfo() {
    try {
      const userInfo = await this.client.user.get()
      this.logger.info('Retrieved user info')
      return userInfo
    } catch (error) {
      this.logger.error('Failed to get user info', { error: error.message })
      throw error
    }
  }

  /**
   * Validate text for TTS (check length, content, etc.)
   * @param {string} text - Text to validate
   * @returns {Object} Validation result
   */
  validateText(text) {
    const maxLength = 5000 // ElevenLabs typical limit
    const result = {
      isValid: true,
      errors: []
    }

    if (!text || typeof text !== 'string') {
      result.isValid = false
      result.errors.push('Text must be a non-empty string')
    }

    if (text.length > maxLength) {
      result.isValid = false
      result.errors.push(`Text length (${text.length}) exceeds maximum (${maxLength})`)
    }

    if (text.trim().length === 0) {
      result.isValid = false
      result.errors.push('Text cannot be empty or only whitespace')
    }

    return result
  }
}

module.exports = ElevenLabsService
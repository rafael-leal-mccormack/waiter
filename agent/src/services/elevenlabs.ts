import { ElevenLabsApi } from 'elevenlabs'
import config from '../config'
import logger from '../utils/logger'
import { ElevenLabsTTSOptions, TextValidationResult, Voice } from '../types'

export class ElevenLabsService {
  private client: ElevenLabsApi
  private logger: typeof logger

  constructor() {
    this.client = new ElevenLabsApi({
      apiKey: config.elevenlabs.apiKey
    })
    this.logger = logger.child({ service: 'elevenlabs' })
  }

  /**
   * Convert text to speech
   */
  async textToSpeech(text: string, options: ElevenLabsTTSOptions = {}): Promise<Buffer> {
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
      const chunks: Buffer[] = []
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
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      throw error
    }
  }

  /**
   * Stream text to speech (for real-time applications)
   */
  async streamTextToSpeech(text: string, options: ElevenLabsTTSOptions = {}): Promise<ReadableStream> {
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
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  /**
   * Get available voices
   */
  async getVoices(): Promise<Voice[]> {
    try {
      const response = await this.client.voices.getAll()
      this.logger.info('Retrieved available voices', {
        count: response.voices?.length || 0
      })
      return response.voices || []
    } catch (error) {
      this.logger.error('Failed to get voices', { 
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  /**
   * Get voice details
   */
  async getVoice(voiceId: string): Promise<Voice> {
    try {
      const voice = await this.client.voices.get(voiceId)
      this.logger.info('Retrieved voice details', { voiceId })
      return voice
    } catch (error) {
      this.logger.error('Failed to get voice details', {
        voiceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  /**
   * Get user info (for quota and usage tracking)
   */
  async getUserInfo(): Promise<any> {
    try {
      const userInfo = await this.client.user.get()
      this.logger.info('Retrieved user info')
      return userInfo
    } catch (error) {
      this.logger.error('Failed to get user info', { 
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  /**
   * Validate text for TTS (check length, content, etc.)
   */
  validateText(text: string): TextValidationResult {
    const maxLength = 5000 // ElevenLabs typical limit
    const result: TextValidationResult = {
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

  /**
   * Check if voice ID is valid
   */
  async isValidVoice(voiceId: string): Promise<boolean> {
    try {
      await this.getVoice(voiceId)
      return true
    } catch (error) {
      return false
    }
  }

  /**
   * Get random voice from available voices
   */
  async getRandomVoice(): Promise<Voice | null> {
    try {
      const voices = await this.getVoices()
      if (voices.length === 0) return null
      
      const randomIndex = Math.floor(Math.random() * voices.length)
      return voices[randomIndex] || null
    } catch (error) {
      this.logger.error('Failed to get random voice', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return null
    }
  }
}
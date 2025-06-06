const twilio = require('twilio')
const config = require('../config')
const logger = require('../utils/logger')

class TwilioService {
  constructor() {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken)
    this.logger = logger.child({ service: 'twilio' })
  }

  /**
   * Generate TwiML for incoming calls
   * @param {string} streamUrl - WebSocket URL for media streaming
   * @returns {string} TwiML response
   */
  generateConnectTwiML(streamUrl) {
    const response = new twilio.twiml.VoiceResponse()
    
    // Add a brief greeting
    response.say({
      voice: 'alice',
      language: 'en-US'
    }, 'Hello! Please wait while I connect you to our AI assistant.')

    // Start media stream
    const start = response.start()
    start.stream({
      name: 'ai-call-stream',
      url: streamUrl,
      track: 'both_tracks'
    })

    // Pause to keep the call active
    response.pause({ length: 60 })

    this.logger.info('Generated TwiML for media streaming', { streamUrl })
    return response.toString()
  }

  /**
   * Generate TwiML to play audio response
   * @param {string} audioUrl - URL to the audio file
   * @returns {string} TwiML response
   */
  generatePlayAudioTwiML(audioUrl) {
    const response = new twilio.twiml.VoiceResponse()
    response.play(audioUrl)
    response.pause({ length: 1 })
    
    this.logger.info('Generated TwiML for audio playback', { audioUrl })
    return response.toString()
  }

  /**
   * Make an outbound call
   * @param {string} to - Phone number to call
   * @param {string} webhookUrl - URL for call handling
   * @returns {Promise<Object>} Call object
   */
  async makeCall(to, webhookUrl) {
    try {
      const call = await this.client.calls.create({
        to,
        from: config.twilio.phoneNumber,
        url: webhookUrl,
        method: 'POST'
      })

      this.logger.info('Outbound call initiated', { 
        to, 
        callSid: call.sid,
        webhookUrl 
      })
      
      return call
    } catch (error) {
      this.logger.error('Failed to make outbound call', { 
        to, 
        webhookUrl, 
        error: error.message 
      })
      throw error
    }
  }

  /**
   * Validate Twilio webhook signature
   * @param {string} signature - X-Twilio-Signature header
   * @param {string} url - Full URL of the webhook
   * @param {Object} params - POST parameters
   * @returns {boolean} Is signature valid
   */
  validateSignature(signature, url, params) {
    try {
      return twilio.validateRequest(
        config.twilio.authToken,
        signature,
        url,
        params
      )
    } catch (error) {
      this.logger.error('Signature validation failed', { error: error.message })
      return false
    }
  }

  /**
   * End a call
   * @param {string} callSid - Call SID to end
   * @returns {Promise<Object>} Updated call object
   */
  async endCall(callSid) {
    try {
      const call = await this.client.calls(callSid).update({
        status: 'completed'
      })

      this.logger.info('Call ended', { callSid })
      return call
    } catch (error) {
      this.logger.error('Failed to end call', { 
        callSid, 
        error: error.message 
      })
      throw error
    }
  }
}

module.exports = TwilioService
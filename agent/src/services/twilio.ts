import twilio from 'twilio'
import config from '../config'
import logger from '../utils/logger'
import { TwilioWebhookParams } from '../types'

export class TwilioService {
  private client: twilio.Twilio
  private logger: typeof logger

  constructor() {
    this.client = twilio(config.twilio.accountSid, config.twilio.authToken)
    this.logger = logger.child({ service: 'twilio' })
  }

  /**
   * Generate TwiML for incoming calls with bidirectional media streaming
   */
  generateStartTwiML(streamUrl: string): string {
    const response = new twilio.twiml.VoiceResponse()

    // Use <Connect> and <Stream> for bidirectional media streaming
    // This allows both receiving AND sending audio through WebSocket
    const connect = response.connect()
    connect.stream({
      url: streamUrl
      // No track parameter needed for bidirectional - defaults to inbound
    })

    const twimlString = response.toString()
    this.logger.info('Generated TwiML for bidirectional media streaming', {
      streamUrl,
      twiml: twimlString,
    })
    return twimlString
  }

  /**
   * Generate TwiML to play audio response
   */
  generatePlayAudioTwiML(audioUrl: string): string {
    const response = new twilio.twiml.VoiceResponse()
    response.play(audioUrl)
    response.pause({ length: 1 })
    
    this.logger.info('Generated TwiML for audio playback', { audioUrl })
    return response.toString()
  }

  /**
   * Make an outbound call
   */
  async makeCall(to: string, webhookUrl: string): Promise<any> {
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
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  /**
   * Validate Twilio webhook signature
   */
  validateSignature(signature: string, url: string, params: TwilioWebhookParams): boolean {
    try {
      return twilio.validateRequest(
        config.twilio.authToken,
        signature,
        url,
        params
      )
    } catch (error) {
      this.logger.error('Signature validation failed', { 
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return false
    }
  }

  /**
   * End a call
   */
  async endCall(callSid: string): Promise<any> {
    try {
      const call = await this.client.calls(callSid).update({
        status: 'completed'
      })

      this.logger.info('Call ended', { callSid })
      return call
    } catch (error) {
      this.logger.error('Failed to end call', { 
        callSid, 
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  /**
   * Get call details
   */
  async getCall(callSid: string): Promise<any> {
    try {
      const call = await this.client.calls(callSid).fetch()
      
      this.logger.info('Retrieved call details', { callSid })
      return call
    } catch (error) {
      this.logger.error('Failed to get call details', { 
        callSid, 
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }
}
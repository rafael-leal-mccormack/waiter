import fastify, { FastifyRequest, FastifyReply } from 'fastify'
import logger from '../utils/logger'
import { TwilioService } from '../services/twilio'

export function setupHttpRoutes(app: ReturnType<typeof fastify>, twilioService: TwilioService) {
  // Health check endpoint
  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() }
  })

  // Twilio webhook handler
  app.post('/webhook/call', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('Twilio webhook received')
      logger.info('Incoming call webhook')

      // Generate WebSocket URL for media streaming
      const isSecure = request.headers['x-forwarded-proto'] === 'https' || 
                      request.headers.host?.includes('ngrok') ||
                      request.protocol === 'https' ||
                      request.headers.host?.includes('.ngrok-free.app')
      const protocol = isSecure ? 'wss' : 'ws'
      const streamUrl = `${protocol}://${request.headers.host}/websocket/media`
      
      logger.info('Generated stream URL', { 
        streamUrl, 
        protocol, 
        host: request.headers.host,
        xForwardedProto: request.headers['x-forwarded-proto'],
        requestProtocol: request.protocol 
      })
      
      // Generate TwiML response
      const twiml = twilioService.generateStartTwiML(streamUrl)

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
  app.post('/api/call', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      logger.info('Received call request', {
        body: request.body,
        headers: request.headers,
        contentType: request.headers['content-type'],
        method: request.method,
        url: request.url,
        bodyType: typeof request.body,
        bodyKeys: request.body ? Object.keys(request.body) : []
      })

      const body = request.body as any
      // Accept both phone_number and phoneNumber
      const phoneNumber = body?.phoneNumber || body?.phone_number

      logger.info('Parsed phone number', { 
        phoneNumber,
        bodyKeys: Object.keys(body || {}),
        rawBody: JSON.stringify(body)
      })

      if (!phoneNumber) {
        logger.warn('Phone number missing from request', { 
          body,
          contentType: request.headers['content-type'],
          bodyType: typeof request.body
        })
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
} 
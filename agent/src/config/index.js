require('dotenv').config()

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || '0.0.0.0',
    environment: process.env.NODE_ENV || 'development'
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    prettyPrint: process.env.NODE_ENV === 'development'
  },
  
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER,
    webhookUrl: process.env.TWILIO_WEBHOOK_URL
  },
  
  deepgram: {
    apiKey: process.env.DEEPGRAM_API_KEY,
    config: {
      model: 'nova-2',
      language: 'en-US',
      smart_format: true,
      interim_results: true,
      endpointing: 300,
      vad_events: true
    }
  },
  
  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY,
    voiceId: process.env.ELEVENLABS_VOICE_ID,
    config: {
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8
      }
    }
  },
  
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    maxTokens: 150,
    temperature: 0.7
  },
  
  security: {
    jwtSecret: process.env.JWT_SECRET || 'default-secret-change-in-production'
  },
  
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 60000
  }
}

// Validate required environment variables
const requiredEnvVars = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'DEEPGRAM_API_KEY',
  'ELEVENLABS_API_KEY',
  'OPENAI_API_KEY'
]

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar])

if (missingEnvVars.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
}

module.exports = config
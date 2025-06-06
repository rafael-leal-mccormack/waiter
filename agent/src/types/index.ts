export interface AppConfig {
  server: ServerConfig
  logging: LoggingConfig
  twilio: TwilioConfig
  deepgram: DeepgramConfig
  elevenlabs: ElevenLabsConfig
  openai: OpenAIConfig
  security: SecurityConfig
  rateLimit: RateLimitConfig
}

export interface ServerConfig {
  port: number
  host: string
  environment: string
}

export interface LoggingConfig {
  level: string
  prettyPrint: boolean
}

export interface TwilioConfig {
  accountSid: string
  authToken: string
  phoneNumber: string
  webhookUrl: string
}

export interface DeepgramConfig {
  apiKey: string
  config: {
    model: string
    language: string
    smart_format: boolean
    interim_results: boolean
    endpointing: number
    vad_events: boolean
  }
}

export interface ElevenLabsConfig {
  apiKey: string
  voiceId: string
  config: {
    model_id: string
    voice_settings: {
      stability: number
      similarity_boost: number
    }
  }
}

export interface OpenAIConfig {
  apiKey: string
  model: string
  maxTokens: number
  temperature: number
}

export interface SecurityConfig {
  jwtSecret: string
}

export interface RateLimitConfig {
  max: number
  timeWindow: number
}

// Call related types
export interface CallSession {
  callSid: string
  phoneNumber: string
  status: CallStatus
  startTime: Date
  endTime?: Date
  transcripts: TranscriptEntry[]
  aiResponses: AIResponse[]
}

export enum CallStatus {
  INITIATED = 'initiated',
  CONNECTED = 'connected',
  IN_PROGRESS = 'in_progress',
  ENDED = 'ended',
  FAILED = 'failed'
}

export interface TranscriptEntry {
  text: string
  timestamp: Date
  isFinal: boolean
  confidence: number
  speaker?: 'user' | 'ai'
}

export interface AIResponse {
  text: string
  timestamp: Date
  tokensUsed?: number
  processingTime: number
}

// WebSocket message types
export interface WebSocketMessage {
  event: string
  streamSid: string
  data?: any
}

export interface TwilioMediaMessage extends WebSocketMessage {
  event: 'media'
  media: {
    track: string
    chunk: string
    timestamp: string
    payload: string
  }
}

export interface TwilioStartMessage extends WebSocketMessage {
  event: 'start'
  start: {
    streamSid: string
    accountSid: string
    callSid: string
  }
}

export interface TwilioStopMessage extends WebSocketMessage {
  event: 'stop'
  stop: {
    accountSid: string
    callSid: string
  }
}

// AI Service types
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: Date
}

export interface IntentAnalysis {
  intent: string
  sentiment: 'positive' | 'negative' | 'neutral'
  urgency: 'low' | 'medium' | 'high'
  topics: string[]
  confidence: number
}

export interface AIGenerationOptions {
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
}

// Deepgram types
export interface DeepgramTranscriptResult {
  text: string
  isFinal: boolean
  confidence: number
  rawData: any
}

export interface DeepgramEventHandlers {
  onTranscript?: (result: DeepgramTranscriptResult) => void
  onError?: (error: Error) => void
  onClose?: () => void
  onOpen?: () => void
  onMetadata?: (metadata: any) => void
}

// ElevenLabs types
export interface ElevenLabsTTSOptions {
  voiceId?: string
  modelId?: string
  voiceSettings?: {
    stability?: number
    similarity_boost?: number
  }
}

export interface TextValidationResult {
  isValid: boolean
  errors: string[]
}

export interface Voice {
  voice_id: string
  name: string
  samples?: any[]
  category?: string
  fine_tuning?: any
  labels?: Record<string, string>
  description?: string
  preview_url?: string
  available_for_tiers?: string[]
  settings?: any
}

// Error types
export interface ServiceError extends Error {
  service: string
  operation: string
  originalError?: Error
}

// Statistics types
export interface ServiceStats {
  activeConnections: number
  totalRequests: number
  errorCount: number
  uptime: number
}

export interface AIStats {
  activeConversations: number
  totalMessages: number
}

// Webhook types
export interface TwilioWebhookParams {
  CallSid: string
  From: string
  To: string
  CallStatus: string
  Direction: string
  [key: string]: string
}
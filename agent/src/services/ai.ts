import OpenAI from 'openai'
import config from '../config'
import logger from '../utils/logger'
import { ConversationMessage, IntentAnalysis, AIGenerationOptions, AIStats } from '../types'

export class AIService {
  private client: OpenAI
  private logger: typeof logger
  private conversationHistory: Map<string, ConversationMessage[]>

  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey
    })
    this.logger = logger.child({ service: 'ai' })
    this.conversationHistory = new Map()
  }

  /**
   * Generate AI response for conversation
   */
  async generateResponse(
    userMessage: string, 
    callId: string, 
    options: AIGenerationOptions = {}
  ): Promise<string> {
    try {
      const systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt()
      const maxTokens = options.maxTokens || config.openai.maxTokens
      const temperature = options.temperature || config.openai.temperature

      // Get or initialize conversation history
      let history = this.conversationHistory.get(callId) || []
      
      // Add user message to history
      history.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date()
      })

      // Prepare messages for OpenAI
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        }))
      ]

      this.logger.info('Generating AI response', {
        callId,
        userMessage: userMessage.substring(0, 100),
        historyLength: history.length
      })

      const completion = await this.client.chat.completions.create({
        model: config.openai.model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: false
      })

      const aiResponse = completion.choices[0]?.message?.content

      if (!aiResponse) {
        throw new Error('No response generated from AI')
      }

      // Add AI response to history
      history.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date()
      })

      // Update conversation history (keep last 20 messages to manage token usage)
      this.conversationHistory.set(callId, history.slice(-20))

      this.logger.info('AI response generated', {
        callId,
        responseLength: aiResponse.length,
        tokensUsed: completion.usage?.total_tokens
      })

      return aiResponse.trim()
    } catch (error) {
      // Log detailed error information
      console.error('🚨 DETAILED OPENAI ERROR:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        type: error?.constructor?.name,
        stack: error instanceof Error ? error.stack?.substring(0, 500) : 'No stack',
        openaiDetails: (error as any)?.error || (error as any)?.response?.data || 'No OpenAI details'
      })
      
      this.logger.error('Failed to generate AI response', {
        callId,
        userMessage: userMessage.substring(0, 100),
        error: error instanceof Error ? error.message : 'Unknown error',
        errorType: error?.constructor?.name,
        errorStack: error instanceof Error ? error.stack : 'No stack trace',
        // Log OpenAI specific error details if available
        openaiError: (error as any)?.error || (error as any)?.response?.data || null
      })
      throw error
    }
  }

  /**
   * Generate streaming AI response
   */
  async generateStreamingResponse(
    userMessage: string, 
    callId: string, 
    onChunk: (chunk: string) => void, 
    options: AIGenerationOptions = {}
  ): Promise<string> {
    try {
      const systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt()
      const maxTokens = options.maxTokens || config.openai.maxTokens
      const temperature = options.temperature || config.openai.temperature

      let history = this.conversationHistory.get(callId) || []
      history.push({ 
        role: 'user', 
        content: userMessage, 
        timestamp: new Date() 
      })

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history.map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content
        }))
      ]

      this.logger.info('Generating streaming AI response', {
        callId,
        userMessage: userMessage.substring(0, 100)
      })

      const stream = await this.client.chat.completions.create({
        model: config.openai.model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: true
      })

      let fullResponse = ''

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || ''
        if (content) {
          fullResponse += content
          onChunk(content)
        }
      }

      // Add complete response to history
      history.push({ 
        role: 'assistant', 
        content: fullResponse, 
        timestamp: new Date() 
      })
      this.conversationHistory.set(callId, history.slice(-20))

      this.logger.info('Streaming AI response completed', {
        callId,
        responseLength: fullResponse.length
      })

      return fullResponse.trim()
    } catch (error) {
      this.logger.error('Failed to generate streaming AI response', {
        callId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  /**
   * Analyze user intent from transcript
   */
  async analyzeIntent(transcript: string, callId: string): Promise<IntentAnalysis> {
    try {
      const prompt = `
        Analyze the following user message and extract:
        1. Primary intent (greeting, question, request, complaint, etc.)
        2. Sentiment (positive, negative, neutral)
        3. Urgency level (low, medium, high)
        4. Key topics mentioned
        
        User message: "${transcript}"
        
        Respond in JSON format:
        {
          "intent": "primary_intent",
          "sentiment": "sentiment_value",
          "urgency": "urgency_level",
          "topics": ["topic1", "topic2"],
          "confidence": 0.95
        }
      `

      const completion = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3
      })

      const response = completion.choices[0]?.message?.content
      if (!response) {
        throw new Error('No analysis response from AI')
      }

      const analysis: IntentAnalysis = JSON.parse(response)

      this.logger.info('Intent analysis completed', {
        callId,
        intent: analysis.intent,
        sentiment: analysis.sentiment
      })

      return analysis
    } catch (error) {
      this.logger.error('Intent analysis failed', {
        callId,
        transcript: transcript.substring(0, 100),
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      
      // Return default analysis on error
      return {
        intent: 'unknown',
        sentiment: 'neutral',
        urgency: 'low',
        topics: [],
        confidence: 0.1
      }
    }
  }

  /**
   * Clear conversation history for a call
   */
  clearConversationHistory(callId: string): void {
    this.conversationHistory.delete(callId)
    this.logger.info('Cleared conversation history', { callId })
  }

  /**
   * Get conversation history for a call
   */
  getConversationHistory(callId: string): ConversationMessage[] {
    return this.conversationHistory.get(callId) || []
  }

  /**
   * Get conversation summary
   */
  async getConversationSummary(callId: string): Promise<string> {
    try {
      const history = this.getConversationHistory(callId)
      if (history.length === 0) {
        return 'No conversation to summarize'
      }

      const conversation = history
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n')

      const prompt = `Summarize this conversation in 2-3 sentences:

${conversation}

Summary:`

      const completion = await this.client.chat.completions.create({
        model: config.openai.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.5
      })

      const summary = completion.choices[0]?.message?.content || 'Unable to generate summary'
      
      this.logger.info('Generated conversation summary', { callId })
      return summary.trim()
    } catch (error) {
      this.logger.error('Failed to generate conversation summary', {
        callId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return 'Error generating summary'
    }
  }

  /**
   * Get default system prompt for AI assistant
   */
  getDefaultSystemPrompt(): string {
    return `You are a helpful AI assistant handling phone calls. Your responses should be:
    - Natural and conversational
    - Concise (1-2 sentences max)
    - Appropriate for voice conversation
    - Professional but friendly
    - Clear and easy to understand when spoken aloud
    
    Guidelines:
    - Don't use complex punctuation or special characters
    - Avoid long pauses or filler words
    - If you don't understand something, ask for clarification politely
    - Keep responses under 50 words when possible
    - Use natural speech patterns
    
    Remember: This is a voice conversation, so optimize for spoken delivery.`
  }

  /**
   * Get conversation statistics
   */
  getStats(): AIStats {
    const stats: AIStats = {
      activeConversations: this.conversationHistory.size,
      totalMessages: 0
    }

    for (const history of this.conversationHistory.values()) {
      stats.totalMessages += history.length
    }

    return stats
  }

  /**
   * Cleanup old conversations (call periodically)
   */
  cleanupOldConversations(maxAgeHours: number = 24): void {
    const cutoffTime = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000)
    let cleanedCount = 0

    for (const [callId, history] of this.conversationHistory.entries()) {
      const lastMessage = history[history.length - 1]
      if (lastMessage?.timestamp && lastMessage.timestamp < cutoffTime) {
        this.conversationHistory.delete(callId)
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      this.logger.info('Cleaned up old conversations', { 
        cleanedCount, 
        maxAgeHours 
      })
    }
  }
}
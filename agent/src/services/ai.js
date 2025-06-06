const OpenAI = require('openai')
const config = require('../config')
const logger = require('../utils/logger')

class AIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey
    })
    this.logger = logger.child({ service: 'ai' })
    this.conversationHistory = new Map() // Store conversation history by call ID
  }

  /**
   * Generate AI response for conversation
   * @param {string} userMessage - User's message/transcript
   * @param {string} callId - Unique call identifier
   * @param {Object} options - Additional options
   * @returns {Promise<string>} AI response
   */
  async generateResponse(userMessage, callId, options = {}) {
    try {
      const systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt()
      const maxTokens = options.maxTokens || config.openai.maxTokens
      const temperature = options.temperature || config.openai.temperature

      // Get or initialize conversation history
      let history = this.conversationHistory.get(callId) || []
      
      // Add user message to history
      history.push({
        role: 'user',
        content: userMessage
      })

      // Prepare messages for OpenAI
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history
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
        content: aiResponse
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
      this.logger.error('Failed to generate AI response', {
        callId,
        userMessage: userMessage.substring(0, 100),
        error: error.message
      })
      throw error
    }
  }

  /**
   * Generate streaming AI response
   * @param {string} userMessage - User's message
   * @param {string} callId - Call identifier
   * @param {Function} onChunk - Callback for each response chunk
   * @param {Object} options - Additional options
   * @returns {Promise<string>} Complete response
   */
  async generateStreamingResponse(userMessage, callId, onChunk, options = {}) {
    try {
      const systemPrompt = options.systemPrompt || this.getDefaultSystemPrompt()
      const maxTokens = options.maxTokens || config.openai.maxTokens
      const temperature = options.temperature || config.openai.temperature

      let history = this.conversationHistory.get(callId) || []
      history.push({ role: 'user', content: userMessage })

      const messages = [
        { role: 'system', content: systemPrompt },
        ...history
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
      history.push({ role: 'assistant', content: fullResponse })
      this.conversationHistory.set(callId, history.slice(-20))

      this.logger.info('Streaming AI response completed', {
        callId,
        responseLength: fullResponse.length
      })

      return fullResponse.trim()
    } catch (error) {
      this.logger.error('Failed to generate streaming AI response', {
        callId,
        error: error.message
      })
      throw error
    }
  }

  /**
   * Analyze user intent from transcript
   * @param {string} transcript - User's speech transcript
   * @param {string} callId - Call identifier
   * @returns {Promise<Object>} Intent analysis
   */
  async analyzeIntent(transcript, callId) {
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
      const analysis = JSON.parse(response)

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
        error: error.message
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
   * @param {string} callId - Call identifier
   */
  clearConversationHistory(callId) {
    this.conversationHistory.delete(callId)
    this.logger.info('Cleared conversation history', { callId })
  }

  /**
   * Get conversation history for a call
   * @param {string} callId - Call identifier
   * @returns {Array} Conversation history
   */
  getConversationHistory(callId) {
    return this.conversationHistory.get(callId) || []
  }

  /**
   * Get default system prompt for AI assistant
   * @returns {string} System prompt
   */
  getDefaultSystemPrompt() {
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
   * @returns {Object} Statistics about active conversations
   */
  getStats() {
    const stats = {
      activeConversations: this.conversationHistory.size,
      totalMessages: 0
    }

    for (const history of this.conversationHistory.values()) {
      stats.totalMessages += history.length
    }

    return stats
  }
}

module.exports = AIService
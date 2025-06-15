import { TwilioService } from './twilio'
import logger from '../utils/logger'

export interface ToolCall {
  name: string
  args: Record<string, any>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, any>
    required: string[]
  }
}

interface RestaurantSearchResponse {
  context: string;
  error?: string;
}

export class ToolService {
  private twilioService: TwilioService
  private logger: typeof logger
  private restaurantServiceUrl: string

  constructor(twilioService: TwilioService) {
    this.twilioService = twilioService
    this.logger = logger.child({ service: 'tools' })
    this.restaurantServiceUrl = process.env.RESTAURANTS_SERVICE_URL || 'http://localhost:3000'
  }

  // Define available tools
  getAvailableTools(): ToolDefinition[] {
    return [
      {
        name: 'search_restaurant',
        description: 'Search for restaurant information and context based on user query',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The user\'s question or search query about the restaurant',
              required: true
            },
          },
          required: ['query']
        }
      },
      {
        name: 'hang_up_call',
        description: 'End the current phone call',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Reason for ending the call (e.g., "conversation_complete", "user_requested", "error")',
              required: true
            }
          },
          required: ['reason']
        }
      },
      {
        name: 'transfer_call',
        description: 'Transfer the call to a human agent or another phone number',
        parameters: {
          type: 'object',
          properties: {
            destination: {
              type: 'string',
              description: 'Phone number or extension to transfer to',
              required: true
            },
            reason: {
              type: 'string',
              description: 'Reason for transfer (e.g., "complex_request", "user_requested")',
              required: true
            }
          },
          required: ['destination', 'reason']
        }
      }
    ]
  }

  // Execute a tool call
  async executeToolCall(callSid: string, toolCall: ToolCall): Promise<{ success: boolean; message: string; data?: any }> {
    this.logger.info('Executing tool call', { callSid, tool: toolCall.name, args: toolCall.args })

    try {
      switch (toolCall.name) {
        case 'search_restaurant':
          return await this.searchRestaurant(toolCall.args.query)
        
        case 'hang_up_call':
          return await this.hangUpCall(callSid, toolCall.args.reason)
        
        case 'transfer_call':
          return await this.transferCall(callSid, toolCall.args.destination, toolCall.args.reason)
        
        default:
          this.logger.warn('Unknown tool called', { tool: toolCall.name })
          return { 
            success: false, 
            message: `Unknown tool: ${toolCall.name}` 
          }
      }
    } catch (error) {
      this.logger.error('Tool execution failed', { 
        tool: toolCall.name, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      })
      return { 
        success: false, 
        message: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }
    }
  }

  // Search restaurant information
  private async searchRestaurant(query: string): Promise<{ success: boolean; message: string; data?: any }> {
    try {
      const response = await fetch(`${this.restaurantServiceUrl}/api/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: query,
          restaurantId: "9552d239-5006-4f49-bfbf-e5ea8b7e33c5"
        })
      })

      if (!response.ok) {
        throw new Error(`Search failed with status ${response.status}`)
      }

      const data = await response.json() as RestaurantSearchResponse
      
      this.logger.info('Restaurant search completed', { 
        query,
        restaurantId: "9552d239-5006-4f49-bfbf-e5ea8b7e33c5",
        hasContext: !!data.context
      })

      return {
        success: true,
        message: 'Restaurant information retrieved successfully',
        data: data.context
      }
    } catch (error) {
      console.error('Restaurant search failed', {
        query,
        restaurantId: "9552d239-5006-4f49-bfbf-e5ea8b7e33c5",
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return {
        success: false,
        message: `Failed to search restaurant information: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  // Hang up the call
  private async hangUpCall(callSid: string, reason: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.twilioService.endCall(callSid)
      this.logger.info('Call ended successfully', { callSid, reason })
      return { 
        success: true, 
        message: `Call ended: ${reason}` 
      }
    } catch (error) {
      this.logger.error('Failed to end call', { 
        callSid, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      })
      return { 
        success: false, 
        message: `Failed to end call: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }
    }
  }

  // Transfer the call
  private async transferCall(
    callSid: string, 
    destination: string, 
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.twilioService.transferCall(callSid, destination)
      this.logger.info('Call transferred successfully', { callSid, destination, reason })
      return { 
        success: true, 
        message: `Call transferred to ${destination}: ${reason}` 
      }
    } catch (error) {
      this.logger.error('Failed to transfer call', { 
        callSid, 
        destination,
        error: error instanceof Error ? error.message : 'Unknown error' 
      })
      return { 
        success: false, 
        message: `Failed to transfer call: ${error instanceof Error ? error.message : 'Unknown error'}` 
      }
    }
  }
} 
import fastify, { FastifyRequest } from 'fastify'
import formbody from '@fastify/formbody'
import cors from '@fastify/cors'
import logger from '../utils/logger'

export async function registerPlugins(app: ReturnType<typeof fastify>) {
  try {
    // Register CORS with proper configuration
    await app.register(cors, {
      origin: true,
      methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: true
    })

    // Register form body parser
    await app.register(formbody)
    
    // Register JSON parser explicitly
    app.addContentTypeParser('application/json', { parseAs: 'string' }, function (
      req: FastifyRequest,
      body: string,
      done: (err: Error | null, result?: any) => void
    ) {
      try {
        const json = JSON.parse(body)
        done(null, json)
      } catch (err) {
        done(err as Error, undefined)
      }
    })
    
    logger.info('Plugins registered successfully')
  } catch (error) {
    logger.error('Failed to register plugins', { error })
    throw error
  }
} 
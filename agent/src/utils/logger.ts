import pino from 'pino'
import config from '../config'

const logger = config.logging.prettyPrint 
  ? pino({
      level: config.logging.level,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        }
      }
    })
  : pino({
      level: config.logging.level
    })

export default logger
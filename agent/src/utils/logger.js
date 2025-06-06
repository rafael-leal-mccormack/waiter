const pino = require('pino')
const config = require('../config')

const logger = pino({
  level: config.logging.level,
  transport: config.logging.prettyPrint ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname'
    }
  } : undefined
})

module.exports = logger
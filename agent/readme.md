# AI Phone Call POC - Fastify TypeScript

A proof-of-concept application for AI-powered phone calls using Fastify, Twilio, Deepgram, and ElevenLabs, built with TypeScript for type safety and maintainability.

## 🏗️ Project Structure

```
agent/
├── src/
│   ├── config/
│   │   └── index.ts              # Centralized configuration with type safety
│   ├── services/
│   │   ├── ai.ts                 # OpenAI service for conversation AI
│   │   ├── deepgram.ts          # Real-time speech-to-text transcription
│   │   ├── elevenlabs.ts        # Text-to-speech synthesis
│   │   └── twilio.ts            # Phone call management and webhooks
│   ├── types/
│   │   └── index.ts             # TypeScript type definitions
│   ├── utils/
│   │   └── logger.ts            # Structured logging with Pino
│   └── server.ts                # Main Fastify server with WebSocket support
├── dist/                        # Compiled JavaScript output
├── package.json                 # Dependencies and scripts
├── tsconfig.json               # TypeScript configuration
├── .env.example                # Environment variables template
├── .gitignore                  # Git ignore rules
└── readme.md                   # This file
```

## 🚀 Features

- **Real-time Voice Conversation**: Handle phone calls with AI responses
- **Speech-to-Text**: Convert caller audio to text using Deepgram
- **AI Processing**: Generate intelligent responses using OpenAI GPT
- **Text-to-Speech**: Convert AI responses to natural speech using ElevenLabs
- **WebSocket Streaming**: Real-time audio processing with Twilio Media Streams
- **TypeScript**: Full type safety and modern development experience
- **Structured Logging**: Comprehensive logging with Pino
- **Rate Limiting**: Built-in protection against abuse
- **Health Monitoring**: Health checks and statistics endpoints

## 🛠️ Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Fastify (high-performance web framework)
- **Language**: TypeScript
- **Voice/SMS**: Twilio (phone calls and media streaming)
- **Speech-to-Text**: Deepgram (real-time transcription)
- **Text-to-Speech**: ElevenLabs (natural voice synthesis)
- **AI**: OpenAI GPT (conversation intelligence)
- **Logging**: Pino (structured JSON logging)
- **WebSockets**: @fastify/websocket

## 📋 Prerequisites

1. **Node.js**: Version 18 or higher
2. **API Keys**: You'll need accounts and API keys for:
   - Twilio (Account SID, Auth Token, Phone Number)
   - Deepgram (API Key)
   - ElevenLabs (API Key, Voice ID)
   - OpenAI (API Key)
3. **ngrok** (for local development): To expose your local server for Twilio webhooks

## 🔧 Installation

1. **Clone and navigate to the project**:
   ```bash
   cd agent
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your actual API keys
   ```

4. **Build the TypeScript project**:
   ```bash
   npm run build
   ```

## ⚙️ Configuration

Create a `.env` file based on `.env.example`:

```env
# Server Configuration
PORT=3000
NODE_ENV=development
HOST=0.0.0.0

# Twilio Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
TWILIO_WEBHOOK_URL=https://your-ngrok-url.ngrok.io

# Deepgram Configuration
DEEPGRAM_API_KEY=your_deepgram_api_key

# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_preferred_voice_id

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-3.5-turbo
```

## 🏃‍♂️ Running the Application

### Development Mode
```bash
npm run dev
```
Uses `ts-node-dev` for hot reloading during development.

### Production Mode
```bash
npm run build
npm start
```

### Local Development with ngrok
1. Start the server:
   ```bash
   npm run dev
   ```

2. In another terminal, expose your local server:
   ```bash
   ngrok http 3000
   ```

3. Update your `.env` file with the ngrok URL:
   ```env
   TWILIO_WEBHOOK_URL=https://your-ngrok-url.ngrok.io
   ```

## 🔗 API Endpoints

### Health Check
```
GET /health
```
Returns server health status and basic information.

### Make Outbound Call
```
POST /api/call
Content-Type: application/json

{
  "phoneNumber": "+1234567890"
}
```

### Get Active Calls
```
GET /api/calls
```
Returns list of currently active calls.

### Get Call Details
```
GET /api/calls/:callSid
```
Returns detailed information about a specific call.

### Get Statistics
```
GET /api/stats
```
Returns server and AI service statistics.

### Twilio Webhook (automatically configured)
```
POST /webhook/call
```
Handles incoming call webhooks from Twilio.

### WebSocket Media Stream
```
WSS /websocket/media
```
Handles real-time audio streaming from Twilio.

## 🧩 Architecture Overview

### Call Flow
1. **Incoming Call** → Twilio → Webhook (`/webhook/call`)
2. **TwiML Response** → Establishes WebSocket connection for media streaming
3. **Audio Stream** → WebSocket → Deepgram (Speech-to-Text)
4. **Transcript** → OpenAI (AI Response Generation)
5. **AI Response** → ElevenLabs (Text-to-Speech)
6. **Audio Response** → WebSocket → Twilio → Caller

### Service Architecture

#### TwilioService (`src/services/twilio.ts`)
- Manages phone calls and TwiML generation
- Handles webhook validation
- Provides call control methods

#### DeepgramService (`src/services/deepgram.ts`)
- Real-time speech-to-text transcription
- WebSocket connection management
- Audio data processing

#### ElevenLabsService (`src/services/elevenlabs.ts`)
- Text-to-speech conversion
- Voice management
- Audio streaming capabilities

#### AIService (`src/services/ai.ts`)
- OpenAI GPT integration
- Conversation history management
- Intent analysis and response generation

## 🎯 Key Features Implementation

### Real-time Audio Processing
- WebSocket connections handle bidirectional audio streams
- Base64 encoded audio chunks processed in real-time
- Automatic connection cleanup and error handling

### Conversation Management
- Per-call conversation history storage
- Automatic cleanup of old conversations
- Intent analysis and sentiment detection

### Type Safety
- Comprehensive TypeScript interfaces for all data structures
- Strict type checking for API responses
- Type-safe configuration management

### Error Handling
- Graceful error recovery for all services
- Comprehensive logging for debugging
- Circuit breaker patterns for external APIs

## 🔍 Monitoring and Debugging

### Logging
The application uses structured JSON logging with different levels:
- `info`: General application flow
- `debug`: Detailed debugging information
- `error`: Error conditions with context
- `warn`: Warning conditions

### Health Checks
Monitor application health via the `/health` endpoint which includes:
- Server status
- Environment information
- Timestamp
- Version information

### Statistics
The `/api/stats` endpoint provides:
- Active call count
- AI conversation statistics
- Server uptime and memory usage

## 🚧 Development Scripts

```bash
# Install dependencies
npm install

# Development with hot reload
npm run dev

# Build TypeScript
npm run build

# Start production server
npm start

# Run tests
npm test

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Clean build directory
npm run clean
```

## 🔒 Security Considerations

- **Webhook Validation**: Twilio webhook signatures are validated
- **Rate Limiting**: Built-in rate limiting to prevent abuse
- **CORS**: Configured for secure cross-origin requests
- **Helmet**: Security headers automatically applied
- **Environment Variables**: Sensitive data stored in environment variables

## 📈 Scaling Considerations

- **Horizontal Scaling**: Stateless design allows for easy horizontal scaling
- **Load Balancing**: WebSocket connections can be load balanced
- **Database Integration**: Add persistent storage for call history
- **Redis**: Add Redis for session management across instances

## 🐛 Troubleshooting

### Common Issues

1. **WebSocket Connection Failed**
   - Check ngrok is running and URL is correct
   - Verify Twilio webhook configuration
   - Check firewall settings

2. **Audio Not Processing**
   - Verify Deepgram API key is valid
   - Check audio format compatibility
   - Monitor WebSocket message logs

3. **AI Responses Not Generated**
   - Verify OpenAI API key and quota
   - Check conversation history limits
   - Monitor API response times

4. **Text-to-Speech Failed**
   - Verify ElevenLabs API key and quota
   - Check voice ID configuration
   - Monitor text length limits

### Debug Mode
Set `LOG_LEVEL=debug` in your `.env` file for detailed logging.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper TypeScript types
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- **Twilio** for voice communication platform
- **Deepgram** for real-time speech recognition
- **ElevenLabs** for natural text-to-speech
- **OpenAI** for conversational AI
- **Fastify** for the high-performance web framework
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
3. **ngrok** (for local development): Required to expose your local server for Twilio webhooks

## 🌐 ngrok Setup & Configuration

### What is ngrok?

ngrok is a tunneling service that creates secure tunnels to your localhost, making your local development server accessible from the internet. This is **essential** for Twilio webhooks because:

- Twilio needs to send webhook requests to your server when calls are received
- Your local development server (localhost:3000) is not accessible from the internet
- ngrok creates a public HTTPS URL that tunnels to your local server

### Installing ngrok

#### Option 1: npm (Recommended for Node.js projects)
```bash
npm install -g ngrok
```

#### Option 2: Download Binary
1. Visit [ngrok.com](https://ngrok.com)
2. Sign up for a free account
3. Download the appropriate binary for your OS
4. Extract and move to your PATH

#### Option 3: Package Managers
```bash
# macOS with Homebrew
brew install ngrok/ngrok/ngrok

# Windows with Chocolatey
choco install ngrok

# Linux with snap
sudo snap install ngrok
```

### Setting up ngrok Authentication

1. **Sign up** at [ngrok.com](https://ngrok.com) (free account)
2. **Get your auth token** from the dashboard
3. **Configure ngrok** with your token:
   ```bash
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```

### Using ngrok with the Project

#### Step 1: Start Your Server
```bash
# In terminal 1 - Start the development server
npm run dev
```
Your server will start on `http://localhost:3000`

#### Step 2: Start ngrok Tunnel
```bash
# In terminal 2 - Create tunnel to your local server
ngrok http 3000
```

You'll see output like:
```
ngrok by @inconshreveable

Session Status                online
Account                       your-email@example.com
Version                       3.x.x
Region                        United States (us)
Latency                       -
Web Interface                 http://127.0.0.1:4040
Forwarding                    https://abc123.ngrok.io -> http://localhost:3000

Connections                   ttl     opn     rt1     rt5     p50     p90
                              0       0       0.00    0.00    0.00    0.00
```

#### Step 3: Update Environment Variables
Copy the HTTPS forwarding URL (e.g., `https://abc123.ngrok.io`) and update your `.env` file:

```env
TWILIO_WEBHOOK_URL=https://abc123.ngrok.io
```

#### Step 4: Configure Twilio Webhooks
In your Twilio Console:
1. Go to Phone Numbers → Manage → Active numbers
2. Click on your Twilio phone number
3. Set the webhook URL to: `https://your-ngrok-url.ngrok.io/webhook/call`
4. Set HTTP method to `POST`
5. Save the configuration

### ngrok Pro Tips

#### 1. Custom Subdomain (Paid Feature)
```bash
ngrok http 3000 --subdomain=my-ai-phone-app
# Creates: https://my-ai-phone-app.ngrok.io
```

#### 2. Configuration File
Create `~/.ngrok2/ngrok.yml`:
```yaml
version: "2"
authtoken: YOUR_AUTH_TOKEN
tunnels:
  ai-phone:
    addr: 3000
    proto: http
    subdomain: my-ai-phone-app
```

Then run:
```bash
ngrok start ai-phone
```

#### 3. Inspect Traffic
Visit `http://localhost:4040` to see all HTTP requests/responses in real-time.

#### 4. Multiple Tunnels
```bash
# Tunnel multiple ports
ngrok http 3000 3001 3002
```

### ngrok Troubleshooting

#### Common Issues

1. **"ngrok not found" error**
   ```bash
   # Check if ngrok is installed
   which ngrok
   
   # If not found, install globally
   npm install -g ngrok
   ```

2. **Authentication failed**
   ```bash
   # Re-add your auth token
   ngrok config add-authtoken YOUR_AUTH_TOKEN
   ```

3. **Tunnel already exists**
   ```bash
   # Kill existing tunnels
   pkill ngrok
   # Or use a different port
   ngrok http 3001
   ```

4. **Webhook not receiving requests**
   - Verify ngrok is running and shows "online" status
   - Check the forwarding URL is correct in your `.env`
   - Ensure Twilio webhook URL matches your ngrok URL
   - Check ngrok web interface (localhost:4040) for incoming requests

#### Testing Your Setup

1. **Test webhook endpoint directly**:
   ```bash
   curl -X POST https://your-ngrok-url.ngrok.io/webhook/call \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "CallSid=test&From=+1234567890&To=+1987654321&CallStatus=ringing"
   ```

2. **Check server logs** for incoming requests

3. **Monitor ngrok dashboard** at `http://localhost:4040`

#### Alternative to ngrok

For production or if you prefer other solutions:

- **Production**: Deploy to cloud platforms (AWS, Heroku, Vercel, etc.)
- **Local alternatives**: 
  - `localtunnel`: `npm install -g localtunnel`
  - `serveo.net`: SSH-based tunneling
  - `localhost.run`: SSH-based alternative

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

4. **Install and configure ngrok** (see ngrok section above)

5. **Build the TypeScript project**:
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

### Complete Local Development Setup
```bash
# Terminal 1: Start the development server
npm run dev

# Terminal 2: Start ngrok tunnel
ngrok http 3000

# Update your .env file with the ngrok URL
# Configure Twilio webhook with the ngrok URL
# Test by calling your Twilio phone number
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
   - Verify Twilio webhook configuration matches ngrok URL exactly
   - Check firewall settings
   - Verify ngrok tunnel shows "online" status
   - Test webhook endpoint directly with curl

2. **Audio Not Processing**
   - Verify Deepgram API key is valid
   - Check audio format compatibility
   - Monitor WebSocket message logs
   - Check ngrok dashboard for incoming media streams

3. **AI Responses Not Generated**
   - Verify OpenAI API key and quota
   - Check conversation history limits
   - Monitor API response times
   - Check server logs for AI service errors

4. **Text-to-Speech Failed**
   - Verify ElevenLabs API key and quota
   - Check voice ID configuration
   - Monitor text length limits
   - Verify voice ID exists in your ElevenLabs account

5. **ngrok Issues**
   - **Tunnel not starting**: Check auth token configuration
   - **Connection refused**: Ensure your server is running on port 3000
   - **Webhook timeouts**: Check if your server is responding quickly enough
   - **URL changes**: ngrok free tier creates new URLs on restart

### Debug Mode
Set `LOG_LEVEL=debug` in your `.env` file for detailed logging.

### Testing Webhooks
Use ngrok's web interface at `http://localhost:4040` to inspect all incoming HTTP requests in real-time.

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
- **ngrok** for secure local development tunneling
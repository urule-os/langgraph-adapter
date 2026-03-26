import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { loadConfig } from './config.js';
import { LangGraphAdapter } from './adapter/langgraph-adapter.js';
import { AnthropicExecutor } from './adapter/anthropic-executor.js';
import { runsRoutes } from './routes/runs.routes.js';
import { chatRoutes } from './routes/chat.routes.js';
import { wsRoutes, broadcast } from './routes/ws.routes.js';

export async function buildServer() {
  const config = loadConfig();
  const app = Fastify({ logger: true });

  // Register CORS
  await app.register(cors, { origin: true });

  // Register WebSocket plugin
  await app.register(fastifyWebsocket);

  // Existing orchestrator adapter (kept for run management)
  const adapter = new LangGraphAdapter(config.langgraphServerUrl);

  // New Anthropic executor for real AI chat
  const executor = new AnthropicExecutor(config);
  executor.setBroadcast(broadcast);

  // Health check
  app.get('/healthz', async () => ({ status: 'ok' }));

  // Capabilities
  app.get('/api/v1/capabilities', async () => adapter.getCapabilities());

  // Run management routes (existing)
  await app.register(runsRoutes, { adapter });

  // Chat routes (new — real AI execution)
  await app.register(chatRoutes, { executor });

  // WebSocket routes (new — real-time streaming)
  await app.register(wsRoutes);

  return { app, config };
}

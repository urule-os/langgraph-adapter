import type { FastifyInstance } from 'fastify';
import type { AnthropicExecutor } from '../adapter/anthropic-executor.js';

export async function chatRoutes(
  app: FastifyInstance,
  opts: { executor: AnthropicExecutor },
): Promise<void> {
  const { executor } = opts;

  // Receive a chat message and trigger AI response
  app.post<{
    Body: {
      conversationId: string;
      agentId: string;
      workspaceId: string;
      userMessage: string;
    };
  }>('/api/v1/chat', async (request, reply) => {
    const { conversationId, agentId, workspaceId, userMessage } = request.body;

    // Fire and forget — the executor will stream via WebSocket
    executor.chat({ conversationId, agentId, workspaceId, userMessage }).catch((err) => {
      app.log.error({ err }, 'Chat execution failed');
    });

    return reply.status(202).send({ status: 'processing', conversationId });
  });

  // Handle inline action button clicks (approve/deny hiring, accept/reject task)
  app.post<{
    Body: {
      actionType: string;
      actionPayload: Record<string, unknown>;
      conversationId: string;
      agentId: string;
      workspaceId: string;
    };
  }>('/api/v1/chat/action', async (request, reply) => {
    const result = await executor.handleAction(request.body);
    return reply.send(result);
  });
}

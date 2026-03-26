import type { FastifyInstance } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import type { BroadcastFn } from '../adapter/anthropic-executor.js';

// Map of conversationId → set of connected WebSocket clients
const connectionMap = new Map<string, Set<WebSocket>>();

/**
 * Broadcast an event to all WebSocket clients connected to a conversation.
 */
export const broadcast: BroadcastFn = (conversationId: string, event: Record<string, unknown>) => {
  const sockets = connectionMap.get(conversationId);
  if (!sockets) return;

  const payload = JSON.stringify(event);
  for (const ws of sockets) {
    if (ws.readyState === 1) {
      // WebSocket.OPEN
      ws.send(payload);
    }
  }
};

export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { conversationId: string } }>(
    '/api/v1/ws/conversations/:conversationId',
    { websocket: true },
    (socket, request) => {
      const { conversationId } = request.params;

      // Register connection
      if (!connectionMap.has(conversationId)) {
        connectionMap.set(conversationId, new Set());
      }
      connectionMap.get(conversationId)!.add(socket);

      app.log.info({ conversationId }, 'WebSocket client connected');

      // Handle incoming messages (ping/pong, etc.)
      socket.on('message', (data: { toString(): string }) => {
        try {
          const msg = JSON.parse(data.toString()) as { type?: string };
          if (msg.type === 'ping') {
            socket.send(JSON.stringify({ type: 'pong' }));
          }
        } catch {
          // Ignore parse errors
        }
      });

      // Clean up on disconnect
      socket.on('close', () => {
        const sockets = connectionMap.get(conversationId);
        if (sockets) {
          sockets.delete(socket);
          if (sockets.size === 0) {
            connectionMap.delete(conversationId);
          }
        }
        app.log.info({ conversationId }, 'WebSocket client disconnected');
      });
    },
  );
}

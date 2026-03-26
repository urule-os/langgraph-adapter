import type { FastifyInstance } from 'fastify';
import type { LangGraphAdapter, StartRunParams, ArtifactRef } from '../adapter/langgraph-adapter.js';

export async function runsRoutes(
  app: FastifyInstance,
  opts: { adapter: LangGraphAdapter },
): Promise<void> {
  const { adapter } = opts;

  // Start a new run
  app.post<{ Body: StartRunParams }>('/api/v1/runs', async (request, reply) => {
    const handle = await adapter.startRun(request.body);
    return reply.status(201).send(handle);
  });

  // Get run state
  app.get<{ Params: { runId: string } }>(
    '/api/v1/runs/:runId/state',
    async (request, reply) => {
      try {
        const state = await adapter.getState(request.params.runId);
        return reply.send(state);
      } catch (err) {
        return reply.status(404).send({ error: (err as Error).message });
      }
    },
  );

  // Pause run (human-in-the-loop approval)
  app.post<{ Params: { runId: string } }>(
    '/api/v1/runs/:runId/pause',
    async (request, reply) => {
      try {
        await adapter.pauseForApproval(request.params.runId);
        return reply.status(204).send();
      } catch (err) {
        return reply.status(404).send({ error: (err as Error).message });
      }
    },
  );

  // Resume run
  app.post<{ Params: { runId: string } }>(
    '/api/v1/runs/:runId/resume',
    async (request, reply) => {
      try {
        await adapter.resumeRun(request.params.runId);
        return reply.status(204).send();
      } catch (err) {
        return reply.status(404).send({ error: (err as Error).message });
      }
    },
  );

  // Cancel run
  app.delete<{ Params: { runId: string } }>(
    '/api/v1/runs/:runId',
    async (request, reply) => {
      try {
        await adapter.cancelRun(request.params.runId);
        return reply.status(204).send();
      } catch (err) {
        return reply.status(404).send({ error: (err as Error).message });
      }
    },
  );

  // Emit artifact for a run
  app.post<{ Params: { runId: string }; Body: ArtifactRef }>(
    '/api/v1/runs/:runId/artifacts',
    async (request, reply) => {
      try {
        await adapter.emitArtifact(request.params.runId, request.body);
        return reply.status(201).send();
      } catch (err) {
        return reply.status(404).send({ error: (err as Error).message });
      }
    },
  );
}

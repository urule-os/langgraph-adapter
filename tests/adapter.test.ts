import { describe, it, expect, beforeEach } from 'vitest';
import { LangGraphAdapter } from '../src/adapter/langgraph-adapter.js';

describe('LangGraphAdapter', () => {
  let adapter: LangGraphAdapter;

  beforeEach(() => {
    adapter = new LangGraphAdapter('http://localhost:8123');
  });

  // -----------------------------------------------------------------------
  // Lifecycle: start -> pause -> resume -> complete
  // -----------------------------------------------------------------------

  it('should start a run and return a running handle', async () => {
    const handle = await adapter.startRun({
      graphId: 'test-graph',
      input: { message: 'hello' },
    });

    expect(handle.runId).toBeDefined();
    expect(handle.status).toBe('running');
    expect(handle.createdAt).toBeDefined();
  });

  it('should support the full lifecycle: start -> pause -> resume', async () => {
    const handle = await adapter.startRun({
      graphId: 'test-graph',
      input: { task: 'review PR' },
    });

    // Pause
    await adapter.pauseForApproval(handle.runId);
    let state = await adapter.getState(handle.runId);
    expect(state.status).toBe('paused');

    // Resume
    await adapter.resumeRun(handle.runId);
    state = await adapter.getState(handle.runId);
    expect(state.status).toBe('running');
  });

  // -----------------------------------------------------------------------
  // Cancel
  // -----------------------------------------------------------------------

  it('should cancel a running run', async () => {
    const handle = await adapter.startRun({
      graphId: 'test-graph',
      input: { task: 'deploy' },
    });

    await adapter.cancelRun(handle.runId);
    const state = await adapter.getState(handle.runId);
    expect(state.status).toBe('cancelled');
  });

  // -----------------------------------------------------------------------
  // Emit artifact
  // -----------------------------------------------------------------------

  it('should emit and track artifacts', async () => {
    const handle = await adapter.startRun({
      graphId: 'test-graph',
      input: { task: 'generate report' },
    });

    await adapter.emitArtifact(handle.runId, {
      artifactId: 'art-001',
      type: 'report',
      uri: 's3://bucket/report.pdf',
    });

    const state = await adapter.getState(handle.runId);
    expect(state.artifacts).toHaveLength(1);
    expect(state.artifacts[0]?.artifactId).toBe('art-001');
    expect(state.artifacts[0]?.type).toBe('report');
    expect(state.artifacts[0]?.uri).toBe('s3://bucket/report.pdf');
  });

  // -----------------------------------------------------------------------
  // Error: unknown run
  // -----------------------------------------------------------------------

  it('should throw for unknown runId', async () => {
    await expect(adapter.getState('nonexistent')).rejects.toThrow(
      'Run not found: nonexistent',
    );
  });

  // -----------------------------------------------------------------------
  // Capabilities
  // -----------------------------------------------------------------------

  it('should report full capabilities', () => {
    const caps = adapter.getCapabilities();
    expect(caps).toEqual({
      durableCheckpoints: true,
      humanInTheLoop: true,
      subgraphs: true,
      streaming: true,
      artifactEmission: true,
      cancellation: true,
      resumability: true,
    });
  });

  // -----------------------------------------------------------------------
  // Multiple artifacts
  // -----------------------------------------------------------------------

  it('should accumulate multiple artifacts', async () => {
    const handle = await adapter.startRun({
      graphId: 'test-graph',
      input: {},
    });

    await adapter.emitArtifact(handle.runId, {
      artifactId: 'a1',
      type: 'log',
      uri: '/logs/a1.txt',
    });
    await adapter.emitArtifact(handle.runId, {
      artifactId: 'a2',
      type: 'screenshot',
      uri: '/screenshots/a2.png',
    });

    const state = await adapter.getState(handle.runId);
    expect(state.artifacts).toHaveLength(2);
  });

  // -----------------------------------------------------------------------
  // Handoff (placeholder)
  // -----------------------------------------------------------------------

  it('should not throw on handoffAgent (placeholder)', async () => {
    const handle = await adapter.startRun({
      graphId: 'test-graph',
      input: {},
    });

    await expect(
      adapter.handoffAgent(handle.runId, 'agent-xyz'),
    ).resolves.toBeUndefined();
  });
});

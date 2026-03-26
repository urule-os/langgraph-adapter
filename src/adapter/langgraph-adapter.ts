import { ulid } from 'ulid';

// ---------------------------------------------------------------------------
// Inline interface definitions (will migrate to @urule/orchestrator-contract)
// ---------------------------------------------------------------------------

export type RunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface RunHandle {
  runId: string;
  status: RunStatus;
  createdAt: string;
}

export interface RunState {
  runId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  artifacts: ArtifactRef[];
  metadata: Record<string, unknown>;
}

export interface ArtifactRef {
  artifactId: string;
  type: string;
  uri: string;
}

export interface OrchestratorCapabilities {
  durableCheckpoints: boolean;
  humanInTheLoop: boolean;
  subgraphs: boolean;
  streaming: boolean;
  artifactEmission: boolean;
  cancellation: boolean;
  resumability: boolean;
}

export interface StartRunParams {
  graphId: string;
  input: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface OrchestratorAdapter {
  startRun(params: StartRunParams): Promise<RunHandle>;
  pauseForApproval(runId: string): Promise<void>;
  resumeRun(runId: string): Promise<void>;
  cancelRun(runId: string): Promise<void>;
  getState(runId: string): Promise<RunState>;
  emitArtifact(runId: string, artifact: ArtifactRef): Promise<void>;
  handoffAgent(runId: string, targetAgentId: string): Promise<void>;
  getCapabilities(): OrchestratorCapabilities;
}

// ---------------------------------------------------------------------------
// In-memory run store
// ---------------------------------------------------------------------------

interface RunRecord {
  runId: string;
  graphId: string;
  status: RunStatus;
  createdAt: string;
  updatedAt: string;
  input: Record<string, unknown>;
  artifacts: ArtifactRef[];
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// LangGraphAdapter implementation
// ---------------------------------------------------------------------------

export class LangGraphAdapter implements OrchestratorAdapter {
  private readonly runs = new Map<string, RunRecord>();
  private readonly langgraphServerUrl: string;

  constructor(langgraphServerUrl: string) {
    this.langgraphServerUrl = langgraphServerUrl;
  }

  async startRun(params: StartRunParams): Promise<RunHandle> {
    const runId = ulid();
    const now = new Date().toISOString();

    const record: RunRecord = {
      runId,
      graphId: params.graphId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      input: params.input,
      artifacts: [],
      metadata: params.metadata ?? {},
    };

    this.runs.set(runId, record);

    return { runId, status: record.status, createdAt: record.createdAt };
  }

  async pauseForApproval(runId: string): Promise<void> {
    const record = this.requireRun(runId);
    record.status = 'paused';
    record.updatedAt = new Date().toISOString();
  }

  async resumeRun(runId: string): Promise<void> {
    const record = this.requireRun(runId);
    record.status = 'running';
    record.updatedAt = new Date().toISOString();
  }

  async cancelRun(runId: string): Promise<void> {
    const record = this.requireRun(runId);
    record.status = 'cancelled';
    record.updatedAt = new Date().toISOString();
  }

  async getState(runId: string): Promise<RunState> {
    const record = this.requireRun(runId);

    return {
      runId: record.runId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      artifacts: [...record.artifacts],
      metadata: { ...record.metadata },
    };
  }

  async emitArtifact(runId: string, artifact: ArtifactRef): Promise<void> {
    const record = this.requireRun(runId);
    record.artifacts.push(artifact);
    record.updatedAt = new Date().toISOString();
  }

  async handoffAgent(_runId: string, _targetAgentId: string): Promise<void> {
    // Placeholder — will forward to LangGraph sub-graph invocation
  }

  getCapabilities(): OrchestratorCapabilities {
    return {
      durableCheckpoints: true,
      humanInTheLoop: true,
      subgraphs: true,
      streaming: true,
      artifactEmission: true,
      cancellation: true,
      resumability: true,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private requireRun(runId: string): RunRecord {
    const record = this.runs.get(runId);
    if (!record) {
      throw new Error(`Run not found: ${runId}`);
    }
    return record;
  }
}

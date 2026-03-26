export interface Config {
  port: number;
  natsUrl: string;
  registryUrl: string;
  langgraphServerUrl: string;
  approvalsUrl: string;
  stateUrl: string;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env['PORT'] ?? '3000', 10),
    natsUrl: process.env['NATS_URL'] ?? 'nats://localhost:4222',
    registryUrl: process.env['REGISTRY_URL'] ?? 'http://localhost:3001',
    langgraphServerUrl: process.env['LANGGRAPH_SERVER_URL'] ?? 'http://localhost:8123',
    approvalsUrl: process.env['APPROVALS_URL'] ?? 'http://localhost:3003',
    stateUrl: process.env['STATE_URL'] ?? 'http://localhost:3007',
  };
}

export function validateConfig(config: Config): void {
  const missing: string[] = [];
  if (!process.env['NATS_URL'] && config.natsUrl.includes('localhost')) {
    missing.push('NATS_URL (using default)');
  }
  if (!process.env['REGISTRY_URL'] && config.registryUrl.includes('localhost')) {
    missing.push('REGISTRY_URL (using default)');
  }
  if (missing.length > 0) {
    console.warn(`[urule-langgraph-adapter] Config warnings: ${missing.join(', ')}`);
  }
}

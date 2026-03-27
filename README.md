# @urule/langgraph-adapter

LangGraph + Anthropic Claude orchestrator adapter with streaming, tool use, and real-time WebSocket delivery.

Part of the [Urule](https://github.com/urule-ai/urule) ecosystem — the open-source coordination layer for AI agents.

## Features

- **`OrchestratorAdapter` implementation** -- full run lifecycle management (start, pause, resume, cancel, artifacts, handoff) backed by LangGraph Server
- **Anthropic Claude executor** -- real AI chat via the Anthropic SDK with streaming text deltas
- **System tools** -- built-in `hire_agent`, `create_task`, and `update_task_status` tools injected into every conversation
- **Tool call handling** -- multi-turn tool use with automatic follow-up, action buttons for approval flows
- **WebSocket streaming** -- real-time broadcast of `message.streaming`, `message.new`, `agent.thinking`, and `agent.activity` events per conversation
- **Action handling** -- inline button actions (approve/deny hiring, accept/request changes on tasks) processed via `/api/v1/chat/action`
- **Registry integration** -- fetches agent configs, provider API keys, and conversation history from the Urule registry
- Fastify REST API with CORS and WebSocket support

## Quick Start

```bash
npm install
npm run build
npm start
```

Or for development with hot reload:

```bash
npm run dev
```

The server starts on port `3000` by default.

### Send a chat message

```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H 'Content-Type: application/json' \
  -d '{
    "conversationId": "conv-1",
    "agentId": "agent-1",
    "workspaceId": "ws-1",
    "userMessage": "Help me write a deployment script"
  }'
```

The response is `202 Accepted` -- the AI response streams in real time via WebSocket.

### Connect to the WebSocket

```js
const ws = new WebSocket('ws://localhost:3000/api/v1/ws/conversations/conv-1');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'message.streaming') {
    process.stdout.write(data.delta); // Stream text as it arrives
  }
};
```

### Start a run (orchestrator mode)

```bash
curl -X POST http://localhost:3000/api/v1/runs \
  -H 'Content-Type: application/json' \
  -d '{"graphId": "my-graph", "input": {"message": "hello"}}'
```

## API Endpoints

### Chat (AI execution)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/chat` | Send a message, triggers AI response via WebSocket (202) |
| `POST` | `/api/v1/chat/action` | Handle inline action button clicks |

### Runs (orchestrator lifecycle)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/runs` | Start a new run |
| `GET` | `/api/v1/runs/:runId/state` | Get run state |
| `POST` | `/api/v1/runs/:runId/pause` | Pause for human approval |
| `POST` | `/api/v1/runs/:runId/resume` | Resume a paused run |
| `DELETE` | `/api/v1/runs/:runId` | Cancel a run |
| `POST` | `/api/v1/runs/:runId/artifacts` | Emit an artifact |

### WebSocket

| Path | Description |
|---|---|
| `/api/v1/ws/conversations/:conversationId` | Real-time streaming for a conversation |

### Other

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/capabilities` | Get adapter capability flags |
| `GET` | `/healthz` | Health check |

### WebSocket Event Types

| Event | Description |
|---|---|
| `agent.thinking` | Agent is processing the message |
| `message.streaming` | Partial text delta (`delta` field, `done: true` when complete) |
| `message.new` | Complete message with content, sender, action buttons |
| `agent.activity` | Agent is performing an action (e.g., tool call) |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `REGISTRY_URL` | `http://localhost:3001` | Urule registry service URL |
| `LANGGRAPH_SERVER_URL` | `http://localhost:8123` | LangGraph Server URL |
| `APPROVALS_URL` | `http://localhost:3003` | Urule approvals service URL |
| `STATE_URL` | `http://localhost:3007` | Urule state service URL |

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines.

## License

Apache-2.0

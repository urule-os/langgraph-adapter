import Anthropic from '@anthropic-ai/sdk';
import { ulid } from 'ulid';
import type { Config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatParams {
  conversationId: string;
  agentId: string;
  workspaceId: string;
  userMessage: string;
}

export interface ChatEvent {
  type: 'text_delta' | 'thinking' | 'tool_use' | 'tool_result' | 'message_complete' | 'error';
  delta?: string;
  text?: string;
  messageId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: unknown;
  error?: string;
}

interface AgentConfig {
  systemPrompt?: string;
  goals?: string[];
  defaultTools?: string[];
  operatingStyle?: string;
  provider_id?: string;
}

interface ProviderKey {
  apiKey: string;
  provider: string;
  modelName: string;
}

// ---------------------------------------------------------------------------
// System tools injected into every agent conversation
// ---------------------------------------------------------------------------

const HIRE_AGENT_TOOL: Anthropic.Tool = {
  name: 'hire_agent',
  description:
    'Request to hire another specialist agent for a subtask. Use this when the current task requires expertise outside your specialty. The hiring must be approved by the user before proceeding.',
  input_schema: {
    type: 'object' as const,
    properties: {
      agent_role: {
        type: 'string',
        description: 'The role/specialty needed (e.g., "QA Specialist", "DevOps Automator", "Technical Writer")',
      },
      reason: {
        type: 'string',
        description: 'Why this specialist is needed for the current task',
      },
      task_description: {
        type: 'string',
        description: 'A clear description of what the hired agent should do',
      },
      urgency: {
        type: 'string',
        enum: ['low', 'medium', 'high'],
        description: 'How urgent this hiring is',
      },
    },
    required: ['agent_role', 'reason', 'task_description'],
  },
};

const CREATE_TASK_TOOL: Anthropic.Tool = {
  name: 'create_task',
  description:
    'Create a tracked task for work you are about to begin. This makes your work visible to the user and allows them to track progress.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Short title for the task' },
      description: { type: 'string', description: 'Detailed description of what needs to be done' },
      priority: {
        type: 'string',
        enum: ['low', 'medium', 'high', 'urgent'],
        description: 'Task priority level',
      },
    },
    required: ['title'],
  },
};

const UPDATE_TASK_TOOL: Anthropic.Tool = {
  name: 'update_task_status',
  description:
    'Update the status of a task you are working on. Use "in_progress" when starting, "review" when finished and ready for user acceptance.',
  input_schema: {
    type: 'object' as const,
    properties: {
      task_id: { type: 'string', description: 'The ID of the task to update' },
      status: {
        type: 'string',
        enum: ['in_progress', 'review', 'done'],
        description: 'New status for the task',
      },
      progress_note: { type: 'string', description: 'Brief note about what was done' },
    },
    required: ['task_id', 'status'],
  },
};

const SYSTEM_TOOLS: Anthropic.Tool[] = [HIRE_AGENT_TOOL, CREATE_TASK_TOOL, UPDATE_TASK_TOOL];

// ---------------------------------------------------------------------------
// Broadcast callback type (set by WebSocket module)
// ---------------------------------------------------------------------------

export type BroadcastFn = (conversationId: string, event: Record<string, unknown>) => void;

// ---------------------------------------------------------------------------
// AnthropicExecutor
// ---------------------------------------------------------------------------

export class AnthropicExecutor {
  private readonly config: Config;
  private broadcast: BroadcastFn = () => {};

  constructor(config: Config) {
    this.config = config;
  }

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  async chat(params: ChatParams): Promise<void> {
    const { conversationId, agentId, workspaceId, userMessage } = params;

    // 1. Fetch agent config from registry
    const agentConfig = await this.fetchAgentConfig(agentId);
    const systemPrompt = agentConfig.systemPrompt ?? 'You are a helpful AI assistant.';

    // 2. Fetch provider API key
    const providerKey = await this.fetchProviderKey(workspaceId, agentConfig.provider_id);

    // 3. Fetch conversation history from registry
    const history = await this.fetchConversationHistory(conversationId);

    // 4. Create Anthropic client with the user's API key
    const anthropic = new Anthropic({ apiKey: providerKey.apiKey });

    // 5. Build messages array
    const anthropicMessages: Anthropic.MessageParam[] = [
      ...history,
      { role: 'user', content: userMessage },
    ];

    // 6. Create a streaming agent message placeholder
    const messageId = ulid();

    // Broadcast thinking state
    this.broadcast(conversationId, {
      type: 'agent.thinking',
      agent_id: agentId,
      text: 'Processing your message...',
    });

    try {
      // 7. Call Anthropic with streaming
      const stream = anthropic.messages.stream({
        model: providerKey.modelName || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        messages: anthropicMessages,
        tools: SYSTEM_TOOLS,
      });

      let fullResponse = '';
      let hasToolUse = false;
      const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      stream.on('text', (text) => {
        fullResponse += text;
        this.broadcast(conversationId, {
          type: 'message.streaming',
          message_id: messageId,
          delta: text,
          done: false,
        });
      });

      const finalMessage = await stream.finalMessage();

      // Process content blocks for tool use
      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          hasToolUse = true;
          toolUseBlocks.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      if (hasToolUse) {
        // Handle tool calls
        await this.handleToolCalls(
          anthropic,
          providerKey,
          systemPrompt,
          anthropicMessages,
          finalMessage,
          toolUseBlocks,
          conversationId,
          agentId,
          workspaceId,
          messageId,
        );
      } else {
        // No tool calls — save the response as a complete message
        this.broadcast(conversationId, {
          type: 'message.streaming',
          message_id: messageId,
          delta: '',
          done: true,
        });

        // Save the assistant message to registry
        await this.saveMessage(conversationId, agentId, fullResponse, 'markdown', []);

        // Broadcast new message
        this.broadcast(conversationId, {
          type: 'message.new',
          message: {
            id: messageId,
            conversation_id: conversationId,
            sender_id: agentId,
            sender_type: 'agent',
            content: fullResponse,
            content_type: 'markdown',
            status: 'delivered',
            created_at: new Date().toISOString(),
          },
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      this.broadcast(conversationId, {
        type: 'message.new',
        message: {
          id: messageId,
          conversation_id: conversationId,
          sender_id: agentId,
          sender_type: 'agent',
          content: `I encountered an error: ${errorMsg}`,
          content_type: 'text',
          status: 'failed',
          created_at: new Date().toISOString(),
        },
      });
      await this.saveMessage(conversationId, agentId, `I encountered an error: ${errorMsg}`, 'text', []);
    }
  }

  // ---------------------------------------------------------------------------
  // Tool call handling
  // ---------------------------------------------------------------------------

  private async handleToolCalls(
    anthropic: Anthropic,
    providerKey: ProviderKey,
    systemPrompt: string,
    previousMessages: Anthropic.MessageParam[],
    assistantMessage: Anthropic.Message,
    toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }>,
    conversationId: string,
    agentId: string,
    workspaceId: string,
    messageId: string,
  ): Promise<void> {
    // Build text from non-tool blocks
    let textContent = '';
    for (const block of assistantMessage.content) {
      if (block.type === 'text') {
        textContent += block.text;
      }
    }

    // Process each tool call
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const tool of toolUseBlocks) {
      this.broadcast(conversationId, {
        type: 'agent.activity',
        agent_id: agentId,
        activity_type: 'tool_call',
        content: `Using ${tool.name}...`,
      });

      const result = await this.executeTool(tool.name, tool.input, conversationId, agentId, workspaceId);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tool.id,
        content: JSON.stringify(result.output),
      });

      // If the tool produced action buttons (hire_agent, update_task_status with review), include them
      if (result.actionButtons && result.actionButtons.length > 0) {
        const combinedContent = textContent + (result.message ? `\n\n${result.message}` : '');
        await this.saveMessage(conversationId, agentId, combinedContent, 'markdown', result.actionButtons);

        this.broadcast(conversationId, {
          type: 'message.streaming',
          message_id: messageId,
          delta: '',
          done: true,
        });

        this.broadcast(conversationId, {
          type: 'message.new',
          message: {
            id: messageId,
            conversation_id: conversationId,
            sender_id: agentId,
            sender_type: 'agent',
            content: combinedContent,
            content_type: 'markdown',
            status: 'delivered',
            action_buttons: result.actionButtons,
            created_at: new Date().toISOString(),
          },
        });
        return; // Don't continue the conversation — waiting for user action
      }
    }

    // Continue the conversation with tool results
    const continuedMessages: Anthropic.MessageParam[] = [
      ...previousMessages,
      { role: 'assistant', content: assistantMessage.content },
      { role: 'user', content: toolResults },
    ];

    // Make another API call with tool results
    const followUp = await anthropic.messages.create({
      model: providerKey.modelName || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: continuedMessages,
      tools: SYSTEM_TOOLS,
    });

    let followUpText = '';
    for (const block of followUp.content) {
      if (block.type === 'text') {
        followUpText += block.text;
      }
    }

    // Save and broadcast
    await this.saveMessage(conversationId, agentId, followUpText || textContent, 'markdown', []);

    this.broadcast(conversationId, {
      type: 'message.streaming',
      message_id: messageId,
      delta: '',
      done: true,
    });

    this.broadcast(conversationId, {
      type: 'message.new',
      message: {
        id: messageId,
        conversation_id: conversationId,
        sender_id: agentId,
        sender_type: 'agent',
        content: followUpText || textContent,
        content_type: 'markdown',
        status: 'delivered',
        created_at: new Date().toISOString(),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Tool execution
  // ---------------------------------------------------------------------------

  private async executeTool(
    name: string,
    input: Record<string, unknown>,
    conversationId: string,
    agentId: string,
    workspaceId: string,
  ): Promise<{ output: unknown; message?: string; actionButtons?: unknown[] }> {
    switch (name) {
      case 'hire_agent':
        return this.executeHireAgent(input, agentId, workspaceId);
      case 'create_task':
        return this.executeCreateTask(input, agentId, workspaceId);
      case 'update_task_status':
        return this.executeUpdateTaskStatus(input, conversationId);
      default:
        return { output: { error: `Unknown tool: ${name}` } };
    }
  }

  private async executeHireAgent(
    input: Record<string, unknown>,
    agentId: string,
    workspaceId: string,
  ): Promise<{ output: unknown; message?: string; actionButtons?: unknown[] }> {
    const agentRole = input['agent_role'] as string;
    const reason = input['reason'] as string;
    const taskDescription = input['task_description'] as string;
    const urgency = (input['urgency'] as string) ?? 'medium';

    // Create task in state service
    let taskId: string | undefined;
    try {
      const taskRes = await fetch(`${this.config.stateUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          title: taskDescription,
          description: `Task for hired ${agentRole}: ${reason}`,
          status: 'todo',
          priority: urgency,
          assigneeId: agentId,
          creatorId: agentId,
        }),
      });
      const task = (await taskRes.json()) as { id: string };
      taskId = task.id;
    } catch {
      // State service might not be available — continue
    }

    // Create approval in approvals service
    let approvalId: string | undefined;
    try {
      const riskMap: Record<string, string> = { low: 'low', medium: 'medium', high: 'high' };
      const approvalRes = await fetch(`${this.config.approvalsUrl}/api/v1/approvals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'hire_agent',
          title: `Hire ${agentRole} for: ${taskDescription}`,
          requesterId: agentId,
          workspaceId,
          priority: urgency,
          riskLevel: riskMap[urgency] ?? 'medium',
          reasoningPoints: [
            { label: 'Specialist needed', verified: true, detail: reason },
            { label: 'Task scope defined', verified: true, detail: taskDescription },
          ],
          context: { targetRole: agentRole, taskId, taskDescription },
        }),
      });
      const approval = (await approvalRes.json()) as { id: string };
      approvalId = approval.id;
    } catch {
      // Approvals service might not be available — continue
    }

    const message = `I'd like to hire a **${agentRole}** to help with this task.\n\n**Reason:** ${reason}\n\n**Task:** ${taskDescription}`;

    return {
      output: {
        status: 'pending_approval',
        approvalId,
        taskId,
        message: `Hiring request for ${agentRole} created. Awaiting user approval.`,
      },
      message,
      actionButtons: [
        {
          label: 'Approve Hiring',
          action_type: 'approve_hiring',
          action_payload: { approval_id: approvalId, task_id: taskId, agent_role: agentRole, task_description: taskDescription },
          style: 'primary',
        },
        {
          label: 'Deny',
          action_type: 'deny_hiring',
          action_payload: { approval_id: approvalId },
          style: 'secondary',
        },
      ],
    };
  }

  private async executeCreateTask(
    input: Record<string, unknown>,
    agentId: string,
    workspaceId: string,
  ): Promise<{ output: unknown }> {
    const title = input['title'] as string;
    const description = (input['description'] as string) ?? '';
    const priority = (input['priority'] as string) ?? 'medium';

    try {
      const res = await fetch(`${this.config.stateUrl}/api/v1/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          title,
          description,
          status: 'todo',
          priority,
          assigneeId: agentId,
          creatorId: agentId,
        }),
      });
      const task = (await res.json()) as { id: string };
      return { output: { taskId: task.id, status: 'created', message: `Task "${title}" created successfully.` } };
    } catch {
      return { output: { error: 'Failed to create task' } };
    }
  }

  private async executeUpdateTaskStatus(
    input: Record<string, unknown>,
    conversationId: string,
  ): Promise<{ output: unknown; message?: string; actionButtons?: unknown[] }> {
    const taskId = input['task_id'] as string;
    const status = input['status'] as string;
    const progressNote = (input['progress_note'] as string) ?? '';

    try {
      await fetch(`${this.config.stateUrl}/api/v1/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
    } catch {
      return { output: { error: 'Failed to update task' } };
    }

    // If status is "review", provide accept/reject buttons
    if (status === 'review') {
      return {
        output: { taskId, status, message: 'Task is ready for review.' },
        message: progressNote ? `**Task Update:** ${progressNote}\n\nThis task is now ready for your review.` : 'This task is now ready for your review.',
        actionButtons: [
          {
            label: 'Accept Result',
            action_type: 'accept_task',
            action_payload: { task_id: taskId },
            style: 'primary',
          },
          {
            label: 'Request Changes',
            action_type: 'request_changes',
            action_payload: { task_id: taskId },
            style: 'secondary',
          },
        ],
      };
    }

    return { output: { taskId, status, message: `Task status updated to ${status}.` } };
  }

  // ---------------------------------------------------------------------------
  // Action handling (for inline button clicks from the UI)
  // ---------------------------------------------------------------------------

  async handleAction(action: {
    actionType: string;
    actionPayload: Record<string, unknown>;
    conversationId: string;
    agentId: string;
    workspaceId: string;
  }): Promise<{ message: string }> {
    const { actionType, actionPayload, conversationId, agentId, workspaceId } = action;

    switch (actionType) {
      case 'approve_hiring': {
        const approvalId = actionPayload['approval_id'] as string;
        const taskId = actionPayload['task_id'] as string;
        const agentRole = actionPayload['agent_role'] as string;
        const taskDescription = actionPayload['task_description'] as string;

        // Approve in approvals service
        try {
          await fetch(`${this.config.approvalsUrl}/api/v1/approvals/${approvalId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decidedBy: 'user', decisionNote: 'Approved via chat' }),
          });
        } catch { /* continue */ }

        // Find or create the hired agent from matching personality package
        let hiredAgentName = agentRole;
        try {
          // Create a new agent in registry based on the role
          const agentRes = await fetch(`${this.config.registryUrl}/api/v1/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspaceId,
              name: agentRole,
              description: `Hired specialist: ${agentRole}`,
              config: { role: agentRole, hiredFor: taskDescription },
            }),
          });
          const newAgent = (await agentRes.json()) as { id: string; name: string };
          hiredAgentName = newAgent.name;

          // Transfer task ownership
          if (taskId) {
            await fetch(`${this.config.stateUrl}/api/v1/tasks/${taskId}/assign`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                toUserId: newAgent.id,
                reason: `Hired ${agentRole} for this task`,
              }),
            });
          }
        } catch { /* continue */ }

        const msg = `Approved! **${hiredAgentName}** has been hired and assigned to the task.`;
        await this.saveMessage(conversationId, 'system', msg, 'markdown', []);
        this.broadcast(conversationId, {
          type: 'message.new',
          message: {
            id: ulid(),
            conversation_id: conversationId,
            sender_id: 'system',
            sender_type: 'system',
            content: msg,
            content_type: 'markdown',
            status: 'delivered',
            created_at: new Date().toISOString(),
          },
        });

        return { message: msg };
      }

      case 'deny_hiring': {
        const approvalId = actionPayload['approval_id'] as string;
        try {
          await fetch(`${this.config.approvalsUrl}/api/v1/approvals/${approvalId}/deny`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decidedBy: 'user', decisionNote: 'Denied via chat' }),
          });
        } catch { /* continue */ }

        const msg = 'Hiring request denied. The agent will continue with the original approach.';
        await this.saveMessage(conversationId, 'system', msg, 'text', []);
        this.broadcast(conversationId, {
          type: 'message.new',
          message: {
            id: ulid(),
            conversation_id: conversationId,
            sender_id: 'system',
            sender_type: 'system',
            content: msg,
            content_type: 'text',
            status: 'delivered',
            created_at: new Date().toISOString(),
          },
        });

        return { message: msg };
      }

      case 'accept_task': {
        const taskId = actionPayload['task_id'] as string;
        try {
          await fetch(`${this.config.stateUrl}/api/v1/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'done' }),
          });
        } catch { /* continue */ }

        const msg = 'Task accepted and marked as complete. Great work!';
        await this.saveMessage(conversationId, 'system', msg, 'text', []);
        this.broadcast(conversationId, {
          type: 'message.new',
          message: {
            id: ulid(),
            conversation_id: conversationId,
            sender_id: 'system',
            sender_type: 'system',
            content: msg,
            content_type: 'text',
            status: 'delivered',
            created_at: new Date().toISOString(),
          },
        });

        return { message: msg };
      }

      case 'request_changes': {
        const taskId = actionPayload['task_id'] as string;
        try {
          await fetch(`${this.config.stateUrl}/api/v1/tasks/${taskId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'in_progress' }),
          });
        } catch { /* continue */ }

        const msg = 'Changes requested. The agent will continue working on the task.';
        await this.saveMessage(conversationId, 'system', msg, 'text', []);
        this.broadcast(conversationId, {
          type: 'message.new',
          message: {
            id: ulid(),
            conversation_id: conversationId,
            sender_id: 'system',
            sender_type: 'system',
            content: msg,
            content_type: 'text',
            status: 'delivered',
            created_at: new Date().toISOString(),
          },
        });

        return { message: msg };
      }

      default:
        return { message: `Unknown action type: ${actionType}` };
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers — fetch from registry
  // ---------------------------------------------------------------------------

  private async fetchAgentConfig(agentId: string): Promise<AgentConfig> {
    try {
      const res = await fetch(`${this.config.registryUrl}/api/v1/agents/${agentId}`);
      if (!res.ok) return {};
      const agent = (await res.json()) as { config?: AgentConfig };
      return agent.config ?? {};
    } catch {
      return {};
    }
  }

  private async fetchProviderKey(workspaceId: string, providerId?: string): Promise<ProviderKey> {
    try {
      if (providerId) {
        const res = await fetch(`${this.config.registryUrl}/api/v1/providers/${providerId}/key`);
        if (res.ok) return (await res.json()) as ProviderKey;
      }

      // Fallback: find default provider for workspace
      const res = await fetch(`${this.config.registryUrl}/api/v1/providers?workspaceId=${workspaceId}`);
      if (!res.ok) throw new Error('No providers found');
      const providers = (await res.json()) as Array<{ id: string; is_default?: boolean; isDefault?: boolean }>;

      const defaultProvider = providers.find(p => p.is_default || p.isDefault) ?? providers[0];
      if (!defaultProvider) throw new Error('No providers configured');

      // Fetch the real key
      const keyRes = await fetch(`${this.config.registryUrl}/api/v1/providers/${defaultProvider.id}/key`);
      if (!keyRes.ok) throw new Error('Failed to fetch API key');
      return (await keyRes.json()) as ProviderKey;
    } catch {
      throw new Error('No API key configured. Please add a model provider in Settings.');
    }
  }

  private async fetchConversationHistory(conversationId: string): Promise<Anthropic.MessageParam[]> {
    try {
      const res = await fetch(
        `${this.config.registryUrl}/api/v1/conversations/${conversationId}/messages?limit=50`,
      );
      if (!res.ok) return [];
      const messages = (await res.json()) as Array<{
        sender_type: string;
        senderType?: string;
        content: string;
      }>;

      // Convert to Anthropic format, skip the most recent user message (it's passed separately)
      const anthropicMessages: Anthropic.MessageParam[] = [];
      for (const msg of messages) {
        const senderType = msg.sender_type ?? msg.senderType;
        if (senderType === 'user') {
          anthropicMessages.push({ role: 'user', content: msg.content });
        } else if (senderType === 'agent') {
          anthropicMessages.push({ role: 'assistant', content: msg.content });
        }
        // Skip system messages in the Anthropic context
      }

      // Remove the last user message since we pass it separately
      if (anthropicMessages.length > 0 && anthropicMessages[anthropicMessages.length - 1]?.role === 'user') {
        anthropicMessages.pop();
      }

      return anthropicMessages;
    } catch {
      return [];
    }
  }

  private async saveMessage(
    conversationId: string,
    senderId: string,
    content: string,
    contentType: string,
    actionButtons: unknown[],
  ): Promise<void> {
    try {
      await fetch(`${this.config.registryUrl}/api/v1/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderId,
          senderType: senderId === 'system' ? 'system' : 'agent',
          content,
          contentType,
          actionButtons,
        }),
      });
    } catch {
      // Log but don't fail
    }
  }
}

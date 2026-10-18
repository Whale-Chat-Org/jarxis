import 'server-only';
import {
  CanonicalRequest,
  CanonicalResult,
  CanonicalStreamEvent,
  CanonicalToolCall,
  CanonicalUsage,
  ClientDialect,
  toolCallsToChat,
} from './canonical';
/* ------------------------------------------------------- client rendering */

function usageToChat(usage?: CanonicalUsage) {
  if (!usage) return undefined;
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
    ...(usage.cachedInputTokens !== undefined
      ? { prompt_tokens_details: { cached_tokens: usage.cachedInputTokens } }
      : {}),
    ...(usage.reasoningTokens !== undefined
      ? { completion_tokens_details: { reasoning_tokens: usage.reasoningTokens } }
      : {}),
  };
}

function usageToResponses(usage?: CanonicalUsage) {
  if (!usage) return undefined;
  return {
    input_tokens: usage.inputTokens,
    input_tokens_details: { cached_tokens: usage.cachedInputTokens ?? 0 },
    output_tokens: usage.outputTokens,
    output_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
    total_tokens: usage.totalTokens,
  };
}

export function renderChatCompletion(result: CanonicalResult, publicModelId: string) {
  const hasToolCalls = result.toolCalls.length > 0;
  return {
    id: result.id,
    object: 'chat.completion' as const,
    created: result.createdAt,
    model: publicModelId,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant' as const,
          content: result.text || null,
          ...(hasToolCalls ? { tool_calls: toolCallsToChat(result.toolCalls) } : {}),
        },
        finish_reason: hasToolCalls ? 'tool_calls' : result.finishReason,
      },
    ],
    ...(result.usage ? { usage: usageToChat(result.usage) } : {}),
  };
}

/** Render a completed result as a Responses object. */
export function renderResponsesResult(result: CanonicalResult, publicModelId: string) {
  const output: Record<string, unknown>[] = [];
  if (result.text) {
    output.push({
      id: `msg_${result.id}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: result.text, annotations: [] }],
    });
  }
  for (const call of result.toolCalls) {
    output.push({
      id: `fc_${call.id}`,
      type: 'function_call',
      call_id: call.id,
      name: call.name,
      arguments: call.arguments,
      status: 'completed',
    });
  }
  const incomplete = result.finishReason === 'length';
  return {
    id: result.id,
    object: 'response' as const,
    created_at: result.createdAt,
    model: publicModelId,
    status: incomplete ? ('incomplete' as const) : ('completed' as const),
    ...(incomplete ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    output,
    output_text: result.text,
    store: false,
    parallel_tool_calls: false,
    ...(result.usage ? { usage: usageToResponses(result.usage) } : {}),
  };
}

/**
 * Turn canonical stream events into client SSE payloads.
 *
 * Both dialects are stateful on the wire (Chat needs a tool-call index and a role-only first
 * delta; Responses needs monotonic `sequence_number` and item ids), so each renderer is a small
 * machine rather than a pure map.
 */
export type ClientStreamRenderer = {
  /** Events to emit for one canonical event, in order. */
  render(event: CanonicalStreamEvent): { event?: string; data: string }[];
  /** Terminal frames once the upstream stream finished cleanly. */
  finish(): { event?: string; data: string }[];
};

export function createChatStreamRenderer(
  publicModelId: string,
  options: { includeUsage?: boolean } = {},
): ClientStreamRenderer {
  let id = 'chatcmpl-unknown';
  const created = Math.floor(Date.now() / 1000);
  let roleSent = false;
  let finished = false;
  let pendingUsage: CanonicalUsage | undefined;
  // Upstream indices are content-block/output-item positions; Chat clients expect 0..n-1.
  const toolIndices = new Map<number, number>();
  const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) => ({
    data: JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model: publicModelId,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }),
  });
  const openRole = () => {
    if (roleSent) return [] as { data: string }[];
    roleSent = true;
    return [chunk({ role: 'assistant', content: '' })];
  };
  return {
    render(event) {
      switch (event.type) {
        case 'start':
          id = `chatcmpl-${event.id}`;
          return [];
        case 'text.delta':
          return [...openRole(), chunk({ content: event.text })];
        case 'tool_call.start':
          toolIndices.set(event.index, toolIndices.size);
          return [
            ...openRole(),
            chunk({
              tool_calls: [
                {
                  index: toolIndices.get(event.index),
                  id: event.id,
                  type: 'function',
                  function: { name: event.name, arguments: '' },
                },
              ],
            }),
          ];
        case 'tool_call.delta':
          if (!toolIndices.has(event.index)) return [];
          return [
            chunk({
              tool_calls: [
                {
                  index: toolIndices.get(event.index),
                  function: { arguments: event.argumentsDelta },
                },
              ],
            }),
          ];
        case 'tool_call.end':
          return [];
        case 'usage':
          pendingUsage = event.usage;
          return [];
        case 'finish': {
          finished = true;
          pendingUsage = event.usage ?? pendingUsage;
          const frames = [...openRole(), chunk({}, event.finishReason)];
          if (options.includeUsage) {
            frames.push({
              data: JSON.stringify({
                id,
                object: 'chat.completion.chunk',
                created,
                model: publicModelId,
                choices: [],
                usage: usageToChat(pendingUsage) ?? null,
              }),
            });
          }
          return frames;
        }
      }
    },
    finish() {
      const frames: { data: string }[] = [];
      if (!finished) frames.push(...openRole(), chunk({}, 'stop'));
      frames.push({ data: '[DONE]' });
      return frames;
    },
  };
}

export function createResponsesStreamRenderer(publicModelId: string): ClientStreamRenderer {
  let sequence = 0;
  let id = 'resp_unknown';
  const created = Math.floor(Date.now() / 1000);
  let text = '';
  const toolCalls = new Map<number, CanonicalToolCall>();
  const toolOutputIndices = new Map<number, number>();
  const completedTools = new Set<number>();
  const outputItems = new Map<number, Record<string, unknown>>();
  let usage: CanonicalUsage | undefined;
  let outputIndex = 0;
  let messageIndex = 0;
  let messageText = '';
  let messageOpen = false;
  let finished = false;
  const frame = (type: string, payload: Record<string, unknown>) => ({
    event: type,
    data: JSON.stringify({ type, sequence_number: sequence++, ...payload }),
  });
  const snapshot = (status: 'in_progress' | 'completed' | 'incomplete') => ({
    id,
    object: 'response',
    created_at: created,
    model: publicModelId,
    status,
    store: false,
    output: Array.from(outputItems.entries())
      .sort(([left], [right]) => left - right)
      .map(([, item]) => item),
    ...(usage ? { usage: usageToResponses(usage) } : {}),
  });
  const openMessage = () => {
    if (messageOpen) return [] as { event?: string; data: string }[];
    messageOpen = true;
    messageIndex = outputIndex++;
    messageText = '';
    return [
      frame('response.output_item.added', {
        output_index: messageIndex,
        item: {
          id: `msg_${id}_${messageIndex}`,
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      }),
      frame('response.content_part.added', {
        item_id: `msg_${id}_${messageIndex}`,
        output_index: messageIndex,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      }),
    ];
  };
  const closeMessage = () => {
    if (!messageOpen) return [] as { event?: string; data: string }[];
    messageOpen = false;
    const item = {
      id: `msg_${id}_${messageIndex}`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: messageText, annotations: [] }],
    };
    outputItems.set(messageIndex, item);
    const frames = [
      frame('response.output_text.done', {
        item_id: `msg_${id}_${messageIndex}`,
        output_index: messageIndex,
        content_index: 0,
        text: messageText,
      }),
      frame('response.content_part.done', {
        item_id: `msg_${id}_${messageIndex}`,
        output_index: messageIndex,
        content_index: 0,
        part: { type: 'output_text', text: messageText, annotations: [] },
      }),
      frame('response.output_item.done', {
        output_index: messageIndex,
        item,
      }),
    ];
    return frames;
  };
  return {
    render(event) {
      switch (event.type) {
        case 'start':
          id = `resp_${event.id}`;
          return [frame('response.created', { response: snapshot('in_progress') })];
        case 'text.delta': {
          const frames = openMessage();
          text += event.text;
          messageText += event.text;
          frames.push(
            frame('response.output_text.delta', {
              item_id: `msg_${id}_${messageIndex}`,
              output_index: messageIndex,
              content_index: 0,
              delta: event.text,
            }),
          );
          return frames;
        }
        case 'tool_call.start': {
          const frames = closeMessage();
          toolCalls.set(event.index, { id: event.id, name: event.name, arguments: '' });
          const toolIndex = outputIndex++;
          toolOutputIndices.set(event.index, toolIndex);
          frames.push(
            frame('response.output_item.added', {
              output_index: toolIndex,
              item: {
                id: `fc_${event.id}`,
                type: 'function_call',
                call_id: event.id,
                name: event.name,
                arguments: '',
                status: 'in_progress',
              },
            }),
          );
          return frames;
        }
        case 'tool_call.delta': {
          const call = toolCalls.get(event.index);
          if (!call) return [];
          call.arguments += event.argumentsDelta;
          return [
            frame('response.function_call_arguments.delta', {
              item_id: `fc_${call.id}`,
              output_index: toolOutputIndices.get(event.index),
              delta: event.argumentsDelta,
            }),
          ];
        }
        case 'tool_call.end': {
          const call = toolCalls.get(event.index);
          if (!call || completedTools.has(event.index)) return [];
          completedTools.add(event.index);
          const item = {
            id: `fc_${call.id}`,
            type: 'function_call',
            call_id: call.id,
            name: call.name,
            arguments: call.arguments,
            status: 'completed',
          };
          outputItems.set(toolOutputIndices.get(event.index)!, item);
          const frames = [
            frame('response.function_call_arguments.done', {
              item_id: `fc_${call.id}`,
              output_index: toolOutputIndices.get(event.index),
              arguments: call.arguments,
            }),
            frame('response.output_item.done', {
              output_index: toolOutputIndices.get(event.index),
              item,
            }),
          ];
          return frames;
        }
        case 'usage':
          usage = event.usage;
          return [];
        case 'finish': {
          finished = true;
          usage = event.usage ?? usage;
          const frames = closeMessage();
          const incomplete = event.finishReason === 'length';
          frames.push(
            frame(incomplete ? 'response.incomplete' : 'response.completed', {
              response: {
                ...snapshot(incomplete ? 'incomplete' : 'completed'),
                output_text: text,
                ...(incomplete ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
              },
            }),
          );
          return frames;
        }
      }
    },
    finish() {
      if (finished) return [];
      // Upstream ended without a terminal event; close the response rather than hanging.
      const frames = closeMessage();
      frames.push(
        frame('response.completed', {
          response: { ...snapshot('completed'), output_text: text },
        }),
      );
      return frames;
    },
  };
}

export function createClientStreamRenderer(
  request: CanonicalRequest,
  options: { includeUsage?: boolean } = {},
): ClientStreamRenderer {
  return request.dialect === 'chat'
    ? createChatStreamRenderer(request.publicModelId, options)
    : createResponsesStreamRenderer(request.publicModelId);
}

/** Terminal error frame for a stream that already emitted output; never leaks upstream text. */
export function renderStreamError(
  dialect: ClientDialect,
  code: string,
  message: string,
): { event?: string; data: string }[] {
  if (dialect === 'chat') {
    return [{ data: JSON.stringify({ error: { code, message } }) }, { data: '[DONE]' }];
  }
  return [
    {
      event: 'error',
      data: JSON.stringify({ type: 'error', code, message }),
    },
  ];
}

export function renderClientResult(
  dialect: ClientDialect,
  result: CanonicalResult,
  publicModelId: string,
) {
  return dialect === 'chat'
    ? renderChatCompletion(result, publicModelId)
    : renderResponsesResult(result, publicModelId);
}

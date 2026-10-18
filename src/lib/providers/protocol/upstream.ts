import 'server-only';
import { isProviderKind, providerDefinitions } from '../types';
import {
  CanonicalFinishReason,
  CanonicalRequest,
  CanonicalResult,
  CanonicalStreamEvent,
  CanonicalToolCall,
  CanonicalUsage,
  ProtocolError,
  invalid,
  joinTextParts,
  toolCallsToChat,
  unsupported,
} from './canonical';
export type UpstreamDialect = 'chat' | 'anthropic';

const wireObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const wireArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(wireObject) : [];
const wireString = (value: unknown): string => (typeof value === 'string' ? value : '');
const wireNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

function parseUsage(value: unknown, dialect: UpstreamDialect): CanonicalUsage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = wireObject(value);
  const inputTokens = wireNumber(dialect === 'chat' ? usage.prompt_tokens : usage.input_tokens);
  const outputTokens = wireNumber(
    dialect === 'chat' ? usage.completion_tokens : usage.output_tokens,
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens: wireNumber(
      wireObject(usage.input_tokens_details ?? usage.prompt_tokens_details).cached_tokens,
    ),
    reasoningTokens: wireNumber(
      wireObject(usage.output_tokens_details ?? usage.completion_tokens_details).reasoning_tokens,
    ),
  };
}

function finishReason(value: unknown): CanonicalFinishReason {
  if (value === 'length' || value === 'max_tokens' || value === 'incomplete') return 'length';
  if (value === 'tool_calls' || value === 'tool_use') return 'tool_calls';
  if (value === 'content_filter') return 'content_filter';
  return 'stop';
}

export function parseUpstreamResult(value: unknown, dialect: UpstreamDialect): CanonicalResult {
  const response = wireObject(value);
  if (response.error) throw new ProtocolError('UPSTREAM_PROTOCOL', 'Upstream returned an error');
  let text = '';
  const toolCalls: CanonicalToolCall[] = [];
  let reason: unknown;
  if (dialect === 'chat') {
    const choices = wireArray(response.choices);
    if (choices.length !== 1)
      throw new ProtocolError('UPSTREAM_PROTOCOL', 'Invalid upstream completion');
    const message = wireObject(choices[0].message);
    text = wireString(message.content);
    for (const call of wireArray(message.tool_calls)) {
      const fn = wireObject(call.function);
      toolCalls.push({
        id: wireString(call.id),
        name: wireString(fn.name),
        arguments: wireString(fn.arguments),
      });
    }
    reason = choices[0].finish_reason;
  } else if (dialect === 'anthropic') {
    if (!Array.isArray(response.content))
      throw new ProtocolError('UPSTREAM_PROTOCOL', 'Invalid upstream message');
    for (const block of wireArray(response.content)) {
      if (block.type === 'text') text += wireString(block.text);
      else if (block.type === 'tool_use')
        toolCalls.push({
          id: wireString(block.id),
          name: wireString(block.name),
          arguments: JSON.stringify(block.input ?? {}),
        });
      else throw new ProtocolError('UPSTREAM_PROTOCOL', 'Unsupported upstream content');
    }
    reason = response.stop_reason;
  }
  return {
    id: wireString(response.id) || crypto.randomUUID(),
    model: wireString(response.model),
    createdAt: wireNumber(response.created_at ?? response.created) || Math.floor(Date.now() / 1000),
    text,
    toolCalls,
    finishReason: finishReason(reason),
    usage: parseUsage(response.usage, dialect),
  };
}

export function createUpstreamStreamParser(dialect: UpstreamDialect) {
  let usage: CanonicalUsage | undefined;
  let reason: CanonicalFinishReason = 'stop';
  let terminal = false;
  let started = false;
  const tools = new Map<number, CanonicalToolCall>();
  return {
    get completed() {
      return terminal;
    },
    parse(data: string): CanonicalStreamEvent[] {
      if (data === '[DONE]') {
        if (dialect !== 'chat')
          throw new ProtocolError('UPSTREAM_PROTOCOL', 'Unexpected stream termination');
        terminal = true;
        return [
          ...Array.from(tools.keys(), (index) => ({ type: 'tool_call.end' as const, index })),
          { type: 'finish', finishReason: reason, usage },
        ];
      }
      const payload = wireObject(JSON.parse(data));
      const events: CanonicalStreamEvent[] = [];
      if (payload.error || payload.type === 'error' || payload.type === 'response.failed')
        throw new ProtocolError('UPSTREAM_PROTOCOL', 'Upstream stream failed');
      if (dialect === 'chat') {
        if (!started) {
          started = true;
          events.push({
            type: 'start',
            id: wireString(payload.id),
            model: wireString(payload.model),
          });
        }
        usage = parseUsage(payload.usage, dialect) ?? usage;
        for (const choice of wireArray(payload.choices)) {
          const delta = wireObject(choice.delta);
          if (delta.content) events.push({ type: 'text.delta', text: wireString(delta.content) });
          for (const call of wireArray(delta.tool_calls)) {
            const index = wireNumber(call.index);
            const fn = wireObject(call.function);
            if (!tools.has(index)) {
              const tool = { id: wireString(call.id), name: wireString(fn.name), arguments: '' };
              if (!tool.id || !tool.name)
                throw new ProtocolError('UPSTREAM_PROTOCOL', 'Invalid stream tool');
              tools.set(index, tool);
              events.push({ type: 'tool_call.start', index, ...tool });
            }
            if (fn.arguments)
              events.push({
                type: 'tool_call.delta',
                index,
                argumentsDelta: wireString(fn.arguments),
              });
          }
          if (choice.finish_reason) reason = finishReason(choice.finish_reason);
        }
      } else if (dialect === 'anthropic') {
        const index = wireNumber(payload.index);
        if (payload.type === 'message_start') {
          const message = wireObject(payload.message);
          usage = parseUsage(message.usage, dialect);
          events.push({
            type: 'start',
            id: wireString(message.id),
            model: wireString(message.model),
          });
        } else if (payload.type === 'content_block_start') {
          const block = wireObject(payload.content_block);
          if (block.type === 'tool_use') {
            tools.set(index, {
              id: wireString(block.id),
              name: wireString(block.name),
              arguments: '',
            });
            events.push({
              type: 'tool_call.start',
              index,
              id: wireString(block.id),
              name: wireString(block.name),
            });
          } else if (block.type === 'text' && block.text)
            events.push({ type: 'text.delta', text: wireString(block.text) });
          else if (block.type !== 'text')
            throw new ProtocolError('UPSTREAM_PROTOCOL', 'Unsupported stream block');
        } else if (payload.type === 'content_block_delta') {
          const delta = wireObject(payload.delta);
          if (delta.type === 'text_delta')
            events.push({ type: 'text.delta', text: wireString(delta.text) });
          else if (delta.type === 'input_json_delta')
            events.push({
              type: 'tool_call.delta',
              index,
              argumentsDelta: wireString(delta.partial_json),
            });
          else throw new ProtocolError('UPSTREAM_PROTOCOL', 'Unsupported stream delta');
        } else if (payload.type === 'content_block_stop' && tools.has(index))
          events.push({ type: 'tool_call.end', index });
        else if (payload.type === 'message_delta') {
          reason = finishReason(wireObject(payload.delta).stop_reason);
          const outputTokens = wireNumber(wireObject(payload.usage).output_tokens);
          usage = {
            ...usage,
            inputTokens: usage?.inputTokens ?? 0,
            outputTokens,
            totalTokens: (usage?.inputTokens ?? 0) + outputTokens,
          };
        } else if (payload.type === 'message_stop') {
          terminal = true;
          events.push({ type: 'finish', finishReason: reason, usage });
        }
      }
      return events;
    },
  };
}

export function upstreamDialect(provider: string): UpstreamDialect {
  return isProviderKind(provider) ? providerDefinitions[provider].dialect : 'chat';
}

export function renderUpstreamRequest(
  request: CanonicalRequest,
  provider: string,
): Record<string, unknown> {
  const dialect = upstreamDialect(provider);
  if (
    request.messages.some(
      (message) => message.role === 'user' && message.content.some((part) => part.type === 'image'),
    )
  )
    unsupported('Image input is not supported by this gateway');
  const common = { model: request.model, stream: request.stream };
  const choice = request.toolChoice;
  if (dialect === 'anthropic') {
    if (request.responseFormat && request.responseFormat.kind !== 'text')
      unsupported('Structured output is unsupported on Anthropic');
    if (request.user) unsupported('User attribution is unsupported on Anthropic');
    if (request.tools.some((tool) => tool.strict !== undefined))
      unsupported('Strict tools are unsupported on Anthropic');
    if (request.temperature !== undefined && request.temperature > 1)
      unsupported('Anthropic temperature must be at most 1');
    const turns = request.messages.map((message) => {
      if (message.role === 'tool')
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.result.toolCallId,
              content: message.result.content,
            },
          ],
        };
      if (message.role === 'system') return { role: 'user', content: message.content };
      const content: unknown[] = message.content;
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: [
            ...content,
            ...message.toolCalls.map((call) => {
              let input: unknown;
              try {
                input = JSON.parse(call.arguments);
              } catch {
                return invalid('Tool arguments must be valid JSON');
              }
              if (!input || typeof input !== 'object' || Array.isArray(input))
                invalid('Tool arguments must be a JSON object');
              return { type: 'tool_use', id: call.id, name: call.name, input };
            }),
          ],
        };
      }
      return { role: 'user', content };
    });
    // Anthropic wants every tool_result for a turn in one user message and rejects empty text blocks.
    const messages: { role: string; content: unknown[] }[] = [];
    for (const turn of turns) {
      const content = (turn.content as { type?: string; text?: string }[]).filter(
        (part) => part.type !== 'text' || part.text,
      );
      const previous = messages.at(-1);
      if (previous?.role === turn.role) previous.content.push(...content);
      else messages.push({ role: turn.role, content });
    }
    return {
      ...common,
      max_tokens: request.maxOutputTokens ?? 4096,
      messages,
      ...(request.system.length ? { system: request.system.join('\n\n') } : {}),
      ...(request.tools.length && choice?.kind !== 'none'
        ? {
            tools: request.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters,
            })),
          }
        : {}),
      ...(choice && choice.kind !== 'none'
        ? {
            tool_choice: {
              type:
                choice.kind === 'required' ? 'any' : choice.kind === 'function' ? 'tool' : 'auto',
              ...(choice.kind === 'function' ? { name: choice.name } : {}),
              ...(request.parallelToolCalls !== undefined
                ? { disable_parallel_tool_use: !request.parallelToolCalls }
                : {}),
            },
          }
        : request.parallelToolCalls !== undefined && request.tools.length
          ? { tool_choice: { type: 'auto', disable_parallel_tool_use: !request.parallelToolCalls } }
          : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { top_p: request.topP } : {}),
      ...(request.stop ? { stop_sequences: request.stop } : {}),
    };
  }
  const tools = request.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    },
  }));
  const toolChoice =
    choice?.kind === 'function'
      ? { type: 'function', function: { name: choice.name } }
      : choice?.kind;
  const options = {
    ...(tools.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(request.parallelToolCalls !== undefined
      ? { parallel_tool_calls: request.parallelToolCalls }
      : {}),
  };
  const messages = [
    ...request.system.map((content) => ({ role: 'system', content })),
    ...request.messages.map((message) =>
      message.role === 'tool'
        ? { role: 'tool', tool_call_id: message.result.toolCallId, content: message.result.content }
        : {
            role: message.role,
            content: joinTextParts(message.content),
            ...(message.role === 'assistant' && message.toolCalls.length
              ? { tool_calls: toolCallsToChat(message.toolCalls) }
              : {}),
          },
    ),
  ];
  const format = request.responseFormat;
  return {
    ...common,
    messages,
    ...options,
    ...(request.stream ? { stream_options: { include_usage: true } } : {}),
    ...(request.maxOutputTokens !== undefined
      ? { max_completion_tokens: request.maxOutputTokens }
      : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(request.topP !== undefined ? { top_p: request.topP } : {}),
    ...(request.stop ? { stop: request.stop } : {}),
    ...(request.user ? { user: request.user } : {}),
    ...(format
      ? {
          response_format:
            format.kind === 'json_schema'
              ? {
                  type: 'json_schema',
                  json_schema: { name: format.name, schema: format.schema, strict: format.strict },
                }
              : { type: format.kind },
        }
      : {}),
  };
}

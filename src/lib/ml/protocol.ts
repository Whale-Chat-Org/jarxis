import 'server-only';
import { z } from 'zod';

/**
 * Wire translation for the gateway.
 *
 * The gateway speaks two client dialects (OpenAI Chat Completions and OpenAI Responses) and three
 * upstream dialects (OpenAI-compatible Chat, OpenAI Responses including the Codex backend, and
 * native Anthropic Messages). Rather than translating N x M, every request is parsed into a
 * canonical form here and each adapter renders that canonical form, both for the request and for
 * the response and stream events.
 *
 * Two rules drive the shape of this file:
 *   - Nothing unknown is forwarded. Schemas are strict, so an option we do not understand is a
 *     400 rather than a silently dropped or silently proxied field.
 *   - Capability gaps are explicit. Anything a target provider cannot honour (audio parts,
 *     stateful Responses options, logprobs on Anthropic, ...) is rejected with a precise message.
 */

export class ProtocolError extends Error {
  constructor(
    readonly code: 'INVALID_REQUEST' | 'UNSUPPORTED' | 'UPSTREAM_PROTOCOL',
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolError';
  }
}

const invalid = (message: string): never => {
  throw new ProtocolError('INVALID_REQUEST', message);
};
const unsupported = (message: string): never => {
  throw new ProtocolError('UNSUPPORTED', message);
};

/* ------------------------------------------------------------------ canonical */

export type CanonicalTextPart = { type: 'text'; text: string };
export type CanonicalImagePart = { type: 'image'; url: string; detail?: 'auto' | 'low' | 'high' };
export type CanonicalToolCall = {
  id: string;
  name: string;
  /** Raw JSON string of the arguments, exactly as the model produced it. */
  arguments: string;
};
export type CanonicalToolResult = { toolCallId: string; content: string; isError?: boolean };

export type CanonicalMessage =
  | { role: 'system'; content: CanonicalTextPart[] }
  | {
      role: 'user';
      content: (CanonicalTextPart | CanonicalImagePart)[];
    }
  | { role: 'assistant'; content: CanonicalTextPart[]; toolCalls: CanonicalToolCall[] }
  | { role: 'tool'; result: CanonicalToolResult };

export type CanonicalTool = {
  name: string;
  strict?: boolean;
  description?: string;
  parameters: Record<string, unknown>;
};

export type CanonicalToolChoice =
  { kind: 'auto' } | { kind: 'none' } | { kind: 'required' } | { kind: 'function'; name: string };

export type CanonicalResponseFormat =
  | { kind: 'text' }
  | { kind: 'json_object' }
  | { kind: 'json_schema'; name: string; schema: Record<string, unknown>; strict?: boolean };

/** Client dialect the response must be rendered back into. */
export type ClientDialect = 'chat' | 'responses';

export type CanonicalRequest = {
  dialect: ClientDialect;
  /** Provider-qualified id as the client sent it, e.g. `openai/gpt-5`. */
  publicModel: string;
  /** Upstream id with the provider prefix stripped. */
  model: string;
  system: string[];
  messages: CanonicalMessage[];
  tools: CanonicalTool[];
  toolChoice?: CanonicalToolChoice;
  parallelToolCalls?: boolean;
  responseFormat?: CanonicalResponseFormat;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stop?: string[];
  stream: boolean;
  /** Echoed back to the client; never forwarded upstream. */
  metadata?: Record<string, string>;
  user?: string;
};

export type CanonicalUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

export type CanonicalFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error';

export type CanonicalResult = {
  id: string;
  model: string;
  createdAt: number;
  text: string;
  toolCalls: CanonicalToolCall[];
  finishReason: CanonicalFinishReason;
  usage?: CanonicalUsage;
};

/** Provider-neutral stream events; adapters normalise into these and renderers consume them. */
export type CanonicalStreamEvent =
  | { type: 'start'; id: string; model: string }
  | { type: 'text.delta'; text: string }
  | { type: 'tool_call.start'; index: number; id: string; name: string }
  | { type: 'tool_call.delta'; index: number; argumentsDelta: string }
  | { type: 'tool_call.end'; index: number }
  | { type: 'finish'; finishReason: CanonicalFinishReason; usage?: CanonicalUsage }
  | { type: 'usage'; usage: CanonicalUsage };

/* ------------------------------------------------------- client request parsing */

const textContentPart = z
  .object({ type: z.literal('text'), text: z.string() })
  .strict()
  .transform((part): CanonicalTextPart => ({ type: 'text', text: part.text }));

const imageUrlPart = z
  .object({
    type: z.literal('image_url'),
    image_url: z
      .object({ url: z.string(), detail: z.enum(['auto', 'low', 'high']).optional() })
      .strict(),
  })
  .strict()
  .transform((part): CanonicalImagePart => ({
    type: 'image',
    url: part.image_url.url,
    detail: part.image_url.detail,
  }));

const chatUserContent = z.union([
  z
    .string()
    .transform((text): (CanonicalTextPart | CanonicalImagePart)[] => [{ type: 'text', text }]),
  z.array(z.union([textContentPart, imageUrlPart])).min(1),
]);

const chatTextOnlyContent = z.union([
  z.string().transform((text): CanonicalTextPart[] => (text ? [{ type: 'text', text }] : [])),
  z.array(textContentPart),
]);

const chatToolCall = z
  .object({
    id: z.string().min(1),
    type: z.literal('function'),
    function: z.object({ name: z.string().min(1), arguments: z.string() }).strict(),
  })
  .strict()
  .transform((call): CanonicalToolCall => ({
    id: call.id,
    name: call.function.name,
    arguments: call.function.arguments || '{}',
  }));

const chatMessage = z.union([
  z
    .object({ role: z.enum(['system', 'developer']), content: chatTextOnlyContent })
    .strict()
    .transform((message): CanonicalMessage => ({ role: 'system', content: message.content })),
  z
    .object({ role: z.literal('user'), content: chatUserContent, name: z.string().optional() })
    .strict()
    .transform((message): CanonicalMessage => ({ role: 'user', content: message.content })),
  z
    .object({
      role: z.literal('assistant'),
      content: chatTextOnlyContent.nullish(),
      tool_calls: z.array(chatToolCall).optional(),
    })
    .strict()
    .transform((message): CanonicalMessage => ({
      role: 'assistant',
      content: message.content ?? [],
      toolCalls: message.tool_calls ?? [],
    })),
  z
    .object({
      role: z.literal('tool'),
      tool_call_id: z.string().min(1),
      content: z.union([z.string(), z.array(textContentPart)]),
    })
    .strict()
    .transform((message): CanonicalMessage => ({
      role: 'tool',
      result: {
        toolCallId: message.tool_call_id,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map((part) => part.text).join('\n'),
      },
    })),
]);

const jsonObject = z.record(z.string(), z.unknown());

const chatTool = z
  .object({
    type: z.literal('function'),
    function: z
      .object({
        name: z.string().min(1).max(64),
        description: z.string().max(4096).optional(),
        parameters: jsonObject.optional(),
        strict: z.boolean().nullish(),
      })
      .strict(),
  })
  .strict()
  .transform((tool): CanonicalTool => ({
    name: tool.function.name,
    strict: tool.function.strict ?? undefined,
    description: tool.function.description,
    parameters: tool.function.parameters ?? { type: 'object', properties: {} },
  }));

const chatToolChoice = z.union([
  z
    .enum(['auto', 'none', 'required'])
    .transform((choice): CanonicalToolChoice =>
      choice === 'auto'
        ? { kind: 'auto' }
        : choice === 'none'
          ? { kind: 'none' }
          : { kind: 'required' },
    ),
  z
    .object({
      type: z.literal('function'),
      function: z.object({ name: z.string().min(1) }).strict(),
    })
    .strict()
    .transform((choice): CanonicalToolChoice => ({ kind: 'function', name: choice.function.name })),
]);

const responseFormat = z.union([
  z
    .object({ type: z.literal('text') })
    .strict()
    .transform((): CanonicalResponseFormat => ({ kind: 'text' })),
  z
    .object({ type: z.literal('json_object') })
    .strict()
    .transform((): CanonicalResponseFormat => ({ kind: 'json_object' })),
  z
    .object({
      type: z.literal('json_schema'),
      json_schema: z
        .object({
          name: z.string().min(1),
          schema: jsonObject,
          strict: z.boolean().nullish(),
          description: z.string().optional(),
        })
        .strict(),
    })
    .strict()
    .transform((format): CanonicalResponseFormat => ({
      kind: 'json_schema',
      name: format.json_schema.name,
      schema: format.json_schema.schema,
      strict: format.json_schema.strict ?? undefined,
    })),
]);

const stopSequences = z
  .union([z.string(), z.array(z.string()).max(4)])
  .transform((stop) => (typeof stop === 'string' ? [stop] : stop));

const metadataRecord = z.record(z.string().max(64), z.string().max(512));

/**
 * Chat Completions request. `.strict()` is the security control: `logit_bias`, `seed`,
 * `service_tier`, `store`, `functions` and friends are rejected rather than forwarded, so no
 * unreviewed field ever reaches a provider.
 */
export const chatCompletionsRequest = z
  .object({
    model: z.string().min(1).max(512),
    messages: z.array(chatMessage).min(1).max(512),
    tools: z.array(chatTool).max(128).optional(),
    tool_choice: chatToolChoice.optional(),
    parallel_tool_calls: z.boolean().optional(),
    response_format: responseFormat.optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    max_tokens: z.number().int().min(1).max(1_000_000).optional(),
    max_completion_tokens: z.number().int().min(1).max(1_000_000).optional(),
    stop: stopSequences.optional(),
    stream: z.boolean().optional(),
    stream_options: z.object({ include_usage: z.boolean().optional() }).strict().optional(),
    metadata: metadataRecord.optional(),
    user: z.string().max(256).optional(),
    n: z.literal(1).optional(),
  })
  .strict();

const responsesInputText = z
  .object({ type: z.enum(['input_text', 'text']), text: z.string() })
  .strict();
const responsesInputImage = z
  .object({
    type: z.literal('input_image'),
    image_url: z.string(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  })
  .strict();
const responsesOutputText = z
  .object({
    type: z.literal('output_text'),
    text: z.string(),
    annotations: z.array(z.unknown()).optional(),
  })
  .strict();

const responsesMessageItem = z
  .object({
    type: z.literal('message').optional(),
    role: z.enum(['system', 'developer', 'user', 'assistant']),
    content: z.union([
      z.string(),
      z.array(z.union([responsesInputText, responsesInputImage, responsesOutputText])),
    ]),
  })
  .strict();

const responsesFunctionCallItem = z
  .object({
    type: z.literal('function_call'),
    call_id: z.string().min(1),
    name: z.string().min(1),
    arguments: z.string(),
    id: z.string().optional(),
    status: z.enum(['in_progress', 'completed', 'incomplete']).optional(),
  })
  .strict();

const responsesFunctionOutputItem = z
  .object({
    type: z.literal('function_call_output'),
    call_id: z.string().min(1),
    output: z.union([z.string(), z.array(responsesInputText)]),
    id: z.string().optional(),
    status: z.enum(['in_progress', 'completed', 'incomplete']).optional(),
  })
  .strict();

const responsesInputItem = z.union([
  responsesMessageItem,
  responsesFunctionCallItem,
  responsesFunctionOutputItem,
]);

const responsesTool = z
  .object({
    type: z.literal('function'),
    name: z.string().min(1).max(64),
    description: z.string().max(4096).nullish(),
    parameters: jsonObject.nullish(),
    strict: z.boolean().nullish(),
  })
  .strict()
  .transform((tool): CanonicalTool => ({
    name: tool.name,
    strict: tool.strict ?? undefined,
    description: tool.description ?? undefined,
    parameters: tool.parameters ?? { type: 'object', properties: {} },
  }));

const responsesToolChoice = z.union([
  z
    .enum(['auto', 'none', 'required'])
    .transform((choice): CanonicalToolChoice =>
      choice === 'auto'
        ? { kind: 'auto' }
        : choice === 'none'
          ? { kind: 'none' }
          : { kind: 'required' },
    ),
  z
    .object({ type: z.literal('function'), name: z.string().min(1) })
    .strict()
    .transform((choice): CanonicalToolChoice => ({ kind: 'function', name: choice.name })),
]);

const responsesTextOptions = z
  .object({
    format: z
      .union([
        z.object({ type: z.literal('text') }).strict(),
        z.object({ type: z.literal('json_object') }).strict(),
        z
          .object({
            type: z.literal('json_schema'),
            name: z.string().min(1),
            schema: jsonObject,
            strict: z.boolean().nullish(),
            description: z.string().optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

/**
 * Responses request. The gateway is stateless by design, so `previous_response_id`,
 * `conversation`, `store: true`, `background`, built-in tools and `include` are refused rather
 * than approximated.
 */
export const responsesRequest = z
  .object({
    model: z.string().min(1).max(512),
    input: z.union([z.string(), z.array(responsesInputItem).min(1).max(512)]),
    instructions: z.string().max(100_000).nullish(),
    tools: z.array(responsesTool).max(128).optional(),
    tool_choice: responsesToolChoice.optional(),
    parallel_tool_calls: z.boolean().nullish(),
    text: responsesTextOptions.optional(),
    temperature: z.number().min(0).max(2).nullish(),
    top_p: z.number().min(0).max(1).nullish(),
    max_output_tokens: z.number().int().min(1).max(1_000_000).nullish(),
    stream: z.boolean().optional(),
    store: z.literal(false).optional(),
    metadata: metadataRecord.nullish(),
    user: z.string().max(256).optional(),
  })
  .strict();

/** Options accepted by the schema but refused per target; keeps rejection messages precise. */
const STATEFUL_RESPONSES_FIELDS = [
  'previous_response_id',
  'conversation',
  'background',
  'include',
  'truncation',
  'reasoning',
  'prompt',
  'prompt_cache_key',
  'safety_identifier',
  'service_tier',
  'top_logprobs',
  'logprobs',
  'max_tool_calls',
] as const;

const UNSUPPORTED_CHAT_FIELDS = [
  'functions',
  'function_call',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'seed',
  'service_tier',
  'store',
  'audio',
  'modalities',
  'prediction',
  'web_search_options',
  'reasoning_effort',
  'frequency_penalty',
  'presence_penalty',
] as const;

/** Produce the precise message before Zod's generic "unrecognized key" output reaches the client. */
function rejectKnownUnsupported(payload: Record<string, unknown>, dialect: ClientDialect) {
  const banned = dialect === 'chat' ? UNSUPPORTED_CHAT_FIELDS : STATEFUL_RESPONSES_FIELDS;
  for (const field of banned) {
    if (payload[field] === undefined || payload[field] === null) continue;
    unsupported(`\`${field}\` is not supported by this gateway`);
  }
  if (dialect === 'responses' && payload.store === true) {
    unsupported('`store` must be false: the gateway does not persist responses');
  }
  if (dialect === 'chat' && payload.n !== undefined && payload.n !== 1) {
    unsupported('`n` must be 1: the gateway returns a single choice');
  }
  if (dialect === 'responses' && Array.isArray(payload.tools)) {
    for (const tool of payload.tools as { type?: unknown }[]) {
      if (tool && typeof tool === 'object' && tool.type !== 'function') {
        unsupported('Only function tools are supported; built-in provider tools are rejected');
      }
    }
  }
}

function assertUniqueToolNames(tools: CanonicalTool[]) {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (!/^[A-Za-z0-9_.-]+$/.test(tool.name)) invalid(`Tool name \`${tool.name}\` is not valid`);
    if (seen.has(tool.name)) invalid(`Duplicate tool name \`${tool.name}\``);
    seen.add(tool.name);
  }
}

function assertImageUrl(url: string) {
  if (url.startsWith('data:image/')) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return invalid('Image URL must be an absolute https URL or a data:image/* URL');
  }
  if (parsed.protocol !== 'https:') {
    invalid('Image URL must use https or be an inline data:image/* URL');
  }
}

function validateCanonical(request: CanonicalRequest) {
  assertUniqueToolNames(request.tools);
  if (request.toolChoice?.kind === 'function') {
    const name = request.toolChoice.name;
    if (!request.tools.some((tool) => tool.name === name)) {
      invalid(`\`tool_choice\` names tool \`${name}\`, which is not in \`tools\``);
    }
  }
  if (request.toolChoice && request.toolChoice.kind !== 'none' && !request.tools.length) {
    invalid('`tool_choice` requires at least one tool');
  }
  const callIds = new Set<string>();
  for (const message of request.messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls) callIds.add(call.id);
    }
    if (message.role === 'tool' && !callIds.has(message.result.toolCallId)) {
      invalid(
        `Tool result references unknown tool call \`${message.result.toolCallId}\`; the matching assistant tool call must come first`,
      );
    }
    if (message.role === 'user') {
      for (const part of message.content) if (part.type === 'image') assertImageUrl(part.url);
    }
  }
  if (!request.messages.some((message) => message.role !== 'system')) {
    invalid('At least one non-system message is required');
  }
}

function splitModel(model: string): { provider: string; upstreamId: string } {
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) {
    invalid('`model` must be provider qualified, e.g. `openai/gpt-5`');
  }
  return { provider: model.slice(0, slash), upstreamId: model.slice(slash + 1) };
}

/** Parse a Chat Completions payload into the canonical request. */
export function parseChatRequest(payload: unknown): CanonicalRequest {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    invalid('Request body must be a JSON object');
  }
  rejectKnownUnsupported(payload as Record<string, unknown>, 'chat');
  const parsed = chatCompletionsRequest.parse(payload);
  if (parsed.max_tokens !== undefined && parsed.max_completion_tokens !== undefined) {
    invalid('Provide either `max_tokens` or `max_completion_tokens`, not both');
  }
  const { upstreamId } = splitModel(parsed.model);
  const system: string[] = [];
  const messages: CanonicalMessage[] = [];
  for (const message of parsed.messages) {
    if (message.role === 'system') {
      const text = message.content.map((part) => part.text).join('\n');
      if (text) system.push(text);
      continue;
    }
    messages.push(message);
  }
  const request: CanonicalRequest = {
    dialect: 'chat',
    publicModel: parsed.model,
    model: upstreamId,
    system,
    messages,
    tools: parsed.tools ?? [],
    toolChoice: parsed.tool_choice,
    parallelToolCalls: parsed.parallel_tool_calls,
    responseFormat: parsed.response_format,
    temperature: parsed.temperature,
    topP: parsed.top_p,
    maxOutputTokens: parsed.max_completion_tokens ?? parsed.max_tokens,
    stop: parsed.stop,
    stream: parsed.stream ?? false,
    metadata: parsed.metadata,
    user: parsed.user,
  };
  validateCanonical(request);
  return request;
}

/** Parse a Responses payload into the canonical request. */
export function parseResponsesRequest(payload: unknown): CanonicalRequest {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    invalid('Request body must be a JSON object');
  }
  rejectKnownUnsupported(payload as Record<string, unknown>, 'responses');
  const parsed = responsesRequest.parse(payload);
  const { upstreamId } = splitModel(parsed.model);
  const system: string[] = [];
  if (parsed.instructions) system.push(parsed.instructions);
  const messages: CanonicalMessage[] = [];
  const items =
    typeof parsed.input === 'string'
      ? [{ role: 'user' as const, content: parsed.input }]
      : parsed.input;
  for (const item of items) {
    if ('type' in item && item.type === 'function_call') {
      const previous = messages[messages.length - 1];
      const call: CanonicalToolCall = {
        id: item.call_id,
        name: item.name,
        arguments: item.arguments || '{}',
      };
      // Consecutive function calls belong to one assistant turn.
      if (previous?.role === 'assistant') previous.toolCalls.push(call);
      else messages.push({ role: 'assistant', content: [], toolCalls: [call] });
      continue;
    }
    if ('type' in item && item.type === 'function_call_output') {
      messages.push({
        role: 'tool',
        result: {
          toolCallId: item.call_id,
          content:
            typeof item.output === 'string'
              ? item.output
              : item.output.map((part) => part.text).join('\n'),
        },
      });
      continue;
    }
    const message = item as z.infer<typeof responsesMessageItem>;
    const parts =
      typeof message.content === 'string'
        ? [{ type: 'input_text' as const, text: message.content }]
        : message.content;
    if (message.role === 'system' || message.role === 'developer') {
      const text = parts
        .map((part) => ('text' in part ? part.text : ''))
        .filter(Boolean)
        .join('\n');
      if (text) system.push(text);
      continue;
    }
    if (message.role === 'assistant') {
      const text = parts
        .map((part) => ('text' in part ? part.text : ''))
        .filter(Boolean)
        .join('\n');
      messages.push({
        role: 'assistant',
        content: text ? [{ type: 'text', text }] : [],
        toolCalls: [],
      });
      continue;
    }
    const content: (CanonicalTextPart | CanonicalImagePart)[] = [];
    for (const part of parts) {
      if (part.type === 'input_image') {
        content.push({ type: 'image', url: part.image_url, detail: part.detail });
        continue;
      }
      if (part.type === 'output_text') {
        invalid('`output_text` is only valid on assistant items');
      }
      content.push({ type: 'text', text: part.text });
    }
    if (!content.length) invalid('User input items must contain content');
    messages.push({ role: 'user', content });
  }
  const format = parsed.text?.format;
  const responseFormat: CanonicalResponseFormat | undefined = !format
    ? undefined
    : format.type === 'text'
      ? { kind: 'text' }
      : format.type === 'json_object'
        ? { kind: 'json_object' }
        : {
            kind: 'json_schema',
            name: format.name,
            schema: format.schema,
            strict: format.strict ?? undefined,
          };
  const request: CanonicalRequest = {
    dialect: 'responses',
    publicModel: parsed.model,
    model: upstreamId,
    system,
    messages,
    tools: parsed.tools ?? [],
    toolChoice: parsed.tool_choice,
    parallelToolCalls: parsed.parallel_tool_calls ?? undefined,
    responseFormat,
    temperature: parsed.temperature ?? undefined,
    topP: parsed.top_p ?? undefined,
    maxOutputTokens: parsed.max_output_tokens ?? undefined,
    stream: parsed.stream ?? false,
    metadata: parsed.metadata ?? undefined,
    user: parsed.user,
  };
  validateCanonical(request);
  return request;
}

export function parseGatewayRequest(dialect: ClientDialect, payload: unknown): CanonicalRequest {
  return dialect === 'chat' ? parseChatRequest(payload) : parseResponsesRequest(payload);
}

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

function toolCallsToChat(toolCalls: CanonicalToolCall[]) {
  return toolCalls.map((call) => ({
    id: call.id,
    type: 'function' as const,
    function: { name: call.name, arguments: call.arguments },
  }));
}

/** Render a completed result as a Chat Completions object. */
export function renderChatCompletion(result: CanonicalResult, publicModel: string) {
  const hasToolCalls = result.toolCalls.length > 0;
  return {
    id: result.id,
    object: 'chat.completion' as const,
    created: result.createdAt,
    model: publicModel,
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
export function renderResponsesResult(result: CanonicalResult, publicModel: string) {
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
    model: publicModel,
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
  publicModel: string,
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
      model: publicModel,
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
                model: publicModel,
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

export function createResponsesStreamRenderer(publicModel: string): ClientStreamRenderer {
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
    model: publicModel,
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
    ? createChatStreamRenderer(request.publicModel, options)
    : createResponsesStreamRenderer(request.publicModel);
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

export type UpstreamDialect = 'chat' | 'responses' | 'anthropic';

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
  } else {
    if (
      !Array.isArray(response.output) ||
      !['completed', 'incomplete'].includes(wireString(response.status))
    )
      throw new ProtocolError('UPSTREAM_PROTOCOL', 'Invalid upstream response');
    for (const item of wireArray(response.output)) {
      if (item.type === 'message')
        for (const part of wireArray(item.content)) {
          if (part.type !== 'output_text')
            throw new ProtocolError('UPSTREAM_PROTOCOL', 'Unsupported upstream content');
          text += wireString(part.text);
        }
      else if (item.type === 'function_call')
        toolCalls.push({
          id: wireString(item.call_id),
          name: wireString(item.name),
          arguments: wireString(item.arguments),
        });
      else if (item.type !== 'reasoning')
        throw new ProtocolError('UPSTREAM_PROTOCOL', 'Unsupported upstream output');
    }
    reason = response.status === 'incomplete' ? 'length' : toolCalls.length ? 'tool_calls' : 'stop';
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
      } else {
        const index = wireNumber(payload.output_index);
        if (payload.type === 'response.created') {
          const response = wireObject(payload.response);
          events.push({
            type: 'start',
            id: wireString(response.id),
            model: wireString(response.model),
          });
        } else if (payload.type === 'response.output_text.delta')
          events.push({ type: 'text.delta', text: wireString(payload.delta) });
        else if (payload.type === 'response.output_item.added') {
          const item = wireObject(payload.item);
          if (item.type === 'function_call') {
            tools.set(index, {
              id: wireString(item.call_id),
              name: wireString(item.name),
              arguments: '',
            });
            events.push({
              type: 'tool_call.start',
              index,
              id: wireString(item.call_id),
              name: wireString(item.name),
            });
          }
        } else if (payload.type === 'response.function_call_arguments.delta')
          events.push({
            type: 'tool_call.delta',
            index,
            argumentsDelta: wireString(payload.delta),
          });
        else if (payload.type === 'response.output_item.done' && tools.has(index))
          events.push({ type: 'tool_call.end', index });
        else if (payload.type === 'response.completed' || payload.type === 'response.incomplete') {
          terminal = true;
          const response = wireObject(payload.response);
          events.push({
            type: 'finish',
            finishReason:
              payload.type === 'response.incomplete'
                ? 'length'
                : tools.size
                  ? 'tool_calls'
                  : 'stop',
            usage: parseUsage(response.usage, dialect),
          });
        }
      }
      return events;
    },
  };
}

export function upstreamDialect(provider: string): UpstreamDialect {
  return provider === 'codex'
    ? 'responses'
    : provider === 'anthropic' || provider === 'claude'
      ? 'anthropic'
      : 'chat';
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
  const tools = request.tools.map((tool) =>
    dialect === 'chat'
      ? {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
          },
        }
      : {
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
        },
  );
  const toolChoice =
    choice?.kind === 'function'
      ? dialect === 'chat'
        ? { type: 'function', function: { name: choice.name } }
        : { type: 'function', name: choice.name }
      : choice?.kind;
  const options = {
    ...(tools.length ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
    ...(request.parallelToolCalls !== undefined
      ? { parallel_tool_calls: request.parallelToolCalls }
      : {}),
  };
  if (dialect === 'responses') {
    if (
      request.stop ||
      request.temperature !== undefined ||
      request.topP !== undefined ||
      request.maxOutputTokens !== undefined ||
      request.user ||
      (request.responseFormat?.kind !== undefined && request.responseFormat.kind !== 'text')
    )
      unsupported('This option is unsupported on Codex Responses');
    const input = request.messages.flatMap((message): unknown[] => {
      if (message.role === 'tool')
        return [
          {
            type: 'function_call_output',
            call_id: message.result.toolCallId,
            output: message.result.content,
          },
        ];
      const text = message.content.map((part) => ('text' in part ? part.text : '')).join('\n');
      return [
        ...(text
          ? [
              {
                role: message.role,
                content: [
                  { type: message.role === 'assistant' ? 'output_text' : 'input_text', text },
                ],
              },
            ]
          : []),
        ...(message.role === 'assistant'
          ? message.toolCalls.map((call) => ({
              type: 'function_call',
              call_id: call.id,
              name: call.name,
              arguments: call.arguments,
            }))
          : []),
      ];
    });
    return {
      ...common,
      stream: true,
      store: false,
      instructions: request.system.join('\n\n'),
      input,
      ...options,
    };
  }
  const messages = [
    ...request.system.map((content) => ({ role: 'system', content })),
    ...request.messages.map((message) =>
      message.role === 'tool'
        ? { role: 'tool', tool_call_id: message.result.toolCallId, content: message.result.content }
        : {
            role: message.role,
            content: message.content.map((part) => ('text' in part ? part.text : '')).join('\n'),
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

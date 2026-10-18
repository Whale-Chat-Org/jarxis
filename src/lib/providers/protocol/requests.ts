import 'server-only';
import { z } from 'zod';
import {
  CanonicalImagePart,
  CanonicalMessage,
  CanonicalRequest,
  CanonicalResponseFormat,
  CanonicalTextPart,
  CanonicalTool,
  CanonicalToolCall,
  CanonicalToolChoice,
  ClientDialect,
  invalid,
  joinTextParts,
  unsupported,
} from './canonical';
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
          typeof message.content === 'string' ? message.content : joinTextParts(message.content),
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

const simpleToolChoice = z
  .enum(['auto', 'none', 'required'])
  .transform((kind): CanonicalToolChoice => ({ kind }));

const chatToolChoice = z.union([
  simpleToolChoice,
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
const chatCompletionsRequest = z
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
  simpleToolChoice,
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
const responsesRequest = z
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
      const text = joinTextParts(message.content);
      if (text) system.push(text);
      continue;
    }
    messages.push(message);
  }
  const request: CanonicalRequest = {
    dialect: 'chat',
    publicModelId: parsed.model,
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
    includeUsage: parsed.stream_options?.include_usage,
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
          content: typeof item.output === 'string' ? item.output : joinTextParts(item.output),
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
      const text = joinTextParts(parts, { omitEmpty: true });
      if (text) system.push(text);
      continue;
    }
    if (message.role === 'assistant') {
      const text = joinTextParts(parts, { omitEmpty: true });
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
    publicModelId: parsed.model,
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

import 'server-only';

/**
 * Wire translation for the gateway.
 *
 * The gateway speaks two client dialects (OpenAI Chat Completions and OpenAI Responses) and two
 * upstream dialects (OpenAI-compatible Chat and
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

export const invalid = (message: string): never => {
  throw new ProtocolError('INVALID_REQUEST', message);
};
export const unsupported = (message: string): never => {
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
  publicModelId: string;
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
  includeUsage?: boolean;
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

export function toolCallsToChat(toolCalls: CanonicalToolCall[]) {
  return toolCalls.map((call) => ({
    id: call.id,
    type: 'function' as const,
    function: { name: call.name, arguments: call.arguments },
  }));
}

/** Preserve each wire format's treatment of empty text blocks. */
export function joinTextParts(parts: readonly object[], options: { omitEmpty?: boolean } = {}) {
  const text = parts.map((part) =>
    'text' in part && typeof part.text === 'string' ? part.text : '',
  );
  return (options.omitEmpty ? text.filter(Boolean) : text).join('\n');
}

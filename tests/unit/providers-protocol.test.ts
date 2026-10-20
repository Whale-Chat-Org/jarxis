import {
  createClientStreamRenderer,
  createUpstreamStreamParser,
  parseGatewayRequest,
  parseUpstreamResult,
  ProtocolError,
  renderChatCompletion,
  renderResponsesResult,
  renderStreamError,
  renderUpstreamRequest,
  upstreamDialect,
  type CanonicalStreamEvent,
} from '@/lib/providers/protocol';
import { describe, expect, it } from 'vitest';

const tool = {
  type: 'function',
  function: {
    name: 'lookup',
    description: 'Find',
    parameters: { type: 'object', properties: { q: { type: 'string' } } },
  },
};
const chat = (extra: Record<string, unknown> = {}) =>
  parseGatewayRequest('chat', {
    model: 'anthropic/claude-sonnet',
    messages: [
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":"a"}' } },
          { id: 'c2', type: 'function', function: { name: 'lookup', arguments: '{"q":"b"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'A' },
      { role: 'tool', tool_call_id: 'c2', content: 'B' },
    ],
    tools: [tool],
    ...extra,
  });

const parseAll = (dialect: 'chat' | 'anthropic', frames: unknown[]) => {
  const parser = createUpstreamStreamParser(dialect);
  const events = frames.flatMap((frame) =>
    parser.parse(typeof frame === 'string' ? frame : JSON.stringify(frame)),
  );
  return { events, completed: parser.completed };
};

describe('client request parsing', () => {
  it('preserves the requested ID and lifts system messages', () => {
    const request = chat({ max_tokens: 50, stream: true });
    expect(request).toMatchObject({
      dialect: 'chat',
      publicModelId: 'anthropic/claude-sonnet',
      model: 'anthropic/claude-sonnet',
      system: ['Be brief'],
      maxOutputTokens: 50,
      stream: true,
    });
    expect(request.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Hi' }] });
  });

  it.each([
    [{ seed: 1 }, 'UNSUPPORTED'],
    [{ logit_bias: {} }, 'UNSUPPORTED'],
    [{ n: 2 }, 'UNSUPPORTED'],
    [{ max_tokens: 1, max_completion_tokens: 1 }, 'INVALID_REQUEST'],
    [{ tool_choice: { type: 'function', function: { name: 'missing' } } }, 'INVALID_REQUEST'],
  ])('rejects chat option %j', (extra, code) => {
    expect(() => chat(extra)).toThrow(expect.objectContaining({ code }));
  });

  it('rejects unknown fields instead of forwarding them', () => {
    expect(() => chat({ arbitrary: true })).toThrow();
  });

  it('accepts plain models and requires known tool call ids', () => {
    expect(
      parseGatewayRequest('chat', { model: 'gpt-5', messages: [{ role: 'user', content: 'x' }] }),
    ).toMatchObject({ publicModelId: 'gpt-5', model: 'gpt-5' });
    expect(() =>
      parseGatewayRequest('chat', {
        model: 'openai/gpt-5',
        messages: [{ role: 'tool', tool_call_id: 'x', content: 'y' }],
      }),
    ).toThrow(/unknown tool call/);
  });

  it.each([
    { store: true },
    { previous_response_id: 'r' },
    { background: true },
    { tools: [{ type: 'web_search' }] },
  ])('rejects stateful or built-in Responses option %j', (extra) => {
    expect(() =>
      parseGatewayRequest('responses', { model: 'openai/gpt-5', input: 'hi', ...extra }),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED' }));
  });

  it('parses Responses input items', () => {
    const request = parseGatewayRequest('responses', {
      model: 'openai/gpt-5',
      instructions: 'Sys',
      input: [
        { role: 'user', content: 'Hi' },
        { type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '{}' },
        { type: 'function_call_output', call_id: 'c1', output: 'done' },
      ],
      tools: [{ type: 'function', name: 'lookup', parameters: { type: 'object' } }],
      store: false,
    });
    expect(request.system).toContain('Sys');
    expect(
      request.messages.some(
        (message) => message.role === 'tool' && message.result.content === 'done',
      ),
    ).toBe(true);
  });
});

describe('upstream request rendering', () => {
  it('maps providers to dialects', () => {
    expect(['openai', 'openrouter', 'custom', 'anthropic'].map(upstreamDialect)).toEqual([
      'chat',
      'chat',
      'chat',
      'anthropic',
    ]);
  });

  it('renders native Anthropic messages with tools and merged tool results', () => {
    const body = renderUpstreamRequest(
      {
        ...chat({ tool_choice: 'required', parallel_tool_calls: false, temperature: 0.5 }),
        model: 'claude-sonnet',
      },
      'anthropic',
    );
    expect(body).toMatchObject({
      model: 'claude-sonnet',
      system: 'Be brief',
      max_tokens: 4096,
      temperature: 0.5,
      tools: [{ name: 'lookup', input_schema: tool.function.parameters }],
      tool_choice: { type: 'any', disable_parallel_tool_use: true },
    });
    const messages = body.messages as { role: string; content: Record<string, unknown>[] }[];
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[1].content).toEqual([
      { type: 'tool_use', id: 'c1', name: 'lookup', input: { q: 'a' } },
      { type: 'tool_use', id: 'c2', name: 'lookup', input: { q: 'b' } },
    ]);
    expect(messages[2].content.map((part) => part.tool_use_id)).toEqual(['c1', 'c2']);
  });

  it('rejects options Anthropic cannot honour', () => {
    expect(() =>
      renderUpstreamRequest(chat({ response_format: { type: 'json_object' } }), 'anthropic'),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED' }));
    expect(() => renderUpstreamRequest(chat({ temperature: 1.5 }), 'anthropic')).toThrow(
      ProtocolError,
    );
  });

  it('renders OpenAI-compatible chat with usage on streams', () => {
    const body = renderUpstreamRequest(chat({ stream: true, max_tokens: 9 }), 'openrouter');
    expect(body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 9,
    });
    expect((body.messages as { role: string }[])[0]).toEqual({
      role: 'system',
      content: 'Be brief',
    });
    expect(body).not.toHaveProperty('store');
  });

  it('rejects image input for every provider', () => {
    const request = parseGatewayRequest('chat', {
      model: 'openai/gpt-5',
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }],
        },
      ],
    });
    expect(() => renderUpstreamRequest(request, 'openai')).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED' }),
    );
  });
});

describe('upstream results', () => {
  it('parses Anthropic text, tools and usage', () => {
    const result = parseUpstreamResult(
      {
        id: 'm1',
        content: [
          { type: 'text', text: 'Hi' },
          { type: 'tool_use', id: 't1', name: 'lookup', input: { q: 1 } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 3, output_tokens: 4 },
      },
      'anthropic',
    );
    expect(result).toMatchObject({
      id: 'm1',
      text: 'Hi',
      toolCalls: [{ id: 't1', name: 'lookup', arguments: '{"q":1}' }],
      finishReason: 'tool_calls',
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    });
    const rendered = renderChatCompletion(result, 'anthropic/x');
    expect(rendered).toMatchObject({
      model: 'anthropic/x',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: { content: 'Hi', tool_calls: [{ id: 't1', type: 'function' }] },
        },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    });
  });

  it('parses chat completions and renders Responses objects', () => {
    const result = parseUpstreamResult(
      {
        id: 'c',
        choices: [{ message: { content: 'ok' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      },
      'chat',
    );
    expect(renderResponsesResult(result, 'openai/x')).toMatchObject({
      status: 'incomplete',
      store: false,
      output_text: 'ok',
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    });
  });

  it('rejects upstream error bodies and unknown content', () => {
    expect(() => parseUpstreamResult({ error: { message: 'secret detail' } }, 'chat')).toThrow(
      expect.objectContaining({ code: 'UPSTREAM_PROTOCOL', message: 'Upstream returned an error' }),
    );
    expect(() => parseUpstreamResult({ content: [{ type: 'image' }] }, 'anthropic')).toThrow(
      ProtocolError,
    );
  });
});

describe('upstream stream parsing', () => {
  it('normalises Anthropic SSE events', () => {
    const { events, completed } = parseAll('anthropic', [
      {
        type: 'message_start',
        message: { id: 'm', model: 'x', usage: { input_tokens: 5, output_tokens: 0 } },
      },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 't', name: 'lookup' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"q":' },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '1}' },
      },
      { type: 'content_block_stop', index: 1 },
      { type: 'ping' },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' },
    ]);
    expect(completed).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'text.delta',
      'tool_call.start',
      'tool_call.delta',
      'tool_call.delta',
      'tool_call.end',
      'finish',
    ]);
    expect(events.at(-1)).toEqual({
      type: 'finish',
      finishReason: 'tool_calls',
      usage: {
        inputTokens: 5,
        outputTokens: 7,
        totalTokens: 12,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    });
  });

  it('normalises chat chunks and requires [DONE]', () => {
    const { events, completed } = parseAll('chat', [
      { id: 'c', model: 'm', choices: [{ delta: { content: 'A' } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 't', function: { name: 'lookup', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      '[DONE]',
    ]);
    expect(completed).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'finish',
      finishReason: 'tool_calls',
      usage: { totalTokens: 2 },
    });
  });

  it('fails on upstream error events and stray [DONE]', () => {
    expect(() => parseAll('anthropic', [{ type: 'error', error: { message: 'x' } }])).toThrow(
      ProtocolError,
    );
    expect(() => parseAll('anthropic', ['[DONE]'])).toThrow(ProtocolError);
  });
});

describe('client stream rendering', () => {
  const events: CanonicalStreamEvent[] = [
    { type: 'start', id: 'x', model: 'm' },
    { type: 'text.delta', text: 'Hi' },
    { type: 'tool_call.start', index: 1, id: 't', name: 'lookup' },
    { type: 'tool_call.delta', index: 1, argumentsDelta: '{}' },
    { type: 'tool_call.end', index: 1 },
    {
      type: 'finish',
      finishReason: 'tool_calls',
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    },
  ];
  const run = (dialect: 'chat' | 'responses', includeUsage = false) => {
    const renderer = createClientStreamRenderer(
      { ...chat(), dialect, publicModelId: 'anthropic/x' },
      { includeUsage },
    );
    return [...events.flatMap((event) => renderer.render(event)), ...renderer.finish()];
  };

  it('renders Chat chunks with sequential tool indexes, usage and [DONE]', () => {
    const frames = run('chat', true);
    expect(frames.at(-1)).toEqual({ data: '[DONE]' });
    const chunks = frames.slice(0, -1).map((frame) => JSON.parse(frame.data));
    expect(chunks[0].choices[0].delta).toEqual({ role: 'assistant', content: '' });
    const toolDeltas = chunks.flatMap((chunk) => chunk.choices[0]?.delta?.tool_calls ?? []);
    expect(toolDeltas.map((call: { index: number }) => call.index)).toEqual([0, 0]);
    expect(chunks.at(-1)).toMatchObject({ choices: [], usage: { total_tokens: 3 } });
    expect(chunks.at(-2).choices[0].finish_reason).toBe('tool_calls');
  });

  it('renders Responses events with monotonic sequence numbers', () => {
    const frames = run('responses');
    const payloads = frames.map((frame) => JSON.parse(frame.data));
    expect(payloads.map((payload) => payload.sequence_number)).toEqual(
      payloads.map((_, index) => index),
    );
    expect(frames[0].event).toBe('response.created');
    const completed = payloads.at(-1);
    expect(completed.type).toBe('response.completed');
    expect(completed.response).toMatchObject({
      status: 'completed',
      store: false,
      output_text: 'Hi',
      usage: { total_tokens: 3 },
    });
    expect(completed.response.output.map((item: { type: string }) => item.type)).toEqual([
      'message',
      'function_call',
    ]);
  });

  it('sanitises stream errors', () => {
    expect(renderStreamError('chat', 'UPSTREAM_ERROR', 'Provider stream failed')).toEqual([
      {
        data: JSON.stringify({
          error: { code: 'UPSTREAM_ERROR', message: 'Provider stream failed' },
        }),
      },
      { data: '[DONE]' },
    ]);
    expect(renderStreamError('responses', 'E', 'm')[0].event).toBe('error');
  });
});

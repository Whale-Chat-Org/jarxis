import {
  createChatStreamRenderer,
  createClientStreamRenderer,
  createResponsesStreamRenderer,
  createUpstreamStreamParser,
  parseChatRequest,
  parseGatewayRequest,
  parseResponsesRequest,
  parseUpstreamResult,
  ProtocolError,
  renderChatCompletion,
  renderResponsesResult,
  renderStreamError,
  renderUpstreamRequest,
  type CanonicalResult,
} from '@/lib/providers/protocol';
import { describe, expect, it } from 'vitest';

const fn = (name = 'lookup', extra: Record<string, unknown> = {}) => ({
  type: 'function',
  function: { name, ...extra },
});
const chatPayload = (extra: Record<string, unknown> = {}) => ({
  model: 'openai/gpt-x',
  messages: [{ role: 'user', content: 'Hi' }],
  ...extra,
});
function code(run: () => unknown) {
  try {
    run();
  } catch (error) {
    if (error instanceof ProtocolError) return error.code;
    return (error as Error).name;
  }
  return 'OK';
}
const parse = (dialect: 'chat' | 'anthropic', frames: unknown[]) => {
  const parser = createUpstreamStreamParser(dialect);
  const events = frames.flatMap((frame) =>
    parser.parse(typeof frame === 'string' ? frame : JSON.stringify(frame)),
  );
  return { events, completed: parser.completed };
};
const frames = (list: { event?: string; data: string }[]) =>
  list.map((frame) => (frame.data === '[DONE]' ? frame.data : JSON.parse(frame.data)));

describe('chat request parsing', () => {
  it('rejects non-object payloads', () => {
    for (const payload of [null, 'x', [1]])
      expect(code(() => parseChatRequest(payload))).toBe('INVALID_REQUEST');
  });

  it('normalises content parts, empty system text and tool calls', () => {
    const request = parseChatRequest(
      chatPayload({
        messages: [
          { role: 'developer', content: '' },
          { role: 'system', content: [{ type: 'text', text: 'Rules' }] },
          { role: 'user', content: [{ type: 'text', text: 'Look' }], name: 'pat' },
          {
            role: 'assistant',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'lookup', arguments: '' } },
            ],
          },
          {
            role: 'tool',
            tool_call_id: 'c1',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
        ],
        tools: [fn('lookup', { strict: null })],
        tool_choice: 'required',
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'Out', schema: { type: 'object' }, strict: null },
        },
        stop: 'END',
        max_completion_tokens: 10,
        n: 1,
      }),
    );
    expect(request.system).toEqual(['Rules']);
    expect(request.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: 'Look' }],
    });
    expect(request.messages[1]).toMatchObject({ toolCalls: [{ id: 'c1', arguments: '{}' }] });
    expect(request.messages[2]).toEqual({
      role: 'tool',
      result: { toolCallId: 'c1', content: 'a\nb' },
    });
    expect(request.tools[0]).toEqual({
      name: 'lookup',
      strict: undefined,
      description: undefined,
      parameters: { type: 'object', properties: {} },
    });
    expect(request.toolChoice).toEqual({ kind: 'required' });
    expect(request.responseFormat).toEqual({
      kind: 'json_schema',
      name: 'Out',
      schema: { type: 'object' },
      strict: undefined,
    });
    expect(request.stop).toEqual(['END']);
    expect(request.maxOutputTokens).toBe(10);
  });

  it('accepts tool choices and simple response formats', () => {
    expect(
      parseChatRequest(chatPayload({ tools: [fn()], tool_choice: 'none' })).toolChoice,
    ).toEqual({ kind: 'none' });
    expect(
      parseChatRequest(chatPayload({ tools: [fn()], tool_choice: 'auto' })).toolChoice,
    ).toEqual({ kind: 'auto' });
    expect(
      parseChatRequest(
        chatPayload({
          tools: [fn()],
          tool_choice: { type: 'function', function: { name: 'lookup' } },
        }),
      ).toolChoice,
    ).toEqual({ kind: 'function', name: 'lookup' });
    expect(
      parseChatRequest(chatPayload({ response_format: { type: 'text' } })).responseFormat,
    ).toEqual({ kind: 'text' });
    expect(
      parseChatRequest(chatPayload({ response_format: { type: 'json_object' } })).responseFormat,
    ).toEqual({ kind: 'json_object' });
    expect(parseChatRequest(chatPayload({ tool_choice: 'none' })).toolChoice).toEqual({
      kind: 'none',
    });
  });

  it.each([
    ['n other than 1', { n: 2 }, 'UNSUPPORTED'],
    ['both token limits', { max_tokens: 1, max_completion_tokens: 1 }, 'INVALID_REQUEST'],
    ['an invalid tool name', { tools: [fn('bad name!')] }, 'INVALID_REQUEST'],
    ['duplicate tool names', { tools: [fn(), fn()] }, 'INVALID_REQUEST'],
    [
      'a tool choice naming a missing tool',
      { tools: [fn()], tool_choice: { type: 'function', function: { name: 'other' } } },
      'INVALID_REQUEST',
    ],
    ['a tool choice without tools', { tool_choice: 'required' }, 'INVALID_REQUEST'],
    ['a trailing slash model', { model: 'openai/' }, 'INVALID_REQUEST'],
    ['system-only messages', { messages: [{ role: 'system', content: 'x' }] }, 'INVALID_REQUEST'],
    [
      'a non-https image',
      {
        messages: [
          {
            role: 'user',
            content: [{ type: 'image_url', image_url: { url: 'http://x.test/a.png' } }],
          },
        ],
      },
      'INVALID_REQUEST',
    ],
    [
      'a relative image',
      {
        messages: [
          { role: 'user', content: [{ type: 'image_url', image_url: { url: '/a.png' } }] },
        ],
      },
      'INVALID_REQUEST',
    ],
  ])('rejects %s', (_label, extra, expected) => {
    expect(code(() => parseChatRequest(chatPayload(extra)))).toBe(expected);
  });

  it('accepts https and inline data images', () => {
    const request = parseChatRequest(
      chatPayload({
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: 'https://img.example.com/a.png', detail: 'low' },
              },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            ],
          },
        ],
      }),
    );
    expect(request.messages[0]).toMatchObject({
      content: [{ type: 'image', detail: 'low' }, { type: 'image' }],
    });
  });
});

describe('responses request parsing', () => {
  const base = (extra: Record<string, unknown> = {}) => ({
    model: 'openai/gpt-x',
    input: 'Hi',
    ...extra,
  });

  it('rejects non-object payloads, stored responses and built-in tools', () => {
    expect(code(() => parseResponsesRequest(null))).toBe('INVALID_REQUEST');
    expect(code(() => parseResponsesRequest(base({ store: true })))).toBe('UNSUPPORTED');
    expect(code(() => parseResponsesRequest(base({ tools: [{ type: 'web_search' }] })))).toBe(
      'UNSUPPORTED',
    );
    expect(code(() => parseResponsesRequest(base({ previous_response_id: 'r1' })))).toBe(
      'UNSUPPORTED',
    );
    expect(code(() => parseResponsesRequest(base({ tools: [null] })))).toBe('ZodError');
  });

  it('parses every input item type', () => {
    const request = parseResponsesRequest(
      base({
        instructions: 'Be kind',
        input: [
          { role: 'system', content: 'Sys' },
          {
            role: 'developer',
            content: [
              { type: 'input_text', text: 'Dev' },
              { type: 'input_image', image_url: 'https://x.test/a.png' },
            ],
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Q' },
              { type: 'input_image', image_url: 'https://x.test/b.png', detail: 'high' },
            ],
          },
          { type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '' },
          { type: 'function_call', call_id: 'c2', name: 'lookup', arguments: '{"q":1}' },
          { type: 'function_call_output', call_id: 'c1', output: 'one' },
          {
            type: 'function_call_output',
            call_id: 'c2',
            output: [
              { type: 'input_text', text: 'x' },
              { type: 'text', text: 'y' },
            ],
          },
          { role: 'assistant', content: [{ type: 'output_text', text: 'A' }] },
          { role: 'assistant', content: '' },
          { type: 'message', role: 'user', content: 'Thanks' },
        ],
        tools: [
          { type: 'function', name: 'lookup', description: null, parameters: null, strict: true },
        ],
        tool_choice: { type: 'function', name: 'lookup' },
        parallel_tool_calls: null,
        text: { format: { type: 'json_schema', name: 'Out', schema: {}, strict: null } },
        temperature: null,
        top_p: 0.5,
        max_output_tokens: 20,
        metadata: { a: 'b' },
      }),
    );
    expect(request.system).toEqual(['Be kind', 'Sys', 'Dev']);
    expect(request.messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: 'Q' },
        { type: 'image', detail: 'high' },
      ],
    });
    expect(request.messages[1]).toMatchObject({
      role: 'assistant',
      content: [],
      toolCalls: [
        { id: 'c1', arguments: '{}' },
        { id: 'c2', arguments: '{"q":1}' },
      ],
    });
    expect(request.messages[3]).toEqual({
      role: 'tool',
      result: { toolCallId: 'c2', content: 'x\ny' },
    });
    expect(request.messages[4]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'A' }],
      toolCalls: [],
    });
    expect(request.messages[5]).toEqual({ role: 'assistant', content: [], toolCalls: [] });
    expect(request.tools[0]).toEqual({
      name: 'lookup',
      strict: true,
      description: undefined,
      parameters: { type: 'object', properties: {} },
    });
    expect(request.toolChoice).toEqual({ kind: 'function', name: 'lookup' });
    expect(request.responseFormat).toEqual({
      kind: 'json_schema',
      name: 'Out',
      schema: {},
      strict: undefined,
    });
    expect(request).toMatchObject({
      topP: 0.5,
      maxOutputTokens: 20,
      temperature: undefined,
      parallelToolCalls: undefined,
    });
  });

  it('maps tool choices and text formats', () => {
    const tools = [{ type: 'function', name: 'lookup' }];
    expect(parseResponsesRequest(base({ tools, tool_choice: 'auto' })).toolChoice).toEqual({
      kind: 'auto',
    });
    expect(parseResponsesRequest(base({ tools, tool_choice: 'none' })).toolChoice).toEqual({
      kind: 'none',
    });
    expect(parseResponsesRequest(base({ tools, tool_choice: 'required' })).toolChoice).toEqual({
      kind: 'required',
    });
    expect(
      parseResponsesRequest(base({ text: { format: { type: 'text' } } })).responseFormat,
    ).toEqual({ kind: 'text' });
    expect(
      parseResponsesRequest(base({ text: { format: { type: 'json_object' } } })).responseFormat,
    ).toEqual({ kind: 'json_object' });
    expect(parseResponsesRequest(base({ text: {} })).responseFormat).toBeUndefined();
  });

  it('rejects output_text on user items and empty user content', () => {
    expect(
      code(() =>
        parseResponsesRequest(
          base({ input: [{ role: 'user', content: [{ type: 'output_text', text: 'x' }] }] }),
        ),
      ),
    ).toBe('INVALID_REQUEST');
    expect(
      code(() => parseResponsesRequest(base({ input: [{ role: 'user', content: [] }] }))),
    ).toBe('INVALID_REQUEST');
  });

  it('dispatches by dialect', () => {
    expect(parseGatewayRequest('responses', base()).dialect).toBe('responses');
  });
});

describe('result rendering', () => {
  const result = (extra: Partial<CanonicalResult> = {}): CanonicalResult => ({
    id: 'r1',
    model: 'gpt-x',
    createdAt: 1,
    text: '',
    toolCalls: [],
    finishReason: 'stop',
    ...extra,
  });

  it('renders chat tool calls, null content and detailed usage', () => {
    const rendered = renderChatCompletion(
      result({
        toolCalls: [{ id: 'c1', name: 'lookup', arguments: '{}' }],
        usage: {
          inputTokens: 2,
          outputTokens: 3,
          totalTokens: 5,
          cachedInputTokens: 1,
          reasoningTokens: 2,
        },
      }),
      'openai/gpt-x',
    );
    expect(rendered.choices[0].message.content).toBeNull();
    expect(rendered.choices[0].finish_reason).toBe('tool_calls');
    expect(rendered.usage).toEqual({
      prompt_tokens: 2,
      completion_tokens: 3,
      total_tokens: 5,
      prompt_tokens_details: { cached_tokens: 1 },
      completion_tokens_details: { reasoning_tokens: 2 },
    });
    expect(renderChatCompletion(result(), 'm')).not.toHaveProperty('usage');
  });

  it('renders incomplete responses with function calls and usage', () => {
    const rendered = renderResponsesResult(
      result({
        finishReason: 'length',
        toolCalls: [{ id: 'c1', name: 'lookup', arguments: '{}' }],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
      'openai/gpt-x',
    );
    expect(rendered.status).toBe('incomplete');
    expect(rendered.incomplete_details).toEqual({ reason: 'max_output_tokens' });
    expect(rendered.output).toEqual([
      expect.objectContaining({ type: 'function_call', call_id: 'c1' }),
    ]);
    expect(rendered.usage).toMatchObject({
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    });
  });
});

describe('chat stream renderer', () => {
  it('ignores unknown tool deltas and closes an unfinished stream', () => {
    const renderer = createChatStreamRenderer('openai/gpt-x');
    expect(renderer.render({ type: 'tool_call.delta', index: 9, argumentsDelta: 'x' })).toEqual([]);
    expect(renderer.render({ type: 'tool_call.end', index: 9 })).toEqual([]);
    expect(
      renderer.render({
        type: 'usage',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
    ).toEqual([]);
    const tail = frames(renderer.finish());
    expect(tail[0].choices[0].delta).toEqual({ role: 'assistant', content: '' });
    expect(tail[1].choices[0].finish_reason).toBe('stop');
    expect(tail[2]).toBe('[DONE]');
  });

  it('emits null usage when requested but unknown, and only [DONE] after finish', () => {
    const renderer = createChatStreamRenderer('openai/gpt-x', { includeUsage: true });
    const finish = frames(renderer.render({ type: 'finish', finishReason: 'length' }));
    expect(finish.at(-1)).toMatchObject({ choices: [], usage: null });
    expect(frames(renderer.finish())).toEqual(['[DONE]']);
  });

  it('uses the pending usage when finish carries none', () => {
    const renderer = createChatStreamRenderer('openai/gpt-x', { includeUsage: true });
    renderer.render({ type: 'usage', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } });
    expect(
      frames(renderer.render({ type: 'finish', finishReason: 'stop' })).at(-1).usage,
    ).toMatchObject({ total_tokens: 3 });
  });
});

describe('responses stream renderer', () => {
  it('handles tool lifecycles, duplicates and unknown indices', () => {
    const renderer = createResponsesStreamRenderer('openai/gpt-x');
    renderer.render({ type: 'start', id: 'x', model: 'm' });
    renderer.render({ type: 'text.delta', text: 'Hi' });
    const started = frames(
      renderer.render({ type: 'tool_call.start', index: 1, id: 'c1', name: 'lookup' }),
    );
    expect(started.map((f) => f.type)).toEqual([
      'response.output_text.done',
      'response.content_part.done',
      'response.output_item.done',
      'response.output_item.added',
    ]);
    expect(renderer.render({ type: 'tool_call.delta', index: 7, argumentsDelta: 'x' })).toEqual([]);
    expect(
      frames(renderer.render({ type: 'tool_call.delta', index: 1, argumentsDelta: '{}' }))[0].delta,
    ).toBe('{}');
    expect(frames(renderer.render({ type: 'tool_call.end', index: 1 })).map((f) => f.type)).toEqual(
      ['response.function_call_arguments.done', 'response.output_item.done'],
    );
    expect(renderer.render({ type: 'tool_call.end', index: 1 })).toEqual([]);
    expect(renderer.render({ type: 'tool_call.end', index: 5 })).toEqual([]);
    expect(
      renderer.render({
        type: 'usage',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      }),
    ).toEqual([]);
    const done = frames(renderer.render({ type: 'finish', finishReason: 'length' }));
    expect(done.at(-1)).toMatchObject({
      type: 'response.incomplete',
      response: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        usage: { total_tokens: 2 },
      },
    });
    expect(renderer.finish()).toEqual([]);
    const sequence = [...started, ...done].map((f) => f.sequence_number);
    expect([...sequence].sort((a, b) => a - b)).toEqual(sequence);
  });

  it('completes an unfinished stream, closing an open message', () => {
    const renderer = createResponsesStreamRenderer('openai/gpt-x');
    renderer.render({ type: 'text.delta', text: 'partial' });
    const tail = frames(renderer.finish());
    expect(tail.at(-1)).toMatchObject({
      type: 'response.completed',
      response: { output_text: 'partial' },
    });
    const empty = createResponsesStreamRenderer('m');
    expect(frames(empty.finish()).map((f) => f.type)).toEqual(['response.completed']);
  });

  it('selects the renderer by client dialect and sanitises errors', () => {
    const chat = parseChatRequest(chatPayload());
    expect(createClientStreamRenderer(chat).finish().at(-1)!.data).toBe('[DONE]');
    const responses = parseResponsesRequest({ model: 'openai/gpt-x', input: 'Hi' });
    expect(createClientStreamRenderer(responses).finish()[0].event).toBe('response.completed');
    expect(renderStreamError('responses', 'UPSTREAM_ERROR', 'Provider stream failed')).toEqual([
      {
        event: 'error',
        data: JSON.stringify({
          type: 'error',
          code: 'UPSTREAM_ERROR',
          message: 'Provider stream failed',
        }),
      },
    ]);
  });
});

describe('upstream results', () => {
  it('parses chat tool calls and finish reasons', () => {
    const result = parseUpstreamResult(
      {
        id: 'c',
        created: 5,
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 't', function: { name: 'lookup', arguments: '{}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: 1 },
        },
      },
      'chat',
    );
    expect(result).toMatchObject({
      text: '',
      createdAt: 5,
      finishReason: 'tool_calls',
      toolCalls: [{ id: 't', name: 'lookup' }],
    });
    expect(result.usage).toMatchObject({ cachedInputTokens: 1, totalTokens: 3 });
    expect(
      parseUpstreamResult({ choices: [{ message: {}, finish_reason: 'content_filter' }] }, 'chat')
        .finishReason,
    ).toBe('content_filter');
    expect(
      parseUpstreamResult({ choices: [{ message: {}, finish_reason: 'length' }] }, 'chat'),
    ).toMatchObject({ finishReason: 'length', id: expect.any(String) });
  });

  it('rejects chat results without exactly one choice and non-array Anthropic content', () => {
    expect(code(() => parseUpstreamResult({ choices: [] }, 'chat'))).toBe('UPSTREAM_PROTOCOL');
    expect(code(() => parseUpstreamResult({ choices: [{}, {}] }, 'chat'))).toBe(
      'UPSTREAM_PROTOCOL',
    );
    expect(code(() => parseUpstreamResult({ content: 'x' }, 'anthropic'))).toBe(
      'UPSTREAM_PROTOCOL',
    );
    expect(
      parseUpstreamResult(
        { content: [{ type: 'tool_use', id: 't', name: 'n' }], stop_reason: 'max_tokens' },
        'anthropic',
      ),
    ).toMatchObject({
      finishReason: 'length',
      toolCalls: [{ arguments: '{}' }],
    });
  });
});

describe('upstream stream parsing edge cases', () => {
  it('parses chat tool call streams and rejects incomplete tool headers', () => {
    const { events, completed } = parse('chat', [
      {
        id: 'c',
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, id: 't', function: { name: 'lookup', arguments: '{"a"' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] },
            finish_reason: 'tool_calls',
          },
        ],
      },
      { choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      '[DONE]',
    ]);
    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      'start',
      'tool_call.start',
      'tool_call.delta',
      'tool_call.delta',
      'tool_call.end',
      'finish',
    ]);
    expect(events.at(-1)).toMatchObject({ finishReason: 'tool_calls', usage: { totalTokens: 2 } });
    expect(
      code(() =>
        parse('chat', [
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'x' } }] } }] },
        ]),
      ),
    ).toBe('UPSTREAM_PROTOCOL');
  });

  it('parses Anthropic tool streams and rejects unsupported blocks or deltas', () => {
    const { events, completed } = parse('anthropic', [
      { type: 'message_start', message: { id: 'm', model: 'claude' } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: 'Pre' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 2,
        content_block: { type: 'tool_use', id: 't', name: 'lookup' },
      },
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
      { type: 'content_block_stop', index: 2 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
      { type: 'ping' },
      { type: 'message_stop' },
    ]);
    expect(completed).toBe(true);
    expect(events.map((e) => e.type)).toEqual([
      'start',
      'text.delta',
      'tool_call.start',
      'tool_call.delta',
      'tool_call.end',
      'finish',
    ]);
    expect(events.at(-1)).toMatchObject({
      finishReason: 'tool_calls',
      usage: { inputTokens: 0, outputTokens: 4, totalTokens: 4 },
    });
    expect(
      code(() =>
        parse('anthropic', [{ type: 'content_block_start', content_block: { type: 'thinking' } }]),
      ),
    ).toBe('UPSTREAM_PROTOCOL');
    expect(
      code(() =>
        parse('anthropic', [{ type: 'content_block_delta', delta: { type: 'thinking_delta' } }]),
      ),
    ).toBe('UPSTREAM_PROTOCOL');
    expect(code(() => parse('anthropic', ['[DONE]']))).toBe('UPSTREAM_PROTOCOL');
    expect(code(() => parse('anthropic', [{ type: 'error', error: { message: 'x' } }]))).toBe(
      'UPSTREAM_PROTOCOL',
    );
  });
});

describe('upstream request rendering edge cases', () => {
  const request = (extra: Record<string, unknown> = {}) => parseChatRequest(chatPayload(extra));

  it.each([
    ['structured output', { response_format: { type: 'json_object' } }],
    ['user attribution', { user: 'u1' }],
    ['strict tools', { tools: [fn('lookup', { strict: true })] }],
    ['temperature above 1', { temperature: 1.5 }],
  ])('refuses %s on Anthropic', (_label, extra) => {
    expect(code(() => renderUpstreamRequest(request(extra), 'anthropic'))).toBe('UNSUPPORTED');
  });

  it('validates assistant tool arguments for Anthropic', () => {
    const withArgs = (args: string) =>
      request({
        messages: [
          { role: 'user', content: 'Hi' },
          {
            role: 'assistant',
            content: 'x',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'lookup', arguments: args } },
            ],
          },
        ],
      });
    expect(code(() => renderUpstreamRequest(withArgs('{bad'), 'anthropic'))).toBe(
      'INVALID_REQUEST',
    );
    expect(code(() => renderUpstreamRequest(withArgs('[1]'), 'anthropic'))).toBe('INVALID_REQUEST');
    expect(code(() => renderUpstreamRequest(withArgs('null'), 'anthropic'))).toBe(
      'INVALID_REQUEST',
    );
    const ok = renderUpstreamRequest(withArgs('{"q":1}'), 'anthropic') as {
      messages: { content: unknown[] }[];
    };
    expect(ok.messages[1].content).toEqual([
      { type: 'text', text: 'x' },
      { type: 'tool_use', id: 'c1', name: 'lookup', input: { q: 1 } },
    ]);
  });

  it('maps Anthropic tool choice, parallelism and sampling options', () => {
    const tools = [fn('lookup')];
    const render = (extra: Record<string, unknown>) =>
      renderUpstreamRequest(request({ tools, ...extra }), 'anthropic') as Record<string, unknown>;
    expect(render({ tool_choice: 'required', parallel_tool_calls: false }).tool_choice).toEqual({
      type: 'any',
      disable_parallel_tool_use: true,
    });
    expect(
      render({ tool_choice: { type: 'function', function: { name: 'lookup' } } }).tool_choice,
    ).toEqual({ type: 'tool', name: 'lookup' });
    expect(render({ tool_choice: 'auto' }).tool_choice).toEqual({ type: 'auto' });
    const none = render({ tool_choice: 'none' });
    expect(none).not.toHaveProperty('tools');
    expect(none).not.toHaveProperty('tool_choice');
    expect(render({ parallel_tool_calls: true }).tool_choice).toEqual({
      type: 'auto',
      disable_parallel_tool_use: false,
    });
    const sampled = render({ temperature: 0.5, top_p: 0.9, stop: ['X'], max_tokens: 7 });
    expect(sampled).toMatchObject({
      temperature: 0.5,
      top_p: 0.9,
      stop_sequences: ['X'],
      max_tokens: 7,
    });
    expect(
      renderUpstreamRequest(request({ parallel_tool_calls: true }), 'anthropic'),
    ).not.toHaveProperty('tool_choice');
    expect(renderUpstreamRequest(request(), 'anthropic')).not.toHaveProperty('system');
  });

  it('maps OpenAI-compatible tools, choices and response formats', () => {
    const rendered = renderUpstreamRequest(
      request({
        messages: [
          { role: 'system', content: 'S' },
          { role: 'user', content: 'Hi' },
          {
            role: 'assistant',
            content: 'calling',
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'c1', content: 'r' },
        ],
        tools: [fn('lookup', { strict: false, description: 'd' })],
        tool_choice: { type: 'function', function: { name: 'lookup' } },
        parallel_tool_calls: false,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'Out', schema: {}, strict: true },
        },
        temperature: 0.1,
        top_p: 0.2,
        stop: ['Z'],
        user: 'u1',
        max_tokens: 9,
      }),
      'openai',
    );
    expect(rendered).toMatchObject({
      tools: [{ type: 'function', function: { name: 'lookup', strict: false, description: 'd' } }],
      tool_choice: { type: 'function', function: { name: 'lookup' } },
      parallel_tool_calls: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'Out', schema: {}, strict: true },
      },
      temperature: 0.1,
      top_p: 0.2,
      stop: ['Z'],
      user: 'u1',
      max_completion_tokens: 9,
    });
    expect((rendered.messages as unknown[]).slice(0, 1)).toEqual([
      { role: 'system', content: 'S' },
    ]);
    expect((rendered.messages as unknown[])[2]).toMatchObject({
      role: 'assistant',
      content: 'calling',
      tool_calls: [{ id: 'c1' }],
    });
    expect((rendered.messages as unknown[])[3]).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: 'r',
    });
    expect(
      renderUpstreamRequest(request({ response_format: { type: 'json_object' } }), 'custom')
        .response_format,
    ).toEqual({ type: 'json_object' });
    expect(
      renderUpstreamRequest(request({ tools: [fn()], tool_choice: 'auto' }), 'openrouter')
        .tool_choice,
    ).toBe('auto');
  });
});

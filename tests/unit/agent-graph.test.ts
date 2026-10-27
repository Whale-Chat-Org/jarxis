import { DuckDuckGoSearch } from '@langchain/community/tools/duckduckgo_search';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConfiguredGraph } from '@/agent/configured-graph';
import { createAgentGraph } from '@/agent/graph';

const searchCall = {
  name: 'web_search',
  args: { query: 'latest Jarxis news' },
  id: 'search-1',
  type: 'tool_call' as const,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('Jarxis agent graph', () => {
  it('compiles with agent and tools nodes and a return edge', () => {
    const model = { invoke: vi.fn().mockResolvedValue(new AIMessage('Done')) };
    const graph = createAgentGraph({ model, finalModel: model, search: vi.fn() });
    const structure = graph.getGraph().toJSON();
    expect(structure.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'agent' }),
        expect.objectContaining({ id: 'tools' }),
      ]),
    );
    expect(structure.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: '__start__', target: 'agent' }),
        expect.objectContaining({ source: 'tools', target: 'agent' }),
      ]),
    );
  });

  it('returns a reply without calling search', async () => {
    const model = { invoke: vi.fn().mockResolvedValue(new AIMessage('Hello')) };
    const search = vi.fn();
    const graph = createAgentGraph({ model, finalModel: model, search });
    const result = await graph.invoke({ messages: [new HumanMessage('Hi')] });
    expect(result.messages.at(-1)?.content).toBe('Hello');
    expect(model.invoke).toHaveBeenCalledOnce();
    expect(search).not.toHaveBeenCalled();
  });

  it('searches when called and passes results to the model', async () => {
    const model = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce(new AIMessage({ content: '', tool_calls: [searchCall] }))
        .mockResolvedValueOnce(new AIMessage('Recent answer')),
    };
    const search = vi
      .fn()
      .mockResolvedValue('[{"title":"Source","link":"https://example.com","snippet":"Fact"}]');
    const graph = createAgentGraph({ model, finalModel: model, search });
    const result = await graph.invoke({ messages: [new HumanMessage('What happened recently?')] });
    expect(search).toHaveBeenCalledWith('latest Jarxis news');
    expect(result.messages.at(-2)?.content).toContain('https://example.com');
    expect(result.messages.at(-2)?.name).toBeUndefined();
    expect(result.messages.at(-1)?.content).toBe('Recent answer');
  });

  it('passes search failure to the model and still returns a reply', async () => {
    const model = {
      invoke: vi
        .fn()
        .mockResolvedValueOnce(new AIMessage({ content: '', tool_calls: [searchCall] }))
        .mockResolvedValueOnce(new AIMessage('I could not search.')),
    };
    const graph = createAgentGraph({
      model,
      finalModel: model,
      search: vi.fn().mockRejectedValue(new Error('private upstream detail')),
    });
    const result = await graph.invoke({ messages: [new HumanMessage('Current news?')] });
    expect(result.messages.at(-2)?.content).toContain('Web search is unavailable');
    expect(result.messages.at(-2)?.content).not.toContain('private upstream detail');
    expect(result.messages.at(-1)?.content).toBe('I could not search.');
  });

  it('forces a final answer after five tool rounds', async () => {
    const model = {
      invoke: vi
        .fn()
        .mockImplementation(async () => new AIMessage({ content: '', tool_calls: [searchCall] })),
    };
    const finalModel = { invoke: vi.fn().mockResolvedValue(new AIMessage('Final answer')) };
    const graph = createAgentGraph({
      model,
      finalModel,
      search: vi.fn().mockResolvedValue('Result'),
    });
    const result = await graph.invoke({ messages: [new HumanMessage('Search repeatedly')] });
    expect(model.invoke).toHaveBeenCalledTimes(5);
    expect(finalModel.invoke).toHaveBeenCalledOnce();
    expect(result.messages.at(-1)?.content).toBe('Final answer');

    model.invoke.mockResolvedValueOnce(new AIMessage('Another answer'));
    const next = await graph.invoke({
      messages: [...result.messages, new HumanMessage('A new question')],
    });
    expect(model.invoke).toHaveBeenCalledTimes(6);
    expect(finalModel.invoke).toHaveBeenCalledOnce();
    expect(next.messages.at(-1)?.content).toBe('Another answer');
  });
});

describe('Jarxis gateway model', () => {
  function configure() {
    vi.stubEnv('JARXIS_AGENT_GATEWAY_URL', 'http://localhost:3000/api/llm/v1');
    vi.stubEnv('JARXIS_AGENT_GATEWAY_KEY', 'jml_test_secret');
    vi.stubEnv('JARXIS_AGENT_MODEL', 'test-model');
  }

  it('calls Chat Completions with the gateway key and no provider key', async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'test-model',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Gateway reply' },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const graph = createConfiguredGraph();
    const result = await graph.invoke({ messages: [new HumanMessage('Hello')] });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(request.headers);
    expect(url).toBe('http://localhost:3000/api/llm/v1/chat/completions');
    expect(headers.get('authorization')).toBe('Bearer jml_test_secret');
    expect(JSON.parse(request.body as string)).toMatchObject({
      model: 'test-model',
      stream: false,
      tools: [{ type: 'function', function: { name: 'web_search' } }],
    });
    expect(result.messages.at(-1)?.content).toBe('Gateway reply');
  });

  it('reports invalid gateway credentials without exposing the response', async () => {
    configure();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: { message: 'sensitive provider detail' },
          },
          { status: 401 },
        ),
      ),
    );
    const graph = createConfiguredGraph();
    await expect(graph.invoke({ messages: [new HumanMessage('Hello')] })).rejects.toThrow(
      'Jarxis gateway authentication failed',
    );
  });

  it('sends tool results in the gateway supported message shape', async () => {
    configure();
    const search = vi
      .spyOn(DuckDuckGoSearch.prototype, 'invoke')
      .mockResolvedValue('[{"title":"Source","link":"https://example.com","snippet":"Fact"}]');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          id: 'chatcmpl-tool',
          object: 'chat.completion',
          created: 1,
          model: 'test-model',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'search-1',
                    type: 'function',
                    function: { name: 'web_search', arguments: '{"query":"latest news"}' },
                  },
                ],
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          id: 'chatcmpl-final',
          object: 'chat.completion',
          created: 2,
          model: 'test-model',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: 'Recent answer' },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const result = await createConfiguredGraph().invoke({
      messages: [new HumanMessage('Latest news?')],
    });
    const secondRequest = JSON.parse(
      (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
    );
    expect(secondRequest.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'search-1' });
    expect(secondRequest.messages.at(-1)).not.toHaveProperty('name');
    expect(search).toHaveBeenCalledWith('latest news');
    expect(result.messages.at(-1)?.content).toBe('Recent answer');
  });
});

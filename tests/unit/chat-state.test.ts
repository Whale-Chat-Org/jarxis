import { describe, expect, it } from 'vitest';
import { blockText, data } from '../../src/components/chat/chat-data';
import { chatReducer, initialState } from '../../src/components/chat/chat-state';

const conversation = {
  id: 'test',
  title: 'New conversation',
  group: 'Today',
  pinned: false,
  modelId: 'custom',
  messages: [],
};
function sending() {
  const state = chatReducer(initialState, { type: 'new', conversation });
  return chatReducer(state, {
    type: 'send',
    id: 'test',
    message: {
      id: 'u',
      role: 'user',
      text: 'A plan',
      attachments: [{ id: 'f', name: 'notes.txt', size: 10 }],
    },
    assistantId: 'a',
    blocks: data.responses.default,
  });
}
describe('local chat transitions', () => {
  it('creates a conversation, preserves its selected model, and includes local attachments', () => {
    const state = sending();
    expect(state.activeId).toBe('test');
    expect(state.conversations[0]).toMatchObject({ title: 'A plan', modelId: 'custom' });
    expect(state.conversations[0].messages[0].attachments?.[0].name).toBe('notes.txt');
    expect(initialState.conversations).toHaveLength(4);
  });
  it('streams to the full structured reply and stops ticking afterward', () => {
    let state = sending();
    for (let n = 0; n < 100; n++) state = chatReducer(state, { type: 'tick' });
    expect(state.streaming).toBeNull();
    expect(state.conversations[0].messages[1].text).toBe(blockText(data.responses.default));
    expect(state.conversations[0].messages[1].blocks).toEqual(data.responses.default);
    expect(chatReducer(state, { type: 'tick' })).toBe(state);
  });
  it('stops without completing the partial reply, and switching cancels generation', () => {
    const partial = chatReducer(sending(), { type: 'tick' });
    const stopped = chatReducer(partial, { type: 'stop' });
    expect(stopped.streaming).toBeNull();
    expect(stopped.conversations[0].messages[1].text).toHaveLength(18);
    expect(chatReducer(stopped, { type: 'tick' })).toBe(stopped);
    expect(chatReducer(partial, { type: 'select', id: 'week' }).streaming).toBeNull();
  });
  it('editing replaces subsequent turns and retains the original attachment', () => {
    const state = chatReducer(sending(), {
      type: 'edit',
      id: 'test',
      messageId: 'u',
      text: 'Welcome',
      assistantId: 'edited',
      blocks: data.responses.writing,
    });
    expect(state.conversations[0].messages.map((m) => m.id)).toEqual(['u', 'edited']);
    expect(state.conversations[0].messages[0].text).toBe('Welcome');
    expect(state.conversations[0].messages[0].attachments).toHaveLength(1);
    expect(state.streaming?.messageId).toBe('edited');
  });
  it('retry replaces the selected response and removes later turns', () => {
    const sent = sending();
    const withLaterTurn = chatReducer(sent, {
      type: 'send',
      id: 'test',
      message: { id: 'later', role: 'user', text: 'More' },
      assistantId: 'later-a',
      blocks: data.responses.code,
    });
    const state = chatReducer(withLaterTurn, {
      type: 'retry',
      id: 'test',
      messageId: 'a',
      assistantId: 'retry',
      blocks: data.responses.default,
    });
    expect(state.conversations[0].messages.map((m) => m.id)).toEqual(['u', 'retry']);
  });
  it('deletion clears the active conversation and its generation', () => {
    const state = chatReducer(sending(), { type: 'delete', id: 'test' });
    expect(state.activeId).toBeNull();
    expect(state.streaming).toBeNull();
    expect(state.conversations.some((c) => c.id === 'test')).toBe(false);
  });
  it('supports rename, pin, model changes, and toggled feedback without mutating fixtures', () => {
    let state = chatReducer(initialState, { type: 'rename', id: 'week', title: 'New title' });
    state = chatReducer(state, { type: 'pin', id: 'week' });
    state = chatReducer(state, { type: 'model', id: 'week', modelId: 'custom' });
    state = chatReducer(state, {
      type: 'feedback',
      id: 'week',
      messageId: 'week-assistant',
      value: 'positive',
    });
    expect(state.conversations[0]).toMatchObject({
      title: 'New title',
      pinned: false,
      modelId: 'custom',
    });
    expect(state.conversations[0].messages[1].feedback).toBe('positive');
    state = chatReducer(state, {
      type: 'feedback',
      id: 'week',
      messageId: 'week-assistant',
      value: 'positive',
    });
    expect(state.conversations[0].messages[1].feedback).toBeUndefined();
    expect(data.conversations[0].title).toBe('A more focused week');
  });
});

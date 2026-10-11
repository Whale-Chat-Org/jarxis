import {
  blockText,
  data,
  type ChatMessage,
  type ContentBlock,
  type Conversation,
} from './chat-data';
export type ChatState = {
  conversations: Conversation[];
  activeId: string | null;
  streaming: {
    conversationId: string;
    messageId: string;
    blocks: ContentBlock[];
    cursor: number;
  } | null;
};
export const initialState: ChatState = {
  conversations: data.conversations,
  activeId: null,
  streaming: null,
};
export type ChatAction =
  | { type: 'new'; conversation: Conversation }
  | { type: 'select'; id: string }
  | { type: 'delete'; id: string }
  | { type: 'pin'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'model'; id: string; modelId: string }
  | { type: 'send'; id: string; message: ChatMessage; assistantId: string; blocks: ContentBlock[] }
  | {
      type: 'edit';
      id: string;
      messageId: string;
      text: string;
      assistantId: string;
      blocks: ContentBlock[];
    }
  | { type: 'retry'; id: string; messageId: string; assistantId: string; blocks: ContentBlock[] }
  | { type: 'feedback'; id: string; messageId: string; value: 'positive' | 'negative' }
  | { type: 'tick' }
  | { type: 'stop' };
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  if (action.type === 'new')
    return {
      ...state,
      conversations: [action.conversation, ...state.conversations],
      activeId: action.conversation.id,
      streaming: null,
    };
  if (action.type === 'select') return { ...state, activeId: action.id, streaming: null };
  if (action.type === 'stop') return { ...state, streaming: null };
  if (action.type === 'delete')
    return {
      ...state,
      conversations: state.conversations.filter((c) => c.id !== action.id),
      activeId: state.activeId === action.id ? null : state.activeId,
      streaming: state.streaming?.conversationId === action.id ? null : state.streaming,
    };
  if (action.type === 'tick') {
    if (!state.streaming) return state;
    const stream = state.streaming;
    const full = blockText(stream.blocks);
    const cursor = Math.min(full.length, stream.cursor + 18);
    return {
      ...state,
      streaming: cursor === full.length ? null : { ...stream, cursor },
      conversations: state.conversations.map((c) =>
        c.id !== stream.conversationId
          ? c
          : {
              ...c,
              messages: c.messages.map((m) =>
                m.id !== stream.messageId
                  ? m
                  : {
                      ...m,
                      text: full.slice(0, cursor),
                      blocks: cursor === full.length ? stream.blocks : undefined,
                    },
              ),
            },
      ),
    };
  }
  let streaming = state.streaming;
  const conversations = state.conversations.map((c) => {
    if (c.id !== action.id) return c;
    if (action.type === 'rename') return { ...c, title: action.title.trim() || c.title };
    if (action.type === 'pin') return { ...c, pinned: !c.pinned };
    if (action.type === 'model') return { ...c, modelId: action.modelId };
    if (action.type === 'feedback')
      return {
        ...c,
        messages: c.messages.map((m) =>
          m.id === action.messageId
            ? { ...m, feedback: m.feedback === action.value ? undefined : action.value }
            : m,
        ),
      };
    let messages = c.messages;
    if (action.type === 'send') messages = [...messages, action.message];
    if (action.type === 'edit' || action.type === 'retry') {
      const index = messages.findIndex((m) => m.id === action.messageId);
      if (index < 0) return c;
      messages =
        action.type === 'edit'
          ? [
              ...messages.slice(0, index),
              { ...messages[index], text: action.text, blocks: undefined },
            ]
          : messages.slice(0, index);
    }
    streaming = {
      conversationId: c.id,
      messageId: action.assistantId,
      blocks: action.blocks,
      cursor: 0,
    };
    return {
      ...c,
      title: c.messages.length === 0 ? messages[0].text.slice(0, 60) || 'Attached files' : c.title,
      messages: [...messages, { id: action.assistantId, role: 'assistant' as const, text: '' }],
    };
  });
  return { ...state, conversations, streaming };
}

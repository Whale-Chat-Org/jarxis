import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Theme</button> }));

import { ChatPage } from '@/components/chat/chat-page';

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
});

function renderChat() {
  const user = userEvent.setup();
  render(<ChatPage />);
  return user;
}

const composer = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: 'Send message' });
const sidebarGroup = (label: string) =>
  screen.getByText(label, { selector: '[data-slot="sidebar-group-label"]' })
    .parentElement as HTMLElement;

async function openConversation(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: title }));
}

async function waitForStreamEnd() {
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop response' })).toBeNull(), {
    timeout: 5000,
  });
}

describe('ChatPage sidebar', () => {
  it('starts on the empty state with grouped conversations', () => {
    renderChat();
    expect(screen.getByRole('heading', { name: 'What’s on your mind?' })).toBeTruthy();
    expect(screen.getByText('Your space to think')).toBeTruthy();
    expect(within(sidebarGroup('Pinned')).getByText('A more focused week')).toBeTruthy();
    expect(within(sidebarGroup('Today')).getByText('Ideas for a calmer workspace')).toBeTruthy();
    expect(within(sidebarGroup('Yesterday')).getByText('Welcome note for the team')).toBeTruthy();
    expect(
      within(sidebarGroup('Previous 7 days')).getByText('A small TypeScript helper'),
    ).toBeTruthy();
    expect(screen.getByText('Alex Morgan')).toBeTruthy();
    expect(screen.getByText('AM')).toBeTruthy();
  });

  it('filters conversations by title', async () => {
    const user = renderChat();
    const search = screen.getByRole('textbox', { name: 'Search conversations' });
    await user.type(search, 'TYPESCRIPT');
    expect(screen.getByText('A small TypeScript helper')).toBeTruthy();
    expect(screen.queryByText('A more focused week')).toBeNull();
    await user.clear(search);
    await user.type(search, 'nothing matches');
    expect(screen.getByText('No conversations found.')).toBeTruthy();
  });

  it('pins, renames and deletes a conversation', async () => {
    const user = renderChat();
    await user.click(
      screen.getByRole('button', { name: 'Actions for Ideas for a calmer workspace' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Pin conversation' }));
    expect(within(sidebarGroup('Pinned')).getByText('Ideas for a calmer workspace')).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: 'Actions for Ideas for a calmer workspace' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Unpin conversation' }));
    expect(within(sidebarGroup('Today')).getByText('Ideas for a calmer workspace')).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: 'Actions for Ideas for a calmer workspace' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Rename conversation' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Rename conversation')).toBeTruthy();
    const name = within(dialog).getByRole('textbox', { name: 'Conversation name' });
    expect((name as HTMLInputElement).value).toBe('Ideas for a calmer workspace');
    await user.clear(name);
    expect(within(dialog).getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(
      true,
    );
    await user.type(name, 'Calm desk');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Calm desk' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Actions for Calm desk' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete conversation' }));
    const confirm = await screen.findByRole('dialog');
    expect(
      within(confirm).getByText('This removes the conversation from this session.'),
    ).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Calm desk' })).toBeNull());
  });

  it('cancels the dialog without changes', async () => {
    const user = renderChat();
    await user.click(screen.getByRole('button', { name: 'Actions for A more focused week' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete conversation' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'A more focused week' })).toBeTruthy();
  });
});

describe('ChatPage conversation view', () => {
  it('renders rich blocks, attachments and code', async () => {
    const user = renderChat();
    await openConversation(user, 'A more focused week');
    const messages = screen.getByLabelText('Conversation messages');
    expect(
      within(messages).getByRole('heading', { name: 'Start with three priorities' }),
    ).toBeTruthy();
    expect(
      within(messages).getByText('Choose one outcome that matters most this week.'),
    ).toBeTruthy();
    expect(
      within(messages).getByText('A good plan creates space. It does not have to fill every hour.')
        .tagName,
    ).toBe('BLOCKQUOTE');
    expect(within(messages).getByText('Weekly outline.txt')).toBeTruthy();
    expect(within(messages).getByText('1 KB · Local attachment')).toBeTruthy();
    expect(within(messages).getByText('You')).toBeTruthy();
    expect(within(messages).getByText('Jarxis')).toBeTruthy();
    expect(screen.getAllByText('A more focused week').length).toBeGreaterThan(1);

    await openConversation(user, 'A small TypeScript helper');
    expect(
      screen.getByText('const grouped = Object.groupBy(tasks, (task) => task.status);').tagName,
    ).toBe('CODE');
  });

  it('copies messages and reports failures', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = renderChat();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await openConversation(user, 'A small TypeScript helper');
    const [userCopy, assistantCopy] = screen.getAllByRole('button', { name: 'Copy message' });
    await user.click(userCopy);
    expect(writeText).toHaveBeenLastCalledWith('How can I group a list of tasks?');
    await user.click(assistantCopy);
    // Rich replies copy their block text.
    expect(writeText).toHaveBeenLastCalledWith(
      'const grouped = Object.groupBy(tasks, (task) => task.status);',
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Message copied'));

    writeText.mockRejectedValueOnce(new Error('blocked'));
    await user.click(userCopy);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not copy message'));
  });

  it('toggles feedback on a reply', async () => {
    const user = renderChat();
    await openConversation(user, 'Ideas for a calmer workspace');
    const good = screen.getByRole('button', { name: 'Good response' });
    const poor = screen.getByRole('button', { name: 'Poor response' });
    await user.click(good);
    expect(good.getAttribute('aria-pressed')).toBe('true');
    await user.click(poor);
    expect(poor.getAttribute('aria-pressed')).toBe('true');
    expect(good.getAttribute('aria-pressed')).toBe('false');
    await user.click(poor);
    expect(poor.getAttribute('aria-pressed')).toBe('false');
  });

  it('retries a reply and streams a new answer', async () => {
    const user = renderChat();
    await openConversation(user, 'Welcome note for the team');
    await user.click(screen.getByRole('button', { name: 'Retry response' }));
    expect(screen.getByRole('button', { name: 'Stop response' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry response' }).hasAttribute('disabled')).toBe(
      true,
    );
    await waitForStreamEnd();
    // The prompt mentions "welcome", so the writing response is used.
    expect(await screen.findByRole('heading', { name: 'A warm welcome' })).toBeTruthy();
  });

  it('edits a user message and regenerates the reply', async () => {
    const user = renderChat();
    await openConversation(user, 'Ideas for a calmer workspace');
    await user.click(screen.getByRole('button', { name: 'Edit message' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit message')).toBeTruthy();
    const text = within(dialog).getByRole('textbox', { name: 'Edit message text' });
    expect((text as HTMLTextAreaElement).value).toBe('What makes a workspace feel calmer?');
    await user.clear(text);
    await user.type(text, 'Show me a TypeScript function');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(screen.getByText('Show me a TypeScript function')).toBeTruthy();
    await waitForStreamEnd();
    expect(
      await screen.findByText('Here’s a small, typed helper that groups tasks by their status:'),
    ).toBeTruthy();
  });

  it('starts a new chat from the sidebar', async () => {
    const user = renderChat();
    await openConversation(user, 'A more focused week');
    await user.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.getByText('Your space to think')).toBeTruthy();
    expect(within(sidebarGroup('Today')).getByText('New conversation')).toBeTruthy();
    // The new chat inherits the previous conversation's model.
    expect(screen.getByRole('button', { name: 'Select model' }).textContent).toContain(
      'Claude Sonnet',
    );

    await user.click(screen.getByRole('button', { name: 'Select model' }));
    await user.click(await screen.findByRole('menuitem', { name: /Local model/ }));
    expect(screen.getByRole('button', { name: 'Select model' }).textContent).toContain(
      'Local model',
    );
  });
});

describe('ChatComposer through ChatPage', () => {
  it('sends with Enter, streams, and can be stopped', async () => {
    const user = renderChat();
    await user.type(composer(), 'Plan my day{Enter}');
    expect(screen.getAllByText('Plan my day').length).toBeGreaterThan(0);
    expect(screen.getByText('Thinking…')).toBeTruthy();
    expect(composer().value).toBe('');
    await user.click(screen.getByRole('button', { name: 'Stop response' }));
    expect(sendButton()).toBeTruthy();
    expect(within(sidebarGroup('Today')).getByText('Plan my day')).toBeTruthy();
  });

  it('keeps Shift+Enter as a newline and blocks whitespace-only messages', async () => {
    const user = renderChat();
    expect(sendButton().hasAttribute('disabled')).toBe(true);
    await user.type(composer(), '   {Enter}');
    expect(screen.getByRole('heading', { name: 'What’s on your mind?' })).toBeTruthy();
    await user.clear(composer());
    await user.type(composer(), 'line one{Shift>}{Enter}{/Shift}line two');
    expect(composer().value).toBe('line one\nline two');
    expect(screen.getByRole('heading', { name: 'What’s on your mind?' })).toBeTruthy();
    await user.click(sendButton());
    await waitForStreamEnd();
    expect(screen.getAllByText(/line one/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'A practical starting point' })).toBeTruthy();
  });

  it('fills the composer from a suggestion and changes the default model', async () => {
    const user = renderChat();
    await user.click(screen.getByRole('button', { name: /Write something/ }));
    expect(composer().value).toBe('Write a warm introduction for a new team member.');

    await user.click(screen.getByRole('button', { name: 'Select model' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Choose a model')).toBeTruthy();
    await user.click(within(menu).getByRole('menuitem', { name: /Claude Sonnet/ }));
    expect(screen.getByRole('button', { name: 'Select model' }).textContent).toContain(
      'Claude Sonnet',
    );
  });

  it('changes the model inside a conversation', async () => {
    const user = renderChat();
    await openConversation(user, 'Ideas for a calmer workspace');
    expect(screen.getByRole('button', { name: 'Select model' }).textContent).toContain('GPT-5');
    await user.click(screen.getByRole('button', { name: 'Select model' }));
    await user.click(await screen.findByRole('menuitem', { name: /Gemini via OpenRouter/ }));
    expect(screen.getByRole('button', { name: 'Select model' }).textContent).toContain('Gemini');
  });

  it('attaches and sends files without text', async () => {
    const user = renderChat();
    const input = screen.getByLabelText('Attach files') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: 'Add attachments' }));
    expect(click).toHaveBeenCalled();

    await user.upload(input, [
      new File(['a'], 'notes.txt', { type: 'text/plain' }),
      new File(['b'.repeat(4096)], 'big.txt', { type: 'text/plain' }),
    ]);
    expect(screen.getByText('notes.txt')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove big.txt' })).toBeTruthy();
    expect(sendButton().hasAttribute('disabled')).toBe(false);

    await user.click(sendButton());
    expect(within(sidebarGroup('Today')).getByText('Attached files')).toBeTruthy();
    expect(screen.getByText('4 KB · Local attachment')).toBeTruthy();
  });
});

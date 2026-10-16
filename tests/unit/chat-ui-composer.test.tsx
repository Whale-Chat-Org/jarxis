import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChatComposer } from '@/components/chat/chat-composer';

function Harness({
  onSend,
  onStop = () => {},
  streaming = false,
}: {
  onSend: (text: string, files: { name: string }[]) => void;
  onStop?: () => void;
  streaming?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('openai');
  return (
    <ChatComposer
      modelId={model}
      onModel={setModel}
      onSend={onSend}
      streaming={streaming}
      onStop={onStop}
      draft={draft}
      onDraft={setDraft}
    />
  );
}

describe('ChatComposer', () => {
  it('trims and sends the draft, then clears it', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
    await user.type(box, '  hi there  {Enter}');
    expect(onSend).toHaveBeenCalledWith('hi there', []);
    expect(box.value).toBe('');
  });

  it('ignores Enter while an IME composition is active', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message' });
    await user.type(box, 'abc');
    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
    );
    expect(onSend).not.toHaveBeenCalled();
  });

  it('shows a stop button while streaming and never sends', async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSend={onSend} onStop={onStop} streaming />);
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'queued{Enter}');
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop response' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('marks the selected model in the menu', async () => {
    const user = userEvent.setup();
    render(<Harness onSend={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Select model' }));
    const items = await screen.findAllByRole('menuitem');
    expect(items).toHaveLength(4);
    expect(items[0].querySelectorAll('svg').length).toBe(1);
    expect(items[1].querySelectorAll('svg').length).toBe(0);
  });

  // Known bug: AttachmentAction renders a <Button> without type="button" inside the composer
  // <form>, so clicking "Remove <file>" submits the form and sends the message (with the stale
  // attachment list) instead of only removing the chip. Flip to `it` once the source is fixed.
  it.fails('removes an attachment without sending the message', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSend={onSend} />);
    await user.upload(screen.getByLabelText('Attach files'), [
      new File(['a'], 'a.txt'),
      new File(['b'], 'b.txt'),
    ]);
    await user.click(screen.getByRole('button', { name: 'Remove a.txt' }));
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.queryByText('a.txt')).toBeNull();
    expect(screen.getByText('b.txt')).toBeTruthy();
  });
});

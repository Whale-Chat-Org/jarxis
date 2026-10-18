'use client';

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentTitle,
} from '@/components/ui/attachment';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { data, type ChatAttachment } from './chat-data';

export function ChatComposer({
  modelId,
  onModel,
  onSend,
  streaming,
  onStop,
  draft,
  onDraft,
}: {
  modelId: string;
  onModel: (id: string) => void;
  onSend: (text: string, attachments: ChatAttachment[]) => void;
  streaming: boolean;
  onStop: () => void;
  draft: string;
  onDraft: (text: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const model = data.models.find((m) => m.id === modelId)!;
  function send() {
    if (streaming || (!draft.trim() && !attachments.length)) return;
    onSend(draft.trim(), attachments);
    onDraft('');
    setAttachments([]);
  }
  return (
    <form
      className="w-full"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
      aria-label="Message composer"
    >
      <Input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        aria-label="Attach files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          setAttachments((current) => [
            ...current,
            ...files.map((file) => ({
              id: crypto.randomUUID(),
              name: file.name,
              size: file.size,
            })),
          ]);
          event.target.value = '';
        }}
      />
      <InputGroup className="rounded-3xl bg-card shadow-sm">
        {attachments.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap">
            {attachments.map((file) => (
              <Attachment key={file.id} size="xs" className="min-w-none">
                <AttachmentContent>
                  <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
                </AttachmentContent>
                <AttachmentActions>
                  <AttachmentAction
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setAttachments((current) => current.filter((a) => a.id !== file.id))
                    }
                  >
                    <XIcon />
                  </AttachmentAction>
                </AttachmentActions>
              </Attachment>
            ))}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          aria-label="Message"
          placeholder="Ask anything…"
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          className="max-h-list-max min-h-textarea-min px-lg text-body"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
        <InputGroupAddon align="block-end" className="justify-between gap-inline">
          <InputGroupButton
            size="icon-sm"
            aria-label="Add attachments"
            onClick={() => fileInput.current?.click()}
          >
            <PaperclipIcon />
          </InputGroupButton>
          <div className="flex min-w-none items-center gap-inline">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <InputGroupButton size="sm" className="min-w-none" aria-label="Select model">
                  <span className="max-w-name-max truncate">{model.name}</span>
                  <ChevronDownIcon />
                </InputGroupButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-viewport-inset">
                <DropdownMenuLabel>Choose a model</DropdownMenuLabel>
                {data.models.map((item) => (
                  <DropdownMenuItem key={item.id} onSelect={() => onModel(item.id)}>
                    <div className="flex min-w-none flex-1 flex-col">
                      <span>{item.name}</span>
                      <span className="text-caption text-muted-foreground">
                        {item.provider} · {item.description}
                      </span>
                    </div>
                    {modelId === item.id && <CheckIcon />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {streaming ? (
              <InputGroupButton
                size="icon-sm"
                variant="default"
                aria-label="Stop response"
                onClick={onStop}
              >
                <SquareIcon />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                size="icon-sm"
                variant="default"
                className="rounded-full"
                aria-label="Send message"
                disabled={!draft.trim() && !attachments.length}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}

'use client';

import {
  CopyIcon,
  FileTextIcon,
  PencilIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from '@/components/ui/attachment';
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import { Marker, MarkerContent } from '@/components/ui/marker';
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { blockText, type ChatMessage, type Conversation } from './chat-data';
import { type ChatAction } from './chat-state';

async function copyMessage(message: ChatMessage) {
  try {
    await navigator.clipboard.writeText(message.blocks ? blockText(message.blocks) : message.text);
    toast.success('Message copied');
  } catch {
    toast.error('Could not copy message');
  }
}

function Action({
  label,
  children,
  onClick,
  pressed,
  disabled,
}: {
  label: string;
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
export function ChatMessages({
  conversation,
  streaming,
  dispatch,
  onEdit,
  onRetry,
}: {
  conversation: Conversation;
  streaming: boolean;
  dispatch: React.Dispatch<ChatAction>;
  onEdit: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
}) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller>
        <MessageScrollerViewport aria-label="Conversation messages">
          <MessageScrollerContent className="mx-auto max-w-panel gap-section px-page py-section md:px-page-lg">
            <Marker variant="separator">
              <MarkerContent>{conversation.group}</MarkerContent>
            </Marker>
            {conversation.messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === 'user'}
              >
                <Message align={message.role === 'user' ? 'end' : 'start'}>
                  <MessageContent>
                    <MessageHeader>{message.role === 'user' ? 'You' : 'Jarxis'}</MessageHeader>
                    <Bubble
                      variant={message.role === 'user' ? 'secondary' : 'ghost'}
                      align={message.role === 'user' ? 'end' : 'start'}
                    >
                      <BubbleContent className="space-y-stack text-body leading-relaxed">
                        {message.blocks ? (
                          message.blocks.map((block, index) => {
                            if (block.type === 'heading')
                              return (
                                <h2 key={index} className="text-heading font-semibold">
                                  {block.text}
                                </h2>
                              );
                            if (block.type === 'list')
                              return (
                                <ul key={index} className="list-disc space-y-stack-sm pl-lg-plus">
                                  {block.items.map((item) => (
                                    <li key={item}>{item}</li>
                                  ))}
                                </ul>
                              );
                            if (block.type === 'quote')
                              return (
                                <blockquote
                                  key={index}
                                  className="border-l-2 border-border pl-lg text-muted-foreground"
                                >
                                  {block.text}
                                </blockquote>
                              );
                            if (block.type === 'code')
                              return (
                                <pre
                                  key={index}
                                  className="overflow-x-auto rounded-lg bg-muted p-lg text-body-sm"
                                >
                                  <code>{block.text}</code>
                                </pre>
                              );
                            return <p key={index}>{block.text}</p>;
                          })
                        ) : (
                          <p className="whitespace-pre-wrap">{message.text || 'Thinking…'}</p>
                        )}
                      </BubbleContent>
                    </Bubble>
                    {message.attachments && (
                      <div className="flex flex-wrap gap-inline">
                        {message.attachments.map((file) => (
                          <Attachment key={file.id} size="sm">
                            <AttachmentMedia>
                              <FileTextIcon />
                            </AttachmentMedia>
                            <AttachmentContent>
                              <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
                              <AttachmentDescription>
                                {Math.max(1, Math.round(file.size / 1024))} KB · Local attachment
                              </AttachmentDescription>
                            </AttachmentContent>
                          </Attachment>
                        ))}
                      </div>
                    )}
                    <MessageFooter className="gap-2xs">
                      <Action
                        label="Copy message"
                        onClick={() => {
                          void copyMessage(message);
                        }}
                      >
                        <CopyIcon />
                      </Action>
                      {message.role === 'user' ? (
                        <Action
                          label="Edit message"
                          disabled={streaming}
                          onClick={() => onEdit(message)}
                        >
                          <PencilIcon />
                        </Action>
                      ) : (
                        <>
                          <Action
                            label="Retry response"
                            disabled={streaming}
                            onClick={() => onRetry(message)}
                          >
                            <RefreshCwIcon />
                          </Action>
                          <Action
                            label="Good response"
                            pressed={message.feedback === 'positive'}
                            onClick={() =>
                              dispatch({
                                type: 'feedback',
                                id: conversation.id,
                                messageId: message.id,
                                value: 'positive',
                              })
                            }
                          >
                            <ThumbsUpIcon />
                          </Action>
                          <Action
                            label="Poor response"
                            pressed={message.feedback === 'negative'}
                            onClick={() =>
                              dispatch({
                                type: 'feedback',
                                id: conversation.id,
                                messageId: message.id,
                                value: 'negative',
                              })
                            }
                          >
                            <ThumbsDownIcon />
                          </Action>
                        </>
                      )}
                    </MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

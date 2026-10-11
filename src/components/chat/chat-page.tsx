'use client';

import { useEffect, useReducer, useState } from 'react';
import {
  ArrowUpRightIcon,
  CheckIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  TrashIcon,
} from 'lucide-react';
import { BrandMark } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { ChatComposer } from './chat-composer';
import {
  data,
  responseFor,
  type ChatAttachment,
  type ChatMessage,
  type Conversation,
} from './chat-data';
import { ChatMessages } from './chat-messages';
import { chatReducer, initialState } from './chat-state';

type Modal =
  | { type: 'rename' | 'delete'; conversation: Conversation }
  | { type: 'edit'; message: ChatMessage; conversation: Conversation };
export function ChatPage() {
  return (
    <SidebarProvider className="h-svh min-h-none overflow-hidden">
      <ChatWorkspace />
    </SidebarProvider>
  );
}
function ChatWorkspace() {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [defaultModel, setDefaultModel] = useState(data.models[0].id);
  const [modal, setModal] = useState<Modal | null>(null);
  const [modalText, setModalText] = useState('');
  const { setOpenMobile } = useSidebar();
  const conversation = state.conversations.find((c) => c.id === state.activeId);
  const hasMessages = Boolean(conversation?.messages.length);
  const streamId = state.streaming?.messageId;
  useEffect(() => {
    if (!streamId) return;
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), 35);
    return () => window.clearInterval(timer);
  }, [streamId]);
  function select(id: string) {
    dispatch({ type: 'select', id });
    setDraft('');
    setOpenMobile(false);
  }
  function newChat() {
    dispatch({
      type: 'new',
      conversation: {
        id: crypto.randomUUID(),
        title: 'New conversation',
        group: 'Today',
        pinned: false,
        modelId: conversation?.modelId ?? defaultModel,
        messages: [],
      },
    });
    setDraft('');
    setOpenMobile(false);
  }
  function send(text: string, attachments: ChatAttachment[]) {
    let id = conversation?.id;
    if (!id) {
      id = crypto.randomUUID();
      dispatch({
        type: 'new',
        conversation: {
          id,
          title: 'New conversation',
          group: 'Today',
          pinned: false,
          modelId: defaultModel,
          messages: [],
        },
      });
    }
    dispatch({
      type: 'send',
      id,
      message: { id: crypto.randomUUID(), role: 'user', text, attachments },
      assistantId: crypto.randomUUID(),
      blocks: responseFor(text),
    });
  }
  function openModal(value: Modal) {
    setModal(value);
    setModalText(value.type === 'edit' ? value.message.text : value.conversation.title);
  }
  function retry(message: ChatMessage) {
    if (!conversation) return;
    const index = conversation.messages.findIndex((m) => m.id === message.id);
    const prompt =
      conversation.messages.slice(0, index).findLast((m) => m.role === 'user')?.text ?? '';
    dispatch({
      type: 'retry',
      id: conversation.id,
      messageId: message.id,
      assistantId: crypto.randomUUID(),
      blocks: responseFor(prompt),
    });
  }
  const filtered = state.conversations.filter((c) =>
    c.title.toLowerCase().includes(search.toLowerCase()),
  );
  const groups = [
    { label: 'Pinned', items: filtered.filter((c) => c.pinned) },
    ...data.groups.map((group) => ({
      label: group,
      items: filtered.filter((c) => !c.pinned && c.group === group),
    })),
  ];
  return (
    <>
      <Sidebar collapsible="offcanvas" className="border-r border-sidebar-border">
        <SidebarHeader className="gap-stack p-page">
          <div className="flex items-center gap-inline">
            <BrandMark />
            <span className="text-title font-semibold tracking-tight">Jarxis</span>
          </div>
          <Button onClick={newChat} variant="outline" className="justify-start">
            <PlusIcon />
            New chat
          </Button>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search conversations"
              placeholder="Search conversations"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </InputGroup>
        </SidebarHeader>
        <SidebarContent className="px-sm">
          {groups.map(
            ({ label, items }) =>
              items.length > 0 && (
                <SidebarGroup key={label}>
                  <SidebarGroupLabel>{label}</SidebarGroupLabel>
                  <SidebarMenu>
                    {items.map((item) => (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton
                          isActive={item.id === state.activeId}
                          onClick={() => select(item.id)}
                          title={item.title}
                        >
                          <MessageCircleIcon />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction aria-label={`Actions for ${item.title}`}>
                              <MoreHorizontalIcon />
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem
                              onSelect={() => dispatch({ type: 'pin', id: item.id })}
                            >
                              <PinIcon />
                              {item.pinned ? 'Unpin conversation' : 'Pin conversation'}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => openModal({ type: 'rename', conversation: item })}
                            >
                              <PencilIcon />
                              Rename conversation
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => openModal({ type: 'delete', conversation: item })}
                            >
                              <TrashIcon />
                              Delete conversation
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroup>
              ),
          )}
          {filtered.length === 0 && (
            <p className="p-page text-body-sm text-muted-foreground">No conversations found.</p>
          )}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-page">
          <div className="flex items-center gap-md">
            <Avatar>
              <AvatarFallback>{data.profile.initials}</AvatarFallback>
            </Avatar>
            <div className="min-w-none">
              <p className="truncate text-body-sm font-medium">{data.profile.name}</p>
              <p className="text-caption text-muted-foreground">{data.profile.label}</p>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="h-svh min-w-none overflow-hidden bg-background">
        <header className="flex h-header shrink-0 items-center justify-between gap-inline border-b border-border/50 px-page md:px-page-lg">
          <div className="flex min-w-none items-center gap-inline">
            <SidebarTrigger />
            <span className="truncate text-body-sm font-medium">
              {hasMessages ? conversation?.title : 'Your space to think'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-inline">
            <ThemeToggle />
          </div>
        </header>
        {hasMessages && conversation ? (
          <div className="min-h-none flex-1">
            <ChatMessages
              key={conversation.id}
              conversation={conversation}
              streaming={Boolean(state.streaming)}
              dispatch={dispatch}
              onEdit={(message) => openModal({ type: 'edit', message, conversation })}
              onRetry={retry}
            />
          </div>
        ) : (
          <div className="flex min-h-none flex-1 flex-col items-center overflow-y-auto px-page py-section md:px-page-lg">
            <div className="my-auto w-full max-w-panel space-y-section">
              <div className="space-y-stack-sm text-center">
                <SparklesIcon className="mx-auto size-icon-xl text-muted-foreground" />
                <p className="text-body-sm text-muted-foreground">
                  A little curiosity goes a long way
                </p>
                <h1 className="text-headline font-medium tracking-tight sm:text-display">
                  What’s on your mind?
                </h1>
              </div>
              <ChatComposer
                key={state.activeId ?? 'empty'}
                modelId={conversation?.modelId ?? defaultModel}
                onModel={(modelId) =>
                  conversation
                    ? dispatch({ type: 'model', id: conversation.id, modelId })
                    : setDefaultModel(modelId)
                }
                onSend={send}
                streaming={false}
                onStop={() => dispatch({ type: 'stop' })}
                draft={draft}
                onDraft={setDraft}
              />
              <div className="grid grid-cols-1 gap-stack-sm sm:grid-cols-2">
                {data.suggestions.map((suggestion) => (
                  <Button
                    key={suggestion.title}
                    variant="ghost"
                    className="h-auto min-w-none justify-between rounded-xl border border-border/60 p-lg text-left whitespace-normal"
                    onClick={() => setDraft(suggestion.prompt)}
                  >
                    <span className="min-w-none">
                      <span className="block text-body-sm font-medium">{suggestion.title}</span>
                      <span className="mt-2xs block text-caption font-normal text-muted-foreground">
                        {suggestion.description}
                      </span>
                    </span>
                    <ArrowUpRightIcon className="shrink-0 text-muted-foreground" />
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
        {hasMessages && (
          <div className="mx-auto w-full max-w-panel shrink-0 px-page pt-stack-sm pb-page md:px-page-lg">
            <ChatComposer
              key={state.activeId}
              modelId={conversation!.modelId}
              onModel={(modelId) => dispatch({ type: 'model', id: conversation!.id, modelId })}
              onSend={send}
              streaming={Boolean(state.streaming)}
              onStop={() => dispatch({ type: 'stop' })}
              draft={draft}
              onDraft={setDraft}
            />
          </div>
        )}
      </SidebarInset>
      <Dialog
        open={Boolean(modal)}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!modal) return;
              if (modal.type === 'delete') dispatch({ type: 'delete', id: modal.conversation.id });
              if (modal.type === 'rename')
                dispatch({ type: 'rename', id: modal.conversation.id, title: modalText });
              if (modal.type === 'edit')
                dispatch({
                  type: 'edit',
                  id: modal.conversation.id,
                  messageId: modal.message.id,
                  text: modalText.trim(),
                  assistantId: crypto.randomUUID(),
                  blocks: responseFor(modalText),
                });
              setModal(null);
            }}
            className="space-y-stack"
          >
            <DialogHeader>
              <DialogTitle>
                {modal?.type === 'delete'
                  ? 'Delete conversation?'
                  : modal?.type === 'edit'
                    ? 'Edit message'
                    : 'Rename conversation'}
              </DialogTitle>
              <DialogDescription>
                {modal?.type === 'delete'
                  ? 'This removes the conversation from this session.'
                  : modal?.type === 'edit'
                    ? 'Messages after this one will be replaced with a new response.'
                    : 'Choose a name that makes this conversation easy to find.'}
              </DialogDescription>
            </DialogHeader>
            {modal?.type === 'edit' ? (
              <Textarea
                aria-label="Edit message text"
                value={modalText}
                onChange={(event) => setModalText(event.target.value)}
                autoFocus
              />
            ) : modal?.type === 'rename' ? (
              <Input
                aria-label="Conversation name"
                value={modalText}
                onChange={(event) => setModalText(event.target.value)}
                autoFocus
              />
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={modal?.type === 'delete' ? 'destructive' : 'default'}
                disabled={modal?.type !== 'delete' && !modalText.trim()}
              >
                {modal?.type === 'delete' ? <TrashIcon /> : <CheckIcon />}
                {modal?.type === 'delete' ? 'Delete' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

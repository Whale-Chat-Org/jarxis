'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircleIcon } from 'lucide-react';
import { toast } from 'sonner';

import Loading from '@/app/admin/ml-providers/loading';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/admin-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  discoveryFailureMessage,
  isDiscoveryFailureReason,
  MlRequestError,
  mlErrorMessage,
  readErrorCode,
} from '@/lib/ml/errors';
import { defaultBaseUrl, providerKinds } from '@/lib/ml/types';

const providers = providerKinds;
type Provider = (typeof providers)[number];
type Model = {
  id: string;
  publicId: string;
  upstreamId: string;
  displayName: string;
  enabled: boolean;
  discovered: boolean;
};
type Connection = {
  id: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  enabled: boolean;
  priority: number;
  status: string;
  discoveryStatus: string;
  discoveryError?: string | null;
  lastDiscoveredAt?: string | null;
  models: Model[];
};
type GatewayKey = {
  id: string;
  name: string;
  prefix: string;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
};
type Data = { connections: Connection[]; keys: GatewayKey[] };
type Editor = {
  id?: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  priority: string;
  manualModels: string;
};
const root = '/api/admin/ml-providers';
const emptyEditor: Editor = {
  name: '',
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  priority: '0',
  manualModels: '',
};
type PreviewModel = { id: string; name: string };
type PreviewResult = {
  status: 'loading' | 'ok' | 'unsupported' | 'failed';
  models: PreviewModel[];
  /** Fixed, client-side copy for a failure; never text taken from the response. */
  message?: string;
};
// `key` binds a result to the exact input that produced it, so a result for an
// earlier key, provider or URL is never shown for the current input.
type Preview = PreviewResult & { key: string };
const previewDelay = 700;
const genericPreviewFailure = 'Models could not be loaded. Retry, or add model IDs manually.';
const failedPreview: PreviewResult = {
  status: 'failed',
  models: [],
  message: genericPreviewFailure,
};
const safeInteger = (value: unknown, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max ? value : null;

function validApiKey(value: string) {
  return (
    value.length > 0 &&
    value.length <= 8192 &&
    [...value].every((char) => char.charCodeAt(0) > 0x20 && char.charCodeAt(0) !== 0x7f)
  );
}

function validBaseUrl(value: string) {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
  } catch {
    return false;
  }
}

// Serialised discovery request body for a create-dialog draft, or null when the
// draft cannot be previewed. Only the fields that affect the catalog are used.
function previewKey(editor: Editor | null) {
  if (!editor || editor.id) return null;
  const apiKey = editor.apiKey.trim();
  const baseUrl = editor.baseUrl.trim();
  if (!validApiKey(apiKey) || !validBaseUrl(baseUrl || defaultBaseUrl(editor.provider)))
    return null;
  return JSON.stringify({ provider: editor.provider, apiKey, ...(baseUrl ? { baseUrl } : {}) });
}

function parseDiscovery(value: unknown): PreviewResult {
  const discovery = (value as { discovery?: unknown } | null)?.discovery;
  if (!discovery || typeof discovery !== 'object') return failedPreview;
  const { status, models, reason, httpStatus, retryAfterSeconds } = discovery as Record<
    string,
    unknown
  >;
  if (status === 'unsupported') return { status, models: [] };
  if (status === 'failed' && isDiscoveryFailureReason(reason))
    return {
      status,
      models: [],
      message: discoveryFailureMessage(
        reason,
        safeInteger(httpStatus, 599),
        safeInteger(retryAfterSeconds, 86400),
      ),
    };
  if (status !== 'ok' || !Array.isArray(models)) return failedPreview;
  return {
    status,
    models: models.flatMap((model: unknown) => {
      const { id, name } = (model ?? {}) as { id?: unknown; name?: unknown };
      if (typeof id !== 'string' || !id) return [];
      return [{ id, name: typeof name === 'string' && name ? name : id }];
    }),
  };
}

function creationNotice(connection: Connection | undefined) {
  if (!connection) return 'Connection saved. Model discovery is scheduled automatically.';
  const discovered = connection.models?.filter((model) => model.discovered).length ?? 0;
  switch (connection.discoveryStatus) {
    case 'ok':
      return `Connection saved. ${discovered} ${discovered === 1 ? 'model' : 'models'} discovered.`;
    case 'unsupported':
      return 'Connection saved. This endpoint does not provide model discovery; manual models remain available.';
    case 'failed':
      return 'Connection saved, but model discovery failed. Use Refresh models to retry.';
    default:
      return 'Connection saved. Model discovery is scheduled automatically.';
  }
}

async function request<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${root}${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  // Only the status and allowlisted code travel on; the response text is never shown.
  if (!response.ok) throw new MlRequestError(response.status, await readErrorCode(response));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function MlProvidersPanel({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState('');
  // Tied to the dialog that raised it, so an old failure never appears in a different dialog.
  const [dialogError, setDialogError] = useState<{ key: string; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirmation, setConfirmation] = useState<{
    kind: 'connection' | 'key';
    id: string;
    name: string;
  } | null>(null);
  const [manualModels, setManualModels] = useState<Record<string, string>>({});
  const [keyName, setKeyName] = useState('');
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewRetry, setPreviewRetry] = useState(0);
  const previewRef = useRef<Preview | null>(null);
  const previewRun = useRef(0);
  const previewImmediate = useRef(false);
  const draftKey = previewKey(editor);
  // Saving cancels the preview; it resumes for the same draft if the save fails.
  const requestKey = busy ? null : draftKey;

  const updatePreview = useCallback((next: Preview | null) => {
    previewRef.current = next;
    setPreview(next);
  }, []);

  const dialogKey = editor
    ? `editor:${editor.id ?? 'new'}`
    : issuedKey !== null
      ? 'issued-key'
      : confirmation
        ? `confirm:${confirmation.id}`
        : null;
  // Opening, closing or switching dialogs starts clean, even when the same dialog is reopened.
  const [seenDialogKey, setSeenDialogKey] = useState(dialogKey);
  if (seenDialogKey !== dialogKey) {
    setSeenDialogKey(dialogKey);
    setDialogError(null);
  }
  const shownDialogError = dialogError && dialogError.key === dialogKey ? dialogError.message : '';

  const reload = useCallback(async (signal?: AbortSignal) => {
    const result = await request<Data>('', 'GET', undefined, signal);
    setData(result);
    setLoadError('');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void request<Data>('', 'GET', undefined, controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError('ML providers could not be loaded. Check your connection and try again.');
      });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!data?.connections.some((connection) => connection.discoveryStatus === 'pending')) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!busyRef.current)
        void reload(controller.signal).catch(() => {
          if (!controller.signal.aborted)
            setLoadError('Discovery status could not be refreshed. Showing the last loaded data.');
        });
    }, 15000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [data, reload]);

  useEffect(() => {
    if (!requestKey) return;
    const settled = previewRef.current;
    if (!previewImmediate.current && settled?.key === requestKey && settled.status !== 'loading')
      return;
    const run = ++previewRun.current;
    const controller = new AbortController();
    // Abort alone is not trusted: a response that still arrives is dropped
    // unless it belongs to the newest run.
    const current = () => !controller.signal.aborted && run === previewRun.current;
    const timer = setTimeout(
      () => {
        previewImmediate.current = false;
        updatePreview({ key: requestKey, status: 'loading', models: [] });
        void request<unknown>('/discover', 'POST', JSON.parse(requestKey), controller.signal)
          .then((result) => {
            if (current()) updatePreview({ key: requestKey, ...parseDiscovery(result) });
          })
          .catch((failure) => {
            // The preview request itself failed (blocked endpoint, our rate limit, expired session).
            if (current())
              updatePreview({
                key: requestKey,
                status: 'failed',
                models: [],
                message: mlErrorMessage(failure, genericPreviewFailure),
              });
          });
      },
      previewImmediate.current ? 0 : previewDelay,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [requestKey, previewRetry, updatePreview]);

  function closeEditor() {
    setEditor(null);
    updatePreview(null);
  }

  function retryPreview() {
    previewImmediate.current = true;
    updatePreview(null);
    setPreviewRetry((count) => count + 1);
  }

  /**
   * Run one action at a time. Failures inside an open dialog stay inline in that dialog; failures
   * of page-level actions, which have no inline place to show them, become a toast.
   */
  async function perform(
    action: () => Promise<string | void>,
    message?: string,
    fallback = 'The action could not be completed. Try again.',
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setDialogError(null);
    setNotice('');
    try {
      const result = await action();
      const text = typeof result === 'string' ? result : message;
      if (text) setNotice(text);
    } catch (failure) {
      const errorMessage = mlErrorMessage(failure, fallback);
      if (dialogKey) setDialogError({ key: dialogKey, message: errorMessage });
      else toast.error(errorMessage);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function mutate(path: string, method: string, body?: unknown) {
    await request(path, method, body);
    await reload();
  }

  function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    const input = {
      name: editor.name.trim(),
      ...(!editor.id ? { provider: editor.provider } : {}),
      priority: Number(editor.priority),
      ...(editor.baseUrl.trim() ? { baseUrl: editor.baseUrl.trim() } : {}),
      ...(editor.apiKey ? { apiKey: editor.apiKey } : {}),
      ...(!editor.id
        ? {
            manualModels: editor.manualModels
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          }
        : {}),
    };
    void perform(
      async () => {
        const result = await request<{ connection?: Connection }>(
          editor.id ? `/${editor.id}` : '',
          editor.id ? 'PATCH' : 'POST',
          input,
        );
        closeEditor();
        await reload();
        return editor.id ? undefined : creationNotice(result?.connection);
      },
      'Connection saved. Model discovery is scheduled automatically.',
      'The connection was not saved. Check the details and try again.',
    );
  }

  if (!data && !loadError) return <Loading />;

  const shownPreview: PreviewResult | null = !draftKey
    ? null
    : preview?.key === draftKey
      ? preview
      : { status: 'loading', models: [] };

  return (
    <div className="flex min-w-none flex-col gap-stack">
      <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-none">
          <h2 className="text-heading font-semibold tracking-tight">ML providers</h2>
          <p className="text-body-sm text-muted-foreground">
            Manage provider accounts, available models and gateway keys.
          </p>
        </div>
        <div className="flex flex-wrap gap-sm">
          <Button variant="outline" disabled={busy} onClick={() => void perform(() => reload())}>
            Reload
          </Button>
          {canManage && (
            <Button disabled={busy} onClick={() => setEditor({ ...emptyEditor })}>
              Add connection
            </Button>
          )}
        </div>
      </div>
      {loadError && (
        <Alert role="alert">
          <AlertCircleIcon />
          <AlertTitle>Providers not up to date</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-sm break-words">
            {loadError}
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void perform(
                  () => reload(),
                  undefined,
                  'ML providers could not be loaded. Try again shortly.',
                )
              }
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {notice && (
        <p role="status" className="text-body-sm break-words">
          {notice}
        </p>
      )}
      {data && (
        <>
          {data.connections.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>No provider connections</CardTitle>
                <CardDescription>Add an API-key provider to get started.</CardDescription>
              </CardHeader>
            </Card>
          )}
          <div className="grid min-w-none gap-stack lg:grid-cols-2 group-data-[panel-open=true]/admin-workspace:lg:grid-cols-1">
            {data.connections.map((connection) => (
              <Card key={connection.id} className="min-w-none">
                <CardHeader>
                  <CardTitle className="break-words">{connection.name}</CardTitle>
                  <CardDescription className="break-all">
                    {connection.provider} · {connection.baseUrl}
                  </CardDescription>
                  <div className="flex flex-wrap gap-sm">
                    <Badge variant="outline">{connection.status.replaceAll('_', ' ')}</Badge>
                    <Badge variant="secondary">Discovery: {connection.discoveryStatus}</Badge>
                    <Badge variant="outline">Priority {connection.priority}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex min-w-none flex-col gap-stack">
                  {connection.discoveryError && (
                    <p className="text-body-sm break-words">
                      Discovery failed: {connection.discoveryError}
                    </p>
                  )}
                  {connection.discoveryStatus === 'unsupported' && (
                    <p role="status" className="text-body-sm text-muted-foreground">
                      This endpoint does not provide model discovery. Enter model IDs manually.
                    </p>
                  )}
                  <p className="text-caption text-muted-foreground">
                    {connection.lastDiscoveredAt
                      ? `Last discovery: ${new Date(connection.lastDiscoveredAt).toLocaleString()}`
                      : 'No catalog discovered yet.'}{' '}
                    Catalogs refresh automatically every hour. Manual models remain available when
                    discovery is unsupported.
                  </p>
                  <div className="flex flex-wrap items-center gap-sm">
                    <Switch
                      aria-label={`Enable ${connection.name}`}
                      checked={connection.enabled}
                      disabled={!canManage || busy}
                      onCheckedChange={(enabled) =>
                        void perform(() => mutate(`/${connection.id}`, 'PATCH', { enabled }))
                      }
                    />
                    <span className="text-body-sm">
                      {connection.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {canManage && (
                      <>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            setEditor({
                              id: connection.id,
                              name: connection.name,
                              provider: connection.provider,
                              baseUrl: connection.baseUrl,
                              apiKey: '',
                              priority: String(connection.priority),
                              manualModels: '',
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void perform(
                              () => mutate(`/${connection.id}/refresh`, 'POST'),
                              'Discovery scheduled.',
                            )
                          }
                        >
                          Refresh models
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              kind: 'connection',
                              id: connection.id,
                              name: connection.name,
                            })
                          }
                        >
                          Delete
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="flex min-w-none flex-col gap-sm">
                    <h3 className="text-body-sm font-semibold">
                      Models ({connection.models.length})
                    </h3>
                    {connection.models.length === 0 && (
                      <p className="text-body-sm text-muted-foreground">
                        No models yet. Refresh the catalog or add an upstream model ID.
                      </p>
                    )}
                    {connection.models.map((model) => (
                      <div
                        key={model.id}
                        className="flex min-w-none items-start justify-between gap-md"
                      >
                        <div className="min-w-none">
                          <p className="text-body-sm break-words">{model.displayName}</p>
                          <p className="font-mono text-caption break-all text-muted-foreground">
                            {model.publicId}
                          </p>
                          <Badge variant="outline">
                            {model.discovered ? 'Discovered' : 'Manual'}
                          </Badge>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {model.enabled ? 'Enabled' : 'Disabled'}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {canManage && (
                    <form
                      className="flex flex-col gap-sm sm:flex-row sm:items-end"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void perform(async () => {
                          await request(`/${connection.id}/models`, 'POST', {
                            upstreamId: manualModels[connection.id]?.trim(),
                          });
                          setManualModels((current) => ({ ...current, [connection.id]: '' }));
                          await reload();
                        });
                      }}
                    >
                      <Field className="min-w-none flex-1">
                        <FieldLabel htmlFor={`model-${connection.id}`}>
                          Manual upstream model ID
                        </FieldLabel>
                        <Input
                          id={`model-${connection.id}`}
                          required
                          value={manualModels[connection.id] ?? ''}
                          onChange={(event) =>
                            setManualModels((current) => ({
                              ...current,
                              [connection.id]: event.target.value,
                            }))
                          }
                        />
                      </Field>
                      <Button variant="outline" disabled={busy}>
                        Add model
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="min-w-none">
            <CardHeader>
              <CardTitle>Gateway keys</CardTitle>
              <CardDescription>
                Use dedicated keys with the OpenAI-compatible endpoint /api/llm/v1. New keys are
                shown once.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-none flex-col gap-stack">
              {canManage && (
                <form
                  className="flex flex-col gap-sm sm:flex-row sm:items-end"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void perform(async () => {
                      const result = await request<{ key: string }>('/keys', 'POST', {
                        name: keyName.trim(),
                      });
                      setIssuedKey(result.key);
                      setKeyName('');
                      await reload();
                    });
                  }}
                >
                  <Field className="min-w-none flex-1">
                    <FieldLabel htmlFor="gateway-key-name">Key name</FieldLabel>
                    <Input
                      id="gateway-key-name"
                      required
                      value={keyName}
                      onChange={(event) => setKeyName(event.target.value)}
                    />
                  </Field>
                  <Button disabled={busy}>Issue key</Button>
                </form>
              )}
              {data.keys.length === 0 && (
                <p className="text-body-sm text-muted-foreground">No gateway keys issued.</p>
              )}
              {data.keys.map((key) => (
                <div
                  key={key.id}
                  className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-none">
                    <p className="text-body-sm font-medium break-words">{key.name}</p>
                    <p className="font-mono text-caption break-all text-muted-foreground">
                      {key.prefix}…
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {key.revokedAt ? 'Revoked' : 'Active'} ·{' '}
                      {key.lastUsedAt
                        ? `Last used ${new Date(key.lastUsedAt).toLocaleString()}`
                        : 'Never used'}
                    </p>
                  </div>
                  {canManage && !key.revokedAt && (
                    <Button
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setConfirmation({ kind: 'key', id: key.id, name: key.name })}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) closeEditor();
        }}
      >
        <DialogContent className="max-h-svh overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editor?.id ? 'Edit connection' : 'Add connection'}</DialogTitle>
            <DialogDescription>Connect a provider using an API key.</DialogDescription>
          </DialogHeader>
          {editor && (
            <form className="flex min-w-none flex-col gap-stack" onSubmit={saveConnection}>
              <Field>
                <FieldLabel htmlFor="connection-name">Name</FieldLabel>
                <Input
                  id="connection-name"
                  maxLength={100}
                  required
                  value={editor.name}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-provider">Provider</FieldLabel>
                <Select
                  value={editor.provider}
                  disabled={!!editor.id}
                  onValueChange={(provider: Provider) =>
                    setEditor({ ...editor, provider, baseUrl: '', apiKey: '' })
                  }
                >
                  <SelectTrigger id="connection-provider" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {provider}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-url">
                  Base URL {editor.provider !== 'custom' && '(optional)'}
                </FieldLabel>
                <Input
                  id="connection-url"
                  type="url"
                  required={editor.provider === 'custom'}
                  placeholder="https://…"
                  value={editor.baseUrl}
                  onChange={(event) => setEditor({ ...editor, baseUrl: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-key">
                  {editor.id ? 'Replace API key (optional)' : 'API key'}
                </FieldLabel>
                <Input
                  id="connection-key"
                  type="password"
                  autoComplete="off"
                  required={!editor.id}
                  value={editor.apiKey}
                  onChange={(event) => setEditor({ ...editor, apiKey: event.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="connection-priority">Priority</FieldLabel>
                <Input
                  id="connection-priority"
                  type="number"
                  min={-10000}
                  max={10000}
                  step="1"
                  required
                  value={editor.priority}
                  onChange={(event) => setEditor({ ...editor, priority: event.target.value })}
                />
              </Field>
              {!editor.id && (
                <section
                  aria-label="Model preview"
                  aria-live="polite"
                  className="flex min-w-none flex-col gap-sm rounded-md border border-border bg-muted p-md"
                >
                  <h3 className="text-body-sm font-semibold">
                    {shownPreview?.status === 'ok'
                      ? `Available models (${shownPreview.models.length})`
                      : 'Available models'}
                  </h3>
                  {!shownPreview && (
                    <p className="text-body-sm text-muted-foreground">
                      {editor.provider === 'custom'
                        ? 'Enter an API key and an HTTPS base URL to preview available models.'
                        : 'Enter an API key to preview available models.'}
                    </p>
                  )}
                  {shownPreview?.status === 'loading' && (
                    <p className="flex items-center gap-sm text-body-sm text-muted-foreground">
                      <Spinner aria-label="Checking available models" />
                      Checking available models…
                    </p>
                  )}
                  {shownPreview?.status === 'ok' && shownPreview.models.length === 0 && (
                    <p className="text-body-sm text-muted-foreground">
                      No models were returned. Add model IDs manually below.
                    </p>
                  )}
                  {shownPreview?.status === 'ok' && shownPreview.models.length > 0 && (
                    <ul
                      aria-label="Discovered models"
                      className="flex max-h-list-max min-w-none flex-col gap-xs overflow-y-auto"
                    >
                      {shownPreview.models.map((model, index) => (
                        <li key={`${index}-${model.id}`} className="min-w-none">
                          <p className="text-body-sm break-words">{model.name}</p>
                          {model.name !== model.id && (
                            <p className="font-mono text-caption break-all text-muted-foreground">
                              {model.id}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {shownPreview?.status === 'unsupported' && (
                    <p className="text-body-sm text-muted-foreground">
                      This endpoint does not provide model discovery. Add model IDs manually below.
                    </p>
                  )}
                  {shownPreview?.status === 'failed' && (
                    <div className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
                      <p className="flex items-start gap-sm text-body-sm break-words">
                        <AlertCircleIcon aria-hidden className="size-icon shrink-0 text-warning" />
                        {shownPreview.message ?? genericPreviewFailure}
                      </p>
                      <Button type="button" variant="outline" onClick={retryPreview}>
                        Retry
                      </Button>
                    </div>
                  )}
                </section>
              )}
              {!editor.id && (
                <Field>
                  <FieldLabel htmlFor="connection-models">
                    Manual model IDs (one per line, optional)
                  </FieldLabel>
                  <Textarea
                    id="connection-models"
                    value={editor.manualModels}
                    onChange={(event) => setEditor({ ...editor, manualModels: event.target.value })}
                  />
                </Field>
              )}
              {shownDialogError && <DialogErrorMessage message={shownDialogError} />}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={closeEditor}>
                  Cancel
                </Button>
                <Button disabled={busy}>{busy && <Spinner />}Save connection</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={issuedKey !== null}
        onOpenChange={(open) => {
          if (!open) setIssuedKey(null);
        }}
      >
        <DialogContent className="max-h-svh overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Save your gateway key</DialogTitle>
            <DialogDescription>
              Copy this key now. It cannot be retrieved after closing.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="issued-key">Gateway key</FieldLabel>
            <Textarea
              id="issued-key"
              readOnly
              value={issuedKey ?? ''}
              className="font-mono break-all"
            />
          </Field>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                void perform(
                  async () => {
                    if (issuedKey) await navigator.clipboard.writeText(issuedKey);
                  },
                  'Key copied.',
                  'The key could not be copied. Select it and copy it manually.',
                )
              }
              disabled={busy}
            >
              Copy key
            </Button>
            <Button onClick={() => setIssuedKey(null)}>Done</Button>
          </DialogFooter>
          {shownDialogError && <DialogErrorMessage message={shownDialogError} />}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent className="max-h-svh overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation?.kind === 'key' ? 'Revoke gateway key?' : 'Delete connection?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {confirmation?.name}:{' '}
              {confirmation?.kind === 'key'
                ? 'Clients using this key will lose access immediately.'
                : 'This removes the account and all its models.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {shownDialogError && <DialogErrorMessage message={shownDialogError} />}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (confirmation)
                  void perform(async () => {
                    await request(
                      confirmation.kind === 'key'
                        ? `/keys/${confirmation.id}`
                        : `/${confirmation.id}`,
                      'DELETE',
                    );
                    setConfirmation(null);
                    await reload();
                  });
              }}
            >
              {busy && <Spinner />}Confirm
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Failure text in foreground colour with an icon, so the state never relies on red alone. */
function DialogErrorMessage({ message }: { message: string }) {
  return (
    <p role="alert" className="flex items-start gap-sm text-body-sm break-words">
      <AlertCircleIcon aria-hidden className="size-icon shrink-0 text-destructive" />
      {message}
    </p>
  );
}

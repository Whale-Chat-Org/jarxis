'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

import { useAdminRecordDraft } from '@/components/admin/use-admin-record-draft';
import { useAdminSubmission } from '@/components/admin/use-admin-submission';
import {
  connectionResponseSchema,
  providerDataSchema,
  type Connection,
  type ProviderData as Data,
} from '@/lib/providers/contracts';
import { providerErrorMessage, ProviderRequestError } from '@/lib/providers/errors';

import {
  creationNotice,
  Editor,
  EditorModels,
  editorModelsFrom,
  encodeModelStates,
  genericPreviewFailure,
  mergeEditorModels,
  parseDiscovery,
  Preview,
  previewDelay,
  previewKey,
  PreviewResult,
  request,
} from './providers-editor-state';

export function useProviderManagement(canManage: boolean) {
  const [data, setData] = useState<Data | null>(null);
  const [loadError, setLoadError] = useState('');
  // Tied to the dialog that raised it, so an old failure never appears in a different dialog.
  const [dialogError, setDialogError] = useState<{
    key: string;
    message: string;
    code?: string;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const submission = useAdminSubmission();
  const busy = submission.pending;
  const busyRef = submission.pendingRef;
  const {
    draft: editor,
    setDraft: setEditor,
    initialize: initializeEditor,
    dirty,
  } = useAdminRecordDraft<Editor | null>(null);
  const [editorMode, setEditorMode] = useState<'view' | 'create' | 'edit'>('create');
  const [editorModels, setEditorModels] = useState<EditorModels | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [confirmation, setConfirmation] = useState<{
    kind: 'connection';
    id: string;
    name: string;
  } | null>(null);
  const [manualModel, setManualModel] = useState('');
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
    const result = await request(providerDataSchema, '', 'GET', undefined, signal);
    setData(result);
    setLoadError('');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void request(providerDataSchema, '', 'GET', undefined, controller.signal)
      .then(setData)
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError('Providers could not be loaded. Check your connection and try again.');
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
  }, [data, reload, busyRef]);

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
        void request(z.unknown(), '/discover', 'POST', JSON.parse(requestKey), controller.signal)
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
                message: providerErrorMessage(failure, genericPreviewFailure),
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
    initializeEditor(null);
    setEditorModels(null);
    setModelSearch('');
    setManualModel('');
    setKeyVisible(false);
    updatePreview(null);
  }

  function openEditor(connection: Connection, mode: 'view' | 'edit' = 'edit') {
    setEditorMode(mode);
    initializeEditor({
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      baseUrl: connection.baseUrl,
      apiKey: '',
      priority: String(connection.priority),
      manualModels: '',
    });
    setEditorModels(editorModelsFrom(connection));
    setModelSearch('');
    setManualModel('');
    setKeyVisible(false);
  }

  async function reloadEditorModels(id: string) {
    const fresh = await request(providerDataSchema, '');
    setData(fresh);
    const connection = fresh.connections.find((item) => item.id === id);
    if (!connection) throw new ProviderRequestError(404, 'NOT_FOUND');
    setEditorModels(editorModelsFrom(connection));
    setDialogError(null);
  }

  function addManualModel(id: string) {
    const upstreamId = manualModel.trim();
    if (!upstreamId) return;
    void perform(async () => {
      const result = await request(connectionResponseSchema, `/${id}/models`, 'POST', {
        upstreamId,
      });
      setManualModel('');
      setEditorModels((current) => current && mergeEditorModels(current, result.connection));
      await reload();
    }, `Model ${upstreamId} added.`);
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
    setDialogError(null);
    setNotice('');
    await submission.run(
      async () => {
        const result = await action();
        const text = typeof result === 'string' ? result : message;
        if (text) setNotice(text);
      },
      (failure) => {
        const errorMessage = providerErrorMessage(failure, fallback);
        if (dialogKey)
          setDialogError({
            key: dialogKey,
            message: errorMessage,
            code: failure instanceof ProviderRequestError ? failure.code : undefined,
          });
        else toast.error(errorMessage);
      },
    );
  }

  async function mutate(path: string, method: string, body?: unknown) {
    await request(z.unknown(), path, method, body);
    await reload();
  }

  function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || editorMode === 'view' || !canManage) return;
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
    const original = editor.id ? data?.connections.find((item) => item.id === editor.id) : null;
    const editInput = original
      ? {
          ...(input.name !== original.name ? { name: input.name } : {}),
          ...(input.priority !== original.priority ? { priority: input.priority } : {}),
          ...(input.baseUrl && input.baseUrl !== original.baseUrl
            ? { baseUrl: input.baseUrl }
            : {}),
          ...(input.apiKey ? { apiKey: input.apiKey } : {}),
        }
      : null;
    void perform(
      async () => {
        const result = editor.id
          ? await request(connectionResponseSchema, `/${editor.id}/models`, 'PATCH', {
              version: editorModels?.version,
              states: encodeModelStates(editorModels?.models ?? []),
              ...(editInput && Object.keys(editInput).length ? { connection: editInput } : {}),
            })
          : await request(connectionResponseSchema, '', 'POST', input);
        closeEditor();
        await reload();
        return editor.id ? undefined : creationNotice(result.connection);
      },
      'Connection saved.',
      'The connection was not saved. Check the details and try again.',
    );
  }

  const shownPreview: PreviewResult | null = !draftKey
    ? null
    : preview?.key === draftKey
      ? preview
      : { status: 'loading', models: [] };
  const visibleEditorModels =
    editorModels?.models.filter((model) =>
      `${model.displayName} ${model.upstreamId} ${model.publicId}`
        .toLocaleLowerCase()
        .includes(modelSearch.trim().toLocaleLowerCase()),
    ) ?? [];
  const enabledEditorCount = editorModels?.models.filter((model) => model.enabled).length ?? 0;

  return {
    busy,
    perform,
    reload,
    canManage,
    setKeyVisible,
    setEditorMode,
    initializeEditor,
    loadError,
    notice,
    data,
    mutate,
    openEditor,
    setConfirmation,
    expandedCards,
    setExpandedCards,
    editorMode,
    busyRef,
    editor,
    closeEditor,
    saveConnection,
    dirty,
    setEditor,
    keyVisible,
    editorModels,
    enabledEditorCount,
    modelSearch,
    setModelSearch,
    visibleEditorModels,
    setEditorModels,
    shownDialogError,
    dialogError,
    reloadEditorModels,
    manualModel,
    setManualModel,
    addManualModel,
    shownPreview,
    retryPreview,
    confirmation,
  };
}
export type ProviderManagementState = ReturnType<typeof useProviderManagement>;

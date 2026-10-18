'use client';
import { z } from 'zod';

import { apiRequest } from '@/lib/api-client';
import { type Connection, type Model } from '@/lib/providers/contracts';
import { discoveryFailureMessage, isDiscoveryFailureReason } from '@/lib/providers/errors';
import { defaultBaseUrl, providerKinds } from '@/lib/providers/types';

export const providers = providerKinds;
export type Provider = (typeof providers)[number];
export type Editor = {
  id?: string;
  name: string;
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  priority: string;
  manualModels: string;
};
const root = '/api/admin/providers';
export const emptyEditor: Editor = {
  name: '',
  provider: 'openai',
  baseUrl: '',
  apiKey: '',
  priority: '0',
  manualModels: '',
};
// `saved` is the server state `version` describes; `models` holds the unsaved toggles.
export type EditorModels = { version: string; saved: Record<string, boolean>; models: Model[] };
type PreviewModel = { id: string; name: string };
export type PreviewResult = {
  status: 'loading' | 'ok' | 'unsupported' | 'failed';
  models: PreviewModel[];
  /** Fixed, client-side copy for a failure; never text taken from the response. */
  message?: string;
};
// `key` binds a result to the exact input that produced it, so a result for an
// earlier key, provider or URL is never shown for the current input.
export type Preview = PreviewResult & { key: string };
export const previewDelay = 700;
export const genericPreviewFailure =
  'Models could not be loaded. Retry, or add model IDs manually.';
const failedPreview: PreviewResult = {
  status: 'failed',
  models: [],
  message: genericPreviewFailure,
};
const safeInteger = (value: unknown, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= max ? value : null;

export function encodeModelStates(models: Model[]) {
  const ordered = [...models].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bytes = new Uint8Array(Math.ceil(ordered.length / 8));
  ordered.forEach((model, index) => {
    if (model.enabled) bytes[index >> 3] |= 1 << (index & 7);
  });
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

export function editorModelsFrom(connection: Connection): EditorModels {
  return {
    version: connection.modelStateVersion,
    saved: Object.fromEntries(connection.models.map((model) => [model.id, model.enabled])),
    models: connection.models.map((model) => ({ ...model })),
  };
}

/**
 * Adopt a connection returned after adding a model while keeping unsaved toggles. The new
 * version is taken only when every previously loaded model is unchanged on the server, so a
 * concurrent edit still surfaces as a conflict on save rather than being overwritten.
 */
export function mergeEditorModels(current: EditorModels, connection: Connection): EditorModels {
  const unchanged = Object.entries(current.saved).every(
    ([id, enabled]) => connection.models.find((model) => model.id === id)?.enabled === enabled,
  );
  if (!unchanged) return current;
  const local = new Map(current.models.map((model) => [model.id, model.enabled]));
  return {
    ...editorModelsFrom(connection),
    models: connection.models.map((model) => ({
      ...model,
      enabled: local.get(model.id) ?? model.enabled,
    })),
  };
}

// Ask browsers and password managers not to treat these inputs as credential fields.
export const noAutofill = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const;

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
export function previewKey(editor: Editor | null) {
  if (!editor || editor.id) return null;
  const apiKey = editor.apiKey.trim();
  const baseUrl = editor.baseUrl.trim();
  if (!validApiKey(apiKey) || !validBaseUrl(baseUrl || defaultBaseUrl(editor.provider)))
    return null;
  return JSON.stringify({ provider: editor.provider, apiKey, ...(baseUrl ? { baseUrl } : {}) });
}

export function parseDiscovery(value: unknown): PreviewResult {
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

export function creationNotice(connection: Connection) {
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

export function request<T>(
  schema: z.ZodType<T>,
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return apiRequest(`${root}${path}`, schema, {
    method,
    credentials: 'same-origin',
    signal,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

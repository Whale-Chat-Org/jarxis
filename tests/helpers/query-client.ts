import { QueryClient, type QueryClientConfig } from '@tanstack/react-query';

/** A fresh cache per test with deterministic failures, preserving optional cache callbacks. */
export function createTestQueryClient(config: QueryClientConfig = {}) {
  return new QueryClient({
    ...config,
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

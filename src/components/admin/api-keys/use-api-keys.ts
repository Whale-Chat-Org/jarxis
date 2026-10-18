'use client';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { apiRequest } from '@/lib/api-client';
import { gatewayKeyListSchema } from '@/lib/providers/contracts';
import type { ApiKeyFilters } from '@/types/admin-api-keys';
export const apiKeysQueryKey = ['admin-api-keys'] as const;
export const apiKeysEndpoint = '/api/admin/providers/keys';
export function useApiKeys() {
  const client = useQueryClient();
  const [filters, setFilters] = useState<ApiKeyFilters>({
    search: '',
    searchField: 'name',
    status: 'all',
    sortDirection: 'desc',
  });
  const [search, setSearch] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(filters.search.trim());
      setPageIndex(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [filters.search]);
  const pageSize = 20;
  const query = useQuery({
    queryKey: [...apiKeysQueryKey, 'list', { ...filters, search, pageIndex }],
    queryFn: ({ signal }) =>
      apiRequest(
        `${apiKeysEndpoint}?${new URLSearchParams({ ...filters, search, page: String(pageIndex + 1), pageSize: String(pageSize) })}`,
        gatewayKeyListSchema,
        { signal },
      ),
    placeholderData: keepPreviousData,
  });
  const total = query.data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  if (query.data && !query.isPlaceholderData && pageIndex > lastPage) setPageIndex(lastPage);
  function updateFilters(next: Partial<ApiKeyFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setPageIndex(0);
  }
  const refresh = () => client.invalidateQueries({ queryKey: apiKeysQueryKey });
  return {
    query,
    filters,
    updateFilters,
    pageIndex,
    setPageIndex,
    pageSize,
    total,
    selectedId,
    setSelectedId,
    creating,
    setCreating,
    refresh,
  };
}

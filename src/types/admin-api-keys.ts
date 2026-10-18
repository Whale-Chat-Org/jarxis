import type { useApiKeys } from '@/components/admin/api-keys/use-api-keys';
export type ApiKeysState = ReturnType<typeof useApiKeys>;
export type ApiKeyFilters = {
  search: string;
  searchField: 'name' | 'prefix';
  status: 'all' | 'active' | 'revoked';
  sortDirection: 'asc' | 'desc';
};

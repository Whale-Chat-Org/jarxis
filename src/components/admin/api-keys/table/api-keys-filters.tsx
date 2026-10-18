'use client';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ApiKeyFilters, ApiKeysState } from '@/types/admin-api-keys';
export function ApiKeysFilters({ state }: { state: ApiKeysState }) {
  const { filters, updateFilters } = state;
  return (
    <div className="grid gap-sm sm:grid-cols-2">
      <Select
        value={filters.searchField}
        onValueChange={(value) =>
          updateFilters({ searchField: value as ApiKeyFilters['searchField'] })
        }
      >
        <SelectTrigger aria-label="Search field">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="name">Name</SelectItem>
          <SelectItem value="prefix">Prefix</SelectItem>
        </SelectContent>
      </Select>
      <Input
        aria-label={`Search by ${filters.searchField}`}
        name="search"
        autoComplete="off"
        placeholder={`Search by ${filters.searchField}…`}
        value={filters.search}
        onChange={(event) => updateFilters({ search: event.target.value })}
      />
      <Select
        value={filters.status}
        onValueChange={(value) => updateFilters({ status: value as ApiKeyFilters['status'] })}
      >
        <SelectTrigger aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="revoked">Revoked</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

import { SearchIcon } from 'lucide-react';

import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SearchField, SearchOperator, UsersFiltersState } from '@/types/admin-users';
export function AdminUsersFilters({ state }: { state: UsersFiltersState }) {
  const {
    localization,
    searchField,
    setSearchField,
    searchOperator,
    setSearchOperator,
    table,
    status,
    globalFilter,
  } = state;
  return (
    <div className="grid gap-sm sm:grid-cols-2 lg:grid-cols-admin-filters group-data-[panel-open=true]/admin-workspace:lg:grid-cols-1 group-data-[panel-open=true]/admin-workspace:xl:grid-cols-2">
      <Select
        value={searchField}
        onValueChange={(value) => {
          setSearchField(value as SearchField);
          table.setPageIndex(0);
        }}
      >
        <SelectTrigger aria-label={localization.search} className="w-full sm:w-select-md">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="email">{localization.email}</SelectItem>
          <SelectItem value="name">{localization.name}</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={searchOperator}
        onValueChange={(value) => {
          setSearchOperator(value as SearchOperator);
          table.setPageIndex(0);
        }}
      >
        <SelectTrigger aria-label={localization.searchOperator}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="contains">{localization.searchContains}</SelectItem>
          <SelectItem value="starts_with">{localization.startsWith}</SelectItem>
          <SelectItem value="ends_with">{localization.endsWith}</SelectItem>
        </SelectContent>
      </Select>
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={
            searchField === 'email' ? localization.searchByEmail : localization.searchByName
          }
          onChange={(event) => {
            table.setGlobalFilter(event.target.value);
          }}
          placeholder={
            searchField === 'email' ? localization.searchByEmail : localization.searchByName
          }
          value={globalFilter}
        />
      </InputGroup>
      <Select
        value={status}
        onValueChange={(value) => {
          table.getColumn('status')?.setFilterValue(value === 'all' ? undefined : value);
        }}
      >
        <SelectTrigger aria-label={localization.status} className="w-full sm:w-select-md">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{localization.filterAllStatuses}</SelectItem>
          <SelectItem value="active">{localization.active}</SelectItem>
          <SelectItem value="banned">{localization.banned}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

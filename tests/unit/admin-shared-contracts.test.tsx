import { useAdminRecordDraft } from '@/components/admin/use-admin-record-draft';
import { useAdminSubmission } from '@/components/admin/use-admin-submission';
import {
  adminTableDefinitions,
  clampPageIndex,
  parseAuditPage,
  usersRequestParams,
} from '@/components/admin/table/table-definitions';
import { parseRoleKeys, sameRoleKeys } from '@/lib/role-keys';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('shared admin contracts', () => {
  it('normalizes storage without inventing roles or losing custom keys', () => {
    expect(parseRoleKeys(' \towner, custom_one,owner,,\nviewer ')).toEqual([
      'owner',
      'custom_one',
      'viewer',
    ]);
    expect(parseRoleKeys(null)).toEqual([]);
    expect(sameRoleKeys(['admin', 'admin'], ['admin', 'user'])).toBe(false);
    expect(sameRoleKeys(['owner', 'viewer'], ['viewer', 'owner', 'owner'])).toBe(true);
  });
  it('maps controlled Users state and validates unsupported controls', () => {
    const state = {
      pageIndex: 2,
      pageSize: 20,
      searchField: 'name',
      searchOperator: 'starts_with',
      searchValue: ' Ada ',
      status: 'banned',
      sortBy: 'createdAt',
      sortDirection: 'desc',
    } as const;
    expect(usersRequestParams(state)).toMatchObject({
      offset: 40,
      limit: 20,
      searchValue: 'Ada',
      filterField: 'banned',
      filterValue: true,
    });
    expect(usersRequestParams({ ...state, status: 'all' })).not.toHaveProperty('filterField');
    expect(() => usersRequestParams({ ...state, pageSize: 0 })).toThrow();
    expect(adminTableDefinitions.audit.actions).toEqual(['view']);
  });
  it('parses URL pages and clamps shrinking totals', () => {
    for (const value of ['-1', 'Infinity', '1.2', 'garbage', undefined])
      expect(parseAuditPage(value)).toBe(1);
    expect(parseAuditPage(['3', '4'])).toBe(3);
    expect(clampPageIndex(8, 20, 21)).toBe(1);
    expect(clampPageIndex(8, 20, 0)).toBe(0);
  });
  it('retains a dirty draft across background renders and resets on an explicit open', () => {
    const { result, rerender } = renderHook(() =>
      useAdminRecordDraft({ id: 'a', name: 'Original' }),
    );
    act(() => result.current.setDraft({ id: 'a', name: 'Draft' }));
    rerender();
    expect(result.current.draft.name).toBe('Draft');
    expect(result.current.dirty).toBe(true);
    act(() => result.current.initialize({ id: 'b', name: 'Next' }));
    expect(result.current.draft).toEqual({ id: 'b', name: 'Next' });
    expect(result.current.dirty).toBe(false);
  });
  it('locks submission synchronously and clears pending state after a failed write', async () => {
    const { result } = renderHook(useAdminSubmission);
    let reject!: (error: Error) => void;
    const deferred = new Promise<void>((_, fail) => {
      reject = fail;
    });
    let attempts = 0;
    let failures = 0;
    await act(async () => {
      const first = result.current.run(
        () => {
          attempts++;
          return deferred;
        },
        () => {
          failures++;
        },
      );
      await result.current.run(
        async () => {
          attempts++;
        },
        () => {},
      );
      expect(result.current.pendingRef.current).toBe(true);
      reject(new Error('failure'));
      await first;
    });
    expect(attempts).toBe(1);
    expect(failures).toBe(1);
    expect(result.current.pending).toBe(false);
  });
});

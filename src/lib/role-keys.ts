/** Stored Better Auth role keys. Parsing never invents a grant or drops custom keys. */
export function parseRoleKeys(value: string | readonly string[] | null | undefined): string[] {
  const values = typeof value === 'string' ? [value] : (value ?? []);
  return [
    ...new Set(
      values.flatMap((entry) => entry.split(',').map((key) => key.trim())).filter(Boolean),
    ),
  ];
}

export function hasOwnerRole(value: string | readonly string[] | null | undefined): boolean {
  return parseRoleKeys(value).includes('owner');
}

export function sameRoleKeys(left: readonly string[], right: readonly string[]): boolean {
  const a = parseRoleKeys(left);
  const b = new Set(parseRoleKeys(right));
  return a.length === b.size && a.every((key) => b.has(key));
}

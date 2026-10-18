/** @param {string | undefined} value */
export function assertTestDatabaseUrl(value) {
  let url;
  try {
    url = value ? new URL(value) : undefined;
  } catch {
    /* Fixed error below. */
  }
  if (!url || !/^\/jarxis_test(?:_[a-z0-9]+)*$/.test(url.pathname))
    throw new Error('Tests require DATABASE_URL pointing to a dedicated jarxis_test database');
  return url;
}

export const disabledAuthPaths = [
  '/sign-in/social',
  '/link-social',
  '/unlink-account',
  '/get-access-token',
  '/refresh-token',
  '/account-info',
];
export function isBlockedAuthPath(path: string) {
  return (
    disabledAuthPaths.includes(path) ||
    path === '/callback' ||
    path.startsWith('/callback/') ||
    path.endsWith('/reference') ||
    path.endsWith('/open-api/generate-schema')
  );
}

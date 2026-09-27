import { ApiReference } from '@scalar/nextjs-api-reference';
import { guardDocs } from '@/lib/docs-access';
import { handler } from '@/lib/http';
export const GET = handler(async (req) => {
  await guardDocs(req);
  return ApiReference({ url: '/api/openapi', theme: 'default' })();
});

import { openapi } from '@/lib/openapi';
import { guardDocs } from '@/lib/docs-access';
import { handler, json } from '@/lib/http';
export const GET = handler(async (req) => {
  await guardDocs(req);
  return json(await openapi());
});

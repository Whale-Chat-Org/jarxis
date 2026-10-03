import { handler, body, json } from '@/lib/http';
import { requireMlOwner } from '@/lib/ml/admin-auth';
import { previewDiscovery } from '@/lib/ml/service';
import { discoveryPreviewSchema } from '@/lib/ml/validation';

export const runtime = 'nodejs';
export const POST = handler(async (req) => {
  await requireMlOwner(req, 'providers:manage');
  const input = await body(req, discoveryPreviewSchema);
  return json({ discovery: await previewDiscovery(input, req.signal) });
});

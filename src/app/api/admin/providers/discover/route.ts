import { body, handler, json } from '@/lib/http';
import { requireProviderOwner } from '@/lib/providers/admin-auth';
import { previewDiscovery } from '@/lib/providers/service';
import { discoveryPreviewSchema } from '@/lib/providers/validation';

export const runtime = 'nodejs';
export const POST = handler(async (req) => {
  await requireProviderOwner(req, 'providers:manage');
  const input = await body(req, discoveryPreviewSchema);
  return json({ discovery: await previewDiscovery(input, req.signal) });
});

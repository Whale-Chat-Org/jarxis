import { body, handler, json } from '@/lib/http';
import { requireProviderOwner } from '@/lib/providers/admin-auth';
import { updateModelAlias } from '@/lib/providers/service';
import { modelAliasSchema } from '@/lib/providers/validation';

export const runtime = 'nodejs';
export const PATCH = handler<{ params: Promise<{ id: string; modelId: string }> }>(
  async (req, context) => {
    const actorId = await requireProviderOwner(req, 'providers:manage');
    const { id, modelId } = await context.params;
    return json({
      connection: await updateModelAlias(actorId, id, modelId, await body(req, modelAliasSchema)),
    });
  },
);

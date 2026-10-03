import { handleGateway } from '@/lib/ml/gateway';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ path: string[] }> };

/** OpenAI-compatible model gateway authenticated with dedicated gateway keys, never cookies. */
export async function GET(request: Request, context: Context) {
  return handleGateway(request, (await context.params).path);
}

export async function POST(request: Request, context: Context) {
  return handleGateway(request, (await context.params).path);
}

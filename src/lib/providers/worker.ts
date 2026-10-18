import { db } from '@/db';
import { setTimeout as pause } from 'node:timers/promises';
import 'server-only';
import { refreshConnection } from './discovery';
import { providerKinds } from './types';

export async function workerTick(signal: AbortSignal) {
  if (signal.aborted) return;
  const due = await db.providerConnection.findMany({
    where: {
      provider: { in: [...providerKinds] },
      enabled: true,
      status: 'ready',
      nextDiscoveryAt: { lte: new Date() },
    },
    orderBy: { nextDiscoveryAt: 'asc' },
    take: 5,
  });
  for (const connection of due) {
    if (signal.aborted) break;
    await refreshConnection(connection.id).catch(() => undefined);
  }
}

export async function runWorker(signal: AbortSignal) {
  while (!signal.aborted) {
    try {
      await workerTick(signal);
    } catch {
      console.error('Providers worker poll failed; retrying.');
    }
    if (!signal.aborted)
      await pause(1000, undefined, { signal }).catch((error) => {
        if (!signal.aborted) throw error;
      });
  }
}

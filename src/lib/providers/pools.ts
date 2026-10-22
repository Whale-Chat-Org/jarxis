import 'server-only';
import { publicModelId } from './model-id';

export type PoolModel = { id: string; upstreamId: string; alias?: string | null; enabled: boolean };
export type PoolConnection = {
  id: string;
  name?: string;
  provider: string;
  baseUrl: string;
  priority: number;
  enabled: boolean;
  status: string;
  cooldownUntil?: Date | null;
  models: PoolModel[];
};
export type PoolCandidate<T extends PoolConnection = PoolConnection> = {
  connection: T;
  model: PoolModel;
};
export const poolModelId = (model: Pick<PoolModel, 'upstreamId' | 'alias'>) =>
  model.alias ?? model.upstreamId.replace(/^[^/]+\/(?=.)/, '');
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function availability(connection: PoolConnection, model: PoolModel, now = Date.now()) {
  if (!connection.enabled) return 'disabled';
  if (!model.enabled) return 'model_disabled';
  if (connection.status !== 'ready')
    return connection.status === 'reconnect_required' ? 'reconnect_required' : 'pending';
  if (connection.cooldownUntil && connection.cooldownUntil.getTime() > now) return 'cooldown';
  return 'ready';
}
export function buildPools<T extends PoolConnection>(connections: T[]) {
  const pools = new Map<string, PoolCandidate<T>[]>();
  const legacy = new Map<string, PoolCandidate<T>[]>();
  for (const connection of connections)
    for (const model of connection.models) {
      const candidate = { connection, model };
      const id = poolModelId(model);
      const members = pools.get(id) ?? [];
      members.push(candidate);
      pools.set(id, members);
      const oldId = publicModelId(connection, model.upstreamId);
      const oldMembers = legacy.get(oldId) ?? [];
      oldMembers.push(candidate);
      legacy.set(oldId, oldMembers);
    }
  const identity = ({ connection, model }: PoolCandidate) =>
    `${connection.id}\0${model.upstreamId}`;
  // Removing a vendor namespace must not silently merge unrelated upstream models.
  const ambiguous = (id: string) => {
    const members = (pools.get(id) ?? []).filter(
      ({ connection, model }) => connection.enabled && model.enabled,
    );
    if (!members.some(({ model }) => !model.alias && model.upstreamId.includes('/'))) return false;
    return (
      new Set(
        members
          .filter(({ model }) => !model.alias)
          .map(({ connection, model }) =>
            model.upstreamId.includes('/')
              ? model.upstreamId
              : `${connection.provider}/${model.upstreamId}`,
          ),
      ).size > 1
    );
  };
  const advertised = (id: string) => {
    if (ambiguous(id)) return false;
    const old = legacy.get(id);
    const members = pools.get(id) ?? [];
    if (!old) return true;
    const identities = new Set(members.map(identity));
    return (
      old.length === members.length && old.every((candidate) => identities.has(identity(candidate)))
    );
  };
  return { pools, legacy, advertised, ambiguous };
}
export function poolSummaries(connections: PoolConnection[]) {
  const index = buildPools(connections);
  return [...index.pools]
    .sort(([a], [b]) => compare(a, b))
    .map(([id, members]) => ({
      id,
      advertised: index.advertised(id),
      members: members.map(({ connection, model }) => ({
        connectionId: connection.id,
        modelId: model.id,
        connectionName: connection.name ?? connection.id,
        provider: connection.provider,
        upstreamId: model.upstreamId,
        priority: connection.priority,
        availability: availability(connection, model),
      })),
    }));
}
export function uniqueCandidates<T extends PoolConnection>(
  members: PoolCandidate<T>[],
  id: string,
) {
  const sorted = [...members].sort(
    (a, b) =>
      compare(a.connection.id, b.connection.id) ||
      Number(b.model.upstreamId === id) - Number(a.model.upstreamId === id) ||
      compare(a.model.upstreamId, b.model.upstreamId),
  );
  return sorted.filter(
    (candidate, i) => i === 0 || candidate.connection.id !== sorted[i - 1].connection.id,
  );
}

// shortcut: rotation is per process; use shared coordination if replicas require global fairness.
const rotations = new Map<string, number>();
const MAX_ROTATIONS = 2048;
export function pruneRotations(scopes: Set<string>) {
  for (const key of rotations.keys())
    if (!scopes.has(JSON.parse(key)[0] as string)) rotations.delete(key);
}
export function rotateTier<T extends PoolCandidate>(
  scope: string,
  priority: number,
  candidates: T[],
) {
  const key = JSON.stringify([scope, priority]);
  const offset = (rotations.get(key) ?? 0) % candidates.length;
  rotations.delete(key);
  if (rotations.size >= MAX_ROTATIONS) rotations.delete(rotations.keys().next().value!);
  rotations.set(key, (offset + 1) % candidates.length);
  return [...candidates.slice(offset), ...candidates.slice(0, offset)];
}

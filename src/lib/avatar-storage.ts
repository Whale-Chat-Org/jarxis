import 'server-only';

import { randomUUID } from 'node:crypto';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';

import { avatarEnv } from './env';

export const AVATAR_CONTENT_TYPE = 'image/png';
export const MAX_AVATAR_BYTES = 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let containerPromise: Promise<ContainerClient> | undefined;

async function avatarContainer() {
  if (!containerPromise) {
    containerPromise = (async () => {
      const config = avatarEnv();
      const client = BlobServiceClient.fromConnectionString(
        config.AZURE_STORAGE_CONNECTION_STRING,
      ).getContainerClient(config.AZURE_STORAGE_CONTAINER);
      // Omitting `access` keeps the container private. This is idempotent under concurrent starts.
      await client.createIfNotExists();
      return client;
    })();
  }
  return containerPromise;
}

function blobName(userId: string, blobId: string) {
  return `${encodeURIComponent(userId)}/${blobId}.png`;
}

export function avatarURL(userId: string, blobId: string) {
  return `/api/profile/avatar/${encodeURIComponent(userId)}/${blobId}`;
}

export function isPng(data: Uint8Array) {
  return (
    data.byteLength >= PNG_SIGNATURE.byteLength && PNG_SIGNATURE.every((b, i) => data[i] === b)
  );
}

export async function uploadAvatar(userId: string, data: Uint8Array) {
  const blobId = randomUUID();
  const blob = (await avatarContainer()).getBlockBlobClient(blobName(userId, blobId));
  await blob.uploadData(data, {
    blobHTTPHeaders: {
      blobContentType: AVATAR_CONTENT_TYPE,
      blobCacheControl: 'private, max-age=31536000, immutable',
    },
  });
  return { blobId, url: avatarURL(userId, blobId) };
}

export async function downloadAvatar(userId: string, blobId: string) {
  return (await avatarContainer()).getBlockBlobClient(blobName(userId, blobId)).download();
}

export async function deleteAvatar(userId: string, blobId: string) {
  await (await avatarContainer()).getBlockBlobClient(blobName(userId, blobId)).deleteIfExists();
}

export function isBlobNotFound(error: unknown) {
  return (
    typeof error === 'object' && error !== null && 'statusCode' in error && error.statusCode === 404
  );
}

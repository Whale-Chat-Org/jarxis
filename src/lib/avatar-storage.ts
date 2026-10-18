import 'server-only';

import { randomUUID } from 'node:crypto';

import { storage } from './storage';

export { isStorageNotFound as isBlobNotFound } from './storage';

export const AVATAR_CONTENT_TYPE = 'image/png';
export const MAX_AVATAR_BYTES = 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  await storage().upload(blobName(userId, blobId), data, {
    contentType: AVATAR_CONTENT_TYPE,
    cacheControl: 'private, max-age=31536000, immutable',
  });
  return { blobId, url: avatarURL(userId, blobId) };
}

export async function downloadAvatar(userId: string, blobId: string) {
  return storage().download(blobName(userId, blobId));
}

export async function deleteAvatar(userId: string, blobId: string) {
  await storage().delete(blobName(userId, blobId));
}

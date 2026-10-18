import 'server-only';

import { Readable } from 'node:stream';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';

import { storageEnv } from './env';

export type StorageConfig = ReturnType<typeof storageEnv>;
export type StorageProvider = StorageConfig[number]['STORAGE_PROVIDER'];

export interface StorageUploadResult {
  storedIn: StorageProvider[];
  failedProviders: StorageProvider[];
}

export interface StorageUploadOptions {
  contentType: string;
  cacheControl?: string;
}

export interface StorageDownload {
  readableStreamBody?: NodeJS.ReadableStream;
  contentType?: string;
  contentLength?: number;
  etag?: string;
}

export interface StorageManager {
  upload(
    key: string,
    data: Uint8Array,
    options: StorageUploadOptions,
  ): Promise<StorageUploadResult>;
  download(key: string): Promise<StorageDownload>;
  delete(key: string): Promise<void>;
}

let manager: StorageManager | undefined;

/** One server-side manager; credentials and provider settings are resolved only on first use. */
export function storage(): StorageManager {
  return (manager ??= createStorage(storageEnv()));
}

export function createStorage(config: StorageConfig): StorageManager {
  if (!config.length) throw new Error('No storage backend configured');
  const backends = config.map((settings) => ({
    provider: settings.STORAGE_PROVIDER,
    ...createBackend(settings),
  }));
  return {
    async upload(key, data, options) {
      const outcomes = await Promise.allSettled(
        backends.map((backend) => backend.upload(key, data, options)),
      );
      const result: StorageUploadResult = { storedIn: [], failedProviders: [] };
      outcomes.forEach((outcome, i) => {
        result[outcome.status === 'fulfilled' ? 'storedIn' : 'failedProviders'].push(
          backends[i].provider,
        );
      });
      if (!result.storedIn.length) throw new Error('Storage upload failed');
      if (result.failedProviders.length) {
        console.warn('Storage upload partially failed; retry the failed copies', {
          failedProviders: result.failedProviders,
        });
      }
      return result;
    },
    async download(key) {
      let allMissing = true;
      for (const backend of backends) {
        try {
          const result = await backend.download(key);
          if (result.readableStreamBody) return result;
          allMissing = false;
        } catch (error) {
          if (!isStorageNotFound(error)) allMissing = false;
        }
      }
      if (allMissing)
        throw Object.assign(new Error('Storage object not found'), { statusCode: 404 });
      throw new Error('Storage download failed');
    },
    async delete(key) {
      const outcomes = await Promise.allSettled(backends.map((backend) => backend.delete(key)));
      if (
        outcomes.some(
          (outcome) => outcome.status === 'rejected' && !isStorageNotFound(outcome.reason),
        )
      ) {
        throw new Error('Storage delete failed');
      }
    },
  };
}

type StorageBackend = Omit<StorageManager, 'upload'> & {
  upload(key: string, data: Uint8Array, options: StorageUploadOptions): Promise<void>;
};

function createBackend(config: StorageConfig[number]): StorageBackend {
  if (config.STORAGE_PROVIDER === 's3') {
    const client = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
    const Bucket = config.S3_BUCKET;
    return {
      async upload(Key, Body, options) {
        await client.send(
          new PutObjectCommand({
            Bucket,
            Key,
            Body,
            ContentType: options.contentType,
            CacheControl: options.cacheControl,
          }),
        );
      },
      async download(Key) {
        const result = await client.send(new GetObjectCommand({ Bucket, Key }));
        return {
          readableStreamBody: result.Body instanceof Readable ? result.Body : undefined,
          contentType: result.ContentType,
          contentLength: result.ContentLength,
          etag: result.ETag,
        };
      },
      async delete(Key) {
        await client.send(new DeleteObjectCommand({ Bucket, Key }));
      },
    };
  }

  const { AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER } = config;
  let containerPromise: Promise<ContainerClient> | undefined;
  function container() {
    return (containerPromise ??= (async () => {
      const client = BlobServiceClient.fromConnectionString(
        AZURE_STORAGE_CONNECTION_STRING,
      ).getContainerClient(AZURE_STORAGE_CONTAINER);
      // Omitting access keeps the container private.
      await client.createIfNotExists();
      return client;
    })().catch((error: unknown) => {
      containerPromise = undefined;
      throw error;
    }));
  }
  return {
    async upload(key, data, options) {
      await (await container()).getBlockBlobClient(key).uploadData(data, {
        blobHTTPHeaders: {
          blobContentType: options.contentType,
          blobCacheControl: options.cacheControl,
        },
      });
    },
    async download(key) {
      return (await container()).getBlockBlobClient(key).download();
    },
    async delete(key) {
      await (await container()).getBlockBlobClient(key).deleteIfExists();
    },
  };
}

export function isStorageNotFound(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('statusCode' in error && error.statusCode === 404) ||
      ('name' in error && error.name === 'NoSuchKey'))
  );
}

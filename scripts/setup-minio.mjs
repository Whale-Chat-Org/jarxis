/** Provision only the local development bucket; production buckets are managed separately. */
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';

const env = {
  ...(existsSync('.env') ? parseEnv(readFileSync('.env', 'utf8')) : {}),
  ...process.env,
};
if (env.NODE_ENV === 'production') throw new Error('MinIO setup is for local development only');
if (env.S3_BUCKET) {
  const endpoint = new URL(env.S3_ENDPOINT);
  if (!['localhost', '127.0.0.1', '[::1]', 'minio'].includes(endpoint.hostname)) {
    throw new Error('MinIO setup requires a local endpoint');
  }
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('MinIO setup requires a bucket and local credentials');
  }
  const client = new S3Client({
    endpoint: endpoint.href,
    region: env.S3_REGION || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404) throw error;
      try {
        await client.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
      } catch (error) {
        if (error?.name !== 'BucketAlreadyOwnedByYou') throw error;
      }
    }
    console.log('Local MinIO bucket is ready (private by default).');
  } catch {
    throw new Error('Local MinIO bucket setup failed; check MinIO availability and credentials');
  } finally {
    client.destroy();
  }
}

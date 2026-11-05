import {
  ORACLE_STORAGE_BUCKET,
  ORACLE_STORAGE_ENDPOINT,
  ORACLE_STORAGE_REGION,
  S3StorageBucket,
  type StorageBucket,
} from './s3-storage-bucket';
import type { S3SignerCredentials } from './r2-presign';

export type PrivateStorageEnv = {
  PRIMARY_STORAGE: R2Bucket;
  ORACLE_STORAGE_ENDPOINT?: string;
  ORACLE_STORAGE_REGION?: string;
  ORACLE_STORAGE_BUCKET?: string;
  ORACLE_STORAGE_ACCESS_KEY_ID?: string;
  ORACLE_STORAGE_SECRET_ACCESS_KEY?: string;
};

export type { StorageBucket };

export function oracleStorageCredentials(
  env: Pick<
    PrivateStorageEnv,
    | 'ORACLE_STORAGE_ENDPOINT'
    | 'ORACLE_STORAGE_REGION'
    | 'ORACLE_STORAGE_BUCKET'
    | 'ORACLE_STORAGE_ACCESS_KEY_ID'
    | 'ORACLE_STORAGE_SECRET_ACCESS_KEY'
  >,
): S3SignerCredentials {
  const {
    ORACLE_STORAGE_ENDPOINT: endpoint,
    ORACLE_STORAGE_REGION: region,
    ORACLE_STORAGE_BUCKET: bucketName,
    ORACLE_STORAGE_ACCESS_KEY_ID: accessKeyId,
    ORACLE_STORAGE_SECRET_ACCESS_KEY: secretAccessKey,
  } = env;
  if (
    endpoint !== ORACLE_STORAGE_ENDPOINT ||
    region !== ORACLE_STORAGE_REGION ||
    bucketName !== ORACLE_STORAGE_BUCKET ||
    !accessKeyId?.trim() ||
    !secretAccessKey?.trim()
  )
    throw new Error('ORACLE_STORAGE_CONFIG_INVALID');
  return {
    endpoint,
    region,
    bucketName,
    accessKeyId,
    secretAccessKey,
  };
}

export function storageBucketForNode(
  env: PrivateStorageEnv,
  nodeId: string,
): StorageBucket {
  if (nodeId === 'primary') return env.PRIMARY_STORAGE;
  if (nodeId !== 'oracle-vm') throw new Error('STORAGE_NODE_UNAVAILABLE');
  return new S3StorageBucket(oracleStorageCredentials(env));
}

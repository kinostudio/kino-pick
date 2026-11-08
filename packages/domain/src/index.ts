export * from './retention';
export * from './share-expiry';
export * from './storage-placement';

export type Scope = Readonly<{
  workspaceId: string;
  projectId: string;
  albumId: string;
}>;
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface StorageAdapter {
  presignUpload(
    input: Scope & {
      key: string;
      bytes: number;
      mime: string;
      expiresInSeconds: number;
    },
  ): Promise<{ url: string; expiresAt: string }>;
  stat(
    scope: Scope,
    key: string,
  ): Promise<{ bytes: number; mime: string } | null>;
  read(scope: Scope, key: string): Promise<Uint8Array>;
  deleteObject(scope: Scope, key: string): Promise<void>;
}
export interface StorageQuotaService {
  reserve(input: {
    workspaceId: string;
    bytes: number;
    requestId: string;
  }): Promise<{ reservationId: string }>;
  release(input: {
    workspaceId: string;
    reservationId: string;
    requestId: string;
  }): Promise<void>;
  usage(workspaceId: string): Promise<{
    confirmedBytes: number;
    reservedBytes: number;
    quotaBytes: number;
  }>;
}
export type RetentionPlan = Readonly<{
  workspaceId: string;
  dryRun: true;
  candidateAlbumIds: readonly string[];
  estimatedBytes: number;
  excluded: readonly { albumId: string; reason: string }[];
}>;
/** Planning only. Execution requires a later lock/recheck/approval service. */
export interface RetentionPolicyEngine {
  evaluateEligibility(input: {
    scope: Scope;
    now: string;
  }): Promise<{ eligible: boolean; reasons: readonly string[] }>;
  previewPlan(input: {
    workspaceId: string;
    now: string;
  }): Promise<RetentionPlan>;
}
export interface TransactionContext {
  readonly transactionId: string;
}
export interface AuditEventWriter {
  appendInTransaction(
    tx: TransactionContext,
    event: {
      scope: Scope;
      photoId: string | null;
      versionId: string | null;
      actorKind: 'user' | 'guest' | 'system';
      actorId: string;
      sessionId: string | null;
      requestId: string;
      action: string;
      before: Json;
      after: Json;
      occurredAtUtc: string;
    },
  ): Promise<{ eventId: string }>;
}
export interface VersionMatcher {
  match(
    input: Scope & {
      mode: 'off' | 'manual' | 'auto_filename' | 'assisted';
      filename: string;
      sha256: string;
    },
  ): Promise<{
    outcome: 'new_photo' | 'new_version' | 'duplicate' | 'requires_review';
    photoId: string | null;
  }>;
}
export interface ImageDiffService {
  compare(
    input: Scope & {
      photoId: string;
      beforeVersionId: string;
      afterVersionId: string;
      mode: 'slider' | 'side_by_side' | 'overlay' | 'heatmap';
    },
  ): Promise<{
    status: 'ready' | 'queued' | 'unavailable';
    jobId: string | null;
  }>;
}

/** Trusted full decoding, separate from the upload/header and storage adapters. */
export type ImageProcessingInput = Readonly<{
  scope: Scope;
  photoId: string;
  versionId: string;
  sourceBytes: Uint8Array;
  expected: Readonly<{
    mime: 'image/jpeg' | 'image/png' | 'image/webp';
    bytes: number;
    sha256: string;
    /** Raw encoded dimensions; generated assets have display-oriented dimensions. */
    width: number;
    height: number;
  }>;
}>;
export type ProcessedImageArtifact = Readonly<{
  kind: 'thumbnail' | 'preview';
  bytes: Uint8Array;
  mime: 'image/jpeg';
  width: number;
  height: number;
  sha256: string;
}>;
export type ImageProcessingResult = Readonly<{
  processorVersion: string;
  scope: Scope;
  photoId: string;
  versionId: string;
  source: ImageProcessingInput['expected'];
  artifacts: readonly ProcessedImageArtifact[];
}>;
export interface ImageProcessingAdapter {
  process(input: ImageProcessingInput): Promise<ImageProcessingResult>;
}

import { applyMigration } from './apply-migration.mjs';
import { runMatchingRulesChecks } from './matching-rules.mjs';
import { verifyMatchingRulesUpgrade } from './matching-rules-upgrade.mjs';
import { verifyAssistedCandidateCatalogUpgrade } from './assisted-candidate-catalog-upgrade.mjs';
import { runAssistedCandidateCatalogChecks } from './assisted-candidate-catalog.mjs';
import { runIndexedVersionMatchingChecks } from './indexed-version-matching.mjs';
import { verifyMatchingFilenameIndexUpgrade } from './matching-filename-index-upgrade.mjs';
import { runMatchingFilenameIndexChecks } from './matching-filename-index.mjs';
import { runOwnerHistoryChecks } from './owner-history.mjs';
import { verifyOwnerHistoryUpgrade } from './owner-history-upgrade.mjs';
import { runAnnotationProcessingBrowserChecks } from './annotation-processing-browser.mjs';
import { seedAndVerifyAnnotationProcessingUpgrade } from './annotation-processing-upgrade.mjs';
import { runAnnotationProcessingChecks } from './annotation-processing.mjs';
import { runOwnerAnnotationAuthoringBrowserChecks } from './owner-annotation-authoring-browser.mjs';
import { seedAndVerifyOwnerAnnotationUpgrade } from './owner-annotations-upgrade.mjs';
import { ownerAnnotationAuthoringChecks } from './owner-annotation-authoring.mjs';
import { guestSharedAnnotationChecks } from './guest-shared-annotations.mjs';
import { runGuestAnnotationsBrowserChecks } from './guest-annotations-browser.mjs';
import { runOwnerAnnotationsBrowserChecks } from './owner-annotations-browser.mjs';
import { ownerAnnotationChecks } from './owner-annotations.mjs';
import { guestAnnotationChecks } from './guest-annotations.mjs';
import { runCommentProcessingBrowserChecks } from './comment-processing-browser.mjs';
import { runCommentProcessingChecks } from './comment-processing.mjs';
import { seedPreProcessingHistory } from './comment-processing-upgrade.mjs';
import { seedPreOwnerCommentHistory } from './owner-comments-upgrade.mjs';
import { runOwnerCommentsBrowserChecks } from './owner-comments-browser.mjs';
import { ownerCommentChecks } from './owner-comments.mjs';
import { guestCommentChecks } from './guest-comments.mjs';
import { runGuestCommentsBrowserChecks } from './guest-comments-browser.mjs';
import { runGuestVersionBrowserChecks } from './guest-versions-browser.mjs';
import { guestVersionChecks } from './guest-versions.mjs';
import { runResolvedUploadBrowserChecks } from './resolved-uploads-browser.mjs';
import { resolvedUploadChecks } from './resolved-uploads.mjs';
import { albumMatchingChangeChecks } from './album-matching-changes.mjs';
import { versionMatchCandidateChecks } from './version-match-candidates.mjs';
import { ownerExternalIntentChecks } from './owner-external-intents.mjs';
import { projectVersioningIntegrityChecks } from './project-versioning-integrity.mjs';
import { runProjectVersioningBrowserChecks } from './project-versioning-browser.mjs';
import { projectVersioningChecks } from './project-versioning.mjs';
import { runVersionUploadsBrowserChecks } from './version-uploads-browser.mjs';
import { versionUploadChecks } from './version-uploads.mjs';
import { photoVersionHeadChecks } from './photo-version-heads.mjs';
import { guestHistoryChecks } from './guest-history.mjs';
import { guestTagCatalogChecks } from './guest-tags-catalog.mjs';
import { guestTagIntegrityChecks } from './guest-tags-integrity.mjs';
import { guestTagsChecks } from './guest-tags.mjs';
import { immutablePhotoRecordChecks } from './immutable-photo-records.mjs';
import {
  immutableResultChecks,
  assertImmutableResultInsertIntegrity,
} from './immutable-results.mjs';
import { selectionPolicyConfigurationChecks } from './selection-policy-configuration.mjs';
import { runIndependentSelectionPolicyInheritanceChecks } from './selection-policy-inheritance-browser.mjs';
import { sharedReviewChecks } from './shared-review.mjs';
import { runSharedReviewOwnerBrowserChecks } from './shared-review-owner-browser.mjs';
import { runSharedReviewGuestBrowserChecks } from './shared-review-guest-browser.mjs';
import { reopenedSelectionRevisionChecks } from './selection-reopen-revision.mjs';
import { selectionPolicyChecks } from './selection-policy.mjs';
import { runIndependentSelectionPolicyConfigurationBrowserChecks } from './selection-policy-configuration-browser.mjs';
import { runGuestSelectionLimitBrowserChecks } from './selection-limit-guest-browser.mjs';
import { guestFeedbackChecks } from './guest-feedback.mjs';
import { runGuestFeedbackBrowserChecks } from './guest-feedback-browser.mjs';
import { runInviteCreateUiChecks } from './invite-create-ui-browser.mjs';
import { runGuestEntryUiChecks } from './guest-entry-ui-browser.mjs';
import { workspaceChecks } from './workspaces.mjs';
import { uploadChecks } from './uploads.mjs';
import { processingChecks } from './processing.mjs';
import { guestAccessChecks } from './guest-access.mjs';
import { ownerSelectionChecks } from './owner-selection.mjs';
import { guestExchangeChecks } from './guest-exchange.mjs';
import { verifyBrowserUploadContentLength } from './presigned-browser.mjs';
import { runWorkerUiBrowserChecks } from './ui-browser.mjs';
import { runUploadBrowserChecks } from './upload-browser.mjs';
// Real local workerd + D1 + R2; synthetic Google/GitHub services only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const base = 'http://127.0.0.1:8787';
let ownerIntentInterleaveHook = null;
const owner = '99999999-9999-4999-8999-999999999999';
const bindings = {
  APP_ENV: 'local',
  APP_URL: base,
  REGISTRATION_MODE: 'closed',
  STORAGE_AUTODELETE_ENABLED: 'false',
  STORAGE_RETENTION_DRY_RUN: 'true',
  MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  DIRECT_UPLOAD_ENABLED: 'true',
  GUEST_INVITE_ISSUANCE_ENABLED: 'true',
  GUEST_EXCHANGE_ENABLED: 'false',
  GUEST_SELECTION_ENABLED: 'false',
  GUEST_FEEDBACK_ENABLED: 'false',
  GUEST_SHARED_SELECTION_ENABLED: 'false',
  R2_ACCOUNT_ID: 'a'.repeat(32),
  R2_ACCESS_KEY_ID: 'synthetic-test-access-key',
  R2_SECRET_ACCESS_KEY: 'synthetic-test-secret-key-never-for-production',
  R2_BUCKET_NAME: 'kino-pic-test-private',
  BETTER_AUTH_SECRET: 'synthetic-test-only-secret-at-least-forty-characters',
  GOOGLE_CLIENT_ID: 'local-google',
  GOOGLE_CLIENT_SECRET: 'fixture',
  GITHUB_CLIENT_ID: 'local-github',
  GITHUB_CLIENT_SECRET: 'fixture',
};
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'local-test',
  alg: 'RS256',
  use: 'sig',
};
let githubSubject = 101;
let googleSubject = '12345001';
let corruptGoogleSignature = false;
let activeAuth;
const jwt = (claims) => {
  const head = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid: 'local-test', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  let signature = sign(
    'RSA-SHA256',
    Buffer.from(`${head}.${body}`),
    privateKey,
  ).toString('base64url');
  if (corruptGoogleSignature) signature = 'AAAA' + signature.slice(4);
  return `${head}.${body}.${signature}`;
};
const outbound = async (request) => {
  const url = new URL(request.url);
  if (url.href === 'https://www.googleapis.com/oauth2/v3/certs')
    return Response.json({ keys: [jwk] });
  if (
    url.href === 'https://oauth2.googleapis.com/token' ||
    url.href === 'https://github.com/login/oauth/access_token'
  ) {
    const body = new URLSearchParams(await request.text());
    if (activeAuth?.searchParams.get('code_challenge'))
      assert.equal(
        createHash('sha256')
          .update(body.get('code_verifier') ?? '')
          .digest('base64url'),
        activeAuth.searchParams.get('code_challenge'),
      );
    const now = Math.floor(Date.now() / 1000);
    return Response.json({
      access_token: 'synthetic-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'read:user user:email',
      ...(url.hostname === 'oauth2.googleapis.com'
        ? {
            id_token: jwt({
              iss: 'https://accounts.google.com',
              aud: 'local-google',
              sub: googleSubject,
              email: 'shared@example.test',
              email_verified: true,
              name: 'Local owner',
              iat: now,
              exp: now + 3600,
              nonce: activeAuth?.searchParams.get('nonce') ?? undefined,
            }),
          }
        : {}),
    });
  }
  if (url.href === 'https://api.github.com/user')
    return Response.json({
      id: githubSubject,
      login: 'fixture',
      name: 'Local owner',
      email: 'shared@example.test',
      avatar_url: null,
    });
  if (url.href === 'https://api.github.com/user/emails')
    return Response.json([
      { email: 'shared@example.test', primary: true, verified: true },
    ]);
  throw new Error(`Unexpected outbound request: ${url.origin}${url.pathname}`);
};
const temporary = await mkdtemp(join(tmpdir(), 'kino-cloudflare-'));
const mf = new Miniflare(
  convertV4MiniflareOptions({
    workers: [
      {
        name: 'app',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings,
        d1Databases: {
          DB: 'test',
          DB_UPGRADE: 'upgrade',
          DB_UPLOAD_SPEC_REPAIR: 'upload-spec-repair',
        },
        r2Buckets: {
          PRIMARY_STORAGE: 'test',
          COMMENT_UPGRADE_STORAGE: 'comment-upgrade',
        },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'upload-disabled',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          DIRECT_UPLOAD_ENABLED: 'false',
          GUEST_INVITE_ISSUANCE_ENABLED: 'false',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'storage-test',
        modules: true,
        scriptPath: resolve('.build-storage/storage-harness.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings,
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        serviceBindings: {
          INTENT_HOOK: async (request) =>
            ownerIntentInterleaveHook
              ? ownerIntentInterleaveHook(request)
              : new Response('ok'),
        },
        d1Databases: { DB: 'test' },
      },
      {
        name: 'guest-secure-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: { ...bindings, APP_URL: 'https://127.0.0.1:8787' },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
      },
      {
        name: 'guest-exchange-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: { ...bindings, GUEST_EXCHANGE_ENABLED: 'true' },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'guest-comments-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          GUEST_VERSION_COMPARISON_ENABLED: 'true',
          GUEST_COMMENTS_ENABLED: 'true',
          GUEST_SHARED_SELECTION_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'owner-comments-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          GUEST_VERSION_COMPARISON_ENABLED: 'true',
          GUEST_COMMENTS_ENABLED: 'true',
          OWNER_COMMENTS_ENABLED: 'true',
          GUEST_SHARED_SELECTION_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'owner-processing-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          GUEST_VERSION_COMPARISON_ENABLED: 'true',
          GUEST_COMMENTS_ENABLED: 'true',
          OWNER_COMMENTS_ENABLED: 'true',
          OWNER_COMMENT_PROCESSING_ENABLED: 'true',
          GUEST_SHARED_SELECTION_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'guest-annotations-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          GUEST_VERSION_COMPARISON_ENABLED: 'true',
          GUEST_COMMENTS_ENABLED: 'true',
          GUEST_ANNOTATIONS_ENABLED: 'true',
          OWNER_COMMENTS_ENABLED: 'true',
          OWNER_COMMENT_PROCESSING_ENABLED: 'true',
          GUEST_SHARED_SELECTION_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'owner-annotations-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          PHOTO_VERSIONS_ENABLED: 'true',
          OWNER_ANNOTATIONS_ENABLED: 'true',
          GUEST_EXCHANGE_ENABLED: 'false',
          GUEST_ANNOTATIONS_ENABLED: 'false',
          OWNER_COMMENTS_ENABLED: 'false',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'owner-annotation-authoring-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          PHOTO_VERSIONS_ENABLED: 'true',
          OWNER_ANNOTATIONS_ENABLED: 'true',
          OWNER_ANNOTATION_AUTHORING_ENABLED: 'true',
          GUEST_EXCHANGE_ENABLED: 'false',
          GUEST_ANNOTATIONS_ENABLED: 'false',
          OWNER_COMMENTS_ENABLED: 'false',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'matching-filename-index-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          PHOTO_VERSIONS_ENABLED: 'false',
          OWNER_ANNOTATIONS_ENABLED: 'false',
          OWNER_ANNOTATION_AUTHORING_ENABLED: 'false',
          OWNER_ANNOTATION_PROCESSING_ENABLED: 'false',
          OWNER_HISTORY_ENABLED: 'false',
          MATCHING_FILENAME_INDEX_ENABLED: 'true',
          GUEST_EXCHANGE_ENABLED: 'false',
          GUEST_ANNOTATIONS_ENABLED: 'false',
          OWNER_COMMENTS_ENABLED: 'false',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'owner-history-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          PHOTO_VERSIONS_ENABLED: 'false',
          OWNER_ANNOTATIONS_ENABLED: 'false',
          OWNER_ANNOTATION_AUTHORING_ENABLED: 'false',
          OWNER_ANNOTATION_PROCESSING_ENABLED: 'false',
          OWNER_HISTORY_ENABLED: 'true',
          GUEST_EXCHANGE_ENABLED: 'false',
          GUEST_ANNOTATIONS_ENABLED: 'false',
          OWNER_COMMENTS_ENABLED: 'false',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'owner-history-stream-test',
        modules: true,
        scriptPath: resolve(
          '.build-history-stream/owner-history-stream-harness.js',
        ),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          PHOTO_VERSIONS_ENABLED: 'false',
          OWNER_ANNOTATIONS_ENABLED: 'false',
          OWNER_ANNOTATION_AUTHORING_ENABLED: 'false',
          OWNER_ANNOTATION_PROCESSING_ENABLED: 'false',
          OWNER_HISTORY_ENABLED: 'true',
          GUEST_EXCHANGE_ENABLED: 'false',
          GUEST_ANNOTATIONS_ENABLED: 'false',
          OWNER_COMMENTS_ENABLED: 'false',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'annotation-processing-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          PHOTO_VERSIONS_ENABLED: 'true',
          OWNER_ANNOTATIONS_ENABLED: 'true',
          OWNER_ANNOTATION_AUTHORING_ENABLED: 'false',
          OWNER_ANNOTATION_PROCESSING_ENABLED: 'true',
          GUEST_EXCHANGE_ENABLED: 'false',
          GUEST_ANNOTATIONS_ENABLED: 'false',
          OWNER_COMMENTS_ENABLED: 'false',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'guest-version-comparison-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          GUEST_VERSION_COMPARISON_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'matching-rules-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
          MATCHING_FILENAME_INDEX_ENABLED: 'true',
          INDEXED_VERSION_MATCHING_ENABLED: 'true',
          ASSISTED_CANDIDATE_CATALOG_ENABLED: 'true',
          MATCHING_RULES_ENABLED: 'true',
          OWNER_HISTORY_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'assisted-candidate-catalog-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
          MATCHING_FILENAME_INDEX_ENABLED: 'true',
          INDEXED_VERSION_MATCHING_ENABLED: 'true',
          ASSISTED_CANDIDATE_CATALOG_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'indexed-version-matching-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
          MATCHING_FILENAME_INDEX_ENABLED: 'true',
          INDEXED_VERSION_MATCHING_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'resolved-uploads-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
          PHOTO_VERSION_MATCHING_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'project-versioning-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
          PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'version-uploads-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
          PHOTO_VERSION_UPLOADS_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'photo-versions-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
          PHOTO_VERSIONS_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'guest-history-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
          GUEST_HISTORY_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'guest-tags-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_TAGS_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'guest-feedback-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'guest-shared-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
          GUEST_FEEDBACK_ENABLED: 'true',
          GUEST_SHARED_SELECTION_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'guest-flow-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          GUEST_EXCHANGE_ENABLED: 'true',
          GUEST_SELECTION_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
        outboundService: outbound,
      },
      {
        name: 'guest-selection-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: { ...bindings, GUEST_SELECTION_ENABLED: 'true' },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
        assets: {
          directory: resolve('.static'),
          binding: 'ASSETS',
          run_worker_first: true,
          routerConfig: {
            has_user_worker: true,
            invoke_user_worker_ahead_of_assets: true,
          },
        },
      },
      {
        name: 'guest-exchange-secure-test',
        modules: true,
        scriptPath: resolve('.build/index.js'),
        compatibilityDate: '2026-10-23',
        compatibilityFlags: ['nodejs_compat'],
        bindings: {
          ...bindings,
          APP_URL: 'https://127.0.0.1:8787',
          GUEST_EXCHANGE_ENABLED: 'true',
        },
        d1Databases: { DB: 'test' },
        r2Buckets: { PRIMARY_STORAGE: 'test' },
      },
    ],
    d1Persist: join(temporary, 'd1'),
    r2Persist: join(temporary, 'r2'),
  }),
);
let checks = 0;
async function check(label, fn) {
  process.stdout.write(`running: ${label}\n`);
  let timer;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after 120s: ${label}`)),
          120_000,
        );
      }),
    ]);
    checks++;
    process.stdout.write(`passed: ${label}\n`);
  } finally {
    clearTimeout(timer);
  }
}
try {
  const db = await mf.getD1Database('DB', 'app');
  await check(
    'D1 0004-0051 migrations preserve history and introduce version-bound review guards without rewriting data',
    async () => {
      const upgradeDb = await mf.getD1Database('DB_UPGRADE', 'app');
      const migrationFiles = (await readdir('migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort();
      const sources = new Map(
        await Promise.all(
          migrationFiles.map(async (file) => [
            file,
            (await readFile(join('migrations', file), 'utf8'))
              .split(/\r?\n/)
              .filter((line) => line.trim() && !line.trim().startsWith('--'))
              .join(' '),
          ]),
        ),
      );
      for (const file of migrationFiles.filter(
        (f) => f < '0004_projects_albums.sql',
      ))
        await upgradeDb.exec(sources.get(file));
      const user = '66666666-6666-4666-8666-666666666666';
      const session = '55555555-5555-4555-8555-555555555555';
      const workspace = '44444444-4444-4444-8444-444444444444';
      const req = '33333333-3333-4333-8333-333333333333';
      await upgradeDb
        .prepare(
          "INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,'Upgrade Owner','upgrade@example.invalid',1,unixepoch()*1000,unixepoch()*1000)",
        )
        .bind(user)
        .run();
      await upgradeDb
        .prepare('INSERT INTO owners(id,user_id) VALUES(1,?)')
        .bind(user)
        .run();
      await upgradeDb
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          session,
          'upgrade-session',
          user,
          Date.now() + 3600000,
          Date.now(),
          Date.now(),
        )
        .run();
      await upgradeDb
        .prepare(
          'INSERT INTO workspace_commands(actor_id,request_id,session_id,name,workspace_id) VALUES(?,?,?,?,?)',
        )
        .bind(user, req, session, 'Existing workspace', workspace)
        .run();
      const old = await upgradeDb
        .prepare('SELECT * FROM workspace_commands WHERE request_id=?')
        .bind(req)
        .first();
      await upgradeDb.exec(sources.get('0004_projects_albums.sql'));
      const migrated = await upgradeDb
        .prepare(
          'SELECT * FROM request_commands WHERE actor_id=? AND request_id=?',
        )
        .bind(user, req)
        .first();
      assert.equal(migrated.operation, 'workspace.created');
      assert.equal(migrated.workspace_id, workspace);
      assert.deepEqual(
        JSON.parse(migrated.result_json),
        JSON.parse(old.result_json),
      );
      assert.equal(
        (
          await upgradeDb
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='workspace.created' AND request_id=?",
            )
            .bind(req)
            .first()
        ).n,
        1,
      );
      const historicalAudit = await upgradeDb
        .prepare('SELECT * FROM audit_events ORDER BY event_id')
        .all();
      await upgradeDb.exec(sources.get('0005_content_parent_guards.sql'));
      await upgradeDb.exec(sources.get('0006_actor_scoped_audit_keys.sql'));
      await upgradeDb.exec(sources.get('0007_rebind_audit_triggers.sql'));
      const rebuiltAudit = await upgradeDb
        .prepare('SELECT * FROM audit_events ORDER BY event_id')
        .all();
      assert.deepEqual(rebuiltAudit.results, historicalAudit.results);
      const newSession = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await upgradeDb
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          newSession,
          'upgrade-session-after-rebind',
          user,
          Date.now() + 3600000,
          Date.now(),
          Date.now(),
        )
        .run();
      assert.equal(
        (
          await upgradeDb
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='owner.signed_in' AND session_id=?",
            )
            .bind(newSession)
            .first()
        ).n,
        1,
      );
      const otherActor = '22222222-2222-4222-8222-222222222222';
      await upgradeDb
        .prepare(
          "INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,'Second Actor','second@example.invalid',1,unixepoch()*1000,unixepoch()*1000)",
        )
        .bind(otherActor)
        .run();
      const sameRequest = '11111111-1111-4111-8111-111111111111';
      const insertAudit = upgradeDb.prepare(
        "INSERT INTO audit_events(event_id,actor_type,actor_id,action,request_id) VALUES(?,'user',?,'same.operation',?)",
      );
      await upgradeDb.batch([
        insertAudit.bind('same-event-a', user, sameRequest),
        insertAudit.bind('same-event-b', otherActor, sameRequest),
      ]);
      assert.equal(
        (
          await upgradeDb
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='same.operation' AND request_id=?",
            )
            .bind(sameRequest)
            .first()
        ).n,
        2,
      );
      const auditBeforeUploads = await upgradeDb
        .prepare('SELECT * FROM audit_events ORDER BY event_id')
        .all();
      await upgradeDb.exec(sources.get('0008_upload_reservations.sql'));
      await upgradeDb.exec(
        sources.get('0009_upload_authorization_and_assets.sql'),
      );
      await upgradeDb.exec(
        sources.get('0010_upload_spec_payload_correction.sql'),
      );
      await upgradeDb.exec(sources.get('0011_photo_scope_integrity.sql'));
      const legacyProject = randomUUID();
      const legacyAlbum = randomUUID();
      const legacyPhoto = randomUUID();
      const legacyVersion = randomUUID();
      const legacyAsset = randomUUID();
      await upgradeDb
        .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
        .bind(legacyProject, workspace, 'Legacy project')
        .run();
      await upgradeDb
        .prepare(
          'INSERT INTO albums(id,workspace_id,project_id,name) VALUES(?,?,?,?)',
        )
        .bind(legacyAlbum, workspace, legacyProject, 'Legacy album')
        .run();
      await upgradeDb
        .prepare(
          'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
        )
        .bind(legacyPhoto, workspace, legacyProject, legacyAlbum, 'legacy.png')
        .run();
      await upgradeDb
        .prepare(
          "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,status) VALUES(?,?,?,1,?,?,17,'image/png','private')",
        )
        .bind(legacyVersion, workspace, legacyPhoto, user, 'a'.repeat(64))
        .run();
      await upgradeDb
        .prepare(
          "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,'primary','original',?,17,'image/png',?,'private')",
        )
        .bind(
          legacyAsset,
          workspace,
          legacyPhoto,
          legacyVersion,
          `${workspace}/${legacyProject}/${legacyAlbum}/legacy/original`,
          'a'.repeat(64),
        )
        .run();
      await upgradeDb
        .prepare(
          'UPDATE workspace_storage_usage SET used_bytes=17 WHERE workspace_id=?',
        )
        .bind(workspace)
        .run();
      await upgradeDb
        .prepare("UPDATE storage_nodes SET used_bytes=17 WHERE id='primary'")
        .run();
      const legacyVersionBefore = await upgradeDb
        .prepare('SELECT * FROM photo_versions WHERE id=?')
        .bind(legacyVersion)
        .first();
      const legacyAssetBefore = await upgradeDb
        .prepare('SELECT * FROM photo_assets WHERE id=?')
        .bind(legacyAsset)
        .first();
      await upgradeDb.exec(sources.get('0012_upload_image_dimensions.sql'));
      await upgradeDb.exec(sources.get('0013_image_processing_jobs.sql'));
      await upgradeDb.exec(sources.get('0014_archive_busy_scope_replay.sql'));
      assert.equal(
        (
          await upgradeDb
            .prepare('SELECT count(*) AS n FROM image_processing_jobs')
            .first()
        ).n,
        0,
      );
      assert.deepEqual(
        await upgradeDb
          .prepare('SELECT * FROM photo_versions WHERE id=?')
          .bind(legacyVersion)
          .first(),
        legacyVersionBefore,
      );
      assert.deepEqual(
        await upgradeDb
          .prepare('SELECT * FROM photo_assets WHERE id=?')
          .bind(legacyAsset)
          .first(),
        legacyAssetBefore,
      );
      assert.deepEqual(
        await upgradeDb
          .prepare(
            'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          )
          .bind(workspace)
          .first(),
        { used_bytes: 17, reserved_bytes: 0 },
      );
      assert.deepEqual(
        await upgradeDb
          .prepare(
            "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
          )
          .first(),
        { used_bytes: 17, reserved_bytes: 0 },
      );
      for (const [width, height] of [
        [null, null],
        [32769, 1],
        [10000, 10000],
        [1.5, 1],
        [0, 1],
      ]) {
        await assert.rejects(
          upgradeDb
            .prepare(
              "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,2,?,?,1,'image/png',?,?,'private')",
            )
            .bind(
              randomUUID(),
              workspace,
              legacyPhoto,
              user,
              'b'.repeat(64),
              width,
              height,
            )
            .run(),
          /IMAGE_DIMENSIONS_EXCEEDED/,
        );
      }
      const auditAfterUploads = await upgradeDb
        .prepare('SELECT * FROM audit_events ORDER BY event_id')
        .all();
      assert.deepEqual(auditAfterUploads.results, auditBeforeUploads.results);
      assert.equal(
        (
          await upgradeDb
            .prepare(
              'SELECT count(*) AS n FROM workspace_storage_usage WHERE workspace_id=?',
            )
            .bind(workspace)
            .first()
        ).n,
        1,
      );
      assert.equal(
        (
          await upgradeDb
            .prepare(
              'SELECT reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
            )
            .bind(workspace)
            .first()
        ).reserved_bytes,
        0,
      );
      // Deliberate upgrade fixture, not a product backfill: populate the parent/child FK before rebuilding.
      await upgradeDb
        .prepare(
          "INSERT INTO image_processing_jobs(id,recipe,status,transition_id,created_at_ms,updated_at_ms) VALUES(?,'local-sharp-0.35.5-v1','queued',?,CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER))",
        )
        .bind(legacyAsset, randomUUID())
        .run();
      await upgradeDb
        .prepare(
          "UPDATE image_processing_jobs SET status='running',reserved_bytes=16777216,lease_token=?,lease_epoch=1,attempts=1,lease_until_ms=CAST(unixepoch('subsec')*1000 AS INTEGER)+600000,updated_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER),transition_id=? WHERE id=?",
        )
        .bind(randomUUID(), randomUUID(), legacyAsset)
        .run();
      await upgradeDb
        .prepare(
          "UPDATE image_processing_jobs SET status='needs_review',lease_token=NULL,lease_until_ms=NULL,reason_code='PROCESSING_CONTENT_INVALID',updated_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER),transition_id=? WHERE id=?",
        )
        .bind(randomUUID(), legacyAsset)
        .run();
      const snapshot = async () => ({
        jobs: (
          await upgradeDb
            .prepare('SELECT * FROM image_processing_jobs ORDER BY id')
            .all()
        ).results,
        outputs: (
          await upgradeDb
            .prepare(
              'SELECT * FROM image_processing_outputs ORDER BY job_id,kind',
            )
            .all()
        ).results,
        usage: (
          await upgradeDb
            .prepare(
              'SELECT * FROM workspace_storage_usage ORDER BY workspace_id',
            )
            .all()
        ).results,
        nodes: (
          await upgradeDb
            .prepare('SELECT * FROM storage_nodes ORDER BY id')
            .all()
        ).results,
        audit: (
          await upgradeDb
            .prepare('SELECT * FROM audit_events ORDER BY event_id')
            .all()
        ).results,
      });
      const beforeResolutionUpgrade = await snapshot();
      await upgradeDb.exec(
        sources.get('0015_processing_review_resolution.sql'),
      );
      assert.deepEqual(await snapshot(), beforeResolutionUpgrade);
      const beforeGuestUpgrade = await snapshot();
      await upgradeDb.exec(sources.get('0016_guest_access_foundation.sql'));
      assert.deepEqual(await snapshot(), beforeGuestUpgrade);
      assert.equal(
        (
          await upgradeDb
            .prepare('SELECT count(*) AS n FROM guest_invites')
            .first()
        ).n,
        0,
      );
      const legacyInvite = randomUUID();
      await upgradeDb
        .prepare(
          "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',1,?,?,?)",
        )
        .bind(
          legacyInvite,
          workspace,
          legacyProject,
          'd'.repeat(64),
          Date.now() + 600000,
          user,
          newSession,
        )
        .run();
      await upgradeDb
        .prepare(
          'INSERT INTO guest_invite_revocations(invite_id,actor_id,owner_session_id) VALUES(?,?,?)',
        )
        .bind(legacyInvite, user, newSession)
        .run();
      const oldRevocation = await upgradeDb
        .prepare('SELECT * FROM guest_invite_revocations WHERE invite_id=?')
        .bind(legacyInvite)
        .first();
      const beforeInviteCommands = await snapshot();
      await upgradeDb.exec(sources.get('0017_invite_revocation_commands.sql'));
      assert.deepEqual(await snapshot(), beforeInviteCommands);
      assert.deepEqual(
        await upgradeDb
          .prepare('SELECT * FROM guest_invite_revocations WHERE invite_id=?')
          .bind(legacyInvite)
          .first(),
        oldRevocation,
      );
      assert.equal(
        (
          await upgradeDb
            .prepare('SELECT count(*) AS n FROM invite_revocation_commands')
            .first()
        ).n,
        0,
      );
      const guestProject = randomUUID(),
        guestAlbum = randomUUID(),
        guestInvite = randomUUID(),
        guestIdentity = randomUUID(),
        guestSession = randomUUID(),
        oldPasswordInvite = randomUUID();
      await upgradeDb.batch([
        upgradeDb
          .prepare('INSERT INTO projects(id,workspace_id,name) VALUES(?,?,?)')
          .bind(guestProject, workspace, 'Historical Guest project'),
        upgradeDb
          .prepare(
            "INSERT INTO albums(id,workspace_id,project_id,name,state) VALUES(?,?,?,?,'active')",
          )
          .bind(guestAlbum, workspace, guestProject, 'Historical Guest album'),
        upgradeDb
          .prepare(
            "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',1,?,?,?)",
          )
          .bind(
            guestInvite,
            workspace,
            guestProject,
            'e'.repeat(64),
            Date.now() + 600000,
            user,
            newSession,
          ),
        upgradeDb
          .prepare('INSERT INTO guest_invite_albums VALUES(?,?,?,?)')
          .bind(guestInvite, workspace, guestProject, guestAlbum),
        upgradeDb
          .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
          .bind(guestInvite),
        upgradeDb
          .prepare(
            'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
          )
          .bind(guestIdentity, guestInvite, 'Historical identity'),
        upgradeDb
          .prepare(
            'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
          )
          .bind(
            guestSession,
            guestInvite,
            guestIdentity,
            'f'.repeat(64),
            Date.now() + 300000,
          ),
        upgradeDb
          .prepare(
            'INSERT INTO guest_session_revocations(session_id,secret_hash) VALUES(?,?)',
          )
          .bind(guestSession, 'f'.repeat(64)),
        upgradeDb
          .prepare(
            "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,password_verifier,permissions_mask,expires_at_ms,created_by,owner_session_id) VALUES(?,?,?,?,'custom_password',?,1,?,?,?)",
          )
          .bind(
            oldPasswordInvite,
            workspace,
            guestProject,
            'c'.repeat(64),
            'historical-unverified-placeholder-retained-for-audit',
            Date.now() + 600000,
            user,
            newSession,
          ),
      ]);
      const guestSnapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            [
              'guest_invites',
              'guest_invite_albums',
              'guest_invite_seals',
              'guest_identities',
              'guest_sessions',
              'guest_session_revocations',
            ].map(async (table) => [
              table,
              (
                await upgradeDb
                  .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
                  .all()
              ).results,
            ]),
          ),
        );
      const oldGuestRows = await guestSnapshot(),
        beforeLogoutUpgrade = await snapshot();
      await upgradeDb.exec(sources.get('0018_guest_logout_commands.sql'));
      assert.deepEqual(await guestSnapshot(), oldGuestRows);
      assert.deepEqual(await snapshot(), beforeLogoutUpgrade);
      assert.equal(
        (
          await upgradeDb
            .prepare('SELECT count(*) AS n FROM guest_logout_commands')
            .first()
        ).n,
        0,
      );
      const beforeIssuanceUpgrade = await snapshot(),
        oldIssuanceGuests = await guestSnapshot();
      await upgradeDb.exec(sources.get('0019_invite_creation_commands.sql'));
      await upgradeDb.exec(sources.get('0020_kdf_permits.sql'));
      await upgradeDb.exec(sources.get('0021_guest_exchange_buckets.sql'));
      await upgradeDb.exec(sources.get('0022_guest_exchange.sql'));
      assert.deepEqual(await snapshot(), beforeIssuanceUpgrade);
      assert.deepEqual(await guestSnapshot(), oldIssuanceGuests);
      assert.equal(
        (
          await upgradeDb
            .prepare('SELECT count(*) AS n FROM guest_exchange_buckets')
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await upgradeDb
            .prepare('SELECT count(*) AS n FROM invite_creation_commands')
            .first()
        ).n,
        0,
      );
      const beforeSelectionUpgrade = await snapshot(),
        oldSelectionGuests = await guestSnapshot();
      await upgradeDb.exec(sources.get('0023_guest_selection.sql'));
      assert.deepEqual(await snapshot(), beforeSelectionUpgrade);
      assert.deepEqual(await guestSnapshot(), oldSelectionGuests);
      const selectionInvite = randomUUID(),
        selectionGuest = randomUUID(),
        selectionSession = randomUUID(),
        selectionPhoto = randomUUID(),
        selectionVersion = randomUUID(),
        selectionRequest = randomUUID(),
        selectionCommand = randomUUID(),
        selectionSecret = '5'.repeat(64),
        selectionSecretHash = createHash('sha256')
          .update(`kino-pic:guest-session:v1:${selectionSecret}`)
          .digest('hex');
      await upgradeDb.batch([
        upgradeDb
          .prepare(
            "INSERT INTO guest_invites(id,workspace_id,project_id,token_hash,access_mode,permissions_mask,expires_at_ms,created_by,owner_session_id) VALUES(?,?,?,?,'link_only',568,?,?,?)",
          )
          .bind(
            selectionInvite,
            workspace,
            guestProject,
            'a'.repeat(64),
            Date.now() + 600000,
            user,
            newSession,
          ),
        upgradeDb
          .prepare(
            'INSERT INTO guest_invite_albums(invite_id,workspace_id,project_id,album_id) VALUES(?,?,?,?)',
          )
          .bind(selectionInvite, workspace, guestProject, guestAlbum),
        upgradeDb
          .prepare('INSERT INTO guest_invite_seals(invite_id) VALUES(?)')
          .bind(selectionInvite),
        upgradeDb
          .prepare(
            'INSERT INTO guest_identities(id,invite_id,display_name) VALUES(?,?,?)',
          )
          .bind(selectionGuest, selectionInvite, 'Selection upgrade guest'),
        upgradeDb
          .prepare(
            'INSERT INTO guest_sessions(id,invite_id,guest_id,secret_hash,expires_at_ms) VALUES(?,?,?,?,?)',
          )
          .bind(
            selectionSession,
            selectionInvite,
            selectionGuest,
            selectionSecretHash,
            Date.now() + 300000,
          ),
        upgradeDb
          .prepare(
            'INSERT INTO photos(id,workspace_id,project_id,album_id,original_filename) VALUES(?,?,?,?,?)',
          )
          .bind(
            selectionPhoto,
            workspace,
            guestProject,
            guestAlbum,
            'upgrade.jpg',
          ),
        upgradeDb
          .prepare(
            "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,1,NULL,?,? ,1,'image/jpeg',1,1,'private')",
          )
          .bind(
            selectionVersion,
            workspace,
            selectionPhoto,
            user,
            'b'.repeat(64),
          ),
      ]);
      await upgradeDb
        .prepare(
          'INSERT INTO guest_selection_commands(id,guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,photo_id,version_id,selected,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?)',
        )
        .bind(
          selectionCommand,
          selectionGuest,
          selectionInvite,
          selectionSession,
          selectionSecretHash,
          selectionRequest,
          workspace,
          guestProject,
          guestAlbum,
          selectionPhoto,
          selectionVersion,
          JSON.stringify({ selected: true, versionId: selectionVersion }),
        )
        .run();
      const beforeRoundUpgrade = await snapshot(),
        oldRoundGuests = await guestSnapshot(),
        oldSelectionRows = await Promise.all(
          [
            'guest_selection_state',
            'guest_selection_commands',
            'guest_selection_results',
          ].map(async (table) => [
            table,
            (
              await upgradeDb
                .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
                .all()
            ).results,
          ]),
        );
      await upgradeDb.exec(sources.get('0024_guest_selection_submissions.sql'));
      await upgradeDb.exec(sources.get('0025_guest_selection_empty_guard.sql'));
      assert.deepEqual(await snapshot(), beforeRoundUpgrade);
      assert.deepEqual(await guestSnapshot(), oldRoundGuests);
      assert.deepEqual(
        await Promise.all(
          oldSelectionRows.map(async ([table]) => [
            table,
            (
              await upgradeDb
                .prepare(`SELECT * FROM ${table} ORDER BY rowid`)
                .all()
            ).results,
          ]),
        ),
        oldSelectionRows,
      );
      const migratedRound = await upgradeDb
        .prepare(
          'SELECT round_no,selection_revision,status,submitted_at_ms FROM guest_selection_round_state WHERE invite_id=? AND guest_id=? AND album_id=?',
        )
        .bind(selectionInvite, selectionGuest, guestAlbum)
        .first();
      assert.deepEqual(migratedRound, {
        round_no: 1,
        selection_revision: 1,
        status: 'open',
        submitted_at_ms: null,
      });
      for (const table of [
        'guest_selection_submissions',
        'guest_selection_submission_items',
        'guest_selection_submission_results',
      ])
        assert.equal(
          (
            await upgradeDb
              .prepare(`SELECT count(*) AS n FROM ${table}`)
              .first()
          ).n,
          0,
        );
      const upgradeSubmission = randomUUID();
      await upgradeDb
        .prepare(
          `INSERT INTO guest_selection_submissions(
            id,guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,
            round_no,selection_revision,expected_round_no,expected_revision,payload_json
          ) VALUES(?,?,?,?,?,?,?,?,?,1,1,1,1,?)`,
        )
        .bind(
          upgradeSubmission,
          selectionGuest,
          selectionInvite,
          selectionSession,
          selectionSecretHash,
          randomUUID(),
          workspace,
          guestProject,
          guestAlbum,
          JSON.stringify({ expectedRoundNo: 1, expectedRevision: 1 }),
        )
        .run();
      const selectionSubmissionSnapshot = async () => ({
        submissions: (
          await upgradeDb
            .prepare('SELECT * FROM guest_selection_submissions ORDER BY id')
            .all()
        ).results,
        items: (
          await upgradeDb
            .prepare(
              'SELECT * FROM guest_selection_submission_items ORDER BY submission_id,photo_id',
            )
            .all()
        ).results,
        results: (
          await upgradeDb
            .prepare(
              'SELECT * FROM guest_selection_submission_results ORDER BY submission_id',
            )
            .all()
        ).results,
        audit: (
          await upgradeDb
            .prepare(
              "SELECT * FROM audit_events WHERE action='selection.submitted' ORDER BY event_id",
            )
            .all()
        ).results,
      });
      const beforeSnapshotGuardMigration = await selectionSubmissionSnapshot();
      await upgradeDb.exec(
        sources.get('0026_guest_selection_snapshot_guards.sql'),
      );
      assert.deepEqual(
        await selectionSubmissionSnapshot(),
        beforeSnapshotGuardMigration,
      );
      assert.deepEqual(
        await upgradeDb
          .prepare(
            'SELECT submission_id,item_count,sealed_at_ms FROM guest_selection_submission_seals WHERE submission_id=?',
          )
          .bind(upgradeSubmission)
          .first(),
        {
          submission_id: upgradeSubmission,
          item_count: 1,
          sealed_at_ms:
            beforeSnapshotGuardMigration.submissions[0].created_at_ms,
        },
      );
      assert.deepEqual(
        (await upgradeDb.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
      const feedbackOldTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_'));
      const feedbackLegacySnapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            feedbackOldTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results,
            ]),
          ),
        );
      const beforeFeedbackMigration = await feedbackLegacySnapshot();
      await upgradeDb.exec(sources.get('0027_guest_feedback.sql'));
      assert.deepEqual(await feedbackLegacySnapshot(), beforeFeedbackMigration);
      for (const table of [
        'guest_rating_state',
        'guest_favorite_state',
        'guest_feedback_commands',
        'guest_feedback_results',
      ])
        assert.equal(
          (
            await upgradeDb
              .prepare(`SELECT count(*) AS n FROM ${table}`)
              .first()
          ).n,
          0,
        );
      for (const [kind, value, payload] of [
        [
          'rating',
          4,
          JSON.stringify({ versionId: selectionVersion, stars: 4 }),
        ],
        [
          'favorite',
          1,
          JSON.stringify({ versionId: selectionVersion, favored: true }),
        ],
      ])
        await upgradeDb
          .prepare(
            'INSERT INTO guest_feedback_commands(id,guest_id,invite_id,session_id,secret_hash,request_id,workspace_id,project_id,album_id,photo_id,version_id,kind,value_integer,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            randomUUID(),
            selectionGuest,
            selectionInvite,
            selectionSession,
            selectionSecretHash,
            randomUUID(),
            workspace,
            guestProject,
            guestAlbum,
            selectionPhoto,
            selectionVersion,
            kind,
            value,
            payload,
          )
          .run();
      const policyOldTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_'));
      const policySnapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            policyOldTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results,
            ]),
          ),
        );
      const beforePolicyMigration = await policySnapshot();
      await upgradeDb.exec(sources.get('0028_selection_policy.sql'));
      assert.deepEqual(await policySnapshot(), beforePolicyMigration);
      for (const table of [
        'album_selection_policies',
        'selection_policy_commands',
        'selection_policy_results',
      ])
        assert.equal(
          (
            await upgradeDb
              .prepare(`SELECT count(*) AS n FROM ${table}`)
              .first()
          ).n,
          0,
        );
      const legacyReopenRequest = randomUUID();
      const legacyReopenEvent =
        'guest-selection-reopen:' +
        selectionInvite +
        ':' +
        selectionGuest +
        ':' +
        guestAlbum +
        ':2';
      await upgradeDb
        .prepare(
          "INSERT INTO audit_events(event_id,actor_type,actor_id,session_id,workspace_id,project_id,album_id,action,before_json,after_json,request_id) VALUES(?,'user',?,?,?,?,?,'selection.reopened',?,?,?)",
        )
        .bind(
          legacyReopenEvent,
          user,
          newSession,
          workspace,
          guestProject,
          guestAlbum,
          JSON.stringify({ status: 'submitted', roundNo: 1 }),
          JSON.stringify({ status: 'open', roundNo: 2 }),
          legacyReopenRequest,
        )
        .run();
      await upgradeDb
        .prepare(
          "UPDATE guest_selection_round_state SET status='open',round_no=2,selection_revision=0,submitted_at_ms=NULL WHERE invite_id=? AND guest_id=? AND album_id=?",
        )
        .bind(selectionInvite, selectionGuest, guestAlbum)
        .run();
      const legacyAuditBefore = await upgradeDb
        .prepare('SELECT * FROM audit_events WHERE event_id=?')
        .bind(legacyReopenEvent)
        .first();
      const sealedBeforeRevisionMigration = await selectionSubmissionSnapshot();
      const feedbackBeforeRevisionMigration = (
        await upgradeDb
          .prepare('SELECT * FROM guest_feedback_results ORDER BY command_id')
          .all()
      ).results;
      await upgradeDb.exec(sources.get('0029_reopened_selection_revision.sql'));
      assert.equal(
        (
          await upgradeDb
            .prepare(
              'SELECT selection_revision FROM guest_selection_round_state WHERE invite_id=? AND guest_id=? AND album_id=?',
            )
            .bind(selectionInvite, selectionGuest, guestAlbum)
            .first()
        ).selection_revision,
        1,
      );
      assert.deepEqual(
        await selectionSubmissionSnapshot(),
        sealedBeforeRevisionMigration,
      );
      assert.deepEqual(
        (
          await upgradeDb
            .prepare('SELECT * FROM guest_feedback_results ORDER BY command_id')
            .all()
        ).results,
        feedbackBeforeRevisionMigration,
      );
      assert.deepEqual(
        await upgradeDb
          .prepare('SELECT * FROM audit_events WHERE event_id=?')
          .bind(legacyReopenEvent)
          .first(),
        legacyAuditBefore,
      );
      assert.equal(
        (
          await upgradeDb
            .prepare(
              "SELECT count(*) AS n FROM audit_events WHERE action='selection.round_initialized' AND album_id=?",
            )
            .bind(guestAlbum)
            .first()
        ).n,
        1,
      );
      const beforeSharedTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_'));
      const sharedLegacySnapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            beforeSharedTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results,
            ]),
          ),
        );
      const beforeSharedMigration = await sharedLegacySnapshot();
      await upgradeDb.exec(sources.get('0030_shared_reviews.sql'));
      assert.deepEqual(await sharedLegacySnapshot(), beforeSharedMigration);
      for (const name of [
        'shared_reviews',
        'shared_review_invites',
        'shared_review_seals',
        'shared_review_rounds',
        'shared_review_state',
        'shared_review_owner_commands',
        'shared_review_owner_results',
        'shared_review_guest_commands',
        'shared_review_guest_results',
        'shared_review_submissions',
        'shared_review_submission_items',
        'shared_review_submission_seals',
      ])
        assert.equal(
          (await upgradeDb.prepare('SELECT count(*) AS n FROM ' + name).first())
            .n,
          0,
        );
      assert.deepEqual(
        (await upgradeDb.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
      // Populate an actual0028 override before0031; empty-table comparisons
      // alone cannot prove legacy state/command/result seeding compatibility.
      const legacyPolicyCommand = randomUUID();
      const legacyPolicyRequest = randomUUID();
      await upgradeDb
        .prepare(
          'INSERT INTO selection_policy_commands(id,actor_id,session_id,request_id,workspace_id,project_id,album_id,expected_revision,minimum,maximum,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?,0,2,NULL,?,?)',
        )
        .bind(
          legacyPolicyCommand,
          user,
          newSession,
          legacyPolicyRequest,
          workspace,
          guestProject,
          guestAlbum,
          JSON.stringify({
            albumId: guestAlbum,
            expectedRevision: 0,
            minimum: 2,
            maximum: null,
            confirm: true,
          }),
          Date.now(),
        )
        .run();
      const beforeConfigurationTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_'));
      const configurationLegacySnapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            beforeConfigurationTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results,
            ]),
          ),
        );
      const beforeConfigurationMigration = await configurationLegacySnapshot();
      await upgradeDb.exec(
        sources.get('0031_selection_policy_configuration.sql'),
      );
      assert.deepEqual(
        await configurationLegacySnapshot(),
        beforeConfigurationMigration,
      );
      const oldPolicies = (
        await upgradeDb
          .prepare(
            'SELECT album_id,workspace_id,project_id,minimum,maximum,revision FROM album_selection_policies ORDER BY album_id',
          )
          .all()
      ).results;
      const seededPolicies = (
        await upgradeDb
          .prepare(
            'SELECT album_id,workspace_id,project_id,minimum,maximum,revision FROM album_selection_policy_configurations ORDER BY album_id',
          )
          .all()
      ).results;
      const beforeIntegrityTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('_'));
      const integritySnapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            beforeIntegrityTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results,
            ]),
          ),
        );
      const beforeIntegrityMigration = await integritySnapshot();
      await upgradeDb.exec(
        sources.get('0032_immutable_result_insert_integrity.sql'),
      );
      assert.deepEqual(await integritySnapshot(), beforeIntegrityMigration);
      await upgradeDb.exec(
        sources.get('0033_immutable_photo_insert_integrity.sql'),
      );
      await upgradeDb.exec(sources.get('0034_guest_tags.sql'));
      const beforeHistoryIndex = await integritySnapshot();
      await upgradeDb.exec(sources.get('0035_guest_history_index.sql'));
      assert.deepEqual(await integritySnapshot(), beforeHistoryIndex);
      const beforeVersionHeads = await integritySnapshot();
      await upgradeDb.exec(sources.get('0036_photo_version_heads.sql'));
      assert.deepEqual(await integritySnapshot(), beforeVersionHeads);
      const initialHeads = await upgradeDb
        .prepare(
          `SELECT count(*) AS n FROM photo_version_heads h JOIN photo_versions v ON v.id=h.version_id AND v.photo_id=h.photo_id AND v.workspace_id=h.workspace_id WHERE v.version_no=1 AND h.revision=0 AND h.last_command_id IS NULL`,
        )
        .first();
      const originalVersions = await upgradeDb
        .prepare('SELECT count(*) AS n FROM photo_versions WHERE version_no=1')
        .first();
      assert.equal(initialHeads.n, originalVersions.n);
      const beforeVersionUploads = await integritySnapshot();
      const beforeUploadHeads = (
        await upgradeDb
          .prepare('SELECT * FROM photo_version_heads ORDER BY photo_id')
          .all()
      ).results;
      await upgradeDb.exec(sources.get('0037_photo_version_uploads.sql'));
      assert.deepEqual(await integritySnapshot(), beforeVersionUploads);
      assert.deepEqual(
        (
          await upgradeDb
            .prepare('SELECT * FROM photo_version_heads ORDER BY photo_id')
            .all()
        ).results,
        beforeUploadHeads,
      );
      for (const table of [
        'upload_version_targets',
        'upload_version_completions',
      ]) {
        assert.equal(
          (
            await upgradeDb
              .prepare('SELECT count(*) AS n FROM ' + table)
              .first()
          ).n,
          0,
        );
      }
      assert.deepEqual(
        (await upgradeDb.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );

      for (const table of [
        'guest_tag_labels',
        'guest_tag_commands',
        'guest_tag_results',
        'guest_tag_state',
      ]) {
        assert.equal(
          (
            await upgradeDb
              .prepare('SELECT count(*) AS n FROM ' + table)
              .first()
          ).n,
          0,
        );
      }
      assert.deepEqual(await integritySnapshot(), beforeIntegrityMigration);
      await assertImmutableResultInsertIntegrity(
        upgradeDb,
        'selection_policy_results',
        'command_id',
        'IMMUTABLE_SELECTION_POLICY_RESULT',
      );
      assert.equal(oldPolicies.length, 1);
      await assert.rejects(
        upgradeDb
          .prepare(
            'INSERT OR REPLACE INTO selection_policy_results SELECT * FROM selection_policy_results WHERE command_id=?',
          )
          .bind(legacyPolicyCommand)
          .run(),
        /IMMUTABLE_SELECTION_POLICY_RESULT/u,
      );

      assert.deepEqual(seededPolicies, oldPolicies);
      await assert.rejects(
        upgradeDb
          .prepare(
            "INSERT OR REPLACE INTO album_selection_policy_configurations(album_id,workspace_id,project_id,configuration,minimum,maximum,revision,last_command_id,legacy_command_id,updated_at_ms) SELECT album_id,workspace_id,project_id,'override',minimum,maximum,revision,NULL,last_command_id,updated_at_ms FROM album_selection_policies",
          )
          .run(),
        /INVALID_SELECTION_POLICY_LEGACY_SEED/u,
      );
      assert.deepEqual(
        await configurationLegacySnapshot(),
        beforeConfigurationMigration,
      );

      assert.equal(
        (
          await upgradeDb
            .prepare(
              "SELECT count(*) AS n FROM album_selection_policy_configurations WHERE configuration<>'override'",
            )
            .first()
        ).n,
        0,
      );
      for (const table of [
        'project_selection_policy_configurations',
        'selection_policy_configuration_commands',
        'selection_policy_configuration_results',
      ])
        assert.equal(
          (
            await upgradeDb
              .prepare('SELECT count(*) AS n FROM ' + table)
              .first()
          ).n,
          0,
        );
      assert.deepEqual(
        (await upgradeDb.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
      for (const table of [
        'guest_kdf_permits',
        'guest_kdf_permit_releases',
        'guest_kdf_active_slot',
        'guest_exchange_commands',
      ])
        assert.equal(
          (
            await upgradeDb
              .prepare(`SELECT count(*) AS n FROM ${table}`)
              .first()
          ).n,
          0,
        );
      assert.deepEqual(
        (await upgradeDb.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
      assert.equal(
        (
          await upgradeDb
            .prepare(
              "SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name='processing_jobs_pending'",
            )
            .first()
        ).n,
        1,
      );
      await assert.rejects(
        upgradeDb
          .prepare(
            "UPDATE image_processing_jobs SET status='abandoned',reserved_bytes=0,transition_id=?,updated_at_ms=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE id=?",
          )
          .bind(randomUUID(), legacyAsset)
          .run(),
        /PROCESSING_LEASE_LOST/,
      );
      const beforeProjectVersioning = await integritySnapshot();
      await upgradeDb.exec(
        sources.get('0038_project_versioning_configuration.sql'),
      );
      const afterProjectVersioning = await integritySnapshot();
      afterProjectVersioning.projects = afterProjectVersioning.projects.map(
        (row) =>
          Object.fromEntries(
            Object.entries(row).filter(
              ([key]) => key !== 'versioning_command_id',
            ),
          ),
      );
      assert.deepEqual(afterProjectVersioning, beforeProjectVersioning);
      assert.equal(
        (
          await upgradeDb
            .prepare(
              'SELECT count(*) AS n FROM projects WHERE versioning_command_id IS NOT NULL',
            )
            .first()
        ).n,
        0,
      );
      for (const table of [
        'project_versioning_commands',
        'project_versioning_results',
      ])
        assert.equal(
          (
            await upgradeDb
              .prepare('SELECT count(*) AS n FROM ' + table)
              .first()
          ).n,
          0,
        );
      const preExternalTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_'));
      const snapshotPreExternal = async () =>
        Object.fromEntries(
          await Promise.all(
            preExternalTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results,
            ]),
          ),
        );
      const beforeExternal = await snapshotPreExternal();
      await upgradeDb.exec(sources.get('0039_owner_external_intents.sql'));
      assert.deepEqual(await snapshotPreExternal(), beforeExternal);
      const receiptSnapshot = (
        await upgradeDb.prepare('SELECT * FROM owner_external_intents').all()
      ).results;
      await upgradeDb.exec(sources.get('0040_album_matching_changes.sql'));
      await upgradeDb.exec(
        sources.get('0041_resolved_upload_reservations.sql'),
      );
      assert.deepEqual(await snapshotPreExternal(), beforeExternal);
      assert.deepEqual(
        (await upgradeDb.prepare('SELECT * FROM owner_external_intents').all())
          .results,
        receiptSnapshot,
      );
      assert.equal(
        (
          await upgradeDb
            .prepare('SELECT count(*) AS n FROM album_matching_changes')
            .first()
        ).n,
        0,
      );
      assert.equal(
        (
          await upgradeDb
            .prepare('SELECT count(*) AS n FROM owner_external_intents')
            .first()
        ).n,
        0,
      );
      const preCommentTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_'));
      const commentUpgradeSnapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            preCommentTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results,
            ]),
          ),
        );
      const beforeComments = await commentUpgradeSnapshot();
      await upgradeDb.exec(sources.get('0042_guest_comments.sql'));
      assert.deepEqual(await commentUpgradeSnapshot(), beforeComments);
      for (const table of [
        'guest_comments',
        'guest_comment_commands',
        'guest_comment_changes',
        'guest_comment_results',
      ]) {
        assert.equal(
          (
            await upgradeDb
              .prepare('SELECT count(*) AS n FROM ' + table)
              .first()
          ).n,
          0,
        );
      }
      await seedPreOwnerCommentHistory({
        db: upgradeDb,
        storage: await mf.getR2Bucket('COMMENT_UPGRADE_STORAGE', 'app'),
        owner: user,
        photoId: selectionPhoto,
      });
      const preOwnerTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_'));
      const snapshotBeforeOwnerSchema = async () =>
        Object.fromEntries(
          await Promise.all(
            preOwnerTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results.sort((left, right) =>
                JSON.stringify(left).localeCompare(JSON.stringify(right)),
              ),
            ]),
          ),
        );
      const beforeOwnerReplies = await snapshotBeforeOwnerSchema();
      assert.ok(beforeOwnerReplies.guest_comments.length > 0);
      assert.ok(beforeOwnerReplies.guest_comment_changes.length > 1);
      await upgradeDb.exec(sources.get('0043_owner_comment_replies.sql'));
      assert.deepEqual(await snapshotBeforeOwnerSchema(), beforeOwnerReplies);
      for (const table of [
        'owner_comment_commands',
        'owner_comment_replies',
        'owner_comment_changes',
        'owner_comment_results',
        'comment_thread_changes',
      ]) {
        assert.equal(
          (
            await upgradeDb
              .prepare('SELECT count(*) AS n FROM ' + table)
              .first()
          ).n,
          0,
        );
      }
      await seedPreProcessingHistory({
        db: upgradeDb,
        owner: user,
        photoId: selectionPhoto,
      });
      const preProcessingTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_'));
      const snapshotBeforeProcessingSchema = async () =>
        Object.fromEntries(
          await Promise.all(
            preProcessingTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results.sort((a, b) =>
                JSON.stringify(a).localeCompare(JSON.stringify(b)),
              ),
            ]),
          ),
        );
      const beforeProcessing = await snapshotBeforeProcessingSchema();
      assert.ok(beforeProcessing.owner_comment_changes.length > 0);
      assert.ok(
        beforeProcessing.comment_thread_changes.some(
          (row) => row.source_kind === 'guest',
        ),
      );
      assert.ok(
        beforeProcessing.comment_thread_changes.some(
          (row) => row.source_kind === 'owner',
        ),
      );
      const oldMarkerSeq = (
        await upgradeDb
          .prepare(
            "SELECT seq FROM sqlite_sequence WHERE name='comment_thread_changes'",
          )
          .first()
      ).seq;
      await upgradeDb.exec(sources.get('0044_owner_comment_processing.sql'));
      assert.deepEqual(
        await snapshotBeforeProcessingSchema(),
        beforeProcessing,
      );
      assert.equal(
        (
          await upgradeDb
            .prepare(
              "SELECT seq FROM sqlite_sequence WHERE name='comment_thread_changes'",
            )
            .first()
        ).seq,
        oldMarkerSeq,
      );
      for (const table of [
        'owner_comment_processing_commands',
        'owner_comment_processing_state',
        'owner_comment_processing_changes',
        'owner_comment_processing_results',
      ])
        assert.equal(
          (
            await upgradeDb
              .prepare('SELECT count(*) AS n FROM ' + table)
              .first()
          ).n,
          0,
        );
      const annotationUpgradeParent = await upgradeDb
        .prepare(
          'SELECT * FROM guest_comments WHERE photo_id=? ORDER BY updated_at_ms DESC,id DESC LIMIT 1',
        )
        .bind(selectionPhoto)
        .first();
      assert.ok(annotationUpgradeParent);
      const annotationUpgradeOwnerSession = await upgradeDb
        .prepare(
          "SELECT id FROM owner_sessions WHERE userId=? AND expiresAt>unixepoch('subsec')*1000 ORDER BY expiresAt DESC LIMIT 1",
        )
        .bind(user)
        .first();
      assert.ok(annotationUpgradeOwnerSession?.id);
      const processingUpgradeRequestId = randomUUID();
      const processingUpgradePayload = {
        requestId: processingUpgradeRequestId,
        operation: 'set_processing_state',
        inviteId: annotationUpgradeParent.invite_id,
        photoId: annotationUpgradeParent.photo_id,
        versionId: annotationUpgradeParent.version_id,
        commentId: annotationUpgradeParent.id,
        expectedCommentRevision: annotationUpgradeParent.revision,
        expectedProcessingRevision: 0,
        state: 'in_progress',
      };
      const processingUpgradeContent = (
        await upgradeDb
          .prepare(
            "SELECT MAX(revision) AS revision FROM guest_comment_changes WHERE comment_id=? AND operation IN('create','edit')",
          )
          .bind(annotationUpgradeParent.id)
          .first()
      ).revision;
      await upgradeDb
        .prepare(
          'INSERT INTO owner_comment_processing_commands(id,actor_id,session_id,request_id,workspace_id,project_id,album_id,invite_id,photo_id,version_id,comment_id,operation,target_state,expected_comment_revision,expected_processing_revision,content_revision,request_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          randomUUID(),
          user,
          annotationUpgradeOwnerSession.id,
          processingUpgradeRequestId,
          annotationUpgradeParent.workspace_id,
          annotationUpgradeParent.project_id,
          annotationUpgradeParent.album_id,
          annotationUpgradeParent.invite_id,
          annotationUpgradeParent.photo_id,
          annotationUpgradeParent.version_id,
          annotationUpgradeParent.id,
          'set_processing_state',
          'in_progress',
          annotationUpgradeParent.revision,
          0,
          processingUpgradeContent,
          JSON.stringify(processingUpgradePayload),
        )
        .run();
      for (const table of [
        'owner_comment_processing_commands',
        'owner_comment_processing_state',
        'owner_comment_processing_changes',
        'owner_comment_processing_results',
      ])
        assert.equal(
          (
            await upgradeDb
              .prepare('SELECT count(*) AS n FROM ' + table)
              .first()
          ).n,
          1,
        );
      const preAnnotationTables = (
        await upgradeDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
      ).results
        .map((row) => row.name)
        .filter((name) => !name.startsWith('sqlite_') && !name.startsWith('_'));
      const annotationUpgradeSnapshot = async () =>
        Object.fromEntries(
          await Promise.all(
            preAnnotationTables.map(async (name) => [
              name,
              (
                await upgradeDb
                  .prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"')
                  .all()
              ).results.sort((a, b) =>
                JSON.stringify(a).localeCompare(JSON.stringify(b)),
              ),
            ]),
          ),
        );
      const beforeAnnotations = await annotationUpgradeSnapshot();
      const annotationUpgradeMarkerSeq = (
        await upgradeDb
          .prepare(
            "SELECT seq FROM sqlite_sequence WHERE name='comment_thread_changes'",
          )
          .first()
      ).seq;
      await upgradeDb.exec(sources.get('0045_guest_annotations.sql'));
      assert.deepEqual(await annotationUpgradeSnapshot(), beforeAnnotations);
      assert.equal(
        (
          await upgradeDb
            .prepare(
              "SELECT seq FROM sqlite_sequence WHERE name='comment_thread_changes'",
            )
            .first()
        ).seq,
        annotationUpgradeMarkerSeq,
      );
      for (const table of [
        'guest_annotation_commands',
        'guest_annotations',
        'guest_annotation_changes',
        'guest_annotation_results',
      ])
        assert.equal(
          (
            await upgradeDb
              .prepare('SELECT count(*) AS n FROM ' + table)
              .first()
          ).n,
          0,
        );
      assert.deepEqual(
        (await upgradeDb.prepare('PRAGMA foreign_key_check').all()).results,
        [],
      );
      await seedAndVerifyOwnerAnnotationUpgrade({
        db: upgradeDb,
        source46: sources.get('0046_owner_annotations.sql'),
        photoScope: annotationUpgradeParent,
        ownerSessionId: annotationUpgradeOwnerSession.id,
      });
      await seedAndVerifyAnnotationProcessingUpgrade({
        db: upgradeDb,
        source47: sources.get('0047_owner_annotation_processing.sql'),
        photoScope: annotationUpgradeParent,
        ownerSessionId: annotationUpgradeOwnerSession.id,
      });
      await verifyOwnerHistoryUpgrade({
        db: upgradeDb,
        source48: sources.get('0048_owner_history_indexes.sql'),
      });
      await verifyMatchingFilenameIndexUpgrade({
        db: upgradeDb,
        source49: sources.get('0049_matching_filename_index.sql'),
      });
      await verifyAssistedCandidateCatalogUpgrade({
        db: upgradeDb,
        source50: sources.get('0050_assisted_catalog_index.sql'),
      });
      await verifyMatchingRulesUpgrade({
        db: upgradeDb,
        source51: sources.get('0051_matching_rules.sql'),
      });
    },
  );
  await check(
    'reconstructed 0010 legacy upload-spec fixture preserves quota/audit and reads the request payload',
    async () => {
      // The early 0009 draft is not tracked. Reconstruct its compatibility
      // shape from 0010's repair intent: nullable legacy upload-session spec
      // columns and an insert trigger that reads those columns. This fixture
      // does not claim to reproduce the historical migration byte-for-byte.
      const repairDb = await mf.getD1Database('DB_UPLOAD_SPEC_REPAIR', 'app');
      const migrationFiles = (await readdir('migrations'))
        .filter((f) => f.endsWith('.sql'))
        .sort();
      const sources = new Map(
        await Promise.all(
          migrationFiles.map(async (file) => [
            file,
            (await readFile(join('migrations', file), 'utf8'))
              .split(/\r?\n/)
              .filter((line) => line.trim() && !line.trim().startsWith('--'))
              .join(' '),
          ]),
        ),
      );
      for (const file of migrationFiles.filter(
        (f) => f < '0008_upload_reservations.sql',
      ))
        await repairDb.exec(sources.get(file));

      const user = '77777777-7777-4777-8777-777777777777';
      const session = '66666666-6666-4666-8666-666666666666';
      const workspace = '55555555-5555-4555-8555-555555555555';
      const project = '44444444-4444-4444-8444-444444444444';
      const album = '33333333-3333-4333-8333-333333333333';
      await repairDb
        .prepare(
          "INSERT INTO users(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,'Repair Fixture','repair@example.invalid',1,unixepoch()*1000,unixepoch()*1000)",
        )
        .bind(user)
        .run();
      await repairDb
        .prepare('INSERT INTO owners(id,user_id) VALUES(1,?)')
        .bind(user)
        .run();
      await repairDb
        .prepare(
          'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          session,
          'repair-fixture-session',
          user,
          Date.now() + 3600000,
          Date.now(),
          Date.now(),
        )
        .run();
      const addCommand = (requestId, operation, payload, resourceId) =>
        repairDb
          .prepare(
            'INSERT INTO request_commands(actor_id,request_id,operation,payload_json,session_id,resource_id) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            user,
            requestId,
            operation,
            JSON.stringify(payload),
            session,
            resourceId,
          )
          .run();
      await addCommand(
        'fixture-workspace',
        'workspace.created',
        {
          name: 'Repair Fixture Workspace',
        },
        workspace,
      );
      await addCommand(
        'fixture-project',
        'project.created',
        { workspaceId: workspace, name: 'Repair Fixture Project' },
        project,
      );
      await addCommand(
        'fixture-album',
        'album.created',
        { projectId: project, name: 'Repair Fixture Album' },
        album,
      );
      await repairDb.exec(sources.get('0008_upload_reservations.sql'));
      await repairDb
        .prepare(
          'UPDATE workspace_storage_usage SET used_bytes=123,reserved_bytes=456 WHERE workspace_id=?',
        )
        .bind(workspace)
        .run();
      await repairDb
        .prepare(
          "UPDATE storage_nodes SET used_bytes=123,reserved_bytes=456 WHERE id='primary'",
        )
        .run();
      await repairDb
        .prepare(
          "INSERT INTO audit_events(event_id,actor_type,action,after_json,request_id) VALUES('repair-fixture-audit','system','quota.synthetic','{\"usedBytes\":123,\"reservedBytes\":456}','repair-fixture-audit')",
        )
        .run();
      await repairDb.exec(
        'ALTER TABLE upload_sessions ADD COLUMN content_type TEXT; ALTER TABLE upload_sessions ADD COLUMN sha256_hex TEXT;',
      );
      await repairDb.exec(
        sources.get('0009_upload_authorization_and_assets.sql'),
      );
      await repairDb.prepare('DROP TRIGGER upload_session_add_spec').run();
      await repairDb
        .prepare(
          `CREATE TRIGGER upload_session_add_spec AFTER INSERT ON upload_sessions BEGIN
            INSERT INTO upload_specs(upload_session_id,content_type,sha256_hex,created_at_ms)
            VALUES(NEW.id,NEW.content_type,NEW.sha256_hex,NEW.created_at_ms);
          END`,
        )
        .run();

      const readQuota = async () => ({
        workspace: await repairDb
          .prepare(
            'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
          )
          .bind(workspace)
          .first(),
        storageNode: await repairDb
          .prepare(
            "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
          )
          .first(),
      });
      const quotaBeforeRepair = await readQuota();
      const auditBeforeRepair = await repairDb
        .prepare('SELECT * FROM audit_events ORDER BY event_id')
        .all();
      const legacyUploadSession = '22222222-2222-4222-8222-222222222222';
      const uploadRequest = (requestId) =>
        repairDb
          .prepare(
            'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            user,
            requestId,
            'upload.reserved',
            JSON.stringify({
              contentType: 'image/png',
              sha256: 'a'.repeat(64),
            }),
            session,
            legacyUploadSession,
            workspace,
            project,
            album,
            'primary',
            `${workspace}/${project}/${album}/${legacyUploadSession}/original`,
            'repair.png',
            8,
            Date.now(),
          )
          .run();
      await assert.rejects(uploadRequest('fixture-legacy-failure'));

      await repairDb.exec(
        sources.get('0010_upload_spec_payload_correction.sql'),
      );
      assert.deepEqual(await readQuota(), quotaBeforeRepair);
      const auditAfterRepair = await repairDb
        .prepare('SELECT * FROM audit_events ORDER BY event_id')
        .all();
      assert.deepEqual(auditAfterRepair.results, auditBeforeRepair.results);

      await uploadRequest('fixture-repaired-upload');
      const spec = await repairDb
        .prepare(
          'SELECT content_type,sha256_hex FROM upload_specs WHERE upload_session_id=?',
        )
        .bind(legacyUploadSession)
        .first();
      assert.equal(spec.content_type, 'image/png');
      assert.equal(spec.sha256_hex, 'a'.repeat(64));
      const legacyColumns = await repairDb
        .prepare(
          'SELECT content_type,sha256_hex FROM upload_sessions WHERE id=?',
        )
        .bind(legacyUploadSession)
        .first();
      assert.equal(legacyColumns.content_type, null);
      assert.equal(legacyColumns.sha256_hex, null);
      assert.deepEqual(await readQuota(), {
        workspace: { used_bytes: 123, reserved_bytes: 464 },
        storageNode: { used_bytes: 123, reserved_bytes: 464 },
      });
      for (const event of auditBeforeRepair.results) {
        assert.deepEqual(
          await repairDb
            .prepare('SELECT * FROM audit_events WHERE event_id=?')
            .bind(event.event_id)
            .first(),
          event,
        );
      }
    },
  );
  for (const file of (await readdir('migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await applyMigration(
      db,
      (await readFile(join('migrations', file), 'utf8'))
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith('--'))
        .join(' '),
    );
  const request = (path, init) => mf.dispatchFetch(base + path, init);
  await check(
    'static site, honest health and anonymous owner API denied',
    async () => {
      const page = await request('/');
      const pageText = await page.text();
      assert.equal(page.status, 200, pageText.slice(0, 1200));
      assert.match(pageText, /Kino Pick/);
      for (const path of [
        '/assets/not-a-real-file.js',
        '/assets/missing-12345678.js',
        '/assets/not-an-asset',
      ]) {
        const missing = await request(path);
        assert.equal(missing.status, 404);
        assert.equal(missing.headers.get('cache-control'), 'private, no-store');
      }
      const fingerprintedPath = pageText.match(
        /(?:src|href)="(\/assets\/[^"]+\.js)"/,
      )?.[1];
      assert.ok(fingerprintedPath);
      const publicBundle = await request(fingerprintedPath);
      assert.equal(publicBundle.status, 200);
      assert.match(
        publicBundle.headers.get('cache-control'),
        /public, max-age=31536000, immutable/,
      );
      const health = await request('/api/health');
      assert.equal(health.status, 200);
      assert.equal((await health.json()).autodelete, false);
      assert.equal((await request('/api/v1/me')).status, 401);
      assert.equal((await request('/api/v1/storage/nodes')).status, 401);
    },
  );
  await check(
    'first OAuth visitor cannot self-provision an Owner',
    async () => {
      const result = await oauth('github');
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: result.cookies.headers() },
          })
        ).status,
        401,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        0,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM owners').first()).n,
        0,
      );
    },
  );
  await check(
    'one explicit bootstrap with two subjects to one fixed internal ID',
    async () => {
      const output = join(temporary, 'bootstrap.sql');
      const cli = spawnSync(
        process.execPath,
        [
          resolve('../../tools/bootstrap-cloudflare-owner.mjs'),
          '--user-id',
          owner,
          '--google-sub',
          '12345001',
          '--github-id',
          '101',
          '--verified-subjects',
          '--out',
          output,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(cli.status, 0, cli.stderr);
      const sql = (await readFile(output, 'utf8'))
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.startsWith('--'))
        .join('\n');
      await db.exec(
        "CREATE TRIGGER reject_bootstrap_audit BEFORE INSERT ON audit_events WHEN NEW.action='owner.bootstrapped' BEGIN SELECT RAISE(ABORT,'INJECTED_BOOTSTRAP_AUDIT_FAILURE'); END;",
      );
      await assert.rejects(db.exec(sql), /INJECTED_BOOTSTRAP_AUDIT_FAILURE/);
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        0,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM owner_bootstrap').first())
          .n,
        0,
      );
      await db.exec('DROP TRIGGER reject_bootstrap_audit');
      await db.exec(sql);
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(DISTINCT userId) AS n FROM oauth_accounts')
            .first()
        ).n,
        1,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM oauth_accounts').first())
          .n,
        2,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO owner_bootstrap(id,user_id,github_subject) VALUES(1,?,?)',
          )
          .bind(crypto.randomUUID(), '102')
          .run(),
        /BOOTSTRAP_CLOSED/,
      );
      await assert.rejects(
        db.prepare('DELETE FROM owner_bootstrap').run(),
        /BOOTSTRAP_CLOSED/,
      );
    },
  );
  function jar() {
    const values = new Map();
    return {
      headers() {
        return [...values].map(([key, value]) => `${key}=${value}`).join('; ');
      },
      save(response) {
        for (const cookie of response.headers.getSetCookie()) {
          const pair = cookie.split(';')[0];
          const index = pair.indexOf('=');
          const key = pair.slice(0, index);
          const value = pair.slice(index + 1);
          if (value) values.set(key, value);
          else values.delete(key);
        }
      },
      values,
    };
  }
  async function oauth(provider) {
    const cookies = jar();
    const start = await request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, callbackURL: base + '/' }),
    });
    assert.equal(start.status, 200);
    cookies.save(start);
    activeAuth = new URL((await start.json()).url);
    const state = activeAuth.searchParams.get('state');
    assert.ok(state);
    if (provider === 'google') {
      assert.ok(activeAuth.searchParams.get('code_challenge'));
      assert.equal(
        activeAuth.searchParams.get('code_challenge_method'),
        'S256',
      );
    }
    const callback = await request(
      `/api/auth/callback/${provider}?code=synthetic&state=${encodeURIComponent(state)}`,
      { headers: { Cookie: cookies.headers() }, redirect: 'manual' },
    );
    cookies.save(callback);
    return { cookies, callback };
  }
  let githubCookies, googleCookies;
  await check(
    'mature GitHub OAuth state fixture logs into bootstrapped owner',
    async () => {
      const result = await oauth('github');
      assert.ok([302, 303].includes(result.callback.status));
      githubCookies = result.cookies;
      const me = await request('/api/v1/me', {
        headers: { Cookie: githubCookies.headers() },
      });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).actor.id, owner);
      const session = result.callback.headers
        .getSetCookie()
        .find((c) => c.startsWith('kino-owner.session_token='));
      assert.ok(session);
      assert.match(session, /HttpOnly/i);
      assert.match(session, /SameSite=Lax/i);
    },
  );
  await check(
    'mature Google OAuth validates fixture RSA ID token and returns same internal ID',
    async () => {
      const result = await oauth('google');
      googleCookies = result.cookies;
      assert.ok([302, 303].includes(result.callback.status));
      const me = await request('/api/v1/me', {
        headers: { Cookie: googleCookies.headers() },
      });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).actor.id, owner);
    },
  );
  await check(
    'same-email unapproved Google/GitHub subjects never register or implicitly link',
    async () => {
      githubSubject = 102;
      googleSubject = '12345002';
      for (const provider of ['github', 'google']) {
        const result = await oauth(provider);
        assert.equal(
          (
            await request('/api/v1/me', {
              headers: { Cookie: result.cookies.headers() },
            })
          ).status,
          401,
        );
      }
      githubSubject = 101;
      googleSubject = '12345001';
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        1,
      );
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM oauth_accounts').first())
          .n,
        2,
      );
      assert.equal(
        (
          await request('/api/auth/sign-up/email', {
            method: 'POST',
            headers: { Origin: base, 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request('/api/auth/link-social', {
            method: 'POST',
            headers: { Origin: base, 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
        404,
      );
    },
  );
  await check(
    'invalid Google ID token signature cannot create a session',
    async () => {
      corruptGoogleSignature = true;
      const result = await oauth('google');
      corruptGoogleSignature = false;
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: result.cookies.headers() },
          })
        ).status,
        401,
      );
    },
  );
  await check(
    'owner-only node metadata excludes endpoint/credential refs and cross-account routing stays off',
    async () => {
      const response = await request('/api/v1/storage/nodes', {
        headers: { Cookie: githubCookies.headers() },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /no-store/);
      const body = await response.json();
      assert.equal(body.nodes.length, 1);
      assert.equal(body.multiAccountEnabled, false);
      assert.equal(body.nodes[0].quota_bytes, 9000000000);
      assert.equal(body.nodes[0].credential_ref, undefined);
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO storage_nodes SELECT 'second',provider,account_id,bucket_name,endpoint,credential_ref,status,priority,quota_bytes,used_bytes,reserved_bytes,last_reconciled_at FROM storage_nodes WHERE id='primary'",
          )
          .run(),
        /MULTI_NODE_DISABLED/,
      );
    },
  );
  await check(
    'current owner disabled denies existing valid sessions; forged and revoked cookies fail closed',
    async () => {
      await db.prepare('UPDATE owners SET enabled=0').run();
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: githubCookies.headers() },
          })
        ).status,
        403,
      );
      await db.prepare('UPDATE owners SET enabled=1').run();
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: 'kino-owner.session_token=forged' },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request('/api/auth/sign-out', {
            method: 'POST',
            headers: {
              Origin: 'https://attacker.invalid',
              Cookie: githubCookies.headers(),
            },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request('/api/auth/sign-out', {
            method: 'POST',
            headers: {
              Origin: base,
              Cookie: githubCookies.headers(),
              'Content-Type': 'application/json',
            },
            body: '{}',
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: githubCookies.headers() },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request('/api/v1/me', {
            headers: { Cookie: googleCookies.headers() },
          })
        ).status,
        200,
      );
    },
  );
  await check(
    'same-origin React UI creates D1 workspace, project and protected archived album in a browser',
    async () => {
      const sessionCookie = googleCookies?.values.get(
        'kino-owner.session_token',
      );
      assert.ok(sessionCookie);
      const worker = await mf.getWorker('app');
      const result = await runWorkerUiBrowserChecks({
        worker,
        baseUrl: base,
        sessionCookie,
      });
      const workspace = await db
        .prepare('SELECT id FROM workspaces WHERE name=?')
        .bind(result.workspaceName)
        .first();
      assert.ok(workspace);
      const project = await db
        .prepare('SELECT id FROM projects WHERE workspace_id=? AND name=?')
        .bind(workspace.id, result.projectName)
        .first();
      assert.ok(project);
      const album = await db
        .prepare(
          'SELECT state,is_pinned FROM albums WHERE project_id=? AND name=?',
        )
        .bind(project.id, result.albumName)
        .first();
      assert.equal(album?.state, 'archived');
      assert.equal(album?.is_pinned, 1);
    },
  );

  await uploadChecks({
    check,
    request,
    db,
    cookies: googleCookies,
    owner,
    base,
    worker: await mf.getWorker('app'),
    storage: await mf.getR2Bucket('PRIMARY_STORAGE', 'app'),
  });
  await check(
    'read-only upload recovery uses original intent and current Owner, returns canonical scope/hash without keys or credentials',
    async () => {
      const sample = await db
        .prepare(
          "SELECT r.request_id,p.content_type,p.sha256_hex,u.id,u.workspace_id,u.project_id,u.album_id FROM upload_requests r JOIN upload_specs p ON p.upload_session_id=r.upload_session_id JOIN upload_sessions u ON u.id=r.upload_session_id JOIN upload_completions c ON c.upload_session_id=u.id WHERE r.actor_id=? AND r.operation='upload.reserved' LIMIT 1",
        )
        .bind(owner)
        .first();
      assert.ok(sample);
      const state = async () => ({
        sessions: (
          await db.prepare('SELECT * FROM upload_sessions ORDER BY id').all()
        ).results,
        usage: (
          await db
            .prepare(
              'SELECT * FROM workspace_storage_usage ORDER BY workspace_id',
            )
            .all()
        ).results,
        audit: (
          await db.prepare('SELECT * FROM audit_events ORDER BY event_id').all()
        ).results,
      });
      const before = await state();
      const path = `/api/v1/uploads/recovery/${sample.request_id}`;
      const headers = { Cookie: googleCookies.headers() };
      let response = await request(path, { headers });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('cache-control'), /private, no-store/);
      const recovered = await response.json();
      assert.equal(recovered.initRequestId, sample.request_id);
      assert.equal(recovered.uploadSession.id, sample.id);
      assert.equal(recovered.uploadSession.workspaceId, sample.workspace_id);
      assert.equal(recovered.uploadSession.projectId, sample.project_id);
      assert.equal(recovered.uploadSession.albumId, sample.album_id);
      assert.equal(recovered.contentType, sample.content_type);
      assert.equal(recovered.sha256, sample.sha256_hex);
      assert.ok(
        !/object_key|objectKey|https:|secret|token|credential/i.test(
          JSON.stringify(recovered),
        ),
      );
      assert.equal((await request(path)).status, 401);
      const switched = await request('/api/v1/uploads/init', {
        method: 'POST',
        headers: {
          ...headers,
          Origin: base,
          'Content-Type': 'application/json',
          'X-Kino-Expected-Actor': randomUUID(),
        },
        body: JSON.stringify({
          workspaceId: sample.workspace_id,
          projectId: sample.project_id,
          albumId: sample.album_id,
          originalFilename: 'actor-switch.png',
          expectedBytes: 8,
          contentType: 'image/png',
          sha256: 'a'.repeat(64),
          requestId: randomUUID(),
        }),
      });
      assert.equal(switched.status, 403);
      assert.equal((await switched.json()).error.code, 'UPLOAD_OWNER_CHANGED');
      assert.equal(
        (await request('/api/v1/uploads/recovery/bad', { headers })).status,
        400,
      );
      assert.equal(
        (await request(`/api/v1/uploads/recovery/${randomUUID()}`, { headers }))
          .status,
        404,
      );
      await db
        .prepare('UPDATE owners SET enabled=0 WHERE user_id=?')
        .bind(owner)
        .run();
      try {
        response = await request(path, { headers });
        assert.equal(response.status, 403);
      } finally {
        await db
          .prepare('UPDATE owners SET enabled=1 WHERE user_id=?')
          .bind(owner)
          .run();
      }
      assert.deepEqual(await state(), before);
    },
  );
  const galleryFixture = await processingChecks({
    check,
    request,
    db,
    cookies: googleCookies,
    owner,
    base,
    worker: await mf.getWorker('app'),
    storage: await mf.getR2Bucket('PRIMARY_STORAGE', 'app'),
  });
  await versionMatchCandidateChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
  });
  await albumMatchingChangeChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
  });
  await resolvedUploadChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
  });
  await check(
    '375px resolved upload confirms choices, recovers a lost reservation through reload and creates private versions without switching the head',
    async () => {
      const result = await runResolvedUploadBrowserChecks({
        worker: await mf.getWorker('resolved-uploads-test'),
        base,
        owner,
        cookies: googleCookies,
        db,
        galleryFixture,
      });
      assert.equal(result.lostReservationReplayVerified, true);
      assert.equal(result.currentHeadPreserved, true);
      assert.ok(result.signedBrowserR2Puts >= 2);
    },
  );
  await ownerExternalIntentChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
    setInterleaveHook: (hook) => {
      ownerIntentInterleaveHook = hook;
    },
  });
  await check(
    'disabled direct uploads reject init before any quota/session write',
    async () => {
      const disabled = await mf.getWorker('upload-disabled');
      const headers = {
        Cookie: googleCookies.headers(),
        Origin: base,
        'Content-Type': 'application/json',
      };
      const cap = await disabled.fetch(
        new Request(base + '/api/v1/uploads/capabilities', { headers }),
      );
      assert.equal(cap.status, 200);
      assert.equal((await cap.json()).enabled, false);
      const context = await db
        .prepare(
          'SELECT workspace_id,project_id,album_id FROM upload_completions LIMIT 1',
        )
        .first();
      const count = await db
        .prepare('SELECT count(*) AS n FROM upload_sessions')
        .first();
      const quota = await db
        .prepare(
          "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
        )
        .first();
      const init = await disabled.fetch(
        new Request(base + '/api/v1/uploads/init', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            workspaceId: context.workspace_id,
            projectId: context.project_id,
            albumId: context.album_id,
            originalFilename: 'disabled.png',
            expectedBytes: 64,
            contentType: 'image/png',
            sha256: '1'.repeat(64),
            requestId: randomUUID(),
          }),
        }),
      );
      assert.equal(init.status, 503);
      assert.equal((await init.json()).error.code, 'DIRECT_UPLOAD_DISABLED');
      assert.deepEqual(
        await db.prepare('SELECT count(*) AS n FROM upload_sessions').first(),
        count,
      );
      assert.deepEqual(
        await db
          .prepare(
            "SELECT used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
          )
          .first(),
        quota,
      );
    },
  );
  await check(
    'browser upload restores across lost init/PUT/completion, verifies reselected hash, locks other tabs and commits D1/R2 once',
    async () => {
      await runUploadBrowserChecks({
        worker: await mf.getWorker('app'),
        db,
        storage: await mf.getR2Bucket('PRIMARY_STORAGE', 'app'),
        baseUrl: base,
        sessionCookie: googleCookies.values.get('kino-owner.session_token'),
      });
    },
  );
  await check(
    'photo/version/asset/completion/audit relations reject cross-tenant and cross-photo references',
    async () => {
      const valid = await db
        .prepare(
          'SELECT p.id AS photo_id,p.workspace_id,p.project_id,p.album_id,v.id AS version_id,v.source_hash_sha256,v.byte_size,v.mime,a.id AS asset_id,a.object_key,a.storage_node_id,a.checksum_sha256,c.upload_session_id,c.actor_id,c.session_id,c.request_id,c.actual_bytes,c.content_type FROM upload_completions c JOIN photos p ON p.id=c.photo_id JOIN photo_versions v ON v.id=c.version_id JOIN photo_assets a ON a.id=c.asset_id WHERE c.photo_id IS NOT NULL ORDER BY c.completed_at_ms LIMIT 1',
        )
        .first();
      assert.ok(valid);
      const otherWorkspace = await db
        .prepare('SELECT id FROM workspaces WHERE id<>? ORDER BY id LIMIT 1')
        .bind(valid.workspace_id)
        .first();
      assert.ok(otherWorkspace);
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,900,NULL,?,?,? ,?,1,1,'private')",
          )
          .bind(
            randomUUID(),
            otherWorkspace.id,
            valid.photo_id,
            valid.actor_id,
            'a'.repeat(64),
            1,
            'image/jpeg',
          )
          .run(),
        /PHOTO_VERSION_SCOPE_MISMATCH/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO photo_versions(id,workspace_id,photo_id,version_no,parent_version_id,created_by_actor,source_hash_sha256,byte_size,mime,width,height,status) VALUES(?,?,?,901,?,?,?,1,'image/jpeg',1,1,'private')",
          )
          .bind(
            randomUUID(),
            valid.workspace_id,
            valid.photo_id,
            randomUUID(),
            valid.actor_id,
            'b'.repeat(64),
          )
          .run(),
        /PHOTO_VERSION_PARENT_MISMATCH/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO photo_assets(id,workspace_id,photo_id,version_id,storage_node_id,asset_kind,object_key,byte_size,mime,checksum_sha256,state) VALUES(?,?,?,?,?,'delivery',?,1,'image/jpeg',?,'private')",
          )
          .bind(
            randomUUID(),
            otherWorkspace.id,
            valid.photo_id,
            valid.version_id,
            valid.storage_node_id,
            `wrong/${valid.object_key}`,
            'c'.repeat(64),
          )
          .run(),
        /PHOTO_ASSET_SCOPE_MISMATCH/,
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO upload_completions(upload_session_id,actor_id,request_id,session_id,workspace_id,project_id,album_id,photo_id,version_id,asset_id,actual_bytes,content_type,sha256_hex,completed_at_ms,image_width,image_height) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1)',
          )
          .bind(
            valid.upload_session_id,
            valid.actor_id,
            randomUUID(),
            valid.session_id,
            valid.workspace_id,
            valid.project_id,
            valid.album_id,
            randomUUID(),
            valid.version_id,
            valid.asset_id,
            valid.actual_bytes,
            valid.content_type,
            valid.checksum_sha256,
            Date.now(),
          )
          .run(),
        /UPLOAD_COMPLETION_SCOPE_MISMATCH/,
      );
      await assert.rejects(
        db
          .prepare(
            "INSERT INTO audit_events(event_id,actor_type,workspace_id,project_id,album_id,photo_id,version_id,action,request_id) VALUES(?,'system',?,?,?,?,?,? ,?)",
          )
          .bind(
            randomUUID(),
            otherWorkspace.id,
            valid.project_id,
            valid.album_id,
            valid.photo_id,
            valid.version_id,
            'test.cross_scope',
            randomUUID(),
          )
          .run(),
        /AUDIT_PHOTO_SCOPE_MISMATCH/,
      );
    },
  );
  await check(
    'Chromium File/Blob PUT automatically transmits the exact Content-Length required by the signed R2 request',
    verifyBrowserUploadContentLength,
  );

  await workspaceChecks({
    check,
    request,
    db,
    cookies: googleCookies,
    owner,
    base,
  });
  await guestAccessChecks({
    db,
    mf,
    request,
    owner,
    check,
    cookies: googleCookies,
    base,
    galleryFixture,
  });
  const guestVersionFixture = await guestVersionChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
  });
  await check(
    '375px Guest version history compares only published previews with keyboard slider, synchronized transforms and live revocation',
    async () => {
      await runGuestVersionBrowserChecks({
        ...guestVersionFixture,
        worker: await mf.getWorker(guestVersionFixture.workerName),
        base,
        db,
      });
    },
  );
  const guestAnnotationFixture = await guestAnnotationChecks({
    db,
    mf,
    check,
    owner,
    base,
    versionFixture: guestVersionFixture,
    cookies: googleCookies,
    request,
  });
  await ownerAnnotationChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    request,
    authSecret: bindings.BETTER_AUTH_SECRET,
    annotationFixture: await guestAnnotationFixture.createBrowserFixture(),
  });
  await ownerAnnotationAuthoringChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    request,
    authSecret: bindings.BETTER_AUTH_SECRET,
    annotationFixture: await guestAnnotationFixture.createBrowserFixture(),
  });
  await runAnnotationProcessingChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    request,
    authSecret: bindings.BETTER_AUTH_SECRET,
    annotationFixture: await guestAnnotationFixture.createBrowserFixture(),
  });
  await guestSharedAnnotationChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    request,
    annotationFixture: await guestAnnotationFixture.createBrowserFixture(),
  });
  let annotationUiFixture;
  await check(
    '375px invitation-shared annotations preserve author rights, version coordinates and exact recovery',
    async () => {
      annotationUiFixture = await runGuestAnnotationsBrowserChecks({
        db,
        worker: await mf.getWorker('guest-annotations-test'),
        base,
        fixture: guestAnnotationFixture,
      });
    },
  );
  await check(
    '375px Owner annotation viewer isolates invitation/version and remains readonly',
    async () => {
      await runOwnerAnnotationsBrowserChecks({
        db,
        worker: await mf.getWorker('owner-annotations-test'),
        base,
        ownerCookie: googleCookies.headers(),
        fixture: annotationUiFixture,
        owner,
      });
    },
  );
  await check(
    '375px genuine Owner annotation authoring preserves version coordinates, lifecycle and exact recovery',
    async () => {
      await runOwnerAnnotationAuthoringBrowserChecks({
        db,
        worker: await mf.getWorker('owner-annotation-authoring-test'),
        base,
        ownerCookie: googleCookies.headers(),
        owner,
        fixture: await guestAnnotationFixture.createBrowserFixture(),
      });
    },
  );
  await check(
    '375px Owner annotation processing recovers exact decisions and reflects Guest content staleness',
    async () => {
      await runAnnotationProcessingBrowserChecks({
        db,
        ownerWorker: await mf.getWorker('annotation-processing-test'),
        guestWorker: await mf.getWorker('guest-annotations-test'),
        base,
        ownerCookie: googleCookies.headers(),
        owner,
        fixture: await guestAnnotationFixture.createBrowserFixture(),
      });
    },
  );
  const guestCommentsFixture = await guestCommentChecks({
    db,
    mf,
    check,
    owner,
    base,
    versionFixture: guestVersionFixture,
    cookies: googleCookies,
    request,
  });
  await check(
    '375px invitation-shared version comments preserve author rights, batch atomicity and exact recovery',
    async () => {
      await runGuestCommentsBrowserChecks({
        ...guestCommentsFixture,
        worker: await mf.getWorker('guest-comments-test'),
        base,
        db,
      });
    },
  );
  await ownerCommentChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    request,
    guestCommentsFixture,
    authSecret: bindings.BETTER_AUTH_SECRET,
  });
  await check(
    '375px Owner invitation/version comments recover lost responses and preserve readonly Guest visibility',
    async () => {
      await runOwnerCommentsBrowserChecks({
        db,
        worker: await mf.getWorker('owner-comments-test'),
        guestWorker: await mf.getWorker('guest-comments-test'),
        base,
        ownerCookie: googleCookies.headers(),
        fixture: guestCommentsFixture,
        owner,
      });
    },
  );
  await runCommentProcessingChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    request,
    guestCommentsFixture,
    authSecret: bindings.BETTER_AUTH_SECRET,
  });
  await check(
    '375px Owner processing status recovers body-free intent and exposes readonly same-invitation progress',
    async () => {
      await runCommentProcessingBrowserChecks({
        db,
        worker: await mf.getWorker('owner-processing-test'),
        guestWorker: await mf.getWorker('guest-comments-test'),
        base,
        ownerCookie: googleCookies.headers(),
        fixture: guestCommentsFixture,
        owner,
      });
    },
  );
  await ownerSelectionChecks({
    db,
    mf,
    request,
    owner,
    check,
    cookies: googleCookies,
    base,
    galleryFixture,
  });
  await guestExchangeChecks({
    db,
    mf,
    check,
    owner,
    base,
  });
  await check(
    'Invitation capability reads reveal only availability and preserve credential/session/audit state',
    async () => {
      const snapshot = async () => ({
        invites: (
          await db.prepare('SELECT count(*) AS n FROM guest_invites').first()
        ).n,
        sessions: (
          await db.prepare('SELECT count(*) AS n FROM guest_sessions').first()
        ).n,
        audit: (
          await db.prepare('SELECT count(*) AS n FROM audit_events').first()
        ).n,
      });
      const before = await snapshot();
      const flow = await mf.getWorker('guest-flow-test');
      const anonymous = await flow.fetch(
        new Request(base + '/api/v1/invites/capabilities'),
      );
      assert.equal(anonymous.status, 401);
      const ownerCapabilities = await flow.fetch(
        new Request(base + '/api/v1/invites/capabilities', {
          headers: { Cookie: googleCookies.headers() },
        }),
      );
      assert.equal(ownerCapabilities.status, 200);
      assert.deepEqual(await ownerCapabilities.json(), {
        issuanceEnabled: true,
        exchangeEnabled: true,
        selectionEnabled: true,
        feedbackEnabled: false,
        tagsEnabled: false,
        historyEnabled: false,
        maxAlbums: 24,
        maxUses: 10000,
        maxExpiryDays: 365,
      });
      assert.equal(
        ownerCapabilities.headers.get('cache-control'),
        'private, no-store',
      );
      const disabled = await mf.getWorker('upload-disabled');
      const publicDisabled = await disabled.fetch(
        new Request(base + '/api/guest/capabilities'),
      );
      assert.deepEqual(await publicDisabled.json(), { exchangeEnabled: false });
      const publicEnabled = await flow.fetch(
        new Request(base + '/api/guest/capabilities'),
      );
      assert.deepEqual(await publicEnabled.json(), { exchangeEnabled: true });
      assert.equal(publicEnabled.headers.get('referrer-policy'), 'no-referrer');
      const feedbackEnabled = await (
        await mf.getWorker('guest-feedback-test')
      ).fetch(new Request(base + '/api/guest/feedback/capabilities'));
      assert.deepEqual(await feedbackEnabled.json(), { enabled: true });
      const feedbackDisabled = await flow.fetch(
        new Request(base + '/api/guest/feedback/capabilities'),
      );
      assert.deepEqual(await feedbackDisabled.json(), { enabled: false });
      assert.deepEqual(await snapshot(), before);
    },
  );
  await check(
    'Owner invitation creation UI preserves independent scope, one-time secrets and safe recovery',
    async () => {
      await runInviteCreateUiChecks({
        worker: await mf.getWorker('guest-flow-test'),
        disabledWorker: await mf.getWorker('upload-disabled'),
        base,
        ownerCookie: googleCookies.values.get('kino-owner.session_token'),
        projectId: galleryFixture.context.project.id,
        albumId: galleryFixture.context.album.id,
        db,
      });
    },
  );
  await check(
    'Guest fragment invitation entry reaches private gallery and handles uncertain exchange safely',
    async () => {
      await runGuestEntryUiChecks({
        worker: await mf.getWorker('guest-flow-test'),
        disabledWorker: await mf.getWorker('upload-disabled'),
        base,
        ownerCookie: googleCookies.values.get('kino-owner.session_token'),
        projectId: galleryFixture.context.project.id,
        albumId: galleryFixture.context.album.id,
        db,
      });
    },
  );
  await guestFeedbackChecks({
    mf,
    db,
    check,
    owner,
    cookies: googleCookies,
    base,
    galleryFixture,
    request,
  });
  await guestTagsChecks({
    mf,
    db,
    check,
    owner,
    cookies: googleCookies,
    base,
    galleryFixture,
    request,
  });
  await guestHistoryChecks({
    db,
    mf,
    check,
    owner,
    base,
    galleryFixture,
    request,
  });
  const projectVersioningFixture = await projectVersioningChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
  });
  const expiringVersionOwner = await oauth('google');
  assert.ok([302, 303].includes(expiringVersionOwner.callback.status));
  await projectVersioningIntegrityChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    expiredOwnerCookie: expiringVersionOwner.cookies.headers(),
    projectId: projectVersioningFixture.projectId,
  });
  await check(
    '375px Owner project version mode confirmation, stale CAS and exact lost-response retry reconcile fresh current state',
    async () =>
      runProjectVersioningBrowserChecks({
        worker: await mf.getWorker('project-versioning-test'),
        base,
        ownerCookie: googleCookies.headers(),
        owner,
        db,
        ...projectVersioningFixture,
      }),
  );
  await versionUploadChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
  });
  await check(
    '375px Owner version upload uses immutable file intent, signed local R2 PUT and lost-completion recovery without changing the current head',
    async () =>
      runVersionUploadsBrowserChecks({
        worker: await mf.getWorker('version-uploads-test'),
        disabledWorker: await mf.getWorker('photo-versions-test'),
        base,
        ownerCookie: googleCookies.headers(),
        owner,
        db,
        storage: galleryFixture.storage,
        galleryFixture,
      }),
  );
  await photoVersionHeadChecks({
    db,
    mf,
    check,
    owner,
    base,
    galleryFixture,
    request,
    cookies: googleCookies,
  });
  await guestTagIntegrityChecks({ db, check });
  await guestTagCatalogChecks({ db, check, owner });
  await check(
    'Guest ratings and favorites UI preserve independent rights, shared Grid/Lightbox state and safe retry',
    async () => {
      await runGuestFeedbackBrowserChecks({
        worker: await mf.getWorker('guest-feedback-test'),
        disabledWorker: await mf.getWorker('guest-flow-test'),
        base,
        ownerCookie: googleCookies.values.get('kino-owner.session_token'),
        projectId: galleryFixture.context.project.id,
        albumId: galleryFixture.context.album.id,
        db,
      });
    },
  );
  await selectionPolicyConfigurationChecks({
    mf,
    db,
    check,
    owner,
    cookies: googleCookies,
    base,
    galleryFixture,
    request,
  });
  await selectionPolicyChecks({
    mf,
    db,
    check,
    owner,
    cookies: googleCookies,
    base,
    galleryFixture,
    request,
  });
  await check(
    'Owner project defaults and album inheritance confirm bounds and safely retry exact intent',
    async () => {
      await runIndependentSelectionPolicyConfigurationBrowserChecks({
        worker: await mf.getWorker('guest-feedback-test'),
        base,
        ownerCookie: googleCookies.values.get('kino-owner.session_token'),
        db,
        galleryFixture,
      });
    },
  );
  await check(
    'Private Guest bounds limit batch picks, permit cancellation and require minimum submit',
    async () => {
      await runGuestSelectionLimitBrowserChecks({
        worker: await mf.getWorker('guest-feedback-test'),
        base,
        ownerCookie: googleCookies.values.get('kino-owner.session_token'),
        owner,
        db,
        galleryFixture,
      });
    },
  );
  await reopenedSelectionRevisionChecks({
    worker: await mf.getWorker('guest-feedback-test'),
    base,
    ownerCookie: googleCookies.values.get('kino-owner.session_token'),
    db,
    galleryFixture,
    check,
  });
  await sharedReviewChecks({
    ownerSigningSecret: bindings.BETTER_AUTH_SECRET,
    mf,
    db,
    check,
    owner,
    cookies: googleCookies,
    base,
    galleryFixture,
    request,
  });
  await check(
    'Owner explicitly creates shared review membership, retries intent, exports and reopens immutable rounds',
    async () => {
      await runSharedReviewOwnerBrowserChecks({
        worker: await mf.getWorker('guest-shared-test'),
        disabledWorker: await mf.getWorker('guest-feedback-test'),
        base,
        ownerCookie: googleCookies.values.get('kino-owner.session_token'),
        db,
        galleryFixture,
      });
    },
  );
  await check(
    'Two distinct Guest browsers share bounded picks without merging private state or retry identities',
    async () => {
      await runSharedReviewGuestBrowserChecks({
        worker: await mf.getWorker('guest-shared-test'),
        disabledWorker: await mf.getWorker('guest-feedback-test'),
        base,
        ownerCookie: googleCookies.values.get('kino-owner.session_token'),
        owner,
        db,
        galleryFixture,
      });
    },
  );
  await check(
    'Inherited private policies bind source epochs and preserve independent Guest rights',
    async () => {
      await runIndependentSelectionPolicyInheritanceChecks({
        worker: await mf.getWorker('guest-feedback-test'),
        base,
        ownerCookie: googleCookies.values.get('kino-owner.session_token'),
        db,
        galleryFixture,
      });
    },
  );
  await check(
    'SQL session/audit atomic rollback and append-only history',
    async () => {
      await db.exec(
        "CREATE TRIGGER fail_session_audit BEFORE INSERT ON audit_events WHEN NEW.action='owner.signed_in' BEGIN SELECT RAISE(ABORT,'INJECTED_AUDIT_FAILURE'); END;",
      );
      await assert.rejects(
        db
          .prepare(
            'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
          )
          .bind(
            'rollback',
            'never-a-live-token',
            owner,
            Date.now() + 3600000,
            Date.now(),
            Date.now(),
          )
          .run(),
        /INJECTED_AUDIT_FAILURE/,
      );
      assert.equal(
        await db
          .prepare("SELECT id FROM owner_sessions WHERE id='rollback'")
          .first(),
        null,
      );
      await db.exec('DROP TRIGGER fail_session_audit');
      await assert.rejects(
        db.prepare('DELETE FROM audit_events').run(),
        /APPEND_ONLY_AUDIT/,
      );
    },
  );
  await check(
    'OAuth CSRF, unknown state, callback redirect and oversized body rejected',
    async () => {
      const usersBeforeRejectedOAuth = (
        await db.prepare('SELECT count(*) AS n FROM users').first()
      ).n;
      assert.equal(
        (
          await request('/api/auth/sign-in/social', {
            method: 'POST',
            headers: {
              Origin: 'https://attacker.invalid',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ provider: 'google' }),
          })
        ).status,
        403,
      );
      const oversized = await request('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(17000) }),
      });
      assert.equal(oversized.status, 413);
      const redirect = await request('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          callbackURL: 'https://attacker.invalid/',
        }),
      });
      assert.ok(redirect.status >= 400);
      const callback = await request(
        '/api/auth/callback/google?code=synthetic&state=invalid',
        { redirect: 'manual' },
      );
      assert.ok([302, 303, 400, 401].includes(callback.status));
      assert.equal(
        (await db.prepare('SELECT count(*) AS n FROM users').first()).n,
        usersBeforeRejectedOAuth,
      );
    },
  );
  await check(
    'real R2 conditional immutable write, scoped read and disabled deletion',
    async () => {
      const storage = await mf.getWorker('storage-test');
      const scope = {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        albumId: '33333333-3333-4333-8333-333333333333',
      };
      const key = `${scope.workspaceId}/${scope.projectId}/${scope.albumId}/version-1.png`;
      const params = new URLSearchParams({ ...scope, key });
      const url = 'http://local.test/object?' + params;
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      assert.equal(
        (await storage.fetch(url, { method: 'PUT', body: bytes })).status,
        201,
      );
      assert.equal(
        (await storage.fetch(url, { method: 'PUT', body: new Uint8Array([0]) }))
          .status,
        409,
      );
      assert.deepEqual(
        new Uint8Array(await (await storage.fetch(url)).arrayBuffer()),
        bytes,
      );
      params.set('workspaceId', '44444444-4444-4444-8444-444444444444');
      assert.equal(
        (await storage.fetch('http://local.test/object?' + params)).status,
        409,
      );
      assert.equal(
        (await storage.fetch(url, { method: 'DELETE' })).status,
        409,
      );
      assert.deepEqual(
        new Uint8Array(await (await storage.fetch(url)).arrayBuffer()),
        bytes,
      );
    },
  );
  await immutableResultChecks({ db, check });
  await immutablePhotoRecordChecks({ db, check });
  await check(
    'Matching watermarks cover completed photos, current heads and real reservation expiry after the full lifecycle',
    async () => {
      const missing = await db
        .prepare(
          `
      SELECT 'photo' AS kind,p.id FROM photos p WHERE NOT EXISTS(
        SELECT 1 FROM album_matching_changes m WHERE m.kind='photo' AND m.source_id=p.id AND m.workspace_id=p.workspace_id AND m.project_id=p.project_id AND m.album_id=p.album_id)
      UNION ALL SELECT 'version',v.id FROM photo_versions v JOIN photos p ON p.id=v.photo_id WHERE NOT EXISTS(
        SELECT 1 FROM album_matching_changes m WHERE m.kind='version' AND m.source_id=v.id AND m.workspace_id=p.workspace_id AND m.project_id=p.project_id AND m.album_id=p.album_id)
      UNION ALL SELECT 'head',h.photo_id FROM photo_version_heads h WHERE NOT EXISTS(
        SELECT 1 FROM album_matching_changes m WHERE m.kind='head' AND m.source_id=h.photo_id AND m.source_revision=h.revision AND m.workspace_id=h.workspace_id AND m.project_id=h.project_id AND m.album_id=h.album_id)
      UNION ALL SELECT 'upload',u.id FROM upload_sessions u WHERE NOT EXISTS(
        SELECT 1 FROM album_matching_changes m WHERE m.kind='upload' AND m.source_id=u.id AND m.source_state=u.status AND m.workspace_id=u.workspace_id AND m.project_id=u.project_id AND m.album_id=u.album_id)
    `,
        )
        .all();
      assert.deepEqual(missing.results, []);
      const exercised = await db
        .prepare(
          `SELECT
      (SELECT count(*) FROM photo_version_heads WHERE revision>0) AS switched,
      (SELECT count(*) FROM upload_sessions WHERE status='expired') AS expired`,
        )
        .first();
      assert.ok(
        exercised.switched > 0,
        'a real existing-version switch must have run',
      );
      assert.ok(
        exercised.expired > 0,
        'a real reservation expiry must have run',
      );
    },
  );

  await check(
    'Repeated Cron dry-run observations preserve the first append-only audit event',
    async () => {
      const scheduledWorker = await mf.getWorker('app');
      const scheduledTime = new Date();
      const eventId =
        'cron-retention:' + scheduledTime.toISOString().slice(0, 10);
      const firstRun = await scheduledWorker.scheduled({
        scheduledTime,
        cron: '*/5 * * * *',
      });
      assert.equal(firstRun.outcome, 'ok');
      const firstEvent = await db
        .prepare('SELECT * FROM audit_events WHERE event_id=?')
        .bind(eventId)
        .first();
      assert.ok(firstEvent);
      assert.equal(firstEvent.action, 'retention.dry_run_observed');
      assert.equal(JSON.parse(firstEvent.after_json).deleted, 0);
      const repeated = await Promise.all([
        scheduledWorker.scheduled({ scheduledTime, cron: '*/5 * * * *' }),
        scheduledWorker.scheduled({ scheduledTime, cron: '*/5 * * * *' }),
      ]);
      assert.ok(repeated.every((result) => result.outcome === 'ok'));
      assert.deepEqual(
        await db
          .prepare('SELECT * FROM audit_events WHERE event_id=?')
          .bind(eventId)
          .first(),
        firstEvent,
      );
      assert.equal(
        (
          await db
            .prepare('SELECT count(*) AS n FROM audit_events WHERE event_id=?')
            .bind(eventId)
            .first()
        ).n,
        1,
      );
    },
  );
  await runMatchingFilenameIndexChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
  });
  await runIndexedVersionMatchingChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
  });
  await runAssistedCandidateCatalogChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
    authSecret: bindings.BETTER_AUTH_SECRET,
  });

  await runMatchingRulesChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    galleryFixture,
    request,
    authSecret: bindings.BETTER_AUTH_SECRET,
  });
  const historyFixture = await runOwnerHistoryChecks({
    db,
    mf,
    check,
    owner,
    base,
    cookies: googleCookies,
    authSecret: bindings.BETTER_AUTH_SECRET,
    annotationFixture: guestAnnotationFixture,
  });
  await check(
    '375px workspace Owner history filters, snapshot paging and complete downloads preserve current identity',
    async () => {
      const { runOwnerHistoryBrowserChecks } =
        await import('./owner-history-browser.mjs');
      await runOwnerHistoryBrowserChecks({
        db,
        worker: await mf.getWorker('owner-history-test'),
        disabledWorker: await mf.getWorker('app'),
        base,
        ownerCookie: googleCookies.headers(),
        owner,
        workspaceId: historyFixture.workspaceId,
      });
    },
  );
  process.stdout.write(
    `${checks} local Cloudflare checks passed; real OAuth/remote resources not checked.\n`,
  );
} finally {
  await mf.dispose();
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith('kino-cloudflare-'));
  await rm(temporary, { recursive: true, force: true });
}

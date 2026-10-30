import { describe, expect, it } from 'vitest';
import {
  configuration,
  matchingRulesCapability,
  type WorkerEnv,
} from '../../apps/worker/src/config';

type AppEnv = 'local' | 'staging' | 'production';

function environment(appEnv: AppEnv): WorkerEnv {
  return {
    APP_ENV: appEnv,
    APP_URL:
      appEnv === 'local' ? 'http://127.0.0.1:8787' : 'https://kino.example',
    REGISTRATION_MODE: 'closed',
    STORAGE_AUTODELETE_ENABLED: 'false',
    STORAGE_RETENTION_DRY_RUN: 'true',
    MULTI_ACCOUNT_STORAGE_ENABLED: 'false',
  } as WorkerEnv;
}

const enabledMatchingRules = {
  MATCHING_RULES_ENABLED: 'true',
  ASSISTED_CANDIDATE_CATALOG_ENABLED: 'true',
  INDEXED_VERSION_MATCHING_ENABLED: 'true',
  MATCHING_FILENAME_INDEX_ENABLED: 'true',
  DIRECT_UPLOAD_ENABLED: 'true',
  PHOTO_VERSION_UPLOADS_ENABLED: 'true',
  PHOTO_VERSION_MATCHING_ENABLED: 'true',
  PROJECT_VERSIONING_CONFIGURATION_ENABLED: 'true',
  PHOTO_VERSIONS_ENABLED: 'true',
} as const;

describe('Matching rules capability', () => {
  it.each(['local', 'staging', 'production'] as const)(
    'defaults OFF in %s',
    (appEnv) => {
      expect(configuration(environment(appEnv)).MATCHING_RULES_ENABLED).toBe(
        'false',
      );
      expect(matchingRulesCapability(environment(appEnv))).toBe(false);
    },
  );

  it.each(['staging', 'production'] as const)(
    'rejects hosted activation in %s',
    (appEnv) => {
      expect(() =>
        configuration({
          ...environment(appEnv),
          MATCHING_RULES_ENABLED: 'true',
        }),
      ).toThrow('MATCHING_RULES_LOCAL_ONLY');
    },
  );

  it('requires the local rules gate and the complete Assisted matching chain', () => {
    expect(
      matchingRulesCapability({
        ...environment('local'),
        ...enabledMatchingRules,
        GUEST_EXCHANGE_ENABLED: 'false',
        GUEST_SELECTION_ENABLED: 'false',
        GUEST_FEEDBACK_ENABLED: 'false',
        GUEST_TAGS_ENABLED: 'false',
        GUEST_HISTORY_ENABLED: 'false',
        GUEST_COMMENTS_ENABLED: 'false',
        GUEST_ANNOTATIONS_ENABLED: 'false',
        OWNER_COMMENTS_ENABLED: 'false',
        OWNER_ANNOTATIONS_ENABLED: 'false',
      }),
    ).toBe(true);
  });

  it.each([
    'MATCHING_RULES_ENABLED',
    'ASSISTED_CANDIDATE_CATALOG_ENABLED',
    'INDEXED_VERSION_MATCHING_ENABLED',
    'MATCHING_FILENAME_INDEX_ENABLED',
    'DIRECT_UPLOAD_ENABLED',
    'PHOTO_VERSION_UPLOADS_ENABLED',
    'PHOTO_VERSION_MATCHING_ENABLED',
    'PROJECT_VERSIONING_CONFIGURATION_ENABLED',
    'PHOTO_VERSIONS_ENABLED',
  ] as const)('stays disabled without %s', (missing) => {
    expect(
      matchingRulesCapability({
        ...environment('local'),
        ...enabledMatchingRules,
        [missing]: 'false',
      }),
    ).toBe(false);
  });

  it('does not let unrelated Guest or Owner features grant matching rules', () => {
    expect(
      matchingRulesCapability({
        ...environment('local'),
        MATCHING_RULES_ENABLED: 'true',
        GUEST_COMMENTS_ENABLED: 'true',
        GUEST_ANNOTATIONS_ENABLED: 'true',
        OWNER_COMMENTS_ENABLED: 'true',
        OWNER_ANNOTATIONS_ENABLED: 'true',
      }),
    ).toBe(false);
  });

  it.each(['TRUE', 'yes', '1', ''])(
    'rejects unknown activation value %j',
    (value) => {
      expect(() =>
        configuration({
          ...environment('local'),
          MATCHING_RULES_ENABLED: value,
        }),
      ).toThrow();
    },
  );
});

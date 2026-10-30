import { describe, expect, it } from 'vitest';
import {
  setAlbumSelectionConfigurationSchema,
  setProjectSelectionConfigurationSchema,
  albumSelectionConfigurationSchema,
  effectiveSelectionPolicySchema,
  guestEffectiveSelectionPolicySchema,
} from '../../packages/contracts/src/project-selection-policy';
const id = '11111111-1111-4111-8111-111111111111';
const common = {
  requestId: id,
  expectedAlbumRevision: 3,
  expectedProjectRevision: 4,
  confirm: true,
};
describe('project and album selection configuration contracts', () => {
  it('requires both epochs and explicit confirmation for inheritance transitions', () => {
    const inherit = { ...common, configuration: 'inherit' };
    expect(
      setAlbumSelectionConfigurationSchema.safeParse(inherit).success,
    ).toBe(true);
    for (const change of [
      { expectedAlbumRevision: undefined },
      { expectedProjectRevision: undefined },
      { confirm: false },
      { minimum: 1 },
      { maximum: null },
      { actorId: id },
    ])
      expect(
        setAlbumSelectionConfigurationSchema.safeParse({
          ...inherit,
          ...change,
        }).success,
      ).toBe(false);
  });
  it('accepts explicit unlimited overrides and rejects invalid bounded policies', () => {
    const override = {
      ...common,
      configuration: 'override',
      minimum: 2,
      maximum: null,
    };
    expect(
      setAlbumSelectionConfigurationSchema.safeParse(override).success,
    ).toBe(true);
    for (const change of [
      { maximum: 1 },
      { minimum: 0 },
      { minimum: 1.5 },
      { maximum: 100001 },
    ])
      expect(
        setAlbumSelectionConfigurationSchema.safeParse({
          ...override,
          ...change,
        }).success,
      ).toBe(false);
    expect(
      setProjectSelectionConfigurationSchema.safeParse({
        requestId: id,
        expectedRevision: 0,
        minimum: 2,
        maximum: 30,
        confirm: true,
      }).success,
    ).toBe(true);
    expect(
      setProjectSelectionConfigurationSchema.safeParse({
        requestId: id,
        expectedRevision: 0,
        minimum: 31,
        maximum: 30,
        confirm: true,
      }).success,
    ).toBe(false);
  });
  it('requires a persisted epoch for the declared policy source', () => {
    const base = {
      minimum: 1,
      maximum: null,
      mode: 'private',
      projectRevision: 0,
      albumRevision: 0,
    };
    expect(
      effectiveSelectionPolicySchema.safeParse({ ...base, source: 'system' })
        .success,
    ).toBe(true);
    for (const invalid of [
      { ...base, source: 'album' },
      { ...base, source: 'project' },
      { ...base, source: 'system', projectRevision: 1 },
    ])
      expect(effectiveSelectionPolicySchema.safeParse(invalid).success).toBe(
        false,
      );
  });
  it('rejects contradictory effective source and legacy epoch witnesses', () => {
    const policy = {
      minimum: 1,
      maximum: null,
      mode: 'private',
      source: 'album',
      projectRevision: 4,
      albumRevision: 3,
    };
    expect(
      albumSelectionConfigurationSchema.safeParse({
        albumId: id,
        projectId: id,
        configuration: 'inherit',
        policy,
      }).success,
    ).toBe(false);
    expect(
      albumSelectionConfigurationSchema.safeParse({
        albumId: id,
        projectId: id,
        configuration: 'override',
        policy,
      }).success,
    ).toBe(true);
    expect(
      guestEffectiveSelectionPolicySchema.safeParse({ ...policy, revision: 3 })
        .success,
    ).toBe(true);
    expect(
      guestEffectiveSelectionPolicySchema.safeParse({ ...policy, revision: 4 })
        .success,
    ).toBe(false);
  });
});

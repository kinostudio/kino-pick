import { z } from 'zod';
import {
  ownerSelectionPolicyReadSchema,
  setSelectionPolicyResultSchema,
} from '../../../packages/contracts/src/selection-policy';
import { D1SelectionPolicyConfigurationRepository } from './selection-policy-configuration';

export class D1SelectionPolicyRepository {
  private readonly configuration: D1SelectionPolicyConfigurationRepository;

  constructor(db: D1Database, actor: string, session: string) {
    this.configuration = new D1SelectionPolicyConfigurationRepository(
      db,
      actor,
      session,
    );
  }

  async get(albumId: string) {
    const album = z.uuid().parse(albumId);
    const current = await this.configuration.getAlbum(album);
    return ownerSelectionPolicyReadSchema.parse({
      policy: {
        albumId: album,
        minimum: current.policy.minimum,
        maximum: current.policy.maximum,
        revision: current.policy.albumRevision,
        mode: 'private',
      },
      maxOpenSelectedCount: current.maxOpenSelectedCount,
    });
  }

  async set(albumId: string, input: unknown) {
    return setSelectionPolicyResultSchema.parse(
      await this.configuration.setLegacyAlbum(albumId, input),
    );
  }
}

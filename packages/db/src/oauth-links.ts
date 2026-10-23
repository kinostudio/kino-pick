import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  oauthProviderSchema,
  oauthLinkIntentSchema,
  type Actor,
} from '@kino-pic/contracts';
import type { Database } from './database.types';
import { databaseError } from './workspaces';
const tokenHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
export class OAuthLinkRepository {
  constructor(
    private readonly db: SupabaseClient<Database>,
    private readonly actor: Actor,
  ) {}
  private result(data: unknown) {
    const intent = oauthLinkIntentSchema.parse(data);
    if (intent.actorId !== this.actor.id)
      throw new Error('Unexpected link actor');
    return intent;
  }
  async begin(input: unknown) {
    const body = z
      .object({
        provider: oauthProviderSchema,
        tokenHash: tokenHashSchema,
        requestId: z.uuid(),
      })
      .strict()
      .parse(input);
    const { data, error } = await this.db.rpc('begin_oauth_link', {
      p_provider: body.provider,
      p_token_hash: body.tokenHash,
      p_request_id: body.requestId,
    });
    if (error) databaseError(error);
    return this.result(data);
  }
  async get(tokenHash: string) {
    const { data, error } = await this.db.rpc('read_oauth_link', {
      p_token_hash: tokenHashSchema.parse(tokenHash),
    });
    if (error) databaseError(error);
    return this.result(data);
  }
  async complete(tokenHash: string) {
    const { data, error } = await this.db.rpc('complete_oauth_link', {
      p_token_hash: tokenHashSchema.parse(tokenHash),
    });
    if (error) databaseError(error);
    return this.result(data);
  }
}

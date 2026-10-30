import { WorkspaceFailure } from './workspaces';

// Internal Owner admission only. Future Guest admission must add its own current ACL.
export async function withOwnerKdfPermit<T>(
  db: D1Database,
  context: { actor: string; session: string; requestId: string },
  work: () => Promise<T>,
): Promise<T> {
  const id = crypto.randomUUID();
  try {
    const acquired = await db
      .prepare(
        'INSERT INTO kdf_permits(id,actor_id,session_id,request_id) VALUES(?,?,?,?) RETURNING id',
      )
      .bind(id, context.actor, context.session, context.requestId)
      .all<{ id: string }>();
    if (
      !acquired.success ||
      acquired.meta.changes < 1 ||
      acquired.results[0]?.id !== id
    )
      throw new WorkspaceFailure('KDF_CAPACITY_UNAVAILABLE', 503);
  } catch (error) {
    if (error instanceof Error && error.message.includes('OWNER_REQUIRED'))
      throw new WorkspaceFailure('OWNER_REQUIRED', 403);
    // Ambiguous acquisition must not start work or release a possibly held slot.
    throw new WorkspaceFailure('KDF_CAPACITY_UNAVAILABLE', 503);
  }
  try {
    // Await the original native promise: never release on timeout/client abort.
    return await work();
  } finally {
    try {
      const released = await db
        .prepare(
          'INSERT INTO kdf_permit_releases(permit_id) VALUES(?) ON CONFLICT(permit_id) DO NOTHING RETURNING permit_id',
        )
        .bind(id)
        .all<{ permit_id: string }>();
      if (
        !released.success ||
        released.meta.changes < 1 ||
        released.results[0]?.permit_id !== id
      )
        throw new Error('Unconfirmed release');
    } catch {
      // Prevent invitation creation after an unconfirmed release. Fail closed.
      throw new WorkspaceFailure('KDF_RELEASE_UNAVAILABLE', 503);
    }
  }
}

// Guest password checks share the same global slot as Owner invite creation.
// The separate Guest ledger has no Owner session dependency or time-based unlock.
export async function withGuestKdfPermit<T>(
  db: D1Database,
  context: { inviteId: string; requestId: string },
  work: (permitId: string) => Promise<T>,
): Promise<{ result: T; permitId: string }> {
  const id = crypto.randomUUID();
  try {
    const acquired = await db
      .prepare(
        'INSERT INTO guest_kdf_permits(id,invite_id,request_id) VALUES(?,?,?) RETURNING id',
      )
      .bind(id, context.inviteId, context.requestId)
      .all<{ id: string }>();
    if (
      !acquired.success ||
      acquired.meta.changes < 1 ||
      acquired.results[0]?.id !== id
    )
      throw new WorkspaceFailure('KDF_CAPACITY_UNAVAILABLE', 503);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('GUEST_ACCESS_REQUIRED')
    )
      throw new WorkspaceFailure('GUEST_ACCESS_REQUIRED', 401);
    if (
      error instanceof Error &&
      error.message.includes('KDF_CAPACITY_UNAVAILABLE')
    )
      throw new WorkspaceFailure('GUEST_ACCESS_REQUIRED', 401);
    if (
      error instanceof WorkspaceFailure &&
      error.code === 'KDF_CAPACITY_UNAVAILABLE'
    )
      throw new WorkspaceFailure('GUEST_ACCESS_REQUIRED', 401);
    // An ambiguous acquisition must not start native work or release a slot.
    throw new WorkspaceFailure('GUEST_KDF_UNAVAILABLE', 503);
  }
  try {
    const result = await work(id);
    return { result, permitId: id };
  } finally {
    try {
      const released = await db
        .prepare(
          'INSERT INTO guest_kdf_permit_releases(permit_id) VALUES(?) ON CONFLICT(permit_id) DO NOTHING RETURNING permit_id',
        )
        .bind(id)
        .all<{ permit_id: string }>();
      if (
        !released.success ||
        released.meta.changes < 1 ||
        released.results[0]?.permit_id !== id
      )
        throw new Error('Unconfirmed Guest KDF release');
    } catch {
      // Preserve the global lock if native work completion cannot be recorded.
      throw new WorkspaceFailure('GUEST_KDF_RELEASE_UNAVAILABLE', 503);
    }
  }
}

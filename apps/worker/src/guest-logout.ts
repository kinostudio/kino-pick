import { z } from 'zod';
import { hashGuestSessionSecret } from './guest-access';
import { WorkspaceFailure } from './workspaces';
export const guestLogoutSchema = z.object({ requestId: z.uuid() }).strict();
export async function logoutGuest(
  db: D1Database,
  secret: string | null,
  input: unknown,
): Promise<void> {
  const { requestId } = guestLogoutSchema.parse(input);
  if (!secret) return;
  const hash = await hashGuestSessionSecret(secret);
  const session = await db
    .prepare('SELECT id,guest_id FROM guest_sessions WHERE secret_hash=?')
    .bind(hash)
    .first<{ id: string; guest_id: string }>();
  if (!session) return;
  try {
    await db
      .prepare(
        'INSERT INTO guest_logout_commands(guest_id,request_id,session_id,secret_hash) VALUES(?,?,?,?)',
      )
      .bind(session.guest_id, requestId, session.id, hash)
      .run();
  } catch (error) {
    if (error instanceof Error && error.message.includes('REQUEST_ID_CONFLICT'))
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
    throw error;
  }
  if (
    !(await db
      .prepare('SELECT 1 FROM guest_session_revocations WHERE session_id=?')
      .bind(session.id)
      .first())
  )
    throw new WorkspaceFailure('GUEST_LOGOUT_UNCERTAIN', 503);
}

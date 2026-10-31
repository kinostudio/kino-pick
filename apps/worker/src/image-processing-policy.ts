import { z } from 'zod';
import { WorkspaceFailure } from './workspaces';

export const IMAGE_PROCESSING_POLICY_RECIPES = [
  'local-sharp-0.35.5-v1',
  'cloudflare-images-jpeg-82-v1',
] as const;

export type ImageProcessingPolicyRecipe =
  (typeof IMAGE_PROCESSING_POLICY_RECIPES)[number];

const recipeSchema = z.enum(IMAGE_PROCESSING_POLICY_RECIPES);
const workspaceIdSchema = z.uuid();
const actorIdSchema = z.uuid();
const sessionIdSchema = z.string().min(1).max(512);
const maxSafeRevision = Number.MAX_SAFE_INTEGER - 1;

const inputSchema = z
  .object({
    requestId: z.uuid().transform((value) => value.toLowerCase()),
    expectedRevision: z.number().int().min(0).max(maxSafeRevision),
    recipe: recipeSchema,
  })
  .strict();

const policyRowSchema = z
  .object({
    workspaceId: z.uuid(),
    recipe: recipeSchema,
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const receiptRowSchema = z
  .object({
    workspaceId: z.uuid(),
    requestId: z.uuid(),
    expectedRevision: z.number().int().min(0).max(maxSafeRevision),
    recipe: recipeSchema,
    createdAtMs: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

type PolicyInput = z.infer<typeof inputSchema>;
type PolicyReceiptRow = z.infer<typeof receiptRowSchema>;

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function unavailable(): never {
  throw new WorkspaceFailure('IMAGE_PROCESSING_POLICY_UNAVAILABLE', 503);
}

function parseContext(actorId: string, sessionId: string, workspaceId: string) {
  const actor = actorIdSchema.safeParse(actorId);
  const session = sessionIdSchema.safeParse(sessionId);
  const workspace = workspaceIdSchema.safeParse(workspaceId);
  if (!actor.success || !session.success || !workspace.success) invalidInput();
  return {
    actorId: actor.data,
    sessionId: session.data,
    workspaceId: workspace.data,
  };
}

function parseInput(value: unknown): PolicyInput {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) invalidInput();
  return parsed.data;
}

function translatePolicyError(error: unknown): never {
  if (error instanceof WorkspaceFailure) throw error;

  const message = error instanceof Error ? error.message.toUpperCase() : '';
  if (message.includes('OWNER_REQUIRED'))
    throw new WorkspaceFailure('OWNER_REQUIRED', 401);
  if (message.includes('NOT_FOUND'))
    throw new WorkspaceFailure('NOT_FOUND', 404);
  if (message.includes('INVALID_INPUT'))
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  if (message.includes('REQUEST_ID_CONFLICT'))
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  if (
    message.includes('IMAGE_PROCESSING_POLICY_REVISION_CONFLICT') ||
    message.includes('POLICY_REVISION_CONFLICT')
  )
    throw new WorkspaceFailure(
      'IMAGE_PROCESSING_POLICY_REVISION_CONFLICT',
      409,
    );
  if (
    message.includes('IMAGE_PROCESSING_POLICY_UPLOADS_IN_PROGRESS') ||
    message.includes('UPLOADS_IN_PROGRESS') ||
    message.includes('RESERVED_UPLOADS')
  )
    throw new WorkspaceFailure(
      'IMAGE_PROCESSING_POLICY_UPLOADS_IN_PROGRESS',
      409,
    );
  if (message.includes('REVISION_EXHAUSTED'))
    throw new WorkspaceFailure(
      'IMAGE_PROCESSING_POLICY_REVISION_EXHAUSTED',
      409,
    );
  unavailable();
}

async function assertCurrentOwner(
  db: D1Database,
  actorId: string,
  sessionId: string,
): Promise<void> {
  const row = await db
    .prepare(
      [
        'SELECT 1 AS authorized',
        'FROM owners o',
        'JOIN owner_sessions s ON s.userId=o.user_id',
        "  AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
        'WHERE o.user_id=? AND o.enabled=1',
      ].join(' '),
    )
    .bind(sessionId, actorId)
    .first<{ authorized: number }>();
  if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 401);
}

async function loadCurrentPolicy(
  db: D1Database,
  actorId: string,
  sessionId: string,
  workspaceId: string,
) {
  const row = await db
    .prepare(
      [
        'SELECT w.id AS workspaceId,',
        "  COALESCE(p.recipe,'local-sharp-0.35.5-v1') AS recipe,",
        '  COALESCE(p.revision,0) AS revision',
        'FROM workspaces w',
        'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
        'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
        "  AND s.expiresAt>unixepoch('subsec')*1000",
        'LEFT JOIN workspace_image_processing_policies p',
        '  ON p.workspace_id=w.id',
        'WHERE w.id=? AND w.owner_user_id=?',
      ].join(' '),
    )
    .bind(sessionId, workspaceId, actorId)
    .first<unknown>();

  if (!row) {
    await assertCurrentOwner(db, actorId, sessionId);
    throw new WorkspaceFailure('NOT_FOUND', 404);
  }

  const parsed = policyRowSchema.safeParse(row);
  if (!parsed.success) unavailable();
  return parsed.data;
}

function receiptSql() {
  return [
    'SELECT c.workspace_id AS workspaceId,',
    '  c.request_id AS requestId,',
    '  c.expected_revision AS expectedRevision,',
    '  c.recipe,',
    '  c.created_at_ms AS createdAtMs',
    'FROM workspace_image_processing_policy_commands c',
    'JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=c.actor_id',
    'JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    "  AND s.expiresAt>unixepoch('subsec')*1000",
    'WHERE c.actor_id=? AND c.request_id=?',
  ].join(' ');
}

async function loadReceipt(
  db: D1Database,
  actorId: string,
  sessionId: string,
  requestId: string,
): Promise<PolicyReceiptRow | null> {
  const row = await db
    .prepare(receiptSql())
    .bind(sessionId, actorId, requestId)
    .first<unknown>();
  if (!row) return null;

  const parsed = receiptRowSchema.safeParse(row);
  if (!parsed.success) unavailable();
  return parsed.data;
}

export async function readImageProcessingPolicy(
  db: D1Database,
  actorId: string,
  sessionId: string,
  workspaceId: string,
) {
  try {
    const context = parseContext(actorId, sessionId, workspaceId);
    return await loadCurrentPolicy(
      db,
      context.actorId,
      context.sessionId,
      context.workspaceId,
    );
  } catch (error) {
    translatePolicyError(error);
  }
}

export async function changeImageProcessingPolicy(
  db: D1Database,
  actorId: string,
  sessionId: string,
  workspaceId: string,
  input: unknown,
) {
  try {
    const context = parseContext(actorId, sessionId, workspaceId);
    const value = parseInput(input);

    // Check the exact active Owner session and workspace scope before the
    // command insert. The database trigger repeats these checks atomically.
    await loadCurrentPolicy(
      db,
      context.actorId,
      context.sessionId,
      context.workspaceId,
    );

    await db
      .prepare(
        [
          'INSERT INTO workspace_image_processing_policy_commands(',
          'actor_id,request_id,session_id,workspace_id,expected_revision,',
          'recipe,created_at_ms',
          ") VALUES(?,?,?,?,?,?,CAST(unixepoch('subsec')*1000 AS INTEGER))",
        ].join(' '),
      )
      .bind(
        context.actorId,
        value.requestId,
        context.sessionId,
        context.workspaceId,
        value.expectedRevision,
        value.recipe,
      )
      .run();

    // Return the command receipt, not the mutable current policy. This keeps
    // an exact retry stable even if a later command has advanced the revision.
    const receipt = await loadReceipt(
      db,
      context.actorId,
      context.sessionId,
      value.requestId,
    );
    if (!receipt) {
      await loadCurrentPolicy(
        db,
        context.actorId,
        context.sessionId,
        context.workspaceId,
      );
      unavailable();
    }

    if (
      receipt.workspaceId !== context.workspaceId ||
      receipt.expectedRevision !== value.expectedRevision ||
      receipt.recipe !== value.recipe
    )
      throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);

    return {
      workspaceId: receipt.workspaceId,
      requestId: receipt.requestId,
      recipe: receipt.recipe,
      revision: receipt.expectedRevision + 1,
      createdAtMs: receipt.createdAtMs,
    };
  } catch (error) {
    translatePolicyError(error);
  }
}

import { z } from 'zod';
import {
  projectVersioningReadSchema,
  setProjectVersioningResultSchema,
  setProjectVersioningSchema,
} from '../../../packages/contracts/src/project-versioning';
import { WorkspaceFailure } from './workspaces';

const projectIdSchema = z.uuid();
const allVersioningModesSchema = z.enum([
  'off',
  'manual',
  'auto_filename',
  'assisted',
]);
const setInputWithUnavailableModesSchema = z
  .object({
    requestId: z.uuid(),
    expectedRevision: z.number().int().min(1).max(2147483647),
    mode: allVersioningModesSchema,
    confirm: z.literal(true),
  })
  .strict();

type ProjectScope = {
  projectId: string;
  workspaceId: string;
  mode: string;
  revision: number;
  versioningCommandId: string | null;
  status: string;
};

type ProjectVersioningReadRow = {
  projectId: string;
  workspaceId: string;
  mode: string;
  revision: number;
};

type ProjectVersioningResultRow = {
  result_json: string;
};

function invalidInput(): never {
  throw new WorkspaceFailure('INVALID_INPUT', 400);
}

function unavailable(): never {
  throw new WorkspaceFailure('PROJECT_VERSIONING_UNAVAILABLE', 503);
}

function parseJsonResult(value: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    unavailable();
  }

  const parsed = setProjectVersioningResultSchema.safeParse(decoded);
  if (!parsed.success) unavailable();
  return parsed.data;
}

function translateProjectVersioningError(error: unknown): never {
  const message = error instanceof Error ? error.message.toUpperCase() : '';
  if (message.includes('OWNER_REQUIRED'))
    throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  if (message.includes('NOT_FOUND'))
    throw new WorkspaceFailure('NOT_FOUND', 404);
  if (message.includes('RESOURCE_NOT_EDITABLE'))
    throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
  if (message.includes('REQUEST_ID_CONFLICT'))
    throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
  if (message.includes('PROJECT_VERSIONING_REVISION_CONFLICT'))
    throw new WorkspaceFailure('PROJECT_VERSIONING_REVISION_CONFLICT', 409);
  if (message.includes('PROJECT_VERSIONING_REVISION_EXHAUSTED'))
    throw new WorkspaceFailure('PROJECT_VERSIONING_REVISION_EXHAUSTED', 409);
  if (message.includes('VERSION_MATCHING_UNAVAILABLE'))
    throw new WorkspaceFailure('VERSION_MATCHING_UNAVAILABLE', 409);
  if (message.includes('INVALID_INPUT'))
    throw new WorkspaceFailure('INVALID_INPUT', 400);
  if (
    message.includes('PROJECT_VERSIONING') ||
    message.includes('INVALID_TIMESTAMP')
  )
    throw new WorkspaceFailure('PROJECT_VERSIONING_UNAVAILABLE', 503);
  throw error;
}

function scopeSql() {
  return [
    'SELECT p.id AS projectId,p.workspace_id AS workspaceId,',
    '  p.versioning_mode AS mode,p.revision,',
    '  p.versioning_command_id AS versioningCommandId,p.status',
    'FROM projects p',
    'JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?',
    'WHERE p.id=?',
  ].join(' ');
}

function ownerCheckSql() {
  return [
    'SELECT 1 AS authorized',
    'FROM owners o',
    'JOIN owner_sessions s ON s.userId=o.user_id',
    "  AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000",
    'WHERE o.user_id=? AND o.enabled=1',
  ].join(' ');
}

function readSql() {
  return [
    'SELECT p.id AS projectId,p.workspace_id AS workspaceId,',
    '  p.versioning_mode AS mode,p.revision',
    'FROM projects p',
    'JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?',
    'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    "  AND s.expiresAt>unixepoch('subsec')*1000",
    "WHERE p.id=? AND p.status NOT IN('archived','deleting','deleted')",
  ].join(' ');
}

function resultSql() {
  return [
    'SELECT r.result_json',
    'FROM project_versioning_commands c',
    'JOIN project_versioning_results r ON r.command_id=c.id',
    'JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id',
    'JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?',
    'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    "  AND s.expiresAt>unixepoch('subsec')*1000",
    'WHERE c.actor_id=? AND c.request_id=? AND c.project_id=?',
    '  AND c.payload_json=?',
    "  AND p.status NOT IN('archived','deleting','deleted')",
  ].join(' ');
}

export class D1ProjectVersioningRepository {
  constructor(
    private db: D1Database,
    private actorId: string,
    private sessionId: string,
    private enabled: boolean,
    private matchingEnabled = false,
  ) {}

  async read(projectIdInput: string) {
    this.assertEnabled();
    const projectId = projectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) invalidInput();

    const row = await this.db
      .prepare(readSql())
      .bind(this.actorId, this.sessionId, projectId.data)
      .first<ProjectVersioningReadRow>();

    if (!row) {
      await this.assertCurrentOwner();
      const scope = await this.loadScope(projectId.data);
      this.assertProjectEditable(scope);
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }

    const parsed = projectVersioningReadSchema.safeParse({
      ...row,
      availableModes: this.matchingEnabled
        ? ['off', 'manual', 'auto_filename', 'assisted']
        : ['off', 'manual'],
    });
    if (!parsed.success) unavailable();
    return parsed.data;
  }

  async set(projectIdInput: string, input: unknown) {
    this.assertEnabled();
    const projectId = projectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) invalidInput();

    const broadInput = setInputWithUnavailableModesSchema.safeParse(input);
    if (!broadInput.success) invalidInput();
    if (
      !this.matchingEnabled &&
      (broadInput.data.mode === 'auto_filename' ||
        broadInput.data.mode === 'assisted')
    ) {
      throw new WorkspaceFailure('VERSION_MATCHING_UNAVAILABLE', 409);
    }
    const value = setProjectVersioningSchema.safeParse(broadInput.data);
    if (!value.success) invalidInput();

    await this.assertCurrentOwner();
    const scope = await this.loadScope(projectId.data);
    this.assertProjectEditable(scope);

    const payloadJson = JSON.stringify({
      projectId: projectId.data,
      expectedRevision: value.data.expectedRevision,
      mode: value.data.mode,
      confirm: true,
    });

    try {
      await this.db
        .prepare(
          [
            'INSERT INTO project_versioning_commands(',
            'id,actor_id,session_id,request_id,operation,workspace_id,project_id,',
            'expected_revision,before_mode,mode,confirm,previous_command_id,',
            'payload_json,created_at_ms',
            ') VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?,?)',
          ].join(' '),
        )
        .bind(
          crypto.randomUUID(),
          this.actorId,
          this.sessionId,
          value.data.requestId,
          'project.versioning_mode.set',
          scope.workspaceId,
          projectId.data,
          value.data.expectedRevision,
          scope.mode,
          value.data.mode,
          scope.versioningCommandId,
          payloadJson,
          Date.now(),
        )
        .run();
    } catch (error) {
      translateProjectVersioningError(error);
    }

    const row = await this.db
      .prepare(resultSql())
      .bind(
        this.actorId,
        this.sessionId,
        this.actorId,
        value.data.requestId,
        projectId.data,
        payloadJson,
      )
      .first<ProjectVersioningResultRow>();

    if (!row) {
      await this.assertCurrentOwner();
      const currentScope = await this.loadScope(projectId.data);
      this.assertProjectEditable(currentScope);
      unavailable();
    }
    return parseJsonResult(row.result_json);
  }

  private assertEnabled() {
    if (!this.enabled) {
      throw new WorkspaceFailure('PROJECT_VERSIONING_DISABLED', 409);
    }
  }

  private async assertCurrentOwner() {
    const row = await this.db
      .prepare(ownerCheckSql())
      .bind(this.sessionId, this.actorId)
      .first<{ authorized: number }>();
    if (!row) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  }

  private async loadScope(projectId: string): Promise<ProjectScope> {
    const scope = await this.db
      .prepare(scopeSql())
      .bind(this.actorId, projectId)
      .first<ProjectScope>();
    if (!scope) throw new WorkspaceFailure('NOT_FOUND', 404);
    if (
      !Number.isSafeInteger(scope.revision) ||
      scope.revision < 1 ||
      scope.revision > 2147483647
    ) {
      unavailable();
    }
    return scope;
  }

  private assertProjectEditable(scope: ProjectScope) {
    if (['archived', 'deleting', 'deleted'].includes(scope.status)) {
      throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
    }
  }
}

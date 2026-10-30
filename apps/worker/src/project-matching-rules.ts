import { z } from 'zod';
import {
  matchingProfileIdSchema,
  projectMatchingRulesReadSchema,
  setProjectMatchingRulesResultSchema,
  setProjectMatchingRulesSchema,
} from '../../../packages/contracts/src/matching-rules';
import { getMatchingProfile } from '../../../packages/domain/src/matching-profiles';
import { WorkspaceFailure } from './workspaces';

const projectIdSchema = z.uuid();

type MatchingRulesScope = {
  projectId: string;
  workspaceId: string;
  mode: string;
  projectRevision: number;
  profile: string;
  ruleRevision: number;
  previousCommandId: string | null;
  status: string;
};

type MatchingRulesReadRow = Omit<
  MatchingRulesScope,
  'previousCommandId' | 'status'
>;
type ExistingCommandRow = {
  workspace_id: string;
  project_id: string;
  operation: string;
  expected_project_revision: number;
  expected_rule_revision: number;
  profile: string;
  confirm: number;
  payload_json: string;
};
type ResultRow = { result_json: string };

function failure(code: string, status: 400 | 403 | 404 | 409 | 503): never {
  throw new WorkspaceFailure(code, status);
}

function unavailable(): never {
  return failure('MATCHING_RULES_UNAVAILABLE', 503);
}

function ownerRequired(): never {
  return failure('OWNER_REQUIRED', 403);
}

function invalidInput(): never {
  return failure('INVALID_INPUT', 400);
}

function readScopeSql() {
  return [
    'SELECT p.id AS projectId,p.workspace_id AS workspaceId,',
    '  p.versioning_mode AS mode,p.revision AS projectRevision,',
    "  COALESCE(h.profile,'default-v1') AS profile,COALESCE(h.revision,0) AS ruleRevision",
    'FROM projects p',
    'JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?',
    'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    "  AND s.expiresAt>unixepoch('subsec')*1000",
    'LEFT JOIN project_matching_rule_heads h',
    '  ON h.project_id=p.id AND h.workspace_id=p.workspace_id',
    "WHERE p.id=? AND p.status NOT IN('archived','deleting','deleted')",
  ].join(' ');
}

function scopeSql() {
  return [
    'SELECT p.id AS projectId,p.workspace_id AS workspaceId,',
    '  p.versioning_mode AS mode,p.revision AS projectRevision,',
    "  COALESCE(h.profile,'default-v1') AS profile,COALESCE(h.revision,0) AS ruleRevision,",
    '  h.command_id AS previousCommandId,p.status',
    'FROM projects p',
    'JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?',
    'LEFT JOIN project_matching_rule_heads h',
    '  ON h.project_id=p.id AND h.workspace_id=p.workspace_id',
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

function existingCommandSql() {
  return [
    'SELECT c.workspace_id,c.project_id,c.operation,',
    '  c.expected_project_revision,c.expected_rule_revision,c.profile,c.confirm,c.payload_json',
    'FROM project_matching_rule_commands c',
    'WHERE c.actor_id=? AND lower(c.request_id)=?',
  ].join(' ');
}

function resultSql() {
  return [
    'SELECT r.result_json',
    'FROM project_matching_rule_commands c',
    'JOIN project_matching_rule_results r ON r.command_id=c.id',
    'JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id',
    'JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?',
    'JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1',
    'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=?',
    "  AND s.expiresAt>unixepoch('subsec')*1000",
    'WHERE c.actor_id=? AND lower(c.request_id)=?',
    '  AND c.workspace_id=? AND c.project_id=? AND c.payload_json=?',
    "  AND p.status NOT IN('archived','deleting','deleted')",
  ].join(' ');
}

function translateSqlError(error: unknown): never {
  const message = error instanceof Error ? error.message.toUpperCase() : '';
  if (message.includes('OWNER_REQUIRED')) return failure('OWNER_REQUIRED', 403);
  if (message.includes('NOT_FOUND')) return failure('NOT_FOUND', 404);
  if (message.includes('RESOURCE_NOT_EDITABLE'))
    return failure('RESOURCE_NOT_EDITABLE', 409);
  if (message.includes('REQUEST_ID_CONFLICT'))
    return failure('REQUEST_ID_CONFLICT', 409);
  if (message.includes('MATCHING_RULES_REVISION_EXHAUSTED'))
    return failure('MATCHING_RULES_REVISION_EXHAUSTED', 409);
  if (message.includes('MATCHING_RULES_REVISION_CONFLICT'))
    return failure('MATCHING_RULES_REVISION_CONFLICT', 409);
  if (message.includes('INVALID_INPUT')) return failure('INVALID_INPUT', 400);
  unavailable();
}

function parseResult(value: string) {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    unavailable();
  }
  const parsed = setProjectMatchingRulesResultSchema.safeParse(decoded);
  if (!parsed.success) unavailable();
  return parsed.data;
}

export class D1ProjectMatchingRulesRepository {
  constructor(
    private db: D1Database,
    private actorId: string,
    private sessionId: string,
    private enabled: boolean,
  ) {}

  async read(projectIdInput: string) {
    this.assertEnabled();
    const parsedProjectId = projectIdSchema.safeParse(projectIdInput);
    if (!parsedProjectId.success) invalidInput();
    const projectId = parsedProjectId.data.toLowerCase();

    let row: MatchingRulesReadRow | null;
    try {
      row = await this.db
        .prepare(readScopeSql())
        .bind(this.actorId, this.sessionId, projectId)
        .first<MatchingRulesReadRow>();
    } catch (error) {
      translateSqlError(error);
    }

    if (!row) {
      await this.assertCurrentOwner();
      const scope = await this.loadScope(projectId);
      this.assertProjectEditable(scope);
      failure('NOT_FOUND', 404);
    }

    const profileId = matchingProfileIdSchema.safeParse(row.profile);
    const profile = profileId.success
      ? getMatchingProfile(profileId.data)
      : null;
    if (!profile) unavailable();
    const result = projectMatchingRulesReadSchema.safeParse({
      ...row,
      projectId: projectId,
      rules: profile.rules,
    });
    if (!result.success) unavailable();
    return result.data;
  }

  async set(projectIdInput: string, input: unknown) {
    this.assertEnabled();
    const parsedProjectId = projectIdSchema.safeParse(projectIdInput);
    const parsedInput = setProjectMatchingRulesSchema.safeParse(input);
    if (!parsedProjectId.success || !parsedInput.success) invalidInput();

    const projectId = parsedProjectId.data.toLowerCase();
    const requestId = parsedInput.data.requestId.toLowerCase();
    const value = { ...parsedInput.data, requestId };
    const payloadJson = JSON.stringify({
      projectId,
      expectedProjectRevision: value.expectedProjectRevision,
      expectedRuleRevision: value.expectedRuleRevision,
      profile: value.profile,
      confirm: true,
    });

    await this.assertCurrentOwner();
    const scope = await this.loadScope(projectId);
    this.assertProjectEditable(scope);

    let existing: ExistingCommandRow | null;
    try {
      existing = await this.db
        .prepare(existingCommandSql())
        .bind(this.actorId, requestId)
        .first<ExistingCommandRow>();
    } catch {
      unavailable();
    }

    if (existing) {
      if (
        existing.project_id !== projectId ||
        existing.workspace_id !== scope.workspaceId ||
        existing.operation !== 'project.matching_rules.set' ||
        existing.expected_project_revision !== value.expectedProjectRevision ||
        existing.expected_rule_revision !== value.expectedRuleRevision ||
        existing.profile !== value.profile ||
        existing.confirm !== 1 ||
        existing.payload_json !== payloadJson
      ) {
        failure('REQUEST_ID_CONFLICT', 409);
      }
      return this.loadResult(scope, requestId, payloadJson);
    }

    try {
      await this.db
        .prepare(
          [
            'INSERT INTO project_matching_rule_commands(',
            'id,actor_id,session_id,request_id,operation,workspace_id,project_id,',
            'expected_project_revision,expected_rule_revision,before_profile,profile,',
            'confirm,previous_command_id,payload_json,created_at_ms',
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ].join(' '),
        )
        .bind(
          crypto.randomUUID().toLowerCase(),
          this.actorId,
          this.sessionId,
          requestId,
          'project.matching_rules.set',
          scope.workspaceId,
          projectId,
          value.expectedProjectRevision,
          value.expectedRuleRevision,
          scope.profile,
          value.profile,
          1,
          scope.previousCommandId,
          payloadJson,
          Date.now(),
        )
        .run();
    } catch (error) {
      translateSqlError(error);
    }

    return this.loadResult(scope, requestId, payloadJson);
  }

  private assertEnabled() {
    if (!this.enabled) failure('MATCHING_RULES_DISABLED', 403);
  }

  private async assertCurrentOwner() {
    let row: { authorized: number } | null;
    try {
      row = await this.db
        .prepare(ownerCheckSql())
        .bind(this.sessionId, this.actorId)
        .first<{ authorized: number }>();
    } catch {
      unavailable();
    }
    if (!row) ownerRequired();
  }

  private async loadScope(projectId: string): Promise<MatchingRulesScope> {
    let scope: MatchingRulesScope | null;
    try {
      scope = await this.db
        .prepare(scopeSql())
        .bind(this.actorId, projectId)
        .first<MatchingRulesScope>();
    } catch {
      unavailable();
    }
    if (!scope) failure('NOT_FOUND', 404);
    if (
      !Number.isSafeInteger(scope.projectRevision) ||
      scope.projectRevision < 1 ||
      scope.projectRevision > 2147483647 ||
      !Number.isSafeInteger(scope.ruleRevision) ||
      scope.ruleRevision < 0 ||
      scope.ruleRevision > 2147483647 ||
      !matchingProfileIdSchema.safeParse(scope.profile).success
    ) {
      unavailable();
    }
    return scope;
  }

  private assertProjectEditable(scope: MatchingRulesScope) {
    if (['archived', 'deleting', 'deleted'].includes(scope.status)) {
      failure('RESOURCE_NOT_EDITABLE', 409);
    }
  }

  private async loadResult(
    scope: MatchingRulesScope,
    requestId: string,
    payloadJson: string,
  ) {
    let row: ResultRow | null;
    try {
      row = await this.db
        .prepare(resultSql())
        .bind(
          this.actorId,
          this.sessionId,
          this.actorId,
          requestId,
          scope.workspaceId,
          scope.projectId,
          payloadJson,
        )
        .first<ResultRow>();
    } catch {
      unavailable();
    }
    if (!row) {
      await this.assertCurrentOwner();
      const currentScope = await this.loadScope(scope.projectId);
      this.assertProjectEditable(currentScope);
      unavailable();
    }
    return parseResult(row.result_json);
  }
}

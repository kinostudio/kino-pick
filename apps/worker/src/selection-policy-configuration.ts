import { z } from 'zod';
import {
  ownerAlbumSelectionConfigurationReadSchema,
  ownerProjectSelectionConfigurationReadSchema,
  setAlbumSelectionConfigurationResultSchema,
  setAlbumSelectionConfigurationSchema,
  setProjectSelectionConfigurationResultSchema,
  setProjectSelectionConfigurationSchema,
} from '../../../packages/contracts/src/project-selection-policy';
import {
  setSelectionPolicyResultSchema,
  setSelectionPolicySchema,
} from '../../../packages/contracts/src/selection-policy';
import { WorkspaceFailure } from './workspaces';

type ProjectScope = {
  workspaceId: string;
  status: string;
};
type AlbumScope = {
  workspaceId: string;
  projectId: string;
  albumState: string;
  projectStatus: string;
};
type ProjectReadRow = {
  minimum: number;
  maximum: number | null;
  revision: number;
  maxOpenSelectedCount: number;
};
type AlbumReadRow = {
  configuration: 'inherit' | 'override';
  minimum: number;
  maximum: number | null;
  revision: number;
  projectRevision: number;
  albumRevision: number;
  source: 'system' | 'project' | 'album';
  maxOpenSelectedCount: number;
};
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

function sqlFailure(error: unknown): never {
  const message = errorMessage(error);
  const known: Array<[string, string, 400 | 403 | 404 | 409 | 503]> = [
    ['OWNER_REQUIRED', 'OWNER_REQUIRED', 403],
    ['NOT_FOUND', 'NOT_FOUND', 404],
    ['RESOURCE_NOT_EDITABLE', 'RESOURCE_NOT_EDITABLE', 409],
    ['REQUEST_ID_CONFLICT', 'REQUEST_ID_CONFLICT', 409],
    [
      'SELECTION_POLICY_REVISION_CONFLICT',
      'SELECTION_POLICY_REVISION_CONFLICT',
      409,
    ],
    ['SELECTION_POLICY_BELOW_CURRENT', 'SELECTION_POLICY_BELOW_CURRENT', 409],
    ['INVALID_TIMESTAMP', 'INVALID_INPUT', 400],
  ];
  for (const [needle, code, status] of known) {
    if (message.includes(needle)) throw new WorkspaceFailure(code, status);
  }
  throw new WorkspaceFailure('SELECTION_POLICY_CONFIGURATION_UNAVAILABLE', 503);
}

function parseResult<T>(raw: string | null, schema: z.ZodType<T>): T {
  if (raw === null)
    throw new WorkspaceFailure(
      'SELECTION_POLICY_CONFIGURATION_UNAVAILABLE',
      503,
    );
  try {
    return schema.parse(JSON.parse(raw) as unknown);
  } catch {
    throw new WorkspaceFailure(
      'SELECTION_POLICY_CONFIGURATION_UNAVAILABLE',
      503,
    );
  }
}

function legacyPayload(
  albumId: string,
  request: {
    expectedRevision: number;
    minimum: number;
    maximum: number | null;
  },
): string {
  return JSON.stringify({
    albumId,
    expectedRevision: request.expectedRevision,
    minimum: request.minimum,
    maximum: request.maximum,
    confirm: true,
  });
}

function toLegacyResult(albumId: string, raw: string | null) {
  const result = parseResult(raw, setAlbumSelectionConfigurationResultSchema);
  return setSelectionPolicyResultSchema.parse({
    policy: {
      albumId,
      minimum: result.configuration.policy.minimum,
      maximum: result.configuration.policy.maximum,
      revision: result.configuration.policy.albumRevision,
      mode: 'private',
    },
    eventId: result.eventId,
    occurredAt: result.occurredAt,
  });
}

export class D1SelectionPolicyConfigurationRepository {
  constructor(
    private readonly db: D1Database,
    private readonly actor: string,
    private readonly session: string,
  ) {}

  private async assertCurrentOwner(): Promise<void> {
    const current = await this.db
      .prepare(
        'SELECT 1 FROM owners o JOIN owner_sessions s ON s.userId=o.user_id ' +
          "AND s.id=? AND s.expiresAt>unixepoch('subsec')*1000 " +
          'WHERE o.user_id=? AND o.enabled=1',
      )
      .bind(this.session, this.actor)
      .first();
    if (!current) throw new WorkspaceFailure('OWNER_REQUIRED', 403);
  }

  private async authorizeProject(
    projectId: string,
    forWrite = false,
  ): Promise<ProjectScope> {
    const project = z.uuid().parse(projectId);
    const row = await this.db
      .prepare(
        'SELECT p.workspace_id,p.status FROM owners o ' +
          'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
          "AND s.expiresAt>unixepoch('subsec')*1000 " +
          'JOIN workspaces w ON w.owner_user_id=o.user_id ' +
          'JOIN projects p ON p.workspace_id=w.id ' +
          'WHERE o.user_id=? AND o.enabled=1 AND p.id=?',
      )
      .bind(this.session, this.actor, project)
      .first<{ workspace_id: string; status: string }>();
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }
    if (forWrite && ['archived', 'deleting', 'deleted'].includes(row.status)) {
      throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
    }
    return { workspaceId: row.workspace_id, status: row.status };
  }

  private async authorizeAlbum(
    albumId: string,
    forWrite = false,
  ): Promise<AlbumScope> {
    const album = z.uuid().parse(albumId);
    const row = await this.db
      .prepare(
        'SELECT a.workspace_id,a.project_id,a.state,p.status AS project_status ' +
          'FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
          "AND s.expiresAt>unixepoch('subsec')*1000 " +
          'JOIN workspaces w ON w.owner_user_id=o.user_id ' +
          'JOIN albums a ON a.workspace_id=w.id ' +
          'JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id ' +
          'WHERE o.user_id=? AND o.enabled=1 AND a.id=?',
      )
      .bind(this.session, this.actor, album)
      .first<{
        workspace_id: string;
        project_id: string;
        state: string;
        project_status: string;
      }>();
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }
    if (
      forWrite &&
      (!['active', 'draft'].includes(row.state) ||
        ['archived', 'deleting', 'deleted'].includes(row.project_status))
    ) {
      throw new WorkspaceFailure('RESOURCE_NOT_EDITABLE', 409);
    }
    return {
      workspaceId: row.workspace_id,
      projectId: row.project_id,
      albumState: row.state,
      projectStatus: row.project_status,
    };
  }

  async getProject(projectId: string) {
    const project = z.uuid().parse(projectId);
    const row = await this.db
      .prepare(
        'SELECT COALESCE(c.minimum,1) AS minimum,c.maximum,COALESCE(c.revision,0) AS revision,' +
          'COALESCE((SELECT MAX((SELECT count(*) FROM guest_selection_state st ' +
          'WHERE st.invite_id=r.invite_id AND st.guest_id=r.guest_id AND st.album_id=r.album_id)) ' +
          'FROM guest_selection_round_state r JOIN albums a ON a.id=r.album_id AND a.workspace_id=r.workspace_id AND a.project_id=r.project_id ' +
          'LEFT JOIN album_selection_policy_configurations ac ON ac.album_id=a.id ' +
          "WHERE r.project_id=p.id AND r.status='open' AND COALESCE(ac.configuration,'inherit')='inherit'),0) AS maxOpenSelectedCount " +
          'FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
          "AND s.expiresAt>unixepoch('subsec')*1000 " +
          'JOIN workspaces w ON w.owner_user_id=o.user_id ' +
          'JOIN projects p ON p.workspace_id=w.id ' +
          'LEFT JOIN project_selection_policy_configurations c ON c.project_id=p.id AND c.workspace_id=p.workspace_id ' +
          'WHERE o.user_id=? AND o.enabled=1 AND p.id=?',
      )
      .bind(this.session, this.actor, project)
      .first<ProjectReadRow>();
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }
    return ownerProjectSelectionConfigurationReadSchema.parse({
      projectId: project,
      minimum: row.minimum,
      maximum: row.maximum,
      revision: row.revision,
      maxOpenSelectedCount: row.maxOpenSelectedCount,
    });
  }

  async getAlbum(albumId: string) {
    const album = z.uuid().parse(albumId);
    const row = await this.db
      .prepare(
        "SELECT a.project_id AS projectId,COALESCE(ac.configuration,'inherit') AS configuration," +
          'ep.minimum,ep.maximum,ep.revision,ep.project_revision AS projectRevision,' +
          'ep.album_revision AS albumRevision,ep.source,' +
          'COALESCE((SELECT MAX((SELECT count(*) FROM guest_selection_state st ' +
          'WHERE st.invite_id=r.invite_id AND st.guest_id=r.guest_id AND st.album_id=r.album_id)) ' +
          "FROM guest_selection_round_state r WHERE r.album_id=a.id AND r.status='open'),0) AS maxOpenSelectedCount " +
          'FROM owners o JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
          "AND s.expiresAt>unixepoch('subsec')*1000 " +
          'JOIN workspaces w ON w.owner_user_id=o.user_id ' +
          'JOIN albums a ON a.workspace_id=w.id ' +
          'JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id ' +
          'JOIN effective_selection_policy ep ON ep.album_id=a.id ' +
          'LEFT JOIN album_selection_policy_configurations ac ON ac.album_id=a.id ' +
          'WHERE o.user_id=? AND o.enabled=1 AND a.id=?',
      )
      .bind(this.session, this.actor, album)
      .first<AlbumReadRow & { projectId: string }>();
    if (!row) {
      await this.assertCurrentOwner();
      throw new WorkspaceFailure('NOT_FOUND', 404);
    }
    return ownerAlbumSelectionConfigurationReadSchema.parse({
      albumId: album,
      projectId: row.projectId,
      configuration: row.configuration,
      policy: {
        minimum: row.minimum,
        maximum: row.maximum,
        mode: 'private',
        source: row.source,
        projectRevision: row.projectRevision,
        albumRevision: row.albumRevision,
      },
      maxOpenSelectedCount: row.maxOpenSelectedCount,
    });
  }

  async setProject(projectId: string, input: unknown) {
    const project = z.uuid().parse(projectId);
    const request = setProjectSelectionConfigurationSchema.parse(input);
    const scope = await this.authorizeProject(project, true);
    const payload = JSON.stringify({
      projectId: project,
      expectedRevision: request.expectedRevision,
      minimum: request.minimum,
      maximum: request.maximum,
      confirm: true,
    });
    await this.insertCommand({
      requestId: request.requestId,
      targetType: 'project',
      workspaceId: scope.workspaceId,
      projectId: project,
      albumId: null,
      expectedProjectRevision: request.expectedRevision,
      expectedAlbumRevision: null,
      configuration: null,
      minimum: request.minimum,
      maximum: request.maximum,
      payload,
      legacyPayload: null,
    });
    const raw = await this.readCommandResult(
      request.requestId,
      'project',
      project,
      null,
      payload,
      null,
    );
    return parseResult(raw, setProjectSelectionConfigurationResultSchema);
  }

  async setAlbum(albumId: string, input: unknown) {
    return this.setAlbumInternal(albumId, input, null);
  }

  private async setAlbumInternal(
    albumId: string,
    input: unknown,
    legacyPayload: string | null,
  ) {
    const album = z.uuid().parse(albumId);
    const request = setAlbumSelectionConfigurationSchema.parse(input);
    const scope = await this.authorizeAlbum(album, true);
    const payload =
      request.configuration === 'inherit'
        ? JSON.stringify({
            albumId: album,
            expectedAlbumRevision: request.expectedAlbumRevision,
            expectedProjectRevision: request.expectedProjectRevision,
            configuration: 'inherit',
            confirm: true,
          })
        : JSON.stringify({
            albumId: album,
            expectedAlbumRevision: request.expectedAlbumRevision,
            expectedProjectRevision: request.expectedProjectRevision,
            configuration: 'override',
            minimum: request.minimum,
            maximum: request.maximum,
            confirm: true,
          });
    await this.insertCommand({
      requestId: request.requestId,
      targetType: 'album',
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      albumId: album,
      expectedProjectRevision: request.expectedProjectRevision,
      expectedAlbumRevision: request.expectedAlbumRevision,
      configuration: request.configuration,
      minimum: request.configuration === 'override' ? request.minimum : null,
      maximum: request.configuration === 'override' ? request.maximum : null,
      payload,
      legacyPayload,
    });
    const raw = await this.readCommandResult(
      request.requestId,
      'album',
      scope.projectId,
      album,
      payload,
      legacyPayload,
    );
    return parseResult(raw, setAlbumSelectionConfigurationResultSchema);
  }

  private async insertCommand(input: {
    requestId: string;
    targetType: 'project' | 'album';
    workspaceId: string;
    projectId: string;
    albumId: string | null;
    expectedProjectRevision: number;
    expectedAlbumRevision: number | null;
    configuration: 'inherit' | 'override' | null;
    minimum: number | null;
    maximum: number | null;
    payload: string;
    legacyPayload: string | null;
  }): Promise<void> {
    try {
      await this.db
        .prepare(
          'INSERT OR IGNORE INTO selection_policy_configuration_commands(' +
            'id,actor_id,session_id,request_id,target_type,workspace_id,project_id,album_id,' +
            'expected_project_revision,expected_album_revision,configuration,minimum,maximum,' +
            'payload_json,legacy_payload_json,created_at_ms' +
            ') VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          this.actor,
          this.session,
          input.requestId,
          input.targetType,
          input.workspaceId,
          input.projectId,
          input.albumId,
          input.expectedProjectRevision,
          input.expectedAlbumRevision,
          input.configuration,
          input.minimum,
          input.maximum,
          input.payload,
          input.legacyPayload,
          Date.now(),
        )
        .run();
    } catch (error) {
      sqlFailure(error);
    }
  }

  private async readCommandResult(
    requestId: string,
    targetType: 'project' | 'album',
    projectId: string,
    albumId: string | null,
    payload: string,
    legacyPayload: string | null,
  ): Promise<string | null> {
    const row = await this.db
      .prepare(
        'SELECT r.result_json AS resultJson FROM selection_policy_configuration_commands c ' +
          'JOIN selection_policy_configuration_results r ON r.command_id=c.id ' +
          'JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 ' +
          'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
          "AND s.expiresAt>unixepoch('subsec')*1000 " +
          'JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=o.user_id ' +
          'JOIN projects p ON p.id=c.project_id AND p.workspace_id=w.id ' +
          "AND p.status NOT IN('archived','deleting','deleted') " +
          'LEFT JOIN albums a ON a.id=c.album_id AND a.workspace_id=w.id AND a.project_id=p.id ' +
          'WHERE c.actor_id=? AND c.request_id=? AND c.target_type=? AND c.project_id=? ' +
          'AND c.album_id IS ? AND c.payload_json=? AND c.legacy_payload_json IS ? ' +
          "AND (c.target_type='project' OR a.state IN('active','draft'))",
      )
      .bind(
        this.session,
        this.actor,
        requestId,
        targetType,
        projectId,
        albumId,
        payload,
        legacyPayload,
      )
      .first<{ resultJson: string }>();
    if (!row) {
      if (targetType === 'project')
        await this.authorizeProject(projectId, true);
      else if (albumId) await this.authorizeAlbum(albumId, true);
      throw new WorkspaceFailure(
        'SELECTION_POLICY_CONFIGURATION_UNAVAILABLE',
        503,
      );
    }
    return row.resultJson;
  }

  async setLegacyAlbum(albumId: string, input: unknown) {
    const album = z.uuid().parse(albumId);
    const request = setSelectionPolicySchema.parse(input);
    await this.authorizeAlbum(album, true);
    const legacy = legacyPayload(album, request);

    // Old 0028 commitments are replayed verbatim before any current-policy read.
    const old = await this.db
      .prepare(
        'SELECT c.album_id AS albumId,c.payload_json AS payloadJson,r.result_json AS resultJson ' +
          'FROM selection_policy_commands c LEFT JOIN selection_policy_results r ON r.command_id=c.id ' +
          'JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 ' +
          'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
          "AND s.expiresAt>unixepoch('subsec')*1000 " +
          'JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=o.user_id ' +
          'JOIN projects p ON p.id=c.project_id AND p.workspace_id=w.id ' +
          "AND p.status NOT IN('archived','deleting','deleted') " +
          'JOIN albums a ON a.id=c.album_id AND a.project_id=p.id AND a.workspace_id=w.id ' +
          "AND a.state IN('active','draft') " +
          'WHERE c.actor_id=? AND c.request_id=?',
      )
      .bind(this.session, this.actor, request.requestId)
      .first<{
        albumId: string;
        payloadJson: string;
        resultJson: string | null;
      }>();
    if (old) {
      if (old.albumId !== album || old.payloadJson !== legacy)
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      return parseResult(old.resultJson, setSelectionPolicyResultSchema);
    }

    // New legacy API writes retain their original strict body as a server-made commitment.
    const currentLegacy = await this.db
      .prepare(
        'SELECT c.target_type AS targetType,c.album_id AS albumId,' +
          'c.legacy_payload_json AS legacyPayloadJson,r.result_json AS resultJson ' +
          'FROM selection_policy_configuration_commands c ' +
          'LEFT JOIN selection_policy_configuration_results r ON r.command_id=c.id ' +
          'JOIN owners o ON o.user_id=c.actor_id AND o.enabled=1 ' +
          'JOIN owner_sessions s ON s.userId=o.user_id AND s.id=? ' +
          "AND s.expiresAt>unixepoch('subsec')*1000 " +
          'JOIN workspaces w ON w.id=c.workspace_id AND w.owner_user_id=o.user_id ' +
          'JOIN projects p ON p.id=c.project_id AND p.workspace_id=w.id ' +
          "AND p.status NOT IN('archived','deleting','deleted') " +
          'JOIN albums a ON a.id=c.album_id AND a.project_id=p.id AND a.workspace_id=w.id ' +
          "AND a.state IN('active','draft') " +
          'WHERE c.actor_id=? AND c.request_id=?',
      )
      .bind(this.session, this.actor, request.requestId)
      .first<{
        targetType: 'project' | 'album';
        albumId: string | null;
        legacyPayloadJson: string | null;
        resultJson: string | null;
      }>();
    if (currentLegacy) {
      if (
        currentLegacy.targetType !== 'album' ||
        currentLegacy.albumId !== album ||
        currentLegacy.legacyPayloadJson !== legacy
      ) {
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      }
      return toLegacyResult(album, currentLegacy.resultJson);
    }

    const current = await this.getAlbum(album);
    const v2Request = setAlbumSelectionConfigurationSchema.parse({
      requestId: request.requestId,
      expectedAlbumRevision: request.expectedRevision,
      expectedProjectRevision: current.policy.projectRevision,
      configuration: 'override',
      minimum: request.minimum,
      maximum: request.maximum,
      confirm: true,
    });
    const result = await this.setAlbumInternal(album, v2Request, legacy);
    return setSelectionPolicyResultSchema.parse({
      policy: {
        albumId: album,
        minimum: result.configuration.policy.minimum,
        maximum: result.configuration.policy.maximum,
        revision: result.configuration.policy.albumRevision,
        mode: 'private',
      },
      eventId: result.eventId,
      occurredAt: result.occurredAt,
    });
  }
}

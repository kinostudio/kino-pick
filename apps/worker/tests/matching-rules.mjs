import assert from 'node:assert/strict';
import { activateDraftAlbumFixture } from './activate-album-fixture.mjs';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { makeSignature } from 'better-auth/crypto';
import { D1ImageProcessingRepository } from '../src/processing-jobs.ts';
import { R2ProcessingObjectStore } from '../../../packages/image-processing/src/r2-processing-store.ts';
import { LocalSharpImageProcessor } from '../../../packages/image-processing/src/local-sharp.ts';
import { runImageProcessingJob } from '../../../packages/image-processing/src/durable-runner.ts';
import { appendAuthorizedVersionFixture } from './authorized-version-fixture.mjs';
import { runMatchingRulesBrowserChecks } from './matching-rules-browser.mjs';

const PROFILE_IDS = [
  'default-v1',
  'rules-v1-001',
  'rules-v1-010',
  'rules-v1-011',
  'rules-v1-100',
  'rules-v1-101',
  'rules-v1-110',
  'rules-v1-111',
];
const RULES = {
  'default-v1': {
    caseSensitive: true,
    allowJpgJpegEquivalence: false,
    stripRecognizedSuffixes: false,
  },
  'rules-v1-001': {
    caseSensitive: true,
    allowJpgJpegEquivalence: false,
    stripRecognizedSuffixes: true,
  },
  'rules-v1-010': {
    caseSensitive: true,
    allowJpgJpegEquivalence: true,
    stripRecognizedSuffixes: false,
  },
  'rules-v1-011': {
    caseSensitive: true,
    allowJpgJpegEquivalence: true,
    stripRecognizedSuffixes: true,
  },
  'rules-v1-100': {
    caseSensitive: false,
    allowJpgJpegEquivalence: false,
    stripRecognizedSuffixes: false,
  },
  'rules-v1-101': {
    caseSensitive: false,
    allowJpgJpegEquivalence: false,
    stripRecognizedSuffixes: true,
  },
  'rules-v1-110': {
    caseSensitive: false,
    allowJpgJpegEquivalence: true,
    stripRecognizedSuffixes: false,
  },
  'rules-v1-111': {
    caseSensitive: false,
    allowJpgJpegEquivalence: true,
    stripRecognizedSuffixes: true,
  },
};
const PAGE_LIMIT = 24;
const SYNTHETIC_HISTORY_COUNT = 1001;
const RESOLVED = '/api/v1/albums/';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function bodyOf(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function runMatchingRulesChecks({
  db,
  mf,
  check,
  owner,
  base,
  cookies,
  galleryFixture,
  request,
  authSecret,
}) {
  assert.ok(db && mf && check && owner && base && cookies && request);
  assert.ok(
    typeof authSecret === 'string' && Buffer.byteLength(authSecret) >= 32,
  );
  const workspaceId = galleryFixture?.context?.workspace?.id;
  assert.ok(workspaceId, 'Reuse the existing full-suite gallery workspace');

  const worker = await mf.getWorker('matching-rules-test');
  const catalogWorker = await mf.getWorker('assisted-candidate-catalog-test');
  const defaultWorker = await mf.getWorker('app');
  const storage = galleryFixture.storage;
  assert.ok(storage, 'The actual local R2 fixture binding is required');
  const ownerCookie = cookies.headers();
  const ownerHeaders = {
    Accept: 'application/json',
    Cookie: ownerCookie,
    Origin: new URL(base).origin,
    'Content-Type': 'application/json',
    'X-Kino-Expected-Actor': owner,
  };
  const processingJobs = new D1ImageProcessingRepository(db);
  const processingObjects = new R2ProcessingObjectStore(storage);
  const imageProcessor = new LocalSharpImageProcessor();
  const unissuedSessions = new Set();

  const send = (target, method, path, body, overrides = {}) => {
    const headers = { ...ownerHeaders, ...overrides };
    for (const [name, value] of Object.entries(headers))
      if (value === undefined) delete headers[name];
    const init = { method, headers, redirect: 'manual' };
    if (body !== undefined) init.body = JSON.stringify(body);
    return target.fetch(new Request(new URL(path, base), init));
  };
  const read = async (target, method, path, body, overrides = {}) => {
    const response = await send(target, method, path, body, overrides);
    return { response, body: await bodyOf(response) };
  };
  const expectCode = async (
    target,
    method,
    path,
    body,
    status,
    code,
    overrides,
  ) => {
    const result = await read(target, method, path, body, overrides);
    assert.equal(result.response.status, status, JSON.stringify(result.body));
    assert.equal(result.body?.error?.code, code, JSON.stringify(result.body));
    return result.body;
  };
  const first = (sql, ...values) =>
    db
      .prepare(sql)
      .bind(...values)
      .first();
  const all = async (sql, ...values) => {
    const result = await db
      .prepare(sql)
      .bind(...values)
      .all();
    assert.equal(result.success, true);
    return result.results;
  };
  const count = async (sql, ...values) =>
    Number((await first(sql, ...values))?.n ?? 0);
  const sessionIdForCookie = async (cookieHeader = ownerCookie) => {
    const entry = String(cookieHeader)
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('kino-owner.session_token='));
    assert.ok(entry, 'Owner cookie contains the signed session token');
    const signed = decodeURIComponent(entry.slice(entry.indexOf('=') + 1));
    const separator = signed.lastIndexOf('.');
    assert.ok(separator > 0, 'Owner cookie token is signed');
    const session = await first(
      'SELECT id FROM owner_sessions WHERE token=? AND userId=?',
      signed.slice(0, separator),
      owner,
    );
    assert.ok(session?.id, 'Owner cookie maps to a current D1 session');
    return session.id;
  };
  const rulesPath = (project) =>
    '/api/v1/projects/' + encodeURIComponent(project.id) + '/matching-rules';
  const versioningPath = (project) =>
    '/api/v1/projects/' + encodeURIComponent(project.id) + '/versioning';
  const indexPath = (album) =>
    RESOLVED + encodeURIComponent(album.id) + '/matching-rule-index';
  const previewPath = (album) =>
    RESOLVED + encodeURIComponent(album.id) + '/upload-resolution';
  const reservePath = (album) =>
    RESOLVED + encodeURIComponent(album.id) + '/resolved-uploads';

  const createProject = async (label, mode = 'auto_filename') => {
    const created = await read(worker, 'POST', '/api/v1/projects', {
      requestId: randomUUID(),
      workspaceId,
      name: 'Matching rules ' + label + ' ' + randomUUID(),
    });
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const project = created.body.project;
    assert.ok(project?.id);
    const current = await read(worker, 'GET', versioningPath(project));
    assert.equal(current.response.status, 200, JSON.stringify(current.body));
    const changed = await read(worker, 'PUT', versioningPath(project), {
      requestId: randomUUID(),
      expectedRevision: current.body.revision,
      mode,
      confirm: true,
    });
    assert.equal(changed.response.status, 200, JSON.stringify(changed.body));
    return {
      ...project,
      workspaceId,
      revision: changed.body.revision,
      mode: changed.body.mode,
    };
  };
  const createAlbum = async (project, label, activate = true) => {
    const created = await read(
      worker,
      'POST',
      '/api/v1/projects/' + encodeURIComponent(project.id) + '/albums',
      { requestId: randomUUID(), name: 'Matching album ' + label },
    );
    assert.equal(created.response.status, 201, JSON.stringify(created.body));
    const album = created.body.album;
    assert.ok(album?.id);
    if (activate) await activateDraftAlbumFixture(db, album.id);
    assert.deepEqual(
      await first('SELECT state FROM albums WHERE id=?', album.id),
      { state: activate ? 'active' : 'draft' },
    );
    return album;
  };
  const readRules = async (project, target = worker, overrides = {}) => {
    const result = await read(
      target,
      'GET',
      rulesPath(project),
      undefined,
      overrides,
    );
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const setRules = async (
    project,
    current,
    profile,
    requestId = randomUUID(),
    target = worker,
    overrides = {},
  ) => {
    const input = {
      requestId,
      expectedProjectRevision: current.projectRevision,
      expectedRuleRevision: current.ruleRevision,
      profile,
      confirm: true,
    };
    const result = await read(
      target,
      'PUT',
      rulesPath(project),
      input,
      overrides,
    );
    return { ...result, input };
  };
  const readIndex = async (album, target = worker, overrides = {}) =>
    read(target, 'GET', indexPath(album), undefined, overrides);
  const advanceIndex = async (album, status, target = worker, overrides = {}) =>
    read(
      target,
      'POST',
      indexPath(album),
      {
        expectedProjectRevision: status.projectRevision,
        expectedRuleRevision: status.ruleRevision,
        profile: status.profile,
      },
      overrides,
    );
  const advanceAll = async (album) => {
    let status = await readIndex(album);
    assert.equal(status.response.status, 200, JSON.stringify(status.body));
    let maxRows = 0;
    let advances = 0;
    const cap =
      Math.ceil(
        (status.body.indexedSessions + status.body.missingSessions) /
          PAGE_LIMIT,
      ) + 2;
    while (status.body.missingSessions > 0) {
      assert.ok(advances < cap, 'Profile index advances remain bounded');
      const previous = status.body.missingSessions;
      status = await advanceIndex(album, status.body);
      assert.equal(status.response.status, 200, JSON.stringify(status.body));
      const inserted = previous - status.body.missingSessions;
      assert.ok(inserted > 0 && inserted <= PAGE_LIMIT);
      maxRows = Math.max(maxRows, inserted);
      advances++;
    }
    return { ...status.body, maxRows, advances };
  };
  const profileIndexCounts = async (albumId, profile) => ({
    legacy: await count(
      'SELECT count(*) AS n FROM matching_filename_index WHERE album_id=? AND profile=?',
      albumId,
      'default-v1',
    ),
    rules: await count(
      'SELECT count(*) AS n FROM matching_rule_filename_index WHERE album_id=? AND profile=?',
      albumId,
      profile,
    ),
    allRules: await count(
      'SELECT count(*) AS n FROM matching_rule_filename_index WHERE album_id=?',
      albumId,
    ),
  });
  const makePng = (width, height, background) =>
    sharp({ create: { width, height, channels: 3, background } })
      .png()
      .toBuffer();
  const makeJpeg = (width, height, background) =>
    sharp({ create: { width, height, channels: 3, background } })
      .jpeg({ quality: 88 })
      .toBuffer();
  const imageFile = async (
    originalFilename,
    bytes,
    contentType = 'image/png',
  ) => {
    const metadata = await sharp(bytes).metadata();
    assert.ok(metadata.width && metadata.height);
    return {
      originalFilename,
      expectedBytes: bytes.byteLength,
      contentType,
      sha256: sha256(bytes),
      dimensions: { width: metadata.width, height: metadata.height },
      bytes,
    };
  };
  const fileEvidence = (file, overrides = {}) => ({
    originalFilename: file.originalFilename,
    expectedBytes: file.expectedBytes,
    contentType: file.contentType,
    sha256: file.sha256,
    dimensions: file.dimensions,
    ...overrides,
  });
  const reserveOrdinary = async (project, album, file, target = worker) => {
    const result = await read(
      target,
      'POST',
      '/api/v1/uploads/init',
      ordinaryInitBody(project, album, file),
    );
    assert.equal(result.response.status, 201, JSON.stringify(result.body));
    assert.ok(result.body.uploadSession?.id);
    unissuedSessions.add(result.body.uploadSession.id);
    return result.body.uploadSession;
  };
  const ordinaryInitBody = (
    project,
    album,
    file,
    requestId = randomUUID(),
  ) => ({
    requestId,
    workspaceId,
    projectId: project.id,
    albumId: album.id,
    originalFilename: file.originalFilename,
    expectedBytes: file.expectedBytes,
    contentType: file.contentType,
    sha256: file.sha256,
  });
  const completeReservedUpload = async (sessionId, file) => {
    await authorizeAndPut(sessionId, file);
    const completed = await read(
      worker,
      'POST',
      '/api/v1/uploads/' + encodeURIComponent(sessionId) + '/complete',
      { requestId: randomUUID() },
    );
    assert.equal(
      completed.response.status,
      200,
      JSON.stringify(completed.body),
    );
    assert.equal(completed.body.completion?.status, 'completed');
    unissuedSessions.delete(sessionId);
    await processVersion(completed.body.completion);
    return { session: { id: sessionId }, ...completed.body.completion };
  };
  const uploadOrdinary = async (project, album, file) => {
    const session = await reserveOrdinary(project, album, file);
    return completeReservedUpload(session.id, file);
  };
  const authorizeAndPut = async (sessionId, file, target = worker) => {
    const authorization = await read(
      target,
      'POST',
      '/api/v1/uploads/' + encodeURIComponent(sessionId) + '/authorize',
      { requestId: randomUUID() },
    );
    assert.equal(
      authorization.response.status,
      200,
      JSON.stringify(authorization.body),
    );
    assert.equal(
      authorization.body.uploadAuthorization?.contentLength,
      file.bytes.byteLength,
    );
    const row = await first(
      'SELECT object_key FROM upload_sessions WHERE id=?',
      sessionId,
    );
    assert.ok(row?.object_key);
    const stored = await storage.put(
      row.object_key,
      new Uint8Array(file.bytes),
      {
        onlyIf: { etagDoesNotMatch: '*' },
        httpMetadata: { contentType: file.contentType },
        sha256: Buffer.from(file.sha256, 'hex'),
      },
    );
    assert.ok(stored, 'The actual local R2 write was create-once');
  };
  const processVersion = async (completion) => {
    assert.ok(completion?.assetId && completion?.versionId);
    const processed = await runImageProcessingJob({
      jobId: completion.assetId,
      jobs: processingJobs,
      objects: processingObjects,
      processor: imageProcessor,
    });
    assert.equal(processed.status, 'succeeded');
    assert.deepEqual(
      await first(
        'SELECT status FROM image_processing_jobs WHERE id=?',
        completion.assetId,
      ),
      { status: 'succeeded' },
    );
    const derivatives = await all(
      "SELECT asset_kind FROM photo_assets WHERE version_id=? AND asset_kind IN('thumbnail','preview') ORDER BY asset_kind",
      completion.versionId,
    );
    assert.deepEqual(
      derivatives.map((row) => row.asset_kind),
      ['preview', 'thumbnail'],
    );
  };
  const uploadVersion = async (photoId, file) => {
    const head = await first(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      photoId,
    );
    assert.ok(head?.version_id);
    const initialized = await read(
      worker,
      'POST',
      '/api/v1/photos/' + photoId + '/versions/init',
      {
        requestId: randomUUID(),
        originalFilename: file.originalFilename,
        expectedBytes: file.expectedBytes,
        contentType: file.contentType,
        sha256: file.sha256,
        expectedRevision: head.revision,
        expectedCurrentVersionId: head.version_id,
        changeType: 'replace_current',
        changeNote: 'Matching rules actual R2 history fixture',
        labels: [],
        confirm: true,
      },
    );
    assert.equal(
      initialized.response.status,
      201,
      JSON.stringify(initialized.body),
    );
    const session = initialized.body.uploadSession;
    assert.ok(session?.id);
    unissuedSessions.add(session.id);
    await authorizeAndPut(session.id, file);
    const completed = await read(
      worker,
      'POST',
      '/api/v1/photos/' +
        photoId +
        '/versions/' +
        encodeURIComponent(session.id) +
        '/complete',
      { requestId: randomUUID() },
    );
    assert.equal(
      completed.response.status,
      200,
      JSON.stringify(completed.body),
    );
    assert.equal(completed.body.status, 'completed');
    unissuedSessions.delete(session.id);
    await processVersion(completed.body);
    const current = await first(
      'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
      photoId,
    );
    if (current?.version_id !== completed.body.versionId) {
      const switched = await read(
        worker,
        'POST',
        '/api/v1/photos/' + photoId + '/versions/set-current',
        {
          requestId: randomUUID(),
          expectedRevision: current.revision,
          expectedCurrentVersionId: current.version_id,
          versionId: completed.body.versionId,
          confirm: true,
        },
      );
      assert.equal(
        switched.response.status,
        200,
        JSON.stringify(switched.body),
      );
    }
    return { session, ...completed.body };
  };
  const cancelUnissued = async (sessionId, overrides = {}) => {
    if (!unissuedSessions.has(sessionId)) return;
    const result = await read(
      worker,
      'POST',
      '/api/v1/uploads/' + encodeURIComponent(sessionId) + '/cancel',
      { requestId: randomUUID() },
      overrides,
    );
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    unissuedSessions.delete(sessionId);
  };
  const uploadResolutionPreview = async (album, file, target = worker) => {
    const result = await read(target, 'POST', previewPath(album), {
      file: fileEvidence(file),
    });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const selectedChoice = (preview, photoId) => {
    const candidate = preview.candidates.find(
      (item) => item.photoId === photoId,
    );
    assert.ok(
      candidate?.currentVersionId,
      'Candidate has a current published head',
    );
    return {
      kind: 'new_version',
      photoId: candidate.photoId,
      parentVersionId: candidate.currentVersionId,
      expectedRevision: candidate.revision,
    };
  };
  const reserveResolvedBody = (
    preview,
    file,
    choice,
    requestId = randomUUID(),
  ) => ({
    requestId,
    file: fileEvidence(file),
    expectedChangeSequence: preview.changeSequence,
    expectedProjectRevision: preview.projectRevision,
    expectedMode: preview.mode,
    ...(preview.matchingProfile
      ? { matchingProfile: preview.matchingProfile }
      : {}),
    choice,
    confirm: true,
  });
  const resolvedRequestPayload = (
    project,
    album,
    preview,
    file,
    choice,
    includeMatchingProfile,
  ) => ({
    workspaceId,
    projectId: project.id,
    albumId: album.id,
    originalFilename: file.originalFilename,
    expectedBytes: file.expectedBytes,
    contentType: file.contentType,
    sha256: file.sha256,
    ...(choice.kind === 'new_version'
      ? {
          versionTarget: {
            photoId: choice.photoId,
            parentVersionId: choice.parentVersionId,
            expectedRevision: choice.expectedRevision,
            changeType: 'new_retouch',
            changeNote: '',
            labels: [],
            confirm: true,
          },
        }
      : {}),
    resolution: {
      expectedChangeSequence: preview.changeSequence,
      expectedProjectRevision: preview.projectRevision,
      expectedMode: preview.mode,
      choice,
      dimensions: file.dimensions,
      confirm: true,
      ...(includeMatchingProfile && preview.matchingProfile
        ? { matchingProfile: preview.matchingProfile }
        : {}),
    },
  });
  const tableSnapshot = async (album, project) => ({
    commands: await all(
      'SELECT id,actor_id,session_id,request_id,expected_project_revision,expected_rule_revision,before_profile,profile,payload_json FROM project_matching_rule_commands WHERE project_id=? ORDER BY created_at_ms,id',
      project.id,
    ),
    results: await all(
      'SELECT command_id,event_id,before_json,after_json,result_json FROM project_matching_rule_results WHERE command_id IN (SELECT id FROM project_matching_rule_commands WHERE project_id=?) ORDER BY command_id',
      project.id,
    ),
    head: await first(
      'SELECT project_id,workspace_id,profile,revision,command_id FROM project_matching_rule_heads WHERE project_id=?',
      project.id,
    ),
    requests: await all(
      'SELECT actor_id,request_id,operation,payload_json,upload_session_id,expected_bytes FROM upload_requests WHERE project_id=? ORDER BY request_id',
      project.id,
    ),
    sessions: await all(
      'SELECT id,status,original_filename,expected_bytes,project_id,album_id FROM upload_sessions WHERE project_id=? ORDER BY id',
      project.id,
    ),
    specs: await all(
      'SELECT s.upload_session_id,s.content_type,s.sha256_hex,s.created_at_ms FROM upload_specs s JOIN upload_sessions u ON u.id=s.upload_session_id WHERE u.project_id=? ORDER BY s.upload_session_id',
      project.id,
    ),
    defaultIndex: await all(
      'SELECT upload_session_id,workspace_id,project_id,album_id,original_filename,profile,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE album_id=? ORDER BY upload_session_id,profile',
      album.id,
    ),
    ruleIndex: await all(
      'SELECT upload_session_id,workspace_id,project_id,album_id,original_filename,profile,canonical_basename,canonical_extension,is_invalid FROM matching_rule_filename_index WHERE album_id=? ORDER BY upload_session_id,profile',
      album.id,
    ),
    usage: await first(
      'SELECT used_bytes,reserved_bytes FROM workspace_storage_usage WHERE workspace_id=?',
      workspaceId,
    ),
    storageNode: await first(
      "SELECT id,used_bytes,reserved_bytes FROM storage_nodes WHERE id='primary'",
    ),
    audit: await all(
      'SELECT event_id,action,request_id,before_json,after_json FROM audit_events WHERE actor_id=? AND project_id=? ORDER BY event_id',
      owner,
      project.id,
    ),
    changes: await all(
      'SELECT sequence,kind,source_id,source_revision,source_state,created_at_ms FROM album_matching_changes WHERE album_id=? ORDER BY sequence',
      album.id,
    ),
  });

  let project;
  let album;
  let uiProject;
  let uiAlbum;
  let siblingProject;
  let legacyProject;
  let legacyAlbum;
  let catalogProject;
  let catalogAlbum;
  let legacyReservationRequestId;
  const real = Object.create(null);
  let uiSource;
  let uiProfile;
  let browserResult;

  try {
    await check(
      'matching rules capability is opt-in and profile GET begins at default-v1 revision zero',
      async () => {
        const enabled = await read(
          worker,
          'GET',
          '/api/v1/matching-rules/capabilities',
        );
        assert.equal(
          enabled.response.status,
          200,
          JSON.stringify(enabled.body),
        );
        assert.deepEqual(enabled.body, { enabled: true });
        const off = await read(
          defaultWorker,
          'GET',
          '/api/v1/matching-rules/capabilities',
        );
        assert.equal(off.response.status, 200, JSON.stringify(off.body));
        assert.deepEqual(off.body, { enabled: false });
        const catalogOffRules = await read(
          catalogWorker,
          'GET',
          '/api/v1/matching-rules/capabilities',
        );
        assert.equal(
          catalogOffRules.response.status,
          200,
          JSON.stringify(catalogOffRules.body),
        );
        assert.deepEqual(catalogOffRules.body, { enabled: false });

        project = await createProject('api');
        album = await createAlbum(project, 'api');
        siblingProject = await createProject('sibling');
        legacyProject = await createProject('legacy-default');
        legacyAlbum = await createAlbum(
          legacyProject,
          'legacy-default-draft-compatibility',
          false,
        );
        catalogProject = await createProject('catalog', 'assisted');
        catalogAlbum = await createAlbum(catalogProject, 'catalog');
        const initial = await readRules(project);
        assert.equal(initial.profile, 'default-v1');
        assert.equal(initial.ruleRevision, 0);
        assert.equal(initial.projectRevision, project.revision);
        assert.deepEqual(initial.rules, RULES['default-v1']);
        assert.deepEqual(
          Object.keys(initial).sort(),
          [
            'mode',
            'profile',
            'projectId',
            'projectRevision',
            'ruleRevision',
            'rules',
            'workspaceId',
          ].sort(),
        );
        const sibling = await readRules(siblingProject);
        assert.equal(sibling.profile, 'default-v1');
        assert.equal(sibling.ruleRevision, 0);
      },
    );

    await check(
      'draft albums preserve frozen six-field replay through the legacy worker and accept current seven-field intents after enabling rules',
      async () => {
        assert.deepEqual(
          await first('SELECT state FROM albums WHERE id=?', legacyAlbum.id),
          { state: 'draft' },
        );
        const source = await imageFile(
          'LegacyDefaultSource.png',
          await makePng(32, 24, '#49708b'),
        );
        await uploadOrdinary(legacyProject, legacyAlbum, source);
        const incoming = await imageFile(
          'LegacyReservation.png',
          await makePng(32, 24, '#8c6a43'),
        );
        const preview = await uploadResolutionPreview(
          legacyAlbum,
          incoming,
          catalogWorker,
        );
        assert.equal(preview.mode, 'auto_filename');
        assert.equal(preview.decision.outcome, 'new_photo');
        assert.equal(preview.matchingProfile, undefined);
        const body = reserveResolvedBody(preview, incoming, {
          kind: 'new_photo',
        });
        assert.equal(body.matchingProfile, undefined);
        legacyReservationRequestId = body.requestId;
        const reserved = await read(
          catalogWorker,
          'POST',
          reservePath(legacyAlbum),
          body,
        );
        assert.equal(
          reserved.response.status,
          201,
          JSON.stringify(reserved.body),
        );
        assert.equal(reserved.body.target.kind, 'new_photo');
        const uploadSessionId = reserved.body.uploadSession?.id;
        assert.ok(uploadSessionId);
        unissuedSessions.add(uploadSessionId);
        const persisted = await first(
          'SELECT payload_json FROM upload_requests WHERE actor_id=? AND request_id=?',
          owner,
          body.requestId,
        );
        assert.ok(persisted);
        const canonicalPayload = JSON.parse(persisted.payload_json);
        assert.equal(
          Object.keys(canonicalPayload.resolution).length,
          6,
          'The persisted legacy intent retains exactly its original six resolution fields',
        );
        assert.equal(canonicalPayload.resolution.matchingProfile, undefined);

        const legacyRules = await readRules(legacyProject);
        const changed = await setRules(
          legacyProject,
          legacyRules,
          'rules-v1-100',
        );
        assert.equal(
          changed.response.status,
          200,
          JSON.stringify(changed.body),
        );
        assert.equal(changed.body.changed, true);
        const beforeReplay = await tableSnapshot(legacyAlbum, legacyProject);
        const replay = await read(
          catalogWorker,
          'POST',
          reservePath(legacyAlbum),
          body,
        );
        assert.equal(replay.response.status, 201, JSON.stringify(replay.body));
        assert.deepEqual(replay.body, reserved.body);
        assert.deepEqual(
          await tableSnapshot(legacyAlbum, legacyProject),
          beforeReplay,
        );

        await cancelUnissued(uploadSessionId);
        const ready = await advanceAll(legacyAlbum);
        assert.equal(ready.state, 'ready');
        const ruleAwareIncoming = await imageFile(
          'RuleAwareDraftReservation.png',
          await makePng(32, 24, '#4b8d67'),
        );
        const ruleAwarePreview = await uploadResolutionPreview(
          legacyAlbum,
          ruleAwareIncoming,
        );
        assert.equal(ruleAwarePreview.decision.outcome, 'new_photo');
        assert.deepEqual(ruleAwarePreview.matchingProfile, {
          profile: 'rules-v1-100',
          ruleRevision: changed.body.ruleRevision,
        });
        const ruleAwareBody = reserveResolvedBody(
          ruleAwarePreview,
          ruleAwareIncoming,
          { kind: 'new_photo' },
        );
        const ruleAwareReservation = await read(
          worker,
          'POST',
          reservePath(legacyAlbum),
          ruleAwareBody,
        );
        assert.equal(
          ruleAwareReservation.response.status,
          201,
          JSON.stringify(ruleAwareReservation.body),
        );
        assert.equal(ruleAwareReservation.body.target.kind, 'new_photo');
        const ruleAwareSessionId = ruleAwareReservation.body.uploadSession?.id;
        assert.ok(ruleAwareSessionId);
        unissuedSessions.add(ruleAwareSessionId);
        const ruleAwarePayload = await first(
          'SELECT payload_json FROM upload_requests WHERE actor_id=? AND request_id=?',
          owner,
          ruleAwareBody.requestId,
        );
        assert.equal(
          Object.keys(JSON.parse(ruleAwarePayload.payload_json).resolution)
            .length,
          7,
        );
        assert.deepEqual(
          await first('SELECT state FROM albums WHERE id=?', legacyAlbum.id),
          { state: 'draft' },
          'Both valid reservation branches preserve the draft album state',
        );
        await cancelUnissued(ruleAwareSessionId);

        const currentMainRules = await readRules(project);
        const mainBeforeConflict = await tableSnapshot(album, project);
        const legacyBeforeConflict = await tableSnapshot(
          legacyAlbum,
          legacyProject,
        );
        const collision = await read(worker, 'PUT', rulesPath(project), {
          requestId: legacyReservationRequestId,
          expectedProjectRevision: currentMainRules.projectRevision + 1,
          expectedRuleRevision: currentMainRules.ruleRevision + 1,
          profile: 'rules-v1-010',
          confirm: true,
        });
        assert.equal(
          collision.response.status,
          409,
          JSON.stringify(collision.body),
        );
        assert.equal(collision.body.error?.code, 'REQUEST_ID_CONFLICT');
        assert.deepEqual(
          await tableSnapshot(album, project),
          mainBeforeConflict,
        );
        assert.deepEqual(
          await tableSnapshot(legacyAlbum, legacyProject),
          legacyBeforeConflict,
        );
      },
    );

    await check(
      'the assisted catalog token becomes stale after A-to-B-to-A rule revisions without writing state',
      async () => {
        const incoming = await imageFile(
          'CatalogPolicy.png',
          await makePng(24, 16, '#786549'),
        );
        const preview = await uploadResolutionPreview(catalogAlbum, incoming);
        assert.equal(preview.mode, 'assisted');
        assert.equal(preview.decision.outcome, 'new_photo');
        assert.ok(preview.catalogCursor);
        const catalogPath =
          '/api/v1/albums/' +
          encodeURIComponent(catalogAlbum.id) +
          '/upload-candidates?cursor=' +
          encodeURIComponent(preview.catalogCursor);
        const firstPage = await read(worker, 'GET', catalogPath, undefined, {
          Origin: undefined,
        });
        assert.equal(
          firstPage.response.status,
          200,
          JSON.stringify(firstPage.body),
        );
        assert.equal(firstPage.body.projectId, catalogProject.id);
        assert.equal(firstPage.body.albumId, catalogAlbum.id);

        let current = await readRules(catalogProject);
        const a = await setRules(catalogProject, current, 'rules-v1-100');
        assert.equal(a.response.status, 200, JSON.stringify(a.body));
        current = await readRules(catalogProject);
        const b = await setRules(catalogProject, current, 'rules-v1-010');
        assert.equal(b.response.status, 200, JSON.stringify(b.body));
        current = await readRules(catalogProject);
        const backToA = await setRules(catalogProject, current, 'rules-v1-100');
        assert.equal(
          backToA.response.status,
          200,
          JSON.stringify(backToA.body),
        );
        const beforeStaleRead = await tableSnapshot(
          catalogAlbum,
          catalogProject,
        );
        await expectCode(
          worker,
          'GET',
          catalogPath,
          undefined,
          409,
          'RESOLUTION_CATALOG_STALE',
          { Origin: undefined },
        );
        assert.deepEqual(
          await tableSnapshot(catalogAlbum, catalogProject),
          beforeStaleRead,
        );
      },
    );

    await check(
      'all eight finite profiles map to strict, coherent rule tuples with CAS, no-op, ABA and exact replay',
      async () => {
        assert.deepEqual(PROFILE_IDS, Object.keys(RULES));
        const baselineAudit = await count(
          "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND project_id=? AND action='project.matching_rules_changed'",
          owner,
          project.id,
        );
        let current = await readRules(project);
        assert.deepEqual(current.rules, RULES['default-v1']);
        const firstRequest = randomUUID();
        let changedCount = 0;
        for (const profile of PROFILE_IDS.slice(1)) {
          const before = current;
          const result = await setRules(
            project,
            before,
            profile,
            profile === 'rules-v1-100' ? firstRequest : randomUUID(),
          );
          assert.equal(
            result.response.status,
            200,
            JSON.stringify(result.body),
          );
          assert.equal(result.body.profile, profile);
          assert.equal(result.body.changed, true);
          assert.ok(result.body.eventId);
          assert.equal(result.body.projectRevision, before.projectRevision + 1);
          assert.equal(result.body.ruleRevision, before.ruleRevision + 1);
          const readback = await readRules(project);
          assert.deepEqual(readback.rules, RULES[profile]);
          assert.equal(readback.projectRevision, result.body.projectRevision);
          assert.equal(readback.ruleRevision, result.body.ruleRevision);
          const command = await first(
            'SELECT id,actor_id,session_id,request_id,expected_project_revision,expected_rule_revision,profile FROM project_matching_rule_commands WHERE id=?',
            result.body.eventId,
          );
          assert.ok(command);
          assert.equal(command.actor_id, owner);
          assert.equal(command.request_id, result.input.requestId);
          assert.equal(
            command.expected_project_revision,
            before.projectRevision,
          );
          assert.equal(command.expected_rule_revision, before.ruleRevision);
          assert.equal(command.profile, profile);
          assert.equal(
            await count(
              'SELECT count(*) AS n FROM project_matching_rule_commands WHERE actor_id=? AND request_id=?',
              owner,
              result.input.requestId,
            ),
            1,
          );
          const resultRow = await first(
            'SELECT event_id,before_json,after_json,result_json FROM project_matching_rule_results WHERE command_id=?',
            command.id,
          );
          assert.ok(resultRow);
          assert.equal(
            await count(
              'SELECT count(*) AS n FROM project_matching_rule_results WHERE command_id=?',
              command.id,
            ),
            1,
          );
          assert.equal(resultRow.event_id, result.body.eventId);
          assert.deepEqual(JSON.parse(resultRow.before_json), {
            profile: before.profile,
            ruleRevision: before.ruleRevision,
            projectRevision: before.projectRevision,
          });
          assert.deepEqual(JSON.parse(resultRow.after_json), {
            profile,
            ruleRevision: before.ruleRevision + 1,
            projectRevision: before.projectRevision + 1,
          });
          assert.deepEqual(JSON.parse(resultRow.result_json), result.body);
          const event = await first(
            'SELECT event_id,actor_type,actor_id,session_id,project_id,action,request_id,before_json,after_json FROM audit_events WHERE event_id=?',
            result.body.eventId,
          );
          assert.ok(event);
          assert.equal(event.actor_type, 'user');
          assert.equal(event.actor_id, owner);
          assert.equal(event.session_id, command.session_id);
          assert.equal(event.project_id, project.id);
          assert.equal(event.action, 'project.matching_rules_changed');
          assert.equal(event.request_id, command.request_id);
          assert.deepEqual(
            JSON.parse(event.before_json),
            JSON.parse(resultRow.before_json),
          );
          assert.deepEqual(
            JSON.parse(event.after_json),
            JSON.parse(resultRow.after_json),
          );
          assert.equal(
            await count(
              'SELECT count(*) AS n FROM audit_events WHERE event_id=?',
              result.body.eventId,
            ),
            1,
          );
          current = readback;
          changedCount++;
          if (profile === 'rules-v1-100') real.firstRulesRequest = result;
        }
        const headBeforeNoOp = await first(
          'SELECT project_id,workspace_id,profile,revision,command_id FROM project_matching_rule_heads WHERE project_id=?',
          project.id,
        );
        const commandCountBeforeNoOp = await count(
          'SELECT count(*) AS n FROM project_matching_rule_commands WHERE project_id=?',
          project.id,
        );
        const resultCountBeforeNoOp = await count(
          'SELECT count(*) AS n FROM project_matching_rule_results WHERE command_id IN (SELECT id FROM project_matching_rule_commands WHERE project_id=?)',
          project.id,
        );
        const same = await setRules(project, current, current.profile);
        assert.equal(same.response.status, 200, JSON.stringify(same.body));
        assert.equal(same.body.changed, false);
        assert.equal(same.body.eventId, null);
        assert.equal(same.body.projectRevision, current.projectRevision);
        assert.equal(same.body.ruleRevision, current.ruleRevision);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM project_matching_rule_commands WHERE actor_id=? AND request_id=?',
            owner,
            same.input.requestId,
          ),
          1,
        );
        const noOpCommand = await first(
          'SELECT id,actor_id,session_id,request_id,project_id,expected_project_revision,expected_rule_revision,before_profile,profile,payload_json FROM project_matching_rule_commands WHERE actor_id=? AND request_id=?',
          owner,
          same.input.requestId,
        );
        assert.ok(noOpCommand);
        assert.equal(noOpCommand.actor_id, owner);
        assert.equal(noOpCommand.session_id, await sessionIdForCookie());
        assert.equal(noOpCommand.request_id, same.input.requestId);
        assert.equal(noOpCommand.project_id, project.id);
        assert.equal(
          noOpCommand.expected_project_revision,
          current.projectRevision,
        );
        assert.equal(noOpCommand.expected_rule_revision, current.ruleRevision);
        assert.equal(noOpCommand.before_profile, current.profile);
        assert.equal(noOpCommand.profile, current.profile);
        assert.deepEqual(JSON.parse(noOpCommand.payload_json), {
          projectId: project.id,
          expectedProjectRevision: current.projectRevision,
          expectedRuleRevision: current.ruleRevision,
          profile: current.profile,
          confirm: true,
        });
        const noOpResult = await first(
          'SELECT event_id,before_json,after_json,result_json FROM project_matching_rule_results WHERE command_id=?',
          noOpCommand.id,
        );
        assert.ok(noOpResult);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM project_matching_rule_results WHERE command_id=?',
            noOpCommand.id,
          ),
          1,
        );
        assert.equal(noOpResult.event_id, null);
        assert.deepEqual(JSON.parse(noOpResult.result_json), same.body);
        assert.equal(
          await count(
            "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND project_id=? AND request_id=? AND action='project.matching_rules_changed'",
            owner,
            project.id,
            same.input.requestId,
          ),
          0,
          'A persisted no-op result emits no audit event',
        );
        assert.deepEqual(
          await first(
            'SELECT project_id,workspace_id,profile,revision,command_id FROM project_matching_rule_heads WHERE project_id=?',
            project.id,
          ),
          headBeforeNoOp,
          'A no-op leaves the profile head and its command pointer untouched',
        );
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM project_matching_rule_commands WHERE project_id=?',
            project.id,
          ),
          commandCountBeforeNoOp + 1,
        );
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM project_matching_rule_results WHERE command_id IN (SELECT id FROM project_matching_rule_commands WHERE project_id=?)',
            project.id,
          ),
          resultCountBeforeNoOp + 1,
        );
        assert.equal(
          await count(
            "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND project_id=? AND action='project.matching_rules_changed'",
            owner,
            project.id,
          ),
          baselineAudit + changedCount,
        );

        const staleBefore = await tableSnapshot(album, project);
        const stale = await setRules(
          project,
          {
            ...current,
            projectRevision: current.projectRevision - 1,
            ruleRevision: current.ruleRevision - 1,
          },
          'rules-v1-010',
        );
        assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
        assert.equal(
          stale.body.error?.code,
          'MATCHING_RULES_REVISION_CONFLICT',
        );
        assert.deepEqual(await tableSnapshot(album, project), staleBefore);

        const original = real.firstRulesRequest;
        assert.ok(original);
        const beforeAba = current;
        const toB = await setRules(project, current, 'rules-v1-100');
        assert.equal(toB.response.status, 200, JSON.stringify(toB.body));
        assert.equal(toB.body.changed, true);
        current = await readRules(project);
        const toA = await setRules(project, current, 'rules-v1-101');
        assert.equal(toA.response.status, 200, JSON.stringify(toA.body));
        assert.equal(toA.body.changed, true);
        current = await readRules(project);
        const backToA = await setRules(project, current, 'rules-v1-100');
        assert.equal(
          backToA.response.status,
          200,
          JSON.stringify(backToA.body),
        );
        assert.equal(backToA.body.changed, true);
        current = await readRules(project);
        assert.equal(current.profile, 'rules-v1-100');
        assert.equal(current.ruleRevision, beforeAba.ruleRevision + 3);
        assert.equal(current.projectRevision, beforeAba.projectRevision + 3);
        assert.equal(
          await count(
            "SELECT count(*) AS n FROM audit_events WHERE actor_id=? AND project_id=? AND action='project.matching_rules_changed'",
            owner,
            project.id,
          ),
          baselineAudit + changedCount + 3,
          'Each change, including both ABA transitions, creates exactly one audit event',
        );

        const replay = await read(
          worker,
          'PUT',
          rulesPath(project),
          original.input,
        );
        assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
        assert.deepEqual(replay.body, original.body);
        const conflict = await read(worker, 'PUT', rulesPath(project), {
          ...original.input,
          profile: 'rules-v1-101',
        });
        assert.equal(
          conflict.response.status,
          409,
          JSON.stringify(conflict.body),
        );
        assert.equal(conflict.body.error?.code, 'REQUEST_ID_CONFLICT');
      },
    );

    await check(
      'matching-rules API enforces exact origin, actor, Owner session, scope, query and strict body boundaries',
      async () => {
        const path = rulesPath(project);
        const current = await readRules(project);
        const candidate = {
          requestId: randomUUID(),
          expectedProjectRevision: current.projectRevision,
          expectedRuleRevision: current.ruleRevision,
          profile: 'rules-v1-111',
          confirm: true,
        };
        const noWriteBaseline = await tableSnapshot(album, project);
        const wrongOrigin = await read(worker, 'PUT', path, candidate, {
          Origin: 'https://wrong.example',
        });
        assert.equal(wrongOrigin.response.status, 403);
        assert.equal(wrongOrigin.body, 'Invalid Origin header');
        await expectCode(
          worker,
          'PUT',
          path,
          candidate,
          403,
          'FORBIDDEN_ORIGIN',
          { Origin: undefined },
        );
        await expectCode(
          worker,
          'PUT',
          path,
          candidate,
          403,
          'MATCHING_RULES_OWNER_CHANGED',
          { 'X-Kino-Expected-Actor': randomUUID() },
        );
        await expectCode(
          worker,
          'PUT',
          path,
          candidate,
          403,
          'MATCHING_RULES_OWNER_CHANGED',
          { 'X-Kino-Expected-Actor': undefined },
        );
        await expectCode(
          worker,
          'PUT',
          path + '?extra=1',
          candidate,
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          worker,
          'GET',
          '/api/v1/matching-rules/capabilities?extra=1',
          undefined,
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          worker,
          'GET',
          path + '?extra=1',
          undefined,
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          worker,
          'PUT',
          path,
          { ...candidate, unexpected: true },
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          worker,
          'PUT',
          path,
          { ...candidate, confirm: false },
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          worker,
          'PUT',
          path,
          { ...candidate, profile: 'rules-v1-999' },
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          worker,
          'PUT',
          path,
          { ...candidate, expectedProjectRevision: Number.MAX_SAFE_INTEGER },
          400,
          'INVALID_INPUT',
        );
        await expectCode(worker, 'PUT', path, '{', 400, 'INVALID_INPUT', {
          'Content-Type': 'application/json',
        });

        const invalidCookie = {
          ...ownerHeaders,
          Cookie: 'kino-owner.session_token=invalid-session-token',
        };
        const expired = await read(
          worker,
          'GET',
          path,
          undefined,
          invalidCookie,
        );
        assert.equal(
          expired.response.status,
          401,
          JSON.stringify(expired.body),
        );
        const foreignProject = randomUUID();
        await expectCode(
          worker,
          'GET',
          '/api/v1/projects/' + foreignProject + '/matching-rules',
          undefined,
          404,
          'NOT_FOUND',
        );
        assert.deepEqual(await tableSnapshot(album, project), noWriteBaseline);
      },
    );

    await check(
      'matching-rule index GET/advance are current-profile scoped, strict, bounded to 24 and preserve default-v1 rows',
      async () => {
        const initialRules = await readRules(project);
        const index = await readIndex(album);
        assert.equal(index.response.status, 200, JSON.stringify(index.body));
        assert.equal(index.body.profile, initialRules.profile);
        assert.equal(index.body.ruleRevision, initialRules.ruleRevision);
        assert.equal(index.body.state, 'ready');
        await expectCode(
          worker,
          'GET',
          indexPath(album) + '?profile=rules-v1-100',
          undefined,
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          worker,
          'GET',
          indexPath(album),
          undefined,
          403,
          'MATCHING_RULES_OWNER_CHANGED',
          { 'X-Kino-Expected-Actor': randomUUID() },
        );
        await expectCode(
          worker,
          'POST',
          indexPath(album),
          {
            expectedProjectRevision: index.body.projectRevision,
            expectedRuleRevision: index.body.ruleRevision,
            profile: 'rules-v1-111',
            extra: true,
          },
          400,
          'INVALID_INPUT',
        );
        await expectCode(
          worker,
          'POST',
          indexPath(album),
          {
            expectedProjectRevision: index.body.projectRevision,
            expectedRuleRevision: index.body.ruleRevision,
            profile: 'rules-v1-111',
          },
          409,
          'MATCHING_RULES_REVISION_CONFLICT',
        );
        const wrongOrigin = await read(
          worker,
          'POST',
          indexPath(album),
          {
            expectedProjectRevision: index.body.projectRevision,
            expectedRuleRevision: index.body.ruleRevision,
            profile: index.body.profile,
          },
          { Origin: 'https://wrong.example' },
        );
        assert.equal(wrongOrigin.response.status, 403);
        assert.equal(wrongOrigin.body, 'Invalid Origin header');

        const legacyBefore = await all(
          'SELECT upload_session_id,workspace_id,project_id,album_id,original_filename,profile,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE album_id=? ORDER BY upload_session_id,profile',
          album.id,
        );
        assert.deepEqual(legacyBefore, []);
        const counts = await profileIndexCounts(album.id, initialRules.profile);
        assert.equal(counts.legacy, 0);
        assert.equal(counts.rules, 0);
      },
    );

    await check(
      'actual R2 originals and processed derivatives publish case, JPG/JPEG, suffix, combo, and Unicode-expansion witnesses',
      async () => {
        const current = await readRules(project);
        const profile111 = await setRules(project, current, 'rules-v1-111');
        assert.equal(
          profile111.response.status,
          200,
          JSON.stringify(profile111.body),
        );
        assert.equal(profile111.body.changed, true);
        real.profile111 = await readRules(project);

        const atomicFile = await imageFile(
          'AtomicRuleIndex.png',
          await makePng(40, 20, '#6f8052'),
        );
        const atomicBody = ordinaryInitBody(project, album, atomicFile);
        const beforeAtomicFailure = await tableSnapshot(album, project);
        await db.exec(
          "CREATE TRIGGER fail_matching_rule_filename_index_insert BEFORE INSERT ON matching_rule_filename_index WHEN NEW.original_filename='AtomicRuleIndex.png' BEGIN SELECT RAISE(ABORT,'TEST_MATCHING_RULE_FILENAME_INDEX_FAILURE'); END;",
        );
        try {
          await expectCode(
            worker,
            'POST',
            '/api/v1/uploads/init',
            atomicBody,
            503,
            'RESOLUTION_UNAVAILABLE',
          );
          assert.deepEqual(
            await tableSnapshot(album, project),
            beforeAtomicFailure,
            'A nondefault key failure rolls back the request, session, both indexes, specs, quotas, audit and watermark',
          );
        } finally {
          await db.exec(
            'DROP TRIGGER IF EXISTS fail_matching_rule_filename_index_insert',
          );
        }
        const atomicRetry = await read(
          worker,
          'POST',
          '/api/v1/uploads/init',
          atomicBody,
        );
        assert.equal(
          atomicRetry.response.status,
          201,
          JSON.stringify(atomicRetry.body),
        );
        const atomicSessionId = atomicRetry.body.uploadSession?.id;
        assert.ok(atomicSessionId);
        unissuedSessions.add(atomicSessionId);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM upload_requests WHERE actor_id=? AND request_id=?',
            owner,
            atomicBody.requestId,
          ),
          1,
          'The exact request ID succeeds once after the failed batch rolled back',
        );
        assert.deepEqual(
          await all(
            'SELECT profile FROM matching_filename_index WHERE upload_session_id=? ORDER BY profile',
            atomicSessionId,
          ),
          [{ profile: 'default-v1' }],
        );
        assert.deepEqual(
          await all(
            'SELECT profile FROM matching_rule_filename_index WHERE upload_session_id=? ORDER BY profile',
            atomicSessionId,
          ),
          [{ profile: 'rules-v1-111' }],
        );
        real.atomic = {
          ...(await completeReservedUpload(atomicSessionId, atomicFile)),
          filename: atomicFile.originalFilename,
          bytes: atomicFile.bytes,
          sha256: atomicFile.sha256,
          dimensions: atomicFile.dimensions,
        };

        const caseFile = await imageFile(
          'CafeShop.png',
          await makePng(48, 24, '#37806b'),
        );
        const aliasFile = await imageFile(
          'Portfolio.jpg',
          await makeJpeg(48, 24, '#7080a4'),
          'image/jpeg',
        );
        const suffixFile = await imageFile(
          'Night_edited.png',
          await makePng(48, 24, '#a46137'),
        );
        const comboFile = await imageFile(
          'Scan_edited.JPG',
          await makeJpeg(48, 24, '#bf6872'),
          'image/jpeg',
        );
        const familyFile = await imageFile(
          'Family.png',
          await makePng(64, 32, '#587c9c'),
        );
        const sameAFile = await imageFile(
          'Twin.png',
          await makePng(48, 24, '#6b986b'),
        );
        const sameBFile = await imageFile(
          'Twin.png',
          await makePng(48, 24, '#996b8a'),
        );
        const unicodeName = 'İ'.repeat(250) + '.png';
        assert.equal(unicodeName.length, 254);
        const unicodeFile = await imageFile(
          unicodeName,
          await makePng(48, 24, '#8a5baf'),
        );

        for (const [key, file] of Object.entries({
          caseOnly: caseFile,
          aliasOnly: aliasFile,
          suffixOnly: suffixFile,
          combined: comboFile,
          family: familyFile,
          ambiguousA: sameAFile,
          ambiguousB: sameBFile,
          unicodeExpansion: unicodeFile,
          atomic: atomicFile,
        })) {
          const uploaded =
            key === 'atomic'
              ? real.atomic
              : await uploadOrdinary(project, album, file);
          real[key] = {
            ...uploaded,
            filename: file.originalFilename,
            bytes: file.bytes,
            sha256: file.sha256,
            dimensions: file.dimensions,
          };
        }

        const rows = await all(
          'SELECT upload_session_id,profile FROM matching_rule_filename_index WHERE album_id=? ORDER BY upload_session_id,profile',
          album.id,
        );
        assert.equal(rows.length, 9);
        assert.ok(rows.every((row) => row.profile === 'rules-v1-111'));
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM matching_filename_index WHERE album_id=? AND profile=?',
            album.id,
            'default-v1',
          ),
          9,
        );
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM matching_rule_filename_index WHERE album_id=? AND profile<>?',
            album.id,
            'rules-v1-111',
          ),
          0,
        );

        const expanded = await first(
          'SELECT original_filename,canonical_basename,canonical_extension,is_invalid FROM matching_rule_filename_index WHERE upload_session_id=? AND profile=?',
          real.unicodeExpansion.session.id,
          'rules-v1-111',
        );
        const expectedExpanded = 'i\u0307'.repeat(250);
        assert.equal(expanded.original_filename, unicodeName);
        assert.equal(expanded.canonical_basename, expectedExpanded);
        assert.equal(expanded.canonical_basename.length, 500);
        assert.equal([...expanded.canonical_basename].length, 500);
        assert.equal(expanded.canonical_extension, 'png');
        assert.equal(expanded.is_invalid, 0);

        const unicodePreview = await uploadResolutionPreview(album, {
          ...(await imageFile(unicodeName, await makePng(48, 24, '#9461a4'))),
        });
        assert.deepEqual(unicodePreview.matchingProfile, {
          profile: 'rules-v1-111',
          ruleRevision: real.profile111.ruleRevision,
        });
        assert.equal(unicodePreview.decision.outcome, 'new_version');
        assert.equal(
          unicodePreview.decision.photoId,
          real.unicodeExpansion.photoId,
        );
      },
    );

    await check(
      'per-profile API maintenance rebuilds only the selected index and resolver applies each independent rule bit',
      async () => {
        const baselineDefaultRows = await all(
          'SELECT upload_session_id,workspace_id,project_id,album_id,original_filename,profile,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE album_id=? ORDER BY upload_session_id,profile',
          album.id,
        );
        let rules = await readRules(project);
        const expectedCases = [
          {
            profile: 'rules-v1-100',
            key: 'caseOnly',
            filename: 'cafeshop.png',
            outcome: 'new_version',
          },
          {
            profile: 'rules-v1-010',
            key: 'aliasOnly',
            filename: 'Portfolio.jpeg',
            outcome: 'new_version',
          },
          {
            profile: 'rules-v1-001',
            key: 'suffixOnly',
            filename: 'Night.png',
            outcome: 'new_version',
          },
          {
            profile: 'rules-v1-111',
            key: 'combined',
            filename: 'scan.jpeg',
            outcome: 'new_version',
          },
        ];
        for (const item of expectedCases) {
          rules = await readRules(project);
          const indexRowsBeforeChange = await count(
            'SELECT count(*) AS n FROM matching_rule_filename_index WHERE album_id=?',
            album.id,
          );
          if (rules.profile !== item.profile) {
            const changed = await setRules(project, rules, item.profile);
            assert.equal(
              changed.response.status,
              200,
              JSON.stringify(changed.body),
            );
            assert.equal(changed.body.changed, true);
            rules = await readRules(project);
          }
          assert.equal(
            await count(
              'SELECT count(*) AS n FROM matching_rule_filename_index WHERE album_id=?',
              album.id,
            ),
            indexRowsBeforeChange,
            'A profile change never backfills an index as a side effect',
          );
          const before = await readIndex(album);
          assert.equal(
            before.response.status,
            200,
            JSON.stringify(before.body),
          );
          assert.equal(before.body.profile, item.profile);
          const oldRows = await profileIndexCounts(album.id, item.profile);
          assert.equal(oldRows.allRules, indexRowsBeforeChange);
          const built = await advanceAll(album);
          assert.equal(built.state, 'ready');
          assert.equal(built.missingSessions, 0);
          assert.ok(built.maxRows <= PAGE_LIMIT);
          assert.equal(built.profile, item.profile);
          const incoming = await imageFile(
            item.filename,
            await makePng(48, 24, '#33a5af'),
          );
          const preview = await uploadResolutionPreview(album, incoming);
          assert.deepEqual(preview.matchingProfile, {
            profile: item.profile,
            ruleRevision: rules.ruleRevision,
          });
          assert.equal(
            preview.decision.outcome,
            item.outcome,
            JSON.stringify(preview.decision),
          );
          assert.equal(preview.decision.photoId, real[item.key].photoId);
          assert.equal(preview.candidatesTruncated, false);
        }

        rules = await readRules(project);
        if (rules.profile !== 'default-v1') {
          const changed = await setRules(project, rules, 'default-v1');
          assert.equal(
            changed.response.status,
            200,
            JSON.stringify(changed.body),
          );
        }
        const defaultRules = await readRules(project);
        const defaultStatus = await readIndex(album);
        assert.equal(
          defaultStatus.response.status,
          200,
          JSON.stringify(defaultStatus.body),
        );
        assert.equal(defaultStatus.body.profile, 'default-v1');
        assert.equal(defaultStatus.body.state, 'ready');
        const caseMismatch = await uploadResolutionPreview(album, {
          ...(await imageFile(
            'cafeshop.png',
            await makePng(48, 24, '#4b7251'),
          )),
        });
        assert.equal(caseMismatch.decision.outcome, 'new_photo');
        assert.equal(caseMismatch.decision.reason, 'no_filename_match');
        const aliasMismatch = await uploadResolutionPreview(album, {
          ...(await imageFile(
            'Portfolio.jpeg',
            await makeJpeg(48, 24, '#887459'),
            'image/jpeg',
          )),
        });
        assert.equal(aliasMismatch.decision.outcome, 'new_photo');
        assert.equal(aliasMismatch.decision.reason, 'no_filename_match');
        const currentDefaultRows = await all(
          'SELECT upload_session_id,workspace_id,project_id,album_id,original_filename,profile,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE album_id=? ORDER BY upload_session_id,profile',
          album.id,
        );
        const originalIds = new Set(
          baselineDefaultRows.map((row) => row.upload_session_id),
        );
        assert.deepEqual(
          currentDefaultRows.filter((row) =>
            originalIds.has(row.upload_session_id),
          ),
          baselineDefaultRows,
          'Profile maintenance preserves every original default-v1 key byte-for-byte',
        );
        assert.equal(defaultRules.profile, 'default-v1');
      },
    );

    await check(
      'unique filename wins over an exact hash elsewhere, ambiguous names are reviewed before hash, and invalid or pending coverage fails closed',
      async () => {
        let rules = await readRules(project);
        if (rules.profile !== 'rules-v1-111') {
          const changed = await setRules(project, rules, 'rules-v1-111');
          assert.equal(
            changed.response.status,
            200,
            JSON.stringify(changed.body),
          );
        }
        const ready = await advanceAll(album);
        assert.equal(ready.state, 'ready');
        const elsewhere = await uploadResolutionPreview(
          album,
          await imageFile('CafeShop.png', real.aliasOnly.bytes, 'image/jpeg'),
        );
        assert.equal(elsewhere.decision.outcome, 'new_version');
        assert.equal(elsewhere.decision.photoId, real.caseOnly.photoId);

        const ambiguous = await uploadResolutionPreview(album, {
          ...(await imageFile('Twin.png', real.ambiguousA.bytes)),
          sha256: real.ambiguousA.sha256,
        });
        assert.equal(ambiguous.decision.outcome, 'requires_review');
        assert.equal(ambiguous.decision.reason, 'ambiguous_filename_match');
        assert.equal(ambiguous.decision.photoId, null);
        const missing = await uploadResolutionPreview(album, {
          ...(await imageFile(
            'NoSuchPhoto.png',
            await makePng(48, 24, '#a57372'),
          )),
          sha256: sha256('no-such-photo'),
        });
        assert.equal(missing.decision.outcome, 'new_photo');
        assert.equal(missing.decision.reason, 'no_filename_match');

        const pendingFile = await imageFile(
          'PendingMatch.png',
          await makePng(48, 24, '#b4796c'),
        );
        const pending = await reserveOrdinary(project, album, pendingFile);
        const pendingPreview = await uploadResolutionPreview(album, {
          ...(await imageFile(
            'PendingMatch.png',
            await makePng(48, 24, '#854963'),
          )),
        });
        assert.equal(pendingPreview.decision.outcome, 'requires_review');
        assert.equal(
          pendingPreview.decision.reason,
          'pending_upload_requires_review',
        );
        await cancelUnissued(pending.id);

        const invalidFile = await imageFile(
          '..',
          await makePng(1, 1, '#5c8252'),
        );
        const invalidPending = await reserveOrdinary(
          project,
          album,
          invalidFile,
        );
        const blocked = await readIndex(album);
        assert.equal(blocked.body.state, 'blocked');
        assert.ok(blocked.body.invalidSessions > 0);
        const failClosed = await uploadResolutionPreview(album, {
          ...(await imageFile(
            'CafeShop.png',
            await makePng(48, 24, '#637da9'),
          )),
        }).catch((error) => {
          throw error;
        });
        assert.equal(failClosed.decision.outcome, 'requires_review');
        assert.equal(failClosed.decision.reason, 'filename_index_not_ready');
        await cancelUnissued(invalidPending.id);
      },
    );

    await check(
      'renamed cropped current head and immutable non-head duplicates retain exact full version history',
      async () => {
        const initialFamily = real.family;
        const sameContentFile = await imageFile(
          'Family.png',
          initialFamily.bytes,
        );
        const historicalDuplicate = await uploadVersion(
          initialFamily.photoId,
          sameContentFile,
        );
        real.familyDuplicateVersionId = historicalDuplicate.versionId;
        const cropped = await imageFile(
          'Family_edited.png',
          await makePng(64, 64, '#b56f4d'),
        );
        const renamedHead = await uploadVersion(initialFamily.photoId, cropped);
        real.renamedHeadVersionId = renamedHead.versionId;
        const head = await first(
          'SELECT version_id,revision FROM photo_version_heads WHERE photo_id=?',
          initialFamily.photoId,
        );
        assert.equal(head.version_id, renamedHead.versionId);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM photo_versions WHERE photo_id=?',
            initialFamily.photoId,
          ),
          3,
        );
        const historicalDuplicatePreview = await uploadResolutionPreview(
          album,
          {
            ...fileEvidence(sameContentFile),
            sha256: initialFamily.sha256,
          },
        );
        assert.equal(historicalDuplicatePreview.decision.outcome, 'duplicate');
        assert.equal(
          historicalDuplicatePreview.decision.reason,
          'exact_hash_match',
        );
        assert.equal(
          historicalDuplicatePreview.decision.photoId,
          initialFamily.photoId,
        );
        assert.equal(historicalDuplicatePreview.decision.versionId, null);
        const cropReview = await uploadResolutionPreview(album, {
          ...(await imageFile('Family.png', await makePng(64, 32, '#473e85'))),
          sha256: sha256('family-crop-review'),
        });
        assert.equal(cropReview.decision.outcome, 'requires_review');
        assert.equal(
          cropReview.decision.reason,
          'dimension_change_requires_review',
        );
        assert.equal(cropReview.decision.photoId, initialFamily.photoId);
      },
    );

    await check(
      'guarded 1,001-row synthetic immutable metadata history stays complete through selected-profile API indexing without a candidate-array cap',
      async () => {
        const beforeVersions = await count(
          'SELECT count(*) AS n FROM photo_versions WHERE photo_id=?',
          real.family.photoId,
        );
        const syntheticHashes = new Set();
        let tailVersion;
        for (let start = 0; start < SYNTHETIC_HISTORY_COUNT; start += 24) {
          const end = Math.min(SYNTHETIC_HISTORY_COUNT, start + 24);
          for (let index = start; index < end; index++) {
            const hash = sha256('matching-rules-synthetic-history-' + index);
            syntheticHashes.add(hash);
            tailVersion = await appendAuthorizedVersionFixture({
              db,
              owner,
              photoId: real.family.photoId,
              sha256: hash,
              byteSize: 1,
              mime: 'image/png',
              width: 64,
              height: 32,
            });
          }
        }
        // This guarded helper writes the real D1 authorization/completion path but no R2 object.
        assert.equal(syntheticHashes.size, SYNTHETIC_HISTORY_COUNT);
        assert.equal(
          tailVersion?.sha256_hex,
          sha256(
            'matching-rules-synthetic-history-' + (SYNTHETIC_HISTORY_COUNT - 1),
          ),
        );
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM photo_versions WHERE photo_id=?',
            real.family.photoId,
          ),
          beforeVersions + SYNTHETIC_HISTORY_COUNT,
        );
        let current = await readRules(project);
        if (current.profile !== 'rules-v1-111') {
          const changed = await setRules(project, current, 'rules-v1-111');
          assert.equal(
            changed.response.status,
            200,
            JSON.stringify(changed.body),
          );
          current = await readRules(project);
        }
        let status = await readIndex(album);
        assert.equal(status.body.state, 'building');
        assert.ok(status.body.missingSessions >= SYNTHETIC_HISTORY_COUNT);
        let batchCount = 0;
        while (status.body.missingSessions > 0) {
          const previous = status.body.missingSessions;
          const next = await advanceIndex(album, status.body);
          assert.equal(next.response.status, 200, JSON.stringify(next.body));
          const inserted = previous - next.body.missingSessions;
          assert.ok(inserted > 0 && inserted <= PAGE_LIMIT);
          batchCount += inserted;
          status = next;
        }
        assert.ok(batchCount >= SYNTHETIC_HISTORY_COUNT);
        assert.equal(status.body.state, 'ready');
        assert.equal(status.body.missingSessions, 0);
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM matching_rule_filename_index WHERE album_id=? AND profile=?',
            album.id,
            'rules-v1-111',
          ),
          await count(
            'SELECT count(*) AS n FROM upload_sessions WHERE album_id=?',
            album.id,
          ),
        );
        const tailSource = await first(
          'SELECT original_filename FROM upload_sessions WHERE id=? AND project_id=? AND album_id=?',
          tailVersion.uploadSessionId,
          project.id,
          album.id,
        );
        assert.ok(tailSource?.original_filename);
        const beyondHistoryCap = await uploadResolutionPreview(album, {
          originalFilename: tailSource.original_filename,
          expectedBytes: 1,
          contentType: 'image/png',
          sha256: tailVersion.sha256_hex,
          dimensions: { width: 64, height: 32 },
        });
        assert.equal(beyondHistoryCap.decision.outcome, 'duplicate');
        assert.equal(
          beyondHistoryCap.decision.reason,
          'exact_hash_match',
          'The 1,001st synthetic metadata hash remains visible to the profile-aware classifier',
        );
        assert.equal(beyondHistoryCap.decision.photoId, real.family.photoId);
        assert.equal(
          beyondHistoryCap.decision.versionId,
          tailVersion.version_id,
          'The duplicate result identifies the exact 1,001st historical version',
        );
        const duplicateAfterLargeHistory = await uploadResolutionPreview(
          album,
          {
            ...(await imageFile('Family.png', real.family.bytes)),
            sha256: real.family.sha256,
          },
        );
        assert.equal(duplicateAfterLargeHistory.decision.outcome, 'duplicate');
        assert.equal(duplicateAfterLargeHistory.decision.versionId, null);
        assert.equal(
          duplicateAfterLargeHistory.decision.photoId,
          real.family.photoId,
        );
        assert.equal(duplicateAfterLargeHistory.candidatesTruncated, false);
        real.historyVersionCount = beforeVersions + SYNTHETIC_HISTORY_COUNT;
      },
    );

    await check(
      'profile revisions fence stale reserve before mutation while exact successful replay survives ABA and a fresh Owner session',
      async () => {
        let current = await readRules(project);
        if (current.profile !== 'rules-v1-111') {
          const changed = await setRules(project, current, 'rules-v1-111');
          assert.equal(
            changed.response.status,
            200,
            JSON.stringify(changed.body),
          );
          current = await readRules(project);
        }
        const file = await imageFile(
          'CafeShop.png',
          await makePng(48, 24, '#5d4d98'),
        );
        const stalePreview = await uploadResolutionPreview(album, file);
        assert.equal(stalePreview.decision.outcome, 'new_version');
        assert.deepEqual(stalePreview.matchingProfile, {
          profile: current.profile,
          ruleRevision: current.ruleRevision,
        });
        const staleBody = reserveResolvedBody(
          stalePreview,
          file,
          selectedChoice(stalePreview, real.caseOnly.photoId),
        );

        const toB = await setRules(project, current, 'rules-v1-010');
        assert.equal(toB.response.status, 200, JSON.stringify(toB.body));
        current = await readRules(project);
        const toA = await setRules(project, current, 'rules-v1-111');
        assert.equal(toA.response.status, 200, JSON.stringify(toA.body));

        const beforeDenied = await tableSnapshot(album, project);
        await expectCode(
          worker,
          'POST',
          reservePath(album),
          staleBody,
          409,
          'RESOLUTION_STALE',
        );
        assert.deepEqual(await tableSnapshot(album, project), beforeDenied);

        const freshRules = await readRules(project);
        const freshPreview = await uploadResolutionPreview(album, file);
        assert.equal(freshPreview.decision.outcome, 'new_version');
        assert.equal(
          freshPreview.matchingProfile.ruleRevision,
          freshRules.ruleRevision,
        );
        const requestId = randomUUID();
        const reservationBody = reserveResolvedBody(
          freshPreview,
          file,
          selectedChoice(freshPreview, real.caseOnly.photoId),
          requestId,
        );
        const reserved = await read(
          worker,
          'POST',
          reservePath(album),
          reservationBody,
        );
        assert.equal(
          reserved.response.status,
          201,
          JSON.stringify(reserved.body),
        );
        const uploadSessionId = reserved.body.uploadSession?.id;
        assert.ok(uploadSessionId);
        unissuedSessions.add(uploadSessionId);
        assert.equal(reserved.body.target.kind, 'new_version');
        assert.equal(reserved.body.target.photoId, real.caseOnly.photoId);

        const token = randomUUID();
        const newSessionId = randomUUID();
        const now = Date.now();
        await db
          .prepare(
            'INSERT INTO owner_sessions(id,token,userId,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
          )
          .bind(newSessionId, token, owner, now + 3_600_000, now, now)
          .run();
        const freshCookie =
          'kino-owner.session_token=' +
          encodeURIComponent(
            token + '.' + (await makeSignature(token, authSecret)),
          );
        const beforeReplayRules = await readRules(project);
        const newer = await setRules(
          project,
          beforeReplayRules,
          'rules-v1-101',
        );
        assert.equal(newer.response.status, 200, JSON.stringify(newer.body));
        const beforeReplay = await tableSnapshot(album, project);
        const replay = await read(
          worker,
          'POST',
          reservePath(album),
          reservationBody,
          { Cookie: freshCookie },
        );
        assert.equal(
          replay.response.status,
          reserved.response.status,
          JSON.stringify(replay.body),
        );
        assert.equal(replay.body.uploadSession?.id, uploadSessionId);
        assert.deepEqual(replay.body.target, reserved.body.target);
        assert.deepEqual(await tableSnapshot(album, project), beforeReplay);
        await cancelUnissued(uploadSessionId, { Cookie: freshCookie });
      },
    );

    await check(
      'native D1 rejects the frozen six-field reservation on a nondefault profile and accepts the exact fresh seven-field API intent',
      async () => {
        let current = await readRules(project);
        if (current.profile !== 'rules-v1-111') {
          const changed = await setRules(project, current, 'rules-v1-111');
          assert.equal(
            changed.response.status,
            200,
            JSON.stringify(changed.body),
          );
          current = await readRules(project);
        }
        const ready = await advanceAll(album);
        assert.equal(ready.state, 'ready');
        const file = await imageFile(
          'CafeShop.png',
          await makePng(48, 24, '#a47455'),
        );
        const preview = await uploadResolutionPreview(album, file);
        assert.deepEqual(preview.matchingProfile, {
          profile: current.profile,
          ruleRevision: current.ruleRevision,
        });
        assert.equal(preview.decision.outcome, 'new_version');
        assert.equal(preview.decision.photoId, real.caseOnly.photoId);
        const choice = selectedChoice(preview, real.caseOnly.photoId);
        const ownerSessionId = await sessionIdForCookie();
        const rejectedRequestId = randomUUID();
        const rejectedSessionId = randomUUID();
        const rejectedPayload = resolvedRequestPayload(
          project,
          album,
          preview,
          file,
          choice,
          false,
        );
        assert.equal(
          Object.keys(rejectedPayload.resolution).length,
          6,
          'The direct native insert uses the frozen legacy resolution shape',
        );
        const beforeNativeGuard = await tableSnapshot(album, project);
        await assert.rejects(
          () =>
            db
              .prepare(
                'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              )
              .bind(
                owner,
                rejectedRequestId,
                'upload.reserved',
                JSON.stringify(rejectedPayload),
                ownerSessionId,
                rejectedSessionId,
                workspaceId,
                project.id,
                album.id,
                'primary',
                `${workspaceId}/${project.id}/${album.id}/${rejectedSessionId}/original`,
                file.originalFilename,
                file.expectedBytes,
                Date.now(),
              )
              .run(),
          (error) => String(error?.message).includes('RESOLUTION_STALE'),
        );
        assert.deepEqual(
          await tableSnapshot(album, project),
          beforeNativeGuard,
          'The native stale denial leaves the full upload/index/quota/audit/change state untouched',
        );

        const positiveControlBody = reserveResolvedBody(preview, file, choice);
        assert.deepEqual(positiveControlBody.matchingProfile, {
          profile: current.profile,
          ruleRevision: current.ruleRevision,
        });
        const positiveControl = await read(
          worker,
          'POST',
          reservePath(album),
          positiveControlBody,
        );
        assert.equal(
          positiveControl.response.status,
          201,
          JSON.stringify(positiveControl.body),
        );
        assert.equal(positiveControl.body.target.kind, 'new_version');
        assert.equal(
          positiveControl.body.target.photoId,
          real.caseOnly.photoId,
        );
        const persisted = await first(
          'SELECT payload_json FROM upload_requests WHERE actor_id=? AND request_id=?',
          owner,
          positiveControlBody.requestId,
        );
        assert.ok(persisted);
        const canonicalPayload = JSON.parse(persisted.payload_json);
        assert.equal(Object.keys(canonicalPayload.resolution).length, 7);
        assert.deepEqual(canonicalPayload.resolution.matchingProfile, {
          profile: current.profile,
          ruleRevision: current.ruleRevision,
        });
        const uploadSessionId = positiveControl.body.uploadSession?.id;
        assert.ok(uploadSessionId);
        unissuedSessions.add(uploadSessionId);
        await cancelUnissued(uploadSessionId);
      },
    );

    await check(
      'profile-disabled workers preserve default-v1 legacy indexing and fail closed on a current nondefault project',
      async () => {
        const current = await readRules(project);
        assert.notEqual(current.profile, 'default-v1');
        await expectCode(
          catalogWorker,
          'POST',
          previewPath(album),
          {
            file: {
              originalFilename: 'rules-disabled.png',
              expectedBytes: 1,
              contentType: 'image/png',
              sha256: sha256('disabled'),
              dimensions: { width: 1, height: 1 },
            },
          },
          503,
          'MATCHING_RULES_UNAVAILABLE',
        );
        const legacyRead = await read(
          catalogWorker,
          'GET',
          '/api/v1/albums/' + album.id + '/matching-filename-index',
        );
        assert.equal(
          legacyRead.response.status,
          200,
          JSON.stringify(legacyRead.body),
        );
        assert.deepEqual(
          Object.keys(legacyRead.body).sort(),
          [
            'albumId',
            'indexedSessions',
            'invalidSessions',
            'missingSessions',
            'profile',
            'projectId',
            'state',
            'unlinkedVersions',
            'unreadyPhotos',
            'workspaceId',
          ].sort(),
        );
        assert.equal(legacyRead.body.projectId, project.id);
        const capability = await read(
          defaultWorker,
          'GET',
          '/api/v1/matching-rules/capabilities',
        );
        assert.deepEqual(capability.body, { enabled: false });
        await expectCode(
          defaultWorker,
          'GET',
          rulesPath(project),
          undefined,
          403,
          'MATCHING_RULES_DISABLED',
        );
        const legacyRows = await all(
          'SELECT upload_session_id,workspace_id,project_id,album_id,original_filename,profile,canonical_basename,canonical_extension,is_invalid FROM matching_filename_index WHERE album_id=? ORDER BY upload_session_id,profile',
          album.id,
        );
        assert.ok(legacyRows.length >= 8);
        assert.ok(legacyRows.every((row) => row.profile === 'default-v1'));
      },
    );

    await check(
      '375px browser preserves current profile, late project-scope identity, bounded index build and exact reservation replay without R2 transfer',
      async () => {
        uiProject = await createProject('browser');
        uiAlbum = await createAlbum(uiProject, 'browser');
        const uiFile = await imageFile(
          'BrowserSource.png',
          await makePng(48, 24, '#718c62'),
        );
        uiSource = {
          ...(await uploadOrdinary(uiProject, uiAlbum, uiFile)),
          filename: uiFile.originalFilename,
        };
        let config = await readRules(uiProject);
        const set = await setRules(uiProject, config, 'rules-v1-100');
        assert.equal(set.response.status, 200, JSON.stringify(set.body));
        config = await readRules(uiProject);
        assert.equal(config.profile, 'rules-v1-100');
        assert.deepEqual(config.rules, RULES['rules-v1-100']);
        uiProfile = {
          id: config.profile,
          ruleRevision: config.ruleRevision,
          rules: config.rules,
        };
        const initialStatus = await readIndex(uiAlbum);
        assert.equal(
          initialStatus.response.status,
          200,
          JSON.stringify(initialStatus.body),
        );
        assert.equal(initialStatus.body.profile, 'rules-v1-100');
        assert.equal(initialStatus.body.state, 'building');
        assert.equal(initialStatus.body.missingSessions, 1);

        const browserFixture = {
          workspaceId,
          project: {
            ...uiProject,
            revision: config.projectRevision,
            mode: 'auto_filename',
          },
          album: uiAlbum,
          profile: uiProfile,
          siblingProject,
          indexStatus: initialStatus.body,
          source: {
            uploadSessionId: uiSource.session.id,
            filename: uiFile.originalFilename,
            photoId: uiSource.photoId,
            versionId: uiSource.versionId,
            assetId: uiSource.assetId,
          },
        };
        const browserWorker = await mf.getWorker('matching-rules-test');
        browserResult = await runMatchingRulesBrowserChecks({
          worker: browserWorker,
          defaultWorker,
          base,
          owner,
          cookies,
          db,
          request,
          fixture: browserFixture,
        });
        assert.deepEqual(browserResult, {
          defaultOffHidden: true,
          lateScopeIdentityPrivacy: true,
          controlsAndExplicitFreshConfirmation: true,
          lostReplyExactReplayKeepsCurrentProfile: true,
          indexConflictRefreshAndBoundedBatch: true,
          previewAndReservationCarryProfile: true,
          r2TransferPerformed: false,
          screenshots: browserResult.screenshots,
        });
        assert.equal(browserResult.r2TransferPerformed, false);
      },
    );

    const fixture = {
      workspaceId,
      project: { ...uiProject, mode: 'auto_filename' },
      album: uiAlbum,
      profile: uiProfile,
      indexStatus: await readIndex(uiAlbum).then((result) => result.body),
      siblingProject,
      source: {
        uploadSessionId: uiSource.session.id,
        filename: uiSource.filename,
        photoId: uiSource.photoId,
        versionId: uiSource.versionId,
        assetId: uiSource.assetId,
      },
      apiProject: project,
      apiAlbum: album,
      cases: Object.fromEntries(
        Object.entries(real)
          .filter(
            ([, value]) => value && typeof value === 'object' && value.photoId,
          )
          .map(([key, value]) => [
            key,
            {
              photoId: value.photoId,
              versionId: value.versionId,
              filename: value.filename,
            },
          ]),
      ),
      history: {
        photoId: real.family?.photoId,
        versionCount: real.historyVersionCount,
      },
      browser: browserResult,
    };
    return fixture;
  } finally {
    for (const sessionId of unissuedSessions) {
      try {
        await cancelUnissued(sessionId);
      } catch {
        // Keep the original assertion as the runner failure; cleanup is best effort.
      }
    }
  }
}

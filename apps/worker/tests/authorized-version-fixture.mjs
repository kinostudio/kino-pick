import { randomUUID } from 'node:crypto';

const imageExtensions = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Append a V2+ metadata fixture through the same D1 authorization and completion
 * command path as a real upload. It deliberately does not create the R2 object;
 * callers using this helper exercise metadata-only Guest APIs.
 */
export async function appendAuthorizedVersionFixture({
  db,
  owner,
  photoId,
  versionId: requestedVersionId,
  parentVersionId: expectedParentVersionId,
  versionNo: expectedVersionNo,
  sha256,
  byteSize,
  mime,
  width,
  height,
}) {
  if (!imageExtensions[mime]) throw new Error('Unsupported fixture image MIME');
  if (!/^[0-9a-f]{64}$/u.test(sha256))
    throw new Error('Fixture checksum must be lowercase SHA-256 hex');
  if (!Number.isSafeInteger(byteSize) || byteSize < 1)
    throw new Error('Fixture byte size must be a positive safe integer');
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    width > 32768 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    height > 32768 ||
    width * height > 80000000
  )
    throw new Error('Fixture dimensions are outside the upload bounds');

  const scope = await db
    .prepare(
      "SELECT p.workspace_id,p.project_id,p.album_id,\n        h.version_id AS current_version_id,h.revision AS current_revision,\n        (SELECT COALESCE(MAX(v.version_no),0)+1\n          FROM photo_versions v WHERE v.photo_id=p.id) AS next_version_no,\n        s.id AS session_id\n      FROM photos p\n      JOIN workspaces w ON w.id=p.workspace_id AND w.owner_user_id=?\n      JOIN owners o ON o.user_id=w.owner_user_id AND o.enabled=1\n      JOIN owner_sessions s ON s.userId=o.user_id\n        AND s.expiresAt>unixepoch('subsec')*1000\n      JOIN projects pr ON pr.id=p.project_id AND pr.workspace_id=p.workspace_id\n      JOIN albums al ON al.id=p.album_id AND al.project_id=p.project_id\n        AND al.workspace_id=p.workspace_id\n      JOIN photo_version_heads h ON h.photo_id=p.id\n        AND h.workspace_id=p.workspace_id AND h.project_id=p.project_id\n        AND h.album_id=p.album_id\n      WHERE p.id=? AND pr.status NOT IN('archived','deleting','deleted')\n        AND al.state NOT IN('archived','deleting','deleted')\n      ORDER BY s.expiresAt DESC,s.id DESC\n      LIMIT 1",
    )
    .bind(owner, photoId)
    .first();
  if (!scope) throw new Error('No current Owner/photo/head scope for fixture');
  if (
    expectedParentVersionId !== undefined &&
    expectedParentVersionId !== scope.current_version_id
  )
    throw new Error('Fixture parent must be the captured current head');
  const parentVersionId = scope.current_version_id;
  const versionNo = Number(scope.next_version_no);
  if (
    expectedVersionNo !== undefined &&
    Number(expectedVersionNo) !== versionNo
  )
    throw new Error('Fixture version number is not the next allocated number');

  const uploadSessionId = randomUUID();
  const initRequestId = randomUUID();
  const authorizeRequestId = randomUUID();
  const completeRequestId = randomUUID();
  const versionId = requestedVersionId ?? randomUUID();
  const assetId = randomUUID();
  const nowMs = Math.floor(Date.now() / 1000) * 1000;
  const originalFilename =
    'authorized-fixture-' + uploadSessionId + '.' + imageExtensions[mime];
  const objectKey = [
    scope.workspace_id,
    scope.project_id,
    scope.album_id,
    uploadSessionId,
    'original',
  ].join('/');
  const payloadJson = JSON.stringify({
    workspaceId: scope.workspace_id,
    projectId: scope.project_id,
    albumId: scope.album_id,
    originalFilename,
    expectedBytes: byteSize,
    contentType: mime,
    sha256,
    versionTarget: {
      photoId,
      parentVersionId,
      expectedRevision: Number(scope.current_revision),
      changeType: 'replace_current',
      changeNote: 'Authorized metadata fixture',
      labels: [],
      confirm: true,
    },
  });
  const workflowPayloadJson = JSON.stringify({ uploadSessionId });

  await db.batch([
    db
      .prepare(
        'INSERT INTO upload_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,workspace_id,project_id,album_id,storage_node_id,object_key,original_filename,expected_bytes,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        owner,
        initRequestId,
        'upload.reserved',
        payloadJson,
        scope.session_id,
        uploadSessionId,
        scope.workspace_id,
        scope.project_id,
        scope.album_id,
        'primary',
        objectKey,
        originalFilename,
        byteSize,
        nowMs,
      ),
    db
      .prepare(
        'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,signed_at_ms,expires_at_ms,content_type,sha256_hex) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        owner,
        authorizeRequestId,
        'upload.authorized',
        workflowPayloadJson,
        scope.session_id,
        uploadSessionId,
        nowMs,
        nowMs,
        nowMs + 600000,
        mime,
        sha256,
      ),
    db
      .prepare(
        'INSERT INTO upload_workflow_requests(actor_id,request_id,operation,payload_json,session_id,upload_session_id,created_at_ms,content_type,sha256_hex,actual_bytes,photo_id,version_id,asset_id,image_width,image_height) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        owner,
        completeRequestId,
        'upload.completed',
        workflowPayloadJson,
        scope.session_id,
        uploadSessionId,
        nowMs,
        mime,
        sha256,
        byteSize,
        photoId,
        versionId,
        assetId,
        width,
        height,
      ),
  ]);

  const completion = await db
    .prepare(
      'SELECT upload_session_id,actor_id,request_id,workspace_id,project_id,album_id,photo_id,version_id,asset_id,parent_version_id,version_no,actual_bytes,content_type,sha256_hex,image_width,image_height FROM upload_version_completions WHERE upload_session_id=?',
    )
    .bind(uploadSessionId)
    .first();
  if (!completion)
    throw new Error('Authorized version fixture did not complete');
  if (completion.version_id !== versionId)
    throw new Error(
      'Authorized version fixture changed its requested version ID',
    );
  if (completion.version_no !== versionNo)
    throw new Error(
      'Authorized version fixture allocated an unexpected number',
    );

  return {
    ...completion,
    uploadSessionId,
    initRequestId,
    authorizeRequestId,
    completeRequestId,
    objectKey,
    changeType: 'replace_current',
    changeNote: 'Authorized metadata fixture',
  };
}

/** SQL fragment used inside the same authorized thread snapshot. */
export function commentProcessingSnapshotSql(alias: string): string {
  if (alias !== 'ps') throw new Error('INVALID_PROCESSING_ALIAS');
  return `json_object('state',ps.state,'revision',ps.revision,
    'commentRevision',ps.comment_revision,'contentRevision',ps.content_revision,
    'updatedAt',CASE WHEN ps.updated_at_ms IS NULL THEN NULL ELSE
      strftime('%Y-%m-%dT%H:%M:%fZ',ps.updated_at_ms/1000.0,'unixepoch') END,
    'stale',json(CASE WHEN ps.stale=1 THEN 'true' ELSE 'false' END))`;
}

export function decodeCommentProcessingSnapshot(
  value: string | null,
  author: 'guest' | 'owner' | null,
): unknown {
  if (author === 'owner' && value === null) return null;
  if (author !== 'guest' || value === null)
    throw new Error('INVALID_PROCESSING_SNAPSHOT');
  return JSON.parse(value) as unknown;
}

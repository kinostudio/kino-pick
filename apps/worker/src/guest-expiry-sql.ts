const sqlAlias = /^[a-z_][a-z0-9_]*$/i;
const qualifiedColumn = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i;

export function guestInviteAlbumExpiryCondition(
  inviteAlias: string,
  albumIdExpression: string,
): string {
  if (!sqlAlias.test(inviteAlias)) throw new TypeError('Invalid invite alias');
  if (!qualifiedColumn.test(albumIdExpression))
    throw new TypeError('Invalid album ID expression');

  return `EXISTS (
    SELECT 1
    FROM effective_guest_invite_album_expiry __guest_expiry
    WHERE __guest_expiry.invite_id=${inviteAlias}.id
      AND __guest_expiry.workspace_id=${inviteAlias}.workspace_id
      AND __guest_expiry.project_id=${inviteAlias}.project_id
      AND __guest_expiry.album_id=${albumIdExpression}
      AND __guest_expiry.expiry_valid=1
  )`;
}

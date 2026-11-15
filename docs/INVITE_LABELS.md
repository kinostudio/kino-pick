# Invite labels

Migration `0070_invite_labels.sql` adds an immutable `guest_invite_labels` sidecar. Labels are written in the same D1 batch as the existing invite creation command; the insert trigger requires the matching committed command payload, invite/project/workspace scope, and a currently enabled Owner session. Existing invites have no label and remain unchanged.

To stop creating labels, stop sending optional `clientLabel` in invite requests. Keep the table and its rows: deleting labels or changing the existing invite command would break immutable creation history. Re-enable by restoring the request field and the label-aware readers; no reverse migration is supported.

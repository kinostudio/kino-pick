-- Narrow indexes for the Guest's own activity feed. No rows or audit history are rewritten.
CREATE INDEX audit_guest_history_actor_time
  ON audit_events(actor_id,workspace_id,project_id,occurred_at_utc DESC,event_id DESC)
  WHERE actor_type='guest' AND action IN(
    'selection.added','selection.removed','selection.version_changed','selection.submitted',
    'rating.set','rating.cleared','favorite.added','favorite.removed',
    'tag.added','tag.removed','shared_selection.added','shared_selection.removed',
    'shared_selection.version_changed','shared_selection.submitted'
  );

CREATE INDEX audit_guest_history_album_time
  ON audit_events(actor_id,workspace_id,project_id,album_id,occurred_at_utc DESC,event_id DESC)
  WHERE actor_type='guest' AND action IN(
    'selection.added','selection.removed','selection.version_changed','selection.submitted',
    'rating.set','rating.cleared','favorite.added','favorite.removed',
    'tag.added','tag.removed','shared_selection.added','shared_selection.removed',
    'shared_selection.version_changed','shared_selection.submitted'
  );

CREATE INDEX audit_guest_history_photo_time
  ON audit_events(actor_id,workspace_id,project_id,album_id,photo_id,occurred_at_utc DESC,event_id DESC)
  WHERE actor_type='guest' AND action IN(
    'selection.added','selection.removed','selection.version_changed','selection.submitted',
    'rating.set','rating.cleared','favorite.added','favorite.removed',
    'tag.added','tag.removed','shared_selection.added','shared_selection.removed',
    'shared_selection.version_changed','shared_selection.submitted'
  );
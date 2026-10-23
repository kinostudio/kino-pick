-- Album protection only; no retention enablement or deletion workflow.
create function public.set_album_protection(p_album_id uuid,p_is_pinned boolean,p_legal_hold boolean,
 p_expected_revision integer,p_confirm_unprotect boolean,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_oauth_user(); workspace uuid; body jsonb; replay jsonb;
 target public.albums%rowtype; prior jsonb;
begin
 if p_album_id is null or p_is_pinned is null or p_legal_hold is null or p_request_id is null
 or p_confirm_unprotect is null or p_expected_revision is null or p_expected_revision<1 then raise exception 'INVALID_INPUT'; end if;
 body:=jsonb_build_object('albumId',p_album_id,'isPinned',p_is_pinned,'legalHold',p_legal_hold,
  'expectedRevision',p_expected_revision,'confirmUnprotect',p_confirm_unprotect);
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 select workspace_id into workspace from public.albums where id=p_album_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 -- Shared workspace lock serializes role/owner checks and all content operations.
 perform kino_private.lock_content_workspace(workspace);
 if not exists(select 1 from public.workspaces where id=workspace and owner_user_id=actor) then
  raise exception 'FORBIDDEN_SCOPE';
 end if;
 -- Authorization always precedes idempotent replay; replay never restores old state.
 replay:=kino_private.content_replay(actor,p_request_id,'album.protection_changed',body);
 if replay is not null then return replay; end if;
 select * into target from public.albums where id=p_album_id and workspace_id=workspace for no key update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if target.revision<>p_expected_revision then raise exception 'CONCURRENT_MODIFICATION'; end if;
 if target.state in ('deleting','deleted') then raise exception 'RESOURCE_NOT_EDITABLE'; end if;
 if ((target.is_pinned and not p_is_pinned) or (target.legal_hold and not p_legal_hold)) and not p_confirm_unprotect then
  raise exception 'PROTECTION_CONFIRMATION_REQUIRED';
 end if;
 prior:=kino_private.album_json(target);
 update public.albums set is_pinned=p_is_pinned,legal_hold=p_legal_hold,revision=revision+1
 where id=target.id returning * into target;
 return kino_private.record_content_change(actor,workspace,'album.protection_changed',target.id,prior,
  kino_private.album_json(target),p_request_id,body);
end;
$$;
revoke all on function public.set_album_protection(uuid,boolean,boolean,integer,boolean,uuid) from public,anon,authenticated;
grant execute on function public.set_album_protection(uuid,boolean,boolean,integer,boolean,uuid) to authenticated;

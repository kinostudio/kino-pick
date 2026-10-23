-- Reversible metadata archive for empty content only. Never deletes assets.
alter table public.projects add column archived_from_status text
 check(archived_from_status in ('draft','delivered')),
 add constraint project_archive_origin_only_when_archived check(status='archived' or archived_from_status is null);
alter table public.albums add column archived_from_state text
 check(archived_from_state='draft'),
 add constraint album_archive_origin_only_when_archived check(state='archived' or archived_from_state is null);

create function public.set_content_archived(p_kind text,p_resource_id uuid,p_archived boolean,
 p_expected_revision integer,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_oauth_user(); workspace uuid; body jsonb; replay jsonb; op text;
 project_row public.projects%rowtype; album_row public.albums%rowtype; prior jsonb;
begin
 if p_kind is null or p_kind not in ('project','album') or p_resource_id is null or p_archived is null
 or p_expected_revision is null or p_expected_revision<1 or p_request_id is null then raise exception 'INVALID_INPUT'; end if;
 op:=p_kind||case when p_archived then '.archived' else '.restored' end;
 body:=jsonb_build_object('kind',p_kind,'resourceId',p_resource_id,'archived',p_archived,'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 if p_kind='project' then select workspace_id into workspace from public.projects where id=p_resource_id;
 else select workspace_id into workspace from public.albums where id=p_resource_id; end if;
 if workspace is null then raise exception 'NOT_FOUND'; end if;
 perform kino_private.lock_content_workspace(workspace);
 if not exists(select 1 from public.workspaces where id=workspace and owner_user_id=actor) then raise exception 'FORBIDDEN_SCOPE'; end if;
 replay:=kino_private.content_replay(actor,p_request_id,op,body);
 if replay is not null then return replay; end if;
 if p_kind='project' then
  select * into project_row from public.projects where id=p_resource_id and workspace_id=workspace for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if project_row.revision<>p_expected_revision then raise exception 'CONCURRENT_MODIFICATION'; end if;
  if p_archived then
   if project_row.status not in ('draft','delivered') then raise exception 'INVALID_STATE_TRANSITION'; end if;
   if exists(select 1 from public.albums where workspace_id=workspace and project_id=project_row.id and state not in ('draft','archived'))
    or exists(select 1 from public.photos where workspace_id=workspace and project_id=project_row.id) then raise exception 'CONTENT_NOT_EMPTY_OR_IDLE'; end if;
  elsif project_row.status<>'archived' or project_row.archived_from_status is null then raise exception 'INVALID_STATE_TRANSITION'; end if;
  prior:=kino_private.project_json(project_row);
  update public.projects set status=case when p_archived then 'archived' else archived_from_status end,
   archived_from_status=case when p_archived then status else null end,revision=revision+1 where id=project_row.id returning * into project_row;
  return kino_private.record_content_change(actor,workspace,op,project_row.id,prior,kino_private.project_json(project_row),p_request_id,body);
 else
  -- Shared workspace lock is taken before parent and child row locks everywhere.
  select p.* into project_row from public.projects p join public.albums a on a.project_id=p.id and a.workspace_id=p.workspace_id
   where a.id=p_resource_id for no key update of p;
  if project_row.status='archived' then raise exception 'RESOURCE_NOT_EDITABLE'; end if;
  select * into album_row from public.albums where id=p_resource_id and workspace_id=workspace for no key update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if album_row.revision<>p_expected_revision then raise exception 'CONCURRENT_MODIFICATION'; end if;
  if p_archived then
   if album_row.state<>'draft' then raise exception 'INVALID_STATE_TRANSITION'; end if;
   if project_row.status not in ('draft','delivered') or exists(select 1 from public.photos where workspace_id=workspace and album_id=album_row.id) then
    raise exception 'CONTENT_NOT_EMPTY_OR_IDLE'; end if;
  elsif album_row.state<>'archived' or album_row.archived_from_state is null then raise exception 'INVALID_STATE_TRANSITION'; end if;
  prior:=kino_private.album_json(album_row);
  update public.albums set state=case when p_archived then 'archived' else archived_from_state end,
   archived_from_state=case when p_archived then state else null end,revision=revision+1 where id=album_row.id returning * into album_row;
  return kino_private.record_content_change(actor,workspace,op,album_row.id,prior,kino_private.album_json(album_row),p_request_id,body);
 end if;
end;
$$;
revoke all on function public.set_content_archived(text,uuid,boolean,integer,uuid) from public,anon,authenticated;
grant execute on function public.set_content_archived(text,uuid,boolean,integer,uuid) to authenticated;

-- Preserve all old input/auth/replay/audit logic; add archive guards after replay.
create or replace function public.rename_project(p_project_id uuid,p_name text,p_expected_revision integer,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_google_user(); workspace uuid; body jsonb; replay jsonb;
 target public.projects%rowtype; prior jsonb;
begin
 if p_project_id is null or p_request_id is null or p_name is null or char_length(kino_private.content_name(p_name)) not between 1 and 160
 or p_expected_revision is null or p_expected_revision<1 then raise exception 'INVALID_INPUT'; end if;
 body:=jsonb_build_object('projectId',p_project_id,'name',kino_private.content_name(p_name),'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 select workspace_id into workspace from public.projects where id=p_project_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 perform kino_private.lock_content_workspace(workspace);
 replay:=kino_private.content_replay(actor,p_request_id,'project.renamed',body);
 if replay is not null then return replay; end if;
 select * into target from public.projects where id=p_project_id and workspace_id=workspace for no key update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if target.revision<>p_expected_revision then raise exception 'CONCURRENT_MODIFICATION'; end if;
 if target.status='archived' then raise exception 'RESOURCE_NOT_EDITABLE'; end if;
 prior:=kino_private.project_json(target);
 update public.projects set name=kino_private.content_name(p_name),revision=revision+1 where id=target.id returning * into target;
 return kino_private.record_content_change(actor,workspace,'project.renamed',target.id,prior,kino_private.project_json(target),p_request_id,body);
end;
$$;
create or replace function public.create_album(p_project_id uuid,p_name text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_google_user(); workspace uuid; body jsonb; replay jsonb;
 target public.albums%rowtype;
begin
 if p_project_id is null or p_request_id is null or p_name is null or char_length(kino_private.content_name(p_name)) not between 1 and 160 then raise exception 'INVALID_INPUT'; end if;
 body:=jsonb_build_object('projectId',p_project_id,'name',kino_private.content_name(p_name));
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 select workspace_id into workspace from public.projects where id=p_project_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 perform kino_private.lock_content_workspace(workspace);
 replay:=kino_private.content_replay(actor,p_request_id,'album.created',body);
 if replay is not null then return replay; end if;
 perform 1 from public.projects where id=p_project_id and workspace_id=workspace for no key update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if exists(select 1 from public.projects where id=p_project_id and status='archived') then raise exception 'RESOURCE_NOT_EDITABLE'; end if;
 insert into public.albums(workspace_id,project_id,name) values(workspace,p_project_id,kino_private.content_name(p_name)) returning * into target;
 return kino_private.record_content_change(actor,workspace,'album.created',target.id,null,kino_private.album_json(target),p_request_id,body);
end;
$$;
create or replace function public.rename_album(p_album_id uuid,p_name text,p_expected_revision integer,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_google_user(); workspace uuid; body jsonb; replay jsonb;
 target public.albums%rowtype; prior jsonb;
begin
 if p_album_id is null or p_request_id is null or p_name is null or char_length(kino_private.content_name(p_name)) not between 1 and 160
 or p_expected_revision is null or p_expected_revision<1 then raise exception 'INVALID_INPUT'; end if;
 body:=jsonb_build_object('albumId',p_album_id,'name',kino_private.content_name(p_name),'expectedRevision',p_expected_revision);
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 select workspace_id into workspace from public.albums where id=p_album_id;
 if not found then raise exception 'NOT_FOUND'; end if;
 perform kino_private.lock_content_workspace(workspace);
 replay:=kino_private.content_replay(actor,p_request_id,'album.renamed',body);
 if replay is not null then return replay; end if;
 select * into target from public.albums where id=p_album_id and workspace_id=workspace for no key update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if target.revision<>p_expected_revision then raise exception 'CONCURRENT_MODIFICATION'; end if;
 if target.state in ('archived','deleting','deleted') or exists(select 1 from public.projects where id=target.project_id and status='archived') then raise exception 'RESOURCE_NOT_EDITABLE'; end if;
 prior:=kino_private.album_json(target);
 update public.albums set name=kino_private.content_name(p_name),revision=revision+1 where id=target.id returning * into target;
 return kino_private.record_content_change(actor,workspace,'album.renamed',target.id,prior,kino_private.album_json(target),p_request_id,body);
end;
$$;

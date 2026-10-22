-- Additive M1-02: create/list/rename only. No deletion, publication or retention controls.
alter table public.projects add column revision integer not null default 1 check(revision > 0);
alter table public.albums add column revision integer not null default 1 check(revision > 0);
create index albums_project_page on public.albums(workspace_id,project_id,created_at desc,id desc);

-- Tenant/parent associations are immutable even for direct maintenance UPDATEs.
create function kino_private.prevent_content_reparent() returns trigger
 language plpgsql set search_path='' as $$
begin
 if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id then
  raise exception 'IMMUTABLE_PARENT';
 end if;
 if tg_table_name = 'albums' then
  if new.project_id is distinct from old.project_id then raise exception 'IMMUTABLE_PARENT'; end if;
 end if;
 return new;
end;
$$;
create trigger project_parent_immutable before update on public.projects
 for each row execute function kino_private.prevent_content_reparent();
create trigger album_parent_immutable before update on public.albums
 for each row execute function kino_private.prevent_content_reparent();

-- Match JavaScript String.trim whitespace and PostgreSQL code-point length;
-- direct authenticated RPC callers cannot create names the response contract rejects.
create function kino_private.content_name(value text) returns text
 language sql immutable set search_path='' as $$
 select btrim(value,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
create function kino_private.project_json(p public.projects) returns jsonb
 language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'workspaceId',p.workspace_id,'name',p.name,'status',p.status,
  'versioningMode',p.versioning_mode,'revision',p.revision,'createdAt',p.created_at);
$$;
create function kino_private.album_json(a public.albums) returns jsonb
 language sql stable set search_path='' as $$
 select jsonb_build_object('id',a.id,'workspaceId',a.workspace_id,'projectId',a.project_id,'name',a.name,
  'state',a.state,'isPinned',a.is_pinned,'legalHold',a.legal_hold,'revision',a.revision,'createdAt',a.created_at);
$$;
-- Lock order: request advisory, workspace, resource. Membership mutation takes
-- the same workspace row lock, giving revocation and content writes a definite order.
create function kino_private.lock_content_workspace(target uuid) returns void
 language plpgsql set search_path='' as $$
declare actor uuid := kino_private.require_google_user(); owner_id uuid; member_role text;
begin
 select owner_user_id into owner_id from public.workspaces where id=target for no key update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if owner_id=actor then return; end if;
 select role into member_role from public.workspace_members
  where workspace_id=target and user_id=actor and status='active';
 if not found then raise exception 'NOT_FOUND'; end if;
 if member_role not in ('workspace_editor','photographer') then raise exception 'FORBIDDEN_SCOPE'; end if;
end;
$$;
create function kino_private.content_replay(actor uuid,req uuid,op text,body jsonb) returns jsonb
 language plpgsql set search_path='' as $$
declare existing kino_private.workspace_requests%rowtype;
begin
 select * into existing from kino_private.workspace_requests where actor_id=actor and request_id=req;
 if not found then return null; end if;
 if existing.operation<>op or existing.payload<>body then raise exception 'REQUEST_ID_CONFLICT'; end if;
 return existing.result;
end;
$$;
create function kino_private.record_content_change(actor uuid,workspace uuid,op text,resource uuid,
 before_value jsonb,after_value jsonb,req uuid,body jsonb) returns jsonb
 language plpgsql set search_path='' as $$
begin
 insert into public.audit_logs(workspace_id,actor_id,operation,resource_id,before_json,after_json,request_id)
 values(workspace,actor,op,resource,before_value,after_value,req);
 insert into kino_private.workspace_requests(actor_id,request_id,operation,payload,result)
 values(actor,req,op,body,after_value);
 return after_value;
end;
$$;

create function public.create_project(p_workspace_id uuid,p_name text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_google_user(); body jsonb; replay jsonb; target public.projects%rowtype;
begin
 if p_workspace_id is null or p_request_id is null or p_name is null or char_length(kino_private.content_name(p_name)) not between 1 and 160 then raise exception 'INVALID_INPUT'; end if;
 body:=jsonb_build_object('workspaceId',p_workspace_id,'name',kino_private.content_name(p_name));
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 perform kino_private.lock_content_workspace(p_workspace_id);
 replay:=kino_private.content_replay(actor,p_request_id,'project.created',body);
 if replay is not null then return replay; end if;
 insert into public.projects(workspace_id,name) values(p_workspace_id,kino_private.content_name(p_name)) returning * into target;
 return kino_private.record_content_change(actor,p_workspace_id,'project.created',target.id,null,kino_private.project_json(target),p_request_id,body);
end;
$$;
create function public.rename_project(p_project_id uuid,p_name text,p_expected_revision integer,p_request_id uuid) returns jsonb
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
 prior:=kino_private.project_json(target);
 update public.projects set name=kino_private.content_name(p_name),revision=revision+1 where id=target.id returning * into target;
 return kino_private.record_content_change(actor,workspace,'project.renamed',target.id,prior,kino_private.project_json(target),p_request_id,body);
end;
$$;
create function public.create_album(p_project_id uuid,p_name text,p_request_id uuid) returns jsonb
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
 insert into public.albums(workspace_id,project_id,name) values(workspace,p_project_id,kino_private.content_name(p_name)) returning * into target;
 return kino_private.record_content_change(actor,workspace,'album.created',target.id,null,kino_private.album_json(target),p_request_id,body);
end;
$$;
create function public.rename_album(p_album_id uuid,p_name text,p_expected_revision integer,p_request_id uuid) returns jsonb
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
 prior:=kino_private.album_json(target);
 update public.albums set name=kino_private.content_name(p_name),revision=revision+1 where id=target.id returning * into target;
 return kino_private.record_content_change(actor,workspace,'album.renamed',target.id,prior,kino_private.album_json(target),p_request_id,body);
end;
$$;
-- Remove explicit anon grants as well as PUBLIC defaults on hosted Supabase.
revoke all on function public.create_project(uuid,text,uuid),public.rename_project(uuid,text,integer,uuid),
 public.create_album(uuid,text,uuid),public.rename_album(uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.create_project(uuid,text,uuid),public.rename_project(uuid,text,integer,uuid),
 public.create_album(uuid,text,uuid),public.rename_album(uuid,text,integer,uuid) to authenticated;
revoke all on all functions in schema kino_private from public,anon,authenticated;

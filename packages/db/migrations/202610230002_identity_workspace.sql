-- Additive only. RPCs run with the caller's verified auth.uid(), never a supplied actor.
create schema if not exists kino_private;
revoke all on schema kino_private from public, anon, authenticated;
create table kino_private.workspace_requests (
 actor_id uuid not null references auth.users(id), request_id uuid not null,
 operation text not null, payload jsonb not null, result jsonb not null,
 primary key(actor_id, request_id)
);
alter table kino_private.workspace_requests enable row level security;
create table public.audit_logs (
 id uuid primary key default gen_random_uuid(), workspace_id uuid references public.workspaces(id),
 actor_id uuid not null references auth.users(id), operation text not null, resource_id uuid not null,
 before_json jsonb, after_json jsonb, occurred_at timestamptz not null default now(),
 request_id uuid not null, unique(actor_id,request_id,operation)
);
alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from public, anon, authenticated;
grant select on public.audit_logs to authenticated;
create index audit_logs_workspace_time on public.audit_logs(workspace_id,occurred_at desc,id desc);
create function public.is_workspace_owner(target uuid) returns boolean
 language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspaces where id=target and owner_user_id=(select auth.uid()));
$$;
revoke all on function public.is_workspace_owner(uuid) from public;
grant execute on function public.is_workspace_owner(uuid) to authenticated;
create policy audit_owner_read on public.audit_logs for select to authenticated
 using (public.is_workspace_owner(workspace_id) or (workspace_id is null and actor_id=(select auth.uid())));
create function kino_private.prevent_audit_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'AUDIT_APPEND_ONLY'; end;
$$;
create trigger audit_append_only before update or delete on public.audit_logs for each row execute function kino_private.prevent_audit_mutation();
create function kino_private.require_google_user() returns uuid
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
 if actor is null then raise exception 'AUTH_REQUIRED'; end if;
 if not exists(select 1 from auth.identities where user_id=actor and provider='google') then raise exception 'GOOGLE_IDENTITY_REQUIRED'; end if;
 return actor;
end;
$$;
revoke all on function kino_private.require_google_user() from public;
create function public.ensure_photographer_profile(p_request_id uuid) returns uuid
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_google_user(); inserted uuid;
begin
 if p_request_id is null then raise exception 'INVALID_INPUT'; end if;
 insert into public.profiles(id) values(actor) on conflict(id) do nothing returning id into inserted;
 if inserted is not null then
  insert into public.audit_logs(actor_id,operation,resource_id,after_json,request_id)
   values(actor,'profile.created',actor,jsonb_build_object('id',actor),p_request_id);
 end if;
 return actor;
end;
$$;
revoke all on function public.ensure_photographer_profile(uuid) from public;
grant execute on function public.ensure_photographer_profile(uuid) to authenticated;
create function public.create_workspace(p_name text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_google_user(); existing kino_private.workspace_requests%rowtype;
 target public.workspaces%rowtype; result jsonb; payload jsonb;
begin
 if p_request_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 120 then raise exception 'INVALID_INPUT'; end if;
 payload := jsonb_build_object('name',btrim(p_name));
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 select * into existing from kino_private.workspace_requests where actor_id=actor and request_id=p_request_id;
 if found then
  if existing.operation <> 'workspace.created' or existing.payload <> payload then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return existing.result;
 end if;
 -- Serialize per-user provisioning to enforce an application workspace limit.
 perform 1 from auth.users where id=actor for update;
 if (select count(*) from public.workspaces where owner_user_id=actor) >= 100 then raise exception 'WORKSPACE_LIMIT_REACHED'; end if;
 perform public.ensure_photographer_profile(p_request_id);
 insert into public.workspaces(owner_user_id,name) values(actor,btrim(p_name)) returning * into target;
 insert into public.workspace_members(workspace_id,user_id,role) values(target.id,actor,'workspace_owner');
 result := jsonb_build_object('id',target.id,'name',target.name,'ownerUserId',actor,'role','workspace_owner','createdAt',target.created_at,'quotaBytes',target.quota_bytes);
 insert into public.audit_logs(workspace_id,actor_id,operation,resource_id,after_json,request_id)
 values(target.id,actor,'workspace.created',target.id,result,p_request_id);
 insert into kino_private.workspace_requests values(actor,p_request_id,'workspace.created',payload,result);
 return result;
end;
$$;
revoke all on function public.create_workspace(text,uuid) from public;
grant execute on function public.create_workspace(text,uuid) to authenticated;
create function public.set_workspace_member(p_workspace_id uuid,p_user_id uuid,p_role text,p_status text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_google_user(); owner_id uuid; existing kino_private.workspace_requests%rowtype;
 payload jsonb; result jsonb; prior jsonb;
begin
 if p_workspace_id is null or p_user_id is null or p_request_id is null or p_role is null or p_status is null
 or p_role not in ('workspace_editor','photographer','retoucher') or p_status not in ('active','suspended') then raise exception 'INVALID_INPUT'; end if;
 payload:=jsonb_build_object('workspaceId',p_workspace_id,'userId',p_user_id,'role',p_role,'status',p_status);
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 select owner_user_id into owner_id from public.workspaces where id=p_workspace_id for update;
 if owner_id is null or owner_id<>actor then raise exception 'FORBIDDEN_SCOPE'; end if;
 if p_user_id=owner_id then raise exception 'OWNER_ROLE_IMMUTABLE'; end if;
 select * into existing from kino_private.workspace_requests where actor_id=actor and request_id=p_request_id;
 if found then
  if existing.operation<>'workspace.member_changed' or existing.payload<>payload then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return existing.result;
 end if;
 if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'MEMBER_NOT_FOUND'; end if;
 select jsonb_build_object('role',role,'status',status) into prior from public.workspace_members where workspace_id=p_workspace_id and user_id=p_user_id;
 insert into public.workspace_members(workspace_id,user_id,role,status) values(p_workspace_id,p_user_id,p_role,p_status)
 on conflict(workspace_id,user_id) do update set role=excluded.role,status=excluded.status;
 result:=payload;
 insert into public.audit_logs(workspace_id,actor_id,operation,resource_id,before_json,after_json,request_id)
 values(p_workspace_id,actor,'workspace.member_changed',p_user_id,prior,result,p_request_id);
 insert into kino_private.workspace_requests values(actor,p_request_id,'workspace.member_changed',payload,result);
 return result;
end;
$$;
revoke all on function public.set_workspace_member(uuid,uuid,text,text,uuid) from public;
grant execute on function public.set_workspace_member(uuid,uuid,text,text,uuid) to authenticated;

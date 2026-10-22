-- Preserve existing migration checksums. No data is removed.
-- Block accidental TRUNCATE as well as row mutation; DB administrators can still
-- deliberately disable triggers, so this is not a tamper-proof external archive.
create trigger audit_no_truncate before truncate on public.audit_logs
 for each statement execute function kino_private.prevent_audit_mutation();
-- NO KEY UPDATE still serializes provisioning but is compatible with FK KEY SHARE
-- acquired by a concurrent first-profile insert. No user key is changed here.
create or replace function public.create_workspace(p_name text,p_request_id uuid) returns jsonb
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
 perform 1 from auth.users where id=actor for no key update;
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

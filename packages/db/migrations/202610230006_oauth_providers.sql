-- Add Google/GitHub identities without changing platform user IDs or ownership.
create function kino_private.require_oauth_user() returns uuid
 language plpgsql stable security definer set search_path='' as $$
declare actor uuid := auth.uid();
begin
 if actor is null then raise exception 'AUTH_REQUIRED'; end if;
 if not exists(select 1 from auth.identities where user_id=actor and provider in ('google','github')) then raise exception 'OAUTH_IDENTITY_REQUIRED'; end if;
 return actor;
end;
$$;
-- Compatibility for previously deployed RPC bodies. Historical migrations remain unchanged.
create or replace function kino_private.require_google_user() returns uuid
 language plpgsql stable security definer set search_path='' as $$
begin return kino_private.require_oauth_user(); end;
$$;
revoke all on function kino_private.require_oauth_user(),kino_private.require_google_user() from public,anon,authenticated;

create table kino_private.oauth_link_intents (
 token_hash text primary key check(token_hash ~ '^[0-9a-f]{64}$'),
 actor_id uuid not null references auth.users(id), provider text not null check(provider in ('google','github')),
 request_id uuid not null, created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '10 minutes', completed_at timestamptz,
 unique(actor_id,request_id)
);
alter table kino_private.oauth_link_intents enable row level security;
revoke all on kino_private.oauth_link_intents from public,anon,authenticated;
create function kino_private.link_intent_json(i kino_private.oauth_link_intents) returns jsonb
 language sql stable set search_path='' as $$
 select jsonb_build_object('actorId',i.actor_id,'provider',i.provider,'requestId',i.request_id,'expiresAt',i.expires_at);
$$;
revoke all on function kino_private.link_intent_json(kino_private.oauth_link_intents) from public,anon,authenticated;
create function public.begin_oauth_link(p_provider text,p_token_hash text,p_request_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid := kino_private.require_oauth_user(); existing kino_private.workspace_requests%rowtype;
 target kino_private.oauth_link_intents%rowtype; body jsonb; result jsonb;
begin
 if p_provider is null or p_provider not in ('google','github') or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_request_id is null then raise exception 'INVALID_INPUT'; end if;
 body:=jsonb_build_object('provider',p_provider,'tokenHash',p_token_hash);
 perform pg_advisory_xact_lock(hashtextextended(actor::text||p_request_id::text,0));
 select * into existing from kino_private.workspace_requests where actor_id=actor and request_id=p_request_id;
 if found then
  if existing.operation<>'identity.link_started' or existing.payload<>body then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return existing.result;
 end if;
 perform 1 from auth.users where id=actor for no key update;
 if exists(select 1 from auth.identities where user_id=actor and provider=p_provider) then raise exception 'IDENTITY_ALREADY_LINKED'; end if;
 if (select count(*) from kino_private.oauth_link_intents where actor_id=actor and completed_at is null and expires_at>now())>=5 then raise exception 'LINK_LIMIT_REACHED'; end if;
 insert into kino_private.oauth_link_intents(token_hash,actor_id,provider,request_id) values(p_token_hash,actor,p_provider,p_request_id) returning * into target;
 result:=kino_private.link_intent_json(target);
 insert into public.audit_logs(actor_id,operation,resource_id,after_json,request_id)
 values(actor,'identity.link_started',actor,jsonb_build_object('provider',p_provider),p_request_id);
 insert into kino_private.workspace_requests values(actor,p_request_id,'identity.link_started',body,result);
 return result;
end;
$$;
create function public.read_oauth_link(p_token_hash text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=kino_private.require_oauth_user(); target kino_private.oauth_link_intents%rowtype;
begin
 select * into target from kino_private.oauth_link_intents where token_hash=p_token_hash and actor_id=actor and completed_at is null and expires_at>now();
 if not found then raise exception 'LINK_INTENT_INVALID'; end if;
 return kino_private.link_intent_json(target);
end;
$$;
create function public.complete_oauth_link(p_token_hash text) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare actor uuid:=kino_private.require_oauth_user(); target kino_private.oauth_link_intents%rowtype;
begin
 select * into target from kino_private.oauth_link_intents where token_hash=p_token_hash and actor_id=actor for update;
 if not found then raise exception 'LINK_INTENT_INVALID'; end if;
 if target.completed_at is not null then return kino_private.link_intent_json(target); end if;
 if target.expires_at<=now() then raise exception 'LINK_INTENT_INVALID'; end if;
 if not exists(select 1 from auth.identities where user_id=actor and provider=target.provider) then raise exception 'LINK_NOT_VERIFIED'; end if;
 update kino_private.oauth_link_intents set completed_at=now() where token_hash=p_token_hash;
 insert into public.audit_logs(actor_id,operation,resource_id,after_json,request_id)
 values(actor,'identity.linked',actor,jsonb_build_object('provider',target.provider),target.request_id);
 return kino_private.link_intent_json(target);
end;
$$;
revoke all on function public.begin_oauth_link(text,text,uuid),public.read_oauth_link(text),public.complete_oauth_link(text) from public,anon,authenticated;
grant execute on function public.begin_oauth_link(text,text,uuid),public.read_oauth_link(text),public.complete_oauth_link(text) to authenticated;

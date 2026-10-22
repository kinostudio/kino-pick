-- Applied transactionally by tools/migrate.mjs. No destructive jobs or guest grants.
create table public.profiles (
 id uuid primary key references auth.users(id), display_name text not null default '', locale text not null default 'zh-TW'
);
create table public.workspaces (
 id uuid primary key default gen_random_uuid(), owner_user_id uuid not null references auth.users(id),
 name text not null check(length(trim(name)) between 1 and 120),
 quota_bytes bigint not null default 8000000000 check(quota_bytes > 0),
 autodelete_enabled boolean not null default false check(autodelete_enabled = false),
 retention_dry_run boolean not null default true check(retention_dry_run = true),
 created_at timestamptz not null default now()
);
create table public.workspace_members (
 workspace_id uuid not null references public.workspaces(id), user_id uuid not null references auth.users(id),
 role text not null check(role in ('workspace_owner','workspace_editor','photographer','retoucher')),
 status text not null default 'active' check(status in ('active','suspended')),
 primary key(workspace_id,user_id)
);
-- Function owner must remain the migration administrator, never an app role.
create function public.is_workspace_member(target uuid) returns boolean
 language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.workspace_members m where m.workspace_id = target and m.user_id = (select auth.uid()) and m.status = 'active')
 or exists(select 1 from public.workspaces w where w.id = target and w.owner_user_id = (select auth.uid()));
$$;
revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;
create table public.projects (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id),
 name text not null check(length(trim(name)) between 1 and 160),
 status text not null default 'draft' check(status in ('draft','uploading','selecting','submitted','retouching','reviewing','approved','delivered','archived')),
 versioning_mode text not null default 'manual' check(versioning_mode in ('off','manual','auto_filename','assisted')),
 created_at timestamptz not null default now(), unique(workspace_id,id)
);
create table public.albums (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 160),
 state text not null default 'draft' check(state in ('draft','active','archived','deleting','deleted')),
 is_pinned boolean not null default false, legal_hold boolean not null default false,
 published_at timestamptz, last_valid_viewed_at timestamptz, created_at timestamptz not null default now(),
 foreign key(workspace_id,project_id) references public.projects(workspace_id,id), unique(workspace_id,project_id,id)
);
create table public.photos (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, project_id uuid not null, album_id uuid not null,
 original_filename text not null, canonical_name text not null,
 state text not null default 'pending' check(state in ('pending','ready','deleting','deleted')),
 sort_index integer not null default 0, created_at timestamptz not null default now(),
 foreign key(workspace_id,project_id,album_id) references public.albums(workspace_id,project_id,id)
);
create index projects_workspace on public.projects(workspace_id,created_at,id);
create index albums_workspace_created on public.albums(workspace_id,created_at,id);
create index albums_workspace_viewed on public.albums(workspace_id,last_valid_viewed_at);
create index photos_gallery_page on public.photos(workspace_id,project_id,album_id,sort_index,id);
create index photos_filename_match on public.photos(workspace_id,project_id,album_id,canonical_name);
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;
alter table public.albums enable row level security;
alter table public.photos enable row level security;
-- Phase 0 reads only; writes require future reviewed transactional RPCs.
revoke all on public.profiles, public.workspaces, public.workspace_members, public.projects, public.albums, public.photos from anon, authenticated;
grant select on public.profiles, public.workspaces, public.workspace_members, public.projects, public.albums, public.photos to authenticated;
create policy profile_self on public.profiles for select to authenticated using(id = (select auth.uid()));
create policy workspace_read on public.workspaces for select to authenticated using(public.is_workspace_member(id));
create policy members_read on public.workspace_members for select to authenticated using(public.is_workspace_member(workspace_id));
create policy projects_read on public.projects for select to authenticated using(public.is_workspace_member(workspace_id));
create policy albums_read on public.albums for select to authenticated using(public.is_workspace_member(workspace_id));
create policy photos_read on public.photos for select to authenticated using(public.is_workspace_member(workspace_id));

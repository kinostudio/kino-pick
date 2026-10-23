-- ISOLATED SQLITE PROOF ONLY. Not an application/D1 migration; no Auth/RLS.
-- actor_id is assumed to be supplied by a trusted, separately verified service.
pragma foreign_keys=on;
create table workspaces(id text primary key);
create table members(workspace_id text references workspaces(id),actor_id text,active integer not null check(active in (0,1)),primary key(workspace_id,actor_id));
create table projects(id text primary key,workspace_id text not null references workspaces(id),name text not null,revision integer not null check(revision>0));
create table audit_events(actor_id text,request_id text,project_id text,before_json text not null,after_json text not null,primary key(actor_id,request_id));
create table commands(actor_id text not null,request_id text not null,workspace_id text not null,project_id text not null,expected_revision integer not null,new_name text not null,primary key(actor_id,request_id));
create trigger command_guard before insert on commands begin
 select case when not exists(select 1 from members where workspace_id=new.workspace_id and actor_id=new.actor_id and active=1) then raise(abort,'FORBIDDEN_SCOPE') end;
 select case when not exists(select 1 from projects where id=new.project_id and workspace_id=new.workspace_id) then raise(abort,'NOT_FOUND') end;
 select case when exists(select 1 from commands c where c.actor_id=new.actor_id and c.request_id=new.request_id and (c.workspace_id<>new.workspace_id or c.project_id<>new.project_id or c.expected_revision<>new.expected_revision or c.new_name<>new.new_name)) then raise(abort,'REQUEST_ID_CONFLICT') end;
 -- Authorization precedes replay; IGNORE skips mutation and AFTER triggers.
 select case when exists(select 1 from commands where actor_id=new.actor_id and request_id=new.request_id) then raise(ignore) end;
 select case when (select revision from projects where id=new.project_id)<>new.expected_revision then raise(abort,'CONCURRENT_MODIFICATION') end;
end;
create trigger command_apply after insert on commands begin
 insert into audit_events(actor_id,request_id,project_id,before_json,after_json)
 select new.actor_id,new.request_id,new.project_id,json_object('name',name,'revision',revision),json_object('name',new.new_name,'revision',revision+1) from projects where id=new.project_id and workspace_id=new.workspace_id;
 update projects set name=new.new_name,revision=revision+1 where id=new.project_id and workspace_id=new.workspace_id and revision=new.expected_revision;
end;
create trigger audit_no_update before update on audit_events begin select raise(abort,'AUDIT_APPEND_ONLY');end;
create trigger audit_no_delete before delete on audit_events begin select raise(abort,'AUDIT_APPEND_ONLY');end;

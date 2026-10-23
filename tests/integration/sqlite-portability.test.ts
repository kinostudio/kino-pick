import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, it, expect } from 'vitest';
let db: DatabaseSync;
beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(
    readFileSync(
      new URL(
        '../../experiments/sqlite-portability/schema.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  db.exec(
    "insert into workspaces values('w1'),('w2');insert into members values('w1','a',1),('w2','b',1);insert into projects values('p1','w1','original',1),('p2','w2','private',1)",
  );
});
afterEach(() => db.close());
function command(
  request = 'r1',
  name = 'updated',
  revision = 1,
  actor = 'a',
  workspace = 'w1',
  project = 'p1',
) {
  return db
    .prepare('insert into commands values(?,?,?,?,?,?)')
    .run(actor, request, workspace, project, revision, name);
}
function project() {
  return db.prepare("select name,revision from projects where id='p1'").get();
}
function count(table: 'audit_events' | 'commands') {
  return db.prepare(`select count(*) as n from ${table}`).get()!['n'];
}
it('demonstrates zero-row CAS does not abort a transaction or prevent a false audit', () => {
  db.exec('create table naive_events(message text);begin');
  const result = db
    .prepare(
      "update projects set name='wrong',revision=revision+1 where id='p1' and revision=999",
    )
    .run();
  db.prepare('insert into naive_events values(?)').run(
    'wrongly reported success',
  );
  db.exec('commit');
  expect(result.changes).toBe(0);
  expect(project()).toEqual({ name: 'original', revision: 1 });
  expect(db.prepare('select count(*) as n from naive_events').get()!['n']).toBe(
    1,
  );
});
it('guards revision and emits only the successful mutation/audit', () => {
  expect(command().changes).toBe(1);
  expect(() => command('r2', 'losing update', 1)).toThrow(
    'CONCURRENT_MODIFICATION',
  );
  expect(project()).toEqual({ name: 'updated', revision: 2 });
  expect(count('audit_events')).toBe(1);
  expect(count('commands')).toBe(1);
});
it('replays identically and preserves later state instead of restoring old output', () => {
  command();
  command('r2', 'latest', 2);
  expect(command().changes).toBe(0);
  expect(project()).toEqual({ name: 'latest', revision: 3 });
  expect(count('audit_events')).toBe(2);
  expect(() => command('r1', 'different', 1)).toThrow('REQUEST_ID_CONFLICT');
  expect(count('commands')).toBe(2);
});
it('authorizes the actor and immutable tenant scope before mutation', () => {
  expect(() => command('r1', 'attack', 1, 'b')).toThrow('FORBIDDEN_SCOPE');
  expect(() => command('r1', 'attack', 1, 'a', 'w1', 'p2')).toThrow(
    'NOT_FOUND',
  );
  expect(count('audit_events')).toBe(0);
  expect(project()).toEqual({ name: 'original', revision: 1 });
});
it('denies historical replay after revocation', () => {
  command();
  db.exec("update members set active=0 where actor_id='a'");
  expect(() => command()).toThrow('FORBIDDEN_SCOPE');
  expect(count('audit_events')).toBe(1);
});
it('rolls back command and state if audit insertion fails', () => {
  db.exec(
    "create trigger fail_audit before insert on audit_events begin select raise(abort,'INJECTED_AUDIT_FAILURE');end",
  );
  expect(() => command()).toThrow('INJECTED_AUDIT_FAILURE');
  expect(project()).toEqual({ name: 'original', revision: 1 });
  expect(count('commands')).toBe(0);
  expect(count('audit_events')).toBe(0);
  db.exec('drop trigger fail_audit');
  command();
  expect(project()).toEqual({ name: 'updated', revision: 2 });
});
it('rolls back audit and command if the state mutation fails afterwards', () => {
  db.exec(
    "create trigger fail_update before update on projects begin select raise(abort,'INJECTED_WRITE_FAILURE');end",
  );
  expect(() => command()).toThrow('INJECTED_WRITE_FAILURE');
  expect(count('audit_events')).toBe(0);
  expect(count('commands')).toBe(0);
  expect(project()).toEqual({ name: 'original', revision: 1 });
});
it('binds SQL values and prevents audit rewrites in the isolated model', () => {
  const name = "quote '; DROP TABLE projects; --";
  command('r1', name);
  expect(project()).toEqual({ name, revision: 2 });
  expect(() => db.exec("update audit_events set after_json='{}'")).toThrow(
    'AUDIT_APPEND_ONLY',
  );
  expect(() => db.exec('delete from audit_events')).toThrow(
    'AUDIT_APPEND_ONLY',
  );
});

/**
 * Per-isolate memo for schema readiness probes (tables/triggers present).
 *
 * A probe that once succeeded is remembered for the lifetime of the D1
 * binding object; migrations here only add objects, and a missing object is
 * never cached, so a newly applied migration is still picked up. This keeps
 * sqlite_master scans (~1.5k rows each) out of every request's D1 budget.
 */
const ready = new WeakMap<object, Set<string>>();

export async function schemaReady(
  db: object,
  key: string,
  probe: () => Promise<boolean>,
): Promise<boolean> {
  if (ready.get(db)?.has(key)) return true;
  const ok = await probe();
  if (ok) {
    let keys = ready.get(db);
    if (!keys) {
      keys = new Set();
      ready.set(db, keys);
    }
    keys.add(key);
  }
  return ok;
}

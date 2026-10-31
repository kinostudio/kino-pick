import { unstable_splitSqlQuery } from 'wrangler';

/** Match Wrangler migration transactions without D1's single-statement length limit. */
export async function applyMigration(db, source) {
  return db.batch(unstable_splitSqlQuery(source).map((sql) => db.prepare(sql)));
}

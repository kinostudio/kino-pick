// Local-only wrapper for D1 result metadata. Retain statement identity for batch().
import app from './index.js';
const meteredWorker = {
  async fetch(request, env, ctx) {
    const usage = { read: 0, written: 0, unmetered: 0 };
    const db = env.DB;
    const native = new WeakMap();
    function count(result) {
      usage.read += result.meta.rows_read;
      usage.written += result.meta.rows_written;
      return result;
    }
    function wrap(statement) {
      const view = {
        bind: (...args) => wrap(statement.bind(...args)),
        all: async () => count(await statement.all()),
        run: async () => count(await statement.run()),
        async first(column) {
          const result = count(await statement.all()).results[0];
          return result
            ? column === undefined
              ? result
              : result[column]
            : null;
        },
        async raw(options) {
          // Benchmark ORM reads use positional values and do not request a header row.
          if (options?.columnNames) {
            usage.unmetered++;
            return statement.raw(options);
          }
          return count(await statement.all()).results.map((row) =>
            Object.values(row),
          );
        },
      };
      native.set(view, statement);
      return view;
    }
    const response = await app.fetch(
      request,
      {
        ...env,
        DB: {
          prepare: (sql) => wrap(db.prepare(sql)),
          batch: async (statements) =>
            (await db.batch(statements.map((s) => native.get(s)))).map(count),
        },
      },
      ctx,
    );
    const copy = new Response(response.body, response);
    copy.headers.set('x-bench-d1', JSON.stringify(usage));
    return copy;
  },
};

export default meteredWorker;

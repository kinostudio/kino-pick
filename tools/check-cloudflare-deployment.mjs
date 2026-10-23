import { readFile } from 'node:fs/promises';
import { z } from 'zod';
const stage = z.enum(['staging', 'production']).parse(process.argv[2]);
const readiness = z
  .record(z.string(), z.boolean())
  .parse(
    JSON.parse(
      await readFile(
        new URL('../apps/worker/deployment-readiness.json', import.meta.url),
        'utf8',
      ),
    ),
  );
if (
  Object.keys(readiness).length < 6 ||
  Object.values(readiness).some((value) => !value)
) {
  console.error(
    `Cloudflare ${stage} deployment is blocked: complete and record all migration/security/resource acceptance gates first.`,
  );
  process.exitCode = 1;
} else {
  console.error(
    'Readiness flags alone do not verify resource bindings, credentials or billing; complete the deployment runbook before enabling the CD job.',
  );
  process.exitCode = 1;
}
// Deliberately closed during this foundation phase. Replace this guard only with
// verified resource/schema/provider/restore checks in a reviewed cutover change.

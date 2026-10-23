// Generates an atomic, one-time SQL command; never connects to any environment.
import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
const { values } = parseArgs({
  options: {
    'user-id': { type: 'string' },
    'google-sub': { type: 'string' },
    'github-id': { type: 'string' },
    'verified-subjects': { type: 'boolean', default: false },
    out: { type: 'string' },
  },
});
const user = z.uuid().parse(values['user-id']);
const subject = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9_:-]+$/);
const google = values['google-sub']
  ? subject.parse(values['google-sub'])
  : null;
const github = values['github-id']
  ? z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .parse(values['github-id'])
  : null;
if (!values['verified-subjects'] || (!google && !github) || !values.out)
  throw new Error(
    'Verified provider subjects, existing/new internal user UUID and output path are required',
  );
const quote = (value) =>
  value === null ? 'NULL' : "'" + value.replaceAll("'", "''") + "'";
const output = resolve(values.out);
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `-- Apply ONLY after verifying provider subjects and reviewing the target environment.
INSERT INTO owner_bootstrap(id,user_id,google_subject,github_subject) VALUES(1,${quote(user)},${quote(google)},${quote(github)});
`,
  { encoding: 'utf8', flag: 'wx' },
);
process.stdout.write(
  'Owner bootstrap SQL generated; review the file and target database before applying. No remote operation occurred.\n',
);

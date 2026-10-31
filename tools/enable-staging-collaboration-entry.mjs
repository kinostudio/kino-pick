import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { runReleaseCheck } from './check-staging-collaboration-release.mjs';

const ACCOUNT_ID = 'd3e930465c0df7e89b35de3ca65ea36a';
const WORKER_NAME = 'kino-pic-staging';
const API_BASE = 'https://api.cloudflare.com/client/v4/accounts/' + ACCOUNT_ID;

function requireThat(condition, code) {
  if (!condition) throw new Error(code);
}

function headers() {
  requireThat(
    process.env.CLOUDFLARE_ACCOUNT_ID === ACCOUNT_ID,
    'CLOUDFLARE_ACCOUNT_TARGET',
  );
  const token = process.env.CLOUDFLARE_API_TOKEN;
  requireThat(
    typeof token === 'string' && token.length > 0,
    'CLOUDFLARE_TOKEN_MISSING',
  );
  return {
    Authorization: 'Bearer ' + token,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function request(enabled) {
  const response = await fetch(
    API_BASE + '/workers/scripts/' + WORKER_NAME + '/subdomain',
    {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ enabled, previews_enabled: false }),
      signal: AbortSignal.timeout(20000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error('CLOUDFLARE_ENTRY_HTTP_' + response.status);
  }
  return body.result;
}

async function readEntry() {
  const response = await fetch(
    API_BASE + '/workers/scripts/' + WORKER_NAME + '/subdomain',
    {
      method: 'GET',
      headers: headers(),
      signal: AbortSignal.timeout(20000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw new Error('CLOUDFLARE_ENTRY_READ_HTTP_' + response.status);
  }
  return body.result;
}

async function closeAndVerify() {
  await request(false);
  const entry = await readEntry();
  requireThat(
    entry?.enabled === false && entry?.previews_enabled === false,
    'ENTRY_CLOSE_UNCONFIRMED',
  );
}

async function activate() {
  requireThat(process.argv.length === 2, 'NO_ACTIVATION_ARGUMENTS');
  const verified = await runReleaseCheck('postdeploy');
  let enableAttempted = false;
  try {
    enableAttempted = true;
    await request(true);
    const entry = await readEntry();
    requireThat(
      entry?.enabled === true && entry?.previews_enabled === false,
      'ENTRY_ENABLE_UNCONFIRMED',
    );
    console.log(
      JSON.stringify({
        status: 'passed_scoped_b_entry_activation',
        sourceSha: verified.sourceSha,
        deploymentId: verified.cloudflare.deploymentId,
        versionId: verified.cloudflare.versionId,
        publicEntryEnabled: true,
        previewsEnabled: false,
        dnsChanged: false,
      }),
    );
  } catch (error) {
    if (enableAttempted) {
      try {
        await closeAndVerify();
      } catch {
        console.error(
          JSON.stringify({
            status: 'failed_scoped_b_entry_activation',
            code: 'ENTRY_CLOSE_UNCONFIRMED',
            publicState: 'unknown',
            detailsWithheld: true,
          }),
        );
        process.exitCode = 1;
        return;
      }
    }
    const code = /^[A-Z][A-Z0-9_:-]{2,100}$/.test(error?.message ?? '')
      ? error.message
      : 'ENTRY_ACTIVATION_FAILED';
    console.error(
      JSON.stringify({
        status: 'failed_scoped_b_entry_activation',
        code,
        publicEntryClosed: true,
        detailsWithheld: true,
      }),
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  activate().catch((error) => {
    const code = /^[A-Z][A-Z0-9_:-]{2,100}$/.test(error?.message ?? '')
      ? error.message
      : 'ENTRY_ACTIVATION_FAILED';
    console.error(
      JSON.stringify({
        status: 'failed_scoped_b_entry_activation',
        code,
        detailsWithheld: true,
      }),
    );
    process.exitCode = 1;
  });
}

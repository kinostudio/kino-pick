import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { AwsClient } from 'aws4fetch';
import sharp from 'sharp';

const ACCOUNT_ID = 'd3e930465c0df7e89b35de3ca65ea36a';
const BUCKET_NAME = 'kino-pick-staging-d3e93046';
const WORKSPACE_ID = 'bd927a6d-d5d3-4743-bbae-e4560cdda4c7';
const PROJECT_ID = '08954949-ae90-4353-be2f-ae4a8f40b78d';
const ALBUM_ID = '613487da-e6ff-4ada-9b66-949f21fcfa2c';
const ORIGINAL_LIMIT = 16 * 1024 * 1024;
const DERIVATIVE_LIMIT = 8 * 1024 * 1024;
const MAX_EDGE = { thumbnail: 320, preview: 2048 };
const GET_TIMEOUT_MS = 20_000;
const FIXTURE_DIR_NAME =
  'kino-pick-hosted-acceptance-0e4641a7-e407-4a4f-aba2-fbd469940769';
const FIXTURE_FILENAME_PATTERN = /^kino-acceptance-\d{3}-o(?:1|6)\.jpg$/;
const REQUIRED_ARGS = ['--verify-synthetic-staging-only'];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(scriptDir, '..');
const localDir = path.resolve(workerDir, '.local');
const assetsPath = path.join(localDir, 'hosted-upload-assets.json');
const fixturesPath = path.join(localDir, 'hosted-upload-fixtures.json');
const credentialsPath = path.join(localDir, 'staging-r2-secrets.json');
const proofPath = path.join(localDir, 'hosted-upload-assets-proof.json');
const scopePrefix = WORKSPACE_ID + '/' + PROJECT_ID + '/' + ALBUM_ID + '/';

class VerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'VerificationError';
    this.code = code;
  }
}

function fail(code) {
  throw new VerificationError(code);
}

function assert(condition, code) {
  if (!condition) fail(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isUuid(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function validPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function pathsEqual(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return (
    path.relative(resolvedLeft, resolvedRight) === '' &&
    path.relative(resolvedRight, resolvedLeft) === ''
  );
}

async function resolveFixtureDirectory(value) {
  assert(typeof value === 'string' && value.length > 0, 'FIXTURE_DIR_INVALID');

  let tempRoot;
  try {
    tempRoot = await realpath(tmpdir());
  } catch {
    fail('FIXTURE_DIR_INVALID');
  }

  const expectedDirectory = path.resolve(tempRoot, FIXTURE_DIR_NAME);
  let manifestDirectory;
  const normalizedValue = value.replaceAll('\\', '/');
  if (normalizedValue.startsWith('%TEMP%/')) {
    manifestDirectory = path.resolve(
      tempRoot,
      normalizedValue.slice('%TEMP%/'.length),
    );
  } else {
    manifestDirectory = path.resolve(value);
  }

  assert(
    pathsEqual(manifestDirectory, expectedDirectory),
    'FIXTURE_DIR_INVALID',
  );

  let actualExpectedDirectory;
  let actualManifestDirectory;
  try {
    actualExpectedDirectory = await realpath(expectedDirectory);
    actualManifestDirectory = await realpath(manifestDirectory);
  } catch {
    fail('FIXTURE_DIR_INVALID');
  }

  assert(
    pathsEqual(actualExpectedDirectory, expectedDirectory) &&
      pathsEqual(actualManifestDirectory, expectedDirectory),
    'FIXTURE_DIR_INVALID',
  );
  return expectedDirectory;
}

async function validateFixtureManifest(value) {
  assert(
    isRecord(value) && value.syntheticOnly === true,
    'FIXTURE_SCOPE_INVALID',
  );
  assert(
    Array.isArray(value.files) && value.files.length === 100,
    'FIXTURE_COUNT_INVALID',
  );

  const fixtureDir = await resolveFixtureDirectory(value.dir);
  const bySha = new Map();
  const seenPaths = new Set();

  for (const fixture of value.files) {
    assert(isRecord(fixture), 'FIXTURE_ROW_INVALID');
    assert(
      typeof fixture.path === 'string' && fixture.path.length > 0,
      'FIXTURE_ROW_INVALID',
    );
    assert(
      FIXTURE_FILENAME_PATTERN.test(path.basename(fixture.path)),
      'FIXTURE_PATH_INVALID',
    );
    assert(
      validPositiveInteger(fixture.bytes) && fixture.bytes <= ORIGINAL_LIMIT,
      'FIXTURE_SIZE_INVALID',
    );
    assert(isSha256(fixture.sha256), 'FIXTURE_HASH_INVALID');
    assert(
      validPositiveInteger(fixture.width) &&
        validPositiveInteger(fixture.height) &&
        fixture.width <= 32768 &&
        fixture.height <= 32768 &&
        fixture.width * fixture.height <= 80_000_000,
      'FIXTURE_DIMENSIONS_INVALID',
    );
    assert(
      fixture.orientation === undefined ||
        fixture.orientation === null ||
        (Number.isInteger(fixture.orientation) &&
          fixture.orientation >= 1 &&
          fixture.orientation <= 8),
      'FIXTURE_ORIENTATION_INVALID',
    );

    assert(!fixture.path.includes('\0'), 'FIXTURE_PATH_INVALID');
    const normalizedPath = fixture.path.replaceAll('\\', '/');
    assert(!seenPaths.has(normalizedPath), 'FIXTURE_PATH_DUPLICATE');
    seenPaths.add(normalizedPath);
    assert(!bySha.has(fixture.sha256), 'FIXTURE_HASH_DUPLICATE');
    bySha.set(fixture.sha256, {
      path: fixture.path,
      bytes: fixture.bytes,
      sha256: fixture.sha256,
      width: fixture.width,
      height: fixture.height,
      orientation: fixture.orientation ?? 1,
    });
  }

  assert(bySha.size === 100, 'FIXTURE_HASH_SET_INVALID');
  return { bySha, fixtureDir };
}

async function resolveFixturePath(fixtureDir, value) {
  assert(typeof value === 'string' && value.length > 0, 'FIXTURE_PATH_INVALID');
  const filename = path.basename(value);
  assert(FIXTURE_FILENAME_PATTERN.test(filename), 'FIXTURE_PATH_INVALID');

  const candidate = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(fixtureDir, value);
  assert(
    pathsEqual(path.dirname(candidate), fixtureDir) &&
      path.basename(candidate) === filename,
    'FIXTURE_PATH_INVALID',
  );

  let absolutePath;
  try {
    absolutePath = await realpath(candidate);
  } catch {
    fail('FIXTURE_FILE_UNAVAILABLE');
  }

  assert(
    pathsEqual(path.dirname(absolutePath), fixtureDir) &&
      path.basename(absolutePath) === filename,
    'FIXTURE_PATH_INVALID',
  );
  return absolutePath;
}

async function verifyFixtureFiles(fixturesBySha, fixtureDir) {
  const seenPaths = new Set();
  for (const fixture of fixturesBySha.values()) {
    const absolutePath = await resolveFixturePath(fixtureDir, fixture.path);
    assert(!seenPaths.has(absolutePath), 'FIXTURE_PATH_DUPLICATE');
    seenPaths.add(absolutePath);

    let bytes;
    try {
      bytes = await readFile(absolutePath);
    } catch {
      fail('FIXTURE_FILE_UNAVAILABLE');
    }

    assert(bytes.length === fixture.bytes, 'FIXTURE_FILE_SIZE_MISMATCH');
    assert(sha256(bytes) === fixture.sha256, 'FIXTURE_FILE_HASH_MISMATCH');

    let metadata;
    try {
      metadata = await sharp(bytes, {
        failOn: 'error',
        limitInputPixels: 80_000_000,
      }).metadata();
    } catch {
      fail('FIXTURE_IMAGE_INVALID');
    }

    assert(
      metadata.width === fixture.width &&
        metadata.height === fixture.height &&
        (metadata.orientation ?? 1) === fixture.orientation,
      'FIXTURE_IMAGE_METADATA_MISMATCH',
    );
  }
}

function validateAssetRows(value, fixturesBySha) {
  assert(
    Array.isArray(value) && value.length === 300,
    'ASSET_ROW_COUNT_INVALID',
  );

  const seenKeys = new Set();
  const rows = [];
  const originals = [];
  const derivativesByPhoto = new Map();
  const originalHashes = new Set();
  const originalPhotos = new Set();
  const originalVersions = new Set();

  for (const row of value) {
    assert(isRecord(row), 'ASSET_ROW_INVALID');
    assert(
      row.asset_kind === 'original' ||
        row.asset_kind === 'thumbnail' ||
        row.asset_kind === 'preview',
      'ASSET_KIND_INVALID',
    );
    assert(
      typeof row.object_key === 'string' &&
        row.object_key.startsWith(scopePrefix) &&
        row.object_key.length > scopePrefix.length &&
        !row.object_key.includes('\\') &&
        !row.object_key.includes('\0'),
      'ASSET_SCOPE_INVALID',
    );
    const segments = row.object_key.split('/');
    assert(
      segments.every(
        (segment) => segment !== '' && segment !== '.' && segment !== '..',
      ),
      'ASSET_KEY_INVALID',
    );
    assert(!seenKeys.has(row.object_key), 'ASSET_KEY_DUPLICATE');
    seenKeys.add(row.object_key);

    assert(
      validPositiveInteger(row.byte_size) &&
        row.byte_size <=
          (row.asset_kind === 'original' ? ORIGINAL_LIMIT : DERIVATIVE_LIMIT),
      'ASSET_SIZE_INVALID',
    );
    assert(isSha256(row.checksum_sha256), 'ASSET_HASH_INVALID');
    assert(isUuid(row.photo_id) && isUuid(row.version_id), 'ASSET_ID_INVALID');

    if (Object.hasOwn(row, 'storage_node_id'))
      assert(row.storage_node_id === 'primary', 'ASSET_NODE_INVALID');

    if (Object.hasOwn(row, 'width') || Object.hasOwn(row, 'height')) {
      const hasWidth = validPositiveInteger(row.width);
      const hasHeight = validPositiveInteger(row.height);
      assert(
        hasWidth === hasHeight &&
          (!hasWidth ||
            (row.width <= 32768 &&
              row.height <= 32768 &&
              row.width * row.height <= 80_000_000)),
        'ASSET_DIMENSIONS_INVALID',
      );
    }

    if (row.asset_kind === 'original') {
      assert(
        ['image/jpeg', 'image/png', 'image/webp'].includes(row.mime),
        'ORIGINAL_MIME_INVALID',
      );
      const fixture = fixturesBySha.get(row.checksum_sha256);
      assert(fixture, 'ORIGINAL_FIXTURE_MISSING');
      assert(row.byte_size === fixture.bytes, 'ORIGINAL_FIXTURE_SIZE_MISMATCH');
      assert(
        !originalHashes.has(row.checksum_sha256),
        'ORIGINAL_HASH_DUPLICATE',
      );
      assert(!originalPhotos.has(row.photo_id), 'ORIGINAL_PHOTO_DUPLICATE');
      assert(
        !originalVersions.has(row.version_id),
        'ORIGINAL_VERSION_DUPLICATE',
      );
      originalHashes.add(row.checksum_sha256);
      originalPhotos.add(row.photo_id);
      originalVersions.add(row.version_id);
      originals.push({ row, fixture });
    } else {
      assert(row.mime === 'image/jpeg', 'DERIVATIVE_MIME_INVALID');
      const photoKey = row.photo_id + ':' + row.version_id;
      const group = derivativesByPhoto.get(photoKey) ?? new Map();
      assert(!group.has(row.asset_kind), 'DERIVATIVE_DUPLICATE');
      group.set(row.asset_kind, row);
      derivativesByPhoto.set(photoKey, group);
    }

    rows.push(row);
  }

  assert(originals.length === 100, 'ORIGINAL_COUNT_INVALID');
  assert(originalHashes.size === 100, 'ORIGINAL_HASH_SET_INVALID');
  assert(
    originalHashes.size === fixturesBySha.size,
    'ORIGINAL_HASH_SET_INVALID',
  );
  for (const hash of fixturesBySha.keys())
    assert(originalHashes.has(hash), 'ORIGINAL_HASH_SET_MISMATCH');

  assert(derivativesByPhoto.size === 100, 'DERIVATIVE_PHOTO_COUNT_INVALID');
  const originalsByPhoto = new Map(
    originals.map(({ row, fixture }) => [
      row.photo_id + ':' + row.version_id,
      { row, fixture },
    ]),
  );
  for (const [photoKey, group] of derivativesByPhoto) {
    assert(originalsByPhoto.has(photoKey), 'DERIVATIVE_ORIGINAL_MISSING');
    assert(
      group.has('thumbnail') && group.has('preview') && group.size === 2,
      'DERIVATIVE_PAIR_INVALID',
    );
  }
  for (const key of originalsByPhoto.keys())
    assert(derivativesByPhoto.has(key), 'DERIVATIVE_PAIR_MISSING');

  const counts = {
    original: originals.length,
    thumbnail: 0,
    preview: 0,
  };
  for (const row of rows)
    if (row.asset_kind !== 'original') counts[row.asset_kind] += 1;

  assert(
    counts.original === 100 &&
      counts.thumbnail === 100 &&
      counts.preview === 100,
    'ASSET_KIND_COUNTS_INVALID',
  );

  return { rows, originals, derivativesByPhoto, counts };
}

function manifestDigest(rows) {
  const canonicalRows = [...rows]
    .map((row) => ({
      asset_kind: row.asset_kind,
      object_key: row.object_key,
      byte_size: row.byte_size,
      mime: row.mime,
      checksum_sha256: row.checksum_sha256,
      photo_id: row.photo_id,
      version_id: row.version_id,
      ...(Object.hasOwn(row, 'storage_node_id')
        ? { storage_node_id: row.storage_node_id }
        : {}),
      ...(Object.hasOwn(row, 'width') ? { width: row.width } : {}),
      ...(Object.hasOwn(row, 'height') ? { height: row.height } : {}),
    }))
    .sort((a, b) => a.object_key.localeCompare(b.object_key));
  return sha256(Buffer.from(JSON.stringify(canonicalRows)));
}

async function loadJson(filePath, code) {
  let content;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    fail(code);
  }
  try {
    return JSON.parse(content);
  } catch {
    fail(code);
  }
}

async function loadCredentials() {
  const value = await loadJson(
    credentialsPath,
    'STAGING_CREDENTIALS_UNAVAILABLE',
  );
  assert(isRecord(value), 'STAGING_CREDENTIALS_INVALID');
  assert(value.R2_ACCOUNT_ID === ACCOUNT_ID, 'STAGING_CREDENTIALS_INVALID');
  assert(
    typeof value.R2_ACCESS_KEY_ID === 'string' &&
      value.R2_ACCESS_KEY_ID.length > 0 &&
      typeof value.R2_SECRET_ACCESS_KEY === 'string' &&
      value.R2_SECRET_ACCESS_KEY.length > 0,
    'STAGING_CREDENTIALS_INVALID',
  );
  return {
    accessKeyId: value.R2_ACCESS_KEY_ID,
    secretAccessKey: value.R2_SECRET_ACCESS_KEY,
  };
}

function encodeObjectKey(key) {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function makeEndpoint(key) {
  return (
    'https://' +
    ACCOUNT_ID +
    '.r2.cloudflarestorage.com/' +
    BUCKET_NAME +
    '/' +
    encodeObjectKey(key)
  );
}

async function readBodyBounded(response, maxBytes) {
  const reader = response.body?.getReader();
  assert(reader, 'R2_GET_FAILED');
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      total += chunk.length;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Do not read or expose provider error bodies.
        }
        fail('R2_BYTE_LENGTH_MISMATCH');
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    fail('R2_GET_FAILED');
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

async function getObject(client, row) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
  let response;
  let consumed = false;

  try {
    response = await client.fetch(makeEndpoint(row.object_key), {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) fail('R2_GET_FAILED');

    const contentLength = response.headers.get('content-length');
    assert(
      contentLength !== null &&
        /^[0-9]+$/.test(contentLength) &&
        Number(contentLength) === row.byte_size,
      'R2_CONTENT_LENGTH_MISMATCH',
    );

    const responseMime = response.headers
      .get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (responseMime)
      assert(
        responseMime === row.mime.toLowerCase(),
        'R2_CONTENT_TYPE_MISMATCH',
      );

    const bytes = await readBodyBounded(response, row.byte_size);
    consumed = true;
    assert(bytes.length === row.byte_size, 'R2_BYTE_LENGTH_MISMATCH');
    assert(sha256(bytes) === row.checksum_sha256, 'R2_CHECKSUM_MISMATCH');
    return bytes;
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    fail('R2_GET_FAILED');
  } finally {
    clearTimeout(timer);
    if (response && !consumed) {
      try {
        await response.body?.cancel();
      } catch {
        // Do not read or expose provider error bodies.
      }
    }
  }
}

function orientedFixtureDimensions(fixture) {
  const swapsSides = [5, 6, 7, 8].includes(fixture.orientation);
  return swapsSides
    ? { width: fixture.height, height: fixture.width }
    : { width: fixture.width, height: fixture.height };
}

async function verifyDerivative(row, bytes, fixture) {
  const edge = MAX_EDGE[row.asset_kind];
  let metadata;
  let decoded;
  try {
    metadata = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: 80_000_000,
    }).metadata();
    decoded = await sharp(bytes, {
      failOn: 'error',
      limitInputPixels: 80_000_000,
    })
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    fail('DERIVATIVE_DECODE_FAILED');
  }

  assert(
    metadata.format === 'jpeg' &&
      validPositiveInteger(metadata.width) &&
      validPositiveInteger(metadata.height) &&
      metadata.width <= edge &&
      metadata.height <= edge,
    'DERIVATIVE_IMAGE_INVALID',
  );
  assert(
    metadata.orientation === undefined &&
      metadata.exif === undefined &&
      metadata.icc === undefined &&
      metadata.iptc === undefined &&
      metadata.xmp === undefined,
    'DERIVATIVE_METADATA_PRESENT',
  );
  assert(
    decoded.info.width === metadata.width &&
      decoded.info.height === metadata.height &&
      decoded.info.channels >= 1,
    'DERIVATIVE_FULL_DECODE_INVALID',
  );

  const oriented = orientedFixtureDimensions(fixture);
  const scale = Math.min(1, edge / Math.max(oriented.width, oriented.height));
  assert(
    Math.abs(metadata.width - Math.round(oriented.width * scale)) <= 1 &&
      Math.abs(metadata.height - Math.round(oriented.height * scale)) <= 1,
    'DERIVATIVE_ASPECT_OR_SCALE_INVALID',
  );
  if (oriented.height > oriented.width)
    assert(metadata.height > metadata.width, 'DERIVATIVE_ORIENTATION_INVALID');
  else if (oriented.width > oriented.height)
    assert(metadata.width > metadata.height, 'DERIVATIVE_ORIENTATION_INVALID');
}

async function main() {
  assert(
    process.argv.slice(2).length === REQUIRED_ARGS.length &&
      process.argv.slice(2)[0] === REQUIRED_ARGS[0],
    'USAGE',
  );

  const startedAt = new Date().toISOString();
  const [assetValue, fixtureValue] = await Promise.all([
    loadJson(assetsPath, 'ASSET_MANIFEST_UNAVAILABLE'),
    loadJson(fixturesPath, 'FIXTURE_MANIFEST_UNAVAILABLE'),
  ]);
  const fixtureManifest = await validateFixtureManifest(fixtureValue);
  const fixturesBySha = fixtureManifest.bySha;
  await verifyFixtureFiles(fixturesBySha, fixtureManifest.fixtureDir);
  const manifest = validateAssetRows(assetValue, fixturesBySha);
  const manifestSha256 = manifestDigest(manifest.rows);

  const credentials = await loadCredentials();
  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: 's3',
    region: 'auto',
  });

  let checkedObjects = 0;
  let totalBytes = 0;
  let portraitCount = 0;
  const originalByPhoto = new Map();

  for (const item of manifest.originals) {
    const bytes = await getObject(client, item.row);
    const fixture = item.fixture;
    assert(bytes.length === fixture.bytes, 'ORIGINAL_FIXTURE_SIZE_MISMATCH');
    assert(sha256(bytes) === fixture.sha256, 'ORIGINAL_FIXTURE_HASH_MISMATCH');
    originalByPhoto.set(item.row.photo_id + ':' + item.row.version_id, fixture);
    totalBytes += bytes.length;
    checkedObjects += 1;
    if (checkedObjects % 20 === 0)
      console.log('Verified ' + checkedObjects + '/300 hosted test objects');
  }

  for (const [photoKey, group] of manifest.derivativesByPhoto) {
    const fixture = originalByPhoto.get(photoKey);
    assert(fixture, 'DERIVATIVE_ORIGINAL_MISSING');

    for (const kind of ['thumbnail', 'preview']) {
      const row = group.get(kind);
      assert(row, 'DERIVATIVE_PAIR_MISSING');
      const bytes = await getObject(client, row);
      await verifyDerivative(row, bytes, fixture);
      totalBytes += bytes.length;
      checkedObjects += 1;
      if (
        kind === 'thumbnail' &&
        orientedFixtureDimensions(fixture).height >
          orientedFixtureDimensions(fixture).width
      )
        portraitCount += 1;
      if (checkedObjects % 20 === 0)
        console.log('Verified ' + checkedObjects + '/300 hosted test objects');
    }
  }

  assert(checkedObjects === 300, 'OBJECT_COUNT_INVALID');
  assert(portraitCount > 0, 'PORTRAIT_FIXTURE_NOT_CHECKED');

  const proof = {
    syntheticOnly: true,
    startedAt,
    verifiedAt: new Date().toISOString(),
    checksCount: checkedObjects,
    sourceCount: manifest.counts.original,
    derivedCount: manifest.counts.thumbnail + manifest.counts.preview,
    portraitCount,
    totalBytes,
    manifestSha256,
  };

  try {
    await writeFile(proofPath, JSON.stringify(proof, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'w',
    });
  } catch {
    fail('PROOF_WRITE_FAILED');
  }

  console.log(
    'HOSTED_SYNTHETIC_ASSETS_VERIFIED sources=' +
      proof.sourceCount +
      ' derivatives=' +
      proof.derivedCount +
      ' checks=' +
      proof.checksCount +
      ' portraits=' +
      proof.portraitCount,
  );
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof VerificationError
      ? error.code
      : 'HOSTED_UPLOAD_ASSET_VERIFY_FAILED',
  );
  process.exitCode = 1;
}

import { describe, expect, it } from 'vitest';
import {
  parseS3StorageList,
  validateS3StorageListOptions,
  type S3StorageListOptions,
} from '../../apps/worker/src/s3-storage-list';

const bucketName = 'inventory-test-bucket';
const prefix = '123e4567-e89b-42d3-a456-426614174000/';
const options: S3StorageListOptions = { bucketName, prefix, limit: 100 };
const awsNamespace = 'http://s3.amazonaws.com/doc/2006-03-01/';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function content(key: string, size = '1', metadata = true): string {
  return `<Contents><Key>${escapeXml(key)}</Key>${metadata ? '<LastModified>2026-11-09T00:00:00.000Z</LastModified><ETag>&quot;opaque&quot;&amp;tag</ETag><StorageClass>STANDARD</StorageClass>' : ''}<Size>${size}</Size></Contents>`;
}

function pageXml(
  overrides: Partial<{
    name: string;
    responsePrefix: string;
    encoding: string;
    maxKeys: string;
    keyCount: string;
    truncated: string;
    echo: string;
    next: string;
    contents: string;
    extra: string;
    rootName: string;
    namespace: string | null;
    rootAttributes: string;
  }> = {},
): string {
  const contents = overrides.contents ?? '';
  const count = (contents.match(/<Contents>/g) ?? []).length;
  const namespace =
    overrides.namespace === null
      ? ''
      : ` xmlns="${overrides.namespace ?? awsNamespace}"`;
  const echo =
    overrides.echo === undefined
      ? ''
      : `<ContinuationToken>${escapeXml(overrides.echo)}</ContinuationToken>`;
  const next =
    overrides.next === undefined
      ? ''
      : `<NextContinuationToken>${escapeXml(overrides.next)}</NextContinuationToken>`;
  return `<?xml version="1.0" encoding="UTF-8"?><${overrides.rootName ?? 'ListBucketResult'}${namespace}${overrides.rootAttributes ?? ''}><Name>${escapeXml(overrides.name ?? bucketName)}</Name><Prefix>${overrides.responsePrefix ?? encodeURIComponent(prefix)}</Prefix><EncodingType>${overrides.encoding ?? 'url'}</EncodingType><KeyCount>${overrides.keyCount ?? count}</KeyCount><MaxKeys>${overrides.maxKeys ?? options.limit}</MaxKeys><IsTruncated>${overrides.truncated ?? 'false'}</IsTruncated>${echo}${next}${contents}${overrides.extra ?? ''}</${overrides.rootName ?? 'ListBucketResult'}>`;
}

function rejects(xml: string, listOptions = options): void {
  expect(() => parseS3StorageList(xml, listOptions)).toThrow(
    'S3_STORAGE_LIST_INVALID',
  );
}

describe('S3 ListObjectsV2 response parsing', () => {
  it('accepts empty and URL-encoded Unicode listings with XML entities', () => {
    expect(parseS3StorageList(pageXml(), options)).toEqual({
      objects: [],
      truncated: false,
    });
    expect(
      parseS3StorageList(
        pageXml()
          .replace('?><', '?>\n<')
          .replace('</Name><Prefix>', '</Name>\n  <Prefix>'),
        options,
      ),
    ).toEqual({
      objects: [],
      truncated: false,
    });

    const encodedKey = `${prefix}caf%C3%A9%20%26amp%3B.jpg`;
    expect(
      parseS3StorageList(pageXml({ contents: content(encodedKey) }), options),
    ).toEqual({
      objects: [{ key: `${prefix}café &amp;.jpg`, size: 1 }],
      truncated: false,
    });
  });

  it('keeps opaque cursors exact and validates continuation behavior', () => {
    const cursor = 'opaque +/=%3F token';
    const next = 'next/=+token';
    const pagedOptions = { ...options, cursor };
    expect(
      parseS3StorageList(
        pageXml({
          truncated: 'true',
          echo: cursor,
          next,
          contents: content(`${prefix}photo.jpg`),
        }),
        pagedOptions,
      ),
    ).toEqual({
      objects: [{ key: `${prefix}photo.jpg`, size: 1 }],
      truncated: true,
      cursor: next,
    });
    rejects(pageXml({ echo: 'unexpected' }));
    rejects(pageXml({ truncated: 'true', echo: cursor }), pagedOptions);
    rejects(
      pageXml({ truncated: 'true', echo: cursor, next: cursor }),
      pagedOptions,
    );
    rejects(pageXml({ next: '' }));
    rejects(pageXml({ truncated: 'true', next: '' }));
    rejects(
      pageXml({ truncated: 'true', echo: 'different', next }),
      pagedOptions,
    );
  });

  it('rejects wrong bucket, decoded prefix, encoding, count, limit, and truncation flags', () => {
    rejects(pageXml({ name: 'another-bucket' }));
    rejects(pageXml({ responsePrefix: encodeURIComponent(`${prefix}other/`) }));
    rejects(pageXml({ encoding: 'xml' }));
    rejects(pageXml({ keyCount: '1' }));
    rejects(pageXml({ maxKeys: '99' }));
    rejects(pageXml({ truncated: 'TRUE' }));
    rejects(pageXml({ rootName: 'ListBucketResultExtra' }));
    rejects(pageXml({ namespace: 'https://wrong.example/' }));
  });

  it('rejects duplicate or unknown fields while accepting standard object metadata', () => {
    rejects(pageXml({ extra: `<Name>${bucketName}</Name>` }));
    rejects(
      pageXml({
        contents: `<Contents><Key>${prefix}one</Key><Key>${prefix}two</Key><Size>1</Size></Contents>`,
      }),
    );
    rejects(
      pageXml({
        contents: `<Contents><Key>${prefix}one</Key><Size>1</Size><FutureField>x</FutureField></Contents>`,
      }),
    );
    rejects(pageXml({ extra: '<UnknownRootField>x</UnknownRootField>' }));
    rejects(
      pageXml({
        contents: `<Contents><Key>${prefix}photo.jpg</Key><Size>7</Size><Owner><Unknown>x</Unknown></Owner></Contents>`,
      }),
    );
    expect(
      parseS3StorageList(
        pageXml({
          contents: `<Contents><Key>${prefix}photo.jpg</Key><Size>7</Size><ChecksumAlgorithm>SHA256</ChecksumAlgorithm><ChecksumAlgorithm>CRC32</ChecksumAlgorithm><Owner><ID>owner</ID><DisplayName>Owner</DisplayName></Owner><RestoreStatus><IsRestoreInProgress>false</IsRestoreInProgress></RestoreStatus></Contents>`,
        }),
        options,
      ).objects,
    ).toEqual([{ key: `${prefix}photo.jpg`, size: 7 }]);
  });

  it('rejects malformed XML, declarations, CDATA, and noninitial processing instructions', () => {
    rejects('<ListBucketResult><Name>broken</ListBucketResult>');
    rejects(
      pageXml().replace(
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<?xml invalid?>',
      ),
    );
    expect(
      parseS3StorageList(
        pageXml().replace('<?xml version="1.0" encoding="UTF-8"?>', ''),
        options,
      ),
    ).toEqual({ objects: [], truncated: false });
    rejects(
      pageXml({
        extra: '<!DOCTYPE ListBucketResult [<!ENTITY x "expanded">]>',
      }),
    );
    rejects(
      pageXml({
        extra: `<Contents><Key><![CDATA[${prefix}x]]></Key><Size>1</Size></Contents>`,
      }),
    );
    rejects(pageXml({ extra: '<?instruction data?>' }));
    rejects(pageXml({ rootName: 'OtherRoot' }));
    const nested = '<level>'.repeat(9) + 'x' + '</level>'.repeat(9);
    rejects(pageXml({ extra: nested }));
  });

  it('rejects unsafe keys, duplicate keys, malformed percent encodings, and nondecimal sizes', () => {
    rejects(
      pageXml({
        contents: content('223e4567-e89b-42d3-a456-426614174000/outside.jpg'),
      }),
    );
    rejects(pageXml({ contents: content(`${prefix}bad%2`) }));
    rejects(
      pageXml({
        contents: content(`${prefix}same.jpg`) + content(`${prefix}same.jpg`),
      }),
    );
    for (const size of ['-1', '1.0', '1e2', '+1', '9007199254740992'])
      rejects(pageXml({ contents: content(`${prefix}photo.jpg`, size) }));
    rejects(pageXml({ contents: content(`${prefix}${'x'.repeat(1025)}`) }));
  });

  it('rejects delimiter responses and keeps XML size bounded in UTF-8 bytes', () => {
    rejects(pageXml({ extra: '<Delimiter>/</Delimiter>' }));
    rejects(pageXml({ extra: '<StartAfter>photo.jpg</StartAfter>' }));
    rejects(
      pageXml({
        extra: `<CommonPrefixes><Prefix>${prefix}folder/</Prefix></CommonPrefixes>`,
      }),
    );
    const oversized = pageXml({ extra: `<!--${'😀'.repeat(1_048_576)}-->` });
    rejects(oversized);
  });

  it('validates workspace prefixes, page limits, and opaque cursor bounds', () => {
    for (const invalidOptions of [
      { ...options, prefix: prefix.toUpperCase() },
      { ...options, prefix: `${prefix}nested/` },
      { ...options, limit: 0 },
      { ...options, limit: 1001 },
      { ...options, limit: 1.5 },
      { ...options, cursor: 'bad\nvalue' },
      { ...options, cursor: '\uD800' },
      { ...options, cursor: 'x'.repeat(4097) },
    ])
      expect(() =>
        validateS3StorageListOptions(invalidOptions as S3StorageListOptions),
      ).toThrow('S3_STORAGE_LIST_INVALID');
    expect(() =>
      validateS3StorageListOptions({ ...options, cursor: 'opaque😀*+/=%' }),
    ).not.toThrow();
  });

  it('rejects undeclared entities and invalid XML characters even in optional metadata', () => {
    const valid = pageXml({
      contents: content(encodeURIComponent(prefix + 'photo.jpg')),
    });
    const metadata = '&quot;opaque&quot;&amp;tag';
    for (const value of [
      '&bogus;',
      '&#0;',
      '&#xD800;',
      '&#65534;',
      '&#1114112;',
      '&unfinished',
      '\u0000',
      '\uD800',
    ])
      rejects(valid.replace(metadata, value));
    for (const value of ['&amp;bogus;', '&#65;', '&#x1F600;'])
      expect(
        parseS3StorageList(valid.replace(metadata, value), options).objects,
      ).toHaveLength(1);
    rejects(valid.replace('version="1.0"', 'version="1.1"'));
  });

  it('bounds XML markup and entity work before building the parsed tree', () => {
    rejects(pageXml({ extra: '<x/>'.repeat(65_537) }));
    const contents = content(encodeURIComponent(prefix + 'photo.jpg'));
    rejects(
      pageXml({
        contents: contents.replace(
          '&quot;opaque&quot;&amp;tag',
          '&amp;'.repeat(65_537),
        ),
      }),
    );
  });
});

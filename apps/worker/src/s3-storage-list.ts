import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type { StorageInventoryPage } from '../../../packages/domain/src/storage-reconciliation';

export type S3StorageListOptions = Readonly<{
  bucketName: string;
  prefix: string;
  limit: number;
  cursor?: string;
}>;

const INVALID = 'S3_STORAGE_LIST_INVALID';
const AWS_NAMESPACE = 'http://s3.amazonaws.com/doc/2006-03-01/';
const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_KEY_BYTES = 1024;
const MAX_CURSOR_BYTES = 4096;
const encoder = new TextEncoder();
const workspacePrefix = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/$/;
const controls = /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u;

const parserOptions = {
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  htmlEntities: false,
  maxNestedTags: 8,
} as const;

type XmlEntry = Readonly<{
  name: string;
  value: unknown;
  attributes: unknown;
}>;

function invalid(): never {
  throw new Error(INVALID);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateCursor(cursor: unknown): cursor is string {
  return (
    typeof cursor === 'string' &&
    cursor.length > 0 &&
    cursor.length <= MAX_CURSOR_BYTES &&
    encoder.encode(cursor).byteLength <= MAX_CURSOR_BYTES &&
    !controls.test(cursor)
  );
}

export function validateS3StorageListOptions(
  options: S3StorageListOptions,
): void {
  try {
    if (!isRecord(options)) invalid();
    const { bucketName, prefix, limit, cursor } = options;
    if (
      typeof bucketName !== 'string' ||
      bucketName.length === 0 ||
      bucketName.length > 255 ||
      encoder.encode(bucketName).byteLength > 255 ||
      controls.test(bucketName) ||
      typeof prefix !== 'string' ||
      prefix.length !== 37 ||
      !workspacePrefix.test(prefix) ||
      typeof limit !== 'number' ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      (cursor !== undefined && !validateCursor(cursor))
    )
      invalid();
  } catch {
    invalid();
  }
}

function entries(value: unknown): XmlEntry[] {
  if (!Array.isArray(value)) invalid();
  return value.map((item): XmlEntry => {
    if (!isRecord(item)) invalid();
    const names = Object.keys(item).filter((name) => name !== ':@');
    if (names.length !== 1) invalid();
    const name = names[0]!;
    return { name, value: item[name], attributes: item[':@'] };
  });
}

function attributes(entry: XmlEntry): Record<string, unknown> | undefined {
  if (entry.attributes === undefined) return undefined;
  if (!isRecord(entry.attributes)) invalid();
  return entry.attributes;
}

function requireNoAttributes(entry: XmlEntry): void {
  const attrs = attributes(entry);
  if (attrs && Object.keys(attrs).length > 0) invalid();
}

function text(entry: XmlEntry): string {
  requireNoAttributes(entry);
  let result = '';
  for (const child of entries(entry.value)) {
    if (child.name !== '#text' || typeof child.value !== 'string') invalid();
    result += child.value;
  }
  return result;
}

function whitespaceOnly(entriesToCheck: readonly XmlEntry[]): void {
  for (const entry of entriesToCheck) {
    if (
      entry.name === '#text' &&
      (typeof entry.value !== 'string' || entry.value.trim() !== '')
    )
      invalid();
  }
}

function single(
  fields: readonly XmlEntry[],
  name: string,
  required = true,
): XmlEntry | undefined {
  const found = fields.filter((field) => field.name === name);
  if (found.length > 1 || (required && found.length !== 1)) invalid();
  return found[0];
}

function integer(entry: XmlEntry, minimum: number, maximum: number): number {
  const value = text(entry).trim();
  if (!/^[0-9]+$/.test(value)) invalid();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum)
    invalid();
  return number;
}

function decodeUrl(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    invalid();
  }
}

function checkProcessingInstructions(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) checkProcessingInstructions(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [name, child] of Object.entries(value)) {
    if (name.startsWith('?')) invalid();
    if (name !== ':@') checkProcessingInstructions(child);
  }
}

function nestedMetadata(entry: XmlEntry, allowed: ReadonlySet<string>): void {
  requireNoAttributes(entry);
  const fields = entries(entry.value);
  whitespaceOnly(fields);
  const seen = new Set<string>();
  for (const field of fields) {
    if (field.name === '#text') continue;
    if (!allowed.has(field.name) || seen.has(field.name)) invalid();
    seen.add(field.name);
    text(field);
  }
}

function contentObject(entry: XmlEntry, prefix: string) {
  requireNoAttributes(entry);
  const fields = entries(entry.value);
  whitespaceOnly(fields);
  const known = new Set([
    'Key',
    'LastModified',
    'ETag',
    'ChecksumAlgorithm',
    'ChecksumType',
    'Size',
    'StorageClass',
    'Owner',
    'RestoreStatus',
  ]);
  const seen = new Set<string>();
  for (const field of fields) {
    if (field.name === '#text') continue;
    if (!known.has(field.name)) invalid();
    if (field.name !== 'ChecksumAlgorithm' && seen.has(field.name)) invalid();
    seen.add(field.name);
    if (field.name === 'Owner') {
      nestedMetadata(field, new Set(['ID', 'DisplayName']));
    } else if (field.name === 'RestoreStatus') {
      nestedMetadata(
        field,
        new Set(['IsRestoreInProgress', 'RestoreExpiryDate']),
      );
    } else {
      text(field);
    }
  }
  const keyEntry = single(fields, 'Key');
  const sizeEntry = single(fields, 'Size');
  const encodedKey = text(keyEntry!);
  if (encodedKey.length > MAX_KEY_BYTES * 3) invalid();
  const key = decodeUrl(encodedKey);
  if (
    key.length === 0 ||
    encoder.encode(key).byteLength > MAX_KEY_BYTES ||
    !key.startsWith(prefix)
  )
    invalid();
  return { key, size: integer(sizeEntry!, 0, Number.MAX_SAFE_INTEGER) };
}

function emptyCommonPrefixes(entry: XmlEntry): void {
  requireNoAttributes(entry);
  const children = entries(entry.value);
  whitespaceOnly(children);
  if (children.some((child) => child.name !== '#text')) invalid();
}

function validateXmlEnvelope(xml: string): void {
  if (
    xml.includes('<!') ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u.test(
      xml,
    )
  )
    invalid();
  // shortcut: bound XML work before building a tree; unusual larger pages need a paged job.
  let count = 0;
  for (let at = xml.indexOf('<'); at !== -1; at = xml.indexOf('<', at + 1))
    if (++count > 65_536) invalid();
  count = 0;
  for (let at = xml.indexOf('&'); at !== -1;) {
    if (++count > 65_536) invalid();
    const end = xml.indexOf(';', at + 1);
    if (end === -1 || end - at > 16) invalid();
    const reference = xml.slice(at + 1, end);
    if (!['amp', 'lt', 'gt', 'quot', 'apos'].includes(reference)) {
      if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(reference)) invalid();
      const value = reference.startsWith('#x')
        ? Number.parseInt(reference.slice(2), 16)
        : Number(reference.slice(1));
      if (
        value !== 9 &&
        value !== 10 &&
        value !== 13 &&
        !(value >= 0x20 && value <= 0xd7ff) &&
        !(value >= 0xe000 && value <= 0xfffd) &&
        !(value >= 0x10000 && value <= 0x10ffff)
      )
        invalid();
    }
    at = xml.indexOf('&', end + 1);
  }
}

function validXmlDeclaration(xml: string): boolean {
  return /^<\?xml\s+version=(['"])1\.0\1(?:\s+encoding=(['"])(?:[Uu][Tt][Ff])-8\2)?(?:\s+standalone=(['"])(?:yes|no)\3)?\s*\?>/.test(
    xml,
  );
}

export function parseS3StorageList(
  xml: string,
  options: S3StorageListOptions,
): StorageInventoryPage {
  try {
    validateS3StorageListOptions(options);
    const { bucketName, prefix, limit, cursor } = options;
    if (
      typeof xml !== 'string' ||
      xml.length > MAX_XML_BYTES ||
      encoder.encode(xml).byteLength > MAX_XML_BYTES
    )
      invalid();
    const source = xml.startsWith('\uFEFF') ? xml.slice(1) : xml;
    validateXmlEnvelope(source);
    if (
      XMLValidator.validate(source, { allowBooleanAttributes: false }) !== true
    )
      invalid();
    const parsed = new XMLParser(parserOptions).parse(source);
    const top = entries(parsed);
    const declaration = top[0]?.name === '?xml' ? top.shift() : undefined;
    if (declaration && !validXmlDeclaration(source)) invalid();
    if (top.length !== 1 || top[0]!.name !== 'ListBucketResult') invalid();
    const root = top[0]!;
    checkProcessingInstructions(root.value);
    const rootAttrs = attributes(root);
    if (
      rootAttrs &&
      (Object.keys(rootAttrs).length !== 1 ||
        rootAttrs['@_xmlns'] !== AWS_NAMESPACE)
    )
      invalid();
    const fields = entries(root.value);
    whitespaceOnly(fields);
    const allowed = new Set([
      'Name',
      'Prefix',
      'Delimiter',
      'StartAfter',
      'KeyCount',
      'MaxKeys',
      'IsTruncated',
      'Contents',
      'CommonPrefixes',
      'EncodingType',
      'ContinuationToken',
      'NextContinuationToken',
      'RequestCharged',
      'BucketRegion',
    ]);
    const repeated = new Set(['Contents', 'CommonPrefixes']);
    const seen = new Set<string>();
    const contents: XmlEntry[] = [];
    for (const field of fields) {
      if (field.name === '#text') continue;
      if (!allowed.has(field.name)) invalid();
      if (!repeated.has(field.name) && seen.has(field.name)) invalid();
      seen.add(field.name);
      if (field.name === 'Contents') {
        if (contents.length >= limit) invalid();
        contents.push(field);
      } else if (field.name === 'CommonPrefixes') {
        emptyCommonPrefixes(field);
      }
    }

    if (text(single(fields, 'Name')!) !== bucketName) invalid();
    if (decodeUrl(text(single(fields, 'Prefix')!)) !== prefix) invalid();
    if (text(single(fields, 'EncodingType')!).trim() !== 'url') invalid();
    if (integer(single(fields, 'MaxKeys')!, 1, 1000) !== limit) invalid();
    const keyCount = integer(single(fields, 'KeyCount')!, 0, limit);
    if (keyCount !== contents.length) invalid();
    const truncatedText = text(single(fields, 'IsTruncated')!).trim();
    if (truncatedText !== 'true' && truncatedText !== 'false') invalid();
    const truncated = truncatedText === 'true';

    const delimiter = single(fields, 'Delimiter', false);
    const startAfter = single(fields, 'StartAfter', false);
    if (
      (delimiter && text(delimiter) !== '') ||
      (startAfter && text(startAfter) !== '')
    )
      invalid();
    for (const optional of ['RequestCharged', 'BucketRegion']) {
      const field = single(fields, optional, false);
      if (field) text(field);
    }

    const echoedCursor = single(fields, 'ContinuationToken', false);
    if (
      cursor === undefined
        ? echoedCursor !== undefined && text(echoedCursor) !== ''
        : echoedCursor === undefined || text(echoedCursor) !== cursor
    )
      invalid();
    const nextCursor = single(fields, 'NextContinuationToken', false);
    let next: string | undefined;
    if (truncated) {
      if (!nextCursor) invalid();
      next = text(nextCursor);
      if (!validateCursor(next) || next === cursor) invalid();
    } else if (nextCursor !== undefined) invalid();
    const objects = contents.map((content) => contentObject(content, prefix));
    const keys = new Set<string>();
    for (const object of objects) {
      if (keys.has(object.key)) invalid();
      keys.add(object.key);
    }
    return {
      objects,
      truncated,
      ...(next === undefined ? {} : { cursor: next }),
    };
  } catch {
    invalid();
  }
}

export const MAX_PHOTOGRAPHER_METADATA_SOURCE_BYTES = 64 * 1024 * 1024;
export const MAX_EMBEDDED_XMP_BYTES = 1024 * 1024;

const MAX_XML_DEPTH = 32;
const MAX_XML_TOKENS = 8_192;
const MAX_XML_ATTRIBUTES_PER_ELEMENT = 128;

const XMP_NAMESPACE = 'http://ns.adobe.com/xap/1.0/';
const XMP_META_NAMESPACE = 'adobe:ns:meta/';
const RDF_NAMESPACE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NAMESPACE = 'http://www.w3.org/2000/xmlns/';

export type PhotographerImageFormat = 'jpeg' | 'png' | 'webp';
export type PhotographerLabelColor =
  'red' | 'yellow' | 'green' | 'blue' | 'purple';
export type PhotographerXmpProperty = 'xmp:Rating' | 'xmp:Label';
export type PhotographerMetadataSerialization =
  'attribute' | 'element' | 'multiple';

export type PhotographerMetadataEvidence = Readonly<{
  storage: 'embedded-xmp';
  format: PhotographerImageFormat;
  namespaceUri: typeof XMP_NAMESPACE;
  property: PhotographerXmpProperty;
  serialization: PhotographerMetadataSerialization;
}>;

export type PhotographerMetadataField<T> =
  | Readonly<{ status: 'missing' }>
  | Readonly<{
      status: 'value';
      value: T;
      evidence: PhotographerMetadataEvidence;
    }>
  | Readonly<{
      status: 'cleared';
      evidence: PhotographerMetadataEvidence;
    }>
  | Readonly<{
      status: 'invalid';
      reason:
        | 'invalid_packet'
        | 'packet_too_large'
        | 'duplicate_property'
        | 'invalid_structure'
        | 'invalid_value';
      evidence: PhotographerMetadataEvidence | null;
    }>
  | Readonly<{ status: 'rejected'; evidence: PhotographerMetadataEvidence }>
  | Readonly<{
      status: 'unsupported';
      reason: 'non_integer_rating';
      evidence: PhotographerMetadataEvidence;
    }>
  | Readonly<{
      status: 'unrecognized';
      evidence: PhotographerMetadataEvidence;
    }>;

export type PhotographerMetadataResult =
  | Readonly<{ status: 'unsupported_format' }>
  | Readonly<{
      status: 'supported';
      format: PhotographerImageFormat;
      packetStatus: 'present' | 'missing' | 'invalid' | 'too_large';
      rating: PhotographerMetadataField<number>;
      label: PhotographerMetadataField<PhotographerLabelColor>;
    }>;

export type PhotographerMetadataErrorCode =
  | 'invalid_input'
  | 'source_too_large'
  | 'source_mime_mismatch'
  | 'source_dimensions_out_of_range'
  | 'animated_image'
  | 'invalid_image';

export class PhotographerMetadataError extends Error {
  readonly code: PhotographerMetadataErrorCode;

  constructor(code: PhotographerMetadataErrorCode) {
    super(code);
    this.name = 'PhotographerMetadataError';
    this.code = code;
  }
}

type ParsedImageFormat = PhotographerImageFormat;
type ParsedPropertyName = 'Rating' | 'Label';
type ParsedPropertySerialization = 'attribute' | 'element';

type PropertyOccurrence = Readonly<{
  value: string;
  serialization: ParsedPropertySerialization;
  structurallyValid: boolean;
}>;

type ParsedXmpPacket = Readonly<{
  rating: readonly PropertyOccurrence[];
  label: readonly PropertyOccurrence[];
}>;

type XmlAttribute = Readonly<{ name: string; value: string }>;
type ExpandedName = Readonly<{ namespaceUri: string; localName: string }>;

type XmlFrame = {
  name: string;
  namespaces: Map<string, string>;
  isRdfRoot: boolean;
  isXmpMetaRoot: boolean;
  isMetadataDescription: boolean;
  propertyName: ParsedPropertyName | null;
  propertyValue: string;
  propertyHasElementChild: boolean;
  propertyHasOtherAttributes: boolean;
};

class InvalidXmpPacketError extends Error {
  constructor() {
    super('invalid_xmp_packet');
    this.name = 'InvalidXmpPacketError';
  }
}

function failXmp(): never {
  throw new InvalidXmpPacketError();
}

export function supportedFormatForMime(mime: string): ParsedImageFormat | null {
  switch (mime) {
    case 'image/jpeg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}

export function hasSignature(
  bytes: Uint8Array,
  format: ParsedImageFormat,
): boolean {
  switch (format) {
    case 'jpeg':
      return (
        bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff
      );
    case 'png':
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      );
    case 'webp':
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
  }
}

function isValidXmlCharacter(codePoint: number): boolean {
  return (
    codePoint === 0x09 ||
    codePoint === 0x0a ||
    codePoint === 0x0d ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    (codePoint >= 0x10000 && codePoint <= 0x10ffff)
  );
}

function assertXmlCharacters(value: string): void {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || !isValidXmlCharacter(codePoint)) failXmp();
  }
}

function decodeXmlEntities(value: string): string {
  let result = '';
  let offset = 0;
  while (offset < value.length) {
    const ampersand = value.indexOf('&', offset);
    if (ampersand < 0) {
      result += value.slice(offset);
      break;
    }

    result += value.slice(offset, ampersand);
    const semicolon = value.indexOf(';', ampersand + 1);
    if (semicolon < 0) failXmp();

    const entity = value.slice(ampersand + 1, semicolon);
    let decoded: string;
    switch (entity) {
      case 'amp':
        decoded = '&';
        break;
      case 'lt':
        decoded = '<';
        break;
      case 'gt':
        decoded = '>';
        break;
      case 'quot':
        decoded = '"';
        break;
      case 'apos':
        decoded = "'";
        break;
      default: {
        const hexadecimal = /^#x([0-9a-fA-F]+)$/.exec(entity);
        const decimal = /^#([0-9]+)$/.exec(entity);
        if (hexadecimal === null && decimal === null) failXmp();
        const digits = hexadecimal?.[1] ?? decimal?.[1];
        if (digits === undefined) failXmp();
        const codePoint = Number.parseInt(
          digits,
          hexadecimal === null ? 10 : 16,
        );
        if (!Number.isSafeInteger(codePoint) || !isValidXmlCharacter(codePoint))
          failXmp();
        decoded = String.fromCodePoint(codePoint);
      }
    }
    result += decoded;
    offset = semicolon + 1;
  }

  assertXmlCharacters(result);
  return result;
}

function isXmlWhitespace(character: string | undefined): boolean {
  return (
    character === ' ' ||
    character === '\t' ||
    character === '\r' ||
    character === '\n'
  );
}

function trimXmlWhitespace(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
}

function readXmlName(
  value: string,
  offset: number,
): Readonly<{
  name: string;
  nextOffset: number;
}> {
  const match = /^[A-Za-z_][A-Za-z0-9_.:-]*/.exec(value.slice(offset));
  if (match === null) failXmp();
  return { name: match[0], nextOffset: offset + match[0].length };
}

function resolveQName(
  name: string,
  namespaces: ReadonlyMap<string, string>,
  attribute: boolean,
): ExpandedName {
  const firstColon = name.indexOf(':');
  if (firstColon < 0) {
    return {
      namespaceUri: attribute ? '' : (namespaces.get('') ?? ''),
      localName: name,
    };
  }
  if (
    firstColon === 0 ||
    firstColon === name.length - 1 ||
    name.indexOf(':', firstColon + 1) >= 0
  ) {
    failXmp();
  }

  const prefix = name.slice(0, firstColon);
  const namespaceUri = namespaces.get(prefix);
  if (namespaceUri === undefined || namespaceUri.length === 0) failXmp();
  return { namespaceUri, localName: name.slice(firstColon + 1) };
}

function parseStartTag(body: string): Readonly<{
  name: string;
  attributes: readonly XmlAttribute[];
}> {
  let offset = 0;
  while (isXmlWhitespace(body[offset])) offset += 1;
  const element = readXmlName(body, offset);
  offset = element.nextOffset;

  const attributes: XmlAttribute[] = [];
  const rawNames = new Set<string>();
  while (offset < body.length) {
    while (isXmlWhitespace(body[offset])) offset += 1;
    if (offset >= body.length) break;

    const attribute = readXmlName(body, offset);
    offset = attribute.nextOffset;
    while (isXmlWhitespace(body[offset])) offset += 1;
    if (body[offset] !== '=') failXmp();
    offset += 1;
    while (isXmlWhitespace(body[offset])) offset += 1;

    const quote = body[offset];
    if (quote !== '"' && quote !== "'") failXmp();
    offset += 1;
    const valueStart = offset;
    while (offset < body.length && body[offset] !== quote) offset += 1;
    if (offset >= body.length) failXmp();

    const rawValue = body.slice(valueStart, offset);
    if (rawValue.includes('<')) failXmp();
    const value = decodeXmlEntities(rawValue);
    offset += 1;

    if (rawNames.has(attribute.name)) failXmp();
    rawNames.add(attribute.name);
    attributes.push({ name: attribute.name, value });
    if (attributes.length > MAX_XML_ATTRIBUTES_PER_ELEMENT) failXmp();
  }

  return { name: element.name, attributes };
}

function findTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let offset = start; offset < xml.length; offset += 1) {
    const character = xml[offset];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return offset;
    }
  }
  return -1;
}

function namespaceDeclarationPrefix(attributeName: string): string | null {
  if (attributeName === 'xmlns') return '';
  if (attributeName.startsWith('xmlns:')) {
    const prefix = attributeName.slice('xmlns:'.length);
    if (prefix.length === 0 || prefix.includes(':')) failXmp();
    return prefix;
  }
  return null;
}

function addNamespaceBinding(
  namespaces: Map<string, string>,
  allBindings: Map<string, string>,
  prefix: string,
  namespaceUri: string,
): void {
  if (
    prefix === 'xmlns' ||
    namespaceUri === XMLNS_NAMESPACE ||
    (prefix === 'xml' && namespaceUri !== XML_NAMESPACE) ||
    (prefix !== 'xml' && namespaceUri === XML_NAMESPACE) ||
    (prefix.length > 0 && namespaceUri.length === 0)
  ) {
    failXmp();
  }

  const priorBinding = allBindings.get(prefix);
  if (priorBinding !== undefined && priorBinding !== namespaceUri) failXmp();
  allBindings.set(prefix, namespaceUri);
  namespaces.set(prefix, namespaceUri);
}

function propertyNameForLocalName(
  localName: string,
): ParsedPropertyName | null {
  if (localName === 'Rating' || localName === 'Label') return localName;
  return null;
}

function appendOccurrence(
  propertyName: ParsedPropertyName,
  occurrence: PropertyOccurrence,
  target: {
    rating: PropertyOccurrence[];
    label: PropertyOccurrence[];
  },
): void {
  if (propertyName === 'Rating') target.rating.push(occurrence);
  else target.label.push(occurrence);
}

function parseXmpXml(xml: string): ParsedXmpPacket {
  assertXmlCharacters(xml);
  if (xml.startsWith('\ufeff')) xml = xml.slice(1);

  const initialNamespaces = new Map<string, string>([['xml', XML_NAMESPACE]]);
  const allNamespaceBindings = new Map<string, string>([
    ['xml', XML_NAMESPACE],
  ]);
  const stack: XmlFrame[] = [];
  const occurrences = {
    rating: [] as PropertyOccurrence[],
    label: [] as PropertyOccurrence[],
  };
  let tokenCount = 0;
  let rootElementCount = 0;
  let offset = 0;

  function countToken(): void {
    tokenCount += 1;
    if (tokenCount > MAX_XML_TOKENS) failXmp();
  }

  function closeElement(frame: XmlFrame): void {
    if (frame.propertyName === null) return;
    appendOccurrence(
      frame.propertyName,
      {
        value: frame.propertyValue,
        serialization: 'element',
        structurallyValid:
          !frame.propertyHasElementChild && !frame.propertyHasOtherAttributes,
      },
      occurrences,
    );
  }

  while (offset < xml.length) {
    if (xml[offset] !== '<') {
      let end = xml.indexOf('<', offset);
      if (end < 0) end = xml.length;
      const rawText = xml.slice(offset, end);
      if (rawText.includes(']]>')) failXmp();
      const text = decodeXmlEntities(rawText);
      const current = stack.at(-1);
      if (current === undefined) {
        if (trimXmlWhitespace(text).length !== 0) failXmp();
      } else if (current.propertyName !== null) {
        current.propertyValue += text;
      }
      offset = end;
      continue;
    }

    if (xml.startsWith('<!--', offset)) {
      countToken();
      const end = xml.indexOf('-->', offset + 4);
      if (end < 0) failXmp();
      if (xml.slice(offset + 4, end).includes('--')) failXmp();
      offset = end + 3;
      continue;
    }

    if (xml.startsWith('<?', offset)) {
      countToken();
      const end = xml.indexOf('?>', offset + 2);
      if (end < 0) failXmp();
      const instruction = xml.slice(offset + 2, end);
      const target = readXmlName(instruction, 0);
      const data = instruction.slice(target.nextOffset);
      if (target.name.toLowerCase() === 'xml') {
        const declaration = trimXmlWhitespace(data);
        if (
          target.name !== 'xml' ||
          offset !== 0 ||
          rootElementCount !== 0 ||
          !/^version\s*=\s*(["'"])1\.0\1(?:\s+encoding\s*=\s*(["'"])UTF-8\2)?(?:\s+standalone\s*=\s*(["'"])(?:yes|no)\3)?\s*$/i.test(
            declaration,
          )
        ) {
          failXmp();
        }
      } else if (data.length > 0 && !isXmlWhitespace(data[0])) {
        failXmp();
      }
      offset = end + 2;
      continue;
    }

    if (xml.startsWith('<![CDATA[', offset)) {
      countToken();
      const end = xml.indexOf(']]>', offset + 9);
      if (end < 0 || stack.length === 0) failXmp();
      const current = stack.at(-1);
      if (current?.propertyName !== null && current !== undefined) {
        current.propertyValue += xml.slice(offset + 9, end);
      }
      offset = end + 3;
      continue;
    }

    if (xml.startsWith('<!', offset)) failXmp();
    countToken();

    const tagEnd = findTagEnd(xml, offset + 1);
    if (tagEnd < 0) failXmp();
    if (xml.startsWith('</', offset)) {
      const rawClosingTag = xml.slice(offset + 2, tagEnd);
      const closing = readXmlName(rawClosingTag, 0);
      if (
        trimXmlWhitespace(rawClosingTag.slice(closing.nextOffset)).length !==
          0 ||
        stack.length === 0 ||
        stack.at(-1)?.name !== closing.name
      ) {
        failXmp();
      }
      const frame = stack.pop();
      if (frame === undefined) failXmp();
      closeElement(frame);
      offset = tagEnd + 1;
      continue;
    }

    let startTagBody = xml.slice(offset + 1, tagEnd);
    let selfClosing = false;
    let bodyEnd = startTagBody.length;
    while (bodyEnd > 0 && isXmlWhitespace(startTagBody[bodyEnd - 1])) {
      bodyEnd -= 1;
    }
    if (bodyEnd > 0 && startTagBody[bodyEnd - 1] === '/') {
      selfClosing = true;
      startTagBody = startTagBody.slice(0, bodyEnd - 1);
    }

    const parsedTag = parseStartTag(startTagBody);
    const parent = stack.at(-1);
    const namespaces = new Map(parent?.namespaces ?? initialNamespaces);
    for (const attribute of parsedTag.attributes) {
      const prefix = namespaceDeclarationPrefix(attribute.name);
      if (prefix !== null) {
        addNamespaceBinding(
          namespaces,
          allNamespaceBindings,
          prefix,
          attribute.value,
        );
      }
    }

    const elementName = resolveQName(parsedTag.name, namespaces, false);
    const expandedAttributeNames = new Set<string>();
    for (const attribute of parsedTag.attributes) {
      if (namespaceDeclarationPrefix(attribute.name) !== null) continue;
      const expanded = resolveQName(attribute.name, namespaces, true);
      const key = `${expanded.namespaceUri}\u0000${expanded.localName}`;
      if (expandedAttributeNames.has(key)) failXmp();
      expandedAttributeNames.add(key);
    }

    if (stack.length === 0) {
      rootElementCount += 1;
      if (rootElementCount > 1) failXmp();
    }
    if (stack.length + 1 > MAX_XML_DEPTH) failXmp();

    if (parent?.propertyName !== null && parent !== undefined) {
      parent.propertyHasElementChild = true;
    }

    const isXmpMetaRoot =
      elementName.namespaceUri === XMP_META_NAMESPACE &&
      elementName.localName === 'xmpmeta';
    const isRdfElement =
      elementName.namespaceUri === RDF_NAMESPACE &&
      elementName.localName === 'RDF';
    const isRdfRoot =
      isRdfElement && (stack.length === 0 || parent?.isXmpMetaRoot === true);
    if (isRdfElement && !isRdfRoot) failXmp();
    if (stack.length === 0 && !isRdfRoot && !isXmpMetaRoot) failXmp();
    const isMetadataDescription =
      elementName.namespaceUri === RDF_NAMESPACE &&
      elementName.localName === 'Description' &&
      parent?.isRdfRoot === true;

    if (isMetadataDescription) {
      for (const attribute of parsedTag.attributes) {
        if (namespaceDeclarationPrefix(attribute.name) !== null) continue;
        const expanded = resolveQName(attribute.name, namespaces, true);
        if (expanded.namespaceUri !== XMP_NAMESPACE) continue;
        const propertyName = propertyNameForLocalName(expanded.localName);
        if (propertyName === null) continue;
        appendOccurrence(
          propertyName,
          {
            value: attribute.value,
            serialization: 'attribute',
            structurallyValid: true,
          },
          occurrences,
        );
      }
    }

    let propertyName: ParsedPropertyName | null = null;
    let propertyHasOtherAttributes = false;
    if (
      parent?.isMetadataDescription === true &&
      elementName.namespaceUri === XMP_NAMESPACE
    ) {
      propertyName = propertyNameForLocalName(elementName.localName);
      propertyHasOtherAttributes = parsedTag.attributes.some(
        (attribute) => namespaceDeclarationPrefix(attribute.name) === null,
      );
    }

    const frame: XmlFrame = {
      name: parsedTag.name,
      namespaces,
      isRdfRoot,
      isXmpMetaRoot,
      isMetadataDescription,
      propertyName,
      propertyValue: '',
      propertyHasElementChild: false,
      propertyHasOtherAttributes,
    };

    if (selfClosing) {
      closeElement(frame);
    } else {
      stack.push(frame);
    }
    offset = tagEnd + 1;
  }

  if (stack.length !== 0 || rootElementCount !== 1) failXmp();
  return { rating: occurrences.rating, label: occurrences.label };
}

function evidenceFor(
  format: PhotographerImageFormat,
  property: PhotographerXmpProperty,
  occurrences: readonly PropertyOccurrence[],
): PhotographerMetadataEvidence {
  const serialization =
    occurrences.length > 1
      ? 'multiple'
      : (occurrences[0]?.serialization ?? 'element');
  return {
    storage: 'embedded-xmp',
    format,
    namespaceUri: XMP_NAMESPACE,
    property,
    serialization,
  };
}

function invalidPacketField<T>(
  reason: 'invalid_packet' | 'packet_too_large',
): PhotographerMetadataField<T> {
  return { status: 'invalid', reason, evidence: null };
}

function invalidPropertyField<T>(
  reason: 'duplicate_property' | 'invalid_structure' | 'invalid_value',
  evidence: PhotographerMetadataEvidence,
): PhotographerMetadataField<T> {
  return { status: 'invalid', reason, evidence };
}

function fieldOccurrences(
  packet: ParsedXmpPacket,
  property: ParsedPropertyName,
): readonly PropertyOccurrence[] {
  return property === 'Rating' ? packet.rating : packet.label;
}

function parseRatingField(
  packet: ParsedXmpPacket,
  format: PhotographerImageFormat,
): PhotographerMetadataField<number> {
  const occurrences = fieldOccurrences(packet, 'Rating');
  if (occurrences.length === 0) return { status: 'missing' };
  const evidence = evidenceFor(format, 'xmp:Rating', occurrences);
  if (occurrences.length !== 1) {
    return invalidPropertyField('duplicate_property', evidence);
  }

  const occurrence = occurrences[0];
  if (occurrence === undefined) return { status: 'missing' };
  if (!occurrence.structurallyValid) {
    return invalidPropertyField('invalid_structure', evidence);
  }

  const valueText = trimXmlWhitespace(occurrence.value);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(valueText)) {
    return invalidPropertyField('invalid_value', evidence);
  }
  const rating = Number(valueText);
  if (!Number.isFinite(rating) || rating < -1 || rating > 5) {
    return invalidPropertyField('invalid_value', evidence);
  }
  if (rating === -1) {
    return { status: 'rejected', evidence };
  }
  if (rating === 0) return { status: 'cleared', evidence };
  if (!Number.isInteger(rating)) {
    return { status: 'unsupported', reason: 'non_integer_rating', evidence };
  }
  return { status: 'value', value: rating, evidence };
}

const STANDARD_LABEL_COLORS: Readonly<Record<string, PhotographerLabelColor>> =
  {
    Red: 'red',
    Yellow: 'yellow',
    Green: 'green',
    Blue: 'blue',
    Purple: 'purple',
  };

function parseLabelField(
  packet: ParsedXmpPacket,
  format: PhotographerImageFormat,
): PhotographerMetadataField<PhotographerLabelColor> {
  const occurrences = fieldOccurrences(packet, 'Label');
  if (occurrences.length === 0) return { status: 'missing' };
  const evidence = evidenceFor(format, 'xmp:Label', occurrences);
  if (occurrences.length !== 1) {
    return invalidPropertyField('duplicate_property', evidence);
  }

  const occurrence = occurrences[0];
  if (occurrence === undefined) return { status: 'missing' };
  if (!occurrence.structurallyValid) {
    return invalidPropertyField('invalid_structure', evidence);
  }

  const label = trimXmlWhitespace(occurrence.value);
  if (label.length === 0) return { status: 'cleared', evidence };
  const color = STANDARD_LABEL_COLORS[label];
  if (color === undefined) return { status: 'unrecognized', evidence };
  return { status: 'value', value: color, evidence };
}

function invalidXmpResult(
  format: PhotographerImageFormat,
  packetStatus: 'invalid' | 'too_large',
): PhotographerMetadataResult {
  const reason =
    packetStatus === 'too_large' ? 'packet_too_large' : 'invalid_packet';
  return {
    status: 'supported',
    format,
    packetStatus,
    rating: invalidPacketField(reason),
    label: invalidPacketField(reason),
  };
}

/** Parse only selected scalar XMP properties; callers establish the image container. */
export function parsePhotographerXmp(
  format: PhotographerImageFormat,
  packetBytes: Uint8Array | null,
): PhotographerMetadataResult {
  if (packetBytes === null)
    return {
      status: 'supported',
      format,
      packetStatus: 'missing',
      rating: { status: 'missing' },
      label: { status: 'missing' },
    };
  if (packetBytes.byteLength > MAX_EMBEDDED_XMP_BYTES)
    return invalidXmpResult(format, 'too_large');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(packetBytes);
    const packet = parseXmpXml(text);
    return {
      status: 'supported',
      format,
      packetStatus: 'present',
      rating: parseRatingField(packet, format),
      label: parseLabelField(packet, format),
    };
  } catch {
    return invalidXmpResult(format, 'invalid');
  }
}

export function invalidPhotographerXmp(
  format: PhotographerImageFormat,
): PhotographerMetadataResult {
  return invalidXmpResult(format, 'invalid');
}

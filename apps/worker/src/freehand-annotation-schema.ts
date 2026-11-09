const expectedGuardFingerprints = {
  guest_annotation_command_guard:
    '782138def69b69db6f773a2b361ab7a77ac4d0e0102e3dc3c960606750624457',
  owner_annotation_command_insert_guard:
    '8334f976dc7b82dfa813ff27c4062aae152a168eb95bab5d5b4facfb7b5a3ae3',
} as const;

type GuardName = keyof typeof expectedGuardFingerprints;
type GuardRow = { name: string; sql: string | null; inherited_expiry: number };

/**
 * Fails closed unless both complete command guards match the isolated,
 * proposal-backed definitions. The fingerprint changes on any DDL change.
 */
export async function freehandAnnotationSchemaCapability(
  db: D1Database,
): Promise<boolean> {
  try {
    const result = await db
      .prepare(
        "SELECT name, sql, EXISTS(SELECT 1 FROM pragma_table_info('guest_invites') WHERE name='expiry_mode') AS inherited_expiry FROM sqlite_master WHERE type='trigger' AND name IN (?,?)",
      )
      .bind(
        'guest_annotation_command_guard',
        'owner_annotation_command_insert_guard',
      )
      .all<GuardRow>();
    const rows = result.results ?? [];
    const first = rows[0];
    if (rows.length !== 2 || !first) return false;
    const inheritedExpiry = first.inherited_expiry;
    if (
      ![0, 1].includes(inheritedExpiry) ||
      rows.some((row) => row.inherited_expiry !== inheritedExpiry)
    )
      return false;

    const definitions = new Map<GuardName, string>();
    for (const row of rows) {
      if (
        row.sql === null ||
        !(row.name in expectedGuardFingerprints) ||
        definitions.has(row.name as GuardName)
      )
        return false;
      definitions.set(row.name as GuardName, row.sql);
    }

    for (const name of Object.keys(expectedGuardFingerprints) as GuardName[]) {
      const sql = definitions.get(name);
      if (!sql) return false;
      const normalized = sql
        .replace(/\r\n?/gu, '\n')
        .replace(/\s+$/u, '')
        .replace(/;$/u, '');
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(normalized),
      );
      const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      // Schema69 must never accept the earlier guard that lacks inherited expiry.
      const expected =
        inheritedExpiry === 1 && name === 'guest_annotation_command_guard'
          ? '2f84bcaa872c4527d46fa57b2260b11396c371cc847685723f92a144cfb4cfc1'
          : expectedGuardFingerprints[name];
      if (fingerprint !== expected) return false;
    }
    return true;
  } catch {
    // An unavailable schema catalog or unsupported D1 response is never ready.
    return false;
  }
}

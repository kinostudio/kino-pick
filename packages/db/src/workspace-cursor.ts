import { z } from 'zod';
const cursorSchema = z
  .object({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() })
  .strict();
export type WorkspaceCursor = z.infer<typeof cursorSchema>;
export function decodeWorkspaceCursor(input?: string): WorkspaceCursor | null {
  if (input === undefined) return null;
  const raw = z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .parse(input);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw new z.ZodError([
      { code: 'custom', path: [], message: 'Invalid workspace cursor' },
    ]);
  }
  return cursorSchema.parse(parsed);
}
export function encodeWorkspaceCursor(input: WorkspaceCursor) {
  return Buffer.from(JSON.stringify(cursorSchema.parse(input))).toString(
    'base64url',
  );
}

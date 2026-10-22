import { envSchema, healthSchema } from '@kino-pic/contracts';
export const dynamic = 'force-dynamic';
export function GET() {
  if (!envSchema.safeParse(process.env).success)
    return Response.json(
      {
        error: {
          code: 'CONFIGURATION_INVALID',
          message:
            'Local configuration is invalid or production services are unavailable',
        },
      },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  return Response.json(
    healthSchema.parse({
      status: 'ok',
      service: 'kino-pic-web',
      phase: 'M1',
      dependencies: 'not_checked',
    }),
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

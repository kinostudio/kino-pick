// De-identified diagnostics for errors that are converted into a generic 503.
// Never log cookies, headers, query strings, bodies, SQL bindings or raw identifiers.
const uuidPattern =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const longHexPattern = /\b[0-9a-f]{16,}\b/gi;
const ipv4Pattern = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const emailPattern = /[^\s@"'<>]+@[^\s@"'<>]+/g;

function redact(value: string): string {
  return value
    .replace(uuidPattern, ':id')
    .replace(longHexPattern, ':hex')
    .replace(emailPattern, ':email')
    .replace(ipv4Pattern, ':ip');
}

export function diagnosticRoute(method: string, url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'unknown';
  }
  return `${method.toUpperCase().slice(0, 8)} ${redact(pathname).slice(0, 120)}`;
}

export function diagnosticError(error: unknown): {
  errorName: string;
  errorMessage: string;
} {
  if (!(error instanceof Error))
    return { errorName: typeof error, errorMessage: '' };
  const firstLine = error.message.split('\n', 1)[0] ?? '';
  return {
    errorName: ['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(
      error.name,
    )
      ? error.name
      : 'Error',
    errorMessage: firstLine.startsWith('D1_ERROR:')
      ? 'D1_ERROR'
      : firstLine.startsWith('D1_EXEC_ERROR:')
        ? 'D1_EXEC_ERROR'
        : 'UNCLASSIFIED',
  };
}

export function logUnhandledRouteError(
  scope: string,
  error: unknown,
  request?: Request,
): void {
  console.error(
    'KINO_UNHANDLED_ROUTE_ERROR ' +
      JSON.stringify({
        scope,
        route: request ? diagnosticRoute(request.method, request.url) : null,
        ...diagnosticError(error),
      }),
  );
}

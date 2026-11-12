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

function d1Category(firstLine: string): string {
  return /too many resources consumed within a 10 second window/i.test(
    firstLine,
  )
    ? 'RESOURCE_LIMIT'
    : /overloaded/i.test(firstLine)
      ? 'OVERLOADED'
      : /network connection lost/i.test(firstLine)
        ? 'NETWORK_LOST'
        : /timeout|timed out/i.test(firstLine)
          ? 'TIMEOUT'
          : 'OTHER';
}

function classifyLine(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? '';
  return firstLine.startsWith('D1_ERROR:')
    ? `D1_ERROR/${d1Category(firstLine)}`
    : firstLine.startsWith('D1_EXEC_ERROR:')
      ? 'D1_EXEC_ERROR'
      : 'UNCLASSIFIED';
}

/** Class names are code identifiers, never user data; anything else is masked. */
export function diagnosticClass(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const name = (error as { constructor?: { name?: unknown } }).constructor
    ?.name;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name)
    ? name
    : 'Unknown';
}

export function diagnosticError(error: unknown): {
  errorName: string;
  errorMessage: string;
} {
  if (!(error instanceof Error))
    return { errorName: typeof error, errorMessage: '' };
  let errorMessage = classifyLine(error.message);
  // Libraries (e.g. ORM/auth wrappers) can wrap a D1 failure; classify the
  // wrapped cause without ever copying its text.
  let cause: unknown = error.cause;
  for (let depth = 0; errorMessage === 'UNCLASSIFIED' && depth < 3; depth++) {
    if (!(cause instanceof Error)) break;
    const wrapped = classifyLine(cause.message);
    if (wrapped !== 'UNCLASSIFIED') errorMessage = `CAUSE_${wrapped}`;
    cause = cause.cause;
  }
  return {
    errorName: ['Error', 'TypeError', 'RangeError', 'SyntaxError'].includes(
      error.name,
    )
      ? error.name
      : 'Error',
    errorMessage,
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
        errorClass: diagnosticClass(error),
        ...(error instanceof Error && error.cause !== undefined
          ? { causeClass: diagnosticClass(error.cause) }
          : {}),
      }),
  );
}

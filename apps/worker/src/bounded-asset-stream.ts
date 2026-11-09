export type AssetStreamDeadline = {
  startedAtWall: number;
  startedAtPerformance: number;
};

const MAX_AGE_MS = 600_000;
const CLOCK_TOLERANCE_MS = 1_000;
const CLOCK_CHECK_MS = 1_000;

type DeadlineCheck =
  | { error: 'ASSET_STREAM_CLOCK_INVALID' | 'ASSET_STREAM_EXPIRED' }
  | { wallElapsed: number; performanceElapsed: number };

export function captureAssetStreamDeadline(): AssetStreamDeadline {
  return {
    startedAtWall: Date.now(),
    startedAtPerformance: globalThis.performance?.now() ?? Number.NaN,
  };
}

function checkDeadline(deadline: AssetStreamDeadline): DeadlineCheck {
  const wallElapsed = Date.now() - deadline.startedAtWall;
  const performanceElapsed =
    (globalThis.performance?.now() ?? Number.NaN) -
    deadline.startedAtPerformance;

  if (
    !Number.isFinite(wallElapsed) ||
    !Number.isFinite(performanceElapsed) ||
    wallElapsed < 0 ||
    performanceElapsed < 0 ||
    Math.abs(wallElapsed - performanceElapsed) > CLOCK_TOLERANCE_MS
  ) {
    return { error: 'ASSET_STREAM_CLOCK_INVALID' };
  }

  if (wallElapsed >= MAX_AGE_MS || performanceElapsed >= MAX_AGE_MS) {
    return { error: 'ASSET_STREAM_EXPIRED' };
  }

  return { wallElapsed, performanceElapsed };
}

function erroredStream(code: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>(
    { start: (controller) => controller.error(new Error(code)) },
    { highWaterMark: 0 },
  );
}

function cancelUnclaimedSource(
  source: ReadableStream<Uint8Array>,
  reason: string,
): void {
  try {
    void source.cancel(reason).catch(() => undefined);
  } catch {
    // Cancellation is best-effort; the returned stream already fails closed.
  }
}

export function boundAssetStream(
  source: ReadableStream<Uint8Array>,
  deadline: AssetStreamDeadline | null,
): ReadableStream<Uint8Array> {
  if (deadline === null) return source;
  const activeDeadline = deadline;

  const initialCheck = checkDeadline(deadline);
  if ('error' in initialCheck) {
    cancelUnclaimedSource(source, initialCheck.error);
    return erroredStream(initialCheck.error);
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = source.getReader();
  } catch {
    cancelUnclaimedSource(source, 'ASSET_STREAM_FAILED');
    return erroredStream('ASSET_STREAM_FAILED');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  let readPending = false;
  let cancelRequested = false;
  let lockReleased = false;

  function clearTimer(): void {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function releaseReader(): void {
    if (readPending || lockReleased) return;
    try {
      reader.releaseLock();
      lockReleased = true;
    } catch {
      // A pending read will release the lock when it settles.
    }
  }

  function cancelSource(): void {
    if (cancelRequested || lockReleased) return;
    cancelRequested = true;
    try {
      void reader.cancel('ASSET_STREAM_CANCELLED').catch(() => undefined);
    } catch {
      // The stream may already be closed or errored.
    }
    releaseReader();
  }

  function fail(
    controller: ReadableStreamDefaultController<Uint8Array>,
    code: string,
  ): void {
    if (ended) return;
    ended = true;
    clearTimer();
    try {
      controller.error(new Error(code));
    } catch {
      // The consumer may have cancelled at the same time.
    }
    cancelSource();
  }

  function armTimer(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): void {
    if (ended) return;
    const check = checkDeadline(activeDeadline);
    if ('error' in check) {
      fail(controller, check.error);
      return;
    }

    const remaining =
      MAX_AGE_MS - Math.max(check.wallElapsed, check.performanceElapsed);
    timer = setTimeout(
      () => {
        timer = undefined;
        armTimer(controller);
      },
      Math.max(1, Math.min(CLOCK_CHECK_MS, remaining)),
    );
  }

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        armTimer(controller);
      },
      async pull(controller) {
        if (ended) return;
        const beforeRead = checkDeadline(deadline);
        if ('error' in beforeRead) {
          fail(controller, beforeRead.error);
          return;
        }

        readPending = true;
        try {
          const result = await reader.read();
          readPending = false;
          if (ended) return;

          const afterRead = checkDeadline(deadline);
          if ('error' in afterRead) {
            fail(controller, afterRead.error);
            return;
          }

          if (result.done) {
            ended = true;
            clearTimer();
            controller.close();
            cancelSource();
            return;
          }

          controller.enqueue(result.value);
        } catch {
          readPending = false;
          fail(controller, 'ASSET_STREAM_FAILED');
        } finally {
          readPending = false;
          if (ended) releaseReader();
        }
      },
      cancel() {
        if (!ended) {
          ended = true;
          clearTimer();
          cancelSource();
        }
      },
    },
    { highWaterMark: 0 },
  );
}

export type PhotoDisplayLeaseWindow = {
  startedAtWall: number;
  startedAtPerformance: number;
  displayForMs: number;
};

export function isPhotoDisplayLeaseCurrent(
  lease: PhotoDisplayLeaseWindow,
  wallNow: number,
  performanceNow: number,
) {
  const wallElapsed = wallNow - lease.startedAtWall;
  const performanceElapsed = performanceNow - lease.startedAtPerformance;
  return (
    Number.isFinite(wallElapsed) &&
    Number.isFinite(performanceElapsed) &&
    wallElapsed >= 0 &&
    performanceElapsed >= 0 &&
    Math.abs(wallElapsed - performanceElapsed) <= 1_000 &&
    wallElapsed < lease.displayForMs &&
    performanceElapsed < lease.displayForMs
  );
}

export function photoDisplayLeaseRemaining(
  lease: PhotoDisplayLeaseWindow,
  wallNow: number,
  performanceNow: number,
) {
  if (!isPhotoDisplayLeaseCurrent(lease, wallNow, performanceNow)) return 0;
  return Math.min(
    lease.displayForMs - (wallNow - lease.startedAtWall),
    lease.displayForMs - (performanceNow - lease.startedAtPerformance),
  );
}

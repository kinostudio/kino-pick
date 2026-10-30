export const OWNER_ANNOTATION_READ_CAPABILITIES_HEADER =
  'X-Kino-Annotation-Read-Capabilities';
export const OWNER_FREEHAND_ANNOTATION_READ_CAPABILITY = 'freehand-v1';
export const OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED =
  'ANNOTATION_CLIENT_UPGRADE_REQUIRED';
export const OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED_MESSAGE =
  '此註記範圍包含新版筆劃，請載入支援新版註記的畫面後再繼續；尚未確認的操作記錄已保留。';
export const OWNER_FREEHAND_ANNOTATIONS_DISABLED =
  'FREEHAND_ANNOTATIONS_DISABLED';
export const OWNER_FREEHAND_WRITE_DISABLED_MESSAGE =
  '新版筆劃目前尚未開放儲存。原操作已保留；功能重新開啟後可重試同一筆操作。';

export function ownerAnnotationReadCapabilityHeaders(
  enabled: boolean,
): Record<string, string> {
  return enabled
    ? {
        [OWNER_ANNOTATION_READ_CAPABILITIES_HEADER]:
          OWNER_FREEHAND_ANNOTATION_READ_CAPABILITY,
      }
    : {};
}

function failureStatus(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  if ('statusCode' in error) return error.statusCode;
  if ('status' in error) return error.status;
  return undefined;
}

function failureCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return undefined;
  return error.code;
}

export function isOwnerAnnotationUpgradeRequired(error: unknown): boolean {
  return (
    failureStatus(error) === 426 &&
    failureCode(error) === OWNER_ANNOTATION_CLIENT_UPGRADE_REQUIRED
  );
}

export function isOwnerFreehandWriteDisabled(error: unknown): boolean {
  return (
    failureStatus(error) === 409 &&
    failureCode(error) === OWNER_FREEHAND_ANNOTATIONS_DISABLED
  );
}

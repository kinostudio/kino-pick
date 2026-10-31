'use client';
import { getMatchingProfile } from '../../../packages/domain/src/matching-profiles';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { z } from 'zod';
import {
  assistedCandidatePageSchema,
  type AssistedCandidatePage,
} from '../../../packages/contracts/src/assisted-candidate-catalog';
import {
  resolvedUploadPreviewRequestSchema,
  resolvedUploadPreviewResponseSchema,
  resolvedUploadReservationSchema,
  resolvedUploadReserveSchema,
  type ResolvedUploadCandidate,
  type ResolvedUploadChoice,
  type ResolvedUploadPreviewResponse,
  type ResolvedUploadReservation,
} from '../../../packages/contracts/src/resolved-uploads';
import { versionUploadCompletionSchema } from '../../../packages/contracts/src/version-uploads';
import {
  authorizeUpload,
  completeUpload,
  DirectUploadResponseError,
  getUploadCapabilities,
  getUploadIdentity,
  getUploadOwner,
  putUploadFile,
  UploadProtocolError,
  UploadRequestError,
  type UploadAuthorization,
  type UploadCapabilities,
} from './upload-client';
import {
  ImagePreparationError,
  MAX_BROWSER_UPLOAD_BYTES,
  prepareImage,
  type PreparedImage,
} from './prepare-image';
import {
  decodeResolvedUploadJournal,
  encodeResolvedUploadJournal,
  resolvedUploadJournalKey,
  resolvedUploadJournalScopeSchema,
  type ResolvedUploadFileFingerprint,
  type ResolvedUploadJournalItem,
  type ResolvedUploadJournalScope,
} from './resolved-upload-journal';
import { AssistedCandidatePicker } from './assisted-candidate-picker';

export type ResolvedUploadJournalPort = {
  itemId: ResolvedUploadJournalItem['id'];
  approvedSessionId?: string;
  signal?: AbortSignal;
  onAccessLost?: () => void;
  load: (
    scope: ResolvedUploadJournalScope,
  ) => Promise<ResolvedUploadJournalItem[]>;
  save: (
    scope: ResolvedUploadJournalScope,
    next: ResolvedUploadJournalItem[],
  ) => Promise<void>;
};

export type ResolvedAlbumUploadProps = {
  actorId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  onChanged: () => void;
  journalPort?: ResolvedUploadJournalPort;
  queueFile?: File;
  autoRun?: boolean;
  disabled?: boolean;
  modeActive?: boolean;
};

type CapabilityState =
  | { status: 'loading' }
  | { status: 'disabled'; message: string }
  | { status: 'ready'; value: UploadCapabilities }
  | { status: 'unavailable'; message: string };

type JournalSnapshot = {
  resourceKey: string;
  state: 'loading' | 'ready' | 'blocked';
  issue: string;
  scope: ResolvedUploadJournalScope | null;
  entries: ResolvedUploadJournalItem[];
};

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      value: ResolvedUploadPreviewResponse;
      fingerprint: ResolvedUploadFileFingerprint;
    }
  | { status: 'invalid'; message: string };

type AssistedCatalogBinding = Readonly<{
  resourceKey: string;
  actorId: string;
  workspaceId: string;
  projectId: string;
  albumId: string;
  initialCursor: string;
  projectRevision: number;
  changeSequence: number;
  fingerprint: ResolvedUploadFileFingerprint;
}>;

type AssistedCatalogNavigation = 'initial' | 'next' | 'previous' | 'current';

type AssistedCatalogRetry = Readonly<{
  cursor: string;
  navigation: AssistedCatalogNavigation;
}>;

type AssistedCatalogState = Readonly<{
  binding: AssistedCatalogBinding;
  status: 'loading' | 'ready' | 'error' | 'stale';
  items: ResolvedUploadCandidate[];
  nextCursor: string | null;
  cursorStack: string[];
  currentCursor: string | null;
  pageNumber: number;
  albumRevision: number | null;
  retry: AssistedCatalogRetry | null;
  message: string;
}>;

type AssistedCatalogSelection = Readonly<{
  binding: AssistedCatalogBinding;
  candidate: ResolvedUploadCandidate;
}>;

class AssistedCatalogStaleError extends Error {
  constructor() {
    super('RESOLUTION_CATALOG_STALE');
    this.name = 'AssistedCatalogStaleError';
  }
}

const resolverCapabilitiesSchema = z.object({ enabled: z.boolean() }).strict();
const apiErrorSchema = z.object({ error: z.object({ code: z.string() }) });

const safeRefreshCodes = new Set([
  'RESOLUTION_STALE',
  'RESOLUTION_REVIEW_REQUIRED',
  'RESOLUTION_DUPLICATE',
]);
const reviewFailureCodes = new Set([
  'UPLOAD_METADATA_MISMATCH',
  'UPLOAD_RESOLUTION_DIMENSIONS_MISMATCH',
  'UPLOAD_CONTENT_INVALID',
  'UPLOAD_NEEDS_REVIEW',
]);
const reviewReasons = new Set([
  'invalid_input',
  'invalid_scope',
  'invalid_mode',
  'invalid_filename',
  'invalid_sha256',
  'invalid_dimensions',
  'invalid_options',
  'invalid_candidates',
  'invalid_candidate',
  'invalid_candidate_scope',
  'invalid_candidate_filename',
  'invalid_candidate_sha256',
  'invalid_candidate_dimensions',
  'conflicting_candidate_version',
  'filename_index_not_ready',
  'candidate_limit_exceeded',
  'ambiguous_filename_match',
  'missing_dimension_evidence',
  'dimension_change_requires_review',
  'pending_upload_requires_review',
  'assisted_choice_required',
]);

function parseResponse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new UploadProtocolError(false);
  return parsed.data;
}

async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    throw new UploadRequestError(
      response.status,
      parsed.success ? parsed.data.error.code : 'UNKNOWN_ERROR',
    );
  }
  return body;
}

async function postJson<T>(
  path: string,
  body: unknown,
  expectedActorId: string,
  schema: z.ZodType<T>,
) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Kino-Expected-Actor': z.uuid().parse(expectedActorId),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return parseResponse(schema, await readResponse(response));
}

function createFingerprint(file: File, prepared: PreparedImage) {
  return {
    originalFilename: file.name,
    expectedBytes: file.size,
    contentType: prepared.contentType,
    sha256: prepared.sha256,
    dimensions: {
      width: prepared.encodedWidth,
      height: prepared.encodedHeight,
    },
  } satisfies ResolvedUploadFileFingerprint;
}

function sameFingerprint(
  left: ResolvedUploadFileFingerprint,
  right: ResolvedUploadFileFingerprint,
) {
  return (
    left.originalFilename === right.originalFilename &&
    left.expectedBytes === right.expectedBytes &&
    left.contentType === right.contentType &&
    left.sha256 === right.sha256 &&
    left.dimensions.width === right.dimensions.width &&
    left.dimensions.height === right.dimensions.height
  );
}

function createAssistedCatalogBinding(
  preview: ResolvedUploadPreviewResponse,
  fingerprint: ResolvedUploadFileFingerprint,
  actorId: string,
): AssistedCatalogBinding | null {
  if (preview.mode !== 'assisted' || !preview.catalogCursor) return null;
  return {
    resourceKey: [
      actorId,
      preview.workspaceId,
      preview.projectId,
      preview.albumId,
    ].join(':'),
    actorId,
    workspaceId: preview.workspaceId,
    projectId: preview.projectId,
    albumId: preview.albumId,
    initialCursor: preview.catalogCursor,
    projectRevision: preview.projectRevision,
    changeSequence: preview.changeSequence,
    fingerprint,
  };
}

function sameAssistedCatalogBinding(
  left: AssistedCatalogBinding | null | undefined,
  right: AssistedCatalogBinding | null | undefined,
) {
  return (
    !!left &&
    !!right &&
    left.resourceKey === right.resourceKey &&
    left.actorId === right.actorId &&
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.albumId === right.albumId &&
    left.initialCursor === right.initialCursor &&
    left.projectRevision === right.projectRevision &&
    left.changeSequence === right.changeSequence &&
    sameFingerprint(left.fingerprint, right.fingerprint)
  );
}

function validateAssistedCatalogPage(
  page: AssistedCandidatePage,
  binding: AssistedCatalogBinding,
  expectedAlbumRevision: number | null,
) {
  if (
    page.workspaceId !== binding.workspaceId ||
    page.projectId !== binding.projectId ||
    page.albumId !== binding.albumId
  )
    throw new UploadProtocolError(false);
  if (
    page.projectRevision !== binding.projectRevision ||
    page.changeSequence !== binding.changeSequence ||
    (expectedAlbumRevision !== null &&
      page.albumRevision !== expectedAlbumRevision)
  )
    throw new AssistedCatalogStaleError();

  const seen = new Set<string>();
  for (const candidate of page.items) {
    if (
      seen.has(candidate.photoId) ||
      (candidate.currentVersionId === null) !== (candidate.revision === null)
    )
      throw new UploadProtocolError(false);
    seen.add(candidate.photoId);
  }
}

function fileRequestBody(fingerprint: ResolvedUploadFileFingerprint) {
  return resolvedUploadPreviewRequestSchema.parse({
    file: {
      originalFilename: fingerprint.originalFilename,
      expectedBytes: fingerprint.expectedBytes,
      contentType: fingerprint.contentType,
      sha256: fingerprint.sha256,
      dimensions: fingerprint.dimensions,
    },
  });
}

function validatePreview(
  preview: ResolvedUploadPreviewResponse,
  workspaceId: string,
  projectId: string,
  albumId: string,
) {
  if (
    preview.workspaceId !== workspaceId ||
    preview.projectId !== projectId ||
    preview.albumId !== albumId
  )
    throw new UploadProtocolError(false);

  if (preview.catalogCursor !== undefined && preview.mode !== 'assisted')
    throw new UploadProtocolError(false);

  const seen = new Set<string>();
  for (const candidate of preview.candidates) {
    if (seen.has(candidate.photoId)) throw new UploadProtocolError(false);
    if ((candidate.currentVersionId === null) !== (candidate.revision === null))
      throw new UploadProtocolError(false);
    seen.add(candidate.photoId);
  }

  const decision = preview.decision;
  if (preview.mode === 'off' || preview.mode === 'manual') {
    if (
      decision.outcome !== 'new_photo' ||
      decision.reason !== 'matching_disabled'
    )
      throw new UploadProtocolError(false);
  } else if (decision.outcome === 'new_photo') {
    if (decision.reason !== 'no_filename_match')
      throw new UploadProtocolError(false);
  } else if (decision.outcome === 'new_version') {
    if (
      preview.mode !== 'auto_filename' ||
      decision.reason !== 'unique_filename_hash_changed'
    )
      throw new UploadProtocolError(false);
  } else if (decision.outcome === 'duplicate') {
    if (decision.reason !== 'exact_hash_match')
      throw new UploadProtocolError(false);
  } else if (
    !reviewReasons.has(decision.reason) ||
    (decision.reason === 'assisted_choice_required' &&
      preview.mode !== 'assisted')
  ) {
    throw new UploadProtocolError(false);
  }

  if (decision.outcome === 'new_photo') {
    if (decision.photoId !== null || decision.versionId !== null)
      throw new UploadProtocolError(false);
  } else if (decision.outcome === 'new_version') {
    const candidate = preview.candidates.find(
      (entry) => entry.photoId === decision.photoId,
    );
    if (
      decision.photoId === null ||
      decision.versionId !== null ||
      !candidate?.currentVersionId ||
      candidate.revision === null
    )
      throw new UploadProtocolError(false);
  } else if (decision.outcome === 'duplicate') {
    if (decision.photoId === null) throw new UploadProtocolError(false);
  } else if (decision.versionId !== null) {
    throw new UploadProtocolError(false);
  }
}

function isUnsafePreview(value: ResolvedUploadPreviewResponse) {
  return (
    value.candidatesTruncated ||
    value.decision.reason === 'filename_index_not_ready' ||
    value.decision.reason === 'candidate_limit_exceeded' ||
    value.decision.reason === 'pending_upload_requires_review' ||
    value.decision.reason === 'conflicting_candidate_version' ||
    value.decision.reason.startsWith('invalid_')
  );
}

function candidateChoice(
  candidate: ResolvedUploadCandidate,
): ResolvedUploadChoice | null {
  if (candidate.currentVersionId === null || candidate.revision === null)
    return null;
  return {
    kind: 'new_version',
    photoId: candidate.photoId,
    parentVersionId: candidate.currentVersionId,
    expectedRevision: candidate.revision,
  };
}

function automaticChoice(
  preview: ResolvedUploadPreviewResponse,
): ResolvedUploadChoice | null {
  if (preview.mode !== 'auto_filename' || isUnsafePreview(preview)) return null;
  if (preview.decision.outcome === 'new_photo') return { kind: 'new_photo' };
  if (preview.decision.outcome !== 'new_version') return null;
  const candidate = preview.candidates.find(
    (entry) => entry.photoId === preview.decision.photoId,
  );
  return candidate ? candidateChoice(candidate) : null;
}

function automaticQueueChoice(
  preview: ResolvedUploadPreviewResponse,
): ResolvedUploadChoice | null {
  if (isUnsafePreview(preview)) return null;
  if (
    (preview.mode === 'off' || preview.mode === 'manual') &&
    preview.decision.outcome === 'new_photo' &&
    preview.decision.reason === 'matching_disabled'
  )
    return { kind: 'new_photo' };
  return automaticChoice(preview);
}

function isIdentityAccessDenied(error: unknown) {
  return (
    error instanceof UploadRequestError &&
    (error.status === 401 || error.status === 403)
  );
}

function notifyUploadAccessLost(callback?: () => void) {
  try {
    callback?.();
  } catch {
    // A parent privacy hook must not bypass this identity denial.
  }
}

export function matchingRulesDescription(profileId: string) {
  const profile = getMatchingProfile(profileId);
  if (!profile) return '規則尚未驗證';
  return [
    profile.rules.caseSensitive ? '區分大小寫' : '忽略大小寫',
    profile.rules.allowJpgJpegEquivalence
      ? '合併 JPG 與 JPEG'
      : '區分 JPG 與 JPEG',
    profile.rules.stripRecognizedSuffixes
      ? '忽略一個已知結尾後綴'
      : '保留檔名後綴',
  ].join('；');
}
function decisionLabel(decision: ResolvedUploadPreviewResponse['decision']) {
  if (decision.outcome === 'duplicate') return '相同內容已存在';
  if (decision.outcome === 'new_photo') return '將建立新照片';
  if (decision.outcome === 'new_version') return '將建立私有版本';
  switch (decision.reason) {
    case 'ambiguous_filename_match':
      return '找到多個相符名稱，請明確選擇目標';
    case 'missing_dimension_evidence':
      return '缺少尺寸資料，請明確選擇目標';
    case 'dimension_change_requires_review':
      return '尺寸差異需要確認目標';
    case 'assisted_choice_required':
      return '需要明確選擇新照片或版本';
    case 'pending_upload_requires_review':
      return '已有同名工作正在處理';
    case 'filename_index_not_ready':
      return '檔名比對資料尚未完整，請先整理相簿索引';
    case 'candidate_limit_exceeded':
      return '候選資料不完整，請重新檢查';
    default:
      return '需要管理者檢查';
  }
}

function isObjectMissing(error: unknown) {
  return (
    error instanceof UploadRequestError &&
    error.status === 409 &&
    error.code === 'UPLOAD_OBJECT_NOT_FOUND'
  );
}

function isAuthorizationRequired(error: unknown) {
  return (
    error instanceof UploadRequestError &&
    error.status === 409 &&
    error.code === 'INVALID_STATE_TRANSITION'
  );
}

function errorMessage(error: unknown) {
  if (error instanceof ImagePreparationError) return error.message;
  if (error instanceof UploadRequestError) {
    if (
      error.code === 'AUTH_REQUIRED' ||
      error.code === 'OWNER_REQUIRED' ||
      error.code === 'UPLOAD_OWNER_CHANGED'
    )
      return '登入或管理者授權已變更。請重新登入後，以原工作記錄接續。';
    if (error.code === 'REQUEST_ID_CONFLICT')
      return '伺服器無法核對原請求編號。工作記錄已保留，請交由管理者檢查。';
    if (safeRefreshCodes.has(error.code))
      return '伺服器已明確拒絕這次預覽。請使用「重新檢查目標」取得最新結果。';
    if (
      error.code === 'DIRECT_UPLOAD_DISABLED' ||
      error.code === 'DIRECT_UPLOAD_NOT_CONFIGURED'
    )
      return '目前尚未開放照片上傳。原工作記錄已保留。';
    if (error.code === 'UPLOAD_AUTHORIZATION_EXPIRED')
      return '原上傳授權已逾期。系統保留原工作，不會另建請求。請聯絡管理者。';
  }
  if (error instanceof UploadProtocolError && !error.retryable)
    return '伺服器回應與原工作記錄不一致，已停止後續操作並保留記錄。';
  if (error instanceof DirectUploadResponseError)
    return '照片傳送回應未能確認。請重新選擇同一原檔，再以原工作記錄重試。';
  return '目前無法確認這筆上傳結果。工作內容及請求編號已保存；重試會沿用原操作。';
}

function isSafeToRetry(error: unknown) {
  if (error instanceof UploadProtocolError) return error.retryable;
  if (error instanceof UploadRequestError)
    return error.status === 408 || error.status === 429 || error.status >= 500;
  return (
    error instanceof DirectUploadResponseError ||
    error instanceof TypeError ||
    (error instanceof DOMException && error.name === 'AbortError')
  );
}

function candidateDescription(candidate: ResolvedUploadCandidate) {
  return (
    candidate.filename +
    ' · ' +
    candidate.photoId.slice(0, 8) +
    (candidate.currentVersionId
      ? ' · 目前版本 ' + candidate.currentVersionId.slice(0, 8)
      : ' · 尚無目前版本')
  );
}

export function ResolvedAlbumUpload(props: ResolvedAlbumUploadProps) {
  return (
    <ResolvedAlbumUploadPanel
      key={[
        props.actorId,
        props.workspaceId,
        props.projectId,
        props.albumId,
      ].join(':')}
      {...props}
      modeActive={props.modeActive ?? true}
    />
  );
}

function ResolvedAlbumUploadPanel({
  actorId,
  workspaceId,
  projectId,
  albumId,
  onChanged,
  journalPort,
  queueFile,
  autoRun = false,
  disabled = false,
  modeActive = true,
}: ResolvedAlbumUploadProps) {
  const resourceKey = [actorId, workspaceId, projectId, albumId].join(':');
  const [capabilityRecord, setCapabilityRecord] = useState<{
    resourceKey: string;
    value: CapabilityState;
  } | null>(null);
  const [journalRecord, setJournalRecord] = useState<JournalSnapshot | null>(
    null,
  );
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<PreparedImage | null>(null);
  const [notice, setNotice] = useState('');
  const [completionNotice, setCompletionNotice] = useState('');
  const [stage, setStage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [assistedChoiceKind, setAssistedChoiceKind] = useState<
    'new_photo' | 'new_version' | null
  >(null);
  const [assistedPhotoId, setAssistedPhotoId] = useState('');
  const [catalogState, setCatalogState] = useState<AssistedCatalogState | null>(
    null,
  );
  const [catalogSelection, setCatalogSelection] =
    useState<AssistedCatalogSelection | null>(null);
  const [safeRefreshRequestId, setSafeRefreshRequestId] = useState('');
  const [blockedRequestId, setBlockedRequestId] = useState('');
  const sectionId = useId();
  const fileId = useId();
  const choiceId = useId();
  const confirmTitleId = useId();
  const confirmDescriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelDialogRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const releaseLockRef = useRef<(() => void) | null>(null);
  const scopeRef = useRef<ResolvedUploadJournalScope | null>(null);
  const itemsRef = useRef<ResolvedUploadJournalItem[]>([]);
  const queueFileSetupRef = useRef<{
    file: File;
    itemId: string | null;
    generation: number;
  } | null>(null);
  const queueAutoRunRef = useRef<{
    file: File;
    itemId: string | null;
    generation: number;
    phase: 'idle' | 'preview' | 'done';
  } | null>(null);
  const queueFileHandlerRef = useRef<(selected: File) => void>(() => {});
  const queueAutoRunHandlerRef = useRef<() => void>(() => {});
  const busyRef = useRef(false);
  const selectingRef = useRef(false);
  const journalIssueRef = useRef(false);
  const capabilitiesRef = useRef<UploadCapabilities | null>(null);
  const catalogBindingRef = useRef<AssistedCatalogBinding | null>(null);
  const catalogRequestGenerationRef = useRef(0);
  const catalogAbortControllerRef = useRef<AbortController | null>(null);
  const onChangedRef = useRef(onChanged);

  const capability =
    capabilityRecord?.resourceKey === resourceKey
      ? capabilityRecord.value
      : ({ status: 'loading' } as const);
  const currentJournal =
    journalRecord?.resourceKey === resourceKey ? journalRecord : null;
  const journalState = currentJournal?.state ?? 'loading';
  const journalIssue = currentJournal?.issue ?? '';
  const entries = currentJournal?.entries ?? [];
  const activeItem = entries[0] ?? null;
  const fileFingerprint =
    file && prepared ? createFingerprint(file, prepared) : null;
  const fileMatchesIntent =
    activeItem !== null &&
    fileFingerprint !== null &&
    sameFingerprint(fileFingerprint, activeItem.fingerprint);
  const previewIsCurrent =
    modeActive &&
    !disabled &&
    preview.status === 'ready' &&
    fileFingerprint !== null &&
    sameFingerprint(preview.fingerprint, fileFingerprint);
  const previewValue =
    previewIsCurrent && preview.status === 'ready' ? preview.value : null;
  const blockedPreview = previewValue ? isUnsafePreview(previewValue) : false;
  const autoChoice = previewValue ? automaticChoice(previewValue) : null;
  const previewCatalogBinding =
    previewValue && fileFingerprint
      ? createAssistedCatalogBinding(previewValue, fileFingerprint, actorId)
      : null;
  const currentCatalog =
    previewCatalogBinding &&
    sameAssistedCatalogBinding(catalogState?.binding, previewCatalogBinding)
      ? catalogState
      : null;
  const assistedCatalogEnabled =
    previewValue?.mode === 'assisted' &&
    previewValue.catalogCursor !== undefined &&
    !blockedPreview &&
    previewValue.decision.outcome !== 'duplicate';
  const currentCatalogSelection =
    previewCatalogBinding &&
    sameAssistedCatalogBinding(catalogSelection?.binding, previewCatalogBinding)
      ? catalogSelection
      : null;
  const selectedCandidate = assistedCatalogEnabled
    ? (currentCatalogSelection?.candidate ?? null)
    : (previewValue?.candidates.find(
        (candidate) => candidate.photoId === assistedPhotoId,
      ) ?? null);
  const catalogReady =
    !assistedCatalogEnabled || currentCatalog?.status === 'ready';
  const assistedChoice = !catalogReady
    ? null
    : assistedChoiceKind === 'new_photo'
      ? ({ kind: 'new_photo' } as const)
      : assistedChoiceKind === 'new_version' && selectedCandidate
        ? candidateChoice(selectedCandidate)
        : null;
  const hasResolverMode =
    previewValue?.mode === 'auto_filename' || previewValue?.mode === 'assisted';
  const currentItemBlocked =
    activeItem !== null &&
    (activeItem.needsReview ||
      blockedRequestId === activeItem.reservationBody.requestId ||
      activeItem.reservation?.uploadSession.status === 'cancelled' ||
      activeItem.reservation?.uploadSession.status === 'expired');
  const canResume =
    activeItem !== null &&
    fileMatchesIntent &&
    journalState === 'ready' &&
    !disabled &&
    !busy &&
    safeRefreshRequestId !== activeItem.reservationBody.requestId &&
    !currentItemBlocked;
  const dialogChoice =
    previewValue?.mode === 'auto_filename' ? autoChoice : assistedChoice;
  const dialogCandidate =
    previewValue && dialogChoice?.kind === 'new_version'
      ? assistedCatalogEnabled
        ? (currentCatalogSelection?.candidate ?? null)
        : (previewValue.candidates.find(
            (candidate) => candidate.photoId === dialogChoice.photoId,
          ) ?? null)
      : null;
  const previewDecisionHeading = (() => {
    if (!previewValue) return '';
    if (
      previewValue.mode !== 'assisted' ||
      blockedPreview ||
      previewValue.decision.outcome === 'duplicate'
    )
      return decisionLabel(previewValue.decision);
    if (assistedCatalogEnabled && currentCatalog?.status !== 'ready') {
      if (currentCatalog?.status === 'stale')
        return '目標清單已失效，請重新檢查';
      if (currentCatalog?.status === 'error') return '目前無法驗證照片目標';
      return '正在載入照片目標';
    }
    const choice = selectedChoice(previewValue);
    if (!choice) return '請選擇上傳目標';
    return choice.kind === 'new_photo' ? '將建立新照片' : '將建立私有版本';
  })();

  function clearAssistedCatalog() {
    catalogRequestGenerationRef.current += 1;
    catalogAbortControllerRef.current?.abort();
    catalogAbortControllerRef.current = null;
    catalogBindingRef.current = null;
    setCatalogState(null);
    setCatalogSelection(null);
    setAssistedChoiceKind(null);
    setAssistedPhotoId('');
    setConfirmOpen(false);
  }

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    if (modeActive && !disabled) return;
    catalogRequestGenerationRef.current += 1;
    catalogAbortControllerRef.current?.abort();
    catalogAbortControllerRef.current = null;
    catalogBindingRef.current = null;
    // Prop suspension invalidates private selection and page data immediately.
    /* eslint-disable react-hooks/set-state-in-effect */
    setCatalogState(null);
    setCatalogSelection(null);
    setAssistedChoiceKind(null);
    setAssistedPhotoId('');
    setConfirmOpen(false);
    setPreview({ status: 'idle' });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [disabled, modeActive]);

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++generationRef.current;
    const controller = new AbortController();
    scopeRef.current = null;
    itemsRef.current = [];
    journalIssueRef.current = false;
    capabilitiesRef.current = null;

    function isActive() {
      return mountedRef.current && generationRef.current === generation;
    }

    async function initialize() {
      try {
        const resolverResponse = await fetch(
          '/api/v1/upload-resolution/capabilities',
          {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal: controller.signal,
          },
        );
        const resolverCapabilities = parseResponse(
          resolverCapabilitiesSchema,
          await readResponse(resolverResponse),
        );
        if (!isActive()) return;
        if (!resolverCapabilities.enabled) {
          setCapabilityRecord({
            resourceKey,
            value: { status: 'disabled', message: '' },
          });
          setJournalRecord({
            resourceKey,
            state: 'ready',
            issue: '',
            scope: null,
            entries: [],
          });
          return;
        }

        const directCapabilities = await getUploadCapabilities(
          controller.signal,
          workspaceId,
        );
        if (!isActive()) return;
        if (!directCapabilities.enabled) {
          setCapabilityRecord({
            resourceKey,
            value: {
              status: 'unavailable',
              message: '目前尚未開放照片上傳。',
            },
          });
          setJournalRecord({
            resourceKey,
            state: 'ready',
            issue: '',
            scope: null,
            entries: [],
          });
          return;
        }
        capabilitiesRef.current = directCapabilities;

        const approvedSessionId = journalPort?.approvedSessionId;
        let currentIdentity: Awaited<
          ReturnType<typeof getUploadIdentity>
        > | null = null;
        if (approvedSessionId !== undefined) {
          try {
            currentIdentity = await getUploadIdentity(controller.signal);
          } catch (error) {
            if (isActive() && isIdentityAccessDenied(error))
              notifyUploadAccessLost(journalPort?.onAccessLost);
            throw error;
          }
        }
        const currentActorId =
          currentIdentity?.actorId ?? (await getUploadOwner(controller.signal));
        if (!isActive()) return;
        if (
          approvedSessionId !== undefined &&
          currentIdentity?.sessionId !== approvedSessionId
        ) {
          notifyUploadAccessLost(journalPort?.onAccessLost);
          throw new UploadProtocolError(false);
        }
        const journalScope = resolvedUploadJournalScopeSchema.parse({
          actorId: currentActorId,
          workspaceId,
          projectId,
          albumId,
        });
        if (journalScope.actorId !== z.uuid().parse(actorId)) {
          if (approvedSessionId !== undefined)
            notifyUploadAccessLost(journalPort?.onAccessLost);
          throw new UploadProtocolError(false);
        }
        if (!navigator.locks) {
          setCapabilityRecord({
            resourceKey,
            value: { status: 'ready', value: directCapabilities },
          });
          setJournalRecord({
            resourceKey,
            state: 'blocked',
            issue:
              '此瀏覽器不支援安全的跨分頁工作鎖，已停止解析上傳。請使用支援 Web Locks 的瀏覽器及安全連線。',
            scope: null,
            entries: [],
          });
          return;
        }

        setCapabilityRecord({
          resourceKey,
          value: { status: 'ready', value: directCapabilities },
        });
        await navigator.locks.request(
          resolvedUploadJournalKey(journalScope),
          { ifAvailable: true },
          async (lock) => {
            if (!isActive()) return;
            if (!lock) {
              setJournalRecord({
                resourceKey,
                state: 'blocked',
                issue:
                  '另一個分頁正在處理這個相簿的解析上傳。請關閉該分頁後重新載入。',
                scope: journalScope,
                entries: [],
              });
              return;
            }

            scopeRef.current = journalScope;
            try {
              let restored: ResolvedUploadJournalItem[];
              if (journalPort) {
                const loaded = await journalPort.load(journalScope);
                const encoded = encodeResolvedUploadJournal(
                  journalScope,
                  loaded,
                );
                restored = decodeResolvedUploadJournal(encoded, journalScope);
              } else {
                const key = resolvedUploadJournalKey(journalScope);
                const raw = localStorage.getItem(key);
                restored = decodeResolvedUploadJournal(raw, journalScope);
                if (raw === null)
                  localStorage.setItem(
                    key,
                    encodeResolvedUploadJournal(journalScope, []),
                  );
              }
              if (!isActive()) return;
              itemsRef.current = restored;
              setJournalRecord({
                resourceKey,
                state: 'ready',
                issue: '',
                scope: journalScope,
                entries: restored,
              });
            } catch {
              journalIssueRef.current = true;
              setJournalRecord({
                resourceKey,
                state: 'blocked',
                issue:
                  '本機解析上傳工作記錄損壞、過期或無法保存。沒有送出新工作；請保留記錄並聯絡管理者。',
                scope: journalScope,
                entries: [],
              });
            }

            await new Promise<void>((resolve) => {
              releaseLockRef.current = resolve;
              if (!isActive()) resolve();
            });
          },
        );
      } catch (error) {
        if (!isActive() || controller.signal.aborted) return;
        setCapabilityRecord({
          resourceKey,
          value: {
            status: 'unavailable',
            message: errorMessage(error),
          },
        });
        journalIssueRef.current = true;
        setJournalRecord({
          resourceKey,
          state: 'blocked',
          issue: '',
          scope: null,
          entries: [],
        });
      }
    }

    void initialize();

    return () => {
      controller.abort();
      releaseLockRef.current?.();
      releaseLockRef.current = null;
      if (generationRef.current === generation) generationRef.current += 1;
      mountedRef.current = false;
    };
  }, [actorId, albumId, journalPort, projectId, resourceKey, workspaceId]);

  useEffect(
    () => () => {
      if (prepared) URL.revokeObjectURL(prepared.previewUrl);
    },
    [prepared],
  );

  useEffect(() => {
    if (!activeItem) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [activeItem]);

  useEffect(() => {
    if (!confirmOpen) return;
    cancelDialogRef.current?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busyRef.current) setConfirmOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const elements = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ];
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [confirmOpen]);

  function isActive(generation: number) {
    return mountedRef.current && generationRef.current === generation;
  }

  async function persist(
    next: ResolvedUploadJournalItem[],
    generation = generationRef.current,
  ): Promise<void> {
    const currentScope = scopeRef.current;
    if (
      !currentScope ||
      !isActive(generation) ||
      journalIssueRef.current ||
      currentScope.actorId !== actorId ||
      currentScope.workspaceId !== workspaceId ||
      currentScope.projectId !== projectId ||
      currentScope.albumId !== albumId
    )
      throw new UploadProtocolError(false);
    let persistedItems = next;
    try {
      const encoded = encodeResolvedUploadJournal(currentScope, next);
      if (journalPort) {
        const validated = decodeResolvedUploadJournal(encoded, currentScope);
        await journalPort.save(currentScope, validated);
        persistedItems = decodeResolvedUploadJournal(encoded, currentScope);
      } else {
        localStorage.setItem(resolvedUploadJournalKey(currentScope), encoded);
      }
    } catch (error) {
      if (isActive(generation)) {
        journalIssueRef.current = true;
        setJournalRecord({
          resourceKey,
          state: 'blocked',
          issue:
            error instanceof Error &&
            error.message === 'RESOLVED_UPLOAD_JOURNAL_TOO_LARGE'
              ? '本機解析上傳記錄超過安全上限，已停止後續請求。請聯絡管理者。'
              : '無法保存本機解析上傳工作記錄，已停止後續請求。請保留目前畫面並聯絡管理者。',
          scope: currentScope,
          entries: itemsRef.current,
        });
      }
      throw error;
    }
    if (!isActive(generation) || scopeRef.current !== currentScope)
      throw new UploadProtocolError(false);
    itemsRef.current = persistedItems;
    setJournalRecord({
      resourceKey,
      state: 'ready',
      issue: '',
      scope: currentScope,
      entries: persistedItems,
    });
  }

  async function currentOwner(generation: number, signal?: AbortSignal) {
    const currentScope = scopeRef.current;
    if (
      !currentScope ||
      !isActive(generation) ||
      currentScope.actorId !== actorId ||
      currentScope.workspaceId !== workspaceId ||
      currentScope.projectId !== projectId ||
      currentScope.albumId !== albumId
    )
      throw new UploadProtocolError(false);
    const approvedSessionId = journalPort?.approvedSessionId;
    let identity: Awaited<ReturnType<typeof getUploadIdentity>> | null = null;
    if (approvedSessionId !== undefined) {
      try {
        identity = await getUploadIdentity(signal ?? journalPort?.signal);
      } catch (error) {
        if (isActive(generation) && isIdentityAccessDenied(error))
          notifyUploadAccessLost(journalPort?.onAccessLost);
        throw error;
      }
    }
    const ownerId =
      identity?.actorId ??
      (await getUploadOwner(signal ?? journalPort?.signal));
    if (!isActive(generation)) throw new UploadProtocolError(false);
    if (
      ownerId !== currentScope.actorId ||
      (approvedSessionId !== undefined &&
        identity?.sessionId !== approvedSessionId)
    ) {
      if (approvedSessionId !== undefined)
        notifyUploadAccessLost(journalPort?.onAccessLost);
      throw new UploadProtocolError(false);
    }
    return ownerId;
  }

  async function requestAssistedCatalogPage(
    binding: AssistedCatalogBinding,
    cursor: string,
    navigation: AssistedCatalogNavigation,
    generation: number,
  ) {
    if (
      !modeActive ||
      !sameAssistedCatalogBinding(catalogBindingRef.current, binding) ||
      cursor.length === 0 ||
      cursor.length > 4096
    )
      return;

    const previousCatalog = sameAssistedCatalogBinding(
      catalogState?.binding,
      binding,
    )
      ? catalogState
      : null;
    const requestGeneration = ++catalogRequestGenerationRef.current;
    catalogAbortControllerRef.current?.abort();
    const controller = new AbortController();
    catalogAbortControllerRef.current = controller;
    const retry = { cursor, navigation } satisfies AssistedCatalogRetry;

    if (navigation === 'initial' || !previousCatalog) {
      setCatalogState({
        binding,
        status: 'loading',
        items: [],
        nextCursor: null,
        cursorStack: [binding.initialCursor],
        currentCursor: binding.initialCursor,
        pageNumber: 1,
        albumRevision: null,
        retry,
        message: '',
      });
    } else {
      setCatalogState({
        ...previousCatalog,
        status: 'loading',
        retry,
        message: '',
      });
    }

    function isCurrentRequest() {
      return (
        isActive(generation) &&
        catalogRequestGenerationRef.current === requestGeneration &&
        sameAssistedCatalogBinding(catalogBindingRef.current, binding)
      );
    }

    function stopRequest() {
      if (catalogRequestGenerationRef.current === requestGeneration) {
        catalogRequestGenerationRef.current += 1;
        catalogAbortControllerRef.current?.abort();
        catalogAbortControllerRef.current = null;
      }
    }

    function clearSelection() {
      setCatalogSelection(null);
      setAssistedChoiceKind(null);
      setAssistedPhotoId('');
      setConfirmOpen(false);
    }

    function showStale(message: string) {
      stopRequest();
      clearSelection();
      setCatalogState({
        binding,
        status: 'stale',
        items: [],
        nextCursor: null,
        cursorStack: [],
        currentCursor: null,
        pageNumber: 0,
        albumRevision: null,
        retry: null,
        message,
      });
      setNotice(message);
    }

    function showPrivateAccessError(message: string) {
      stopRequest();
      clearSelection();
      setCatalogState({
        binding,
        status: 'error',
        items: [],
        nextCursor: null,
        cursorStack: [],
        currentCursor: null,
        pageNumber: 0,
        albumRevision: null,
        retry: null,
        message,
      });
      setNotice(message);
    }

    let verifyingOwner = false;
    try {
      verifyingOwner = true;
      const ownerBefore = await currentOwner(generation, controller.signal);
      verifyingOwner = false;
      const response = await fetch(
        '/api/v1/albums/' +
          encodeURIComponent(binding.albumId) +
          '/upload-candidates?cursor=' +
          encodeURIComponent(cursor),
        {
          method: 'GET',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'X-Kino-Expected-Actor': z.uuid().parse(ownerBefore),
          },
          cache: 'no-store',
          signal: controller.signal,
        },
      );
      const body: unknown = await response.json().catch(() => null);
      verifyingOwner = true;
      const ownerAfter = await currentOwner(generation, controller.signal);
      verifyingOwner = false;
      if (!isCurrentRequest()) return;
      if (ownerBefore !== binding.actorId || ownerAfter !== ownerBefore)
        throw new UploadProtocolError(false);
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(body);
        throw new UploadRequestError(
          response.status,
          parsed.success ? parsed.data.error.code : 'UNKNOWN_ERROR',
        );
      }

      const page = parseResponse(assistedCandidatePageSchema, body);
      validateAssistedCatalogPage(
        page,
        binding,
        previousCatalog?.albumRevision ?? null,
      );
      // Page-one and previous-page responses can point to a cursor in the old stack.
      // Cycle checks apply only when refreshing or advancing from the current page.
      if (
        page.nextCursor !== null &&
        (page.nextCursor === cursor ||
          ((navigation === 'next' || navigation === 'current') &&
            previousCatalog?.cursorStack.includes(page.nextCursor)))
      )
        throw new UploadProtocolError(false);

      let cursorStack = previousCatalog?.cursorStack ?? [binding.initialCursor];
      let pageNumber = previousCatalog?.pageNumber ?? 1;
      if (navigation === 'initial') {
        cursorStack = [binding.initialCursor];
        pageNumber = 1;
      } else if (navigation === 'next') {
        cursorStack = [...cursorStack, cursor].slice(-32);
        pageNumber += 1;
      } else if (navigation === 'previous') {
        if (cursorStack.length <= 1) throw new UploadProtocolError(false);
        cursorStack = cursorStack.slice(0, -1);
        pageNumber = Math.max(1, pageNumber - 1);
      }

      if (!isCurrentRequest()) return;
      setCatalogState({
        binding,
        status: 'ready',
        items: page.items,
        nextCursor: page.nextCursor,
        cursorStack,
        currentCursor: cursor,
        pageNumber,
        albumRevision: page.albumRevision,
        retry: null,
        message: '',
      });
    } catch (error) {
      if (
        !isCurrentRequest() ||
        (error instanceof DOMException && error.name === 'AbortError')
      )
        return;

      const stale =
        error instanceof AssistedCatalogStaleError ||
        (error instanceof UploadRequestError &&
          error.status === 409 &&
          error.code === 'RESOLUTION_CATALOG_STALE');
      if (stale) {
        showStale(
          '相簿照片目標已更新，這份清單已失效。請重新檢查目前照片後再選擇。',
        );
      } else if (
        verifyingOwner ||
        (error instanceof UploadRequestError &&
          (error.status === 401 ||
            error.status === 403 ||
            error.status === 404)) ||
        (error instanceof UploadProtocolError && !error.retryable)
      ) {
        showPrivateAccessError(
          '目前登入身分或相簿權限已變更。為保護照片資訊，已清除目標清單與選擇；請重新檢查。',
        );
      } else {
        const message =
          '目前無法載入照片目標。請重試此頁，或重新檢查目前照片。';
        setCatalogState((current) =>
          current && sameAssistedCatalogBinding(current.binding, binding)
            ? {
                ...current,
                status: 'error',
                retry,
                message,
              }
            : current,
        );
      }
    } finally {
      if (catalogRequestGenerationRef.current === requestGeneration) {
        catalogAbortControllerRef.current = null;
      }
    }
  }

  function selectAssistedCatalogCandidate(candidate: ResolvedUploadCandidate) {
    const binding = currentCatalog?.binding;
    if (
      !modeActive ||
      disabled ||
      busy ||
      !binding ||
      currentCatalog?.status !== 'ready' ||
      !sameAssistedCatalogBinding(catalogBindingRef.current, binding)
    )
      return;
    const currentPageCandidate = currentCatalog.items.find(
      (entry) => entry.photoId === candidate.photoId,
    );
    if (!currentPageCandidate || candidateChoice(currentPageCandidate) === null)
      return;
    setCatalogSelection({
      binding,
      candidate: currentPageCandidate,
    });
    setAssistedChoiceKind('new_version');
    setAssistedPhotoId('');
  }

  function goToNextCatalogPage() {
    const binding = currentCatalog?.binding;
    const nextCursor = currentCatalog?.nextCursor;
    if (
      !binding ||
      !nextCursor ||
      currentCatalog?.status !== 'ready' ||
      busy ||
      disabled
    )
      return;
    void requestAssistedCatalogPage(
      binding,
      nextCursor,
      'next',
      generationRef.current,
    );
  }

  function goToFirstCatalogPage() {
    const binding = currentCatalog?.binding;
    if (
      !binding ||
      currentCatalog?.status !== 'ready' ||
      currentCatalog.currentCursor === binding.initialCursor ||
      busy ||
      disabled
    )
      return;
    void requestAssistedCatalogPage(
      binding,
      binding.initialCursor,
      'initial',
      generationRef.current,
    );
  }

  function goToPreviousCatalogPage() {
    const binding = currentCatalog?.binding;
    const stack = currentCatalog?.cursorStack;
    if (
      !binding ||
      !stack ||
      stack.length < 2 ||
      currentCatalog?.status !== 'ready' ||
      busy ||
      disabled
    )
      return;
    const previousCursor = stack[stack.length - 2];
    if (!previousCursor) return;
    void requestAssistedCatalogPage(
      binding,
      previousCursor,
      'previous',
      generationRef.current,
    );
  }

  function refreshAssistedCatalog() {
    if (!currentCatalog || busy || disabled) return;
    if (
      currentCatalog.status === 'stale' ||
      (currentCatalog.status === 'error' && currentCatalog.retry === null)
    ) {
      void refreshPreview();
      return;
    }
    if (currentCatalog.status === 'error' && currentCatalog.retry) {
      void requestAssistedCatalogPage(
        currentCatalog.binding,
        currentCatalog.retry.cursor,
        currentCatalog.retry.navigation,
        generationRef.current,
      );
      return;
    }
    if (currentCatalog.currentCursor) {
      void requestAssistedCatalogPage(
        currentCatalog.binding,
        currentCatalog.currentCursor,
        'current',
        generationRef.current,
      );
    }
  }

  function enterOperation() {
    if (
      busyRef.current ||
      selectingRef.current ||
      !mountedRef.current ||
      journalIssueRef.current ||
      journalState !== 'ready'
    )
      return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }

  function leaveOperation(generation: number) {
    busyRef.current = false;
    if (isActive(generation)) {
      setBusy(false);
      setStage('');
    }
  }

  async function refreshPreview() {
    if (
      !modeActive ||
      !file ||
      !prepared ||
      activeItem ||
      !capabilitiesRef.current
    )
      return;
    if (!enterOperation()) return;
    const generation = generationRef.current;
    clearAssistedCatalog();
    setNotice('');
    setPreview({ status: 'loading' });
    setStage('正在比對相簿中的照片與目前版本…');

    try {
      const fingerprint = createFingerprint(file, prepared);
      const request = fileRequestBody(fingerprint);
      const ownerId = await currentOwner(generation);
      const response = await fetch(
        '/api/v1/albums/' + encodeURIComponent(albumId) + '/upload-resolution',
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Kino-Expected-Actor': z.uuid().parse(ownerId),
          },
          body: JSON.stringify(request),
          cache: 'no-store',
        },
      );
      const value = parseResponse(
        resolvedUploadPreviewResponseSchema,
        await readResponse(response),
      );
      validatePreview(value, workspaceId, projectId, albumId);
      if (!isActive(generation)) return;
      setPreview({ status: 'ready', value, fingerprint });
      if (
        !isUnsafePreview(value) &&
        value.mode === 'assisted' &&
        value.catalogCursor !== undefined &&
        value.decision.outcome !== 'duplicate'
      ) {
        const binding = createAssistedCatalogBinding(
          value,
          fingerprint,
          ownerId,
        );
        if (binding) {
          catalogBindingRef.current = binding;
          await requestAssistedCatalogPage(
            binding,
            binding.initialCursor,
            'initial',
            generation,
          );
        }
      }
      if (isUnsafePreview(value)) {
        setNotice(
          '比對結果不完整或有同名工作尚未完成，沒有建立上傳。請明確重新檢查目標。',
        );
      } else if (value.mode === 'off' || value.mode === 'manual') {
        setNotice('此相簿目前未啟用自動或協助解析。尚未建立上傳工作。');
      } else if (value.decision.outcome === 'duplicate') {
        setNotice('相同照片內容已存在。系統不會再次上傳，請略過這筆選擇。');
      } else if (
        value.mode === 'auto_filename' &&
        automaticChoice(value) === null
      ) {
        setNotice(
          '自動解析無法唯一確認新照片或版本目標。沒有建立上傳，請重新檢查或交由管理者處理。',
        );
      }
    } catch (error) {
      if (!isActive(generation)) return;
      setPreview({
        status: 'invalid',
        message: '無法驗證目前比對結果，沒有建立上傳。請明確重新檢查目標。',
      });
      setNotice(errorMessage(error));
    } finally {
      leaveOperation(generation);
    }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = '';
    void chooseFile(selected);
  }

  async function chooseFile(selected: File | null, assigned = false) {
    if (
      !selected ||
      (queueFile !== undefined && (!assigned || selected !== queueFile)) ||
      selectingRef.current ||
      busyRef.current ||
      (!modeActive && !itemsRef.current[0])
    )
      return;
    const generation = generationRef.current;
    const limits = capabilitiesRef.current;
    if (!limits || !limits.enabled || disabled) return;

    clearAssistedCatalog();
    setPreview({ status: 'idle' });
    selectingRef.current = true;
    setSelecting(true);
    setNotice('');
    setStage('正在檢查照片格式、原始尺寸與雜湊…');
    let nextPrepared: PreparedImage | null = null;
    try {
      nextPrepared = await prepareImage(selected, {
        maxBrowserBytes: Math.min(
          limits.maxBrowserBytes,
          MAX_BROWSER_UPLOAD_BYTES,
        ),
        maxPixels: limits.maxPixels,
        maxDimension: limits.maxDimension,
      });
      if (!isActive(generation)) return;
      const fingerprint = createFingerprint(selected, nextPrepared);
      const currentItem = itemsRef.current[0] ?? null;
      if (
        currentItem &&
        !sameFingerprint(fingerprint, currentItem.fingerprint)
      ) {
        setFile(null);
        setPrepared(null);
        setNotice(
          '所選檔案與已保存工作不符，尚未傳送。請重新選擇同一原檔；原工作記錄仍保留。',
        );
        return;
      }
      if (prepared) URL.revokeObjectURL(prepared.previewUrl);
      setFile(selected);
      setPrepared(nextPrepared);
      nextPrepared = null;
      if (!currentItem) {
        setPreview({ status: 'idle' });
        setAssistedChoiceKind(null);
        setAssistedPhotoId('');
        setNotice('照片檢查完成。先檢查目標，再確認是否建立上傳工作。');
      } else {
        setNotice(
          '原檔大小、格式、雜湊及原始尺寸符合保存的工作；重試會沿用原請求。',
        );
      }
    } catch (error) {
      if (isActive(generation)) {
        setFile(null);
        setPrepared(null);
        setNotice(errorMessage(error));
      }
    } finally {
      if (nextPrepared) URL.revokeObjectURL(nextPrepared.previewUrl);
      selectingRef.current = false;
      if (isActive(generation)) {
        setSelecting(false);
        setStage('');
      }
    }
  }

  function selectedChoice(value: ResolvedUploadPreviewResponse) {
    if (value.mode === 'auto_filename') return automaticChoice(value);
    if (value.mode !== 'assisted') return null;

    if (value.catalogCursor !== undefined) {
      if (!fileFingerprint) return null;
      const binding = createAssistedCatalogBinding(
        value,
        fileFingerprint,
        actorId,
      );
      const selection = catalogSelection;
      if (
        !binding ||
        currentCatalog?.status !== 'ready' ||
        !sameAssistedCatalogBinding(currentCatalog.binding, binding)
      )
        return null;
      if (assistedChoiceKind === 'new_photo')
        return { kind: 'new_photo' } as const;
      if (
        assistedChoiceKind !== 'new_version' ||
        !selection ||
        !sameAssistedCatalogBinding(selection.binding, binding)
      )
        return null;
      return candidateChoice(selection.candidate);
    }

    if (assistedChoiceKind === 'new_photo')
      return { kind: 'new_photo' } as const;
    if (assistedChoiceKind !== 'new_version') return null;
    const candidate = value.candidates.find(
      (entry) => entry.photoId === assistedPhotoId,
    );
    return candidate ? candidateChoice(candidate) : null;
  }

  async function confirmReservation() {
    markQueueAutoRunDone();
    const queueChoice =
      previewValue && queueFile && autoRun
        ? automaticQueueChoice(previewValue)
        : null;
    if (
      !modeActive ||
      !previewValue ||
      !fileFingerprint ||
      !file ||
      !prepared ||
      activeItem ||
      blockedPreview ||
      (!hasResolverMode && queueChoice === null)
    )
      return;
    if (!enterOperation()) return;
    const generation = generationRef.current;
    const choice = queueChoice ?? selectedChoice(previewValue);
    if (!choice) {
      leaveOperation(generation);
      setNotice('請先明確選擇新照片或一個完整的目前版本目標。');
      return;
    }

    setConfirmOpen(false);
    setNotice('');
    try {
      const request = fileRequestBody(fileFingerprint);
      const reservationBody = resolvedUploadReserveSchema.parse({
        requestId: crypto.randomUUID(),
        file: request.file,
        expectedChangeSequence: previewValue.changeSequence,
        expectedProjectRevision: previewValue.projectRevision,
        expectedMode: previewValue.mode,
        ...(previewValue.matchingProfile
          ? { matchingProfile: previewValue.matchingProfile }
          : {}),
        choice,
        confirm: true,
      });
      const item: ResolvedUploadJournalItem = {
        id: journalPort
          ? z.uuid().parse(journalPort.itemId)
          : crypto.randomUUID(),
        reservationBody,
        reservation: null,
        authorizeBody: { requestId: crypto.randomUUID() },
        completeBody: { requestId: crypto.randomUUID() },
        fingerprint: fileFingerprint,
        needsReview: false,
      };
      // Save all immutable operation IDs and the exact user choice before the
      // first reservation request can reach the server.
      await persist([item], generation);
      if (!isActive(generation)) return;
      setStage('保存原始目標並建立固定上傳工作…');
      await resumeIntent(item, generation);
    } catch (error) {
      if (isActive(generation)) {
        const currentItem = itemsRef.current[0];
        if (
          currentItem &&
          error instanceof UploadRequestError &&
          reviewFailureCodes.has(error.code)
        ) {
          await finishNeedsReview(currentItem, generation);
        } else {
          setNotice(errorMessage(error));
        }
        if (
          currentItem &&
          !(
            error instanceof UploadRequestError &&
            reviewFailureCodes.has(error.code)
          )
        ) {
          if (
            error instanceof UploadRequestError &&
            safeRefreshCodes.has(error.code) &&
            currentItem.reservation === null
          )
            setSafeRefreshRequestId(currentItem.reservationBody.requestId);
          else if (
            (error instanceof UploadRequestError &&
              error.code === 'REQUEST_ID_CONFLICT') ||
            (error instanceof UploadProtocolError && !error.retryable)
          )
            setBlockedRequestId(currentItem.reservationBody.requestId);
        }
      }
    } finally {
      leaveOperation(generation);
    }
  }

  function reservationMatches(
    result: ResolvedUploadReservation,
    item: ResolvedUploadJournalItem,
  ) {
    const { uploadSession, target } = result;
    const body = item.reservationBody;
    if (
      uploadSession.workspaceId !== workspaceId ||
      uploadSession.projectId !== projectId ||
      uploadSession.albumId !== albumId ||
      uploadSession.originalFilename !== body.file.originalFilename ||
      uploadSession.expectedBytes !== body.file.expectedBytes ||
      uploadSession.reservedBytes !== body.file.expectedBytes
    )
      return false;
    if (body.choice.kind !== target.kind) return false;
    if (target.kind === 'new_photo') return true;
    return (
      body.choice.kind === 'new_version' &&
      target.photoId === body.choice.photoId &&
      target.parentVersionId === body.choice.parentVersionId &&
      target.expectedRevision === body.choice.expectedRevision &&
      target.capturedVersioningMode === body.expectedMode &&
      target.changeType === 'new_retouch'
    );
  }

  async function sendCompletion(
    item: ResolvedUploadJournalItem,
    ownerId: string,
  ) {
    const reservation = item.reservation;
    if (!reservation) throw new UploadProtocolError(false);
    const uploadSessionId = reservation.uploadSession.id;
    if (reservation.target.kind === 'new_photo') {
      const result = await completeUpload(
        uploadSessionId,
        item.completeBody,
        ownerId,
      );
      if (result.status === 'needs_review') return result;
      if (
        result.status !== 'completed' ||
        result.actualBytes !== item.reservationBody.file.expectedBytes
      )
        throw new UploadProtocolError(false);
      return result;
    }

    const result = await postJson(
      '/api/v1/photos/' +
        encodeURIComponent(reservation.target.photoId) +
        '/versions/' +
        encodeURIComponent(uploadSessionId) +
        '/complete',
      item.completeBody,
      ownerId,
      versionUploadCompletionSchema,
    );
    if (
      result.uploadSessionId !== uploadSessionId ||
      result.photoId !== reservation.target.photoId ||
      result.parentVersionId !== reservation.target.parentVersionId ||
      result.actualBytes !== item.reservationBody.file.expectedBytes ||
      result.contentType !== item.reservationBody.file.contentType ||
      result.sha256 !== item.reservationBody.file.sha256 ||
      result.width !== item.reservationBody.file.dimensions.width ||
      result.height !== item.reservationBody.file.dimensions.height ||
      result.changeType !== reservation.target.changeType ||
      result.versionId === reservation.target.parentVersionId
    )
      throw new UploadProtocolError(false);
    return result;
  }

  async function finishSuccess(
    item: ResolvedUploadJournalItem,
    generation: number,
  ) {
    if (!isActive(generation)) return;
    let removed = true;
    try {
      await persist([], generation);
    } catch {
      removed = false;
    }
    if (!isActive(generation)) return;
    setPreview({ status: 'idle' });
    setFile(null);
    setPrepared(null);
    setSafeRefreshRequestId('');
    setBlockedRequestId('');
    setCompletionNotice(
      removed
        ? item.reservation?.target.kind === 'new_version'
          ? '私有版本已建立並送入背景處理。相簿仍顯示原目前版本；系統不會自動切換目前版本。'
          : '新照片已完成上傳。'
        : '伺服器已確認上傳完成，但本機工作記錄無法清除。請保留原記錄並聯絡管理者。',
    );
    setNotice('');
    try {
      onChangedRef.current();
    } catch {
      // The server-confirmed upload stays successful if the parent refresh fails.
    }
  }

  async function finishNeedsReview(
    item: ResolvedUploadJournalItem,
    generation: number,
  ) {
    if (!isActive(generation)) return;
    try {
      await persist([{ ...item, needsReview: true }], generation);
    } catch {
      // The failed save already blocks further writes; retain the intent in memory.
    }
    if (!isActive(generation)) return;
    setNotice(
      '伺服器已將原工作標記為需要人工檢查，配額仍由伺服器管理。工作記錄會保留；不會重傳或建立新工作，請聯絡管理者。',
    );
  }

  async function resumeIntent(
    startingItem: ResolvedUploadJournalItem,
    generation: number,
  ) {
    let item = startingItem;
    if (
      !file ||
      !prepared ||
      !sameFingerprint(createFingerprint(file, prepared), item.fingerprint)
    )
      throw new Error('請重新選擇與工作記錄相符的原始檔。');

    let ownerId = await currentOwner(generation);
    if (!isActive(generation)) return;
    if (!item.reservation) {
      setStage('使用原請求建立固定上傳工作…');
      const reservation = await postJson(
        '/api/v1/albums/' + encodeURIComponent(albumId) + '/resolved-uploads',
        item.reservationBody,
        ownerId,
        resolvedUploadReservationSchema,
      );
      if (!reservationMatches(reservation, item))
        throw new UploadProtocolError(false);
      item = { ...item, reservation };
      await persist([item], generation);
      if (!isActive(generation)) return;
    }

    const reservation = item.reservation;
    if (!reservation) throw new UploadProtocolError(false);
    if (
      reservation.uploadSession.status === 'cancelled' ||
      reservation.uploadSession.status === 'expired'
    )
      throw new UploadRequestError(
        409,
        reservation.uploadSession.status === 'expired'
          ? 'UPLOAD_SESSION_EXPIRED'
          : 'INVALID_STATE_TRANSITION',
      );

    ownerId = await currentOwner(generation);
    setStage('先確認原工作是否已完成…');
    try {
      const completion = await sendCompletion(item, ownerId);
      if ('status' in completion && completion.status === 'needs_review') {
        await finishNeedsReview(item, generation);
        return;
      }
      await finishSuccess(item, generation);
      return;
    } catch (error) {
      if (
        error instanceof UploadRequestError &&
        reviewFailureCodes.has(error.code)
      ) {
        await finishNeedsReview(item, generation);
        return;
      }
      if (!isObjectMissing(error) && !isAuthorizationRequired(error))
        throw error;
    }

    ownerId = await currentOwner(generation);
    const authorization: UploadAuthorization = await authorizeUpload(
      reservation.uploadSession.id,
      item.authorizeBody,
      ownerId,
    );
    if (!isActive(generation)) return;

    ownerId = await currentOwner(generation);
    setStage('再次確認原工作是否已有照片…');
    try {
      const completion = await sendCompletion(item, ownerId);
      if ('status' in completion && completion.status === 'needs_review') {
        await finishNeedsReview(item, generation);
        return;
      }
      await finishSuccess(item, generation);
      return;
    } catch (error) {
      if (
        error instanceof UploadRequestError &&
        reviewFailureCodes.has(error.code)
      ) {
        await finishNeedsReview(item, generation);
        return;
      }
      if (!isObjectMissing(error)) throw error;
    }

    ownerId = await currentOwner(generation);
    setStage('直接傳送原始照片…');
    await putUploadFile(
      file,
      prepared.contentType,
      authorization,
      journalPort?.signal,
    );
    if (!isActive(generation)) return;

    ownerId = await currentOwner(generation);
    setStage('確認伺服器已完成上傳…');
    try {
      const completion = await sendCompletion(item, ownerId);
      if ('status' in completion && completion.status === 'needs_review') {
        await finishNeedsReview(item, generation);
        return;
      }
      await finishSuccess(item, generation);
    } catch (error) {
      if (
        error instanceof UploadRequestError &&
        reviewFailureCodes.has(error.code)
      ) {
        await finishNeedsReview(item, generation);
        return;
      }
      if (
        error instanceof UploadRequestError &&
        error.code === 'UPLOAD_ALREADY_COMPLETED'
      ) {
        const confirmed = await sendCompletion(
          item,
          await currentOwner(generation),
        );
        if ('status' in confirmed && confirmed.status === 'completed') {
          await finishSuccess(item, generation);
          return;
        }
      }
      throw error;
    }
  }

  async function retryIntent() {
    if (!activeItem || !canResume || !enterOperation()) return;
    markQueueAutoRunDone();
    const generation = generationRef.current;
    setNotice('');
    setSafeRefreshRequestId('');
    try {
      await resumeIntent(activeItem, generation);
    } catch (error) {
      if (!isActive(generation)) return;
      if (
        error instanceof UploadRequestError &&
        reviewFailureCodes.has(error.code)
      ) {
        await finishNeedsReview(activeItem, generation);
      } else {
        setNotice(errorMessage(error));
      }
      if (
        error instanceof UploadRequestError &&
        reviewFailureCodes.has(error.code)
      ) {
        // The backend retained this reservation for explicit review.
      } else if (
        error instanceof UploadRequestError &&
        safeRefreshCodes.has(error.code) &&
        activeItem.reservation === null
      ) {
        setSafeRefreshRequestId(activeItem.reservationBody.requestId);
      } else if (
        error instanceof UploadRequestError &&
        error.code === 'REQUEST_ID_CONFLICT'
      ) {
        setBlockedRequestId(activeItem.reservationBody.requestId);
      } else if (error instanceof UploadProtocolError && !error.retryable) {
        setBlockedRequestId(activeItem.reservationBody.requestId);
      } else if (!isSafeToRetry(error)) {
        setBlockedRequestId(activeItem.reservationBody.requestId);
      }
    } finally {
      leaveOperation(generation);
    }
  }

  async function refreshRejectedIntent() {
    const item = itemsRef.current[0];
    if (
      !modeActive ||
      !item ||
      item.reservation !== null ||
      safeRefreshRequestId !== item.reservationBody.requestId ||
      busyRef.current ||
      !fileMatchesIntent
    )
      return;
    const generation = generationRef.current;
    if (!enterOperation()) return;
    try {
      // This button is offered only after a definitive server rejection, which
      // confirms no reservation exists. Unknown outcomes never clear the intent.
      await persist([], generation);
      if (!isActive(generation)) return;
      setSafeRefreshRequestId('');
      setBlockedRequestId('');
      setPreview({ status: 'idle' });
      setNotice('原請求已被伺服器明確拒絕。正在重新取得目前比對結果…');
      await refreshPreviewWhileBusy(generation);
    } catch (error) {
      if (isActive(generation)) setNotice(errorMessage(error));
    } finally {
      leaveOperation(generation);
    }
  }

  async function refreshPreviewWhileBusy(generation: number) {
    if (!file || !prepared) throw new Error('請先選擇並檢查照片原檔。');
    setPreview({ status: 'loading' });
    const fingerprint = createFingerprint(file, prepared);
    clearAssistedCatalog();
    const request = fileRequestBody(fingerprint);
    const ownerId = await currentOwner(generation);
    const response = await fetch(
      '/api/v1/albums/' + encodeURIComponent(albumId) + '/upload-resolution',
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Kino-Expected-Actor': z.uuid().parse(ownerId),
        },
        body: JSON.stringify(request),
        cache: 'no-store',
      },
    );
    const value = parseResponse(
      resolvedUploadPreviewResponseSchema,
      await readResponse(response),
    );
    validatePreview(value, workspaceId, projectId, albumId);
    if (!isActive(generation)) return;
    setPreview({ status: 'ready', value, fingerprint });
    if (
      !isUnsafePreview(value) &&
      value.mode === 'assisted' &&
      value.catalogCursor !== undefined &&
      value.decision.outcome !== 'duplicate'
    ) {
      const binding = createAssistedCatalogBinding(value, fingerprint, actorId);
      if (binding) {
        catalogBindingRef.current = binding;
        await requestAssistedCatalogPage(
          binding,
          binding.initialCursor,
          'initial',
          generation,
        );
      }
    }
    setAssistedChoiceKind(null);
    setAssistedPhotoId('');
    setNotice(
      isUnsafePreview(value)
        ? '最新比對結果仍不完整或需要檢查。沒有建立上傳。'
        : value.decision.outcome === 'duplicate'
          ? '相同照片內容已存在，沒有建立上傳。'
          : '已取得最新比對結果。請重新確認目標後再建立工作。',
    );
  }

  function skipBeforeReservation() {
    if (!modeActive || activeItem || busyRef.current) return;
    clearAssistedCatalog();
    setConfirmOpen(false);
    setPreview({ status: 'idle' });
    setFile(null);
    setPrepared(null);
    setAssistedChoiceKind(null);
    setAssistedPhotoId('');
    setNotice('已略過這張照片，沒有建立上傳工作。');
  }

  function openConfirmation() {
    if (
      !modeActive ||
      disabled ||
      activeItem ||
      busy ||
      !previewValue ||
      blockedPreview ||
      !hasResolverMode
    )
      return;
    const choice = selectedChoice(previewValue);
    if (!choice) {
      setNotice('請先明確選擇新照片或一個完整的目前版本目標。');
      return;
    }
    setNotice('');
    setConfirmOpen(true);
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busyRef.current) {
      event.preventDefault();
      setConfirmOpen(false);
    }
  }

  function currentQueueAutoRunAttempt() {
    if (!queueFile) return null;
    const generation = generationRef.current;
    const itemId = journalPort?.itemId ?? null;
    const previous = queueAutoRunRef.current;
    if (
      !previous ||
      previous.file !== queueFile ||
      previous.itemId !== itemId ||
      previous.generation !== generation
    ) {
      const next = {
        file: queueFile,
        itemId,
        generation,
        phase: 'idle' as const,
      };
      queueAutoRunRef.current = next;
      return next;
    }
    return previous;
  }

  function markQueueAutoRunDone() {
    const attempt = currentQueueAutoRunAttempt();
    if (attempt) attempt.phase = 'done';
  }

  function runQueueAutoRun() {
    if (
      !autoRun ||
      !queueFile ||
      disabled ||
      capability.status !== 'ready' ||
      journalState !== 'ready'
    )
      return;
    const attempt = currentQueueAutoRunAttempt();
    if (!attempt || attempt.phase === 'done') return;
    if (
      busy ||
      busyRef.current ||
      selecting ||
      selectingRef.current ||
      !capabilitiesRef.current ||
      !file ||
      file !== queueFile ||
      !prepared
    )
      return;

    if (activeItem) {
      if (!fileMatchesIntent || !canResume) return;
      attempt.phase = 'done';
      void retryIntent();
      return;
    }
    if (!modeActive) return;
    if (attempt.phase === 'idle') {
      attempt.phase = 'preview';
      void refreshPreview();
      return;
    }
    if (preview.status === 'invalid') {
      attempt.phase = 'done';
      return;
    }
    if (previewValue) {
      if (automaticQueueChoice(previewValue)) {
        void confirmReservation();
      } else {
        attempt.phase = 'done';
      }
    }
  }

  useEffect(() => {
    queueFileHandlerRef.current = (selected) => {
      void chooseFile(selected, true);
    };
    queueAutoRunHandlerRef.current = runQueueAutoRun;
  });

  useEffect(() => {
    if (
      !queueFile ||
      capability.status !== 'ready' ||
      journalState !== 'ready' ||
      disabled ||
      busy ||
      busyRef.current ||
      selecting ||
      selectingRef.current ||
      (!modeActive && !itemsRef.current[0])
    )
      return;
    const generation = generationRef.current;
    const itemId = journalPort?.itemId ?? null;
    const previous = queueFileSetupRef.current;
    if (
      previous?.file === queueFile &&
      previous.itemId === itemId &&
      previous.generation === generation
    )
      return;
    queueFileSetupRef.current = { file: queueFile, itemId, generation };
    queueFileHandlerRef.current(queueFile);
  }, [
    busy,
    capability.status,
    disabled,
    journalPort?.itemId,
    journalState,
    modeActive,
    queueFile,
    selecting,
  ]);

  useEffect(() => {
    queueAutoRunHandlerRef.current();
  }, [
    activeItem,
    autoRun,
    busy,
    canResume,
    capability.status,
    disabled,
    file,
    fileMatchesIntent,
    journalPort?.itemId,
    journalState,
    modeActive,
    prepared,
    preview.status,
    previewValue,
    queueFile,
    selecting,
  ]);

  if (capability.status === 'disabled') return null;
  if (
    !modeActive &&
    journalState === 'ready' &&
    !activeItem &&
    !completionNotice
  )
    return null;

  return (
    <section
      data-testid="resolved-upload"
      aria-labelledby={sectionId}
      className="min-w-0 rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="min-w-0">
        <h2 id={sectionId} className="text-lg font-semibold text-stone-950">
          {modeActive ? '依檔名解析上傳' : '已保存的解析上傳工作'}
        </h2>
        <p className="mt-1 break-words text-sm text-stone-600">
          每次只建立一筆固定目標工作。私有版本會保留歷史，不會自動切換目前版本。
        </p>
      </div>

      {capability.status === 'loading' && (
        <p role="status" className="mt-3 text-sm text-stone-600">
          正在確認解析上傳功能…
        </p>
      )}
      {capability.status === 'unavailable' && (
        <p role="alert" className="mt-3 break-words text-sm text-rose-800">
          {capability.message}
        </p>
      )}
      {capability.status === 'ready' && (
        <>
          {journalState === 'loading' && (
            <p role="status" className="mt-3 text-sm text-stone-600">
              正在載入這個相簿的安全工作記錄…
            </p>
          )}
          {journalIssue && (
            <p
              role="alert"
              className="mt-3 break-words rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
            >
              {journalIssue}
            </p>
          )}

          {!modeActive && activeItem && (
            <p className="mt-3 break-words text-sm text-amber-900">
              相簿解析模式目前已停用。以下只接續既有工作，不會預覽或建立新工作。
            </p>
          )}

          {completionNotice && (
            <div className="mt-3 flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-950">
              <p className="min-w-0 flex-1 break-words" role="status">
                {completionNotice}
              </p>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setCompletionNotice('')}
                className="min-h-10 rounded-md border border-emerald-800 px-3 py-1 font-medium hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                清除完成訊息
              </button>
            </div>
          )}

          {activeItem && (
            <div className="mt-4 min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3">
              <h3 className="font-medium text-amber-950">
                已保存的解析上傳工作
              </h3>
              <p className="mt-1 break-words text-sm text-amber-950">
                請重新選擇相同原檔並使用原請求接續。系統不會建立另一筆工作。
              </p>
              <dl className="mt-2 grid min-w-0 gap-1 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
                <dt className="text-stone-700">原始檔案</dt>
                <dd className="min-w-0 break-words">
                  {activeItem.fingerprint.originalFilename}
                </dd>
                <dt className="text-stone-700">預期大小</dt>
                <dd>
                  {activeItem.fingerprint.expectedBytes.toLocaleString()} bytes
                </dd>
                <dt className="text-stone-700">建立請求編號</dt>
                <dd className="break-all font-mono text-xs">
                  {activeItem.reservationBody.requestId}
                </dd>

                <dt className="text-stone-700">固定目標</dt>
                <dd className="min-w-0 break-words">
                  {!activeItem.reservation
                    ? '尚未取得伺服器確認'
                    : activeItem.reservation.target.kind === 'new_photo'
                      ? '新照片'
                      : '私有新版本 · ' +
                        activeItem.reservation.target.photoId.slice(0, 8) +
                        ' · 原目前版本 ' +
                        activeItem.reservation.target.parentVersionId.slice(
                          0,
                          8,
                        )}
                </dd>
              </dl>
              {activeItem.needsReview && (
                <p className="mt-2 text-sm font-medium text-amber-950">
                  伺服器已標記需要人工檢查。工作記錄及配額狀態會保留。
                </p>
              )}
              {activeItem.reservation?.uploadSession.status === 'expired' ||
              activeItem.reservation?.uploadSession.status === 'cancelled' ? (
                <p className="mt-2 text-sm text-rose-900">
                  伺服器回報原工作已結束。工作記錄保留，請由管理者確認後再進行其他操作。
                </p>
              ) : (
                <button
                  type="button"
                  disabled={!canResume}
                  onClick={() => void retryIntent()}
                  data-testid="resolved-upload-retry"
                  className="mt-3 min-h-11 max-w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy
                    ? '正在接續原工作…'
                    : activeItem.reservation
                      ? '以原請求確認或接續工作'
                      : '以同一請求重試建立工作'}
                </button>
              )}
              {modeActive &&
                safeRefreshRequestId === activeItem.reservationBody.requestId &&
                activeItem.reservation === null && (
                  <button
                    type="button"
                    disabled={busy || disabled || !fileMatchesIntent}
                    onClick={() => void refreshRejectedIntent()}
                    className="mt-3 min-h-11 w-full max-w-full rounded-md border border-amber-700 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 sm:ml-2 sm:w-auto"
                  >
                    重新檢查目前目標
                  </button>
                )}
            </div>
          )}

          {(modeActive || activeItem) && (
            <div className="mt-4 min-w-0">
              <label
                htmlFor={fileId}
                className="block text-sm font-medium text-stone-900"
              >
                原始照片
              </label>
              <input
                id={fileId}
                data-testid="resolved-upload-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={
                  disabled ||
                  queueFile !== undefined ||
                  busy ||
                  selecting ||
                  journalState !== 'ready' ||
                  currentItemBlocked
                }
                onChange={(event) => void selectFile(event)}
                className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-stone-300 bg-white p-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:bg-stone-100"
              />
            </div>
          )}

          {(modeActive || activeItem) && prepared && file && (
            <div className="mt-3 flex min-w-0 items-center gap-3 rounded-md bg-stone-50 p-2">
              <img
                src={prepared.previewUrl}
                alt="所選照片的本機預覽"
                className="size-16 shrink-0 rounded object-cover"
              />
              <p className="min-w-0 break-words text-sm text-stone-700">
                {file.name} · {file.size.toLocaleString()} bytes · 原始尺寸{' '}
                {prepared.encodedWidth} × {prepared.encodedHeight}
              </p>
            </div>
          )}

          {!activeItem && modeActive && (
            <>
              <div className="mt-3 flex min-w-0 flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    disabled ||
                    busy ||
                    selecting ||
                    !file ||
                    !prepared ||
                    journalState !== 'ready'
                  }
                  onClick={() => void refreshPreview()}
                  data-testid="resolved-upload-preview"
                  className="min-h-11 max-w-full rounded-md border border-stone-400 bg-white px-4 py-2 text-sm font-medium text-stone-900 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {preview.status === 'loading' || busy
                    ? '正在檢查…'
                    : preview.status === 'ready' || preview.status === 'invalid'
                      ? '重新檢查目標'
                      : '檢查目標'}
                </button>
                {(preview.status === 'ready' ||
                  preview.status === 'invalid' ||
                  file !== null) && (
                  <button
                    type="button"
                    disabled={disabled || busy || selecting}
                    onClick={skipBeforeReservation}
                    data-testid="resolved-upload-skip"
                    className="min-h-11 max-w-full rounded-md border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    略過這張照片
                  </button>
                )}
              </div>

              {preview.status === 'invalid' && (
                <p
                  role="alert"
                  className="mt-3 break-words rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
                >
                  {preview.message}
                </p>
              )}

              {previewValue && (
                <div className="mt-4 min-w-0 rounded-md border border-stone-200 p-3">
                  <h3
                    data-testid="resolved-upload-decision-label"
                    className="font-medium text-stone-950"
                  >
                    {previewDecisionHeading}
                  </h3>
                  <p className="mt-1 break-words text-sm text-stone-700">
                    比對方式：
                    {
                      {
                        off: '版本偵測已關閉',
                        manual: '手動指定版本',
                        auto_filename: '自動比對同名照片',
                        assisted: '輔助選擇照片或版本',
                      }[previewValue.mode]
                    }
                  </p>
                  {previewValue.matchingProfile && (
                    <p
                      data-testid="matching-profile-summary"
                      className="mt-2 break-words text-sm text-stone-700"
                    >
                      目前比對規則：
                      {matchingRulesDescription(
                        previewValue.matchingProfile.profile,
                      )}
                      。這份選擇會固定在本次上傳工作中。
                    </p>
                  )}
                  {previewValue.decision.outcome === 'duplicate' && (
                    <p className="mt-2 break-words text-sm text-stone-700">
                      同一內容已在照片{' '}
                      {previewValue.decision.photoId?.slice(0, 8)}{' '}
                      中。沒有建立上傳或保留配額。
                    </p>
                  )}
                  {blockedPreview && (
                    <p
                      role="alert"
                      className="mt-2 break-words text-sm text-rose-800"
                    >
                      候選資料不完整、含待完成工作或未通過驗證。保留目前檔案，按「重新檢查目標」取得完整結果；此結果不能建立上傳。
                    </p>
                  )}
                  {previewValue.mode === 'off' ||
                  previewValue.mode === 'manual' ? (
                    <p className="mt-2 break-words text-sm text-amber-900">
                      目前模式不允許解析上傳。尚未建立任何工作。
                    </p>
                  ) : null}

                  {previewValue.mode === 'assisted' &&
                    !blockedPreview &&
                    previewValue.decision.outcome !== 'duplicate' &&
                    (assistedCatalogEnabled ? (
                      <AssistedCandidatePicker
                        uploadedFilename={
                          fileFingerprint?.originalFilename ?? ''
                        }
                        status={currentCatalog?.status ?? 'loading'}
                        items={currentCatalog?.items ?? []}
                        nextCursor={currentCatalog?.nextCursor ?? null}
                        pageNumber={currentCatalog?.pageNumber ?? 1}
                        hasPrevious={
                          (currentCatalog?.cursorStack.length ?? 0) > 1
                        }
                        canReturnFirst={
                          currentCatalog?.currentCursor !==
                          currentCatalog?.binding.initialCursor
                        }
                        message={currentCatalog?.message ?? ''}
                        selectedKind={assistedChoiceKind}
                        selectedCandidate={
                          currentCatalogSelection?.candidate ?? null
                        }
                        disabled={disabled || busy}
                        onKindChange={(kind) => {
                          setAssistedChoiceKind(kind);
                          if (kind === 'new_photo') setAssistedPhotoId('');
                        }}
                        onSelect={selectAssistedCatalogCandidate}
                        onFirst={goToFirstCatalogPage}
                        onPrevious={goToPreviousCatalogPage}
                        onNext={goToNextCatalogPage}
                        onRefresh={refreshAssistedCatalog}
                      />
                    ) : (
                      <fieldset
                        className="mt-3 min-w-0 space-y-3"
                        disabled={disabled || busy}
                      >
                        <legend className="text-sm font-medium text-stone-900">
                          請明確選擇這次上傳目標
                        </legend>
                        <label className="flex min-w-0 items-start gap-2 rounded-md border border-stone-200 p-3 text-sm">
                          <input
                            type="radio"
                            name={choiceId}
                            value="new_photo"
                            checked={assistedChoiceKind === 'new_photo'}
                            onChange={() => {
                              setAssistedChoiceKind('new_photo');
                              setAssistedPhotoId('');
                            }}
                            className="mt-1 size-4 shrink-0 accent-stone-800"
                          />
                          <span>建立一張新照片</span>
                        </label>
                        <div className="min-w-0 rounded-md border border-stone-200 p-3">
                          <label
                            htmlFor={choiceId + '-candidate'}
                            className="flex min-w-0 items-start gap-2 text-sm"
                          >
                            <input
                              type="radio"
                              name={choiceId}
                              value="new_version"
                              checked={assistedChoiceKind === 'new_version'}
                              onChange={() =>
                                setAssistedChoiceKind('new_version')
                              }
                              className="mt-1 size-4 shrink-0 accent-stone-800"
                            />
                            <span className="font-medium">
                              建立現有照片的新版本
                            </span>
                          </label>
                          <label
                            htmlFor={choiceId + '-candidate'}
                            className="mt-2 block text-sm text-stone-700"
                          >
                            選擇一個候選照片
                          </label>
                          <select
                            id={choiceId + '-candidate'}
                            value={assistedPhotoId}
                            onChange={(event) =>
                              setAssistedPhotoId(event.currentTarget.value)
                            }
                            disabled={
                              disabled ||
                              busy ||
                              assistedChoiceKind !== 'new_version'
                            }
                            className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm disabled:bg-stone-100"
                          >
                            <option value="">請選擇</option>
                            {previewValue.candidates.map((candidate) => (
                              <option
                                key={candidate.photoId}
                                value={candidate.photoId}
                                disabled={candidateChoice(candidate) === null}
                              >
                                {candidateDescription(candidate)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </fieldset>
                    ))}
                  {previewValue.mode === 'auto_filename' &&
                    !blockedPreview &&
                    previewValue.decision.outcome !== 'duplicate' && (
                      <p className="mt-3 break-words text-sm text-stone-700">
                        {autoChoice?.kind === 'new_photo'
                          ? '伺服器只找到唯一的新照片目標。'
                          : autoChoice?.kind === 'new_version'
                            ? '伺服器找到唯一版本目標：照片 ' +
                              autoChoice.photoId.slice(0, 8) +
                              '，目前版本 ' +
                              autoChoice.parentVersionId.slice(0, 8) +
                              '。'
                            : '自動解析無法唯一確認目標，不能建立上傳。'}
                      </p>
                    )}

                  <div className="mt-4 flex min-w-0 flex-wrap gap-2">
                    {previewValue.decision.outcome !== 'duplicate' &&
                      hasResolverMode && (
                        <button
                          type="button"
                          disabled={
                            disabled || busy || !dialogChoice || blockedPreview
                          }
                          onClick={openConfirmation}
                          data-testid="resolved-upload-reserve"
                          className="min-h-11 max-w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          確認目標並建立上傳
                        </button>
                      )}
                    {previewValue.decision.outcome === 'duplicate' && (
                      <button
                        type="button"
                        disabled={disabled || busy}
                        onClick={skipBeforeReservation}
                        data-testid="resolved-upload-skip"
                        className="min-h-11 max-w-full rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        略過已存在照片
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {stage && (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 text-sm text-stone-700"
            >
              {stage}
            </p>
          )}
          {notice && (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 break-words text-sm text-stone-700"
            >
              {notice}
            </p>
          )}
          {disabled && (
            <p className="mt-3 break-words text-sm text-stone-600">
              目前無法開始新的操作。
            </p>
          )}
        </>
      )}

      {confirmOpen && modeActive && previewValue && dialogChoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5">
          <div
            ref={dialogRef}
            data-testid="resolved-upload-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={confirmTitleId}
            aria-describedby={confirmDescriptionId}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-4 shadow-xl sm:p-5"
          >
            <h2 id={confirmTitleId} className="text-lg font-semibold">
              確認固定上傳目標
            </h2>
            {previewValue.matchingProfile && (
              <p
                data-testid="matching-profile-confirmation"
                className="mt-2 break-words text-sm text-stone-700"
              >
                本次比對規則：
                {matchingRulesDescription(previewValue.matchingProfile.profile)}
                。
              </p>
            )}
            <p
              id={confirmDescriptionId}
              className="mt-2 break-words text-sm text-stone-700"
            >
              {dialogChoice.kind === 'new_photo'
                ? '系統會將這張照片建立為相簿中的新照片。'
                : assistedCatalogEnabled && dialogCandidate
                  ? '系統會在「' +
                    dialogCandidate.filename +
                    '」下建立私有新版本，父版本固定為該照片的目前版本。'
                  : '系統會在照片 ' +
                    dialogChoice.photoId.slice(0, 8) +
                    ' 下建立私有新版本，父版本固定為 ' +
                    dialogChoice.parentVersionId.slice(0, 8) +
                    '。目前版本不會自動切換。'}{' '}
              確認後，原始檔案指紋、比對序號、目標與所有請求編號會先保存，再送出建立請求。未知結果只能用同一工作記錄接續。
            </p>
            <div className="mt-5 flex min-w-0 flex-wrap justify-end gap-2">
              <button
                ref={cancelDialogRef}
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
                className="min-h-11 max-w-full rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                返回修改
              </button>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={() => void confirmReservation()}
                data-testid="resolved-upload-confirm"
                className="min-h-11 max-w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '正在保存…' : '確認並建立工作'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

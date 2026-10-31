'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { z } from 'zod';
import {
  projectMatchingRulesReadSchema,
  type ProjectMatchingRulesRead,
} from '../../../packages/contracts/src/matching-rules';
import {
  resolvedBatchUploadCapabilitiesSchema,
  type ResolvedBatchUploadsCapabilities,
} from '../../../packages/contracts/src/resolved-batch-uploads';
import {
  resolvedBatchDescriptorForFile,
  resolvedBatchJournalScopeSchema,
  type ResolvedBatchItemEnvelope,
  type ResolvedBatchJournalScope,
  type ResolvedBatchManifest,
  type ResolvedBatchPolicy,
} from './resolved-batch-journal';
import {
  resolvedUploadJournalKey,
  decodeResolvedUploadJournal,
} from './resolved-upload-journal';
import {
  ResolvedAlbumUpload,
  matchingRulesDescription,
  type ResolvedAlbumUploadProps,
  type ResolvedUploadJournalPort,
} from './resolved-upload';
import {
  UploadRequestError,
  getUploadCapabilities,
  getUploadIdentity,
  type UploadIdentity,
} from './upload-client';
import { ResolvedBatchStore } from './resolved-batch-store';

type Props = Omit<
  ResolvedAlbumUploadProps,
  'journalPort' | 'queueFile' | 'autoRun'
>;

type CapabilityState =
  | { status: 'loading' }
  | { status: 'ready'; value: ResolvedBatchUploadsCapabilities }
  | { status: 'disabled' }
  | { status: 'unavailable'; message: string };

type BatchPageState = {
  manifest: ResolvedBatchManifest;
  page: Awaited<ReturnType<ResolvedBatchStore['listItems']>>;
  pageStarts: (number | null)[];
  files: Map<string, File>;
};

type RunContext = {
  epoch: number;
  sessionId: string;
  ordinal: number;
  captured: boolean;
  controller: AbortController;
};

type Actionable =
  | { kind: 'item'; item: ResolvedBatchItemEnvelope }
  | { kind: 'review'; item: ResolvedBatchItemEnvelope }
  | null;

type CommitEvent = {
  kind: 'advance' | 'pause';
  item: ResolvedBatchItemEnvelope;
  epoch: number;
};

const errorEnvelopeSchema = z.object({ error: z.object({ code: z.string() }) });
const resolverCapabilitiesSchema = z.object({ enabled: z.boolean() }).strict();
const supportedContentTypeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function wallClockNow() {
  return Date.now();
}

function batchPointerKey(scope: ResolvedBatchJournalScope) {
  return resolvedUploadJournalKey(scope) + ':batch:v1';
}

function responseError(body: unknown) {
  const parsed = errorEnvelopeSchema.safeParse(body);
  return parsed.success ? parsed.data.error.code : 'UNKNOWN_ERROR';
}

function batchErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const messages: Record<string, string> = {
    MATCHING_RULES_CHANGED:
      '規則已變更，尚未開始的新工作已暫停；已保存的原請求仍保留。',
    UPLOAD_OWNER_CHANGED: '登入身分已變更，請重新確認後再接續。',
    RESOLVED_BATCH_SCOPE_CHANGED: '批次工作範圍已變更，原有工作記錄仍保留。',
    RESOLVED_BATCH_ITEM_MISSING: '無法讀取這筆批次記錄，沒有建立新的上傳工作。',
    RESOLVED_BATCH_POINTER_INVALID:
      '批次記錄指標無法驗證，資料已保留且不會建立新工作。',
    RESOLVED_BATCH_POINTER_MISSING:
      '找不到批次工作記錄，資料已保留且不會建立新工作。',
    RESOLVED_BATCH_INTENT_INVALID:
      '原上傳請求無法驗證，已保留工作記錄並停止接續。',
    RESOLVED_BATCH_ITEM_TERMINAL: '這筆工作已結束，不能再次修改。',
    RESOLVED_BATCH_ITEM_REQUIRES_REVIEW:
      '這筆工作需要人工檢查，原請求仍已保留。',
  };
  return (
    messages[error.message] ??
    (/^[A-Z][A-Z0-9_]*$/.test(error.message) ? fallback : error.message)
  );
}

function isAccessDenied(error: unknown) {
  return (
    (error instanceof UploadRequestError &&
      (error.status === 401 || error.status === 403)) ||
    (error instanceof Error && /(?:^|_)OWNER_CHANGED$/.test(error.message))
  );
}

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(responseError(body));
  return body;
}

async function readCapabilities(actorId: string, signal?: AbortSignal) {
  const response = await fetch('/api/v1/resolved-batch-uploads/capabilities', {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-Kino-Expected-Actor': z.uuid().parse(actorId),
    },
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  return resolvedBatchUploadCapabilitiesSchema.parse(await readJson(response));
}

async function readProjectRules(
  identity: UploadIdentity,
  projectId: string,
  workspaceId: string,
  signal?: AbortSignal,
): Promise<ProjectMatchingRulesRead> {
  const response = await fetch(
    '/api/v1/projects/' + encodeURIComponent(projectId) + '/matching-rules',
    {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Kino-Expected-Actor': z.uuid().parse(identity.actorId),
      },
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    },
  );
  const rules = projectMatchingRulesReadSchema.parse(await readJson(response));
  if (rules.projectId !== projectId || rules.workspaceId !== workspaceId)
    throw new Error('MATCHING_RULES_SCOPE_CHANGED');
  return rules;
}

async function readRecoveryCapabilities(
  actorId: string,
  workspaceId: string,
  signal?: AbortSignal,
) {
  const [upload, response] = await Promise.all([
    getUploadCapabilities(signal, workspaceId),
    fetch('/api/v1/upload-resolution/capabilities', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-Kino-Expected-Actor': z.uuid().parse(actorId),
      },
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    }),
  ]);
  const resolution = resolverCapabilitiesSchema.parse(await readJson(response));
  return upload.enabled && resolution.enabled;
}

function policyFor(rules: ProjectMatchingRulesRead): ResolvedBatchPolicy {
  return {
    expectedMode: rules.mode,
    projectRevision: rules.projectRevision,
    matchingProfile: {
      profile: rules.profile,
      ruleRevision: rules.ruleRevision,
    },
  };
}

function samePolicy(left: ResolvedBatchPolicy, right: ResolvedBatchPolicy) {
  return (
    left.expectedMode === right.expectedMode &&
    left.projectRevision === right.projectRevision &&
    left.matchingProfile?.profile === right.matchingProfile?.profile &&
    left.matchingProfile?.ruleRevision === right.matchingProfile?.ruleRevision
  );
}

function contentTypeFor(file: File) {
  if (file.type) {
    const parsed = supportedContentTypeSchema.safeParse(file.type);
    return parsed.success ? parsed.data : null;
  }
  const name = file.name.toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return null;
}

function itemStatus(item: ResolvedBatchItemEnvelope) {
  switch (item.state) {
    case 'queued':
      return '待處理';
    case 'captured':
      return '已保存原請求，等待接續';
    case 'completed':
      return '已完成';
    case 'rejected':
      return '伺服器已明確拒絕';
    case 'needs_review':
      return '需要人工檢查';
    case 'cancelled':
      return '已略過';
  }
}

function policySummary(policy: ResolvedBatchPolicy) {
  const profile = policy.matchingProfile;
  const modeDescription: Record<ResolvedBatchPolicy['expectedMode'], string> = {
    off: '不自動比對',
    manual: '逐張手動選擇',
    auto_filename: '依檔名自動比對',
    assisted: '依檔名建議並逐張確認',
  };
  return (
    modeDescription[policy.expectedMode] +
    (profile ? ' · ' + matchingRulesDescription(profile.profile) : '')
  );
}

function pageNumber(pageStarts: (number | null)[]) {
  return Math.max(1, pageStarts.length);
}

export function ResolvedBatchAlbumUpload(props: Props) {
  const resourceKey = [
    props.actorId,
    props.workspaceId,
    props.projectId,
    props.albumId,
  ].join(':');
  return <ResolvedBatchAlbumUploadPanel key={resourceKey} {...props} />;
}

function ResolvedBatchAlbumUploadPanel(props: Props) {
  const store = useMemo(() => new ResolvedBatchStore(), []);
  const [capability, setCapability] = useState<CapabilityState>({
    status: 'loading',
  });
  const [scope, setScope] = useState<ResolvedBatchJournalScope | null>(null);
  const [identity, setIdentity] = useState<UploadIdentity | null>(null);
  const [queue, setQueue] = useState<BatchPageState | null>(null);
  const queueRef = useRef<BatchPageState | null>(null);
  const [hasPointer, setHasPointer] = useState(false);
  const [accessLostRequested, setAccessLostRequested] = useState(false);
  const [restoreError, setRestoreError] = useState('');
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [legacyState, setLegacyState] = useState<
    'empty' | 'pending' | 'invalid'
  >('empty');
  const [view, setView] = useState<'single' | 'batch'>('single');
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState('');
  const batchChangedRef = useRef(false);
  const onChangedRef = useRef(props.onChanged);
  const [skipConfirmId, setSkipConfirmId] = useState<string | null>(null);
  const [acknowledgedThrough, setAcknowledgedThrough] = useState(-1);
  const [currentOrdinal, setCurrentOrdinal] = useState<number | null>(null);
  const [run, setRun] = useState<RunContext | null>(null);
  const [commitEvent, setCommitEvent] = useState<CommitEvent | null>(null);
  const runRef = useRef<RunContext | null>(null);
  const displayRun =
    run && !props.disabled && (props.modeActive !== false || run.captured)
      ? run
      : null;
  const epochRef = useRef(0);
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);
  const advanceAfterRef = useRef<
    (item: ResolvedBatchItemEnvelope, epoch: number) => Promise<void>
  >(async () => undefined);
  const processedCommitEventRef = useRef<CommitEvent | null>(null);
  const markBatchChanged = useCallback(() => {
    batchChangedRef.current = true;
  }, []);
  useLayoutEffect(() => {
    onChangedRef.current = props.onChanged;
  }, [props.onChanged]);
  const flushBatchChanges = useCallback(() => {
    if (!batchChangedRef.current) return;
    batchChangedRef.current = false;
    onChangedRef.current();
  }, []);
  const hideBatchForAccessLoss = useCallback(() => {
    runRef.current?.controller.abort();
    runRef.current = null;
    queueRef.current = null;
    setRun(null);
    setQueue(null);
    setIdentity(null);
    setLegacyState('empty');
    setCurrentOrdinal(null);
    setStagedFiles([]);
    setSkipConfirmId(null);
    setAcknowledgedThrough(-1);
    setRecoveryAvailable(false);
    setAccessLostRequested(true);
    setCapability({
      status: 'unavailable',
      message: '登入身分已變更，已暫停批次工作並隱藏檔名。',
    });
    setRestoreError(
      '登入身分已變更。工作記錄仍保存在本機；重新確認身分後再載入。',
    );
    setNotice('');
    flushBatchChanges();
  }, [flushBatchChanges]);
  const requestAccessLost = useCallback(() => setAccessLostRequested(true), []);

  useLayoutEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useLayoutEffect(() => {
    if (
      run &&
      (props.disabled || (props.modeActive === false && !run.captured))
    ) {
      run.controller.abort();
      runRef.current = null;
      return;
    }
    runRef.current = run ? { ...run } : null;
  }, [props.disabled, props.modeActive, run]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const currentIdentity = await getUploadIdentity(controller.signal);
        if (currentIdentity.actorId !== z.uuid().parse(props.actorId))
          throw new Error('UPLOAD_OWNER_CHANGED');
        const currentScope = resolvedBatchJournalScopeSchema.parse({
          actorId: currentIdentity.actorId,
          workspaceId: props.workspaceId,
          projectId: props.projectId,
          albumId: props.albumId,
        });
        setIdentity(currentIdentity);
        setScope(currentScope);

        try {
          const legacy = decodeResolvedUploadJournal(
            localStorage.getItem(resolvedUploadJournalKey(currentScope)),
            currentScope,
          );
          setLegacyState(legacy.length > 0 ? 'pending' : 'empty');
        } catch {
          setLegacyState('invalid');
        }

        const pointerKey = batchPointerKey(currentScope);
        const pointer = localStorage.getItem(pointerKey);
        if (pointer !== null) {
          setHasPointer(true);
          const parsedQueueId = z.uuid().safeParse(pointer);
          if (!parsedQueueId.success)
            throw new Error('RESOLVED_BATCH_POINTER_INVALID');
          const manifest = await store.readManifest(
            currentScope,
            parsedQueueId.data,
          );
          if (!manifest) throw new Error('RESOLVED_BATCH_POINTER_MISSING');
          const page = await store.listItems(
            currentScope,
            parsedQueueId.data,
            null,
            24,
          );
          if (!active) return;
          setQueue({
            manifest,
            page,
            pageStarts: [null],
            files: new Map(),
          });
          setCurrentOrdinal(
            page.items.find((item) =>
              ['queued', 'captured', 'needs_review', 'rejected'].includes(
                item.state,
              ),
            )?.descriptor.ordinal ?? null,
          );
          setView('batch');
        }

        let capabilities: ResolvedBatchUploadsCapabilities;
        try {
          capabilities = await readCapabilities(
            currentIdentity.actorId,
            controller.signal,
          );
        } catch (error) {
          if (!active || controller.signal.aborted) return;
          if (isAccessDenied(error)) {
            hideBatchForAccessLoss();
            return;
          }
          setCapability({
            status: 'unavailable',
            message: batchErrorMessage(error, '批次上傳功能目前無法驗證。'),
          });
          if (pointer !== null) {
            setRecoveryAvailable(
              await readRecoveryCapabilities(
                currentIdentity.actorId,
                props.workspaceId,
                controller.signal,
              ).catch(() => false),
            );
          }
          return;
        }
        if (!active) return;
        if (pointer !== null) {
          setRecoveryAvailable(
            await readRecoveryCapabilities(
              currentIdentity.actorId,
              props.workspaceId,
              controller.signal,
            ),
          );
        }
        setCapability(
          capabilities.enabled
            ? { status: 'ready', value: capabilities }
            : { status: 'disabled' },
        );
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        if (
          isAccessDenied(error) ||
          (error instanceof Error && error.message === 'UPLOAD_OWNER_CHANGED')
        ) {
          hideBatchForAccessLoss();
          return;
        }
        setCapability({
          status: 'unavailable',
          message: batchErrorMessage(error, '批次上傳功能目前無法驗證。'),
        });
        setRestoreError(
          '無法讀取批次工作記錄。資料已保留，請重新載入或使用單張恢復。',
        );
      }
    })();
    return () => {
      active = false;
      controller.abort();
      runRef.current?.controller.abort();
      store.close();
    };
  }, [
    hideBatchForAccessLoss,
    props.actorId,
    props.albumId,
    props.projectId,
    props.workspaceId,
    store,
  ]);

  useEffect(() => {
    if (
      run &&
      (props.disabled || (props.modeActive === false && !run.captured))
    ) {
      run.controller.abort();
      queueMicrotask(() => {
        setRun((current) => (current === run ? null : current));
        flushBatchChanges();
      });
    }
  }, [flushBatchChanges, props.disabled, props.modeActive, run]);

  useEffect(() => {
    if (!displayRun) return;
    const pauseForVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      displayRun.controller.abort();
      setRun(null);
      flushBatchChanges();
      setNotice('分頁已隱藏，批次暫停；已保存的原請求仍保留。');
    };
    const pauseForBlur = () => {
      displayRun.controller.abort();
      setRun(null);
      flushBatchChanges();
      setNotice('分頁失去焦點，批次暫停；已保存的原請求仍保留。');
    };
    document.addEventListener('visibilitychange', pauseForVisibility);
    window.addEventListener('blur', pauseForBlur);
    return () => {
      document.removeEventListener('visibilitychange', pauseForVisibility);
      window.removeEventListener('blur', pauseForBlur);
    };
  }, [displayRun, flushBatchChanges]);

  useEffect(() => () => flushBatchChanges(), [flushBatchChanges]);

  useEffect(() => {
    if (accessLostRequested) queueMicrotask(() => hideBatchForAccessLoss());
  }, [accessLostRequested, hideBatchForAccessLoss]);

  useEffect(() => {
    if (!hasPointer || !identity || props.modeActive !== false) return;
    const controller = new AbortController();
    void readRecoveryCapabilities(
      identity.actorId,
      props.workspaceId,
      controller.signal,
    )
      .then(setRecoveryAvailable)
      .catch(() => setRecoveryAvailable(false));
    return () => controller.abort();
  }, [hasPointer, identity, props.modeActive, props.workspaceId]);

  function replacePageState(
    update: (current: BatchPageState) => BatchPageState,
  ) {
    const current = queueRef.current;
    if (!current) return;
    const next = update(current);
    queueRef.current = next;
    setQueue(next);
  }

  async function fetchPage(
    afterOrdinal: number | null,
    pageStarts: (number | null)[],
  ) {
    const currentQueue = queueRef.current;
    const currentScope = scope;
    if (!currentQueue || !currentScope) return;
    const page = await store.listItems(
      currentScope,
      currentQueue.manifest.queueId,
      afterOrdinal,
      24,
    );
    replacePageState((current) => ({
      ...current,
      page,
      pageStarts,
    }));
  }

  async function showOrdinal(ordinal: number) {
    const startIndex = Math.floor(ordinal / 24) * 24;
    const starts = Array.from({ length: startIndex / 24 + 1 }, (_, index) =>
      index === 0 ? null : index * 24 - 1,
    );
    await fetchPage(starts[starts.length - 1] ?? null, starts);
  }

  async function findActionable(
    afterOrdinal: number | null = null,
    recoveryOnly = false,
  ): Promise<Actionable> {
    const currentQueue = queueRef.current;
    const currentScope = scope;
    if (!currentQueue || !currentScope) return null;
    let cursor = afterOrdinal;
    while (true) {
      const page = await store.listItems(
        currentScope,
        currentQueue.manifest.queueId,
        cursor,
        24,
      );
      for (const item of page.items) {
        if (
          item.state === 'captured' ||
          (!recoveryOnly && item.state === 'queued')
        )
          return { kind: 'item', item };
        if (
          (item.state === 'needs_review' || item.state === 'rejected') &&
          item.descriptor.ordinal > acknowledgedThrough
        )
          return { kind: 'review', item };
      }
      if (page.nextAfterOrdinal === null) return null;
      cursor = page.nextAfterOrdinal;
    }
  }

  async function assertCurrentPolicy(policy: ResolvedBatchPolicy) {
    if (!identity) throw new Error('OWNER_REQUIRED');
    const currentRules = await readProjectRules(
      identity,
      props.projectId,
      props.workspaceId,
    );
    if (!samePolicy(policy, policyFor(currentRules)))
      throw new Error('MATCHING_RULES_CHANGED');
  }

  async function startOrContinue() {
    const currentQueue = queueRef.current;
    const currentScope = scope;
    if (
      !currentQueue ||
      !currentScope ||
      runRef.current ||
      startingRef.current ||
      props.disabled
    )
      return;
    startingRef.current = true;
    setStarting(true);
    setNotice('');
    try {
      const freshIdentity = await getUploadIdentity();
      if (freshIdentity.actorId !== currentScope.actorId)
        throw new Error('UPLOAD_OWNER_CHANGED');
      const legacyItems = decodeResolvedUploadJournal(
        localStorage.getItem(resolvedUploadJournalKey(currentScope)),
        currentScope,
      );
      if (legacyItems.length > 0)
        throw new Error('請先回到單張上傳，接續原有工作記錄。');

      const recoveryOnly =
        capability.status !== 'ready' ||
        !capability.value.enabled ||
        props.modeActive === false;
      const actionable = await findActionable(null, recoveryOnly);
      if (!actionable) {
        setNotice('目前批次沒有可接續的上傳工作。');
        return;
      }
      if (actionable.kind === 'review') {
        setCurrentOrdinal(actionable.item.descriptor.ordinal);
        setNotice('前一筆仍需要人工檢查或確認拒絕結果。');
        return;
      }
      const item = actionable.item;
      const file = currentQueue.files.get(item.descriptor.id);
      if (!file) {
        await showOrdinal(item.descriptor.ordinal);
        setCurrentOrdinal(item.descriptor.ordinal);
        setNotice('請重新選取與批次清單完全相符的原始照片。');
        return;
      }

      if (item.state === 'queued') {
        if (props.modeActive === false)
          throw new Error('目前專案模式不接受新的批次上傳。');
        const batchCapabilities = await readCapabilities(freshIdentity.actorId);
        if (!batchCapabilities.enabled)
          throw new Error('批次上傳功能目前已停用。');
        await assertCurrentPolicy(currentQueue.manifest.policy);
      } else if (
        !(await readRecoveryCapabilities(
          freshIdentity.actorId,
          props.workspaceId,
        ))
      ) {
        throw new Error('目前無法接續已保存的上傳工作。工作記錄仍已保留。');
      }

      const controller = new AbortController();
      const nextRun = {
        epoch: ++epochRef.current,
        sessionId: freshIdentity.sessionId,
        ordinal: item.descriptor.ordinal,
        captured: item.state === 'captured',
        controller,
      };
      await showOrdinal(item.descriptor.ordinal);
      setCurrentOrdinal(item.descriptor.ordinal);
      setRun(nextRun);
    } catch (error) {
      if (
        isAccessDenied(error) ||
        (error instanceof Error && error.message === 'UPLOAD_OWNER_CHANGED')
      ) {
        hideBatchForAccessLoss();
        return;
      }
      flushBatchChanges();
      setNotice(batchErrorMessage(error, '無法安全接續批次工作。'));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }

  async function advanceAfter(item: ResolvedBatchItemEnvelope, epoch: number) {
    const activeRun = runRef.current;
    if (
      !activeRun ||
      activeRun.epoch !== epoch ||
      activeRun.controller.signal.aborted
    )
      return;
    try {
      const recoveryOnly =
        capability.status !== 'ready' ||
        !capability.value.enabled ||
        props.modeActive === false;
      const actionable = await findActionable(
        item.descriptor.ordinal,
        recoveryOnly,
      );
      if (
        runRef.current?.epoch !== epoch ||
        runRef.current.controller.signal.aborted
      )
        return;
      if (!actionable) {
        runRef.current.controller.abort();
        setRun(null);
        setCurrentOrdinal(null);
        flushBatchChanges();
        setNotice('批次已處理完畢，所有工作記錄仍保留在本機。');
        return;
      }
      if (actionable.kind === 'review') {
        runRef.current.controller.abort();
        setRun(null);
        flushBatchChanges();
        await showOrdinal(actionable.item.descriptor.ordinal);
        setCurrentOrdinal(actionable.item.descriptor.ordinal);
        setNotice('批次已暫停。請檢查這筆結果，再明確選擇是否繼續。');
        return;
      }
      if (!queueRef.current?.files.has(actionable.item.descriptor.id)) {
        runRef.current.controller.abort();
        setRun(null);
        flushBatchChanges();
        await showOrdinal(actionable.item.descriptor.ordinal);
        setCurrentOrdinal(actionable.item.descriptor.ordinal);
        setNotice('請重新選取下一筆原始照片後，再明確接續批次。');
        return;
      }
      if (actionable.item.state === 'queued') {
        const freshCapabilities = await readCapabilities(
          identity?.actorId ?? props.actorId,
        );
        if (!freshCapabilities.enabled || props.modeActive === false)
          throw new Error('批次功能或目前專案模式已停用；未建立下一筆工作。');
        await assertCurrentPolicy(queueRef.current.manifest.policy);
      }
      await showOrdinal(actionable.item.descriptor.ordinal);
      setCurrentOrdinal(actionable.item.descriptor.ordinal);
      setRun({
        ...runRef.current,
        ordinal: actionable.item.descriptor.ordinal,
        captured: actionable.item.state === 'captured',
      });
    } catch (error) {
      if (
        isAccessDenied(error) ||
        (error instanceof Error && error.message === 'UPLOAD_OWNER_CHANGED')
      ) {
        hideBatchForAccessLoss();
        return;
      }
      runRef.current?.controller.abort();
      setRun(null);
      flushBatchChanges();
      setNotice(batchErrorMessage(error, '批次已暫停，原工作記錄已保留。'));
    }
  }

  useLayoutEffect(() => {
    advanceAfterRef.current = advanceAfter;
  });

  useEffect(() => {
    if (!commitEvent || processedCommitEventRef.current === commitEvent) return;
    processedCommitEventRef.current = commitEvent;
    queueMicrotask(() => {
      if (commitEvent.kind === 'advance') {
        void advanceAfterRef.current(commitEvent.item, commitEvent.epoch);
        return;
      }
      const currentRun = runRef.current;
      if (currentRun?.epoch !== commitEvent.epoch) return;
      currentRun.controller.abort();
      setRun(null);
      setCurrentOrdinal(commitEvent.item.descriptor.ordinal);
      flushBatchChanges();
      setNotice(
        commitEvent.item.state === 'needs_review'
          ? '批次已暫停。這筆工作需要人工檢查，原請求仍已保留。'
          : '批次已暫停。伺服器明確拒絕原請求，記錄仍已保留。',
      );
    });
  }, [commitEvent, flushBatchChanges]);

  const queueId = queue?.manifest.queueId ?? null;
  const targetOrdinal = displayRun?.ordinal ?? null;
  const targetEpoch = displayRun?.epoch ?? null;
  const targetSessionId = displayRun?.sessionId ?? null;
  const targetSignal = displayRun?.controller.signal ?? null;
  const targetDescriptor =
    queue && targetOrdinal !== null
      ? queue.manifest.descriptors[targetOrdinal]
      : null;
  const targetItemId = targetDescriptor?.id ?? null;
  const expectedMode = queue?.manifest.policy.expectedMode ?? null;
  const expectedProjectRevision =
    queue?.manifest.policy.projectRevision ?? null;
  const matchingProfile =
    queue?.manifest.policy.matchingProfile?.profile ?? null;
  const matchingRuleRevision =
    queue?.manifest.policy.matchingProfile?.ruleRevision ?? null;

  const journalPort = useMemo<ResolvedUploadJournalPort | undefined>(() => {
    const currentScope = scope;
    if (
      !currentScope ||
      !queueId ||
      targetOrdinal === null ||
      targetEpoch === null ||
      targetSessionId === null ||
      !targetSignal ||
      !targetItemId ||
      expectedMode === null ||
      expectedProjectRevision === null
    )
      return undefined;

    const cache: {
      item: ResolvedBatchItemEnvelope | null;
      manifestRevision: number;
      loaded: boolean;
    } = { item: null, manifestRevision: 0, loaded: false };
    const loadCurrent = async (requestedScope: ResolvedBatchJournalScope) => {
      if (
        requestedScope.actorId !== currentScope.actorId ||
        requestedScope.workspaceId !== currentScope.workspaceId ||
        requestedScope.projectId !== currentScope.projectId ||
        requestedScope.albumId !== currentScope.albumId
      )
        throw new Error('RESOLVED_BATCH_SCOPE_CHANGED');
      const page = await store.listItems(
        currentScope,
        queueId,
        targetOrdinal === 0 ? null : targetOrdinal - 1,
        1,
      );
      const item = page.items[0];
      if (!item || item.descriptor.ordinal !== targetOrdinal)
        throw new Error('RESOLVED_BATCH_ITEM_MISSING');
      cache.manifestRevision = page.manifestRevision;
      cache.item = item;
      cache.loaded = true;
      return item;
    };

    return {
      itemId: targetItemId,
      approvedSessionId: targetSessionId,
      signal: targetSignal,
      onAccessLost: requestAccessLost,
      load: async (requestedScope) => {
        const item = await loadCurrent(requestedScope);
        return item.intent ? [item.intent] : [];
      },
      save: async (requestedScope, nextItems) => {
        if (!cache.loaded || !cache.item) await loadCurrent(requestedScope);
        const previous = cache.item;
        if (!previous) throw new Error('RESOLVED_BATCH_ITEM_MISSING');
        const now = Math.max(wallClockNow(), previous.savedAt);
        let next: ResolvedBatchItemEnvelope;
        if (nextItems.length === 1) {
          const intent = nextItems[0];
          if (!intent || intent.id !== targetItemId)
            throw new Error('RESOLVED_BATCH_INTENT_INVALID');
          if (previous.state === 'queued') {
            const body = intent.reservationBody;
            if (
              body.expectedMode !== expectedMode ||
              body.expectedProjectRevision !== expectedProjectRevision ||
              body.matchingProfile?.profile !== matchingProfile ||
              body.matchingProfile?.ruleRevision !== matchingRuleRevision
            )
              throw new Error('MATCHING_RULES_CHANGED');
            next = {
              ...previous,
              revision: previous.revision + 1,
              savedAt: now,
              state: 'captured',
              intent,
            };
          } else if (previous.state === 'captured' && previous.intent) {
            next = {
              ...previous,
              revision: previous.revision + 1,
              savedAt: now,
              state: intent.needsReview ? 'needs_review' : 'captured',
              intent,
            };
          } else {
            throw new Error('RESOLVED_BATCH_ITEM_TERMINAL');
          }
        } else if (nextItems.length === 0) {
          if (previous.state !== 'captured' || !previous.intent)
            throw new Error('RESOLVED_BATCH_ITEM_TERMINAL');
          if (previous.intent.needsReview)
            throw new Error('RESOLVED_BATCH_ITEM_REQUIRES_REVIEW');
          next = {
            ...previous,
            revision: previous.revision + 1,
            savedAt: now,
            state: previous.intent.reservation ? 'completed' : 'rejected',
          };
        } else {
          throw new Error('RESOLVED_BATCH_INTENT_INVALID');
        }

        const result = await store.updateItem(
          cache.manifestRevision,
          previous.revision,
          next,
        );
        cache.item = result.item;
        cache.manifestRevision = result.manifest.revision;
        setQueue((current) =>
          current
            ? {
                ...current,
                manifest: result.manifest,
                page: {
                  ...current.page,
                  manifestRevision: result.manifest.revision,
                  items: current.page.items.map((candidate) =>
                    candidate.descriptor.id === result.item.descriptor.id
                      ? result.item
                      : candidate,
                  ),
                },
              }
            : current,
        );
        if (
          result.item.state === 'completed' ||
          result.item.state === 'needs_review' ||
          result.item.state === 'rejected'
        )
          setCommitEvent({
            kind: result.item.state === 'completed' ? 'advance' : 'pause',
            item: result.item,
            epoch: targetEpoch,
          });
      },
    };
  }, [
    queueId,
    targetOrdinal,
    targetEpoch,
    targetSessionId,
    targetSignal,
    targetItemId,
    expectedMode,
    expectedProjectRevision,
    matchingProfile,
    matchingRuleRevision,
    requestAccessLost,
    scope,
    store,
  ]);

  async function createBatch() {
    const currentScope = scope;
    if (
      !currentScope ||
      !identity ||
      capability.status !== 'ready' ||
      !capability.value.enabled ||
      props.modeActive === false ||
      stagedFiles.length === 0 ||
      props.disabled
    )
      return;
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setNotice('');
    try {
      if (legacyState !== 'empty')
        throw new Error('請先使用單張上傳接續或確認原有工作記錄。');
      if (stagedFiles.length > capability.value.maxFiles)
        throw new Error('一次最多可選取 1,000 張照片。');
      const freshIdentity = await getUploadIdentity();
      if (freshIdentity.actorId !== currentScope.actorId)
        throw new Error('UPLOAD_OWNER_CHANGED');
      const freshCapabilities = await readCapabilities(freshIdentity.actorId);
      if (!freshCapabilities.enabled)
        throw new Error('批次上傳功能目前已停用。');
      const rules = await readProjectRules(
        freshIdentity,
        props.projectId,
        props.workspaceId,
      );
      const policy = policyFor(rules);

      const queueId = crypto.randomUUID();
      const createdAt = wallClockNow();
      const descriptors = stagedFiles.map((file, ordinal) => {
        const contentType = contentTypeFor(file);
        if (!contentType) throw new Error('檔案格式必須是 JPEG、PNG 或 WebP。');
        return resolvedBatchDescriptorForFile({
          id: crypto.randomUUID(),
          ordinal,
          file,
          contentType,
        });
      });
      const manifest: ResolvedBatchManifest = {
        version: 1,
        scope: currentScope,
        queueId,
        capturedSessionId: freshIdentity.sessionId,
        policy,
        revision: 0,
        createdAt,
        savedAt: createdAt,
        descriptors,
      };
      const items: ResolvedBatchItemEnvelope[] = descriptors.map(
        (descriptor) => ({
          version: 1,
          scope: currentScope,
          queueId,
          capturedSessionId: freshIdentity.sessionId,
          policy,
          descriptor,
          revision: 0,
          state: 'queued',
          intent: null,
          createdAt,
          savedAt: createdAt,
        }),
      );

      const key = batchPointerKey(currentScope);
      if (!navigator.locks) throw new Error('此瀏覽器不支援安全的批次工作鎖。');
      const created = await navigator.locks.request(
        resolvedUploadJournalKey(currentScope),
        { ifAvailable: true },
        async (lock) => {
          if (!lock) throw new Error('另一個分頁正在處理這個相簿的上傳工作。');
          const expectedPointer = queueRef.current?.manifest.queueId ?? null;
          const previousPointer = localStorage.getItem(key);
          if (previousPointer !== expectedPointer)
            throw new Error('批次記錄已在另一個分頁更新。請重新載入。');
          const existingSingle = decodeResolvedUploadJournal(
            localStorage.getItem(resolvedUploadJournalKey(currentScope)),
            currentScope,
          );
          if (existingSingle.length > 0)
            throw new Error('請先回到單張上傳，接續原有工作記錄。');

          const oldQueue = queueRef.current;
          let retainedReview = false;
          if (oldQueue) {
            let afterOrdinal: number | null = null;
            while (true) {
              const oldPage = await store.listItems(
                currentScope,
                oldQueue.manifest.queueId,
                afterOrdinal,
                24,
              );
              if (
                oldPage.items.some((item) =>
                  ['queued', 'captured'].includes(item.state),
                )
              )
                throw new Error('請先處理目前批次中尚未完成的工作。');
              if (oldPage.items.some((item) => item.state === 'needs_review'))
                retainedReview = true;
              if (oldPage.nextAfterOrdinal === null) break;
              afterOrdinal = oldPage.nextAfterOrdinal;
            }
          }

          localStorage.setItem(key, queueId);
          try {
            await store.createQueue(manifest, items);
          } catch (error) {
            const currentPointer = localStorage.getItem(key);
            const committed = await store
              .readManifest(currentScope, queueId)
              .catch(() => undefined);
            if (currentPointer === queueId && committed === null) {
              if (previousPointer === null) localStorage.removeItem(key);
              else localStorage.setItem(key, previousPointer);
            }
            throw error;
          }
          const page = await store.listItems(currentScope, queueId, null, 24);
          return { page, retainedReview };
        },
      );
      const page = created.page;
      setQueue({
        manifest,
        page,
        pageStarts: [null],
        files: new Map<string, File>(
          descriptors.map(
            (item, index) => [item.id, stagedFiles[index]!] as const,
          ),
        ),
      });
      setHasPointer(true);
      setCurrentOrdinal(descriptors[0]?.ordinal ?? null);
      setAcknowledgedThrough(-1);
      setStagedFiles([]);
      setView('batch');
      setRecoveryAvailable(true);
      setNotice(
        created.retainedReview
          ? '上一批次仍有需要人工檢查的記錄，已保留在本機；請到相簿工作區檢查該項目。'
          : '',
      );
    } catch (error) {
      try {
        if (localStorage.getItem(batchPointerKey(currentScope)) !== null)
          setHasPointer(true);
      } catch {
        // Keep the original failure message if local storage is unavailable.
      }
      if (
        isAccessDenied(error) ||
        (error instanceof Error && error.message === 'UPLOAD_OWNER_CHANGED')
      ) {
        hideBatchForAccessLoss();
        return;
      }
      setNotice(batchErrorMessage(error, '無法建立批次工作。'));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    setNotice('');
    if (selected.length === 0) return;
    if (selected.length > 1000) {
      setNotice('一次最多可選取 1,000 張照片。');
      return;
    }
    setStagedFiles(selected);
  }

  function reselectFiles(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    const currentQueue = queueRef.current;
    if (!currentQueue) return;
    const remaining = [...selected];
    const files = new Map<string, File>();
    if (remaining.length !== currentQueue.manifest.descriptors.length) {
      setNotice('請一次重新選取批次清單中的全部原始照片。');
      return;
    }
    for (const descriptor of currentQueue.manifest.descriptors) {
      const index = remaining.findIndex(
        (file) =>
          file.name === descriptor.originalFilename &&
          file.size === descriptor.expectedBytes &&
          file.lastModified === descriptor.lastModified &&
          contentTypeFor(file) === descriptor.contentType,
      );
      if (index < 0) {
        setNotice('所選原檔與保存的批次資料不完全相符。沒有建立上傳。');
        return;
      }
      files.set(descriptor.id, remaining[index]!);
      remaining.splice(index, 1);
    }
    replacePageState((current) => ({ ...current, files }));
    setNotice('已逐一比對批次原檔。尚未送出上傳工作。');
  }

  async function skipQueued(item: ResolvedBatchItemEnvelope) {
    const currentQueue = queueRef.current;
    if (
      !currentQueue ||
      runRef.current ||
      startingRef.current ||
      item.state !== 'queued'
    )
      return;
    if (skipConfirmId !== item.descriptor.id) {
      setSkipConfirmId(item.descriptor.id);
      return;
    }
    try {
      const next: ResolvedBatchItemEnvelope = {
        ...item,
        revision: item.revision + 1,
        savedAt: Math.max(wallClockNow(), item.savedAt),
        state: 'cancelled',
      };
      const result = await store.updateItem(
        currentQueue.page.manifestRevision,
        item.revision,
        next,
      );
      replacePageState((current) => ({
        ...current,
        manifest: result.manifest,
        page: {
          ...current.page,
          manifestRevision: result.manifest.revision,
          items: current.page.items.map((candidate) =>
            candidate.descriptor.id === item.descriptor.id
              ? result.item
              : candidate,
          ),
        },
      }));
      if (currentOrdinal === item.descriptor.ordinal) setCurrentOrdinal(null);
      setSkipConfirmId(null);
      setNotice('已略過這筆尚未建立請求的項目。');
    } catch {
      setNotice('無法保存略過狀態。項目仍保留在批次中。');
    }
  }

  async function continueAfterReview(item: ResolvedBatchItemEnvelope) {
    setAcknowledgedThrough(item.descriptor.ordinal);
    const next = await findActionable(item.descriptor.ordinal);
    if (next?.kind === 'item') setCurrentOrdinal(next.item.descriptor.ordinal);
    else if (next?.kind === 'review')
      setCurrentOrdinal(next.item.descriptor.ordinal);
    else setCurrentOrdinal(null);
    setNotice('原記錄已保留。請再明確按下接續按鈕。');
  }

  async function pauseRun() {
    const active = runRef.current;
    if (!active) return;
    active.controller.abort();
    setRun(null);
    flushBatchChanges();
    setNotice('批次已暫停。任何已保存請求仍保留供原請求接續。');
  }

  const currentForChild =
    queue && displayRun
      ? (queue.manifest.descriptors[displayRun.ordinal] ?? null)
      : null;
  const fileForChild =
    currentForChild && queue
      ? (queue.files.get(currentForChild.id) ?? null)
      : null;

  const canCreate =
    capability.status === 'ready' &&
    capability.value.enabled &&
    props.modeActive !== false &&
    !props.disabled &&
    !creating &&
    legacyState === 'empty' &&
    stagedFiles.length > 0;

  const noticeView = notice ? (
    <p role="status" className="mt-3 break-words text-sm text-amber-900">
      {notice}
    </p>
  ) : null;

  if (accessLostRequested)
    return (
      <p
        role="status"
        className="rounded-md border border-amber-300 p-3 text-sm text-amber-950"
      >
        登入身分已變更，批次已暫停並隱藏檔名。工作記錄仍保存在本機；重新確認身分後再載入。
      </p>
    );

  if (!hasPointer && props.modeActive === false)
    return <ResolvedAlbumUpload {...props} />;

  if (!hasPointer && capability.status === 'loading')
    return (
      <p
        role="status"
        className="rounded-md border border-stone-200 p-3 text-sm text-stone-600"
      >
        正在確認批次上傳設定…
      </p>
    );

  if (
    !hasPointer &&
    (capability.status === 'disabled' || capability.status === 'unavailable')
  )
    return <ResolvedAlbumUpload {...props} />;

  if (!hasPointer && queue === null && capability.status === 'ready') {
    return (
      <section
        data-testid="resolved-batch-upload"
        className="min-w-0 rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
      >
        <div
          className="mb-4 flex flex-wrap gap-2"
          role="tablist"
          aria-label="上傳方式"
        >
          <button
            type="button"
            data-testid="resolved-batch-single-mode"
            role="tab"
            aria-selected={view === 'single'}
            onClick={() => setView('single')}
            className="min-h-10 rounded-md border px-3 py-2 text-sm"
          >
            切換至單張上傳
          </button>
          <button
            type="button"
            data-testid="resolved-batch-mode"
            role="tab"
            aria-selected={view === 'batch'}
            disabled={!capability.value.enabled || props.modeActive === false}
            onClick={() => setView('batch')}
            className="min-h-10 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          >
            批次上傳
          </button>
        </div>
        {view === 'single' ? (
          <ResolvedAlbumUpload {...props} />
        ) : (
          <div>
            {noticeView}
            <h2 className="text-lg font-semibold text-stone-950">
              建立批次工作
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              先保存清單，按下開始後才會上傳。離開此頁後，繼續時需重新選取原始照片。
            </p>
            <label
              className="mt-4 block text-sm font-medium"
              htmlFor="resolved-batch-files"
            >
              批次選擇照片（最多 1,000 張）
            </label>
            <input
              id="resolved-batch-files"
              data-testid="resolved-batch-files"
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={!capability.value.enabled || props.disabled || creating}
              onChange={selectFiles}
              className="mt-1 block min-h-11 w-full rounded-md border border-stone-300 p-2 text-sm"
            />
            <p className="mt-2 text-sm text-stone-600">
              已選取 {stagedFiles.length} 張。建立工作後仍須明確按下開始。
            </p>
            <button
              type="button"
              data-testid="resolved-batch-create"
              disabled={!canCreate}
              onClick={() => void createBatch()}
              className="mt-3 min-h-11 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              保存批次清單
            </button>
            {legacyState !== 'empty' && (
              <p role="alert" className="mt-3 text-sm text-amber-900">
                請先回到單張上傳處理既有工作記錄。批次功能不會覆蓋單張記錄。
              </p>
            )}
          </div>
        )}
      </section>
    );
  }

  const visibleItems = queue?.page.items ?? [];
  const hasLegacyRecovery = legacyState !== 'empty';
  const recoveryOnly =
    capability.status !== 'ready' ||
    !capability.value.enabled ||
    props.modeActive === false;
  const hasVisibleCaptured = visibleItems.some(
    (item) => item.state === 'captured',
  );

  return (
    <section
      data-testid="resolved-batch-upload"
      className="min-w-0 rounded-lg border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-stone-950">批次上傳工作</h2>
          {queue && (
            <p className="mt-1 break-words text-sm text-stone-600">
              {queue.manifest.descriptors.length} 張 · 固定設定：
              {policySummary(queue.manifest.policy)}
            </p>
          )}
        </div>
        {hasLegacyRecovery && (
          <button
            type="button"
            data-testid="resolved-batch-return-single"
            onClick={() => setView('single')}
            className="min-h-10 rounded-md border border-stone-400 px-3 py-2 text-sm"
          >
            返回單張工作恢復
          </button>
        )}
      </div>

      {view === 'single' && hasLegacyRecovery ? (
        <div className="mt-4">
          <ResolvedAlbumUpload {...props} modeActive={false} />
          <button
            type="button"
            onClick={() => setView('batch')}
            className="mt-3 min-h-10 rounded-md border px-3 py-2 text-sm"
          >
            返回批次記錄
          </button>
        </div>
      ) : (
        <>
          {noticeView}
          {restoreError && (
            <p role="alert" className="mt-3 break-words text-sm text-rose-900">
              {restoreError}
            </p>
          )}
          {capability.status === 'disabled' && (
            <p role="status" className="mt-3 text-sm text-amber-900">
              批次功能目前已停用。保存的工作仍保留；只允許接續已固定的原請求。
            </p>
          )}
          {capability.status === 'unavailable' && (
            <p role="alert" className="mt-3 text-sm text-amber-900">
              批次設定目前無法驗證。保存的工作仍保留，暫停所有新工作。
            </p>
          )}
          {legacyState !== 'empty' && (
            <p role="alert" className="mt-3 break-words text-sm text-amber-900">
              單張上傳仍有既有工作記錄。請先使用「返回單張工作恢復」接續；不會覆蓋該記錄。
            </p>
          )}
          {restoreError && !queue ? null : queue ? (
            <>
              {!queue.files.size && (
                <div className="mt-4">
                  <label
                    className="block text-sm font-medium"
                    htmlFor="resolved-batch-reselect"
                  >
                    重新選擇批次原始照片
                  </label>
                  <input
                    id="resolved-batch-reselect"
                    data-testid="resolved-batch-reselect"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    onChange={reselectFiles}
                    className="mt-1 block min-h-11 w-full rounded-md border border-stone-300 p-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-stone-600">
                    比對檔名、大小、格式及修改時間；接續時仍會驗證內容。
                  </p>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {displayRun ? (
                  <button
                    type="button"
                    data-testid="resolved-batch-pause"
                    onClick={() => void pauseRun()}
                    className="min-h-11 rounded-md border border-amber-700 px-4 py-2 text-sm font-medium text-amber-950"
                  >
                    暫停批次上傳
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="resolved-batch-start"
                    disabled={
                      props.disabled ||
                      starting ||
                      legacyState !== 'empty' ||
                      restoreError !== '' ||
                      (capability.status === 'unavailable' &&
                        (!recoveryAvailable || !hasVisibleCaptured)) ||
                      (recoveryOnly &&
                        (!recoveryAvailable || !hasVisibleCaptured))
                    }
                    onClick={() => void startOrContinue()}
                    className="min-h-11 rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {capability.status === 'disabled' ||
                    props.modeActive === false
                      ? '繼續批次上傳'
                      : currentOrdinal !== null &&
                          queue.page.items.some(
                            (item) =>
                              item.descriptor.ordinal === currentOrdinal &&
                              item.state === 'captured',
                          )
                        ? '繼續批次上傳'
                        : '開始批次上傳（依目前專案規則）'}
                  </button>
                )}
                {queue.page.nextAfterOrdinal !== null && (
                  <button
                    type="button"
                    data-testid="resolved-batch-next"
                    disabled={displayRun !== null || starting}
                    onClick={() =>
                      void fetchPage(queue.page.nextAfterOrdinal, [
                        ...queue.pageStarts,
                        queue.page.nextAfterOrdinal,
                      ])
                    }
                    className="min-h-11 rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                  >
                    下一頁
                  </button>
                )}
                {queue.pageStarts.length > 1 && (
                  <button
                    type="button"
                    data-testid="resolved-batch-previous"
                    disabled={displayRun !== null || starting}
                    onClick={() => {
                      const previousStarts = queue.pageStarts.slice(0, -1);
                      void fetchPage(
                        previousStarts[previousStarts.length - 1] ?? null,
                        previousStarts,
                      );
                    }}
                    className="min-h-11 rounded-md border px-4 py-2 text-sm disabled:opacity-50"
                  >
                    上一頁
                  </button>
                )}
              </div>

              <p className="mt-2 text-xs text-stone-600">
                第 {pageNumber(queue.pageStarts)} 頁 · 每頁最多 24 筆
              </p>

              {visibleItems.length > 0 ? (
                <ul className="mt-3 divide-y divide-stone-200 rounded-md border border-stone-200">
                  {visibleItems.map((item) => (
                    <li
                      key={item.descriptor.id}
                      data-testid="resolved-batch-item"
                      className="flex min-w-0 flex-wrap items-start justify-between gap-2 p-3"
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium text-stone-950">
                          {item.descriptor.ordinal + 1}.{' '}
                          {item.descriptor.originalFilename}
                        </p>
                        <p className="mt-1 text-xs text-stone-600">
                          {itemStatus(item)} ·{' '}
                          {item.descriptor.expectedBytes.toLocaleString()} bytes
                        </p>
                      </div>
                      {item.state === 'queued' && !displayRun && (
                        <button
                          type="button"
                          data-testid="resolved-batch-skip"
                          onClick={() => void skipQueued(item)}
                          className="min-h-9 rounded-md border border-stone-400 px-3 py-1 text-xs"
                        >
                          {skipConfirmId === item.descriptor.id
                            ? '再按一次確認略過'
                            : '略過尚未建立的項目'}
                        </button>
                      )}
                      {(item.state === 'needs_review' ||
                        item.state === 'rejected') &&
                        item.descriptor.ordinal === currentOrdinal &&
                        !displayRun && (
                          <button
                            type="button"
                            data-testid="resolved-batch-acknowledge"
                            onClick={() => void continueAfterReview(item)}
                            className="min-h-9 rounded-md border border-amber-700 px-3 py-1 text-xs"
                          >
                            保留此記錄並檢查下一筆
                          </button>
                        )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-stone-600">
                  目前頁面沒有項目。
                </p>
              )}

              {displayRun && currentForChild && fileForChild && journalPort && (
                <div
                  className="mt-4"
                  data-testid="resolved-batch-active-upload"
                >
                  <p className="mb-2 text-sm font-medium text-stone-800">
                    正在處理第 {displayRun.ordinal + 1} 張：
                    {currentForChild.originalFilename}
                  </p>
                  <ResolvedAlbumUpload
                    key={
                      queue.manifest.queueId +
                      ':' +
                      currentForChild.id +
                      ':' +
                      displayRun.epoch
                    }
                    {...props}
                    journalPort={journalPort}
                    queueFile={fileForChild}
                    autoRun
                    onChanged={markBatchChanged}
                    modeActive={
                      displayRun.captured ? true : (props.modeActive ?? true)
                    }
                  />
                </div>
              )}
            </>
          ) : (
            <p role="alert" className="mt-3 text-sm text-rose-900">
              批次指標存在，但工作記錄無法驗證。資料未刪除，也不會建立新工作。
            </p>
          )}
        </>
      )}
    </section>
  );
}

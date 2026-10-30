'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { z } from 'zod';
import {
  getMatchingProfile,
  matchingProfileForRules,
  type MatchingProfileId,
  type MatchingProfileRules,
} from '../../../packages/domain/src/matching-profiles';
import {
  matchingRulesCapabilitiesSchema,
  projectMatchingRulesReadSchema,
  setProjectMatchingRulesResultSchema,
  setProjectMatchingRulesSchema,
  type ProjectMatchingRulesRead,
  type SetProjectMatchingRules,
} from '../../../packages/contracts/src/matching-rules';

type OwnerIdentity = Readonly<{ actorId: string; sessionId: string }>;
type CapabilityState =
  | { projectId: string; sequence: number; status: 'loading' | 'disabled' }
  | { projectId: string; sequence: number; status: 'enabled' }
  | {
      projectId: string;
      sequence: number;
      status: 'error';
      message: string;
    };
type ReadState =
  | {
      projectId: string;
      identityKey: string;
      status: 'loading';
    }
  | {
      projectId: string;
      identityKey: string;
      status: 'ready';
      value: ProjectMatchingRulesRead;
    }
  | {
      projectId: string;
      identityKey: string;
      status: 'error';
      message: string;
    };
type OwnerState =
  | { status: 'loading' }
  | { status: 'ready'; value: OwnerIdentity }
  | { status: 'error'; message: string };
type Draft = {
  identityKey: string;
  projectId: string;
  profile: MatchingProfileId;
};
type PendingIntent = Readonly<{
  actorId: string;
  workspaceId: string;
  projectId: string;
  storageKey: string;
  body: SetProjectMatchingRules;
  bodyJson: string;
  phase: 'unknown' | 'conflict';
}>;
type StoredIntentEnvelope = Readonly<{
  version: 1;
  actorId: string;
  workspaceId: string;
  projectId: string;
  phase: 'unknown' | 'conflict';
  bodyJson: string;
}>;
type StorageRead =
  | { status: 'none' }
  | { status: 'valid'; intent: PendingIntent }
  | { status: 'invalid' }
  | { status: 'unavailable' };

// Better Auth returns additional user/session metadata. Extract identity only;
// never reject its legitimate fields or retain them in recovery metadata.
const ownerSessionSchema = z.object({
  user: z.object({ id: z.uuid() }),
  session: z.object({ id: z.string().min(1).max(512) }),
});
const storedIntentEnvelopeSchema = z
  .object({
    version: z.literal(1),
    actorId: z.uuid(),
    workspaceId: z.uuid(),
    projectId: z.uuid(),
    phase: z.enum(['unknown', 'conflict']),
    bodyJson: z.string().min(1).max(2048),
  })
  .strict();

class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super('Project matching rules request failed');
  }
}

class IdentityChangedError extends Error {
  constructor(readonly current: OwnerIdentity | null) {
    super('Owner identity changed during project matching rules request');
  }
}

function identityKey(identity: OwnerIdentity) {
  return identity.actorId + ':' + identity.sessionId;
}

function sameIdentity(left: OwnerIdentity, right: OwnerIdentity) {
  return left.actorId === right.actorId && left.sessionId === right.sessionId;
}

function errorCode(value: unknown): string {
  if (typeof value !== 'object' || value === null || !('error' in value))
    return '';
  const error = value.error;
  if (typeof error !== 'object' || error === null || !('code' in error))
    return '';
  return typeof error.code === 'string' ? error.code : '';
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.code === 'MATCHING_RULES_REVISION_CONFLICT')
      return '專案比對規則已由其他管理者更新，正在重新取得目前設定。請重新檢查後再確認。';
    if (error.code.includes('OWNER') || error.status === 401)
      return '登入狀態或管理權限需要重新確認。未確認的操作仍保留原內容。';
    if (error.code === 'DISABLED')
      return '專案比對規則目前未開放。尚未確認的操作仍保留原內容。';
    if (error.code === 'RESOURCE_NOT_EDITABLE')
      return '目前專案狀態不允許修改比對規則。原操作內容仍保留。';
    if (error.status === 404) return '目前無法查看這個專案的比對規則。';
    if (error.status === 503)
      return '專案比對規則目前暫時無法連線，請稍後重試原操作。';
  }
  return '目前無法確認專案比對規則。未確認的操作仍保留原內容。';
}

function intentStorageKey(
  actorId: string,
  workspaceId: string,
  projectId: string,
) {
  return [
    'kino-pic',
    'matching-rules-intent',
    'v1',
    actorId,
    workspaceId,
    projectId,
  ].join(':');
}

function intentEnvelope(intent: PendingIntent): StoredIntentEnvelope {
  return {
    version: 1,
    actorId: intent.actorId,
    workspaceId: intent.workspaceId,
    projectId: intent.projectId,
    phase: intent.phase,
    bodyJson: intent.bodyJson,
  };
}

function encodeStoredIntent(intent: PendingIntent) {
  return JSON.stringify(intentEnvelope(intent));
}

function readStoredIntent(
  storageKey: string,
  actorId: string,
  workspaceId: string,
  projectId: string,
): StorageRead {
  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored === null) return { status: 'none' };

    let decodedEnvelope: unknown;
    try {
      decodedEnvelope = JSON.parse(stored) as unknown;
    } catch {
      return { status: 'invalid' };
    }
    const envelope = storedIntentEnvelopeSchema.safeParse(decodedEnvelope);
    if (
      !envelope.success ||
      envelope.data.actorId !== actorId ||
      envelope.data.workspaceId !== workspaceId ||
      envelope.data.projectId !== projectId ||
      intentStorageKey(
        envelope.data.actorId,
        envelope.data.workspaceId,
        envelope.data.projectId,
      ) !== storageKey
    )
      return { status: 'invalid' };

    let decodedBody: unknown;
    try {
      decodedBody = JSON.parse(envelope.data.bodyJson) as unknown;
    } catch {
      return { status: 'invalid' };
    }
    const body = setProjectMatchingRulesSchema.safeParse(decodedBody);
    if (!body.success || JSON.stringify(body.data) !== envelope.data.bodyJson)
      return { status: 'invalid' };

    return {
      status: 'valid',
      intent: {
        actorId,
        workspaceId,
        projectId,
        storageKey,
        body: body.data,
        bodyJson: envelope.data.bodyJson,
        phase: envelope.data.phase,
      },
    };
  } catch {
    return { status: 'unavailable' };
  }
}

function sameIntent(left: PendingIntent, right: PendingIntent) {
  return (
    left.actorId === right.actorId &&
    left.workspaceId === right.workspaceId &&
    left.projectId === right.projectId &&
    left.storageKey === right.storageKey &&
    left.bodyJson === right.bodyJson
  );
}

function storeIntent(intent: PendingIntent) {
  sessionStorage.setItem(intent.storageKey, encodeStoredIntent(intent));
}

function removeStoredIntent(intent: PendingIntent): boolean {
  try {
    const current = readStoredIntent(
      intent.storageKey,
      intent.actorId,
      intent.workspaceId,
      intent.projectId,
    );
    if (current.status === 'none') return true;
    if (current.status !== 'valid' || !sameIntent(current.intent, intent))
      return false;
    sessionStorage.removeItem(intent.storageKey);
    return true;
  } catch {
    return false;
  }
}

async function readOwnerIdentity(signal?: AbortSignal): Promise<OwnerIdentity> {
  const response = await fetch('/api/auth/get-session', {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiFailure(response.status, errorCode(body));
  const parsed = ownerSessionSchema.safeParse(body);
  if (!parsed.success) throw new ApiFailure(401, 'OWNER_REQUIRED');
  return {
    actorId: parsed.data.user.id,
    sessionId: parsed.data.session.id,
  };
}

async function requestWithOwner(
  expectedIdentity: OwnerIdentity,
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<{ response: Response; body: unknown }> {
  const before = await readOwnerIdentity(init.signal ?? undefined);
  if (!sameIdentity(before, expectedIdentity))
    throw new IdentityChangedError(before);

  let response: Response | null = null;
  let body: unknown = null;
  let requestError: unknown = null;
  try {
    response = await fetch(input, init);
    body = await response.json().catch(() => null);
  } catch (error) {
    requestError = error;
  }

  let after: OwnerIdentity;
  try {
    after = await readOwnerIdentity(init.signal ?? undefined);
  } catch {
    throw new IdentityChangedError(null);
  }
  if (!sameIdentity(before, after) || !sameIdentity(expectedIdentity, after))
    throw new IdentityChangedError(after);
  if (requestError) throw requestError;
  if (!response) throw new ApiFailure(0, 'REQUEST_FAILED');
  return { response, body };
}

function rulesPath(projectId: string) {
  return (
    '/api/v1/projects/' + encodeURIComponent(projectId) + '/matching-rules'
  );
}

async function readProjectRules(
  projectId: string,
  expectedIdentity: OwnerIdentity,
  expectedWorkspaceId?: string,
  signal?: AbortSignal,
): Promise<ProjectMatchingRulesRead> {
  const { response, body } = await requestWithOwner(
    expectedIdentity,
    rulesPath(projectId),
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) throw new ApiFailure(response.status, errorCode(body));
  const parsed = projectMatchingRulesReadSchema.safeParse(body);
  if (!parsed.success || parsed.data.projectId !== projectId)
    throw new ApiFailure(200, 'INVALID_MATCHING_RULES_RESPONSE');
  if (
    expectedWorkspaceId !== undefined &&
    parsed.data.workspaceId !== expectedWorkspaceId
  )
    throw new ApiFailure(200, 'MATCHING_RULES_SCOPE_CHANGED');
  return parsed.data;
}

async function readCapabilities(
  expectedIdentity: OwnerIdentity,
  signal?: AbortSignal,
): Promise<boolean> {
  const { response, body } = await requestWithOwner(
    expectedIdentity,
    '/api/v1/matching-rules/capabilities',
    {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) throw new ApiFailure(response.status, errorCode(body));
  const parsed = matchingRulesCapabilitiesSchema.safeParse(body);
  if (!parsed.success)
    throw new ApiFailure(200, 'INVALID_MATCHING_RULES_CAPABILITY');
  return parsed.data.enabled;
}

function profileSummary(profileId: MatchingProfileId) {
  const profile = getMatchingProfile(profileId);
  if (!profile) return '目前設定無法驗證';
  const descriptions = [
    profile.rules.caseSensitive ? '區分大小寫' : '忽略大小寫',
    profile.rules.allowJpgJpegEquivalence
      ? 'JPG 與 JPEG 視為相同'
      : 'JPG 與 JPEG 分開比對',
    profile.rules.stripRecognizedSuffixes
      ? '忽略一個已知檔名後綴'
      : '保留檔名後綴',
  ];
  return descriptions.join('、');
}

export function ProjectMatchingRulesConfiguration({
  projectId,
  onChanged,
  disabled = false,
}: {
  projectId: string;
  onChanged: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const titleId = useId();
  const caseId = useId();
  const jpegId = useId();
  const suffixId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const [reloadSequence, setReloadSequence] = useState(0);
  const [owner, setOwner] = useState<OwnerState>({ status: 'loading' });
  const [capability, setCapability] = useState<CapabilityState | null>(null);
  const [read, setRead] = useState<ReadState | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [intent, setIntent] = useState<PendingIntent | null>(null);
  const [corruptStorageKey, setCorruptStorageKey] = useState('');
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [intentMessage, setIntentMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ownerRef = useRef<OwnerIdentity | null>(null);
  const intentRef = useRef<PendingIntent | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const identityCheckRef = useRef(false);
  const mutationControllerRef = useRef<AbortController | null>(null);
  const onChangedRef = useRef(onChanged);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDialogRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const rememberIntent = useCallback((next: PendingIntent | null) => {
    intentRef.current = next;
    setIntent(next);
    if (!next) setIntentMessage('');
  }, []);

  const restartForIdentity = useCallback(
    (next: OwnerIdentity | null, message: string) => {
      mutationControllerRef.current?.abort();
      mutationControllerRef.current = null;
      requestGenerationRef.current += 1;
      ownerRef.current = next;
      setOwner({ status: 'loading' });
      setCapability(null);
      setRead(null);
      setDraft(null);
      rememberIntent(null);
      setCorruptStorageKey('');
      setStorageUnavailable(false);
      setConfirmOpen(false);
      setActionError('');
      setNotice(message);
      setReloadSequence((value) => value + 1);
    },
    [rememberIntent],
  );

  const hideForIdentityFailure = useCallback(() => {
    mutationControllerRef.current?.abort();
    mutationControllerRef.current = null;
    requestGenerationRef.current += 1;
    ownerRef.current = null;
    setOwner({
      status: 'error',
      message: '登入狀態無法確認，專案比對設定已隱藏。',
    });
    setCapability({
      projectId,
      sequence: reloadSequence,
      status: 'error',
      message: '登入狀態無法確認，專案比對設定已隱藏。',
    });
    setRead(null);
    setDraft(null);
    rememberIntent(null);
    setCorruptStorageKey('');
    setStorageUnavailable(false);
    setConfirmOpen(false);
    setActionError('');
    setNotice('');
  }, [projectId, reloadSequence, rememberIntent]);

  const notifyChanged = useCallback(async () => {
    try {
      await onChangedRef.current();
    } catch {
      if (mountedRef.current)
        setNotice('設定已重新確認；預覽更新失敗，請重新檢查目標。');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const sequence = reloadSequence;
    const generation = ++requestGenerationRef.current;
    let active = true;
    const isActive = () =>
      active &&
      !controller.signal.aborted &&
      requestGenerationRef.current === generation;

    ownerRef.current = null;
    /* eslint-disable react-hooks/set-state-in-effect */
    setOwner({ status: 'loading' });
    setCapability({ projectId, sequence, status: 'loading' });
    setRead(null);
    setDraft(null);
    rememberIntent(null);
    setCorruptStorageKey('');
    setStorageUnavailable(false);
    setConfirmOpen(false);
    setActionError('');
    /* eslint-enable react-hooks/set-state-in-effect */

    async function load() {
      const identity = await readOwnerIdentity(controller.signal);
      if (!isActive()) return;
      ownerRef.current = identity;
      setOwner({ status: 'ready', value: identity });

      const enabled = await readCapabilities(identity, controller.signal);
      if (!isActive()) return;
      if (!enabled) {
        setCapability({ projectId, sequence, status: 'disabled' });
        return;
      }
      setCapability({ projectId, sequence, status: 'enabled' });

      const value = await readProjectRules(
        projectId,
        identity,
        undefined,
        controller.signal,
      );
      if (!isActive()) return;
      const scopeKey = identityKey(identity);
      setRead({ projectId, identityKey: scopeKey, status: 'ready', value });
      setDraft({ identityKey: scopeKey, projectId, profile: value.profile });

      const storageKey = intentStorageKey(
        identity.actorId,
        value.workspaceId,
        projectId,
      );
      const stored = readStoredIntent(
        storageKey,
        identity.actorId,
        value.workspaceId,
        projectId,
      );
      if (stored.status === 'invalid') {
        setCorruptStorageKey(storageKey);
        setActionError(
          '本機保存的設定操作無法驗證。請明確清除此記錄後再修改設定。',
        );
        return;
      }
      if (stored.status === 'unavailable') {
        setStorageUnavailable(true);
        setActionError(
          '無法讀取本機設定操作記錄，為避免遺失未確認操作，已暫停修改。',
        );
        return;
      }
      if (stored.status === 'none') return;

      if (stored.intent.phase === 'conflict') {
        if (removeStoredIntent(stored.intent)) {
          setNotice(
            '設定已由其他管理者更新，已載入目前規則。請重新檢查後再確認。',
          );
          await notifyChanged();
        } else {
          rememberIntent(stored.intent);
          setIntentMessage(
            '目前設定已重新取得；原操作記錄仍保留在本機。重新載入可再次確認並清除。',
          );
        }
        return;
      }

      rememberIntent(stored.intent);
      setIntentMessage(
        '這項操作的結果尚未確認。重試會沿用原操作編號與完整內容。',
      );
    }

    void load().catch((error: unknown) => {
      if (!isActive()) return;
      if (error instanceof IdentityChangedError) {
        restartForIdentity(
          error.current,
          '登入狀態已變更，正在重新確認目前帳號；原帳號的設定操作記錄會保留。',
        );
        return;
      }
      if (
        error instanceof ApiFailure &&
        (error.status === 401 || error.code.includes('OWNER'))
      ) {
        hideForIdentityFailure();
        return;
      }
      const message = errorMessage(error);
      setCapability({ projectId, sequence, status: 'enabled' });
      setRead({
        projectId,
        identityKey: ownerRef.current ? identityKey(ownerRef.current) : '',
        status: 'error',
        message,
      });
      setActionError(message);
    });

    return () => {
      active = false;
      controller.abort();
      if (mutationControllerRef.current) {
        mutationControllerRef.current.abort();
        mutationControllerRef.current = null;
      }
      requestGenerationRef.current += 1;
    };
  }, [
    hideForIdentityFailure,
    notifyChanged,
    projectId,
    reloadSequence,
    rememberIntent,
    restartForIdentity,
  ]);

  useEffect(() => {
    if (!confirmOpen) return;
    const previousFocus = document.activeElement;
    const saveButton = saveButtonRef.current;
    cancelDialogRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected)
        previousFocus.focus();
      else saveButton?.focus();
    };
  }, [confirmOpen]);

  useEffect(() => {
    if (!intent) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [intent]);

  useEffect(() => {
    if (owner.status !== 'ready') return;
    const previous = owner.value;
    let active = true;
    const recheckIdentity = () => {
      if (document.visibilityState === 'hidden' || identityCheckRef.current)
        return;
      identityCheckRef.current = true;
      void readOwnerIdentity()
        .then((current) => {
          if (!active || !mountedRef.current) return;
          if (sameIdentity(current, previous)) return;
          restartForIdentity(
            current,
            '登入狀態已變更，正在重新確認目前帳號；原帳號的設定操作記錄會保留。',
          );
        })
        .catch(() => {
          if (!active || !mountedRef.current) return;
          hideForIdentityFailure();
        })
        .finally(() => {
          identityCheckRef.current = false;
        });
    };
    window.addEventListener('focus', recheckIdentity);
    document.addEventListener('visibilitychange', recheckIdentity);
    return () => {
      active = false;
      window.removeEventListener('focus', recheckIdentity);
      document.removeEventListener('visibilitychange', recheckIdentity);
    };
  }, [hideForIdentityFailure, owner, restartForIdentity]);

  const currentCapability =
    capability?.projectId === projectId &&
    capability.sequence === reloadSequence
      ? capability
      : ({ projectId, sequence: reloadSequence, status: 'loading' } as const);
  const currentOwner = owner.status === 'ready' ? owner.value : null;
  const currentRead =
    currentOwner &&
    read?.projectId === projectId &&
    read.identityKey === identityKey(currentOwner)
      ? read
      : null;
  const config = currentRead?.status === 'ready' ? currentRead.value : null;
  const draftProfile =
    currentOwner &&
    draft?.projectId === projectId &&
    draft.identityKey === identityKey(currentOwner)
      ? getMatchingProfile(draft.profile)
      : null;
  const currentIntent =
    currentOwner &&
    config &&
    intent?.actorId === currentOwner.actorId &&
    intent.workspaceId === config.workspaceId &&
    intent.projectId === projectId
      ? intent
      : null;
  const changed = Boolean(
    config && draftProfile && draftProfile.id !== config.profile,
  );
  const blockedByIntent = currentIntent !== null;
  const controlsDisabled =
    disabled ||
    busy ||
    !config ||
    !draftProfile ||
    blockedByIntent ||
    Boolean(corruptStorageKey) ||
    storageUnavailable;
  const currentError =
    actionError ||
    (currentCapability.status === 'error'
      ? currentCapability.message
      : currentRead?.status === 'error'
        ? currentRead.message
        : owner.status === 'error'
          ? owner.message
          : '');

  function refresh() {
    if (busy) return;
    setNotice('正在重新取得目前專案比對規則。');
    setActionError('');
    setReloadSequence((value) => value + 1);
  }

  function updateDraft(change: Partial<MatchingProfileRules>) {
    if (controlsDisabled || !currentOwner || !draftProfile) return;
    const profile = matchingProfileForRules({
      ...draftProfile.rules,
      ...change,
    });
    if (!profile) return;
    setDraft({
      identityKey: identityKey(currentOwner),
      projectId,
      profile: profile.id,
    });
    setConfirmOpen(false);
    setNotice('');
    setActionError('');
  }

  function openConfirmation() {
    if (!config || !draftProfile || !changed || controlsDisabled) return;
    setConfirmOpen(true);
  }

  async function readBackAndClear(
    attempt: PendingIntent,
    expectedIdentity: OwnerIdentity,
    successMessage: (current: ProjectMatchingRulesRead) => string,
  ) {
    const current = await readProjectRules(
      projectId,
      expectedIdentity,
      attempt.workspaceId,
    );
    const activeIdentity = ownerRef.current;
    if (
      !mountedRef.current ||
      !activeIdentity ||
      !sameIdentity(activeIdentity, expectedIdentity)
    )
      return false;

    setRead({
      projectId,
      identityKey: identityKey(expectedIdentity),
      status: 'ready',
      value: current,
    });
    setDraft({
      identityKey: identityKey(expectedIdentity),
      projectId,
      profile: current.profile,
    });

    if (!removeStoredIntent(attempt)) {
      const stillPending = { ...attempt, phase: attempt.phase };
      rememberIntent(stillPending);
      setIntentMessage(
        '目前設定已重新取得，但原操作記錄仍保留在本機。請重新載入以再次確認。',
      );
      return false;
    }

    rememberIntent(null);
    setIntentMessage('');
    setCorruptStorageKey('');
    setStorageUnavailable(false);
    setActionError('');
    setConfirmOpen(false);
    setNotice(successMessage(current));
    await notifyChanged();
    return true;
  }

  async function sendIntent(attempt: PendingIntent) {
    if (
      inFlightRef.current !== null ||
      !mountedRef.current ||
      !intentRef.current ||
      !sameIntent(intentRef.current, attempt)
    )
      return;
    const capturedIdentity = ownerRef.current;
    if (!capturedIdentity || capturedIdentity.actorId !== attempt.actorId) {
      restartForIdentity(
        capturedIdentity,
        '登入狀態已變更，原設定操作仍保留在原帳號記錄中。',
      );
      return;
    }

    inFlightRef.current = attempt.body.requestId;
    const controller = new AbortController();
    mutationControllerRef.current = controller;
    const generation = requestGenerationRef.current;
    const isCurrent = () =>
      mountedRef.current && requestGenerationRef.current === generation;
    setBusy(true);
    setIntentMessage('');
    setActionError('');
    try {
      const { response, body } = await requestWithOwner(
        capturedIdentity,
        rulesPath(attempt.projectId),
        {
          method: 'PUT',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Kino-Expected-Actor': z.uuid().parse(attempt.actorId),
          },
          body: attempt.bodyJson,
          signal: controller.signal,
        },
      );
      if (!isCurrent()) return;

      const code = errorCode(body);
      if (
        response.status === 409 &&
        code === 'MATCHING_RULES_REVISION_CONFLICT'
      ) {
        const conflicted = { ...attempt, phase: 'conflict' as const };
        try {
          storeIntent(conflicted);
        } catch {
          // Keep the original exact intent in memory and block new settings.
        }
        rememberIntent(conflicted);
        setConfirmOpen(false);
        try {
          await readBackAndClear(
            conflicted,
            capturedIdentity,
            () =>
              '專案比對規則已由其他管理者更新。已載入目前設定，請重新檢查後再確認。',
          );
        } catch (error) {
          if (!isCurrent()) return;
          if (error instanceof IdentityChangedError) {
            restartForIdentity(
              error.current,
              '登入狀態已變更，原設定操作記錄仍保留。',
            );
            return;
          }
          setIntentMessage(
            '設定衝突已確認，但目前規則尚未重新讀取。請使用「重新載入」；不會重試這個衝突操作。',
          );
          setActionError(errorMessage(error));
        }
        return;
      }

      if (!response.ok) {
        setIntentMessage('操作結果尚未確認。重試會沿用原操作編號與完整內容。');
        setActionError(errorMessage(new ApiFailure(response.status, code)));
        return;
      }

      const parsed = setProjectMatchingRulesResultSchema.safeParse(body);
      const expectedProjectRevision =
        attempt.body.expectedProjectRevision +
        (parsed.success && parsed.data.changed ? 1 : 0);
      const expectedRuleRevision =
        attempt.body.expectedRuleRevision +
        (parsed.success && parsed.data.changed ? 1 : 0);
      if (
        !parsed.success ||
        parsed.data.projectId !== attempt.projectId ||
        parsed.data.workspaceId !== attempt.workspaceId ||
        parsed.data.profile !== attempt.body.profile ||
        parsed.data.projectRevision !== expectedProjectRevision ||
        parsed.data.ruleRevision !== expectedRuleRevision
      ) {
        setIntentMessage(
          '伺服器回應無法與原操作核對。請重試同一操作；原內容會保持不變。',
        );
        setActionError('目前無法驗證設定操作結果。');
        return;
      }

      await readBackAndClear(attempt, capturedIdentity, (current) =>
        current.profile === attempt.body.profile
          ? '專案比對規則已保存並重新確認。'
          : '原設定操作已確認；比對規則之後又有更新，畫面已載入目前設定。',
      );
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof IdentityChangedError) {
        restartForIdentity(
          error.current,
          '登入狀態已變更，原設定操作記錄仍保留在原帳號。',
        );
        return;
      }
      setIntentMessage(
        attempt.phase === 'conflict'
          ? '這項操作已遇到設定衝突。請重新載入目前設定，不會重試衝突操作。'
          : '操作結果尚未確認。重試會沿用原操作編號與完整內容。',
      );
      setActionError(errorMessage(error));
    } finally {
      if (inFlightRef.current === attempt.body.requestId) {
        inFlightRef.current = null;
        mutationControllerRef.current = null;
        if (mountedRef.current) setBusy(false);
      }
    }
  }

  function confirmChange() {
    if (
      !currentOwner ||
      !config ||
      !draftProfile ||
      !changed ||
      controlsDisabled ||
      intentRef.current ||
      inFlightRef.current !== null
    )
      return;

    let body: SetProjectMatchingRules;
    try {
      body = setProjectMatchingRulesSchema.parse({
        requestId: crypto.randomUUID(),
        expectedProjectRevision: config.projectRevision,
        expectedRuleRevision: config.ruleRevision,
        profile: draftProfile.id,
        confirm: true,
      });
    } catch {
      setActionError('目前設定無法驗證，尚未送出操作。');
      return;
    }

    const attempt: PendingIntent = {
      actorId: currentOwner.actorId,
      workspaceId: config.workspaceId,
      projectId,
      storageKey: intentStorageKey(
        currentOwner.actorId,
        config.workspaceId,
        projectId,
      ),
      body,
      bodyJson: JSON.stringify(body),
      phase: 'unknown',
    };
    try {
      storeIntent(attempt);
    } catch {
      setStorageUnavailable(true);
      setActionError(
        '無法保存本機設定操作記錄，尚未送出變更。請重新載入後再試。',
      );
      setConfirmOpen(false);
      return;
    }

    rememberIntent(attempt);
    setConfirmOpen(false);
    void sendIntent(attempt);
  }

  function retryIntent() {
    const attempt = intentRef.current;
    if (attempt && attempt.phase === 'unknown' && inFlightRef.current === null)
      void sendIntent(attempt);
  }

  function discardCorruptIntent() {
    if (!corruptStorageKey || busy) return;
    try {
      sessionStorage.removeItem(corruptStorageKey);
      setCorruptStorageKey('');
      setActionError('');
      setNotice('無法驗證的本機記錄已清除；目前專案規則仍需另行確認。');
    } catch {
      setActionError('無法清除本機記錄，請重新載入後再試。');
    }
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      setConfirmOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  if (currentCapability.status === 'disabled') return null;

  const visible =
    currentCapability.status === 'enabled' ||
    currentCapability.status === 'error' ||
    owner.status === 'error';
  if (!visible) return null;

  const draftRules = draftProfile?.rules ?? null;
  const errorText = currentError;

  return (
    <section
      className="mt-4 min-w-0 space-y-4 rounded-lg border border-stone-200 bg-white p-4"
      aria-labelledby={titleId}
      data-testid="matching-rules-panel"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold text-stone-950">
            檔名比對規則
          </h2>
          <p className="mt-1 break-words text-sm text-stone-600">
            這些選項只調整檔名比對方式，不代表目前相簿索引已完成。開始比對前仍須確認索引完整。
          </p>
        </div>
        <button
          type="button"
          className="min-h-11 max-w-full rounded-md border border-stone-400 px-3 py-2 text-sm font-medium text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          onClick={refresh}
          data-testid="matching-rules-refresh"
        >
          {busy ? '正在確認…' : '重新載入規則'}
        </button>
      </div>

      {currentCapability.status === 'loading' && (
        <p className="text-sm text-stone-600" role="status">
          正在確認比對規則設定…
        </p>
      )}

      {errorText && (
        <p
          className="break-words rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"
          role="alert"
          data-testid="matching-rules-error"
        >
          {errorText}
        </p>
      )}

      {notice && (
        <p className="break-words text-sm text-stone-700" role="status">
          {notice}
        </p>
      )}

      {currentRead?.status === 'loading' && (
        <p className="text-sm text-stone-600" role="status">
          正在載入專案規則…
        </p>
      )}

      {config && draftProfile && (
        <>
          <div
            className="min-w-0 rounded-md bg-stone-50 p-3 text-sm text-stone-700"
            data-testid="matching-rules-summary"
          >
            <p>
              目前規則：<strong>{profileSummary(config.profile)}</strong>
            </p>
            <p className="mt-1 break-words">
              專案模式：
              {config.mode === 'auto_filename'
                ? '依檔名比對'
                : config.mode === 'assisted'
                  ? '輔助比對'
                  : config.mode === 'manual'
                    ? '手動'
                    : '關閉'}
            </p>
          </div>

          {currentIntent && (
            <div
              className="min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
              role="alert"
              data-testid="matching-rules-pending"
            >
              <p>
                {currentIntent.phase === 'conflict'
                  ? '這項操作遇到設定衝突。請重新載入目前規則；衝突操作不會再次送出。'
                  : '這項操作的結果尚未確認。重試會沿用原操作編號與完整內容。'}
              </p>
              {intentMessage && (
                <p className="mt-2 break-words">{intentMessage}</p>
              )}
              {currentIntent.phase === 'unknown' ? (
                <button
                  type="button"
                  className="mt-3 min-h-11 max-w-full rounded-md border border-amber-600 px-3 py-2 font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={busy}
                  onClick={retryIntent}
                  data-testid="matching-rules-retry"
                >
                  {busy ? '正在重試…' : '重試同一操作'}
                </button>
              ) : null}
            </div>
          )}

          {corruptStorageKey && (
            <div className="min-w-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p>
                本機保存的操作記錄無法驗證。請明確清除這筆記錄後，才能修改規則。
              </p>
              <button
                type="button"
                className="mt-3 min-h-11 max-w-full rounded-md border border-amber-600 px-3 py-2 font-medium disabled:opacity-50"
                disabled={busy}
                onClick={discardCorruptIntent}
                data-testid="matching-rules-discard"
              >
                清除無法驗證的記錄
              </button>
            </div>
          )}

          {storageUnavailable && !corruptStorageKey && !currentIntent && (
            <p className="break-words text-sm text-amber-950" role="status">
              本機操作記錄目前無法使用。請重新載入設定；在確認記錄狀態前不會送出變更。
            </p>
          )}

          <fieldset
            className="min-w-0 space-y-3"
            disabled={controlsDisabled}
            aria-describedby={suffixId + '-help'}
          >
            <legend className="mb-2 text-sm font-medium text-stone-900">
              比對方式
            </legend>
            <label
              htmlFor={caseId}
              className="flex min-w-0 items-start gap-3 rounded-md border border-stone-200 p-3 text-sm text-stone-800"
            >
              <input
                id={caseId}
                type="checkbox"
                checked={draftRules ? !draftRules.caseSensitive : false}
                onChange={(event) =>
                  updateDraft({ caseSensitive: !event.currentTarget.checked })
                }
                className="mt-1 size-4 shrink-0"
                data-testid="matching-rules-case"
              />
              <span className="min-w-0 break-words">忽略檔名字母大小寫</span>
            </label>
            <label
              htmlFor={jpegId}
              className="flex min-w-0 items-start gap-3 rounded-md border border-stone-200 p-3 text-sm text-stone-800"
            >
              <input
                id={jpegId}
                type="checkbox"
                checked={draftRules?.allowJpgJpegEquivalence ?? false}
                onChange={(event) =>
                  updateDraft({
                    allowJpgJpegEquivalence: event.currentTarget.checked,
                  })
                }
                className="mt-1 size-4 shrink-0"
                data-testid="matching-rules-jpeg"
              />
              <span className="min-w-0 break-words">
                將 JPG 與 JPEG 視為相同副檔名
              </span>
            </label>
            <label
              htmlFor={suffixId}
              className="flex min-w-0 items-start gap-3 rounded-md border border-stone-200 p-3 text-sm text-stone-800"
            >
              <input
                id={suffixId}
                type="checkbox"
                checked={draftRules?.stripRecognizedSuffixes ?? false}
                onChange={(event) =>
                  updateDraft({
                    stripRecognizedSuffixes: event.currentTarget.checked,
                  })
                }
                className="mt-1 size-4 shrink-0"
                data-testid="matching-rules-suffix"
              />
              <span className="min-w-0 break-words">
                忽略一個已知的檔名結尾
                <span
                  id={suffixId + '-help'}
                  className="mt-1 block text-xs leading-5 text-stone-600"
                >
                  僅比對最後一組
                  _edited、_retouched、_edit、-edited、-retouched、-edit、_v數字或
                  -v數字。
                </span>
              </span>
            </label>
          </fieldset>

          <div className="flex min-w-0 flex-wrap gap-2">
            <button
              ref={saveButtonRef}
              type="button"
              className="min-h-11 max-w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!changed || controlsDisabled}
              onClick={openConfirmation}
              data-testid="matching-rules-save"
            >
              檢查變更
            </button>
          </div>
        </>
      )}

      {confirmOpen && config && draftProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            aria-describedby={dialogDescriptionId}
            tabIndex={-1}
            onKeyDown={handleDialogKeyDown}
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg bg-white p-4 shadow-xl sm:p-5"
            data-testid="matching-rules-dialog"
          >
            <h3 id={dialogTitleId} className="text-lg font-semibold">
              確認比對規則變更
            </h3>
            <div
              id={dialogDescriptionId}
              className="mt-3 min-w-0 space-y-2 break-words text-sm text-stone-700"
            >
              <p>
                目前：<strong>{profileSummary(config.profile)}</strong>
              </p>
              <p>
                變更後：<strong>{profileSummary(draftProfile.id)}</strong>
              </p>
              <p>
                變更會更新專案設定。索引完整度仍須另外確認，設定不會切換照片的目前版本。
              </p>
            </div>
            <div className="mt-5 flex min-w-0 flex-wrap justify-end gap-2">
              <button
                ref={cancelDialogRef}
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
                className="min-h-11 max-w-full rounded-md border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50 disabled:opacity-50"
                data-testid="matching-rules-cancel"
              >
                返回修改
              </button>
              <button
                type="button"
                disabled={busy || disabled}
                onClick={confirmChange}
                className="min-h-11 max-w-full rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="matching-rules-confirm"
              >
                {busy ? '正在保存…' : '確認並套用'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

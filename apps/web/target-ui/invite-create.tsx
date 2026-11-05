import { StudioIcon } from './studio-icons';
import { appendGuestLinkPassword } from './guest-link';
import { displayReference } from './display-reference';
import {
  scopedInvitePermissionAvailable,
  supplementalInvitePermissionAvailable,
} from './invite-permission-availability';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { z } from 'zod';
import {
  albumSchema,
  projectSchema,
  workspaceSchema,
  type Album,
} from '@kino-pic/contracts';
import { Button } from '@kino-pic/ui';
import {
  createInviteSchema,
  createdInviteSchema,
  inviteCapabilitiesSchema,
  inviteCreationResponseSchema,
} from '../../../packages/contracts/src/invites';
import {
  guestPasswordSchema,
  guestPermissionsSchema,
  type GuestPermission,
} from '../../../packages/contracts/src/guest-access';

const albumPageSchema = z
  .object({
    workspace: workspaceSchema,
    project: projectSchema,
    albums: z.array(albumSchema).max(24),
    nextCursor: z.string().nullable(),
  })
  .strict();

const permissionsDefault = {
  can_view: true,
  can_download_preview: false,
  can_download_original: false,
  can_select: false,
  can_rate: false,
  can_favorite: false,
  can_tag: false,
  can_annotate: false,
  can_comment: false,
  can_submit: false,
  can_view_own_history: false,
  can_compare_versions: false,
} satisfies z.infer<typeof guestPermissionsSchema>;

const permissionLabels: Record<GuestPermission, string> = {
  can_view: '查看相簿',
  can_download_preview: '下載預覽',
  can_download_original: '下載原圖',
  can_select: '挑片',
  can_rate: '星等',
  can_favorite: '收藏',
  can_tag: '標籤',
  can_annotate: '註記',
  can_comment: '留言',
  can_submit: '提交挑片',
  can_view_own_history: '查看自己的操作歷史',
  can_compare_versions: '比較版本',
};

const basicPermissionNames = [
  'can_view',
  'can_download_preview',
  'can_download_original',
  'can_select',
  'can_submit',
] as const satisfies readonly GuestPermission[];

const advancedPermissionNames = [
  'can_rate',
  'can_favorite',
  'can_tag',
  'can_annotate',
  'can_comment',
  'can_view_own_history',
  'can_compare_versions',
] as const satisfies readonly GuestPermission[];

const accessModes = [
  { value: 'link_only', label: '無密碼連結' },
  { value: 'generated_password', label: '系統產生密碼' },
  { value: 'custom_password', label: '自訂密碼' },
] as const;

const apiErrorSchema = z
  .object({ error: z.object({ code: z.string() }).strict() })
  .strict();

const dayMilliseconds = 24 * 60 * 60 * 1000;
const createdInviteModeSchema = z.enum([
  'link_only',
  'generated_password',
  'custom_password',
]);

type AccessMode = z.infer<typeof createdInviteModeSchema>;
type AlbumPage = {
  cursor: string | undefined;
  workspaceId: string;
  albums: Album[];
  nextCursor: string | null;
  projectStatus: z.infer<typeof projectSchema>['status'];
};
type InvitePayload = z.infer<typeof createInviteSchema>;
type SelectedAlbum = { id: string; name: string };
type IntentSnapshot = {
  requestId: string;
  body: string;
  payload: InvitePayload;
  albums: SelectedAlbum[];
  uncertain: boolean;
};
type ResolvedInvite = {
  invite: z.infer<typeof createdInviteSchema>;
  requestId: string;
  accessMode: AccessMode;
  albums: SelectedAlbum[];
  secretAvailable: boolean;
  shareUrls: string[];
  generatedPassword: string | null;
  sharePassword: string | null;
};

function localDateTimeInput(milliseconds: number): string {
  const date = new Date(milliseconds);
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

function parseLocalDateTimeInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  const milliseconds = date.getTime();
  if (
    !Number.isFinite(milliseconds) ||
    localDateTimeInput(milliseconds) !== value
  )
    return null;
  return milliseconds;
}

function definitiveFailureMessage(status: number, code: string): string {
  if (code === 'INVITE_ISSUANCE_DISABLED')
    return '目前尚未開放建立新邀請；請稍後重新載入可用狀態。';
  if (code === 'OWNER_REQUIRED' || status === 401)
    return '登入已失效，請重新登入後再建立邀請。';
  if (code === 'NOT_FOUND')
    return '找不到此專案或邀請範圍，請返回專案頁重新確認。';
  if (code === 'INVALID_INVITE_SCOPE')
    return '所選相簿已不可用，請重新載入相簿並調整範圍。';
  if (code === 'INVITE_EXPIRED')
    return '到期時間已過，請調整到期時間後再送出。';
  if (code === 'INVITE_LIMIT_REACHED')
    return '此專案已達邀請紀錄上限，請聯絡管理者檢查容量與保留政策。';
  if (code === 'REQUEST_ID_CONFLICT')
    return '此操作編號與其他內容衝突；請確認狀態後再明確開始新邀請。';
  if (status === 403) return '目前帳號無權建立此邀請。';
  if (status === 400) return '邀請資料未通過檢查，請修正表單後再送出。';
  return '邀請資料未被接受，請確認表單和專案狀態後再試。';
}

function validateAlbumPage(
  input: unknown,
  projectId: string,
): z.infer<typeof albumPageSchema> {
  const page = albumPageSchema.parse(input);
  if (
    page.project.id !== projectId ||
    page.project.workspaceId !== page.workspace.id ||
    page.albums.some(
      (album) =>
        album.projectId !== projectId ||
        album.workspaceId !== page.workspace.id,
    )
  )
    throw new Error('ALBUM_PAGE_SCOPE_MISMATCH');
  return page;
}

async function loadAlbumPage(
  projectId: string,
  cursor?: string,
  signal?: AbortSignal,
): Promise<AlbumPage> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/albums${query}`,
    {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    },
  );
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error('ALBUMS_UNAVAILABLE');
  const page = validateAlbumPage(body, projectId);
  return {
    cursor,
    workspaceId: page.workspace.id,
    albums: page.albums,
    nextCursor: page.nextCursor,
    projectStatus: page.project.status,
  };
}

function CopySecret({ value, label }: { value: string; label: string }) {
  const generatedId = useId().replaceAll(':', '');
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);

  async function copy() {
    setCopied(false);
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(value);
      setManual(false);
      setCopied(true);
    } catch {
      setManual(true);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }

  return (
    <div className="mt-2 min-w-0">
      <Button type="button" variant="outline" onClick={() => void copy()}>
        <StudioIcon name="copy" width={16} height={16} /> 複製{label}
      </Button>
      {copied && (
        <span className="ml-2 text-sm text-green-800" role="status">
          已複製
        </span>
      )}
      {manual && (
        <div className="mt-2 min-w-0">
          <label
            className="block text-sm"
            htmlFor={`manual-copy-${generatedId}`}
          >
            請選取下方內容後按 Ctrl+C：
          </label>
          <input
            ref={inputRef}
            id={`manual-copy-${generatedId}`}
            className="mt-1 block w-full min-w-0 rounded border border-stone-300 p-2 text-xs"
            type="text"
            value={value}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
      )}
    </div>
  );
}

export type InviteShareRequest = {
  sequence: number;
  album: Pick<Album, 'id' | 'name' | 'projectId' | 'workspaceId' | 'state'>;
};

type InviteCreateProps = {
  projectId: string;
  onCreated?: () => void;
  onClose?: () => void;
  onBusyChange?: (busy: boolean) => void;
  shareRequest?: InviteShareRequest | null;
};

export function InviteCreate(props: InviteCreateProps) {
  return <InviteCreateForm key={props.projectId} {...props} />;
}

function InviteCreateForm({
  projectId,
  onCreated,
  onClose,
  onBusyChange,
  shareRequest,
}: InviteCreateProps) {
  const [includePasswordInLink, setIncludePasswordInLink] = useState(false);
  const projectIdValid = z.uuid().safeParse(projectId).success;
  const [capability, setCapability] = useState<z.infer<
    typeof inviteCapabilitiesSchema
  > | null>(null);
  const [capabilityLoading, setCapabilityLoading] = useState(true);
  const [capabilityError, setCapabilityError] = useState('');
  const [albumPages, setAlbumPages] = useState<AlbumPage[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [albumsLoading, setAlbumsLoading] = useState(true);
  const [albumError, setAlbumError] = useState('');
  const [selectedAlbumIds, setSelectedAlbumIds] = useState<string[]>([]);
  const [shareAlbumSnapshot, setShareAlbumSnapshot] =
    useState<SelectedAlbum | null>(null);
  const [shareNotice, setShareNotice] = useState('');
  const handledShareSequence = useRef<number | null>(null);
  const [mode, setMode] = useState<AccessMode>('link_only');
  const [permissions, setPermissions] = useState({ ...permissionsDefault });
  const advancedPermissionsRef = useRef<HTMLDetailsElement>(null);
  const [customPassword, setCustomPassword] = useState('');
  const [unlimitedUses, setUnlimitedUses] = useState(true);
  const [maxUsesInput, setMaxUsesInput] = useState('1');
  const [expiryInput, setExpiryInput] = useState('');
  const [clock, setClock] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pendingIntent, setPendingIntent] = useState<IntentSnapshot | null>(
    null,
  );
  const pendingIntentRef = useRef<IntentSnapshot | null>(null);
  const [resolved, setResolved] = useState<ResolvedInvite | null>(null);
  const resolvedRef = useRef<ResolvedInvite | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function updateBusy(nextBusy: boolean) {
    busyRef.current = nextBusy;
    setBusy(nextBusy);
    onBusyChange?.(nextBusy);
  }

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch('/api/v1/invites/capabilities', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error('CAPABILITIES_UNAVAILABLE');
        const parsed = inviteCapabilitiesSchema.parse(body);
        if (active) {
          setCapability(parsed);
          setCapabilityError('');
        }
      })
      .catch(() => {
        if (active) {
          setCapability(null);
          setCapabilityError('目前無法確認邀請功能是否可用。');
        }
      })
      .finally(() => {
        if (active) setCapabilityLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (!projectIdValid) return;
    void loadAlbumPage(projectId, undefined, controller.signal)
      .then((page) => {
        if (active) {
          setAlbumPages([page]);
          setAlbumError('');
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setAlbumPages([]);
          setAlbumError(
            reason instanceof Error &&
              reason.message === 'ALBUM_PAGE_SCOPE_MISMATCH'
              ? '相簿回應的專案範圍不符，已停止載入。'
              : '目前無法載入專案相簿，請重試。',
          );
        }
      })
      .finally(() => {
        if (active) setAlbumsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, projectIdValid]);

  useEffect(() => {
    let active = true;
    const initial = window.setTimeout(() => {
      if (!active) return;
      const now = Date.now();
      setClock(now);
      setExpiryInput(localDateTimeInput(now + 7 * dayMilliseconds));
    }, 0);
    const interval = window.setInterval(() => {
      if (active) setClock(Date.now());
    }, 60_000);
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (!pendingIntentRef.current && !resolvedRef.current?.secretAvailable)
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const currentPage = albumPages[pageIndex] ?? null;
  const activeAlbums =
    currentPage?.albums.filter((album) => album.state === 'active') ?? [];
  const projectStatus = albumPages[0]?.projectStatus ?? null;
  const parentUnavailable =
    projectStatus === null ||
    ['archived', 'deleting', 'deleted'].includes(projectStatus);
  const albumNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const page of albumPages) {
      for (const album of page.albums) names.set(album.id, album.name);
    }
    if (shareAlbumSnapshot)
      names.set(shareAlbumSnapshot.id, shareAlbumSnapshot.name);
    return names;
  }, [albumPages, shareAlbumSnapshot]);
  const selectedCount = selectedAlbumIds.length;
  const formLocked = busy || pendingIntent !== null || resolved !== null;
  useEffect(() => {
    if (!shareRequest || handledShareSequence.current === shareRequest.sequence)
      return;
    if (albumsLoading && albumPages.length === 0 && !albumError) return;
    const request = shareRequest;
    const frame = window.requestAnimationFrame(() => {
      if (handledShareSequence.current === request.sequence) return;
      handledShareSequence.current = request.sequence;
      const album = request.album;
      const firstPage = albumPages[0];
      const currentAlbum = albumPages
        .flatMap((page) => page.albums)
        .find((item) => item.id === album.id);
      if (
        !firstPage ||
        albumError ||
        !z.uuid().safeParse(album.id).success ||
        !z.uuid().safeParse(album.workspaceId).success ||
        album.projectId.toLowerCase() !== projectId.toLowerCase() ||
        album.workspaceId.toLowerCase() !==
          firstPage.workspaceId.toLowerCase() ||
        (currentAlbum ?? album).state !== 'active' ||
        ['archived', 'deleting', 'deleted'].includes(firstPage.projectStatus)
      ) {
        setShareNotice(
          '無法確認此相簿仍屬於目前專案且可分享；原表單內容已保留，請重新整理專案後再試。',
        );
        return;
      }
      if (busyRef.current || pendingIntentRef.current || resolvedRef.current) {
        const pending = pendingIntentRef.current !== null || busyRef.current;
        const hasOneTimeSecret = resolvedRef.current?.secretAvailable === true;
        setShareNotice(
          pending
            ? '已有一筆邀請操作尚未確認。原操作與表單已保留，授權範圍沒有更動；請先重試同一邀請或查詢建立結果。'
            : hasOneTimeSecret
              ? '一次性分享資料仍在畫面上。原結果、憑證與授權範圍已保留；請先複製並安全傳送，再明確開始另一筆邀請。'
              : '目前已有邀請建立結果。原結果與表單已保留，授權範圍沒有更動；請先處理目前結果，再開始另一筆邀請。',
        );
        return;
      }
      if (selectedAlbumIds.length > 0) {
        setShareNotice(
          selectedAlbumIds.includes(album.id)
            ? '此相簿已在目前邀請範圍內；原表單保持不變。'
            : '目前邀請已選相簿，為保留你的表單沒有切換範圍；可在表單內手動調整。',
        );
        return;
      }
      const albumName = currentAlbum?.name ?? album.name;
      setSelectedAlbumIds([album.id]);
      setShareAlbumSnapshot({ id: album.id, name: albumName });
      setShareNotice(
        '已預選「' +
          albumName +
          '」；送出時仍會由伺服器確認相簿狀態與授權範圍。',
      );
      setError('');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    albumError,
    albumPages,
    albumsLoading,
    projectId,
    selectedAlbumIds,
    shareRequest,
  ]);
  const validationScope = capability?.validationScope;
  const validationPermission = (permission: string) =>
    scopedInvitePermissionAvailable(capability, permission);
  const canCreate =
    !formLocked &&
    (!validationScope ||
      (projectId === validationScope.projectId &&
        selectedAlbumIds.length === 1 &&
        selectedAlbumIds[0] === validationScope.albumId &&
        mode === 'link_only' &&
        Object.entries(permissions).every(
          ([name, value]) => !value || validationPermission(name),
        ))) &&
    capability?.issuanceEnabled === true &&
    capability.exchangeEnabled === true &&
    !capabilityLoading &&
    !capabilityError &&
    projectIdValid &&
    !parentUnavailable &&
    !albumsLoading &&
    !albumError &&
    selectedCount > 0 &&
    selectedCount <= (capability?.maxAlbums ?? 24) &&
    (mode !== 'custom_password' ||
      guestPasswordSchema.safeParse(customPassword).success) &&
    (unlimitedUses ||
      (/^\d+$/.test(maxUsesInput) &&
        Number(maxUsesInput) >= 1 &&
        Number(maxUsesInput) <= (capability?.maxUses ?? 10000))) &&
    (() => {
      const expiry = parseLocalDateTimeInput(expiryInput);
      const now = clock;
      if (now === null) return false;
      return (
        expiry !== null &&
        expiry > now &&
        expiry <= now + (capability?.maxExpiryDays ?? 365) * dayMilliseconds
      );
    })();

  async function loadNextPage() {
    if (!currentPage?.nextCursor || albumsLoading || formLocked) return;
    if (albumPages[pageIndex + 1]) {
      setPageIndex((index) => index + 1);
      return;
    }
    setAlbumsLoading(true);
    setAlbumError('');
    try {
      const page = await loadAlbumPage(projectId, currentPage.nextCursor);
      setAlbumPages((existing) => {
        if (existing[pageIndex + 1]) return existing;
        return [...existing, page];
      });
      setPageIndex((index) => index + 1);
    } catch (reason) {
      setAlbumError(
        reason instanceof Error &&
          reason.message === 'ALBUM_PAGE_SCOPE_MISMATCH'
          ? '相簿回應的專案範圍不符，已停止載入。'
          : '目前無法載入下一頁相簿，請重試。',
      );
    } finally {
      setAlbumsLoading(false);
    }
  }

  async function retryAlbumPage() {
    if (albumsLoading || formLocked) return;
    setAlbumsLoading(true);
    setAlbumError('');
    try {
      const page = await loadAlbumPage(projectId, currentPage?.cursor);
      setAlbumPages((existing) => {
        const next = [...existing];
        next[pageIndex] = page;
        return next;
      });
    } catch (reason) {
      setAlbumError(
        reason instanceof Error &&
          reason.message === 'ALBUM_PAGE_SCOPE_MISMATCH'
          ? '相簿回應的專案範圍不符，已停止載入。'
          : '目前無法載入相簿，請重試。',
      );
    } finally {
      setAlbumsLoading(false);
    }
  }

  function setPending(intent: IntentSnapshot | null) {
    pendingIntentRef.current = intent;
    setPendingIntent(intent);
  }

  function markUncertain(requestId: string) {
    const current = pendingIntentRef.current;
    if (!current || current.requestId !== requestId || current.uncertain)
      return;
    setPending({ ...current, uncertain: true });
  }

  function setResolvedInvite(value: ResolvedInvite | null) {
    resolvedRef.current = value;
    setResolved(value);
  }

  function finishWithResult(
    body: unknown,
    intent: IntentSnapshot,
    recoveryOnly: boolean,
  ): boolean {
    const parsed = inviteCreationResponseSchema.safeParse(body);
    if (!parsed.success) return false;
    const result = parsed.data;
    if (
      result.invite.projectId !== projectId ||
      (recoveryOnly && result.secretAvailable)
    )
      return false;
    if (result.secretAvailable) {
      const expectsGeneratedPassword =
        intent.payload.accessMode === 'generated_password';
      if (expectsGeneratedPassword !== (result.generatedPassword !== null))
        return false;
    }
    const shareUrls = result.secretAvailable
      ? intent.albums.map(
          (album) =>
            `${window.location.origin}/guest/albums/${album.id}/enter#token=${result.token}`,
        )
      : [];
    const resolvedValue: ResolvedInvite = {
      invite: result.invite,
      requestId: intent.requestId,
      accessMode: intent.payload.accessMode,
      albums: intent.albums,
      secretAvailable: result.secretAvailable,
      shareUrls,
      generatedPassword: result.secretAvailable
        ? result.generatedPassword
        : null,
      sharePassword: result.secretAvailable
        ? (result.generatedPassword ?? intent.payload.password ?? null)
        : null,
    };
    setPending(null);
    setIncludePasswordInLink(false);
    setResolvedInvite(resolvedValue);
    setCustomPassword('');
    setError('');
    setMessage('邀請建立結果已確認。');
    onCreated?.();
    return true;
  }

  async function sendIntent(intent: IntentSnapshot) {
    if (
      busyRef.current ||
      pendingIntentRef.current?.requestId !== intent.requestId
    )
      return;
    updateBusy(true);
    setError('');
    setMessage('正在送出同一筆邀請操作…');
    try {
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(projectId)}/invites`,
        {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: intent.body,
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError = apiErrorSchema.safeParse(body);
        const code = apiError.success ? apiError.data.error.code : '';
        const knownRejection =
          (response.status >= 400 && response.status < 500) ||
          code === 'INVITE_ISSUANCE_DISABLED';
        const priorUnknown =
          pendingIntentRef.current?.requestId === intent.requestId &&
          pendingIntentRef.current.uncertain;
        if (knownRejection && !priorUnknown) {
          setPending(null);
          setError(definitiveFailureMessage(response.status, code));
          setMessage('');
          return;
        }
        markUncertain(intent.requestId);
        setError(
          knownRejection
            ? '這次重試未通過，但先前結果仍未確認。原操作已保留；請查詢建立結果或重試同一邀請。'
            : '建立結果尚未確認。請重試同一邀請，或查詢建立結果；請勿另建新邀請。',
        );
        setMessage('');
        return;
      }
      if (!finishWithResult(body, intent, false)) {
        markUncertain(intent.requestId);
        setError('伺服器回應無法核對；請使用相同操作重試或查詢建立結果。');
        setMessage('');
      }
    } catch {
      markUncertain(intent.requestId);
      setError(
        '建立結果尚未確認。請重試同一邀請，或查詢建立結果；請勿另建新邀請。',
      );
      setMessage('');
    } finally {
      updateBusy(false);
    }
  }

  async function recoverIntent() {
    const intent = pendingIntentRef.current;
    if (!intent || busyRef.current) return;
    updateBusy(true);
    setError('');
    setMessage('正在查詢此操作的已提交紀錄…');
    try {
      const response = await fetch(
        `/api/v1/invites/creation/${encodeURIComponent(intent.requestId)}`,
        {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        },
      );
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        if (!finishWithResult(body, intent, true)) {
          markUncertain(intent.requestId);
          setError(
            '建立結果無法核對；仍保留原操作，請稍後重試查詢或送出同一邀請。',
          );
          setMessage('');
        }
        return;
      }
      markUncertain(intent.requestId);
      setError(
        response.status === 404
          ? '目前查無已提交紀錄；原操作仍保留，請重試同一邀請，不要建立新邀請。'
          : '目前無法查詢建立結果；原操作仍保留，請稍後重試。',
      );
      setMessage('');
    } catch {
      markUncertain(intent.requestId);
      setError('目前無法查詢建立結果；原操作仍保留，請稍後重試。');
      setMessage('');
    } finally {
      updateBusy(false);
    }
  }

  function toggleAlbum(albumId: string, checked: boolean) {
    if (
      checked &&
      !selectedAlbumIds.includes(albumId) &&
      selectedAlbumIds.length >= (capability?.maxAlbums ?? 24)
    ) {
      setError(`最多可選 ${capability?.maxAlbums ?? 24} 個相簿。`);
      return;
    }
    setError('');
    setShareNotice('');
    setSelectedAlbumIds((current) => {
      if (checked) {
        if (current.includes(albumId)) return current;
        return [...current, albumId];
      }
      return current.filter((id) => id !== albumId);
    });
    if (!checked && shareAlbumSnapshot?.id === albumId)
      setShareAlbumSnapshot(null);
  }

  function changePermission(permission: GuestPermission, checked: boolean) {
    setPermissions((current) => ({ ...current, [permission]: checked }));
  }

  function setModeValue(value: string) {
    const parsed = createdInviteModeSchema.safeParse(value);
    if (parsed.success) setMode(parsed.data);
  }

  function resetForAnotherInvite() {
    setPending(null);
    setResolvedInvite(null);
    setError('');
    setMessage('');
    setMode('link_only');
    setPermissions({ ...permissionsDefault });
    if (advancedPermissionsRef.current)
      advancedPermissionsRef.current.open = false;
    setCustomPassword('');
    setSelectedAlbumIds([]);
    setShareAlbumSnapshot(null);
    setShareNotice('');
    setUnlimitedUses(true);
    setMaxUsesInput('1');
    setExpiryInput(localDateTimeInput(Date.now() + 7 * dayMilliseconds));
    setPageIndex(0);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreate || busy || pendingIntentRef.current || resolvedRef.current)
      return;
    const expiry = parseLocalDateTimeInput(expiryInput);
    const now = Date.now();
    if (
      expiry === null ||
      expiry <= now ||
      expiry > now + (capability?.maxExpiryDays ?? 365) * dayMilliseconds
    ) {
      setError('到期時間須為未來時間，且不可超過 365 天。');
      return;
    }
    const maxUses = unlimitedUses ? null : Number(maxUsesInput);
    const albumIds = [...selectedAlbumIds];
    if (albumIds.some((id) => !albumNames.has(id))) {
      setError('已選相簿資料不完整，請重新載入相簿後再送出。');
      return;
    }
    const candidate = {
      requestId: crypto.randomUUID(),
      albumIds,
      accessMode: mode,
      ...(mode === 'custom_password' ? { password: customPassword } : {}),
      permissions: { ...permissions },
      expiresAt: new Date(expiry).toISOString(),
      maxUses,
    };
    const parsed = createInviteSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(
        mode === 'custom_password' &&
          !guestPasswordSchema.safeParse(customPassword).success
          ? '自訂密碼需為 12–256 個 UTF-16 單位、有效 Unicode，且 UTF-8 不超過 1024 位元組；空白會完整保留。'
          : '邀請資料未通過檢查，請確認相簿、權限、期限與使用次數。',
      );
      return;
    }
    const intent: IntentSnapshot = {
      requestId: parsed.data.requestId,
      body: JSON.stringify(parsed.data),
      payload: parsed.data,
      albums: albumIds.map((id) => ({ id, name: albumNames.get(id) ?? id })),
      uncertain: false,
    };
    setPending(intent);
    setError('');
    void sendIntent(intent);
  }

  const maxUsesIsValid =
    unlimitedUses ||
    (/^\d+$/.test(maxUsesInput) &&
      Number(maxUsesInput) >= 1 &&
      Number(maxUsesInput) <= (capability?.maxUses ?? 10000));
  const expiryValue = parseLocalDateTimeInput(expiryInput);
  const expiryIsValid =
    clock !== null &&
    expiryValue !== null &&
    expiryValue > clock &&
    expiryValue <= clock + (capability?.maxExpiryDays ?? 365) * dayMilliseconds;

  function renderPermission(permission: GuestPermission) {
    const unimplemented = !supplementalInvitePermissionAvailable(
      capability,
      permission,
    );
    const selectionUnavailable =
      (permission === 'can_select' || permission === 'can_submit') &&
      capability !== null &&
      !capability.selectionEnabled;
    return (
      <li key={permission} className="min-w-0">
        <label className="flex min-w-0 items-start gap-2 rounded border border-stone-200 p-3 text-sm">
          <input
            type="checkbox"
            data-testid={`invite-permission-${permission}`}
            checked={permissions[permission]}
            disabled={!!validationScope && !validationPermission(permission)}
            onChange={(event) =>
              changePermission(permission, event.currentTarget.checked)
            }
          />
          <span className="min-w-0 break-words">
            {permissionLabels[permission]}
            {unimplemented ||
            selectionUnavailable ||
            (validationScope && !validationPermission(permission))
              ? '（尚未可用）'
              : ''}
          </span>
        </label>
      </li>
    );
  }

  return (
    <section
      className="share-invite-card min-w-0"
      aria-label="建立客戶邀請"
      data-testid="invite-create"
    >
      <header className="share-invite-header">
        <div className="min-w-0">
          <p className="share-invite-eyebrow">分享相簿</p>
          <h3 className="share-invite-title">分享給客戶</h3>
          <p className="share-invite-subtitle">
            選擇相簿、密碼與客戶可使用的功能。
          </p>
        </div>
        {shareAlbumSnapshot && (
          <div className="share-invite-album">
            <span className="share-invite-album-mark" aria-hidden="true">
              <StudioIcon name="share" width={18} height={18} />
            </span>
            <div className="min-w-0">
              <span>正在分享相簿</span>
              <strong>{shareAlbumSnapshot.name}</strong>
            </div>
          </div>
        )}
        {onClose && (
          <Button
            type="button"
            variant="outline"
            className="share-invite-close"
            aria-label="關閉建立客戶邀請"
            disabled={busy}
            onClick={onClose}
          >
            <StudioIcon name="close" width={18} height={18} />
          </Button>
        )}
      </header>

      {shareNotice && !shareAlbumSnapshot && (
        <p
          className="mt-3 break-words rounded border border-stone-200 bg-stone-50 p-3 text-sm"
          data-testid="invite-share-notice"
          role="status"
        >
          {shareNotice}
        </p>
      )}

      {capabilityLoading ? (
        <p className="mt-3 text-sm" role="status">
          正在確認邀請功能狀態…
        </p>
      ) : capabilityError ? (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm" role="alert">
            {capabilityError}建立按鈕已停用。
          </p>
        </div>
      ) : capability ? (
        <details
          className="share-advanced-info"
          open={!capability.issuanceEnabled || !capability.exchangeEnabled}
        >
          <summary>分享設定說明</summary>
          {!capability.issuanceEnabled && (
            <p role="status">目前尚未開放建立新邀請。</p>
          )}
          {capability.issuanceEnabled && !capability.exchangeEnabled && (
            <p role="status">訪客登入尚未啟用，現在建立的邀請無法使用。</p>
          )}

          {projectStatus !== null &&
            ['archived', 'deleting', 'deleted'].includes(projectStatus) && (
              <p role="status">此專案目前已封存或正在清理，無法建立邀請。</p>
            )}
          {!capability.selectionEnabled && (
            <p className="mt-1 break-words">
              訪客挑片目前未啟用；「挑片」與「提交挑片」操作尚不可用，但可獨立設定各自權限。
            </p>
          )}
          {validationScope && (
            <p className="mt-1">
              {validationScope.permissionNames
                ? '此測試入口僅開放指定相簿的無密碼連結；下列權限依已驗收能力獨立設定。'
                : '此測試入口僅開放指定相簿的無密碼連結、查看、挑片與提交；其他設定尚未開放。'}
            </p>
          )}
          <p className="mt-1">
            每筆最多 {capability.maxAlbums} 個相簿；期限最多{' '}
            {capability.maxExpiryDays} 天；使用次數上限 {capability.maxUses}。
          </p>
        </details>
      ) : null}

      <form
        className="share-invite-form mt-4 min-w-0 space-y-5"
        onSubmit={handleSubmit}
      >
        <fieldset
          disabled={formLocked}
          className="share-invite-fields min-w-0 space-y-5"
        >
          <legend className="font-medium">授權相簿</legend>
          {shareAlbumSnapshot &&
            selectedAlbumIds.includes(shareAlbumSnapshot.id) && (
              <div
                className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 p-3 text-sm"
                data-testid={
                  'invite-preselected-album-' + shareAlbumSnapshot.id
                }
                aria-label={'已預選相簿 ' + shareAlbumSnapshot.name}
              >
                <span className="min-w-0 break-words">
                  已由相簿卡預選：<strong>{shareAlbumSnapshot.name}</strong>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={formLocked}
                  onClick={() => toggleAlbum(shareAlbumSnapshot.id, false)}
                >
                  取消選取
                </Button>
              </div>
            )}
          <p className="mt-1 text-sm text-stone-600">
            已選 {selectedCount} / {capability?.maxAlbums ?? 24}{' '}
            個。跨頁勾選會保留。
          </p>
          {!projectIdValid ? (
            <p role="alert" className="text-sm text-red-800">
              專案編號無效，無法載入相簿。
            </p>
          ) : albumsLoading && !currentPage ? (
            <p role="status" className="text-sm">
              載入相簿中…
            </p>
          ) : albumError ? (
            <div className="min-w-0">
              <p role="alert" className="break-words text-sm text-red-700">
                {albumError}
              </p>
              <Button
                type="button"
                className="mt-2"
                variant="outline"
                disabled={albumsLoading}
                onClick={() => void retryAlbumPage()}
              >
                重試載入相簿
              </Button>
            </div>
          ) : activeAlbums.length === 0 ? (
            <p className="text-sm text-stone-600">
              {currentPage?.nextCursor
                ? '此頁沒有可用相簿，請繼續查看下一頁。'
                : '此專案目前沒有可用的使用中相簿。'}
            </p>
          ) : (
            <ul className="grid min-w-0 gap-2 sm:grid-cols-2">
              {activeAlbums.map((album) => {
                const checked = selectedAlbumIds.includes(album.id);
                return (
                  <li key={album.id} className="min-w-0">
                    <label className="flex min-w-0 items-start gap-2 rounded border border-stone-200 p-3 text-sm">
                      <input
                        type="checkbox"
                        data-testid={`invite-album-${album.id}`}
                        checked={checked}
                        disabled={
                          (!!validationScope &&
                            (projectId !== validationScope.projectId ||
                              album.id !== validationScope.albumId)) ||
                          (!checked &&
                            selectedCount >= (capability?.maxAlbums ?? 24))
                        }
                        onChange={(event) =>
                          toggleAlbum(album.id, event.currentTarget.checked)
                        }
                      />
                      <span className="min-w-0 break-words">{album.name}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            {pageIndex > 0 && (
              <Button
                type="button"
                variant="outline"
                disabled={albumsLoading}
                onClick={() => setPageIndex((index) => Math.max(0, index - 1))}
              >
                上一頁相簿
              </Button>
            )}
            {currentPage?.nextCursor && (
              <Button
                type="button"
                variant="outline"
                disabled={albumsLoading}
                onClick={() => void loadNextPage()}
              >
                {albumsLoading ? '載入中…' : '下一頁相簿'}
              </Button>
            )}
            {albumPages.length > 0 && (
              <span className="self-center text-sm text-stone-600">
                第 {pageIndex + 1} 頁
              </span>
            )}
          </div>

          <div>
            <h4 className="font-medium">連結方式</h4>
            <fieldset className="share-invite-mode-grid mt-2 grid min-w-0 gap-2 sm:grid-cols-3">
              <legend className="sr-only">選擇邀請密碼方式</legend>
              {accessModes.map((accessMode) => (
                <label
                  key={accessMode.value}
                  className="flex min-w-0 items-start gap-2 rounded border border-stone-200 p-3 text-sm"
                >
                  <input
                    type="radio"
                    name={`invite-access-mode-${projectId}`}
                    data-testid={`invite-mode-${accessMode.value}`}
                    checked={mode === accessMode.value}
                    disabled={
                      !!validationScope && accessMode.value !== 'link_only'
                    }
                    onChange={() => setModeValue(accessMode.value)}
                  />
                  <span className="min-w-0 break-words">
                    {accessMode.label}
                  </span>
                </label>
              ))}
            </fieldset>
            {mode === 'custom_password' && (
              <div className="mt-3 min-w-0">
                <label
                  className="block text-sm font-medium"
                  htmlFor="invite-custom-password"
                >
                  自訂密碼（輸入內容會原樣保留）
                </label>
                <input
                  id="invite-custom-password"
                  data-testid="invite-custom-password"
                  className="mt-1 block w-full min-w-0 rounded border border-stone-300 p-2"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  minLength={12}
                  maxLength={256}
                  value={customPassword}
                  onChange={(event) =>
                    setCustomPassword(event.currentTarget.value)
                  }
                />
                <p className="mt-1 break-words text-xs text-stone-600">
                  12–256 個 UTF-16 單位、有效 Unicode、UTF-8 最多 1024
                  位元組。空白與字元組合不會修剪或正規化。
                </p>
              </div>
            )}
          </div>

          <fieldset className="share-invite-permission-set min-w-0">
            <legend className="font-medium">訪客權限</legend>
            <p className="mt-1 text-sm text-stone-600">
              每項權限獨立設定；挑片與提交挑片也分開控制。
            </p>
            <fieldset
              className="share-invite-permission-subset mt-3 min-w-0 rounded border border-stone-200 p-3"
              data-testid="invite-basic-permissions"
            >
              <legend className="px-1 font-medium">基本權限</legend>
              <p className="text-sm text-stone-600">
                查看相簿、下載預覽或原圖，以及挑片。
              </p>
              <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
                {basicPermissionNames.map(renderPermission)}
              </ul>
            </fieldset>
            <details
              ref={advancedPermissionsRef}
              className="share-invite-advanced mt-3 rounded border border-stone-200 p-3"
              data-testid="invite-advanced-permissions"
            >
              <summary className="cursor-pointer break-words font-medium">
                進階權限（評等、收藏、標籤、註記、留言、歷史與版本比較）
              </summary>
              <p className="mt-2 text-sm text-stone-600">
                進階項目預設關閉，展開後可逐項設定。
              </p>
              <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
                {advancedPermissionNames.map(renderPermission)}
              </ul>
            </details>
          </fieldset>
          {!permissions.can_view && (
            <p
              className="mt-2 break-words text-sm text-amber-900"
              role="status"
            >
              未授予「查看相簿」時，Guest
              相簿頁面無法顯示圖庫。其他權限仍獨立保留目前設定，不會自動開啟查看或挑片。
            </p>
          )}

          <div className="share-invite-expiry-grid grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label
                className="block text-sm font-medium"
                htmlFor="invite-expires-at"
              >
                到期時間（本地時區）
              </label>
              <input
                id="invite-expires-at"
                data-testid="invite-expires-at"
                className="mt-1 block w-full min-w-0 rounded border border-stone-300 p-2 text-sm"
                type="datetime-local"
                step={60}
                disabled={clock === null}
                min={
                  clock === null
                    ? undefined
                    : localDateTimeInput(Math.ceil(clock / 60_000) * 60_000)
                }
                max={
                  clock === null
                    ? undefined
                    : localDateTimeInput(
                        clock +
                          (capability?.maxExpiryDays ?? 365) * dayMilliseconds,
                      )
                }
                value={expiryInput}
                onChange={(event) => setExpiryInput(event.currentTarget.value)}
              />
              <p className="mt-1 break-words text-xs text-stone-600">
                使用本地時間輸入，送出時轉換為 UTC ISO 時間；最多 365 天。
              </p>
              {!projectIdValid ? (
                <p role="alert" className="mt-1 text-xs text-red-800">
                  專案編號無效，無法載入相簿。
                </p>
              ) : null}
              {!expiryIsValid && expiryInput && (
                <p className="mt-1 text-xs text-amber-800">
                  請選擇未來 365 天內的本地時間。
                </p>
              )}
            </div>
            <div className="min-w-0">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  data-testid="invite-unlimited-uses"
                  checked={unlimitedUses}
                  onChange={(event) =>
                    setUnlimitedUses(event.currentTarget.checked)
                  }
                />
                不限制登入使用次數
              </label>
              {!unlimitedUses && (
                <div className="mt-2">
                  <label className="block text-sm" htmlFor="invite-max-uses">
                    使用次數上限（1–{capability?.maxUses ?? 10000}）
                  </label>
                  <input
                    id="invite-max-uses"
                    data-testid="invite-max-uses"
                    className="mt-1 block w-full min-w-0 rounded border border-stone-300 p-2"
                    type="number"
                    min={1}
                    max={capability?.maxUses ?? 10000}
                    step={1}
                    value={maxUsesInput}
                    onChange={(event) =>
                      setMaxUsesInput(event.currentTarget.value)
                    }
                  />
                  {!maxUsesIsValid && (
                    <p className="mt-1 text-xs text-amber-800">
                      使用次數必須是有效範圍內的整數。
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </fieldset>

        {capability &&
          (!capability.issuanceEnabled || !capability.exchangeEnabled) && (
            <p className="break-words text-sm text-amber-900" role="status">
              邀請建立需要「建立邀請」與「訪客登入」同時啟用；目前建立按鈕保持停用。
            </p>
          )}
        <div className="share-invite-submit-row">
          <span>建立後即可複製連結傳給客戶。</span>
          <Button type="submit" disabled={!canCreate}>
            <StudioIcon name="share" width={16} height={16} />
            {busy && pendingIntent === null ? '建立中…' : '建立分享連結'}
          </Button>
        </div>
      </form>

      {pendingIntent && (
        <div className="share-invite-pending mt-4 min-w-0 rounded border border-amber-300 bg-amber-50 p-4">
          <p
            className="break-words text-sm"
            data-testid="invite-uncertain-status"
            role="status"
          >
            {busy
              ? '正在確認這筆邀請結果…'
              : '建立結果尚未確認。請重試同一邀請，或查詢建立結果；請勿另建新邀請。'}
          </p>
          {error && (
            <p className="mt-2 break-words text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void sendIntent(pendingIntent)}
            >
              重試同一邀請
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void recoverIntent()}
            >
              查詢建立結果
            </Button>
          </div>
        </div>
      )}

      {message && !pendingIntent && !resolved && (
        <p className="mt-3 text-sm" role="status">
          {message}
        </p>
      )}

      {error && !pendingIntent && (
        <p className="mt-3 break-words text-sm text-red-800" role="alert">
          {error}
        </p>
      )}

      {resolved && (
        <section
          className="share-invite-result mt-4 min-w-0 rounded border border-stone-300 p-4"
          aria-label="邀請建立結果"
          data-testid={
            resolved.secretAvailable
              ? 'invite-secret-result'
              : 'invite-metadata-result'
          }
        >
          <h4 className="font-semibold">邀請建立結果</h4>
          <dl className="mt-2 grid min-w-0 gap-2 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-stone-600">邀請編號</dt>
              <dd>{displayReference(resolved.invite.inviteId, 'INV')}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-stone-600">專案編號</dt>
              <dd>{displayReference(resolved.invite.projectId, 'PRJ')}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-stone-600">建立時間</dt>
              <dd className="break-words">
                {new Date(resolved.invite.createdAt).toLocaleString('zh-TW')}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-stone-600">到期時間</dt>
              <dd className="break-words">
                {new Date(resolved.invite.expiresAt).toLocaleString('zh-TW')}
              </dd>
            </div>
          </dl>
          <p className="mt-3 break-words text-sm">
            相簿：
            {resolved.albums.map((album) => album.name).join('、') || '無'}
          </p>

          {resolved.secretAvailable ? (
            <div className="share-invite-secret mt-4 min-w-0 rounded bg-amber-50 p-3">
              <p className="break-words text-sm font-medium">
                一次性分享資料只會在這裡顯示。請立即複製並安全傳送；離開此頁或重新載入後無法再次取回。
              </p>
              {resolved.sharePassword && (
                <label className="share-password-toggle">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={includePasswordInLink}
                    onChange={(event) =>
                      setIncludePasswordInLink(event.target.checked)
                    }
                  />{' '}
                  將密碼加入分享連結
                  <span>開啟後，持有完整連結的人即可取得密碼。</span>
                </label>
              )}
              <ul className="mt-3 min-w-0 space-y-4">
                {resolved.albums.map((album, index) => (
                  <li key={album.id} className="min-w-0">
                    <p className="break-words text-sm font-medium">
                      {album.name}
                    </p>
                    <a
                      className="mt-1 block break-all text-sm underline"
                      href={
                        includePasswordInLink && resolved.sharePassword
                          ? appendGuestLinkPassword(
                              resolved.shareUrls[index] ?? '',
                              resolved.sharePassword,
                            )
                          : resolved.shareUrls[index]
                      }
                      target="_blank"
                      rel="noreferrer"
                      referrerPolicy="no-referrer"
                      data-testid={`invite-share-link-${index}`}
                    >
                      開啟此相簿訪客入口
                    </a>
                    <CopySecret
                      value={
                        includePasswordInLink && resolved.sharePassword
                          ? appendGuestLinkPassword(
                              resolved.shareUrls[index] ?? '',
                              resolved.sharePassword,
                            )
                          : (resolved.shareUrls[index] ?? '')
                      }
                      label="分享連結"
                    />
                  </li>
                ))}
              </ul>
              {resolved.accessMode === 'generated_password' &&
                resolved.generatedPassword && (
                  <div className="mt-4 min-w-0">
                    <p className="break-words text-sm font-medium">
                      系統產生的登入密碼
                    </p>
                    <code
                      className="mt-1 block break-all rounded bg-white p-2 text-sm"
                      data-testid="invite-generated-password"
                    >
                      {resolved.generatedPassword}
                    </code>
                    <CopySecret
                      value={resolved.generatedPassword}
                      label="系統密碼"
                    />
                  </div>
                )}
            </div>
          ) : (
            <div className="share-invite-secret mt-4 rounded bg-amber-50 p-3">
              <p className="break-words text-sm font-medium">
                邀請已建立，但一次性分享資料已無法取回。
              </p>
              <p className="mt-2 break-words text-sm">
                此處只顯示邀請中繼資料，沒有分享連結或密碼。若需要新的憑證，請先從邀請清單撤銷這筆邀請，再明確建立另一筆。
              </p>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={resetForAnotherInvite}
            >
              隱藏結果
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={resetForAnotherInvite}
            >
              再建立一筆邀請
            </Button>
          </div>
        </section>
      )}
    </section>
  );
}

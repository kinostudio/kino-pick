import { StudioIcon } from './studio-icons';
import { displayReference } from './display-reference';
import './share-dialog.css';
import './share-panel-refinement.css';
import { InviteCreate, type InviteShareRequest } from './invite-create';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { z } from 'zod';
import { Button } from '@kino-pic/ui';
import {
  invitePageSchema,
  revokedInviteSchema,
  type InviteSummary,
} from '../../../packages/contracts/src/invites';
import {
  guestPermissionNames,
  type GuestPermission,
} from '../../../packages/contracts/src/guest-access';

const labels: Record<GuestPermission, string> = {
  can_view: '查看',
  can_download_preview: '下載預覽',
  can_download_original: '下載原圖',
  can_select: '挑片',
  can_rate: '星等',
  can_favorite: '收藏',
  can_tag: '標籤',
  can_annotate: '註記',
  can_comment: '留言',
  can_submit: '提交',
  can_view_own_history: '自己的歷史',
  can_compare_versions: '版本比較',
};
const modes = {
  link_only: '無密碼連結',
  generated_password: '系統密碼',
  custom_password: '自訂密碼',
};
const errorCode = z.object({ error: z.object({ code: z.string() }) });

function localTime(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : new Date(time).toLocaleString('zh-TW');
}

export function InviteCard({
  invite,
  onRevoked,
  context,
}: {
  invite: InviteSummary;
  onRevoked: () => void;
  context?: ReactNode;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [observedAt] = useState(Date.now);
  const [shareToken, setShareToken] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const pending = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function viewLinks() {
    if (shareBusy) return;
    if (shareToken) {
      setShareToken('');
      setShareMessage('');
      return;
    }
    setShareBusy(true);
    setShareMessage('');
    try {
      const response = await fetch(`/api/v1/invites/${invite.id}/share-token`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('SHARE_LINK_UNAVAILABLE');
      const { token } = z
        .object({
          token: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
        })
        .parse(await response.json());
      if (!mounted.current) return;
      if (token) setShareToken(token);
      else
        setShareMessage('這是舊版連結，請使用原先保存的網址，或重新建立分享。');
    } catch {
      if (mounted.current)
        setShareMessage('目前無法取得分享連結，請重新整理後再試。');
    } finally {
      if (mounted.current) setShareBusy(false);
    }
  }
  async function revoke() {
    if (!confirmed || busy || invite.revokedAt) return;
    pending.current ??= crypto.randomUUID();
    const requestId = pending.current;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/v1/invites/${invite.id}/revoke`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, confirmRevoke: true }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok) {
        const parsed = errorCode.safeParse(body);
        const code = parsed.success ? parsed.data.error.code : '';
        setError(
          code === 'INVITE_ALREADY_REVOKED'
            ? '此邀請已被撤銷，請重新整理清單。'
            : code === 'OWNER_REQUIRED' || response.status === 401
              ? '登入已失效，請重新登入後核對清單。'
              : code === 'REQUEST_ID_CONFLICT'
                ? '操作編號衝突，請重新整理清單並核對狀態。'
                : '尚無法確認撤銷結果，請重試同一操作或重新整理清單。',
        );
        return;
      }
      const result = z.object({ revocation: revokedInviteSchema }).parse(body);
      if (result.revocation.inviteId !== invite.id)
        throw new Error('RESPONSE_SCOPE_MISMATCH');
      pending.current = null;
      onRevoked();
    } catch {
      if (mounted.current)
        setError('尚無法確認撤銷結果，請重試同一操作或重新整理清單。');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <li
      className="share-invite-list-card min-w-0 rounded-lg border border-stone-200 bg-white p-4"
      aria-label={`邀請 ${displayReference(invite.id, 'INV')}`}
    >
      {context}
      <p className="break-all text-sm font-semibold">
        {invite.clientLabel ?? `邀請 ${displayReference(invite.id, 'INV')}`}
      </p>
      <p className="mt-2 text-sm">
        {invite.revokedAt
          ? '已撤銷'
          : !invite.sealed
            ? '尚未啟用'
            : '範圍已確認'}{' '}
        · {modes[invite.accessMode]}
      </p>
      <p className="mt-2 break-words text-sm">
        到期：{localTime(invite.expiresAt)}
        {!invite.revokedAt && Date.parse(invite.expiresAt) <= observedAt
          ? '（已到期）'
          : ''}
      </p>
      <p className="mt-2 text-sm">
        已建立訪客登入 {invite.issuedSessions} 次
        {invite.maxUses === null ? '' : `／上限 ${invite.maxUses} 次`}
      </p>
      <p className="mt-2 break-words text-sm">
        相簿：{invite.albums.map((a) => a.name).join('、') || '尚無授權相簿'}
      </p>
      <p className="mt-2 break-words text-sm">
        允許：
        {guestPermissionNames
          .filter((name) => invite.permissions[name])
          .map((name) => labels[name])
          .join('、') || '無'}
      </p>
      {invite.sealed &&
        !invite.revokedAt &&
        Date.parse(invite.expiresAt) > observedAt && (
          <div className="mt-3">
            <Button
              variant="outline"
              aria-expanded={Boolean(shareToken)}
              disabled={shareBusy}
              onClick={() => void viewLinks()}
            >
              <StudioIcon name="share" width={16} height={16} />
              {shareToken ? '收起連結' : '檢視連結'}
            </Button>
            {shareToken &&
              invite.albums.map((album) => {
                const url = `${window.location.origin}/guest/albums/${album.id}/enter#token=${shareToken}`;
                return (
                  <div
                    key={album.id}
                    className="mt-2 flex flex-wrap items-center gap-2"
                  >
                    <input
                      className="min-w-0 flex-1 text-sm"
                      aria-label={`${album.name} 的分享連結`}
                      value={url}
                      readOnly
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        void navigator.clipboard.writeText(url).then(
                          () => setShareMessage('已複製連結'),
                          () => setShareMessage('請選取網址後手動複製。'),
                        );
                      }}
                    >
                      複製
                    </Button>
                  </div>
                );
              })}
            {shareMessage && (
              <p className="mt-2 text-sm" role="status">
                {shareMessage}
              </p>
            )}
          </div>
        )}
      {invite.revokedAt ? (
        <p className="mt-3 break-words text-sm" role="status">
          撤銷時間：{localTime(invite.revokedAt)}
        </p>
      ) : (
        <div className="mt-4">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            我確認撤銷此邀請，停止所有持此邀請的訪客存取
          </label>
          <Button
            className="mt-3"
            variant="outline"
            disabled={!confirmed || busy}
            onClick={() => void revoke()}
          >
            {busy ? '撤銷中…' : '撤銷邀請'}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </li>
  );
}

export function ProjectInvites({
  projectId,
  shareRequest,
  compact = false,
}: {
  compact?: boolean;
  projectId: string;
  shareRequest: InviteShareRequest | null;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const inviteDialogRef = useRef<HTMLDialogElement | null>(null);
  const inviteBusyRef = useRef(false);
  const handledShareSequence = useRef<number | null>(null);
  const [opened, setOpened] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [listRevision, setListRevision] = useState(0);
  useEffect(() => {
    if (!shareRequest || handledShareSequence.current === shareRequest.sequence)
      return;
    handledShareSequence.current = shareRequest.sequence;
    setHasOpened(true);
    setOpened(true);
    setInviteDialogOpen(true);
    window.requestAnimationFrame(
      () =>
        !compact &&
        sectionRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        }),
    );
  }, [shareRequest, compact]);
  useEffect(() => {
    const dialog = inviteDialogRef.current;
    if (!dialog) return;
    if (inviteDialogOpen && !dialog.open) dialog.showModal();
    if (!inviteDialogOpen && dialog.open) dialog.close();
  }, [hasOpened, inviteDialogOpen]);
  return (
    <section
      ref={sectionRef}
      className={
        compact
          ? 'share-invite-management is-compact'
          : 'share-invite-management mt-10 rounded-lg border border-stone-200 p-5'
      }
      aria-label="客戶邀請管理"
      data-testid="project-invites"
    >
      {!compact && (
        <>
          <h2 className="text-lg font-semibold">分享管理</h2>
          <p className="mt-2 text-sm text-stone-600">
            查看授權範圍並撤銷存取。撤銷不會刪除照片或歷史，且無法還原。
          </p>
          <div
            className="share-invite-launcher"
            data-testid="invite-create-launcher"
          >
            <Button
              variant="outline"
              onClick={() => {
                setHasOpened(true);
                setOpened((v) => !v);
              }}
            >
              {opened ? '收起客戶邀請' : '查看客戶邀請'}
            </Button>
            <Button
              onClick={() => {
                setHasOpened(true);
                setOpened(true);
                setInviteDialogOpen(true);
              }}
            >
              建立邀請
            </Button>
          </div>
        </>
      )}
      {hasOpened && (
        <dialog
          ref={inviteDialogRef}
          className="share-invite-dialog"
          aria-label="建立客戶邀請"
          data-testid="invite-create-dialog"
          onCancel={(event) => {
            if (inviteBusyRef.current) event.preventDefault();
          }}
          onClose={() => {
            if (!inviteBusyRef.current) setInviteDialogOpen(false);
          }}
        >
          <InviteCreate
            key={projectId}
            projectId={projectId}
            shareRequest={shareRequest}
            onClose={() => {
              if (!inviteBusyRef.current) setInviteDialogOpen(false);
            }}
            onBusyChange={(busy) => {
              inviteBusyRef.current = busy;
            }}
            onCreated={() => {
              setOpened(true);
              setListRevision((value) => value + 1);
            }}
          />
        </dialog>
      )}
      {!compact && opened && (
        <InviteList
          key={`${projectId}:${listRevision}`}
          projectId={projectId}
        />
      )}
    </section>
  );
}
function InviteList({ projectId }: { projectId: string }) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<z.infer<typeof invitePageSchema> | null>(
    null,
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    void fetch(
      `/api/v1/projects/${projectId}/invites${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`,
      { credentials: 'same-origin', cache: 'no-store', signal: abort.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('UNAVAILABLE');
        const body: unknown = await response.json();
        const parsed = invitePageSchema.parse(body);
        if (!abort.signal.aborted) {
          setPage(parsed);
          setError('');
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setPage(null);
          setError('目前無法載入邀請，請確認登入狀態後重試。');
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [projectId, cursor, revision]);
  function refresh(next?: string) {
    setLoading(true);
    setError('');
    setPage(null);
    setCursor(next);
    setRevision((v) => v + 1);
  }
  return (
    <div className="mt-4">
      <Button variant="outline" disabled={loading} onClick={() => refresh()}>
        重新整理邀請
      </Button>
      {loading ? (
        <p role="status" className="mt-3">
          載入邀請中…
        </p>
      ) : error ? (
        <p role="alert" className="mt-3">
          {error}
        </p>
      ) : (
        page && (
          <>
            {page.invites.length === 0 ? (
              <p className="mt-3 text-sm">此頁尚無邀請。</p>
            ) : (
              <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                {page.invites.map((invite) => (
                  <InviteCard
                    key={invite.id}
                    invite={invite}
                    onRevoked={() => refresh()}
                  />
                ))}
              </ul>
            )}
            {page.nextCursor && (
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => refresh(page.nextCursor ?? undefined)}
              >
                下一頁邀請
              </Button>
            )}
            {cursor && (
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => refresh()}
              >
                返回第一頁邀請
              </Button>
            )}
          </>
        )
      )}
    </div>
  );
}

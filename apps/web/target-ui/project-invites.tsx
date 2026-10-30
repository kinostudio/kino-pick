import { InviteCreate, type InviteShareRequest } from './invite-create';
import { useEffect, useRef, useState } from 'react';
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

function InviteCard({
  invite,
  onRevoked,
}: {
  invite: InviteSummary;
  onRevoked: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
      className="min-w-0 rounded-lg border border-stone-200 bg-white p-4"
      aria-label={`邀請 ${invite.id}`}
    >
      <p className="break-all text-sm font-semibold">邀請 {invite.id}</p>
      <p className="mt-2 text-sm">
        {invite.revokedAt
          ? '已撤銷'
          : !invite.sealed
            ? '尚未啟用'
            : '範圍已確認'}{' '}
        · {modes[invite.accessMode]}
      </p>
      <p className="mt-2 break-words text-sm">
        到期（UTC）：{invite.expiresAt}
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
      {invite.revokedAt ? (
        <p className="mt-3 break-words text-sm" role="status">
          撤銷時間（UTC）：{invite.revokedAt}
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
}: {
  projectId: string;
  shareRequest: InviteShareRequest | null;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const handledShareSequence = useRef<number | null>(null);
  const [opened, setOpened] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [listRevision, setListRevision] = useState(0);
  useEffect(() => {
    if (!shareRequest || handledShareSequence.current === shareRequest.sequence)
      return;
    handledShareSequence.current = shareRequest.sequence;
    setHasOpened(true);
    setOpened(true);
    window.requestAnimationFrame(() =>
      sectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      }),
    );
  }, [shareRequest]);
  return (
    <section
      ref={sectionRef}
      className="mt-10 rounded-lg border border-stone-200 p-5"
      aria-label="客戶邀請管理"
      data-testid="project-invites"
    >
      <h2 className="text-lg font-semibold">客戶邀請</h2>
      <p className="mt-2 text-sm text-stone-600">
        查看授權範圍並撤銷存取。撤銷不會刪除照片或歷史，且無法還原。
      </p>
      <Button
        className="mt-3"
        variant="outline"
        onClick={() => {
          setHasOpened(true);
          setOpened((v) => !v);
        }}
      >
        {opened ? '收起客戶邀請' : '查看客戶邀請'}
      </Button>
      {hasOpened && (
        <div hidden={!opened}>
          <InviteCreate
            key={projectId}
            projectId={projectId}
            shareRequest={shareRequest}
            onCreated={() => {
              setOpened(true);
              setListRevision((value) => value + 1);
            }}
          />
        </div>
      )}
      {opened && (
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

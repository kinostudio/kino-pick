import { useEffect, useState } from 'react';
import { z } from 'zod';
import { Button } from '@kino-pic/ui';
import { inviteSummarySchema } from '../../../packages/contracts/src/invites';
import { InviteCard } from './project-invites';

const pageSchema = z
  .object({
    invites: z.array(
      inviteSummarySchema.extend({ projectName: z.string() }).strict(),
    ),
    nextCursor: z.string().nullable(),
  })
  .strict();
type Page = z.infer<typeof pageSchema>;

/**
 * Every share link in the workspace, across projects. Links are still
 * created from an album's 分享相簿; this page is for checking and revoking.
 */
export function ShareLinksOverview({ workspaceId }: { workspaceId: string }) {
  const [scope, setScope] = useState<'active' | 'all'>('active');
  const [cursors, setCursors] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; page: Page }
  >({ status: 'loading' });
  const cursor = cursors.at(-1);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ scope });
    if (cursor) query.set('cursor', cursor);
    void fetch(
      '/api/v1/workspaces/' +
        encodeURIComponent(workspaceId) +
        '/invites?' +
        query.toString(),
      {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error('SHARE_LINKS_UNAVAILABLE');
        const page = pageSchema.parse(await response.json());
        if (!controller.signal.aborted) setState({ status: 'ready', page });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, [workspaceId, scope, cursor, reload]);

  function changeScope(next: 'active' | 'all') {
    if (next === scope) return;
    setScope(next);
    setCursors([]);
    setState({ status: 'loading' });
  }

  return (
    <section className="share-links-overview" aria-label="分享連結總覽">
      <div className="share-links-overview__head">
        <div>
          <h2>分享連結</h2>
          <p>
            這裡列出所有專案的分享連結，可確認到期與使用次數並撤銷；新的連結請在相簿的「分享相簿」建立。
          </p>
        </div>
        <div
          className="share-links-overview__scope"
          role="group"
          aria-label="顯示範圍"
        >
          <Button
            type="button"
            variant={scope === 'active' ? 'default' : 'outline'}
            aria-pressed={scope === 'active'}
            onClick={() => changeScope('active')}
          >
            有效中
          </Button>
          <Button
            type="button"
            variant={scope === 'all' ? 'default' : 'outline'}
            aria-pressed={scope === 'all'}
            onClick={() => changeScope('all')}
          >
            全部（含已撤銷、到期）
          </Button>
        </div>
      </div>
      {state.status === 'loading' && <p role="status">正在讀取分享連結…</p>}
      {state.status === 'error' && (
        <p role="alert">
          分享連結暫時無法載入。
          <button type="button" onClick={() => setReload((v) => v + 1)}>
            重試
          </button>
        </p>
      )}
      {state.status === 'ready' && state.page.invites.length === 0 && (
        <p className="share-links-overview__empty">
          {scope === 'active'
            ? '目前沒有有效的分享連結。'
            : '這個工作空間還沒有分享連結。'}
        </p>
      )}
      {state.status === 'ready' && state.page.invites.length > 0 && (
        <ul className="share-links-overview__list">
          {state.page.invites.map((invite) => (
            <InviteCard
              key={invite.id}
              invite={invite}
              onRevoked={() => setReload((v) => v + 1)}
              context={
                <p className="share-links-overview__context">
                  <a href={'/dashboard/projects/' + invite.projectId}>
                    {invite.projectName}
                  </a>
                  {invite.albums.map((album) => (
                    <a
                      key={album.id}
                      href={
                        '/dashboard/projects/' +
                        invite.projectId +
                        '?albumId=' +
                        album.id
                      }
                    >
                      {album.name}
                    </a>
                  ))}
                </p>
              }
            />
          ))}
        </ul>
      )}
      {state.status === 'ready' &&
        (cursors.length > 0 || state.page.nextCursor) && (
          <div className="share-links-overview__pager">
            <Button
              type="button"
              variant="outline"
              disabled={cursors.length === 0}
              onClick={() => {
                setCursors([]);
                setState({ status: 'loading' });
              }}
            >
              第一頁
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!state.page.nextCursor}
              onClick={() => {
                const next = state.page.nextCursor;
                if (!next) return;
                setCursors((list) => [...list, next]);
                setState({ status: 'loading' });
              }}
            >
              下一頁
            </Button>
          </div>
        )}
    </section>
  );
}

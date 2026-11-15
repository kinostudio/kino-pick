import { useState } from 'react';
import { z } from 'zod';
import { StudioIcon } from './studio-icons';

const LAST_WORKSPACE_KEY = 'kino-pick:last-workspace';

/** Remembers the workspace the Owner last used (per browser, best effort). */
export function rememberWorkspace(workspaceId: string | undefined) {
  if (!workspaceId) return;
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
  } catch {
    // Storage can be unavailable (privacy mode); navigation still works.
  }
}

export function lastWorkspace(): string | null {
  try {
    const value = window.localStorage.getItem(LAST_WORKSPACE_KEY);
    return value && z.uuid().safeParse(value).success ? value : null;
  } catch {
    return null;
  }
}

const listSchema = z.object({
  workspaces: z.array(
    z.object({ id: z.string().min(1), name: z.string() }).loose(),
  ),
  nextCursor: z.string().nullable(),
});

type Listed = z.infer<typeof listSchema>['workspaces'][number];

/**
 * Sidebar workspace switcher. The list loads only when opened, so ordinary
 * page loads make no extra request.
 */
export function WorkspaceSwitcher({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string | undefined;
  workspaceName: string | undefined;
}) {
  const [list, setList] = useState<Listed[] | null>(null);
  const [more, setMore] = useState(false);
  const [failed, setFailed] = useState(false);
  function load() {
    if (list || failed) return;
    void fetch('/api/v1/workspaces', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('WORKSPACES_UNAVAILABLE');
        const parsed = listSchema.parse(await response.json());
        setList(parsed.workspaces);
        setMore(parsed.nextCursor !== null);
      })
      .catch(() => setFailed(true));
  }
  return (
    <details
      className="studio-workspace-switcher"
      onToggle={(event) => {
        if (event.currentTarget.open) load();
      }}
    >
      <summary className="studio-workspace-label">
        <div className="studio-workspace-mark">
          <StudioIcon name="projects" />
        </div>
        <span>
          <b title={workspaceName}>{workspaceName ?? '載入工作區…'}</b>
          <small>切換工作空間</small>
        </span>
        <span className="studio-workspace-caret" aria-hidden="true">
          ▾
        </span>
      </summary>
      <div className="studio-workspace-menu">
        {list === null && !failed && <p>載入工作空間…</p>}
        {failed && <p>工作空間清單暫時無法載入</p>}
        {list?.map((workspace) => (
          <a
            key={workspace.id}
            href={'/dashboard/workspaces/' + workspace.id}
            aria-current={workspace.id === workspaceId ? 'true' : undefined}
            onClick={() => rememberWorkspace(workspace.id)}
          >
            {workspace.name}
          </a>
        ))}
        <a className="studio-workspace-all" href="/dashboard?all=1">
          {more ? '查看全部工作空間…' : '所有工作空間／新增'}
        </a>
      </div>
    </details>
  );
}

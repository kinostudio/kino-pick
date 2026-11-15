'use client';

import { useEffect, useState } from 'react';
import {
  projectSchema,
  workspaceSchema,
  type Project,
  type Workspace,
} from '@kino-pic/contracts';
import { z } from 'zod';
import { ImageProcessingPolicy } from './ImageProcessingPolicy';
import { RetentionPreview } from './RetentionPreview';
import { OracleStorageSettings } from './OracleStorageSettings';
import { OwnerWorkspaceHistory } from './owner-history';
import { ShareLinksOverview } from './share-links-overview';
import './studio-pages.css';

export type StudioWorkspaceSection = 'history' | 'settings' | 'invites';

type ProjectsPage = {
  workspace: Workspace;
  projects: Project[];
  nextCursor: string | null;
};

type ResourceState =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error'; statusCode: number; code: string }
  | { key: string; status: 'ready'; value: ProjectsPage };

const cursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);

const projectsPageSchema = z.object({
  workspace: workspaceSchema,
  projects: z.array(projectSchema).max(24),
  nextCursor: cursorSchema.nullable(),
});

const apiErrorSchema = z.object({
  error: z.object({ code: z.string().min(1) }),
});

const sectionContent: Record<
  StudioWorkspaceSection,
  { label: string; eyebrow: string; description: string }
> = {
  settings: {
    label: '照片處理設定',
    eyebrow: 'WORKSPACE / PROCESSING',
    description: '選擇縮圖處理方式，管理照片可用空間。',
  },
  history: {
    label: '活動歷程',
    eyebrow: 'WORKSPACE / ACTIVITY',
    description: '依工作空間檢視管理者與訪客留下的實際操作紀錄。',
  },
  invites: {
    label: '分享連結',
    eyebrow: 'WORKSPACE / SHARE LINKS',
    description: '所有專案的客戶分享連結：確認到期、使用次數，必要時撤銷。',
  },
};

function sectionHref(
  workspaceId: string,
  section: StudioWorkspaceSection,
  cursor?: string,
) {
  const path =
    '/dashboard/workspaces/' + encodeURIComponent(workspaceId) + '/' + section;
  return cursor ? path + '?cursor=' + encodeURIComponent(cursor) : path;
}

function describeFailure(statusCode: number, code: string) {
  if (statusCode === 401 || statusCode === 403 || code === 'OWNER_REQUIRED')
    return '登入已失效或帳號目前無權查看此工作空間，請重新登入後再試。';
  if (statusCode === 404 || code === 'NOT_FOUND')
    return '找不到此工作空間，或目前帳號無權存取。';
  if (statusCode === 400)
    return '頁面游標或工作空間資料無效，請返回第一頁後重試。';
  return '目前無法載入工作空間與專案資料，請稍後重新整理。';
}

function ProjectsLoadError({
  statusCode,
  code,
  onRetry,
  firstPageHref,
}: {
  statusCode: number;
  code: string;
  onRetry: () => void;
  firstPageHref: string;
}) {
  return (
    <section className="studio-pages__notice" role="alert">
      <div>
        <h2>資料暫時無法載入</h2>
        <p>{describeFailure(statusCode, code)}</p>
      </div>
      <div className="studio-pages__notice-actions">
        <button
          className="studio-pages__button"
          type="button"
          onClick={onRetry}
        >
          重新載入
        </button>
        <a className="studio-pages__text-link" href={firstPageHref}>
          返回第一頁
        </a>
      </div>
    </section>
  );
}

export function StudioWorkspacePage({
  workspaceId,
  actorId,
  section,
}: {
  workspaceId: string;
  actorId: string;
  section: StudioWorkspaceSection;
}) {
  const [retry, setRetry] = useState(0);
  const [resource, setResource] = useState<ResourceState>({
    key: '',
    status: 'loading',
  });

  const workspaceIsValid = z.uuid().safeParse(workspaceId).success;
  const ownerIsValid = z.uuid().safeParse(actorId).success;
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const cursorValue = new URLSearchParams(search).get('cursor');
  const cursorIsValid =
    cursorValue === null || cursorSchema.safeParse(cursorValue).success;
  const cursor = cursorValue ?? undefined;
  const resourceKey = workspaceId + ':' + (cursor ?? '') + ':' + retry;
  const firstPageHref = sectionHref(workspaceId, section);

  useEffect(() => {
    if (
      !workspaceIsValid ||
      !cursorIsValid ||
      (section === 'history' && !ownerIsValid)
    )
      return;

    const controller = new AbortController();

    const query = new URLSearchParams({ workspaceId });
    if (cursor) query.set('cursor', cursor);

    void fetch('/api/v1/projects?' + query.toString(), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const parsedError = apiErrorSchema.safeParse(body);
          throw {
            statusCode: response.status,
            code: parsedError.success
              ? parsedError.data.error.code
              : 'SERVICE_UNAVAILABLE',
          };
        }

        const parsed = projectsPageSchema.safeParse(body);
        const page = parsed.success ? parsed.data : null;
        const ids = new Set(page?.projects.map((project) => project.id) ?? []);
        if (
          !page ||
          page.workspace.id !== workspaceId ||
          page.projects.some(
            (project) => project.workspaceId !== workspaceId,
          ) ||
          ids.size !== page.projects.length ||
          (cursor !== undefined && page.nextCursor === cursor)
        )
          throw {
            statusCode: 503,
            code: 'PROJECT_PAGE_INVALID',
          };

        if (!controller.signal.aborted)
          setResource({ key: resourceKey, status: 'ready', value: page });
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        const details =
          typeof failure === 'object' &&
          failure !== null &&
          'statusCode' in failure &&
          typeof failure.statusCode === 'number' &&
          'code' in failure &&
          typeof failure.code === 'string'
            ? { statusCode: failure.statusCode, code: failure.code }
            : { statusCode: 503, code: 'SERVICE_UNAVAILABLE' };
        setResource({
          key: resourceKey,
          status: 'error',
          statusCode: details.statusCode,
          code: details.code,
        });
      });

    return () => controller.abort();
  }, [
    actorId,
    cursor,
    cursorIsValid,
    ownerIsValid,
    resourceKey,
    retry,
    section,
    workspaceId,
    workspaceIsValid,
  ]);

  if (!workspaceIsValid) {
    return (
      <main className="studio-page studio-pages">
        <section className="studio-pages__notice" role="alert">
          <h1>工作空間識別碼無效</h1>
          <a className="studio-pages__text-link" href="/dashboard">
            返回工作台
          </a>
        </section>
      </main>
    );
  }

  if (section === 'history' && !ownerIsValid) {
    return (
      <main className="studio-page studio-pages">
        <section className="studio-pages__notice" role="alert">
          <h1>無法確認管理者身分</h1>
          <p>請重新登入後再查看工作空間歷程。</p>
          <a className="studio-pages__text-link" href="/dashboard">
            返回工作台
          </a>
        </section>
      </main>
    );
  }

  if (!cursorIsValid) {
    return (
      <main className="studio-page studio-pages">
        <section className="studio-pages__notice" role="alert">
          <h1>專案頁面游標無效</h1>
          <p>請返回第一頁後重新載入。</p>
          <a className="studio-pages__text-link" href={firstPageHref}>
            返回第一頁
          </a>
        </section>
      </main>
    );
  }

  const currentResource: ResourceState =
    resource.key === resourceKey
      ? resource
      : { key: resourceKey, status: 'loading' };

  if (currentResource.status === 'loading') {
    return (
      <main className="studio-page studio-pages" aria-busy="true" role="status">
        <p className="studio-pages__loading">
          正在讀取授權工作區與目前頁面的專案…
        </p>
      </main>
    );
  }

  if (currentResource.status === 'error') {
    return (
      <main className="studio-page studio-pages">
        <ProjectsLoadError
          statusCode={currentResource.statusCode}
          code={currentResource.code}
          onRetry={() => setRetry((value) => value + 1)}
          firstPageHref={firstPageHref}
        />
      </main>
    );
  }

  const { workspace, projects } = currentResource.value;
  const content = sectionContent[section];

  return (
    <main className="studio-page studio-pages">
      <nav className="studio-pages__breadcrumb" aria-label="階層導覽">
        <a href="/dashboard?all=1">所有工作空間</a>
        <span aria-hidden="true">/</span>
        <a href={'/dashboard/workspaces/' + encodeURIComponent(workspace.id)}>
          {workspace.name}
        </a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{content.label}</span>
      </nav>

      <header className="studio-pages__header">
        <div className="studio-pages__heading">
          <p className="studio-pages__eyebrow">{content.eyebrow}</p>
          <h1>{content.label}</h1>
          <p>{content.description}</p>
        </div>
        <div className="studio-pages__stat" aria-label="目前頁面的專案數">
          <span>目前頁面</span>
          <strong>{projects.length}</strong>
          <small>個專案</small>
        </div>
      </header>

      <nav className="studio-pages__tabs" aria-label="工作空間管理">
        {(['settings', 'history', 'invites'] as const).map((item) => (
          <a
            key={item}
            href={sectionHref(workspace.id, item, cursor)}
            aria-current={section === item ? 'page' : undefined}
          >
            {sectionContent[item].label}
          </a>
        ))}
      </nav>

      <div
        className={
          'studio-pages__layout' +
          (section === 'history' || section === 'invites'
            ? ' studio-pages__layout--history'
            : section === 'settings'
              ? ' studio-pages__layout--settings'
              : '')
        }
      >
        <section className="studio-pages__main" aria-label={content.label}>
          {section === 'settings' && (
            <div className="studio-pages__module">
              <ImageProcessingPolicy workspaceId={workspace.id} />
              <RetentionPreview workspaceId={workspace.id} />
              <OracleStorageSettings />
            </div>
          )}

          {section === 'history' && (
            <div className="studio-pages__module">
              <OwnerWorkspaceHistory
                key={workspace.id + ':' + actorId}
                workspaceId={workspace.id}
                ownerId={actorId}
              />
            </div>
          )}

          {section === 'invites' && (
            <div className="studio-pages__module studio-pages__invite-module">
              <ShareLinksOverview workspaceId={workspace.id} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

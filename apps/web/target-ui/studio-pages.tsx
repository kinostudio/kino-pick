'use client';

import { useEffect, useId, useState } from 'react';
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
import { ProjectInvites } from './project-invites';
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
    label: '客戶邀請',
    eyebrow: 'WORKSPACE / INVITES',
    description: '選擇本頁的一個專案，檢視該專案的邀請並管理其存取。',
  },
};

const projectStatusLabels: Record<Project['status'], string> = {
  draft: '草稿',
  uploading: '上傳中',
  selecting: '挑片中',
  submitted: '已提交',
  retouching: '修圖中',
  reviewing: '審閱中',
  approved: '已核准',
  delivered: '已交付',
  archived: '已封存',
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

function projectHref(projectId: string) {
  return '/dashboard/projects/' + encodeURIComponent(projectId);
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

function ProjectDirectory({
  workspaceId,
  section,
  projects,
  cursor,
  nextCursor,
}: {
  workspaceId: string;
  section: StudioWorkspaceSection;
  projects: Project[];
  cursor: string | undefined;
  nextCursor: string | null;
}) {
  return (
    <aside className="studio-pages__rail" aria-label="專案導覽">
      <section className="studio-pages__rail-card">
        <div className="studio-pages__rail-heading">
          <div>
            <p className="studio-pages__rail-eyebrow">PROJECTS</p>
            <h2>專案捷徑</h2>
          </div>
          <span className="studio-pages__page-count">{projects.length}</span>
        </div>
        <p className="studio-pages__rail-copy">
          顯示目前載入頁面的專案；翻頁後可查看下一批。
        </p>
        {projects.length ? (
          <nav aria-label="目前頁面專案">
            <ul className="studio-pages__project-list">
              {projects.map((project) => (
                <li key={project.id}>
                  <a
                    className="studio-pages__project-link"
                    href={projectHref(project.id)}
                  >
                    <span className="studio-pages__project-name">
                      {project.name}
                    </span>
                    <span className="studio-pages__project-status">
                      {projectStatusLabels[project.status]}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : (
          <p className="studio-pages__empty">
            {cursor
              ? '本頁沒有專案，請返回第一頁或載入下一頁。'
              : '此工作空間目前沒有專案。'}
          </p>
        )}
        <nav className="studio-pages__pagination" aria-label="專案清單分頁">
          {cursor && <a href={sectionHref(workspaceId, section)}>返回第一頁</a>}
          {nextCursor && (
            <a href={sectionHref(workspaceId, section, nextCursor)}>
              下一頁專案
            </a>
          )}
        </nav>
      </section>
    </aside>
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
  const selectId = useId();
  const [retry, setRetry] = useState(0);
  const [selectedProjectId, setSelectedProjectId] = useState('');
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

  const { workspace, projects, nextCursor } = currentResource.value;
  const content = sectionContent[section];
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ??
    projects[0] ??
    null;

  return (
    <main className="studio-page studio-pages">
      <nav className="studio-pages__breadcrumb" aria-label="階層導覽">
        <a href="/dashboard">攝影工作台</a>
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
          (section === 'history'
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
              {projects.length === 0 ? (
                <section className="studio-pages__empty-card">
                  <h2>此頁沒有可管理的專案</h2>
                  <p>
                    邀請清單依專案載入。返回第一頁或查看下一頁後，再選擇一個專案。
                  </p>
                </section>
              ) : (
                <>
                  <label
                    className="studio-pages__select-label"
                    htmlFor={selectId}
                  >
                    <span>選擇要管理邀請的專案</span>
                    <select
                      id={selectId}
                      value={selectedProject?.id ?? ''}
                      onChange={(event) =>
                        setSelectedProjectId(event.target.value)
                      }
                    >
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selectedProject && (
                    <ProjectInvites
                      key={selectedProject.id}
                      projectId={selectedProject.id}
                      shareRequest={null}
                    />
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {section === 'invites' && (
          <ProjectDirectory
            workspaceId={workspace.id}
            section={section}
            projects={projects}
            cursor={cursor}
            nextCursor={nextCursor}
          />
        )}
      </div>
    </main>
  );
}

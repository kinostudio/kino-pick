import { useState, type ReactNode } from 'react';
import { KinoLogo } from './kino-logo';
import { StudioIcon, type StudioIconName } from './studio-icons';
import { OwnerDeliveryNotifications } from './delivery-notifications';
import './sidebar-stability.css';

const workspaceNavItems = [
  { icon: 'projects', label: '專案', suffix: '', section: null },
  {
    icon: 'invites',
    label: '客戶邀請',
    suffix: '/invites',
    section: 'invites',
  },
  {
    icon: 'history',
    label: '活動歷史',
    suffix: '/history',
    section: 'history',
  },
  {
    icon: 'settings',
    label: '處理設定',
    suffix: '/settings',
    section: 'settings',
  },
] as const satisfies readonly {
  icon: StudioIconName;
  label: string;
  suffix: string;
  section: string | null;
}[];

export function StudioShell({
  children,
  workspaceId,
  workspaceName,
  accountLabel = '管理員',
  signingOut,
  onSignOut,
}: {
  children: ReactNode;
  workspaceId?: string | undefined;
  workspaceName?: string | undefined;
  accountLabel?: string | undefined;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const inProject = window.location.pathname.startsWith('/dashboard/projects/');
  const inWorkspace = window.location.pathname.startsWith(
    '/dashboard/workspaces/',
  );
  const workspaceRoot = workspaceId
    ? '/dashboard/workspaces/' + workspaceId
    : null;
  const currentSection = window.location.pathname.split('/')[4];
  return (
    <div className="studio-shell">
      <aside
        className={'studio-sidebar' + (menuOpen ? ' is-open' : '')}
        aria-label="工作台導覽"
      >
        <a
          className="studio-brand"
          href="/dashboard"
          aria-label="Kino Pick 奇諾選圖"
        >
          <KinoLogo className="studio-brand-logo" />
          <span>
            <b>Kino Pick</b>
            <small>奇諾選圖</small>
          </span>
        </a>
        <div className="studio-workspace-label">
          <div className="studio-workspace-mark">
            <StudioIcon name="projects" />
          </div>
          <span>
            <b title={workspaceName}>{workspaceName ?? '載入工作區…'}</b>
            <small>工作空間</small>
          </span>
        </div>
        <p className="studio-nav-label">工作空間</p>
        <nav>
          <a
            href="/dashboard"
            aria-current={
              window.location.pathname === '/dashboard' ||
              window.location.pathname === '/'
                ? 'page'
                : undefined
            }
          >
            <StudioIcon name="home" />
            <span className="studio-nav-text">工作台</span>
          </a>
          {workspaceNavItems.map(({ icon, label, suffix, section }) => {
            const isCurrent = section
              ? currentSection === section
              : (inWorkspace && !currentSection) || inProject;
            const content = (
              <>
                <StudioIcon name={icon} />
                <span className="studio-nav-text">{label}</span>
              </>
            );
            return workspaceRoot ? (
              <a
                key={label}
                href={workspaceRoot + suffix}
                aria-current={isCurrent ? 'page' : undefined}
              >
                {content}
              </a>
            ) : (
              <span
                key={label}
                className="studio-nav-placeholder"
                role="link"
                aria-disabled="true"
                aria-current={isCurrent ? 'page' : undefined}
                aria-label={label + '，工作空間資訊就緒後可用'}
              >
                {content}
                <small aria-hidden="true" className="studio-nav-status">
                  載入中
                </small>
              </span>
            );
          })}
          <a
            href="/dashboard/account"
            aria-current={
              window.location.pathname === '/dashboard/account'
                ? 'page'
                : undefined
            }
          >
            <StudioIcon name="account" />
            <span className="studio-nav-text">帳號</span>
          </a>
        </nav>
        <div className="studio-sidebar-footer">
          <div className="studio-profile">
            <div>
              <b>{accountLabel}</b>
              <small>帳號</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="studio-content">
        <header className="studio-topbar">
          <div className="studio-topbar-path">
            <button
              type="button"
              className="studio-menu"
              aria-label="切換工作台選單"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <StudioIcon name="menu" />
            </button>
            <a href="/dashboard">工作台</a>
            <span>/</span>
            <span>
              {window.location.pathname === '/dashboard/account'
                ? '帳號'
                : currentSection === 'history'
                  ? '活動歷史'
                  : currentSection === 'settings'
                    ? '處理設定'
                    : currentSection === 'invites'
                      ? '客戶邀請'
                      : inProject
                        ? '專案相簿'
                        : inWorkspace
                          ? '專案'
                          : '總覽'}
            </span>
          </div>
          <div className="studio-topbar-actions">
            {workspaceId && (
              <OwnerDeliveryNotifications workspaceId={workspaceId} />
            )}
            <span className="studio-private-badge">管理工作台</span>
            <button type="button" disabled={signingOut} onClick={onSignOut}>
              <StudioIcon name="logout" width={16} height={16} />
              {signingOut ? '登出中…' : '登出'}
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

import { useState, type ReactNode } from 'react';
import { KinoLogo } from './kino-logo';

export function StudioShell({
  children,
  workspaceId,
  signingOut,
  onSignOut,
}: {
  children: ReactNode;
  workspaceId?: string | undefined;
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
        <a className="studio-brand" href="/dashboard">
          <KinoLogo dark className="studio-brand-logo" />
          <span>
            <b>KINO</b>
            <small>PICK STUDIO</small>
          </span>
        </a>
        <div className="studio-workspace-label">
          <KinoLogo dark className="studio-workspace-logo" />
          <span>
            <b>攝影工作空間</b>
            <small>私人作品與協作</small>
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
            <span aria-hidden="true">⌂</span>工作台
          </a>
          {workspaceRoot && (
            <>
              <a
                href={workspaceRoot}
                aria-current={
                  inWorkspace && !currentSection ? 'page' : undefined
                }
              >
                <span aria-hidden="true">▦</span>專案
              </a>
              <a
                href={workspaceRoot + '/invites'}
                aria-current={currentSection === 'invites' ? 'page' : undefined}
              >
                <span aria-hidden="true">◇</span>客戶邀請
              </a>
              <a
                href={workspaceRoot + '/history'}
                aria-current={currentSection === 'history' ? 'page' : undefined}
              >
                <span aria-hidden="true">◷</span>活動歷史
              </a>
              <a
                href={workspaceRoot + '/settings'}
                aria-current={
                  currentSection === 'settings' ? 'page' : undefined
                }
              >
                <span aria-hidden="true">⚙</span>處理設定
              </a>
            </>
          )}
          <a
            href="/dashboard/account"
            aria-current={
              window.location.pathname === '/dashboard/account'
                ? 'page'
                : undefined
            }
          >
            <span aria-hidden="true">◉</span>帳號
          </a>
        </nav>
        <div className="studio-sidebar-footer">
          <span className="studio-privacy-dot" /> 私人儲存・授權存取
          <div className="studio-profile">
            <KinoLogo dark className="studio-profile-logo" />
            <div>
              <b>Kino Pick</b>
              <small>攝影師管理介面</small>
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
              ☰
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
            <span className="studio-private-badge">授權管理者</span>
            <button type="button" disabled={signingOut} onClick={onSignOut}>
              {signingOut ? '登出中…' : '登出'}
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

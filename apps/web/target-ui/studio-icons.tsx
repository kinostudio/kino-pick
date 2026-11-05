import type { ReactNode, SVGProps } from 'react';

export type StudioIconName =
  | 'home'
  | 'list'
  | 'refresh'
  | 'copy'
  | 'projects'
  | 'invites'
  | 'history'
  | 'settings'
  | 'account'
  | 'menu'
  | 'share'
  | 'upload'
  | 'check'
  | 'image'
  | 'chevronDown'
  | 'close'
  | 'logout'
  | 'tag'
  | 'eye';

export function StudioIcon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: StudioIconName }) {
  let shape: ReactNode;
  switch (name) {
    case 'tag':
      shape = (
        <>
          <path d="M3 3h7l11 11-7 7L3 10Z" />
          <circle cx="7" cy="7" r="1" />
        </>
      );
      break;
    case 'list':
      shape = (
        <>
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="3" cy="6" r=".5" />
          <circle cx="3" cy="12" r=".5" />
          <circle cx="3" cy="18" r=".5" />
        </>
      );
      break;
    case 'refresh':
      shape = (
        <>
          <path d="M20 10a8 8 0 1 0-1 8M20 3v7h-7" />
        </>
      );
      break;
    case 'copy':
      shape = (
        <>
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M16 8V3H3v13h5" />
        </>
      );
      break;
    case 'home':
      shape = (
        <>
          <path d="m3 10 9-7 9 7" />
          <path d="M5 9v12h14V9M9 21v-7h6v7" />
        </>
      );
      break;
    case 'projects':
      shape = (
        <>
          <rect x="3" y="4" width="8" height="7" rx="1" />
          <rect x="13" y="4" width="8" height="7" rx="1" />
          <rect x="3" y="13" width="8" height="7" rx="1" />
          <rect x="13" y="13" width="8" height="7" rx="1" />
        </>
      );
      break;
    case 'invites':
      shape = (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20c.5-3.1 2.5-5 5.5-5 2.3 0 4 .9 5 2.5M18 7v6m-3-3h6" />
        </>
      );
      break;
    case 'history':
      shape = (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </>
      );
      break;
    case 'settings':
      shape = (
        <>
          <path d="M10 2h4l.5 2.5 1.5.6 2.1-1.4 2.8 2.8-1.4 2.1.6 1.4L22 10v4l-2.5.5-.6 1.5 1.4 2.1-2.8 2.8-2.1-1.4-1.4.6L14 22h-4l-.5-2.5-1.5-.6-2.1 1.4-2.8-2.8 1.4-2.1-.6-1.4L2 14v-4l2.5-.5.6-1.5-1.4-2.1 2.8-2.8 2.1 1.4 1.4-.6Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      );
      break;
    case 'account':
      shape = (
        <>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M4.5 21c.7-4 3.2-6 7.5-6s6.8 2 7.5 6" />
        </>
      );
      break;
    case 'menu':
      shape = <path d="M4 6h16M4 12h16M4 18h16" />;
      break;
    case 'share':
      shape = (
        <>
          <circle cx="18" cy="5" r="2.5" />
          <circle cx="6" cy="12" r="2.5" />
          <circle cx="18" cy="19" r="2.5" />
          <path d="m8.2 10.8 7.6-4.5m-7.6 7 7.6 4.5" />
        </>
      );
      break;
    case 'upload':
      shape = (
        <>
          <path d="M12 16V4m-5 5 5-5 5 5" />
          <path d="M5 15v5h14v-5" />
        </>
      );
      break;
    case 'check':
      shape = <path d="m4 12 5 5L20 6" />;
      break;
    case 'image':
      shape = (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9" r="1.5" />
          <path d="m21 15-5-5L5 20" />
        </>
      );
      break;
    case 'chevronDown':
      shape = <path d="m6 9 6 6 6-6" />;
      break;
    case 'close':
      shape = <path d="m6 6 12 12M18 6 6 18" />;
      break;
    case 'logout':
      shape = (
        <>
          <path d="M10 17l5-5-5-5m5 5H3" />
          <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" />
        </>
      );
      break;
    case 'eye':
      shape = (
        <>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </>
      );
      break;
  }

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {shape}
    </svg>
  );
}

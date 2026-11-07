'use client';

import { useRef, useState } from 'react';
import { z } from 'zod';
import {
  guestDeliveryNotificationFeedSchema,
  ownerDeliveryNotificationFeedSchema,
  type GuestDeliveryNotification,
  type OwnerDeliveryNotification,
} from '../../../packages/contracts/src/delivery-notifications';
import { getUploadIdentity } from './upload-client';
import { StudioIcon } from './studio-icons';
import './delivery-notifications.css';

type Mode = 'owner' | 'guest';
type Notification = OwnerDeliveryNotification | GuestDeliveryNotification;
type FeedState =
  | { status: 'closed' | 'loading' }
  | { status: 'ready'; notifications: Notification[] }
  | { status: 'error' };

const capabilitySchema = z.object({ enabled: z.boolean() }).strict();

async function responseJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function readNotifications(
  mode: Mode,
  scopeId: string,
  signal: AbortSignal,
): Promise<Notification[]> {
  const capabilities = await fetch(
    mode === 'owner'
      ? '/api/v1/deliveries/capabilities'
      : '/api/guest/deliveries/capabilities',
    {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    },
  );
  const capability = capabilitySchema.safeParse(
    await responseJson(capabilities),
  );
  if (!capabilities.ok || !capability.success)
    throw new Error('NOTIFICATIONS_UNAVAILABLE');
  if (!capability.data.enabled) return [];

  const before = mode === 'owner' ? await getUploadIdentity(signal) : null;
  const response = await fetch(
    mode === 'owner'
      ? `/api/v1/workspaces/${encodeURIComponent(scopeId)}/delivery-notifications`
      : `/api/guest/albums/${encodeURIComponent(scopeId)}/delivery-notifications`,
    {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(before ? { 'X-Kino-Expected-Actor': before.actorId } : {}),
      },
      signal,
    },
  );
  const body = await responseJson(response);
  if (!response.ok) throw new Error('NOTIFICATIONS_UNAVAILABLE');

  if (mode === 'owner') {
    const feed = ownerDeliveryNotificationFeedSchema.safeParse(body);
    if (!feed.success || feed.data.workspaceId !== scopeId)
      throw new Error('NOTIFICATIONS_SCOPE_CHANGED');
    const after = await getUploadIdentity(signal);
    if (
      !before ||
      before.actorId !== after.actorId ||
      before.sessionId !== after.sessionId
    )
      throw new Error('NOTIFICATIONS_IDENTITY_CHANGED');
    return feed.data.notifications;
  }

  const feed = guestDeliveryNotificationFeedSchema.safeParse(body);
  if (!feed.success || feed.data.albumId !== scopeId)
    throw new Error('NOTIFICATIONS_SCOPE_CHANGED');
  return feed.data.notifications;
}

function copy(kind: Notification['kind'], mode: Mode) {
  if (kind === 'approval_confirmed') return '客戶已確認版本';
  if (kind === 'delivery_withdrawn') return '一份成品交付已撤回';
  return mode === 'owner' ? '成品交付已發布' : '有新的成品已發布';
}

export function OwnerDeliveryNotifications({
  workspaceId,
}: {
  workspaceId: string;
}) {
  return (
    <DeliveryNotifications
      key={'owner:' + workspaceId}
      mode="owner"
      scopeId={workspaceId}
    />
  );
}

export function GuestDeliveryNotifications({ albumId }: { albumId: string }) {
  return (
    <DeliveryNotifications
      key={'guest:' + albumId}
      mode="guest"
      scopeId={albumId}
    />
  );
}

function DeliveryNotifications({
  mode,
  scopeId,
}: {
  mode: Mode;
  scopeId: string;
}) {
  const generation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState<FeedState>({ status: 'closed' });
  const id = `delivery-notifications-${mode}-${scopeId}`;

  async function open() {
    const current = ++generation.current;
    const controller = new AbortController();
    active.current = controller;
    setState({ status: 'loading' });
    try {
      const notifications = await readNotifications(
        mode,
        scopeId,
        controller.signal,
      );
      if (current === generation.current && !controller.signal.aborted)
        setState({ status: 'ready', notifications });
    } catch {
      if (current === generation.current && !controller.signal.aborted)
        setState({ status: 'error' });
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  function toggle(event: React.SyntheticEvent<HTMLDetailsElement>) {
    if (event.currentTarget.open) {
      void open();
    } else {
      generation.current += 1;
      active.current?.abort();
      active.current = null;
      setState({ status: 'closed' });
    }
  }

  return (
    <details className="delivery-notifications" onToggle={toggle}>
      <summary aria-label="近期通知" aria-controls={id}>
        <StudioIcon name="bell" width={18} height={18} />
        <span>通知</span>
      </summary>
      <section
        id={id}
        className="delivery-notifications__panel"
        aria-label="近期通知"
      >
        <h2>
          近期通知
          {state.status === 'ready' && `（${state.notifications.length}）`}
        </h2>
        {state.status === 'loading' ? (
          <p>載入中…</p>
        ) : state.status === 'error' ? (
          <p role="status">目前無法載入通知，請稍後再試。</p>
        ) : state.status === 'ready' && state.notifications.length ? (
          <ul>
            {state.notifications.map((notification, index) => (
              <li
                key={`${notification.kind}:${notification.occurredAt}:${index}`}
              >
                <span>{copy(notification.kind, mode)}</span>
                <time dateTime={notification.occurredAt}>
                  {new Date(notification.occurredAt).toLocaleString('zh-TW')}
                </time>
              </li>
            ))}
          </ul>
        ) : state.status === 'ready' ? (
          <p>目前沒有近期通知。</p>
        ) : null}
      </section>
    </details>
  );
}

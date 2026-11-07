import { z } from 'zod';

export const DELIVERY_NOTIFICATION_LIMIT = 24;

const ownerKind = z.enum([
  'approval_confirmed',
  'delivery_published',
  'delivery_withdrawn',
]);
const guestKind = z.enum(['delivery_published', 'delivery_withdrawn']);

const notification = <T extends z.ZodType>(kind: T) =>
  z.object({ kind, occurredAt: z.iso.datetime() }).strict();

export const ownerDeliveryNotificationFeedSchema = z
  .object({
    workspaceId: z.uuid(),
    notifications: z
      .array(notification(ownerKind))
      .max(DELIVERY_NOTIFICATION_LIMIT),
  })
  .strict();

export const guestDeliveryNotificationFeedSchema = z
  .object({
    albumId: z.uuid(),
    notifications: z
      .array(notification(guestKind))
      .max(DELIVERY_NOTIFICATION_LIMIT),
  })
  .strict();

export type OwnerDeliveryNotification = z.infer<
  typeof ownerDeliveryNotificationFeedSchema
>['notifications'][number];
export type GuestDeliveryNotification = z.infer<
  typeof guestDeliveryNotificationFeedSchema
>['notifications'][number];

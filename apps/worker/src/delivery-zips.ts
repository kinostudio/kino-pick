import { z } from 'zod';
import {
  createDeliveryZipSchema,
  deliveryZipSchema,
  zipManifestSchema,
  MAX_ZIP_BYTES,
  ZIP_TTL_MS,
  type ZipItem,
} from '../../../packages/contracts/src/delivery-zips';
import {
  D1GuestAccessResolver,
  GuestAccessDenied,
  hashGuestSessionSecret,
} from './guest-access';
import { WorkspaceFailure } from './workspaces';
import { zipEntryName } from './zip-stream';

type Ticket = {
  ticket_id: string;
  workspace_id: string;
  project_id: string;
  album_id: string;
  guest_id: string;
  guest_session_id: string;
  manifest: string;
  occurred_at_utc: string;
};
export type ZipFile = ZipItem & { storage_node_id: string; object_key: string };
const uuid = (value: string) => z.uuid().parse(value).toLowerCase();
export class D1DeliveryZips {
  constructor(private db: D1Database) {}
  private async hash(secret: string | null) {
    if (!secret) throw new GuestAccessDenied();
    return hashGuestSessionSecret(secret);
  }
  async ticket(secret: string | null, album: string, id: string) {
    const row = await this.db
      .prepare(
        'SELECT * FROM delivery_zip_live_guests WHERE secret_hash=? AND album_id=? AND ticket_id=?',
      )
      .bind(await this.hash(secret), uuid(album), uuid(id))
      .first<Ticket>();
    if (!row) throw new GuestAccessDenied();
    return {
      ...row,
      contents: zipManifestSchema.parse(JSON.parse(row.manifest)),
    };
  }
  private dto(row: Ticket) {
    const manifest = zipManifestSchema.parse(JSON.parse(row.manifest));
    return deliveryZipSchema.parse({
      id: row.ticket_id,
      albumId: row.album_id,
      expiresAt: new Date(manifest.expiresAtMs).toISOString(),
      fileCount: manifest.items.length,
      totalBytes: manifest.items.reduce((sum, item) => sum + item.byteSize, 0),
      files: manifest.items.map((item) => ({
        name: item.entryName,
        versionNo: item.versionNo,
        byteSize: item.byteSize,
      })),
    });
  }
  async create(secret: string | null, album: string, input: unknown) {
    album = uuid(album);
    const body = createDeliveryZipSchema.parse(input),
      access = await new D1GuestAccessResolver(this.db).album(
        secret,
        album,
        'can_download_original',
      );
    if (access.guestId !== uuid(body.expectedGuestId))
      throw new GuestAccessDenied();
    const hash = await this.hash(secret),
      session = await this.db
        .prepare(
          "SELECT id FROM guest_sessions WHERE secret_hash=? AND guest_id=? AND expires_at_ms>unixepoch('subsec')*1000",
        )
        .bind(hash, access.guestId)
        .first<{ id: string }>();
    if (!session) throw new GuestAccessDenied();
    const ids = [...body.deliveryIds].sort();
    const previous = await this.db
      .prepare(
        "SELECT event_id,album_id,after_json FROM audit_events WHERE action='delivery.zip_created' AND actor_id=? AND guest_session_id=? AND request_id=?",
      )
      .bind(access.guestId, session.id, uuid(body.requestId))
      .first<{ event_id: string; album_id: string; after_json: string }>();
    if (previous) {
      const saved = zipManifestSchema.parse(JSON.parse(previous.after_json));
      if (
        previous.album_id !== album ||
        JSON.stringify(saved.deliveryIds) !== JSON.stringify(ids)
      )
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      return this.dto(await this.ticket(secret, album, previous.event_id));
    }
    const rows = await this.db
      .prepare(
        `SELECT *,CAST(unixepoch('subsec')*1000 AS INTEGER) AS server_now_ms FROM approved_delivery_live_guests WHERE secret_hash=? AND album_id=? AND (permissions_mask&4)=4 AND delivery_id IN(${ids.map(() => '?').join(',')}) ORDER BY delivery_id COLLATE BINARY`,
      )
      .bind(hash, album, ...ids)
      .all<{
        delivery_id: string;
        photo_id: string;
        version_id: string;
        asset_id: string;
        filename: string;
        byte_size: number;
        mime: string;
        checksum_sha256: string;
        after_json: string;
        expires_at_ms: number;
        server_now_ms: number;
      }>();
    if (rows.results.length !== ids.length) throw new GuestAccessDenied();
    const total = rows.results.reduce((sum, row) => sum + row.byte_size, 0);
    if (total > MAX_ZIP_BYTES) throw new WorkspaceFailure('ZIP_TOO_LARGE', 422);
    const items = rows.results.map((row, index) => {
      const versionNo = Number(JSON.parse(row.after_json).item.versionNo);
      return {
        deliveryId: row.delivery_id,
        photoId: row.photo_id,
        versionId: row.version_id,
        versionNo,
        assetId: row.asset_id,
        filename: row.filename,
        byteSize: row.byte_size,
        mime: row.mime,
        sha256: row.checksum_sha256,
        entryName: zipEntryName(
          index,
          versionNo,
          row.photo_id,
          row.filename,
          row.mime,
        ),
      };
    });
    const manifest = zipManifestSchema.parse({
      deliveryIds: ids,
      items,
      expiresAtMs: Math.min(
        rows.results[0]!.server_now_ms + ZIP_TTL_MS,
        ...rows.results.map((row) => row.expires_at_ms),
      ),
    });
    const id = crypto.randomUUID();
    try {
      const result = await this.db
        .prepare(
          "INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,action,after_json,request_id) VALUES(?,'guest',?,?,?,?,?,'delivery.zip_created',?,?)",
        )
        .bind(
          id,
          access.guestId,
          session.id,
          access.workspaceId,
          access.projectId,
          album,
          JSON.stringify(manifest),
          uuid(body.requestId),
        )
        .run();
      if (!result.success || result.meta.changes !== 1)
        throw new Error('ZIP_AUDIT_UNAVAILABLE');
    } catch (error) {
      const text = error instanceof Error ? error.message : '';
      if (text.includes('REQUEST_ID_CONFLICT'))
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      if (text.includes('GUEST_ACCESS_REQUIRED')) throw new GuestAccessDenied();
      throw new WorkspaceFailure('ZIP_UNAVAILABLE', 503);
    }
    return this.dto(await this.ticket(secret, album, id));
  }
  async read(secret: string | null, album: string, id: string) {
    return this.dto(await this.ticket(secret, album, id));
  }
  async source(
    ticket: Awaited<ReturnType<D1DeliveryZips['ticket']>>,
    item: ZipItem,
  ): Promise<ZipFile> {
    const live = ticket;
    if (
      !live.contents.items.some(
        (saved) => JSON.stringify(saved) === JSON.stringify(item),
      )
    )
      throw new GuestAccessDenied();
    // Preflight uses the authorized snapshot; every actual R2 GET revalidates the ticket.
    const row = await this.db
      .prepare(
        "SELECT storage_node_id,object_key,byte_size,checksum_sha256 FROM photo_assets WHERE id=? AND workspace_id=? AND photo_id=? AND version_id=? AND asset_kind='original' AND state='private' AND mime=?",
      )
      .bind(
        item.assetId,
        live.workspace_id,
        item.photoId,
        item.versionId,
        item.mime,
      )
      .first<{
        storage_node_id: string;
        object_key: string;
        byte_size: number;
        checksum_sha256: string;
      }>();
    if (
      !row ||
      row.byte_size !== item.byteSize ||
      row.checksum_sha256 !== item.sha256
    )
      throw new GuestAccessDenied();
    return {
      ...item,
      storage_node_id: row.storage_node_id,
      object_key: row.object_key,
    };
  }
  async audit(
    ticket: Ticket,
    requestId: string,
    clientIp: string | null,
    generated: boolean,
  ) {
    const action = generated
        ? 'delivery.zip_download_generated'
        : 'delivery.zip_download_requested',
      payload = JSON.stringify({ ticketId: ticket.ticket_id, clientIp });
    const old = await this.db
      .prepare(
        'SELECT actor_id,after_json FROM audit_events WHERE action=? AND guest_session_id=? AND request_id=?',
      )
      .bind(action, ticket.guest_session_id, uuid(requestId))
      .first<{ actor_id: string; after_json: string }>();
    if (old) {
      if (old.actor_id !== ticket.guest_id || old.after_json !== payload)
        throw new WorkspaceFailure('REQUEST_ID_CONFLICT', 409);
      return;
    }
    try {
      const result = await this.db
        .prepare(
          "INSERT INTO audit_events(event_id,actor_type,actor_id,guest_session_id,workspace_id,project_id,album_id,action,after_json,request_id) VALUES(?,'guest',?,?,?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          ticket.guest_id,
          ticket.guest_session_id,
          ticket.workspace_id,
          ticket.project_id,
          ticket.album_id,
          action,
          payload,
          uuid(requestId),
        )
        .run();
      if (!result.success || result.meta.changes !== 1) throw new Error();
    } catch {
      throw new WorkspaceFailure('ZIP_AUDIT_UNAVAILABLE', 503);
    }
  }
}

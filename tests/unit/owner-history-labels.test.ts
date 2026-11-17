// The root test project needs the same CSS module types as the frontend.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../apps/web/target-ui/vite-env.d.ts" />
import { expect, it } from 'vitest';
import type { OwnerHistoryEvent } from '../../packages/contracts/src/owner-history';
import { OWNER_HISTORY_PROJECTED_ACTIONS } from '../../apps/worker/src/owner-history-projection';
import {
  historyActorLabel,
  historyEventChangeLines,
  historyEventObjectLabel,
  historyEventLabel,
  historyEventSummary,
} from '../../apps/web/target-ui/owner-history';

const event = (action: string): OwnerHistoryEvent => ({
  eventId: 'test',
  occurredAt: '2026-11-17T00:00:00.000Z',
  actor: { type: 'user', id: null, label: 'Owner' },
  workspaceId: '00000000-0000-4000-8000-000000000001',
  projectId: null,
  albumId: null,
  photoId: null,
  versionId: null,
  inviteId: null,
  relatedInviteIds: [],
  sessionId: null,
  guestSessionId: null,
  requestId: null,
  action,
  details: { status: 'available', before: null, after: null },
});

it('names every supported audit action without a generic fallback', () => {
  for (const action of OWNER_HISTORY_PROJECTED_ACTIONS)
    expect(historyEventLabel(event(action)), action).not.toBe('尚未分類的活動');
  expect(
    historyEventLabel(event('album.photographer_recommendations.changed')),
  ).toBe('調整攝影師推薦條件');
  expect(historyEventLabel(event('future.unknown'))).toBe('尚未分類的活動');
});

it('describes the action and the photo while preserving the raw audit values', () => {
  const upload = event('upload.reserved');
  upload.details.after = { originalFilename: 'portrait.v2.JPG' };
  expect(historyEventSummary(upload)).toBe('照片加入上傳佇列 · portrait.v2');
  expect(upload.details.after.originalFilename).toBe('portrait.v2.JPG');
  const rating = event('rating.set');
  rating.details.after = { stars: 4 };
  rating.subject = {
    projectName: '春季',
    albumName: '婚禮',
    photoFilename: 'DSC_001.jpg',
  };
  expect(historyEventSummary(rating)).toBe('評為 4 星 · DSC_001');
  rating.details.after = { stars: 0 };
  expect(historyEventLabel(rating)).toBe('設定評分');
  expect(historyActorLabel(upload)).toBe('攝影師');
  expect(
    historyActorLabel({
      ...upload,
      actor: { type: 'guest', id: null, label: '小美' },
    }),
  ).toBe('小美');
});

it('summarizes recommendation rules as readable before-to-after changes', () => {
  const recommendation = event('album.photographer_recommendations.changed');
  recommendation.albumId = '00000000-0000-4000-8000-000000000002';
  recommendation.subject = {
    projectName: '春季專案',
    albumName: '婚禮相簿',
    photoFilename: null,
  };
  recommendation.details.before = {
    albumId: recommendation.albumId,
    revision: 2,
    visible: false,
    minRating: null,
    allowedLabels: [],
    matchMode: 'any',
  };
  recommendation.details.after = {
    albumId: recommendation.albumId,
    revision: 3,
    visible: true,
    minRating: 4,
    allowedLabels: ['red', 'yellow'],
    matchMode: 'any',
  };

  expect(historyEventSummary(recommendation)).toBe(
    '調整攝影師推薦條件 · 婚禮相簿',
  );
  expect(historyEventObjectLabel(recommendation)).toBe(
    '相簿「婚禮相簿」 · 專案「春季專案」',
  );
  expect(historyEventChangeLines(recommendation)).toEqual([
    '是否顯示推薦：關閉 → 開啟',
    '最低星等：不使用星等條件 → 4 星以上',
    '色標：未設定 → 紅色、黃色',
    '條件判斷：符合任一已設定條件即可推薦（OR）。',
  ]);

  recommendation.subject = {
    projectName: null,
    albumName: null,
    photoFilename: null,
  };
  expect(historyEventSummary(recommendation)).toBe('調整攝影師推薦條件');
  expect(historyEventObjectLabel(recommendation)).toBe('相簿名稱未提供');
});

it('describes workspace renames and removal by name only', () => {
  const rename = event('workspace.renamed');
  rename.details.before = { name: '舊工作空間' };
  rename.details.after = { name: '新工作空間' };
  expect(historyEventLabel(rename)).toBe('修改工作空間名稱');
  expect(historyEventSummary(rename)).toBe(
    '修改工作空間名稱 · 舊工作空間 → 新工作空間',
  );
  expect(historyEventObjectLabel(rename)).toBe('工作空間「新工作空間」');
  expect(historyEventChangeLines(rename)).toEqual([
    '名稱：舊工作空間 → 新工作空間',
  ]);

  const removed = event('workspace.deleted');
  removed.details.before = { name: '已清空工作空間' };
  removed.details.after = { name: '已清空工作空間' };
  expect(historyEventLabel(removed)).toBe('移除工作空間');
  expect(historyEventSummary(removed)).toBe('移除工作空間 · 已清空工作空間');
  expect(historyEventObjectLabel(removed)).toBe('工作空間「已清空工作空間」');
});

it('distinguishes comments, drawings, renames and requested versus available downloads', () => {
  const feedback = event('owner.album_feedback_created');
  feedback.details.after = { kind: 'annotation' };
  expect(historyEventLabel(feedback)).toBe('攝影師新增手繪註記');
  const rename = event('album.renamed');
  rename.details.before = { name: '舊相簿' };
  rename.details.after = { name: '新相簿' };
  expect(historyEventSummary(rename)).toBe('修改相簿名稱 · 舊相簿 → 新相簿');
  const download = event('download.requested');
  download.details.after = { assetKind: 'original' };
  expect(historyEventLabel(download)).toBe('要求下載原始畫質照片');
  download.action = 'download.generated';
  expect(historyEventLabel(download)).toBe('原始畫質照片已可下載');
});

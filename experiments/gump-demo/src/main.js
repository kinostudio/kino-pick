import './style.css';
import { mountProcessingSettings } from './processing-settings.js';

const seed = [
  {
    id: 'p01',
    title: '窗邊的晨光',
    scene: 'veil',
    type: '精選',
    selected: true,
    favorite: true,
    colorLabel: 'red',
  },
  {
    id: 'p02',
    title: '花園裡的散步',
    scene: 'garden',
    type: '婚禮紀錄',
    selected: true,
    favorite: false,
    colorLabel: 'green',
  },
  {
    id: 'p03',
    title: '午後的誓言',
    scene: 'sunset',
    type: '推薦',
    selected: true,
    favorite: true,
    colorLabel: 'yellow',
  },
  {
    id: 'p04',
    title: '海岸微風',
    scene: 'coast',
    type: '婚禮紀錄',
    selected: false,
    favorite: false,
    colorLabel: 'blue',
  },
  {
    id: 'p05',
    title: '白色花束',
    scene: 'bloom',
    type: '細節',
    selected: false,
    favorite: true,
    colorLabel: 'purple',
  },
  {
    id: 'p06',
    title: '金色時刻',
    scene: 'gold',
    type: '推薦',
    selected: false,
    favorite: false,
    colorLabel: 'red',
  },
  {
    id: 'p07',
    title: '回眸',
    scene: 'portrait',
    type: '婚禮紀錄',
    selected: false,
    favorite: false,
    colorLabel: 'green',
  },
  {
    id: 'p08',
    title: '夜色與燭光',
    scene: 'night',
    type: '婚宴',
    selected: false,
    favorite: false,
    colorLabel: 'blue',
  },
];
const photos = () => seed.map((item) => ({ ...item }));
const projects = [
  {
    id: 'project-spring',
    name: '春日婚禮紀錄',
    client: '林小姐',
    albums: [
      {
        id: 'album-spring',
        title: '春日婚禮・林間紀錄',
        client: '範例新人',
        photos: photos(),
        updated: Date.now() - 1000 * 60 * 18,
        share: null,
      },
      {
        id: 'album-garden',
        title: '婚前派對・相聚時刻',
        client: '範例新人',
        photos: photos(),
        updated: Date.now() - 1000 * 60 * 60 * 5,
        share: null,
      },
    ],
  },
  {
    id: 'project-coast',
    name: '海岸婚紗企劃',
    client: '陳小姐',
    albums: [
      {
        id: 'album-coast',
        title: '海岸婚紗・晨霧時分',
        client: '展示客戶',
        photos: photos(),
        updated: Date.now() - 1000 * 60 * 60 * 26,
        share: null,
      },
    ],
  },
];
const state = {
  page: 'album',
  projectId: 'project-spring',
  albumId: 'album-spring',
  photoId: '',
  returnPage: 'album',
  filter: 'all',
  guestFilter: 'all',
  createdAlbumId: '',
  nextAlbum: 1,
  bannerDismissed: false,
  photoComments: {},
  photoDrafts: {},
  photoRatings: {},
  recommendationSettings: {},
  annotationTool: 'view',
  annotationColor: '#c85b50',
  activeStroke: null,
  nextCommentId: 1,
  account: { displayName: 'KINO Studio', workspaceName: '示範工作區' },
  inviteAlbumId: 'album-spring',
  deliveryAlbumId: 'album-spring',
  historyFilter: 'all',
  submissions: [],
  nextActivityId: 4,
  activityLog: [
    {
      id: 1,
      albumId: 'album-spring',
      actor: '範例資料',
      label: '建立展示相簿',
      at: Date.now() - 1000 * 60 * 60 * 26,
      source: '範例',
    },
    {
      id: 2,
      albumId: 'album-spring',
      actor: '範例資料',
      label: '設定攝影師推薦條件',
      at: Date.now() - 1000 * 60 * 60 * 4,
      source: '範例',
    },
    {
      id: 3,
      albumId: 'album-spring',
      actor: '範例資料',
      label: '展示客戶選取 3 張照片',
      at: Date.now() - 1000 * 60 * 35,
      source: '範例',
    },
  ],
  processingSettings: null,
  processingSettingsMount: null,
};
// Draft points stay normalized to 0–100; map X into the 3:2 annotation plane.
const ANNOTATION_X_SCALE = 1.5;
const app = document.querySelector('#app');
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const entries = () =>
  projects.flatMap((pr) => pr.albums.map((a) => ({ project: pr, album: a })));
const albumEntry = (id) =>
  entries().find((item) => item.album.id === id) || entries()[0];
const album = () => albumEntry(state.albumId).album;
const project = () =>
  projects.find((item) => item.id === state.projectId) ||
  albumEntry(state.albumId).project;
const chosenCount = (a) => a.photos.filter((photo) => photo.selected).length;
const RECOMMENDATION_COLORS = {
  red: { label: '紅色', hex: '#bf665d' },
  yellow: { label: '黃色', hex: '#d5ad55' },
  green: { label: '綠色', hex: '#6d8d75' },
  blue: { label: '藍色', hex: '#6689a1' },
  purple: { label: '紫色', hex: '#9279a0' },
};
const DEFAULT_RECOMMENDATION_SETTINGS = {
  display: true,
  ratingEnabled: true,
  minRating: 4,
  colorEnabled: true,
  color: 'red',
  match: 'any',
};
function recommendationSettings(albumId) {
  const id = albumId || state.albumId;
  if (!state.recommendationSettings[id])
    state.recommendationSettings[id] = { ...DEFAULT_RECOMMENDATION_SETTINGS };
  return state.recommendationSettings[id];
}
function photoRating(albumId, photoId) {
  const key = photoDraftKey(albumId, photoId);
  return Object.prototype.hasOwnProperty.call(state.photoRatings, key)
    ? state.photoRatings[key]
    : 0;
}
function recommendationCriteriaMatch(albumId, photo) {
  const settings = recommendationSettings(albumId),
    criteria = [];
  if (settings.ratingEnabled)
    criteria.push(photoRating(albumId, photo.id) >= settings.minRating);
  if (settings.colorEnabled) criteria.push(photo.colorLabel === settings.color);
  if (!criteria.length) return false;
  return settings.match === 'all'
    ? criteria.every(Boolean)
    : criteria.some(Boolean);
}
function photoColorName(photo) {
  return photo.colorLabel && RECOMMENDATION_COLORS[photo.colorLabel]
    ? RECOMMENDATION_COLORS[photo.colorLabel].label
    : '';
}
function recommendationBadge(albumId, photo, guest) {
  const settings = recommendationSettings(albumId);
  if (
    !recommendationCriteriaMatch(albumId, photo) ||
    (guest && !settings.display)
  )
    return '';
  const text = guest ? '攝影師推薦' : '符合推薦條件';
  return (
    '<small class="photographer-recommendation-badge" data-testid="photographer-recommendation-badge" data-photo-id="' +
    photo.id +
    '">' +
    text +
    '</small>'
  );
}
const navKey = () => {
  if (
    [
      'overview',
      'projects',
      'recent',
      'favorites',
      'invite',
      'history',
      'delivery',
      'settings',
      'account',
    ].includes(state.page)
  )
    return state.page;
  if (
    ['guest', 'selection-confirm', 'submission'].includes(state.page) ||
    (state.page === 'photo' && state.returnPage === 'guest')
  )
    return 'invite';
  if (['delivery-detail'].includes(state.page)) return 'delivery';
  if (state.page === 'photo') return 'projects';
  return 'projects';
};
function recordActivity(albumId, label, actor = '展示攝影師') {
  state.activityLog.unshift({
    id: state.nextActivityId++,
    albumId,
    actor,
    label,
    at: Date.now(),
    source: '本機互動',
  });
  state.activityLog = state.activityLog.slice(0, 100);
}
function activityTime(value) {
  return new Intl.DateTimeFormat('zh-TW', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
function latestSubmission(albumId) {
  return state.submissions.find((item) => item.albumId === albumId) || null;
}

function cardPhoto(item, guest, showAlbum, cardTestId, selectable = true) {
  const p = item.photo,
    a = item.album,
    rating = photoRating(a.id, p.id),
    colorName = photoColorName(p);
  const selectionControl = selectable
    ? '<label class="select"><input type="checkbox" data-testid="photo-select-' +
      p.id +
      '" data-select="' +
      p.id +
      '" data-album-id="' +
      a.id +
      '" aria-label="選取 ' +
      esc(p.title) +
      '"' +
      (p.selected ? ' checked' : '') +
      '><i>✓</i></label>'
    : '';
  return (
    '<article class="photo-card' +
    (p.selected ? ' is-selected' : '') +
    (guest ? ' guest-photo-card' : '') +
    '" data-testid="' +
    esc(cardTestId || 'photo-card') +
    '" data-photo-id="' +
    p.id +
    '"><div class="visual scene-' +
    p.scene +
    '" data-testid="photo-visual">' +
    '<button class="photo-open" type="button" data-open-photo="' +
    p.id +
    '" data-album-id="' +
    a.id +
    '" aria-label="開啟照片詳情：' +
    esc(p.title) +
    '"><span>檢視照片　↗</span></button>' +
    '<span class="photo-index">' +
    p.id.slice(1) +
    '</span>' +
    (guest
      ? ''
      : '<button class="favorite-toggle' +
        (p.favorite ? ' is-favorite' : '') +
        '" type="button" data-favorite="' +
        p.id +
        '" data-album-id="' +
        a.id +
        '" aria-label="' +
        (p.favorite ? '取消收藏' : '收藏') +
        ' ' +
        esc(p.title) +
        '" aria-pressed="' +
        p.favorite +
        '">' +
        (p.favorite ? '♥' : '♡') +
        '</button>') +
    '<span class="photo-type">' +
    esc(p.type) +
    '</span>' +
    selectionControl +
    '<span class="visual-mark">DEMO VISUAL</span></div>' +
    '<div class="photo-info"><span><button type="button" class="photo-name-open" data-open-photo="' +
    p.id +
    '" data-album-id="' +
    a.id +
    '">' +
    esc(p.title) +
    '</button><small>今天 14:20 · JPG</small>' +
    (guest || !rating
      ? ''
      : '<small data-testid="photo-card-rating">攝影師推薦 · ' +
        rating +
        '★</small>') +
    recommendationBadge(a.id, p, guest) +
    (guest || !colorName
      ? ''
      : '<small class="photo-card-color-label" data-testid="photo-card-color-label" data-photo-id="' +
        p.id +
        '">色標：' +
        esc(colorName) +
        '</small>') +
    '</span><button class="compare" type="button" data-testid="compare-photo-' +
    p.id +
    '" data-compare="' +
    p.id +
    '" data-album-id="' +
    a.id +
    '">比較版本 ↔</button></div>' +
    (showAlbum
      ? '<button type="button" class="open-album-from-photo" data-open-album="' +
        a.id +
        '">相簿：' +
        esc(a.title) +
        '　→</button>'
      : '') +
    '</article>'
  );
}
function photoGrid(items, opts = {}) {
  if (!items.length)
    return (
      '<div class="empty-state"><span>♡</span><b>' +
      esc(opts.emptyTitle || '目前沒有照片') +
      '</b><small>' +
      esc(opts.emptyCopy || '可以回到相簿，從展示照片開始操作。') +
      '</small>' +
      (opts.action || '') +
      '</div>'
    );
  return (
    '<section class="photo-grid" aria-label="' +
    esc(opts.label || '展示照片') +
    '">' +
    items
      .map((item) =>
        cardPhoto(
          item,
          opts.guest,
          opts.showAlbum,
          opts.cardTestId,
          opts.selectable,
        ),
      )
      .join('') +
    '</section>'
  );
}
function albumCards(items) {
  return items
    .map(
      ({ project: pr, album: a }) =>
        '<article class="album-card" data-testid="album-card"><div class="album-card-art scene-' +
        a.photos[2].scene +
        '"><span>DEMO ALBUM</span></div><div class="album-card-body"><small>' +
        esc(pr.name) +
        '　·　展示相簿</small><h3>' +
        esc(a.title) +
        '</h3><p>' +
        esc(a.client) +
        '　·　' +
        a.photos.length +
        ' 張照片　·　已選 ' +
        chosenCount(a) +
        ' 張</p><div class="album-card-actions"><button class="btn secondary" type="button" data-open-album="' +
        a.id +
        '">開啟工作室</button><button class="text-action" type="button" data-open-guest="' +
        a.id +
        '">客戶挑片預覽　↗</button></div></div></article>',
    )
    .join('');
}
function projectCards(items) {
  return items
    .map(
      (pr) =>
        '<article class="project-card" data-testid="project-card"><div class="project-art scene-' +
        pr.albums[0].photos[2].scene +
        '"><span>DEMO PROJECT</span></div><div class="project-card-body"><div class="project-card-meta"><span>展示專案</span><span>' +
        pr.albums.length +
        ' 本相簿</span></div><h2>' +
        esc(pr.name) +
        '</h2><p>展示客戶　<b>' +
        esc(pr.client) +
        '</b></p><div class="project-stats"><span>' +
        pr.albums.reduce((n, a) => n + a.photos.length, 0) +
        ' 張照片</span><i></i><span>' +
        pr.albums.reduce((n, a) => n + chosenCount(a), 0) +
        ' 張已選</span></div><div class="project-album-chips">' +
        pr.albums
          .map(
            (a) =>
              '<button type="button" data-open-album="' +
              a.id +
              '">' +
              esc(a.title) +
              '</button>',
          )
          .join('') +
        '</div><button class="btn secondary project-open" type="button" data-open-project="' +
        pr.id +
        '">開啟專案　→</button></div></article>',
    )
    .join('');
}
function allPhotoEntries() {
  return entries().flatMap(({ project: pr, album: a }) =>
    a.photos.map((photo) => ({ project: pr, album: a, photo })),
  );
}
function renderOverview() {
  const list = entries(),
    photoTotal = list.reduce((n, x) => n + x.album.photos.length, 0),
    picked = list.reduce((n, x) => n + chosenCount(x.album), 0);
  return (
    '<section class="heading"><div><small class="eyebrow">KINO PICK / WORKSPACE</small><h1 data-testid="page-title">工作總覽</h1><p>從專案進入相簿工作室，或打開客戶挑片展示。</p></div><div class="actions"><button class="btn secondary" type="button" data-nav="projects">瀏覽專案</button><button class="btn primary" type="button" data-create-in-project="' +
    state.projectId +
    '">＋ 建立相簿</button></div></section>' +
    '<section class="overview-metrics"><article><small>展示專案</small><b>' +
    projects.length +
    '</b><span>僅在此分頁</span></article><article><small>展示相簿</small><b>' +
    list.length +
    '</b><span>合成展示資料</span></article><article><small>照片</small><b>' +
    photoTotal +
    '</b><span>CSS 合成視覺</span></article><article><small>客戶已選</small><b>' +
    picked +
    '</b><span>本機互動狀態</span></article></section>' +
    '<section class="page-block"><div class="block-heading"><div><h2>專案</h2><small>選擇專案，查看其中的展示相簿。</small></div><button class="text-action" type="button" data-nav="projects">查看全部　→</button></div><div class="project-grid">' +
    projectCards(projects) +
    '</div></section>' +
    '<section class="page-block"><div class="block-heading"><div><h2>最近開啟</h2><small>快速回到最近查看的相簿。</small></div><button class="text-action" type="button" data-nav="recent">查看最近項目　→</button></div><div class="album-grid">' +
    albumCards(
      entries()
        .sort((x, y) => y.album.updated - x.album.updated)
        .slice(0, 2),
    ) +
    '</div></section>'
  );
}
function renderProjects() {
  return (
    '<section class="heading"><div><small class="eyebrow">WORKSPACE / PROJECTS</small><h1 data-testid="page-title">專案與相簿</h1><p>從專案整理交付內容，或直接前往相簿與客戶挑片預覽。</p></div></section><div class="project-grid">' +
    projectCards(projects) +
    '</div>' +
    '<section class="page-block"><div class="block-heading"><div><h2>所有相簿</h2><small>可進入工作室，或直接打開客戶挑片展示。</small></div><button class="btn primary" type="button" data-create-in-project="' +
    state.projectId +
    '">＋ 建立相簿</button></div><div class="album-grid">' +
    albumCards(entries()) +
    '</div></section>'
  );
}
function renderProject() {
  const pr = project(),
    list = pr.albums.map((a) => ({ project: pr, album: a }));
  return (
    '<section class="heading"><div><small class="eyebrow">PROJECT / DEMO</small><h1 data-testid="page-title">' +
    esc(pr.name) +
    '</h1><p>展示客戶　<b>' +
    esc(pr.client) +
    '</b>　·　' +
    pr.albums.length +
    ' 本相簿</p></div><button class="btn primary" type="button" data-create-in-project="' +
    pr.id +
    '">＋ 在此專案建立相簿</button></section>' +
    '<div class="project-summary"><span class="project-summary-mark">' +
    esc(pr.name.slice(0, 1)) +
    '</span><span><b>本機展示專案</b><small>相簿與照片只存在目前分頁記憶體。</small></span><button class="text-action" type="button" data-nav="projects">返回專案列表　↑</button></div>' +
    '<section class="page-block"><div class="block-heading"><div><h2>專案相簿</h2><small>選取相簿後可檢視照片、調整選片或比較版本。</small></div></div><div class="album-grid">' +
    albumCards(list) +
    '</div></section>'
  );
}
function renderRecent() {
  const sorted = entries().sort((x, y) => y.album.updated - x.album.updated);
  return (
    '<section class="heading"><div><small class="eyebrow">WORKSPACE / RECENT</small><h1 data-testid="page-title">最近項目</h1><p>從最近查看的相簿或照片繼續操作。</p></div><button class="btn secondary" type="button" data-nav="projects">瀏覽專案</button></section>' +
    '<section class="page-block"><div class="block-heading"><div><h2>最近相簿</h2><small>點選「開啟工作室」可回到該相簿。</small></div></div><div class="album-grid">' +
    albumCards(sorted) +
    '</div></section>' +
    '<section class="page-block"><div class="block-heading"><div><h2>最近照片</h2><small>可開啟照片詳情或返回所屬相簿。</small></div></div>' +
    photoGrid(allPhotoEntries().slice(0, 12), {
      showAlbum: true,
      label: '最近展示照片',
    }) +
    '</section>'
  );
}
function renderFavorites() {
  const list = allPhotoEntries().filter((item) => item.photo.favorite);
  return (
    '<section class="heading"><div><small class="eyebrow">WORKSPACE / FAVORITES</small><h1 data-testid="page-title">收藏</h1><p>收藏狀態會反映在相簿、最近項目與照片詳情中。</p></div><button class="btn secondary" type="button" data-nav="projects">瀏覽專案</button></section>' +
    '<div class="favorite-summary"><span>♥</span><b>' +
    list.length +
    ' 張展示照片已收藏</b><small>點照片卡上的愛心即可加入或移除。</small></div>' +
    photoGrid(list, {
      showAlbum: true,
      label: '收藏展示照片',
      emptyTitle: '還沒有收藏照片',
      emptyCopy: '開啟任一相簿，點照片上的愛心即可加入收藏。',
      action:
        '<button class="btn secondary" type="button" data-nav="projects">前往專案與相簿</button>',
    })
  );
}
function renderAccount() {
  return `<section class="heading"><div><small class="eyebrow">ACCOUNT / LOCAL PREVIEW</small><h1 data-testid="page-title">登入 / 帳號</h1><p>檢視本機展示身份與工作區名稱。</p></div><button class="btn secondary" type="button" data-nav="overview">返回工作總覽</button></section>
    <div class="local-flow-grid"><section class="flow-card account-card" data-testid="account-page"><div class="flow-card-heading"><span class="role-mark">KS</span><span><small>展示身份</small><b>${esc(state.account.displayName)}</b><em>本機展示帳號 · 未連接正式登入</em></span></div>
      <form id="account-form" class="local-form"><label for="account-display-name">展示名稱</label><input id="account-display-name" name="displayName" data-account-display-name maxlength="40" required value="${esc(state.account.displayName)}"><label for="account-workspace-name">工作區名稱</label><input id="account-workspace-name" name="workspaceName" data-account-workspace-name maxlength="40" required value="${esc(state.account.workspaceName)}"><p class="field-note">變更只保留在目前分頁；重新整理後會清除。</p><button class="btn primary" type="submit" data-testid="save-account-preview">更新本機展示資料</button></form>
    </section><aside class="flow-card"><span class="flow-status">尚未連線</span><h2>正式登入未啟用</h2><p>OAuth、帳號綁定與驗證服務尚未接入。這個畫面不會要求密碼、建立帳號或驗證身份。</p><div class="flow-actions"><button class="btn secondary" type="button" data-nav="projects">瀏覽展示專案</button><button class="text-action" type="button" data-nav="invite">前往客戶邀請入口　→</button></div></aside></div>`;
}
function renderInviteEntry() {
  const options = entries()
    .map(
      ({ album: a, project: pr }) =>
        `<option value="${esc(a.id)}"${state.inviteAlbumId === a.id ? ' selected' : ''}>${esc(pr.name)}　·　${esc(a.title)}</option>`,
    )
    .join('');
  return `<section class="heading"><div><small class="eyebrow">GUEST / INVITATION ENTRY</small><h1 data-testid="page-title">客戶邀請入口</h1><p>以免登入方式開啟一份本機展示相簿。</p></div><button class="btn secondary" type="button" data-nav="projects">返回專案</button></section>
    <div class="local-flow-grid"><section class="flow-card" data-testid="invite-entry-page"><span class="flow-status">展示邀請 · 無效連結</span><h2>選擇展示邀請</h2><p>此處不接受真實邀請碼，也不會查詢邀請服務。選擇一筆合成資料即可查看客戶挑片畫面。</p><label class="local-field" for="invite-album-select">展示相簿</label><select id="invite-album-select" data-testid="invite-album-select" data-invite-album>${options}</select><button class="btn primary" type="button" data-testid="open-demo-invite" data-open-invite>開啟客戶展示　→</button></section>
    <aside class="flow-card"><span class="flow-status">免註冊流程預覽</span><h2>客戶不需要帳號</h2><p>正式產品的邀請權限、期限與撤銷尚未在此 prototype 實作。展示相簿只使用合成照片和本機狀態。</p><button class="text-action" type="button" data-nav="account">查看登入 / 帳號狀態　→</button></aside></div>`;
}
function renderSelectionConfirm() {
  const a = album(),
    selected = a.photos.filter((photo) => photo.selected),
    previous = latestSubmission(a.id);
  const list = selected.length
    ? `<ul class="summary-photo-list">${selected.map((photo) => `<li><span class="scene-dot scene-${photo.scene}"></span><span>${esc(photo.title)}</span><small>${esc(photo.type)}</small></li>`).join('')}</ul>`
    : '<div class="empty-state compact"><b>目前沒有已選照片</b><small>返回客戶展示後，先選取想保留的照片。</small></div>';
  return `<section class="heading"><div><small class="eyebrow">GUEST / SELECTION CONFIRMATION</small><h1 data-testid="page-title">確認展示選片</h1><p>檢查清單後，可記錄一筆本機展示確認。</p></div><button class="btn secondary" type="button" data-open-guest="${esc(a.id)}">返回客戶挑片</button></section>
    <div class="guest-warning"><span class="info">i</span><span><b>確認只會寫入此分頁的展示狀態</b><small>不會提交到服務、通知攝影師或建立正式選片紀錄。</small></span></div>
    <section class="flow-card selection-confirm-card" data-testid="selection-confirmation-page"><div class="selection-confirm-summary"><span><small>展示相簿</small><b>${esc(a.title)}</b></span><strong>${selected.length}<small> 張已選</small></strong></div>${list}
      ${previous ? `<p class="field-note">此相簿已有 ${activityTime(previous.at)} 的本機展示確認；再次確認會新增另一筆展示記錄。</p>` : ''}
      <div class="flow-actions"><button class="btn secondary" type="button" data-open-guest="${esc(a.id)}">返回修改</button>${selected.length ? '<button class="btn primary" type="button" data-testid="confirm-selection-demo" data-confirm-selection>確認本機展示選片</button>' : ''}</div></section>`;
}
function renderSubmission() {
  const a = album(),
    item = latestSubmission(a.id);
  if (!item)
    return `<section class="heading"><div><small class="eyebrow">GUEST / LOCAL RESULT</small><h1 data-testid="page-title">展示確認記錄</h1><p>目前沒有這份相簿的本機展示確認。</p></div></section><div class="empty-state"><b>尚無展示確認</b><small>返回客戶挑片並選取照片後，可以建立本機展示記錄。</small><button class="btn primary" type="button" data-open-guest="${esc(a.id)}">前往客戶挑片</button></div>`;
  const photosText = item.photoTitles.map(esc).join('、');
  return `<section class="heading"><div><small class="eyebrow">GUEST / LOCAL RESULT</small><h1 data-testid="page-title">展示確認記錄</h1><p>這份記錄只存在目前分頁記憶體。</p></div><button class="btn secondary" type="button" data-nav="history">查看本機活動歷史</button></section>
    <section class="flow-card submission-result" data-testid="submission-result"><span class="flow-status">本機展示記錄 · 未送出</span><h2>已記下一筆展示確認</h2><p>沒有資料送到服務，也沒有通知攝影師。重新整理後這筆記錄會清除。</p><div class="result-metrics"><span><b>${item.count}</b><small>張展示照片</small></span><span><b>${esc(activityTime(item.at))}</b><small>本機展示時間</small></span></div><div class="result-photo-names">${photosText || '沒有照片名稱'}</div><div class="flow-actions"><button class="btn secondary" type="button" data-open-guest="${esc(a.id)}">返回客戶展示</button><button class="btn primary" type="button" data-nav="delivery">查看交付展示</button></div></section>`;
}
function renderHistory() {
  const options = entries()
    .map(
      ({ album: a }) =>
        `<option value="${esc(a.id)}"${state.historyFilter === a.id ? ' selected' : ''}>${esc(a.title)}</option>`,
    )
    .join('');
  const rows = state.activityLog
    .filter(
      (item) =>
        state.historyFilter === 'all' || item.albumId === state.historyFilter,
    )
    .sort((left, right) => right.at - left.at);
  const timeline = rows.length
    ? `<ol class="activity-list">${rows
        .map((item) => {
          const found = albumEntry(item.albumId);
          return `<li><span class="activity-dot"></span><div><div class="activity-meta"><b>${esc(item.actor)}</b><time>${esc(activityTime(item.at))}</time></div><p>${esc(item.label)}</p><small>${esc(found.album.title)} · ${esc(item.source === '範例' ? '合成範例記錄' : '本機互動記錄')}</small></div><button class="text-action" type="button" data-open-album="${esc(found.album.id)}">開啟相簿　→</button></li>`;
        })
        .join('')}</ol>`
    : '<div class="empty-state compact"><b>目前沒有記錄</b><small>在本機展示中建立相簿、調整選片或記錄確認後，活動會列在這裡。</small></div>';
  return `<section class="heading"><div><small class="eyebrow">ACTIVITY / LOCAL DEMO</small><h1 data-testid="page-title">活動歷史</h1><p>合成範例與目前分頁互動的時間線。</p></div><label class="history-filter">相簿<select data-testid="history-album-filter" data-history-filter><option value="all"${state.historyFilter === 'all' ? ' selected' : ''}>所有展示相簿</option>${options}</select></label></section>
    <div class="guest-warning"><span class="info">i</span><span><b>不是正式稽核紀錄</b><small>此清單混合合成範例與本機互動；不會保存到服務，重新整理後會清除。</small></span></div><section class="flow-card history-card" data-testid="history-page">${timeline}</section>`;
}
function renderDelivery() {
  const cards = entries()
    .map(({ album: a, project: pr }) => {
      const selected = a.photos.filter((photo) => photo.selected).length;
      const hasLocalRecord = Boolean(latestSubmission(a.id));
      return `<article class="delivery-card"><span class="delivery-art scene-${a.photos[0].scene}"></span><div><small>${esc(pr.name)} · 交付展示</small><h2>${esc(a.title)}</h2><p>${selected} 張展示選片${hasLocalRecord ? ' · 有本機確認記錄' : ' · 尚未確認'}</p><span class="flow-status">尚未建立實際交付</span></div><button class="btn secondary" type="button" data-testid="delivery-preview-${esc(a.id)}" data-delivery-preview="${esc(a.id)}">檢視展示清單　→</button></article>`;
    })
    .join('');
  return `<section class="heading"><div><small class="eyebrow">DELIVERY / SHOWCASE</small><h1 data-testid="page-title">交付展示</h1><p>預覽交付清單的內容層次與照片數量。</p></div><button class="btn secondary" type="button" data-nav="history">活動歷史</button></section>
    <div class="guest-warning"><span class="info">i</span><span><b>交付功能尚未建立</b><small>以下只有本機清單預覽；沒有 ZIP、下載連結、寄送或交付完成狀態。</small></span></div><section class="delivery-list" data-testid="delivery-page">${cards}</section>`;
}
function renderDeliveryDetail() {
  const a = albumEntry(state.deliveryAlbumId || state.albumId).album,
    photosToShow = a.photos.filter((photo) => photo.selected);
  const rows = photosToShow.length
    ? `<ul class="delivery-photo-list">${photosToShow.map((photo, index) => `<li><span class="delivery-photo-thumb scene-${photo.scene}"></span><span><b>${esc(photo.title)}</b><small>${String(index + 1).padStart(2, '0')} · ${esc(photo.type)} · 合成展示視覺</small></span><em>未產生檔案</em></li>`).join('')}</ul>`
    : '<div class="empty-state compact"><b>清單目前沒有選片</b><small>返回客戶展示並選取照片，即可更新這份本機預覽。</small></div>';
  return `<section class="heading"><div><small class="eyebrow">DELIVERY / PREVIEW ONLY</small><h1 data-testid="page-title">交付清單預覽</h1><p>${esc(a.title)} · ${photosToShow.length} 張展示照片</p></div><button class="btn secondary" type="button" data-nav="delivery">返回交付展示</button></section>
    <section class="flow-card delivery-detail" data-testid="delivery-detail-page"><span class="flow-status">清單草稿 · 無下載</span><h2>${esc(a.title)}</h2><p>內容依目前的展示選片即時呈現，不會建立檔案或對外發布。</p>${rows}<div class="flow-actions"><button class="btn secondary" type="button" data-open-guest="${esc(a.id)}">更新展示選片</button><button class="btn primary" type="button" data-nav="delivery">完成預覽</button></div></section>`;
}
function renderProcessingSettings() {
  return `<section class="heading"><div><small class="eyebrow">WORKSPACE / PROCESSING</small><h1 data-testid="page-title">處理設定</h1><p>檢視本機展示中的影像處理供應商選項。</p></div><button class="btn secondary" type="button" data-nav="account">登入 / 帳號</button></section>
    <section class="flow-card processing-settings-shell" data-testid="processing-settings-page"><div data-processing-settings-slot></div><p class="field-note">設定目前只存在本機展示狀態。供應商、配額與 fallback 尚未連線或驗證，不會呼叫外部服務。</p></section>`;
}
function renderRecommendationSettings(a) {
  const settings = recommendationSettings(a.id);
  const matchCount = a.photos.filter((photo) =>
    recommendationCriteriaMatch(a.id, photo),
  ).length;
  const ratingOptions = Array.from({ length: 5 }, (_, index) => {
    const value = index + 1;
    return (
      '<option value="' +
      value +
      '"' +
      (settings.minRating === value ? ' selected' : '') +
      '>' +
      value +
      ' 星以上</option>'
    );
  }).join('');
  const colorOptions = Object.entries(RECOMMENDATION_COLORS)
    .map(
      ([id, color]) =>
        '<button class="recommendation-color-option' +
        (settings.color === id ? ' is-active' : '') +
        '" type="button" data-recommendation-color="' +
        id +
        '" data-testid="recommendation-color-option-' +
        id +
        '" aria-pressed="' +
        (settings.color === id) +
        '"><i style="--label-color:' +
        color.hex +
        '"></i>' +
        color.label +
        '</button>',
    )
    .join('');
  return (
    '<section class="recommendation-settings" data-testid="recommendation-settings" aria-labelledby="recommendation-settings-title"><div class="recommendation-settings-heading"><span><small class="eyebrow">PHOTOGRAPHER / RECOMMENDATION</small><h2 id="recommendation-settings-title">攝影師推薦設定</h2><p>條件即時套用在本機展示。推薦狀態與客戶選片分開計算。</p></span><b class="recommendation-match-count"><span data-testid="recommendation-match-count">' +
    matchCount +
    '</span> 張符合條件</b></div><div class="recommendation-settings-grid"><label class="recommendation-setting-toggle"><input type="checkbox" data-testid="recommendation-display-toggle" data-recommendation-setting="display"' +
    (settings.display ? ' checked' : '') +
    '><span><b>向客戶顯示攝影師推薦</b><small>關閉後隱藏客戶預覽中的推薦標記，仍可編輯評等與色標。</small></span></label><label class="recommendation-setting-toggle"><input type="checkbox" data-testid="recommendation-rating-filter-toggle" data-recommendation-setting="ratingEnabled"' +
    (settings.ratingEnabled ? ' checked' : '') +
    '><span><b>啟用最低星等</b><small>選擇要列入推薦的最低評等。</small></span></label><label class="recommendation-setting-select"><span>最低星等</span><select data-testid="recommendation-min-rating" data-recommendation-min-rating aria-label="最低星等">' +
    ratingOptions +
    '</select></label><label class="recommendation-setting-toggle"><input type="checkbox" data-testid="recommendation-color-filter-toggle" data-recommendation-setting="colorEnabled"' +
    (settings.colorEnabled ? ' checked' : '') +
    '><span><b>啟用色彩標籤</b><small>照片色標由攝影師在本機展示中指定。</small></span></label><div class="recommendation-setting-colors"><span>推薦色標門檻</span><div class="recommendation-color-options" role="group" aria-label="推薦色標門檻">' +
    colorOptions +
    '</div></div><label class="recommendation-setting-select recommendation-match-select"><span>多條件符合方式</span><select data-testid="recommendation-match-mode" data-recommendation-mode aria-label="多條件符合方式"><option value="any"' +
    (settings.match === 'any' ? ' selected' : '') +
    '>符合任一啟用條件</option><option value="all"' +
    (settings.match === 'all' ? ' selected' : '') +
    '>符合全部啟用條件</option></select></label></div><p class="recommendation-local-note" data-testid="recommendation-local-note">本機展示設定；色標與評等是合成資料，不會讀取真實上傳 metadata 或連接服務。兩項篩選都關閉時不會產生推薦。</p></section>'
  );
}
function renderAlbum() {
  const a = album(),
    pr = project(),
    all = a.photos.map((photo) => ({ project: pr, album: a, photo }));
  const visible =
    state.filter === 'selected' ? all.filter((x) => x.photo.selected) : all;
  const created =
    state.createdAlbumId === a.id
      ? '<section class="created" data-testid="created-album-card"><span class="created-icon">✓</span><span><b class="created-name">' +
        esc(a.title) +
        '</b><small>本機暫存 · 重新整理後會清除</small></span><button class="settings open-created" type="button">切換到此相簿　›</button></section>'
      : '';
  return (
    '<section class="heading"><div><small class="eyebrow">KINO PICK / ALBUM STUDIO</small><h1 data-testid="page-title">相簿工作室</h1><p>整理作品、挑選照片，預覽交付前的分享體驗。</p></div><div class="actions"><button class="btn secondary" type="button" data-open-project="' +
    pr.id +
    '">返回專案</button><button class="btn secondary" type="button" data-testid="guest-preview" data-open-guest="' +
    a.id +
    '">客戶挑片預覽</button><button class="btn secondary" type="button" data-testid="create-album">＋ 建立相簿</button><button class="btn primary" type="button" data-testid="share-album">↗ 分享相簿</button></div></section>' +
    '<section class="album"><div class="album-art scene-sunset"><span>FEATURED ALBUM</span></div><div class="album-info"><small>● 示範專案　·　交付預覽</small><h2 class="album-title">' +
    esc(a.title) +
    '</h2><p>展示客戶　<b class="client-name">' +
    esc(a.client) +
    '</b>　·　示範更新</p><div class="stats"><span><b>' +
    a.photos.length +
    '</b> 張照片</span><i></i><span><b id="selected-total">' +
    chosenCount(a) +
    '</b> 張已選</span><i></i><span>客戶選片上限 <b>12 張</b></span></div><div class="album-foot"><span class="avatars"><i>KS</i><i>DE</i><i>+1</i></span><span class="muted">◉ 僅展示視覺，不代表實際權限</span><span class="settings-note">示範相簿</span></div></div></section>' +
    created +
    renderRecommendationSettings(a) +
    '<section class="gallery-head"><div class="gallery-title"><span><h2>相片</h2><small>選取作品、加入收藏，或比較版本差異。</small></span><span class="count"><b id="selected-count">' +
    chosenCount(a) +
    '</b> 已選 / 12 張</span></div><div class="gallery-tools"><div class="tabs"><button class="tab' +
    (state.filter === 'all' ? ' active' : '') +
    '" type="button" data-filter="all">全部 <b>' +
    a.photos.length +
    '</b></button><button class="tab' +
    (state.filter === 'selected' ? ' active' : '') +
    '" type="button" data-filter="selected">已選 <b id="tab-count">' +
    chosenCount(a) +
    '</b></button></div><span class="tool-static">示範排序 · 預設</span></div></section>' +
    photoGrid(visible, { label: '示範照片' }) +
    '<footer class="gallery-foot"><span>● 合成展示視覺，非客戶照片</span><span>已顯示 ' +
    visible.length +
    ' 張示範照片</span></footer>'
  );
}
function renderGuest() {
  const a = album(),
    pr = project(),
    all = a.photos.map((photo) => ({ project: pr, album: a, photo }));
  const visible =
    state.guestFilter === 'selected'
      ? all.filter((x) => x.photo.selected)
      : all;
  const settings = recommendationSettings(a.id),
    recommended = all.filter((item) =>
      recommendationCriteriaMatch(a.id, item.photo),
    );
  const lastSubmission = latestSubmission(a.id);
  const recommendationList = settings.display
    ? '<section class="guest-recommendations" data-testid="guest-recommendations"><div class="guest-recommendation-heading"><span><small class="eyebrow">PHOTOGRAPHER PICKS / DEMO</small><h2>攝影師推薦</h2><p>這些照片僅供參考，不代表客戶已選取。</p></span><b><span data-testid="recommendation-photo-count">' +
      recommended.length +
      '</span> 張推薦</b></div><div data-testid="recommendation-photo-list">' +
      photoGrid(recommended, {
        guest: true,
        selectable: false,
        cardTestId: 'recommended-photo-card',
        label: '攝影師推薦照片',
        emptyTitle: '目前沒有符合條件的推薦照片',
        emptyCopy: '攝影師可在工作室調整星等或色標條件。',
      }) +
      '</div></section>'
    : '';
  return (
    '<section class="guest-page" data-testid="guest-pick-page"><section class="heading"><div><small class="eyebrow">KINO PICK / CLIENT PREVIEW</small><h1 data-testid="page-title">客戶挑片預覽</h1><p>模擬客戶檢視相簿與選取喜歡照片的畫面。</p></div><button class="btn secondary" type="button" data-testid="studio-return">返回工作室</button></section>' +
    '<div class="guest-warning"><span class="info">i</span><span><b>展示模式｜不會送出選片</b><small>合成展示資料只存在目前分頁記憶體，不會通知攝影師或寫入正式相簿。</small></span></div>' +
    (lastSubmission
      ? '<div class="local-confirmation-note" data-testid="previous-submission-note">已有一筆本機展示確認 · ' +
        esc(activityTime(lastSubmission.at)) +
        ' · 未送出服務</div>'
      : '') +
    '<section class="guest-album-summary"><span class="guest-album-art scene-sunset"></span><span><small>相簿展示</small><b>' +
    esc(a.title) +
    '</b><em>選取喜歡的照片，可檢視詳情或比較合成版本。</em></span><span class="guest-picked"><b>' +
    chosenCount(a) +
    '</b><small>已選 / 展示照片</small></span></section>' +
    recommendationList +
    '<div class="gallery-tools guest-gallery-tools"><div class="tabs"><button class="tab' +
    (state.guestFilter === 'all' ? ' active' : '') +
    '" type="button" data-guest-filter="all">全部 <b>' +
    a.photos.length +
    '</b></button><button class="tab' +
    (state.guestFilter === 'selected' ? ' active' : '') +
    '" type="button" data-guest-filter="selected">已選 <b>' +
    chosenCount(a) +
    '</b></button></div><span class="tool-static">客戶挑片展示</span></div>' +
    photoGrid(visible, {
      guest: true,
      label: '客戶挑片展示照片',
      emptyTitle: '目前沒有已選照片',
      emptyCopy: '回到「全部」後選取喜歡的照片。',
    }) +
    '<div class="guest-actionbar"><span><b>' +
    chosenCount(a) +
    ' 張</b> 已選取，變更只留在本機。</span><button class="btn secondary" type="button" data-testid="guest-selection-summary">檢視選片摘要</button><button class="btn secondary" type="button" data-testid="guest-confirm-selection" data-nav="selection-confirm">確認選片</button><button class="btn primary" type="button" data-testid="studio-return">返回工作室</button></div></section>'
  );
}
function renderPhoto() {
  const a = album(),
    photo = a.photos.find((item) => item.id === state.photoId),
    guest = state.returnPage === 'guest';
  const photoIndex = a.photos.findIndex((item) => item.id === state.photoId);
  if (!photo || photoIndex < 0)
    return '<div class="empty-state"><b>找不到展示照片</b><button class="btn secondary" type="button" data-back>返回上一頁</button></div>';
  const currentNumber = String(photoIndex + 1).padStart(2, '0'),
    totalNumber = String(a.photos.length).padStart(2, '0');
  const key = photoDraftKey(a.id, photo.id),
    draft = photoDraft(a.id, photo.id),
    hasDraft = draft.points.length > 0 || draft.strokes.length > 0;
  const annotationHint =
    state.annotationTool === 'point'
      ? '點擊照片可新增標註；再點一次工具按鈕即可結束標註。'
      : state.annotationTool === 'freehand'
        ? '按住並拖動畫線；完成後草稿會保留在這張照片。'
        : '點擊照片可放大；選擇標註或手繪工具後可直接在照片上操作。';
  return (
    '<section class="photo-detail-page" data-testid="photo-detail-page"><div class="photo-detail-heading"><div><small class="eyebrow">PHOTO / DEMO VISUAL</small><h1 data-testid="page-title">相片詳情</h1><p>' +
    esc(a.title) +
    '　·　' +
    esc(photo.type) +
    '</p></div><button class="btn secondary" type="button" data-back>← 返回' +
    (guest ? '客戶挑片' : '上一頁') +
    '</button></div>' +
    '<div class="photo-detail-layout"><div class="photo-view-column"><div class="photo-viewer" data-testid="photo-viewer"><div class="photo-detail-visual scene-' +
    photo.scene +
    '" data-testid="photo-canvas" data-tool="' +
    state.annotationTool +
    '" role="group" tabindex="0" aria-label="合成展示照片：' +
    esc(photo.title) +
    '"><span class="photo-demo-stamp">合成展示視覺</span><svg class="photo-markup" data-testid="annotation-layer" viewBox="0 0 150 100" preserveAspectRatio="none" role="img" aria-label="本機標註與手繪草稿">' +
    annotationMarkup(key, draft) +
    '</svg></div><div class="photo-viewer-nav"><button class="photo-step" type="button" data-photo-step="previous" data-album-id="' +
    a.id +
    '" data-testid="photo-detail-prev" aria-label="上一張照片"' +
    (photoIndex === 0 ? ' disabled' : '') +
    '>← 上一張</button><span data-testid="photo-detail-index" aria-live="polite">' +
    currentNumber +
    ' / ' +
    totalNumber +
    '</span><button class="photo-step" type="button" data-photo-step="next" data-album-id="' +
    a.id +
    '" data-testid="photo-detail-next" aria-label="下一張照片"' +
    (photoIndex === a.photos.length - 1 ? ' disabled' : '') +
    '>下一張 →</button></div></div>' +
    '<section class="annotation-panel" data-testid="annotation-panel" aria-label="本機照片註記展示"><div class="annotation-toolbar"><div class="annotation-tools"><button class="annotation-tool' +
    (state.annotationTool === 'point' ? ' is-active' : '') +
    '" type="button" data-annotation-tool="point" data-testid="annotation-tool-point" aria-pressed="' +
    (state.annotationTool === 'point') +
    '">點選標註</button><button class="annotation-tool' +
    (state.annotationTool === 'freehand' ? ' is-active' : '') +
    '" type="button" data-annotation-tool="freehand" data-testid="annotation-tool-freehand" aria-pressed="' +
    (state.annotationTool === 'freehand') +
    '">手繪</button><label class="annotation-color">顏色<input type="color" data-testid="annotation-color" aria-label="線條與標註顏色" value="' +
    safeAnnotationColor(state.annotationColor) +
    '"></label></div><div class="annotation-actions"><button class="text-action" type="button" data-toggle-photo-drafts data-testid="toggle-photo-drafts" aria-pressed="' +
    draft.visible +
    '"' +
    (hasDraft ? '' : ' disabled') +
    '>' +
    (draft.visible ? '隱藏草稿' : '顯示草稿') +
    '</button><button class="text-action clear-draft" type="button" data-clear-photo-draft data-testid="clear-photo-draft"' +
    (hasDraft ? '' : ' disabled') +
    '>清除草稿</button></div></div><p class="annotation-hint" data-testid="annotation-hint">' +
    annotationHint +
    ' 標註、手繪與顏色只保留在此分頁的這張照片。</p></section></div>' +
    '<aside class="photo-detail-info"><small>PHOTO ' +
    photo.id.slice(1) +
    '　·　JPG</small><h2>' +
    esc(photo.title) +
    '</h2><p>此畫面使用 CSS 合成視覺與展示中繼資料，沒有原始影像或客戶照片。</p><div class="photo-detail-state"><span>客戶選片</span><b>' +
    (photo.selected ? '已選取' : '尚未選取') +
    '</b></div><div class="photo-detail-actions"><button class="btn primary" type="button" data-toggle-selection="' +
    photo.id +
    '" data-album-id="' +
    a.id +
    '">' +
    (photo.selected ? '取消選取' : '選取照片') +
    '</button>' +
    (guest
      ? ''
      : '<button class="btn secondary" type="button" data-toggle-favorite="' +
        photo.id +
        '" data-album-id="' +
        a.id +
        '">' +
        (photo.favorite ? '♥ 已收藏' : '♡ 加入收藏') +
        '</button>') +
    '<button class="btn secondary" type="button" data-compare="' +
    photo.id +
    '" data-album-id="' +
    a.id +
    '">比較版本 ↔</button><button class="text-action" type="button" data-open-album="' +
    a.id +
    '">開啟相簿工作室　→</button></div>' +
    (guest
      ? ''
      : renderPhotographerRating(a.id, photo.id) +
        renderPhotoColorControl(a.id, photo.id, photo)) +
    renderPhotoRecommendationStatus(a.id, photo, guest) +
    '<div class="notice photo-demo-note">選片、收藏、評等、色標、留言和註記都只在目前分頁展示，不會送出或同步。</div></aside></div>' +
    '<section class="photo-feedback" data-testid="photo-feedback"><div class="photo-feedback-heading"><span><h2>照片留言</h2><small>新增後保留於目前分頁，並依照片分開顯示。</small></span><span class="local-only-label">本機展示</span></div><form class="photo-comment-form" data-testid="photo-comment-form"><label for="photo-comment-input">新增留言</label><textarea id="photo-comment-input" data-testid="photo-comment-input" maxlength="240" required placeholder="寫下這張照片的留言…"></textarea><div class="photo-comment-submit"><small>留言不會送到服務或通知任何人。</small><button class="btn secondary" type="submit" data-testid="photo-comment-submit">新增留言</button></div></form><div class="photo-comment-results">' +
    renderCommentList(a.id, photo.id) +
    '</div></section></section>'
  );
}
function renderPage() {
  if (state.processingSettingsMount) {
    state.processingSettings = state.processingSettingsMount.getSettings();
    state.processingSettingsMount.destroy();
    state.processingSettingsMount = null;
  }
  const renderers = {
    overview: renderOverview,
    projects: renderProjects,
    project: renderProject,
    recent: renderRecent,
    favorites: renderFavorites,
    album: renderAlbum,
    guest: renderGuest,
    photo: renderPhoto,
    account: renderAccount,
    invite: renderInviteEntry,
    'selection-confirm': renderSelectionConfirm,
    submission: renderSubmission,
    history: renderHistory,
    delivery: renderDelivery,
    'delivery-detail': renderDeliveryDetail,
    settings: renderProcessingSettings,
  };
  document.querySelector('#page-view').innerHTML = renderers[state.page]();
  if (state.page === 'settings') {
    const settingsMount = mountProcessingSettings(
      document.querySelector('[data-processing-settings-slot]'),
    );
    if (state.processingSettings)
      settingsMount.setSettings(state.processingSettings);
    state.processingSettings = settingsMount.getSettings();
    settingsMount.subscribe((settings) => {
      state.processingSettings = { ...settings };
    });
    state.processingSettingsMount = settingsMount;
  }
  const pr = project(),
    a = album(),
    crumb = [
      '<button class="crumb" type="button" data-nav="overview">工作區</button>',
    ];
  if (
    [
      'projects',
      'project',
      'album',
      'guest',
      'photo',
      'selection-confirm',
      'submission',
      'delivery',
      'delivery-detail',
    ].includes(state.page) &&
    state.page !== 'projects'
  )
    crumb.push(
      '<button class="crumb" type="button" data-nav="projects">專案與相簿</button>',
    );
  if (
    [
      'album',
      'guest',
      'photo',
      'selection-confirm',
      'submission',
      'delivery-detail',
    ].includes(state.page)
  )
    crumb.push(
      '<button class="crumb" type="button" data-open-project="' +
        pr.id +
        '">' +
        esc(pr.name) +
        '</button>',
    );
  if (
    [
      'guest',
      'photo',
      'selection-confirm',
      'submission',
      'delivery-detail',
    ].includes(state.page)
  )
    crumb.push(
      '<button class="crumb" type="button" data-open-album="' +
        a.id +
        '">' +
        esc(a.title) +
        '</button>',
    );
  const labels = {
    overview: '總覽',
    projects: '專案與相簿',
    project: pr.name,
    recent: '最近項目',
    favorites: '收藏',
    album: a.title,
    guest: '客戶挑片預覽',
    photo: '相片詳情',
    account: '登入 / 帳號',
    invite: '客戶邀請入口',
    'selection-confirm': '確認展示選片',
    submission: '展示確認記錄',
    history: '活動歷史',
    delivery: '交付展示',
    'delivery-detail': '交付清單預覽',
    settings: '處理設定',
  };
  crumb.push(
    '<span class="crumb current" aria-current="page">' +
      esc(labels[state.page]) +
      '</span>',
  );
  document.querySelector('#breadcrumbs').innerHTML = crumb.join(
    '<span class="crumb-separator">/</span>',
  );
  document
    .querySelectorAll('.sidebar-nav [data-nav], [data-account-link]')
    .forEach((button) => {
      const active = button.dataset.nav === navKey();
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  document.querySelector('.demo-banner').hidden = state.bannerDismissed;
}
function navigate(page, options = {}) {
  if (page === 'photo' && state.page !== 'photo') state.returnPage = state.page;
  if (options.projectId) {
    state.projectId = options.projectId;
    if (page === 'project')
      state.albumId = projects.find(
        (pr) => pr.id === state.projectId,
      ).albums[0].id;
  }
  if (options.albumId) {
    state.albumId = options.albumId;
    const found = albumEntry(state.albumId);
    state.projectId = found.project.id;
    found.album.updated = Date.now();
  }
  if (options.photoId) {
    if (options.photoId !== state.photoId) state.activeStroke = null;
    state.photoId = options.photoId;
  }
  if (page === 'album') state.filter = 'all';
  if (page === 'guest') state.guestFilter = 'all';
  state.page = page;
  renderPage();
  window.scrollTo(0, 0);
}
function stepPhoto(direction, albumId = state.albumId) {
  const a = albumEntry(albumId).album;
  const currentIndex = a.photos.findIndex((item) => item.id === state.photoId);
  const nextIndex = currentIndex + (direction === 'next' ? 1 : -1);
  if (currentIndex < 0 || !a.photos[nextIndex]) return;
  navigate('photo', { albumId, photoId: a.photos[nextIndex].id });
}
function photoDraftKey(albumId, photoId) {
  return albumId + ':' + photoId;
}
function photoDraft(albumId, photoId) {
  const key = photoDraftKey(albumId, photoId);
  if (!state.photoDrafts[key])
    state.photoDrafts[key] = { points: [], strokes: [], visible: true };
  return state.photoDrafts[key];
}
function safeAnnotationColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : '#c85b50';
}
function annotationMarkup(key, draft) {
  if (!draft.visible) return '';
  const strokes = draft.strokes.slice();
  if (state.activeStroke && state.activeStroke.key === key)
    strokes.push(state.activeStroke);
  const strokeMarkup = strokes
    .map((stroke) => {
      const coords = stroke.points
        .map(
          (point) =>
            (point.x * ANNOTATION_X_SCALE).toFixed(2) +
            ',' +
            point.y.toFixed(2),
        )
        .join(' ');
      return (
        '<polyline data-testid="annotation-stroke" points="' +
        coords +
        '" fill="none" stroke="' +
        safeAnnotationColor(stroke.color) +
        '" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"></polyline>'
      );
    })
    .join('');
  const pointMarkup = draft.points
    .map(
      (point, index) =>
        '<g data-testid="annotation-point"><circle cx="' +
        (point.x * ANNOTATION_X_SCALE).toFixed(2) +
        '" cy="' +
        point.y.toFixed(2) +
        '" r="2.5" fill="' +
        safeAnnotationColor(point.color) +
        '" stroke="white" stroke-width=".7"></circle><text x="' +
        (point.x * ANNOTATION_X_SCALE).toFixed(2) +
        '" y="' +
        (point.y + 1.25).toFixed(2) +
        '" text-anchor="middle" fill="white" font-size="3.5" font-weight="700">' +
        (index + 1) +
        '</text></g>',
    )
    .join('');
  return strokeMarkup + pointMarkup;
}
function refreshAnnotationLayer(visual) {
  const target =
    visual || document.querySelector('[data-testid="photo-canvas"]');
  if (!target) return;
  const layer = target.querySelector('[data-testid="annotation-layer"]');
  if (!layer) return;
  const key = photoDraftKey(state.albumId, state.photoId);
  layer.innerHTML = annotationMarkup(
    key,
    photoDraft(state.albumId, state.photoId),
  );
}
function addPhotoPoint(albumId, photoId, point) {
  const draft = photoDraft(albumId, photoId);
  draft.points.push({
    x: point.x,
    y: point.y,
    color: safeAnnotationColor(state.annotationColor),
  });
  refreshAnnotationLayer();
}
function pointerPosition(event, visual) {
  const rect = visual.getBoundingClientRect();
  return {
    x: Math.min(
      100,
      Math.max(0, ((event.clientX - rect.left) / rect.width) * 100),
    ),
    y: Math.min(
      100,
      Math.max(0, ((event.clientY - rect.top) / rect.height) * 100),
    ),
  };
}
function renderCommentList(albumId, photoId) {
  const comments = state.photoComments[photoDraftKey(albumId, photoId)] || [];
  if (!comments.length)
    return '<div class="photo-comments-empty" data-testid="photo-comments-empty">尚無留言。新增的示範留言只保留在目前分頁。</div>';
  return (
    '<ul class="photo-comment-list" data-testid="photo-comment-list" aria-live="polite">' +
    comments
      .map(
        (comment) =>
          '<li><p>' +
          esc(comment.body) +
          '</p><small>本機展示留言 · ' +
          esc(comment.createdAt) +
          '</small></li>',
      )
      .join('') +
    '</ul>'
  );
}
function renderPhotographerRating(albumId, photoId) {
  const current = photoRating(albumId, photoId);
  const stars = Array.from({ length: 5 }, (_, index) => {
    const value = index + 1;
    return (
      '<button class="rating-star' +
      (value <= current ? ' is-active' : '') +
      '" type="button" data-photo-rating="' +
      value +
      '" data-album-id="' +
      albumId +
      '" data-testid="photo-rating-star-' +
      value +
      '" aria-label="評為 ' +
      value +
      ' 星" aria-pressed="' +
      (current === value) +
      '">★</button>'
    );
  }).join('');
  return (
    '<section class="photo-rating-control" data-testid="photo-rating-control"><div class="photo-rating-heading"><span><b>攝影師評等</b><small>此照片的本機評等，與客戶選片及收藏分開。</small></span><strong data-testid="photo-rating-status" aria-live="polite">' +
    (current ? '攝影師推薦 · ' + current + ' 星' : '尚未評等') +
    '</strong></div><div class="rating-actions"><div class="rating-stars" role="group" aria-label="攝影師推薦評等">' +
    stars +
    '</div>' +
    (current
      ? '<button class="text-action rating-clear" type="button" data-photo-rating-clear data-album-id="' +
        albumId +
        '" data-testid="photo-rating-clear">清除評等</button>'
      : '') +
    '</div></section>'
  );
}
function renderPhotoColorControl(albumId, photoId, photo) {
  const colorOptions = Object.entries(RECOMMENDATION_COLORS)
    .map(
      ([id, color]) =>
        '<button class="photo-color-option' +
        (photo.colorLabel === id ? ' is-active' : '') +
        '" type="button" data-photo-color="' +
        id +
        '" data-album-id="' +
        albumId +
        '" data-photo-id="' +
        photoId +
        '" data-testid="photo-color-option-' +
        id +
        '" aria-pressed="' +
        (photo.colorLabel === id) +
        '"><i style="--label-color:' +
        color.hex +
        '"></i>' +
        color.label +
        '</button>',
    )
    .join('');
  return (
    '<section class="photo-color-control" data-testid="photo-color-control"><div class="photo-color-heading"><b>色彩標籤</b><span data-testid="photo-color-status" aria-live="polite">' +
    (photoColorName(photo) || '未設定') +
    '</span></div><div class="photo-color-options" role="group" aria-label="照片色彩標籤">' +
    colorOptions +
    '</div><div class="photo-color-footer"><small>本機展示色標，不會讀取上傳照片 metadata。</small><button class="text-action photo-color-clear" type="button" data-photo-color-clear data-album-id="' +
    albumId +
    '" data-photo-id="' +
    photoId +
    '" data-testid="photo-color-clear"' +
    (photo.colorLabel ? '' : ' disabled') +
    '>清除色標</button></div></section>'
  );
}
function renderPhotoRecommendationStatus(albumId, photo, guest) {
  const settings = recommendationSettings(albumId),
    matches = recommendationCriteriaMatch(albumId, photo),
    rating = photoRating(albumId, photo.id);
  if (guest) {
    if (!settings.display || !matches) return '';
    return (
      '<div class="photo-recommendation-state is-recommended" data-testid="photo-recommendation-status"><span>攝影師推薦</span><small class="photographer-recommendation-badge" data-testid="photographer-recommendation-badge" data-photo-id="' +
      photo.id +
      '">符合目前條件</small></div>'
    );
  }
  return (
    '<div class="photo-recommendation-state" data-testid="photo-recommendation-status"><span>推薦條件</span><b>' +
    (matches ? '符合目前條件' : '尚未符合條件') +
    '</b><small>' +
    (rating ? '評等 ' + rating + ' 星' : '尚未評等') +
    ' · ' +
    (settings.display
      ? '客戶預覽已開啟'
      : '客戶顯示已關閉；仍可編輯評等與色標') +
    '</small></div>'
  );
}
function toast(text) {
  const node = document.querySelector('.toast');
  node.textContent = text;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}
function openDialog(selector) {
  const dialog = document.querySelector(selector);
  if (dialog && !dialog.open) dialog.showModal();
}
function openPhotoLightbox() {
  const source = document.querySelector('[data-testid="photo-canvas"]'),
    dialog = document.querySelector('[data-testid="photo-lightbox"]');
  if (
    !source ||
    !dialog ||
    state.page !== 'photo' ||
    state.annotationTool !== 'view'
  )
    return;
  const photo = album().photos.find((item) => item.id === state.photoId);
  const visual = source.cloneNode(true);
  visual.removeAttribute('data-testid');
  visual.removeAttribute('tabindex');
  visual.removeAttribute('data-tool');
  visual
    .querySelectorAll('[data-testid]')
    .forEach((node) => node.removeAttribute('data-testid'));
  dialog.querySelector('.lightbox-photo').replaceChildren(visual);
  dialog.querySelector('#photo-lightbox-title').textContent = photo
    ? photo.title
    : '照片放大';
  dialog.showModal();
}
function openCreate() {
  document.querySelector('#create-form').reset();
  document.querySelector(
    '[data-testid="album-create-dialog"] .modal-head p',
  ).textContent = '新增到「' + project().name + '」的本機展示項目。';
  openDialog('[data-testid="album-create-dialog"]');
  document.querySelector('#album-name').focus();
}
function openShare() {
  const a = album(),
    form = document.querySelector('#share-form'),
    saved = a.share || {
      view: true,
      download: false,
      select: true,
      expiry: '7 天',
    };
  document.querySelector('.share-name').textContent = a.title;
  document.querySelector('.share-album small').textContent =
    '展示相簿 · ' + a.photos.length + ' 張照片';
  Array.from(form.querySelectorAll('.permissions input')).forEach(
    (input, index) => {
      input.checked = [saved.view, saved.download, saved.select][index];
    },
  );
  form.querySelector('.share-expiry').value = saved.expiry;
  document.querySelector('#share-result').textContent =
    '設定只保留在此分頁記憶體；不會送出邀請。';
  openDialog('[data-testid="share-dialog"]');
}
function compare(albumId, photoId) {
  const a = albumEntry(albumId).album,
    photo = a.photos.find((item) => item.id === photoId);
  if (!photo) return;
  document.querySelector('.compare-title').innerHTML =
    esc(photo.title) + ' <small>示範照片</small>';
  const slider = document.querySelector('[data-testid="before-after-slider"]');
  slider.value = '50';
  slider.setAttribute('aria-valuenow', '50');
  document.querySelector('.compare-stage').style.setProperty('--split', '50%');
  document.querySelector('.divider').style.left = '50%';
  document.querySelector('.slider output').textContent = '50%';
  openDialog('[data-testid="compare-dialog"]');
}
function setSelected(albumId, photoId, value) {
  const a = albumEntry(albumId).album,
    photo = a.photos.find((item) => item.id === photoId);
  if (!photo || photo.selected === value) return;
  photo.selected = value;
  a.updated = Date.now();
  const guestAction =
    state.page === 'guest' ||
    (state.page === 'photo' && state.returnPage === 'guest');
  recordActivity(
    albumId,
    (value ? '選取照片：' : '取消選取：') + photo.title,
    guestAction ? '展示客戶' : '展示攝影師',
  );
  renderPage();
}
function setFavorite(albumId, photoId) {
  const found = albumEntry(albumId),
    photo = found.album.photos.find((item) => item.id === photoId);
  if (!photo) return;
  photo.favorite = !photo.favorite;
  found.album.updated = Date.now();
  recordActivity(
    albumId,
    (photo.favorite ? '加入收藏：' : '取消收藏：') + photo.title,
  );
  renderPage();
}
function selectionSummary() {
  const a = album(),
    list = a.photos.filter((photo) => photo.selected);
  document.querySelector('#guest-summary-content').innerHTML =
    '<p class="summary-count">「' +
    esc(a.title) +
    '」目前選了 <b>' +
    list.length +
    '</b> 張展示照片。</p>' +
    (list.length
      ? '<ul class="summary-photo-list">' +
        list
          .map(
            (p) =>
              '<li><span class="scene-dot scene-' +
              p.scene +
              '"></span><span>' +
              esc(p.title) +
              '</span><small>' +
              esc(p.type) +
              '</small></li>',
          )
          .join('') +
        '</ul>'
      : '<div class="empty-state compact"><b>目前沒有已選照片</b><small>返回展示後可勾選喜歡的照片。</small></div>');
  openDialog('[data-testid="guest-summary-dialog"]');
}
function confirmSelectionForDemo() {
  const a = album(),
    selected = a.photos.filter((photo) => photo.selected);
  if (!selected.length) {
    toast('請先選取照片，再確認本機展示選片。');
    return;
  }
  const item = {
    id: state.submissions.length + 1,
    albumId: a.id,
    count: selected.length,
    photoIds: selected.map((photo) => photo.id),
    photoTitles: selected.map((photo) => photo.title),
    at: Date.now(),
  };
  state.submissions.unshift(item);
  recordActivity(
    a.id,
    '本機展示選片確認：' + selected.length + ' 張照片',
    '展示客戶',
  );
  navigate('submission');
}

app.innerHTML = [
  '<div class="shell"><aside class="sidebar"><div class="brand"><span class="brandmark">K</span><span><b>KINO</b><small>PICK STUDIO</small></span></div><div class="workspace"><span class="workspace-mark">K</span><span><b>示範工作區</b><small>本機展示</small></span></div><p class="nav-label">工作空間</p><nav class="sidebar-nav" aria-label="工作空間導覽"><button class="nav-item-text" type="button" data-nav="overview">⌂　總覽</button><button class="nav-item-text" type="button" data-nav="projects">▦　專案</button><button class="nav-item-text" type="button" data-nav="recent">◷　最近項目</button><button class="nav-item-text" type="button" data-nav="favorites">♡　收藏</button><button class="nav-item-text" type="button" data-nav="invite">◇　客戶邀請</button><button class="nav-item-text" type="button" data-nav="history">◷　活動歷史</button><button class="nav-item-text" type="button" data-nav="delivery">↗　交付展示</button><button class="nav-item-text" type="button" data-nav="settings">⚙　處理設定</button><button class="nav-item-text" type="button" data-nav="account">◉　帳號</button></nav><div class="side-bottom"><span class="live-dot"></span><span>示範模式<br><b>未連接正式服務</b></span></div><button class="profile profile-link" type="button" data-nav="account" data-account-link aria-label="登入與帳號"><span>KS</span><b>KINO Studio</b><small>本機展示帳號</small></button></aside>',
  '<main class="main"><header class="topbar"><div id="breadcrumbs" class="breadcrumbs" aria-label="目前位置"></div><div class="toptools"><span class="connection">● 本機展示 · 未連線</span><button class="help" type="button" aria-label="展示說明">?</button></div></header><section class="content"><div class="demo-banner" data-testid="demo-banner"><span class="info">i</span><span><b>互動展示資料</b><small>只在此分頁暫存，不會連到客戶資料或建立正式分享連結。</small></span><button class="banner-close" type="button" aria-label="收合說明">×</button></div><div id="page-view"></div></section></main></div>',
  '<dialog class="modal" data-testid="album-create-dialog" aria-labelledby="create-title"><form id="create-form"><div class="modal-head"><div><small class="eyebrow">NEW ALBUM / DEMO</small><h2 id="create-title">建立相簿</h2><p>新增本機展示項目。</p></div><button class="close" type="button" data-close aria-label="關閉">×</button></div><div class="notice">ⓘ　合成展示資料，不會儲存到服務或寄送邀請。</div><label for="album-name">相簿名稱 <em>*</em></label><input id="album-name" required maxlength="40" placeholder="例如：夏日婚禮紀錄" data-testid="album-name-input"><label for="client-name">客戶名稱 <small>選填</small></label><input id="client-name" maxlength="32" placeholder="輸入展示名稱"><button class="advanced" type="button" aria-expanded="false"><span>＋</span> 進階設定 <small>選片與分享預設</small><b>⌄</b></button><div class="advanced-panel" hidden><p class="advanced-copy">正式相簿可設定客戶選片上限與下載權限；此展示不會套用或儲存這些規則。</p></div><div class="modal-actions"><button class="btn secondary" type="button" data-close>取消</button><button class="btn primary" type="submit" data-testid="create-album-submit">建立展示相簿　→</button></div></form></dialog>',
  '<dialog class="modal share-modal" data-testid="share-dialog" aria-labelledby="share-title"><form id="share-form"><div class="modal-head"><div><small class="eyebrow">SHARE PREVIEW / LOCAL ONLY</small><h2 id="share-title">分享相簿</h2><p>預覽邀請設定與訪客看到的內容。</p></div><button class="close" type="button" data-close aria-label="關閉">×</button></div><div class="share-album"><span class="share-art scene-sunset"></span><span><b class="share-name">春日婚禮・林間紀錄</b><small>展示相簿 · 8 張照片</small></span><i class="connection">● 未連線</i></div><div class="notice warn"><span>!</span><span><b>不會產生正式分享連結</b><small>此視窗只暫存本機展示選項，沒有連接邀請服務。</small></span></div><div class="section-label">訪客權限 <small>展示用設定</small></div><div class="permissions"><label><span>◉　<b>檢視相片</b><small>查看展示照片</small></span><input type="checkbox" checked></label><label><span>↓　<b>下載相片</b><small>不提供實際下載</small></span><input type="checkbox"></label><label><span>♡　<b>收藏與挑選</b><small>在頁面選取喜歡的照片</small></span><input type="checkbox" checked></label></div><div class="share-settings"><label>有效期限<select class="share-expiry" aria-label="有效期限"><option>7 天</option><option>14 天</option><option>30 天</option><option>不設定</option></select></label><span class="share-password-note"><b>密碼保護</b><small>正式連線後設定</small></span></div><div class="fake-link"><span>↗</span><b>分享連結尚未建立</b><small>正式連線後才能建立並傳送邀請。</small></div><div class="modal-actions"><button class="btn secondary" type="button" data-close>返回相簿</button><button class="btn primary" type="submit" data-testid="save-share-preview">保留展示設定　→</button></div><p class="footnote" id="share-result" aria-live="polite">設定只保留在此分頁記憶體；不會送出邀請。</p></form></dialog>',
  '<dialog class="modal compare-modal" data-testid="compare-dialog" aria-labelledby="compare-dialog-title"><div class="modal-head"><div><small class="eyebrow">BEFORE / AFTER · DEMO ART</small><h2 id="compare-dialog-title">版本比較</h2><p class="compare-title">窗邊的晨光 <small>示範照片</small></p></div><button class="close" type="button" data-close aria-label="關閉">×</button></div><div class="compare-stage" data-testid="compare-stage"><div class="compare-before"></div><div class="compare-after"></div><div class="divider"><span>↔</span></div><span class="before-label">BEFORE</span><span class="after-label">AFTER</span><span class="demo-stamp">合成展示視覺</span></div><div class="slider"><span>BEFORE</span><input type="range" min="0" max="100" value="50" aria-valuenow="50" aria-label="調整前後照片比例" data-testid="before-after-slider"><span>AFTER</span><output>50%</output></div><div class="compare-foot"><span><b>拖動滑桿比較兩個展示版本</b><small>合成視覺不代表實際修圖成果。</small></span><button class="btn secondary" type="button" data-close>完成</button></div></dialog>',
  '<dialog class="modal photo-lightbox" data-testid="photo-lightbox" aria-labelledby="photo-lightbox-title"><div class="lightbox-head"><h2 id="photo-lightbox-title">照片放大</h2><button class="close" type="button" data-close aria-label="關閉放大照片">×</button></div><div class="lightbox-photo"></div><p>合成展示視覺 · 按 Esc 或點選背景關閉</p></dialog>',
  '<dialog class="modal summary-modal" data-testid="guest-summary-dialog" aria-labelledby="guest-summary-title"><div class="modal-head"><div><small class="eyebrow">SELECTION SUMMARY / DEMO</small><h2 id="guest-summary-title">展示選片摘要</h2><p>此清單只讀取目前分頁中的展示選取狀態。</p></div><button class="close" type="button" data-close aria-label="關閉">×</button></div><div id="guest-summary-content"></div><div class="notice warn"><span>!</span><span><b>不會送出或通知任何人</b><small>重新整理後本機狀態會清除。</small></span></div><div class="modal-actions"><button class="btn primary" type="button" data-close>返回展示</button></div></dialog><div class="toast" role="status" aria-live="polite"></div>',
].join('');

app.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null,
    button = target && target.closest('button');
  if (!button) {
    if (
      target &&
      target.closest('[data-testid="photo-canvas"]') &&
      state.annotationTool === 'view'
    )
      openPhotoLightbox();
    return;
  }
  if (button.matches('[data-close]')) {
    button.closest('dialog').close();
    return;
  }
  if (button.matches('[data-nav]')) {
    navigate(button.dataset.nav);
    return;
  }
  if (button.matches('[data-create-in-project]')) {
    state.projectId = button.dataset.createInProject;
    openCreate();
    return;
  }
  if (button.matches('[data-testid="create-album"]')) {
    openCreate();
    return;
  }
  if (button.matches('[data-testid="share-album"]')) {
    openShare();
    return;
  }
  if (button.matches('[data-open-guest]')) {
    navigate('guest', { albumId: button.dataset.openGuest });
    return;
  }
  if (button.matches('[data-open-invite]')) {
    const select = document.querySelector('[data-invite-album]'),
      id = select && select.value;
    if (!id || !entries().some((item) => item.album.id === id)) {
      toast('請選擇一份展示相簿。');
      return;
    }
    state.inviteAlbumId = id;
    navigate('guest', { albumId: id });
    return;
  }
  if (button.matches('[data-delivery-preview]')) {
    state.deliveryAlbumId = button.dataset.deliveryPreview;
    navigate('delivery-detail', { albumId: state.deliveryAlbumId });
    return;
  }
  if (button.matches('[data-confirm-selection]')) {
    confirmSelectionForDemo();
    return;
  }
  if (button.matches('[data-testid="studio-return"]')) {
    navigate('album');
    return;
  }
  if (button.matches('[data-testid="guest-selection-summary"]')) {
    selectionSummary();
    return;
  }
  if (button.matches('[data-open-project]')) {
    navigate('project', { projectId: button.dataset.openProject });
    return;
  }
  if (button.matches('[data-open-album]')) {
    navigate('album', { albumId: button.dataset.openAlbum });
    return;
  }
  if (button.matches('[data-open-photo]')) {
    navigate('photo', {
      albumId: button.dataset.albumId,
      photoId: button.dataset.openPhoto,
    });
    return;
  }
  if (button.matches('[data-photo-step]')) {
    stepPhoto(button.dataset.photoStep, button.dataset.albumId);
    return;
  }
  if (button.matches('[data-photo-rating]')) {
    const ratingKey = photoDraftKey(button.dataset.albumId, state.photoId),
      rating = Number(button.dataset.photoRating);
    if (state.photoRatings[ratingKey] === rating)
      delete state.photoRatings[ratingKey];
    else state.photoRatings[ratingKey] = rating;
    recordActivity(
      button.dataset.albumId,
      (state.photoRatings[ratingKey]
        ? '評等照片 ' + state.photoRatings[ratingKey] + ' 星：'
        : '清除照片評等：') + state.photoId,
    );
    renderPage();
    return;
  }
  if (button.matches('[data-photo-rating-clear]')) {
    delete state.photoRatings[
      photoDraftKey(button.dataset.albumId, state.photoId)
    ];
    recordActivity(button.dataset.albumId, '清除照片評等：' + state.photoId);
    renderPage();
    return;
  }
  if (button.matches('[data-recommendation-color]')) {
    recommendationSettings(state.albumId).color =
      button.dataset.recommendationColor;
    renderPage();
    return;
  }
  if (button.matches('[data-photo-color]')) {
    const photo = albumEntry(button.dataset.albumId).album.photos.find(
      (item) => item.id === button.dataset.photoId,
    );
    if (photo && RECOMMENDATION_COLORS[button.dataset.photoColor]) {
      photo.colorLabel = button.dataset.photoColor;
      recordActivity(button.dataset.albumId, '更新照片色標：' + photo.title);
    }
    renderPage();
    return;
  }
  if (button.matches('[data-photo-color-clear]')) {
    const photo = albumEntry(button.dataset.albumId).album.photos.find(
      (item) => item.id === button.dataset.photoId,
    );
    if (photo) {
      photo.colorLabel = null;
      recordActivity(button.dataset.albumId, '清除照片色標：' + photo.title);
    }
    renderPage();
    return;
  }
  if (button.matches('[data-annotation-tool]')) {
    const tool = button.dataset.annotationTool;
    state.annotationTool = state.annotationTool === tool ? 'view' : tool;
    state.activeStroke = null;
    renderPage();
    return;
  }
  if (button.matches('[data-toggle-photo-drafts]')) {
    const draft = photoDraft(state.albumId, state.photoId);
    draft.visible = !draft.visible;
    renderPage();
    return;
  }
  if (button.matches('[data-clear-photo-draft]')) {
    const draft = photoDraft(state.albumId, state.photoId);
    draft.points = [];
    draft.strokes = [];
    state.activeStroke = null;
    renderPage();
    toast('已清除此照片的本機標註草稿。');
    return;
  }
  if (button.matches('[data-compare]')) {
    compare(button.dataset.albumId || state.albumId, button.dataset.compare);
    return;
  }
  if (button.matches('[data-favorite]')) {
    setFavorite(button.dataset.albumId, button.dataset.favorite);
    return;
  }
  if (button.matches('[data-toggle-favorite]')) {
    setFavorite(button.dataset.albumId, button.dataset.toggleFavorite);
    return;
  }
  if (button.matches('[data-toggle-selection]')) {
    const p = albumEntry(button.dataset.albumId).album.photos.find(
      (item) => item.id === button.dataset.toggleSelection,
    );
    if (p) setSelected(button.dataset.albumId, p.id, !p.selected);
    return;
  }
  if (button.matches('[data-filter]')) {
    state.filter = button.dataset.filter;
    renderPage();
    return;
  }
  if (button.matches('[data-guest-filter]')) {
    state.guestFilter = button.dataset.guestFilter;
    renderPage();
    return;
  }
  if (button.matches('[data-back]')) {
    navigate(state.returnPage, { albumId: state.albumId });
    return;
  }
  if (button.matches('.open-created')) {
    navigate('album', { albumId: state.createdAlbumId });
    return;
  }
  if (button.matches('.advanced')) {
    const panel = document.querySelector('.advanced-panel'),
      expanded = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
    button.querySelector('span').textContent = expanded ? '＋' : '−';
    return;
  }
  if (button.matches('.banner-close')) {
    state.bannerDismissed = true;
    document.querySelector('.demo-banner').hidden = true;
    return;
  }
  if (button.matches('.help'))
    toast('所有資料只存在目前分頁記憶體；重新整理後會清除。');
});
app.addEventListener('submit', (event) => {
  const form = event.target instanceof HTMLFormElement ? event.target : null;
  if (!form || !form.matches('[data-testid="photo-comment-form"]')) return;
  event.preventDefault();
  const input = form.querySelector('[data-testid="photo-comment-input"]'),
    body = input.value.trim();
  if (!body || state.page !== 'photo') return;
  const key = photoDraftKey(state.albumId, state.photoId);
  if (!state.photoComments[key]) state.photoComments[key] = [];
  state.photoComments[key].push({
    id: state.nextCommentId++,
    body,
    createdAt: new Date().toLocaleTimeString(),
  });
  recordActivity(
    state.albumId,
    '新增照片留言：' + state.photoId,
    state.returnPage === 'guest' ? '展示客戶' : '展示攝影師',
  );
  renderPage();
  document.querySelector('[data-testid="photo-comment-input"]').focus();
});
app.addEventListener('input', (event) => {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (input && input.matches('[data-testid="annotation-color"]'))
    state.annotationColor = safeAnnotationColor(input.value);
});
app.addEventListener('pointerdown', (event) => {
  const target = event.target instanceof Element ? event.target : null,
    visual = target && target.closest('[data-testid="photo-canvas"]');
  if (
    !visual ||
    state.page !== 'photo' ||
    (event.pointerType === 'mouse' && event.button !== 0)
  )
    return;
  const point = pointerPosition(event, visual);
  if (state.annotationTool === 'point') {
    event.preventDefault();
    addPhotoPoint(state.albumId, state.photoId, point);
    return;
  }
  if (state.annotationTool !== 'freehand') return;
  event.preventDefault();
  visual.setPointerCapture(event.pointerId);
  state.activeStroke = {
    key: photoDraftKey(state.albumId, state.photoId),
    pointerId: event.pointerId,
    color: safeAnnotationColor(state.annotationColor),
    points: [point],
  };
  refreshAnnotationLayer(visual);
});
app.addEventListener('pointermove', (event) => {
  const active = state.activeStroke;
  if (!active || event.pointerId !== active.pointerId || state.page !== 'photo')
    return;
  const visual = document.querySelector('[data-testid="photo-canvas"]');
  if (!visual || active.key !== photoDraftKey(state.albumId, state.photoId))
    return;
  event.preventDefault();
  const point = pointerPosition(event, visual),
    previous = active.points[active.points.length - 1];
  if (
    active.points.length >= 300 ||
    Math.hypot(point.x - previous.x, point.y - previous.y) < 0.35
  )
    return;
  active.points.push(point);
  refreshAnnotationLayer(visual);
});
app.addEventListener('pointerup', (event) => {
  const active = state.activeStroke;
  if (!active || event.pointerId !== active.pointerId) return;
  if (
    state.page === 'photo' &&
    active.key === photoDraftKey(state.albumId, state.photoId)
  ) {
    const draft = photoDraft(state.albumId, state.photoId);
    if (active.points.length === 1) active.points.push({ ...active.points[0] });
    draft.strokes.push({ color: active.color, points: active.points });
  }
  state.activeStroke = null;
  refreshAnnotationLayer();
});
app.addEventListener('pointercancel', (event) => {
  if (!state.activeStroke || event.pointerId !== state.activeStroke.pointerId)
    return;
  state.activeStroke = null;
  refreshAnnotationLayer();
});
app.addEventListener('keydown', (event) => {
  const target = event.target instanceof Element ? event.target : null,
    visual = target && target.closest('[data-testid="photo-canvas"]');
  if (!visual || (event.key !== 'Enter' && event.key !== ' ')) return;
  if (state.annotationTool === 'view') {
    event.preventDefault();
    openPhotoLightbox();
    return;
  }
  if (state.annotationTool !== 'point') return;
  event.preventDefault();
  addPhotoPoint(state.albumId, state.photoId, { x: 50, y: 50 });
});
app.addEventListener('change', (event) => {
  const input =
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement
      ? event.target
      : null;
  if (!input) return;
  if (input.matches('[data-history-filter]')) {
    state.historyFilter = input.value;
    renderPage();
    return;
  }
  if (input.matches('[data-recommendation-setting]')) {
    const setting = input.dataset.recommendationSetting;
    if (
      setting === 'display' ||
      setting === 'ratingEnabled' ||
      setting === 'colorEnabled'
    )
      recommendationSettings(state.albumId)[setting] = input.checked;
    renderPage();
    return;
  }
  if (input.matches('[data-recommendation-min-rating]')) {
    recommendationSettings(state.albumId).minRating = Number(input.value);
    renderPage();
    return;
  }
  if (input.matches('[data-recommendation-mode]')) {
    recommendationSettings(state.albumId).match =
      input.value === 'all' ? 'all' : 'any';
    renderPage();
    return;
  }
  if (input.matches('[data-select]'))
    setSelected(input.dataset.albumId, input.dataset.select, input.checked);
});
app.addEventListener('input', (event) => {
  const input = event.target instanceof HTMLInputElement ? event.target : null;
  if (!input || !input.matches('[data-testid="before-after-slider"]')) return;
  const value = Number(input.value);
  document
    .querySelector('.compare-stage')
    .style.setProperty('--split', value + '%');
  document.querySelector('.divider').style.left = value + '%';
  document.querySelector('.slider output').textContent = value + '%';
  input.setAttribute('aria-valuenow', String(value));
});
app.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  if (form.id === 'create-form') {
    const name = document.querySelector('#album-name').value.trim();
    if (!name) return;
    const a = {
      id: 'album-demo-' + state.nextAlbum++,
      title: name,
      client:
        document.querySelector('#client-name').value.trim() || '未命名展示客戶',
      photos: photos(),
      updated: Date.now(),
      share: null,
    };
    const pr =
      projects.find((item) => item.id === state.projectId) || project();
    pr.albums.unshift(a);
    recordActivity(a.id, '建立展示相簿：' + a.title);
    state.albumId = a.id;
    state.createdAlbumId = a.id;
    state.page = 'album';
    state.filter = 'all';
    renderPage();
    document.querySelector('[data-testid="album-create-dialog"]').close();
    toast('展示相簿已暫存在本機記憶體，重新整理後會清除。');
    return;
  }
  if (form.id === 'share-form') {
    const a = album(),
      values = Array.from(form.querySelectorAll('.permissions input')).map(
        (input) => input.checked,
      );
    a.share = {
      view: values[0],
      download: values[1],
      select: values[2],
      expiry: form.querySelector('.share-expiry').value,
    };
    recordActivity(a.id, '更新本機分享預覽設定');
    const summary =
      '檢視 ' +
      (values[0] ? '開啟' : '關閉') +
      ' · 下載 ' +
      (values[1] ? '開啟' : '關閉') +
      ' · 挑選 ' +
      (values[2] ? '開啟' : '關閉') +
      ' · 期限 ' +
      a.share.expiry;
    document.querySelector('#share-result').textContent =
      '本機展示設定已保留：' + summary + '。未連線，不會產生正式分享連結。';
    toast('本機展示設定已保留：' + summary + '。');
    return;
  }
  if (form.id === 'account-form') {
    const displayName = form
        .querySelector('[data-account-display-name]')
        .value.trim(),
      workspaceName = form
        .querySelector('[data-account-workspace-name]')
        .value.trim();
    if (!displayName || !workspaceName) return;
    state.account = { displayName, workspaceName };
    recordActivity(state.albumId, '更新本機展示帳號與工作區名稱');
    renderPage();
    const profileName = document.querySelector('[data-account-link] b'),
      workspaceNameNode = document.querySelector('.workspace b');
    if (profileName) profileName.textContent = displayName;
    if (workspaceNameNode) workspaceNameNode.textContent = workspaceName;
    toast('本機展示資料已更新；沒有進行正式登入。');
  }
});
document.querySelectorAll('dialog').forEach((dialog) =>
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  }),
);
renderPage();

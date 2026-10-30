export const PROCESSING_MODES = Object.freeze({
  ORACLE_FIRST: 'oracle-first',
  CLOUDFLARE_FIRST: 'cloudflare-first',
  ORACLE_ONLY: 'oracle-only',
  CLOUDFLARE_ONLY: 'cloudflare-only',
});

export const PROCESSING_MODE_OPTIONS = Object.freeze([
  Object.freeze({
    value: PROCESSING_MODES.ORACLE_FIRST,
    label: 'Oracle VM 優先',
    description:
      '先選 Oracle VM；可選擇逾時後改由 Cloudflare 圖片處理服務備援。',
  }),
  Object.freeze({
    value: PROCESSING_MODES.CLOUDFLARE_FIRST,
    label: 'Cloudflare 優先',
    description: '先選 Cloudflare 圖片處理服務；Oracle VM 為另一候選。',
  }),
  Object.freeze({
    value: PROCESSING_MODES.ORACLE_ONLY,
    label: '僅 Oracle VM',
    description: '只選 Oracle VM，不切換到 Cloudflare 圖片處理服務。',
  }),
  Object.freeze({
    value: PROCESSING_MODES.CLOUDFLARE_ONLY,
    label: '僅 Cloudflare 圖片處理',
    description: '只選 Cloudflare 圖片處理服務，不切換到 Oracle VM。',
  }),
]);

export const DEFAULT_PROCESSING_SETTINGS = Object.freeze({
  mode: PROCESSING_MODES.CLOUDFLARE_FIRST,
  cloudflareFallbackEnabled: false,
  cloudflareMonthlyLimit: 5000,
  fallbackWaitMinutes: 5,
});

const VALID_MODES = new Set(
  PROCESSING_MODE_OPTIONS.map((option) => option.value),
);
const MIN_CLOUDFLARE_LIMIT = 0;
const MAX_CLOUDFLARE_LIMIT = 1000000;
const MIN_FALLBACK_WAIT_MINUTES = 1;
const MAX_FALLBACK_WAIT_MINUTES = 240;
let mountSequence = 0;

function normalizeInteger(value, fallback, minimum, maximum) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numericValue)));
}

function normalizeSettings(input = {}, fallback = DEFAULT_PROCESSING_SETTINGS) {
  return {
    mode: VALID_MODES.has(input.mode) ? input.mode : fallback.mode,
    cloudflareFallbackEnabled:
      typeof input.cloudflareFallbackEnabled === 'boolean'
        ? input.cloudflareFallbackEnabled
        : fallback.cloudflareFallbackEnabled,
    cloudflareMonthlyLimit: normalizeInteger(
      input.cloudflareMonthlyLimit,
      fallback.cloudflareMonthlyLimit,
      MIN_CLOUDFLARE_LIMIT,
      MAX_CLOUDFLARE_LIMIT,
    ),
    fallbackWaitMinutes: normalizeInteger(
      input.fallbackWaitMinutes,
      fallback.fallbackWaitMinutes,
      MIN_FALLBACK_WAIT_MINUTES,
      MAX_FALLBACK_WAIT_MINUTES,
    ),
  };
}

function snapshot(settings) {
  return Object.freeze({ ...settings });
}

function ensureStylesheet(documentRef) {
  const stylesheetUrl = new URL('./processing-settings.css', import.meta.url)
    .href;
  const alreadyLoaded = Array.from(
    documentRef.querySelectorAll('link[data-processing-settings-styles]'),
  ).some((link) => link.href === stylesheetUrl);

  if (alreadyLoaded) return;

  const link = documentRef.createElement('link');
  link.rel = 'stylesheet';
  link.href = stylesheetUrl;
  link.dataset.processingSettingsStyles = 'true';
  (documentRef.head || documentRef.documentElement).append(link);
}

/**
 * Mount a local-only processing-priority panel inside an existing DOM element.
 *
 * @param {HTMLElement|string} target An element, or a selector resolved in the current document.
 * @param {{initialSettings?: Partial<typeof DEFAULT_PROCESSING_SETTINGS>, onChange?: (settings: object) => void}} [options]
 * @returns {{root: HTMLElement, getSettings: () => object, setSettings: (patch: object) => object, subscribe: (listener: (settings: object) => void) => () => void, destroy: () => void}}
 *
 * Example:
 *   const panel = mountProcessingSettings(document.querySelector('#processing-settings'));
 *   const unsubscribe = panel.subscribe((settings) => console.log(settings));
 */
export function mountProcessingSettings(target, options = {}) {
  options = options || {};
  const currentDocument = typeof document === 'undefined' ? null : document;
  const host =
    typeof target === 'string'
      ? currentDocument?.querySelector(target)
      : target;

  if (!host || host.nodeType !== 1 || !host.ownerDocument) {
    throw new TypeError('mountProcessingSettings 需要一個有效的 DOM 容器。');
  }

  const documentRef = host.ownerDocument;
  const id = 'processing-settings-' + ++mountSequence;
  const modeName = id + '-mode';
  let settings = normalizeSettings(options.initialSettings || {});
  let destroyed = false;
  const listeners = new Set();

  ensureStylesheet(documentRef);

  const root = documentRef.createElement('section');
  root.className = 'processing-settings';
  root.dataset.processingSettings = 'true';
  root.setAttribute('aria-labelledby', id + '-title');
  root.innerHTML = [
    '<header class="processing-settings__header">',
    '  <div>',
    '    <p class="processing-settings__eyebrow">KINO PICK / LOCAL DEMO</p>',
    '    <h2 id="' + id + '-title">影像處理優先順序</h2>',
    '    <p class="processing-settings__intro">選擇本機展示用的處理候選順序。</p>',
    '  </div>',
    '  <span class="processing-settings__demo-badge">本機 Demo</span>',
    '</header>',
    '<form class="processing-settings__form" aria-label="影像處理設定 ' +
      id +
      '">',
    '  <fieldset class="processing-settings__mode-picker">',
    '    <legend>處理模式</legend>',
    '    <div class="processing-settings__mode-grid">',
    ...PROCESSING_MODE_OPTIONS.map((option, index) =>
      [
        '      <label class="processing-settings__mode-option" for="' +
          id +
          '-mode-' +
          index +
          '">',
        '        <input id="' +
          id +
          '-mode-' +
          index +
          '" type="radio" name="' +
          modeName +
          '" value="' +
          option.value +
          '" data-setting="mode">',
        '        <span class="processing-settings__mode-card">',
        '          <strong>' + option.label + '</strong>',
        '          <small>' + option.description + '</small>',
        '        </span>',
        '      </label>',
      ].join(''),
    ),
    '    </div>',
    '  </fieldset>',
    '  <section class="processing-settings__fallback" aria-labelledby="' +
      id +
      '-fallback-title">',
    '    <div class="processing-settings__section-heading">',
    '      <h3 id="' + id + '-fallback-title">Cloudflare 圖片處理自動備援</h3>',
    '      <small data-fallback-context>Oracle VM 優先模式可選擇等待後改用 Cloudflare 圖片處理服務。</small>',
    '    </div>',
    '    <label class="processing-settings__toggle" for="' + id + '-fallback">',
    '      <input id="' +
      id +
      '-fallback" type="checkbox" data-setting="cloudflareFallbackEnabled">',
    '      <span>',
    '        <strong>Oracle VM 等待後改由 Cloudflare 圖片處理服務備援</strong>',
    '        <small>預設關閉；只有 Oracle VM 優先模式會使用這項設定。</small>',
    '      </span>',
    '    </label>',
    '    <div class="processing-settings__limits" data-fallback-controls>',
    '      <label class="processing-settings__field" for="' +
      id +
      '-monthly-limit">',
    '        <span>Cloudflare 圖片處理月用量上限</span>',
    '        <span class="processing-settings__input-row">',
    '          <input id="' +
      id +
      '-monthly-limit" type="number" min="' +
      MIN_CLOUDFLARE_LIMIT +
      '" max="' +
      MAX_CLOUDFLARE_LIMIT +
      '" step="1" inputmode="numeric" data-setting="cloudflareMonthlyLimit">',
    '          <small>次 / 月</small>',
    '        </span>',
    '        <small>展示用門檻，不代表服務額度；達上限時不使用此處理服務。</small>',
    '      </label>',
    '      <label class="processing-settings__field" for="' +
      id +
      '-wait-minutes">',
    '        <span>Oracle VM 等待多久後備援</span>',
    '        <span class="processing-settings__input-row">',
    '          <input id="' +
      id +
      '-wait-minutes" type="number" min="' +
      MIN_FALLBACK_WAIT_MINUTES +
      '" max="' +
      MAX_FALLBACK_WAIT_MINUTES +
      '" step="1" inputmode="numeric" data-setting="fallbackWaitMinutes">',
    '          <small>分鐘</small>',
    '        </span>',
    '        <small>本機規則值；不會實際啟動或排程處理任務。</small>',
    '      </label>',
    '    </div>',
    '  </section>',
    '  <section class="processing-settings__providers" aria-labelledby="' +
      id +
      '-providers-title">',
    '    <div class="processing-settings__section-heading">',
    '      <h3 id="' + id + '-providers-title">影像處理候選狀態</h3>',
    '      <small>狀態只展示，不會探測連線。</small>',
    '    </div>',
    '    <ul class="processing-settings__provider-list">',
    '      <li>',
    '        <span class="processing-settings__provider-name">Oracle VM</span>',
    '        <span class="processing-settings__status">未連線 · 未驗證</span>',
    '      </li>',
    '      <li>',
    '        <span class="processing-settings__provider-name">Cloudflare 圖片處理服務</span>',
    '        <span class="processing-settings__status">未連線 · 未驗證</span>',
    '      </li>',
    '    </ul>',
    '  </section>',
    '  <p class="processing-settings__local-note">R2 僅作檔案儲存，不是影像處理服務或候選；本元件不會設定或檢查 R2。設定只存在目前頁面的記憶體，重整後還原預設；此元件不會連線或處理照片。</p>',
    '</form>',
  ].join('');

  const form = root.querySelector('form');
  const modeInputs = Array.from(root.querySelectorAll('[data-setting="mode"]'));
  const fallbackInput = root.querySelector(
    '[data-setting="cloudflareFallbackEnabled"]',
  );
  const monthlyLimitInput = root.querySelector(
    '[data-setting="cloudflareMonthlyLimit"]',
  );
  const waitMinutesInput = root.querySelector(
    '[data-setting="fallbackWaitMinutes"]',
  );
  const fallbackContext = root.querySelector('[data-fallback-context]');

  function applySettingsToControls() {
    if (destroyed) return;

    modeInputs.forEach((input) => {
      input.checked = input.value === settings.mode;
    });
    fallbackInput.checked = settings.cloudflareFallbackEnabled;
    monthlyLimitInput.value = String(settings.cloudflareMonthlyLimit);
    waitMinutesInput.value = String(settings.fallbackWaitMinutes);

    const isOracleFirst = settings.mode === PROCESSING_MODES.ORACLE_FIRST;
    const cloudflareIsCandidate =
      settings.mode !== PROCESSING_MODES.ORACLE_ONLY;
    const canUseCloudflareFallback =
      isOracleFirst && settings.cloudflareFallbackEnabled;

    fallbackInput.disabled = !isOracleFirst;
    monthlyLimitInput.disabled =
      !cloudflareIsCandidate ||
      (isOracleFirst && !settings.cloudflareFallbackEnabled);
    waitMinutesInput.disabled = !canUseCloudflareFallback;

    if (isOracleFirst) {
      fallbackContext.textContent =
        'Oracle VM 優先模式可選擇等待後改用 Cloudflare 圖片處理服務。';
    } else if (settings.mode === PROCESSING_MODES.CLOUDFLARE_FIRST) {
      fallbackContext.textContent =
        'Cloudflare 圖片處理服務已是第一候選；月用量上限仍適用。';
    } else if (settings.mode === PROCESSING_MODES.CLOUDFLARE_ONLY) {
      fallbackContext.textContent =
        '僅使用 Cloudflare 圖片處理服務；月用量上限仍適用。';
    } else {
      fallbackContext.textContent =
        '僅使用 Oracle VM；Cloudflare 圖片處理設定目前停用。';
    }
  }

  function notifyChange() {
    const value = snapshot(settings);
    const CustomEventConstructor = documentRef.defaultView?.CustomEvent;
    if (CustomEventConstructor) {
      root.dispatchEvent(
        new CustomEventConstructor('processing-settings-change', {
          bubbles: true,
          detail: { settings: value },
        }),
      );
    }
    if (typeof options.onChange === 'function') options.onChange(value);
    listeners.forEach((listener) => listener(value));
  }

  function handleFormChange(event) {
    const changedControl = event.target;
    if (!(changedControl instanceof documentRef.defaultView.HTMLInputElement))
      return;

    const next = { ...settings };
    if (changedControl.dataset.setting === 'mode') {
      next.mode = changedControl.value;
    } else if (changedControl.dataset.setting === 'cloudflareFallbackEnabled') {
      next.cloudflareFallbackEnabled = changedControl.checked;
    } else if (changedControl.dataset.setting === 'cloudflareMonthlyLimit') {
      next.cloudflareMonthlyLimit = Number.isFinite(
        changedControl.valueAsNumber,
      )
        ? changedControl.valueAsNumber
        : settings.cloudflareMonthlyLimit;
    } else if (changedControl.dataset.setting === 'fallbackWaitMinutes') {
      next.fallbackWaitMinutes = Number.isFinite(changedControl.valueAsNumber)
        ? changedControl.valueAsNumber
        : settings.fallbackWaitMinutes;
    } else {
      return;
    }

    settings = normalizeSettings(next, settings);
    applySettingsToControls();
    notifyChange();
  }

  function preventSubmit(event) {
    event.preventDefault();
  }

  form.addEventListener('change', handleFormChange);
  form.addEventListener('submit', preventSubmit);
  host.append(root);
  applySettingsToControls();

  return {
    root,
    getSettings() {
      return snapshot(settings);
    },
    setSettings(patch = {}) {
      if (destroyed) return snapshot(settings);
      settings = normalizeSettings({ ...settings, ...patch }, settings);
      applySettingsToControls();
      return snapshot(settings);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('subscribe 需要一個函式。');
      }
      if (destroyed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      form.removeEventListener('change', handleFormChange);
      form.removeEventListener('submit', preventSubmit);
      listeners.clear();
      root.remove();
    },
  };
}

import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AlbumTabs } from '../../../apps/web/target-ui/album-tabs';
import '../../../apps/web/target-ui/album-navigation.css';
import './preview.css';

const albums = [
  { id: 'ceremony', name: '海邊儀式・精選照片', count: 8 },
  { id: 'banquet', name: '宴客花絮', count: 12 },
  { id: 'portraits', name: '雙人寫真與親友合影', count: 16 },
  { id: 'delivery', name: '修圖成品', count: 8 },
];

function Preview() {
  const [selected, setSelected] = useState<string | null>('ceremony');
  const album = albums.find((item) => item.id === selected);
  return (
    <div className="preview-shell">
      <header className="preview-brand">
        <strong>
          Kino Pick <span>奇諾選圖</span>
        </strong>
        <span className="preview-label">互動原型預覽</span>
      </header>
      <main>
        <p className="preview-breadcrumb">
          專案與相簿 <span>/</span> 海岸婚禮紀錄
        </p>
        <p className="preview-eyebrow">海岸婚禮紀錄</p>
        <h1>{album?.name ?? '全部相簿'}</h1>
        <AlbumTabs
          albums={albums}
          selectedAlbumId={selected}
          onSelect={setSelected}
        />
        <div className="preview-section-heading" aria-live="polite">
          <h2>{album ? '照片' : '專案相簿'}</h2>
          <span>
            {album ? `${album.count} 張照片` : `${albums.length} 本相簿`}
          </span>
        </div>
        <div className="preview-gallery">
          {(album ? [0, 1, 2, 3, 4, 5] : albums.map((_, index) => index)).map(
            (index) => (
              <article key={`${selected}-${index}`} className="preview-card">
                <div
                  className={`preview-photo preview-photo-${(index + (selected === 'banquet' ? 2 : selected === 'portraits' ? 3 : 0)) % 4}`}
                  aria-label="合成展示圖像"
                  role="img"
                />
                {!album && <h3>{albums[index]?.name}</h3>}
              </article>
            ),
          )}
        </div>
        <p className="preview-note">
          合成展示資料 · 僅預覽頁籤切換，不讀取或更動正式相簿
        </p>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);

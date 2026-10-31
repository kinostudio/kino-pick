import darkMark from './assets/kino-pick-dark.svg';
import lightMark from './assets/kino-pick-light.svg';
export function KinoLogo({
  dark = false,
  className = '',
}: {
  dark?: boolean;
  className?: string;
}) {
  return (
    <img
      src={dark ? darkMark : lightMark}
      alt="Kino Pick 奇諾選圖"
      className={'kino-product-logo ' + className}
      width="52"
      height="52"
      draggable={false}
    />
  );
}

import { QRCodeSVG } from 'qrcode.react';
import { StudioIcon } from './studio-icons';

/** Encode the same share URL locally; never send an invitation to a QR service. */
export function ShareQrCode({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  if (!value) return null;
  // Bound custom-password URLs before the QR encoder can reject oversized input.
  if (new TextEncoder().encode(value).length > 1800)
    return (
      <p role="status" className="mt-2 text-sm text-stone-600">
        連結較長，請複製分享連結。
      </p>
    );
  return (
    <details className="mt-3">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm">
        <StudioIcon name="qr" width={20} height={20} /> QR Code
      </summary>
      <div className="mt-2 inline-flex rounded-lg border border-stone-200 bg-white p-3">
        <QRCodeSVG
          value={value}
          size={176}
          level="M"
          marginSize={4}
          role="img"
          aria-label={`${label} 分享 QR Code`}
        />
      </div>
    </details>
  );
}

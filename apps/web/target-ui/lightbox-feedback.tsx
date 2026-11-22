import { useState, type ReactNode } from 'react';
import { StudioIcon } from './studio-icons';

export function LightboxFeedback({
  children,
  drawing,
}: {
  children: ReactNode | ((active: boolean) => ReactNode);
  drawing: (active: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  return (
    <details
      className="kino-lightbox-tool"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        <StudioIcon name="comment" width={20} height={20} />
        <span>留言與註記</span>
      </summary>
      {typeof children === 'function'
        ? children(open && !drawingOpen)
        : children}
      <details
        className="kino-feedback-drawing"
        onToggle={(event) => {
          if (event.target === event.currentTarget)
            setDrawingOpen(event.currentTarget.open);
        }}
      >
        <summary>圈選或手繪</summary>
        {drawing(open && drawingOpen)}
      </details>
    </details>
  );
}

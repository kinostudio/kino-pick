import { installPhotoInteractionGuard } from '../photo-interaction-guard';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import { consumeGuestEntryFragment } from './guest-entry';

installPhotoInteractionGuard(document);

const guestEntryCredential = consumeGuestEntryFragment();

const root = document.getElementById('root');
if (!root) throw new Error('Missing app root');
createRoot(root).render(
  <StrictMode>
    <App guestEntryCredential={guestEntryCredential} />
  </StrictMode>,
);

/** UI convenience only. Download authorization is enforced by the API. */
export function installPhotoInteractionGuard(document: Document): () => void {
  const preventNativeSave = (event: Event) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('img, canvas, [data-photo-surface]')
    ) {
      event.preventDefault();
    }
  };
  document.addEventListener('contextmenu', preventNativeSave, true);
  document.addEventListener('dragstart', preventNativeSave, true);
  return () => {
    document.removeEventListener('contextmenu', preventNativeSave, true);
    document.removeEventListener('dragstart', preventNativeSave, true);
  };
}

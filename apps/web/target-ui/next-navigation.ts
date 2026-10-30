export function useRouter() {
  return {
    refresh() {
      window.dispatchEvent(new Event('kino-pic:refresh'));
    },
    replace(path: string) {
      window.location.replace(path);
    },
    push(path: string) {
      window.location.assign(path);
    },
    back() {
      window.history.back();
    },
  };
}

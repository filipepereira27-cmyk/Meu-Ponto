import { useEffect, useState } from 'react';

/** Rotas por hash (#/arquivo): funcionam em qualquer hospedagem estática. */
export function useRoute(): string[] {
  const read = () => decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => {
      setParts(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export function go(path: string): void {
  location.hash = `#/${path.replace(/^\//, '')}`;
}

export function back(fallback = ''): void {
  if (history.length > 1) history.back();
  else go(fallback);
}

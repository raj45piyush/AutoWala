import { useSyncExternalStore } from 'react';

const darkModeQuery = '(prefers-color-scheme: dark)';

function getSnapshot() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia(darkModeQuery).matches ? 'dark' : 'light';
}

function getServerSnapshot() {
  return 'light';
}

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(darkModeQuery);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

/** Uses a stable light snapshot for static rendering, then tracks browser theme changes. */
export function useColorScheme() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

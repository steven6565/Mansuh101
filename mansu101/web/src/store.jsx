import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io } from 'socket.io-client';
import { api, post } from './lib/api.js';

const AppContext = createContext(null);

const THEME_KEY = 'visitor.theme';
const RANGE_KEY = 'visitor.range';

export const RANGE_PRESETS = [
  { value: '7', label: 'Last 7 days' },
  { value: '28', label: 'Last 28 days' },
  { value: '90', label: 'Last 3 months' },
  { value: '180', label: 'Last 6 months' },
  { value: '365', label: 'Last 12 months' },
];

function initialRange() {
  if (typeof window === 'undefined') return { days: 28, from: null, to: null };
  try {
    const stored = JSON.parse(window.localStorage.getItem(RANGE_KEY) ?? 'null');
    if (stored && (stored.from && stored.to ? true : Number(stored.days) > 0)) return stored;
  } catch {
    /* ignore malformed storage */
  }
  return { days: 28, from: null, to: null };
}

export function rangeToQuery(range) {
  if (range?.from && range?.to) return `from=${range.from}&to=${range.to}`;
  return `days=${Number(range?.days) || 28}`;
}

function initialTheme() {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function AppProvider({ children, onUnauthorized }) {
  const [theme, setTheme] = useState(initialTheme);
  const [boot, setBoot] = useState(null);
  const [bootError, setBootError] = useState(null);
  const [loadingBoot, setLoadingBoot] = useState(true);
  const [siteId, setSiteId] = useState(null);
  const [range, setRange] = useState(initialRange);
  const [scheduler, setScheduler] = useState(null);
  const [connected, setConnected] = useState(false);
  const [activity, setActivity] = useState([]);
  const [toasts, setToasts] = useState([]);
  const toastSeq = useRef(0);

  // ── theme ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    window.localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(RANGE_KEY, JSON.stringify(range));
    } catch {
      /* ignore */
    }
  }, [range]);

  const updateRange = useCallback((next) => {
    setRange((current) => ({ ...current, ...next }));
  }, []);

  // ── toasts ────────────────────────────────────────────────────────────
  const toast = useCallback((message, level = 'info', timeout = 5000) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((previous) => [...previous.slice(-2), { id, message, level }]);
    if (timeout > 0) {
      setTimeout(() => setToasts((previous) => previous.filter((item) => item.id !== id)), timeout);
    }
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((previous) => previous.filter((item) => item.id !== id));
  }, []);

  // ── bootstrap ─────────────────────────────────────────────────────────
  const loadBoot = useCallback(async () => {
    setLoadingBoot(true);
    setBootError(null);
    try {
      const data = await api('/bootstrap');
      setBoot(data);
      setScheduler(data.scheduler ?? null);
      setSiteId((current) => {
        if (current && data.sites.some((site) => site.id === current)) return current;
        return data.sites[0]?.id ?? null;
      });
      return data;
    } catch (error) {
      setBootError(error);
      throw error;
    } finally {
      setLoadingBoot(false);
    }
  }, []);

  useEffect(() => {
    loadBoot().catch(() => {});
  }, [loadBoot]);

  // ── realtime (status only) ────────────────────────────────────────────
  useEffect(() => {
    const socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelayMax: 8000,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (error) => {
      setConnected(false);
      if (error?.data?.code === 'UNAUTHORIZED') onUnauthorized?.();
    });
    socket.on('scheduler', (value) => setScheduler(value));
    socket.on('activity', (event) => {
      setActivity((previous) => [event, ...previous].slice(0, 200));
    });

    return () => socket.disconnect();
  }, [onUnauthorized]);

  const refreshBoot = useCallback(async () => {
    await loadBoot().catch(() => {});
  }, [loadBoot]);

  const sites = boot?.sites ?? [];
  const activeSite = useMemo(() => sites.find((site) => site.id === siteId) ?? null, [sites, siteId]);

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => {});
    window.location.reload();
  }, []);

  const value = {
    boot,
    bootError,
    loadingBoot,
    refreshBoot,
    sites,
    activeSite,
    siteId,
    setSiteId,
    range,
    updateRange,
    rangeQuery: rangeToQuery(range),
    scheduler,
    connected,
    activity,
    toasts,
    toast,
    dismissToast,
    theme,
    toggleTheme,
    logout,
    integrations: boot?.integrations ?? null,
    profiles: boot?.profiles ?? [],
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}

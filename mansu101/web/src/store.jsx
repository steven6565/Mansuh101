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
import { api, post, put, patch, del } from './lib/api.js';

const StoreContext = createContext(null);

const ACTIVE_STATUSES = new Set(['starting', 'navigating', 'loaded']);

const EMPTY_TOTALS = {
  total: 0,
  queued: 0,
  running: 0,
  completed: 0,
  succeeded: 0,
  failed: 0,
  stopped: 0,
  interrupted: 0,
};

function sortSessions(sessions) {
  return [...sessions].sort((a, b) => (a.tabIndex ?? 0) - (b.tabIndex ?? 0));
}

export function StoreProvider({ children, onUnauthorized }) {
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [run, setRun] = useState(null);
  const [engine, setEngine] = useState('idle');
  const [totals, setTotals] = useState(EMPTY_TOTALS);
  const [sessions, setSessions] = useState([]);
  const [urls, setUrls] = useState([]);
  const [settings, setSettings] = useState(null);
  const [browser, setBrowser] = useState({ status: 'offline', activeContexts: 0 });
  const [health, setHealth] = useState(null);
  const [logs, setLogs] = useState([]);
  const [config, setConfig] = useState({ profiles: [], maxConcurrency: 8 });
  const [vncUrl, setVncUrl] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [busyAction, setBusyAction] = useState(null);
  const toastSeq = useRef(0);
  const socketRef = useRef(null);

  const toast = useCallback((message, level = 'info', timeout = 4500) => {
    toastSeq.current += 1;
    const id = toastSeq.current;
    setToasts((previous) => [...previous.slice(-3), { id, message, level }]);
    if (timeout > 0) {
      setTimeout(() => {
        setToasts((previous) => previous.filter((item) => item.id !== id));
      }, timeout);
    }
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const applySnapshot = useCallback((snapshot) => {
    if (!snapshot) return;
    setRun(snapshot.run ?? null);
    setEngine(snapshot.engine ?? 'idle');
    setTotals({ ...EMPTY_TOTALS, ...(snapshot.totals ?? {}) });
    setSessions(sortSessions(snapshot.sessions ?? []));
    setUrls(snapshot.urls ?? []);
    setSettings(snapshot.settings ?? null);
    setBrowser(snapshot.browser ?? { status: 'offline', activeContexts: 0 });
    setVncUrl(snapshot.vncUrl ?? null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let disposed = false;
    api('/config').then((value) => {
      if (!disposed) setConfig(value);
    }).catch(() => {});

    const socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelayMax: 6000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('connect_error', (error) => {
      setConnected(false);
      if (error?.data?.code === 'UNAUTHORIZED' || error?.message === 'Authentication required') {
        onUnauthorized?.();
      }
    });

    socket.on('snapshot', applySnapshot);

    socket.on('state', (snapshot) => {
      applySnapshot(snapshot);
    });

    socket.on('run:update', (payload) => {
      if (!payload) return;
      setRun(payload.run ?? null);
      setEngine(payload.engine ?? 'idle');
      setTotals({ ...EMPTY_TOTALS, ...(payload.totals ?? payload.run?.totals ?? {}) });
    });

    socket.on('session:update', (session) => {
      if (!session?.id) return;
      setSessions((previous) => {
        const existing = previous.find((item) => item.id === session.id);
        const merged = existing
          ? { ...existing, ...session, errors: session.errors ?? existing.errors, networkFailures: session.networkFailures ?? existing.networkFailures }
          : session;
        const next = existing
          ? previous.map((item) => (item.id === session.id ? merged : item))
          : [...previous, merged];
        return sortSessions(next);
      });
    });

    socket.on('browser', (value) => {
      if (value) setBrowser(value);
    });

    socket.on('settings:update', (value) => {
      if (value) setSettings(value);
    });

    socket.on('urls:update', (value) => {
      if (Array.isArray(value)) setUrls(value);
    });

    socket.on('health', (value) => {
      if (value) setHealth(value);
    });

    socket.on('config', (value) => {
      if (value?.profiles) setConfig((current) => ({ ...current, ...value }));
    });

    socket.on('log', (event) => {
      setLogs((previous) => [...previous.slice(-999), event]);
    });

    socket.on('logs:init', (events) => {
      setLogs(Array.isArray(events) ? events.slice(-500) : []);
    });

    socket.on('logs:cleared', () => setLogs([]));

    socket.on('history:cleared', () => {
      setSessions([]);
      setRun(null);
      setEngine('idle');
      setTotals(EMPTY_TOTALS);
    });

    socket.on('notice', (notice) => {
      if (notice?.message) {
        const level = notice.level === 'error' ? 'error' : notice.level === 'warn' ? 'warn' : 'info';
        toast(notice.message, level);
      }
    });

    return () => {
      disposed = true;
      socket.disconnect();
      socketRef.current = null;
    };
  }, [applySnapshot, onUnauthorized, toast]);

  // Toast auto-dismiss cleanup is handled per-toast; keep latest only.
  useEffect(() => {
    if (toasts.length > 4) setToasts((previous) => previous.slice(-4));
  }, [toasts]);

  const runAction = useCallback(async (name) => {
    setBusyAction(name);
    try {
      await post(`/run/${name}`);
      if (name === 'start') toast('Automation run started', 'success');
      if (name === 'restart') toast('Restarting automation run', 'success');
      if (name === 'stop') toast('Stop requested — closing tabs', 'warn');
      if (name === 'pause') toast('Run paused', 'warn');
      if (name === 'resume') toast('Run resumed', 'success');
    } catch (error) {
      toast(error.message, 'error', 7000);
    } finally {
      setBusyAction(null);
    }
  }, [toast]);

  const addUrls = useCallback(async (lines) => {
    const values = String(lines)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!values.length) {
      toast('Enter at least one URL', 'warn');
      return;
    }
    try {
      const result = await post('/urls', { urls: values });
      if (result?.added === 0) {
        toast('No new URLs added — already in the list', 'warn');
      } else if (result?.added != null) {
        const rejected = result.rejected > 0 ? `, ${result.rejected} invalid skipped` : '';
        toast(`Added ${result.added} URL(s)${rejected}`, 'success');
      } else {
        toast(`Added ${values.length} URL(s)`, 'success');
      }
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [toast]);

  const removeUrl = useCallback(async (id) => {
    try {
      await del(`/urls/${id}`);
      toast('URL removed', 'info');
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [toast]);

  const toggleUrl = useCallback(async (id, enabled) => {
    try {
      await patch(`/urls/${id}`, { enabled });
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [toast]);

  const saveSettings = useCallback(async (next) => {
    try {
      const result = await put('/settings', next);
      setSettings(result.settings);
      toast('Settings saved', 'success');
      return result.settings;
    } catch (error) {
      toast(error.message, 'error');
      throw error;
    }
  }, [toast]);

  const clearLogs = useCallback(async () => {
    try {
      await post('/logs/clear');
      toast('Log buffer cleared', 'info');
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [toast]);

  const closeSession = useCallback(async (id) => {
    try {
      await post(`/sessions/${id}/close`);
      toast('Tab close requested', 'warn');
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [toast]);

  const restartBrowser = useCallback(async () => {
    try {
      await post('/browser/restart');
      toast('Chromium restarted', 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [toast]);

  const closeBrowser = useCallback(async () => {
    try {
      await post('/browser/close');
      toast('Chromium closed', 'info');
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [toast]);

  const clearHistory = useCallback(async () => {
    try {
      const result = await post('/history/clear');
      setRun(null);
      setEngine('idle');
      setSessions([]);
      setTotals(EMPTY_TOTALS);
      toast(`History cleared — ${result?.runs ?? 0} run(s) removed`, 'success');
    } catch (error) {
      toast(error.message, 'error');
    }
  }, [toast]);

  const stats = useMemo(() => {
    const active = sessions.filter((session) => ACTIVE_STATUSES.has(session.status));
    const counts = sessions.reduce((acc, session) => {
      acc[session.status] = (acc[session.status] ?? 0) + 1;
      return acc;
    }, {});
    const completed = counts.completed ?? 0;
    const failed = counts.failed ?? 0;
    return {
      activeSessions: active.length,
      activeTabs: active.length,
      current: active[0] ?? null,
      lastFinished: [...sessions]
        .filter((session) => session.finishedAt)
        .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))[0] ?? null,
      counts,
      completed,
      failed,
      enabledUrls: urls.filter((url) => url.enabled).length,
      totalUrls: urls.length,
      progress: totals.total ? Math.round((totals.completed / totals.total) * 100) : 0,
    };
  }, [sessions, urls, totals]);

  const value = {
    loaded,
    connected,
    run,
    engine,
    totals,
    sessions,
    urls,
    settings,
    browser,
    health,
    logs,
    config,
    vncUrl,
    toasts,
    busyAction,
    stats,
    runAction,
    addUrls,
    removeUrl,
    toggleUrl,
    saveSettings,
    clearLogs,
    closeSession,
    restartBrowser,
    closeBrowser,
    clearHistory,
    dismissToast,
    toast,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore must be used inside StoreProvider');
  return context;
}

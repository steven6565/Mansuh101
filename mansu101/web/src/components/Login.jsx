import { useState } from 'react';
import { post } from '../lib/api.js';
import { Brand } from './Brand.jsx';
import { Lock, Shield, Globe, Activity, Monitor, ChevronRight } from './Icons.jsx';

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await post('/auth/login', { password });
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 grid-fade opacity-60" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-violet-600/20 blur-[120px]" />

      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] shadow-2xl backdrop-blur-xl lg:grid-cols-[1.15fr_1fr]">
        <div className="relative hidden flex-col justify-between border-r border-white/[0.07] bg-gradient-to-br from-violet-600/[0.12] via-transparent to-cyan-500/[0.06] p-9 lg:flex">
          <Brand />
          <div>
            <h1 className="max-w-xs text-3xl font-semibold leading-tight tracking-tight text-white">
              Your VPS browser fleet,
              <span className="bg-gradient-to-r from-violet-300 to-cyan-300 bg-clip-text text-transparent"> live in one console.</span>
            </h1>
            <p className="mt-3 max-w-sm text-[13px] leading-relaxed text-slate-400">
              Real Chromium sessions executing on your remote server. No local browser, no simulations —
              every metric is streamed from the automation engine.
            </p>
            <ul className="mt-6 space-y-2.5 text-xs text-slate-400">
              {[
                { icon: Monitor, text: 'Fresh isolated browser context per URL' },
                { icon: Globe, text: 'HTTP status, titles, JS & network errors' },
                { icon: Activity, text: 'Live screenshots and terminal event stream' },
                { icon: Shield, text: 'Token auth, session isolation, restart-safe' },
              ].map((item) => (
                <li key={item.text} className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-white/[0.05] text-violet-300 ring-1 ring-inset ring-white/[0.06]">
                    <item.icon size={12} />
                  </span>
                  {item.text}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-slate-600">Authorized operators only</p>
        </div>

        <div className="flex flex-col justify-center p-7 sm:p-9">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Brand />
          </div>
          <div className="mb-6">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-400/25">
              <Lock size={18} />
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-white">Secure sign in</h2>
            <p className="mt-1 text-xs text-slate-500">Enter the dashboard password configured on the VPS.</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label mb-1.5 block" htmlFor="password">Dashboard password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                className="input h-11"
                placeholder="••••••••••••"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            {error && (
              <div className="rounded-lg border border-rose-400/25 bg-rose-500/[0.08] px-3 py-2 text-xs text-rose-300">
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary h-11 w-full" disabled={loading || !password}>
              {loading ? 'Authenticating…' : 'Enter console'}
              {!loading && <ChevronRight size={15} />}
            </button>
          </form>

          <div className="mt-6 flex items-start gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
            <Shield size={13} className="mt-0.5 shrink-0 text-slate-400" />
            <p>Credentials are verified server-side and rate limited. Change <code className="kbd">APP_PASSWORD</code> in <code className="kbd">.env</code> before exposing this dashboard.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

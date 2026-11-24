import { useState } from 'react';
import { post } from '../lib/api.js';
import { Brand, Logomark } from './Brand.jsx';
import { Lock, Shield, Chart, Search, Alert } from './Icons.jsx';

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      await post('/auth/login', { password });
      onSuccess();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <div className="mx-auto flex w-full max-w-6xl flex-1 items-center justify-center gap-16 px-6 py-12 lg:gap-24">
        <div className="hidden max-w-sm flex-1 lg:block">
          <Brand />
          <h1 className="mt-8 text-[28px] font-semibold leading-tight tracking-tight text-ink">
            Organic growth,
            <br />
            measured honestly.
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
            Search Console and Analytics data, technical audits, keyword tracking and content briefs
            for sites you own — in one dashboard. No simulated traffic, no invented numbers.
          </p>
          <ul className="mt-8 space-y-3.5">
            {[
              { icon: Chart, text: 'Real clicks, impressions, CTR and position from Google' },
              { icon: Search, text: 'Crawled technical audits with actionable fixes' },
              { icon: Shield, text: 'Authorized scanning only, tokens encrypted at rest' },
            ].map((item) => (
              <li key={item.text} className="flex items-start gap-2.5 text-[12.5px] text-muted">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                  <item.icon size={13} />
                </span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="w-full max-w-[350px]">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <Logomark size={30} />
            <span className="text-[15px] font-semibold text-ink">Visitor</span>
          </div>
          <div className="card p-6">
            <div className="mb-5 flex items-center gap-2 text-brand-600 dark:text-brand-400">
              <Lock size={15} />
              <span className="text-[12px] font-semibold uppercase tracking-[0.1em]">Sign in</span>
            </div>
            <form onSubmit={submit} className="space-y-3.5">
              <div>
                <label htmlFor="password" className="mb-1.5 block text-[12px] font-medium text-ink">
                  Dashboard password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  autoFocus
                  className="input"
                  placeholder="••••••••••••"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-negative/25 bg-negative/5 px-3 py-2 text-[11.5px] text-negative">
                  <Alert size={13} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <button type="submit" className="btn-primary w-full" disabled={loading || !password}>
                {loading ? 'Checking…' : 'Continue'}
              </button>
            </form>
            <p className="mt-4 text-[11px] leading-relaxed text-faint">
              Set <code className="font-mono text-muted">APP_PASSWORD</code> in your <code className="font-mono text-muted">.env</code>.
              Login attempts are rate limited per IP.
            </p>
          </div>
        </div>
      </div>
      <footer className="border-t border-line px-6 py-3 text-center text-[10.5px] text-faint">
        Authorized use only · Connect accounts you own or administer
      </footer>
    </div>
  );
}

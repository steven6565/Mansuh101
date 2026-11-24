import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store.jsx';
import { SectionHeading } from '../components/ui.jsx';
import { formatDuration } from '../lib/format.js';
import {
  Settings as SettingsIcon, Server, Monitor, Shield, Eye, Save, Refresh, Cpu,
} from '../components/Icons.jsx';

const toForm = (settings) => ({
  ...settings,
  viewport: { ...settings.viewport },
  navigationTimeoutSec: Math.round(settings.navigationTimeoutMs / 1000),
  sessionDurationSec: Math.round(settings.sessionDurationMs / 1000),
  screenshotIntervalSec: Math.round(settings.screenshotIntervalMs / 1000),
  waitAfterLoadSec: Number((settings.waitAfterLoadMs / 1000).toFixed(1)),
  networkIdleSec: Math.round(settings.networkIdleTimeoutMs / 1000),
  visitsPerUrl: settings.visitsPerUrl ?? 1,
  repeatDelaySec: Math.round((settings.repeatDelayMs ?? 5000) / 1000),
  loopUntilStopped: Boolean(settings.loopUntilStopped ?? false),
  scrollEnabled: Boolean(settings.scrollEnabled ?? true),
  scrollStepPx: settings.scrollStepPx ?? 600,
  scrollPauseMs: settings.scrollPauseMs ?? 1200,
  scrollPasses: settings.scrollPasses ?? 1,
  clickInternalLinks: Boolean(settings.clickInternalLinks ?? false),
  clicksPerVisit: settings.clicksPerVisit ?? 1,
});

export default function SettingsPage({ onOpenVnc }) {
  const {
    settings, config, browser, restartBrowser, closeBrowser, saveSettings, vncUrl, health,
  } = useStore();
  const [form, setForm] = useState(() => (settings ? toForm(settings) : null));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) setForm(toForm(settings));
  }, [settings]);

  const profiles = config.profiles ?? [];
  const selectedProfile = profiles.find((profile) => profile.id === form?.profile);
  const maxConcurrency = config.maxConcurrency ?? 8;

  const dirty = useMemo(() => {
    if (!form || !settings) return false;
    return (
      form.concurrency !== settings.concurrency ||
      form.navigationTimeoutSec !== Math.round(settings.navigationTimeoutMs / 1000) ||
      form.sessionDurationSec !== Math.round(settings.sessionDurationMs / 1000) ||
      form.screenshotIntervalSec !== Math.round(settings.screenshotIntervalMs / 1000) ||
      form.waitAfterLoadSec !== Number((settings.waitAfterLoadMs / 1000).toFixed(1)) ||
      form.networkIdleSec !== Math.round(settings.networkIdleTimeoutMs / 1000) ||
      form.viewport.width !== settings.viewport.width ||
      form.viewport.height !== settings.viewport.height ||
      form.profile !== settings.profile ||
      form.headless !== settings.headless ||
      form.blockImages !== settings.blockImages ||
      form.customUserAgent !== settings.customUserAgent ||
      form.visitsPerUrl !== (settings.visitsPerUrl ?? 1) ||
      form.repeatDelaySec !== Math.round((settings.repeatDelayMs ?? 5000) / 1000) ||
      form.loopUntilStopped !== Boolean(settings.loopUntilStopped ?? false) ||
      form.scrollEnabled !== Boolean(settings.scrollEnabled ?? true) ||
      form.scrollStepPx !== (settings.scrollStepPx ?? 600) ||
      form.scrollPauseMs !== (settings.scrollPauseMs ?? 1200) ||
      form.scrollPasses !== (settings.scrollPasses ?? 1) ||
      form.clickInternalLinks !== Boolean(settings.clickInternalLinks ?? false) ||
      form.clicksPerVisit !== (settings.clicksPerVisit ?? 1)
    );
  }, [form, settings]);

  if (!form) {
    return <div className="card p-8 text-center text-xs text-slate-500">Loading settings…</div>;
  }

  const update = (key, value) => setForm((previous) => ({ ...previous, [key]: value }));
  const updateViewport = (key, value) => setForm((previous) => ({
    ...previous,
    viewport: { ...previous.viewport, [key]: Number(value) },
  }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await saveSettings({
        concurrency: Number(form.concurrency),
        navigationTimeoutMs: Math.round(Number(form.navigationTimeoutSec) * 1000),
        sessionDurationMs: Math.round(Number(form.sessionDurationSec) * 1000),
        screenshotIntervalMs: Math.round(Number(form.screenshotIntervalSec) * 1000),
        waitAfterLoadMs: Math.round(Number(form.waitAfterLoadSec) * 1000),
        networkIdleTimeoutMs: Math.round(Number(form.networkIdleSec) * 1000),
        visitsPerUrl: Number(form.visitsPerUrl),
        repeatDelayMs: Math.round(Number(form.repeatDelaySec) * 1000),
        loopUntilStopped: Boolean(form.loopUntilStopped),
        scrollEnabled: Boolean(form.scrollEnabled),
        scrollStepPx: Number(form.scrollStepPx),
        scrollPauseMs: Number(form.scrollPauseMs),
        scrollPasses: Number(form.scrollPasses),
        clickInternalLinks: Boolean(form.clickInternalLinks),
        clicksPerVisit: Number(form.clicksPerVisit),
        viewport: { width: Number(form.viewport.width), height: Number(form.viewport.height) },
        profile: form.profile,
        customUserAgent: form.customUserAgent,
        headless: form.headless,
        blockImages: form.blockImages,
      });
    } catch {
      /* toast handled in store */
    } finally {
      setSaving(false);
    }
  };

  const applyPreset = (width, height) => setForm((previous) => ({
    ...previous,
    viewport: { width, height },
  }));

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-white">Automation settings</h1>
          <p className="mt-1 text-xs text-slate-500">
            Tuned limits are persisted in the database and applied on the next run.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button type="button" className="btn-ghost" onClick={() => setForm(toForm(settings))}>
              <Refresh size={14} /> Discard
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={!dirty || saving}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <section className="card p-5">
            <SectionHeading
              icon={Cpu}
              title="Engine & concurrency"
              subtitle="Resource limits for the 7-core / 32 GB VPS"
              right={<span className="pill bg-white/[0.04] font-mono text-[10px] text-slate-400">max {maxConcurrency}</span>}
            />
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="concurrency" className="text-xs font-medium text-slate-300">Concurrent browser sessions</label>
                  <span className="rounded bg-violet-500/10 px-2 py-0.5 font-mono text-[11px] text-violet-300">{form.concurrency}</span>
                </div>
                <input
                  id="concurrency"
                  type="range"
                  min="1"
                  max={maxConcurrency}
                  step="1"
                  value={form.concurrency}
                  onChange={(event) => update('concurrency', Number(event.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-violet-500"
                />
                <p className="mt-1.5 text-[10px] text-slate-600">Each session is an isolated incognito context with one tab. Hard ceiling is set by MAX_CONCURRENCY.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField id="navTimeout" label="Navigation timeout" suffix="sec" min={5} max={300} value={form.navigationTimeoutSec} onChange={(value) => update('navigationTimeoutSec', value)} hint="page.goto DOM-content-loaded limit" />
                <NumberField id="sessionDuration" label="Session duration" suffix="sec" min={10} max={1800} value={form.sessionDurationSec} onChange={(value) => update('sessionDurationSec', value)} hint="hard per-tab lifetime" />
                <NumberField id="screenshotInterval" label="Screenshot interval" suffix="sec" min={0} max={120} value={form.screenshotIntervalSec} onChange={(value) => update('screenshotIntervalSec', value)} hint="0 disables live refresh" />
                <NumberField id="waitAfterLoad" label="Post-load settle" suffix="sec" min={0} max={15} step={0.1} value={form.waitAfterLoadSec} onChange={(value) => update('waitAfterLoadSec', value)} hint="wait before final capture" />
                <NumberField id="networkIdle" label="Network idle wait" suffix="sec" min={0} max={30} value={form.networkIdleSec} onChange={(value) => update('networkIdleSec', value)} hint="best-effort, never fails the run" />
              </div>
            </div>
          </section>

          <section className="card p-5">
            <SectionHeading
              icon={Refresh}
              title="Repeat visits"
              subtitle="How many times each enabled URL is visited in one run"
              right={<span className="pill bg-white/[0.04] font-mono text-[10px] text-slate-400">applies to next run</span>}
            />
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField id="visitsPerUrl" label="Visits per URL" suffix="times" min={1} max={100} value={form.visitsPerUrl} onChange={(value) => update('visitsPerUrl', value)} hint="1 = old behaviour, one visit per URL" />
                <NumberField id="repeatDelay" label="Delay between visits" suffix="sec" min={0} max={600} value={form.repeatDelaySec} onChange={(value) => update('repeatDelaySec', value)} hint="pause before the same URL is visited again" />
              </div>
              <div className="space-y-2.5 border-t border-white/[0.06] pt-3">
                <Toggle
                  label="Loop until stopped"
                  description="ON: har URL baari-baari phir se visit hota rahega, jab tak Stop na dabao. Visits per URL is case me sirf pehla round hai."
                  checked={form.loopUntilStopped}
                  onChange={(checked) => update('loopUntilStopped', checked)}
                />
              </div>
              <p className="text-[10px] leading-relaxed text-slate-600">
                Example: 3 URLs aur Visits per URL 5 ho to ek run me 15 visits honge (3 × 5).
                Har visit ka alag session, screenshot aur History entry banti hai.
                Zyada visits se VPS load badhega, isliye pehle 2–3 se test karo.
              </p>
            </div>
          </section>

          <section className="card p-5">
            <SectionHeading
              icon={Eye}
              title="Scrolling & clicks"
              subtitle="Read the page like a visitor — smooth scroll down and back up, plus internal link clicks"
              right={<span className="pill bg-white/[0.04] font-mono text-[10px] text-slate-400">applies to next run</span>}
            />
            <div className="space-y-4">
              <div className="space-y-2.5">
                <Toggle
                  label="Smooth scrolling"
                  description="ON: har visit me page aaram se neeche bottom tak jayega, phir wapas upar. Neeche wale ads aur content screen par aate hain, isse unki impression count hoti hai."
                  checked={form.scrollEnabled}
                  onChange={(checked) => update('scrollEnabled', checked)}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <NumberField id="scrollStep" label="Scroll step" suffix="px" min={200} max={2000} value={form.scrollStepPx} onChange={(value) => update('scrollStepPx', value)} hint="ek baar me kitna neeche jaye" />
                <NumberField id="scrollPause" label="Pause per step" suffix="ms" min={0} max={10000} value={form.scrollPauseMs} onChange={(value) => update('scrollPauseMs', value)} hint="har step par kitna ruke" />
                <NumberField id="scrollPasses" label="Scroll passes" suffix="times" min={1} max={3} value={form.scrollPasses} onChange={(value) => update('scrollPasses', value)} hint="neeche-upar kitni baar" />
              </div>
              <div className="space-y-2.5 border-t border-white/[0.06] pt-3">
                <Toggle
                  label="Click internal links"
                  description="ON: har visit me apni hi site ke andar ke 1–2 links par click hoga, phir wapas usi page par aa jayega. Visit site par hi rehta hai, bahar nahi jata."
                  checked={form.clickInternalLinks}
                  onChange={(checked) => update('clickInternalLinks', checked)}
                />
                <NumberField id="clicksPerVisit" label="Clicks per visit" suffix="clicks" min={0} max={5} value={form.clicksPerVisit} onChange={(value) => update('clicksPerVisit', value)} hint="0 = koi click nahi" />
              </div>
              <p className="text-[10px] leading-relaxed text-slate-600">
                Impression tab count hoti hai jab ad screen par dikhta hai — scroll se neeche wale ads dikhenge.
                Clicks sirf apni site ke andar ke links par hote hain. Ads par kabhi click nahi hota:
                ad par bot se click karwana invalid traffic hai, ad account band ho sakta hai.
              </p>
            </div>
          </section>

          <section className="card p-5">
            <SectionHeading icon={Monitor} title="Browser profile & viewport" subtitle="Per-context User-Agent emulation for compatibility tests" />
            <div className="space-y-4">
              <div>
                <label className="label mb-1.5 block" htmlFor="profile">Profile</label>
                <select id="profile" className="select" value={form.profile} onChange={(event) => update('profile', event.target.value)}>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.label}</option>
                  ))}
                </select>
                {selectedProfile && (
                  <p className="mt-2 break-all rounded-lg border border-white/[0.05] bg-black/25 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-slate-500">
                    {form.profile === 'custom' && form.customUserAgent ? form.customUserAgent : selectedProfile.userAgent || 'Custom User-Agent'}
                  </p>
                )}
              </div>

              {form.profile === 'custom' && (
                <div>
                  <label className="label mb-1.5 block" htmlFor="customUA">Custom User-Agent</label>
                  <textarea
                    id="customUA"
                    rows={3}
                    value={form.customUserAgent}
                    onChange={(event) => update('customUserAgent', event.target.value)}
                    placeholder="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 …"
                    className="input resize-y font-mono text-[10px]"
                  />
                </div>
              )}

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-300">Viewport</span>
                  <div className="flex gap-1">
                    <PresetButton label="1440×900" onClick={() => applyPreset(1440, 900)} active={form.viewport.width === 1440 && form.viewport.height === 900} />
                    <PresetButton label="1920×1080" onClick={() => applyPreset(1920, 1080)} active={form.viewport.width === 1920 && form.viewport.height === 1080} />
                    <PresetButton label="390×844" onClick={() => applyPreset(390, 844)} active={form.viewport.width === 390 && form.viewport.height === 844} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumberField id="vw" label="Width" suffix="px" min={320} max={3840} value={form.viewport.width} onChange={(value) => updateViewport('width', value)} />
                  <NumberField id="vh" label="Height" suffix="px" min={240} max={2160} value={form.viewport.height} onChange={(value) => updateViewport('height', value)} />
                </div>
              </div>

              <div className="space-y-2.5 border-t border-white/[0.06] pt-3">
                <Toggle
                  label="Headless mode"
                  description="Run Chromium without a display. Disable only with Xvfb + VNC configured on the VPS."
                  checked={form.headless}
                  onChange={(checked) => update('headless', checked)}
                />
                <Toggle
                  label="Block images"
                  description="Abort image requests — faster, lighter navigation when screenshots are not needed."
                  checked={form.blockImages}
                  onChange={(checked) => update('blockImages', checked)}
                />
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="card p-5">
            <SectionHeading icon={Server} title="Chromium engine" subtitle="Live process state on the VPS" />
            <div className="space-y-2 text-[11px]">
              <Row label="Status" value={browser.status} valueClass={browser.status === 'online' ? 'text-emerald-300' : browser.status === 'error' ? 'text-rose-300' : 'text-slate-400'} />
              <Row label="Version" value={browser.version ?? '—'} />
              <Row label="Mode" value={browser.headless ? 'Headless' : 'Visible (Xvfb/VNC)'} />
              <Row label="Active contexts" value={browser.activeContexts ?? 0} />
              <Row label="Idle close" value={formatDuration(browser.idleCloseMs)} />
              <Row label="Executable" value={browser.executablePath ?? 'not detected'} mono />
              {browser.lastError && (
                <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-500/[0.06] p-2.5 text-[10px] leading-relaxed text-rose-200">
                  {browser.lastError}
                </p>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" className="btn-ghost flex-1 !text-[11px]" onClick={restartBrowser}>
                <Refresh size={12} /> Restart Chromium
              </button>
              <button type="button" className="btn-danger flex-1 !text-[11px]" onClick={closeBrowser} disabled={browser.status === 'offline'}>
                Close
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
              Browser restart is blocked while a run is active. The engine relaunches automatically on the next run.
            </p>
          </section>

          <section className="card p-5">
            <SectionHeading icon={Shield} title="Remote access & security" subtitle="Environment-controlled — requires .env + restart" />
            <div className="space-y-2 text-[11px]">
              <Row label="Node" value={health?.node ?? '—'} />
              <Row label="Host" value={health?.host ?? '—'} />
              <Row label="Auth" value={config.authDisabled ? 'DISABLED' : 'Password + token'} valueClass={config.authDisabled ? 'text-rose-300' : 'text-emerald-300'} />
              <Row label="Retention" value={`${config.retentionDays ?? '—'} days`} />
              <Row label="VNC" value={vncUrl ? 'Configured' : 'Not configured'} valueClass={vncUrl ? 'text-emerald-300' : 'text-slate-500'} />
            </div>
            <button type="button" className="btn-ghost mt-4 w-full !text-[11px]" onClick={onOpenVnc}>
              <Eye size={12} /> {vncUrl ? 'Open remote desktop' : 'VNC setup instructions'}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-600">
              Change <code className="kbd">APP_PASSWORD</code>, <code className="kbd">VNC_URL</code> and storage options in
              <code className="kbd ml-1">/opt/mansu101/.env</code>, then restart via PM2.
            </p>
          </section>

          <section className="card p-5">
            <SectionHeading icon={SettingsIcon} title="Effective configuration" subtitle="Saved values used by the next run" />
            <div className="space-y-2 text-[11px]">
              <Row label="Concurrency" value={settings.concurrency} />
              <Row label="Visits per URL" value={settings.visitsPerUrl ?? 1} />
              <Row label="Delay between visits" value={`${Math.round((settings.repeatDelayMs ?? 5000) / 1000)}s`} />
              <Row label="Loop until stopped" value={settings.loopUntilStopped ? 'yes' : 'no'} />
              <Row label="Smooth scroll" value={settings.scrollEnabled ?? true ? `${settings.scrollPasses ?? 1} pass(es), ${settings.scrollStepPx ?? 600}px / ${settings.scrollPauseMs ?? 1200}ms` : 'off'} />
              <Row label="Internal clicks" value={settings.clickInternalLinks ? `${settings.clicksPerVisit ?? 1} per visit` : 'off'} />
              <Row label="Navigation timeout" value={`${Math.round(settings.navigationTimeoutMs / 1000)}s`} />
              <Row label="Session duration" value={`${Math.round(settings.sessionDurationMs / 1000)}s`} />
              <Row label="Screenshot interval" value={settings.screenshotIntervalMs ? `${Math.round(settings.screenshotIntervalMs / 1000)}s` : 'disabled'} />
              <Row label="Profile" value={settings.profile} mono />
              <Row label="Viewport" value={`${settings.viewport.width} × ${settings.viewport.height}`} />
              <Row label="Headless" value={settings.headless ? 'yes' : 'no'} />
            </div>
          </section>
        </div>
      </div>

      {dirty && (
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-xl border border-violet-400/25 bg-ink-850/95 px-4 py-2.5 shadow-glow backdrop-blur">
          <p className="text-[11px] text-slate-400">Unsaved changes — these limits apply to the next run.</p>
          <button type="submit" className="btn-primary !py-1.5 !text-[11px]" disabled={saving}>
            <Save size={12} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </form>
  );
}

function NumberField({ id, label, suffix, value, onChange, min, max, step = 1, hint }) {
  return (
    <div>
      <label htmlFor={id} className="label mb-1.5 block !text-[9px]">{label}</label>
      <div className="relative">
        <input
          id={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="input h-9 !py-1 pr-10 text-[12px]"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] uppercase text-slate-500">{suffix}</span>
      </div>
      {hint && <p className="mt-1 text-[9px] text-slate-600">{hint}</p>}
    </div>
  );
}

function PresetButton({ label, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-1.5 py-0.5 text-[9px] transition ${active ? 'border-violet-400/30 bg-violet-500/15 text-violet-300' : 'border-white/[0.06] text-slate-500 hover:text-slate-300'}`}
    >
      {label}
    </button>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs font-medium text-slate-300">{label}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-600">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-1 h-5 w-9 shrink-0 rounded-full border transition ${checked ? 'border-violet-400/40 bg-violet-500/70' : 'border-white/10 bg-white/[0.06]'}`}
      >
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function Row({ label, value, mono = false, valueClass = 'text-slate-300' }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`truncate text-right ${mono ? 'font-mono text-[10px]' : ''} ${valueClass}`} title={String(value)}>{value}</span>
    </div>
  );
}

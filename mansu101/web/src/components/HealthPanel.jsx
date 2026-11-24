import { useStore } from '../store.jsx';
import { formatBytes, formatDuration } from '../lib/format.js';
import { Ring, SectionHeading } from './ui.jsx';
import { Cpu, Memory, HardDrive, Server, Monitor } from './Icons.jsx';

export default function HealthPanel() {
  const { health, browser } = useStore();

  const cpu = health?.cpu;
  const memory = health?.memory;
  const disk = health?.disk;

  return (
    <section className="card p-5">
      <SectionHeading
        icon={Server}
        title="Server health"
        subtitle={health ? `${health.platform} · up ${formatDuration(health.uptimeSeconds * 1000)}` : 'waiting for health samples'}
        right={<span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">{health?.host ?? 'VPS'}</span>}
      />

      <div className="grid grid-cols-3 gap-2">
        <GaugeBlock
          icon={Cpu}
          label="CPU"
          value={cpu?.usagePercent}
          tone={(cpu?.usagePercent ?? 0) > 85 ? 'rose' : (cpu?.usagePercent ?? 0) > 60 ? 'amber' : 'violet'}
          detail={cpu ? `${cpu.cores} cores · load ${cpu.load1}` : '—'}
        />
        <GaugeBlock
          icon={Memory}
          label="RAM"
          value={memory?.usedPercent}
          tone={(memory?.usedPercent ?? 0) > 85 ? 'rose' : (memory?.usedPercent ?? 0) > 65 ? 'amber' : 'cyan'}
          detail={memory ? `${formatBytes(memory.totalBytes - memory.freeBytes)} / ${formatBytes(memory.totalBytes)}` : '—'}
        />
        <GaugeBlock
          icon={HardDrive}
          label="Disk"
          value={disk?.usedPercent}
          tone={(disk?.usedPercent ?? 0) > 90 ? 'rose' : (disk?.usedPercent ?? 0) > 70 ? 'amber' : 'emerald'}
          detail={disk ? `${formatBytes(disk.freeBytes)} free` : '—'}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-white/[0.06] pt-3 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Load (1/5/15)</span>
          <span className="font-mono text-slate-300">
            {cpu ? `${cpu.load1} / ${cpu.load5} / ${cpu.load15}` : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">Node</span>
          <span className="font-mono text-slate-300">{health?.node ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">App RAM</span>
          <span className="font-mono text-slate-300">{memory ? formatBytes(memory.processRssBytes) : '—'}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-500">PID</span>
          <span className="font-mono text-slate-300">{health?.pid ?? '—'}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
        <span className={`flex h-7 w-7 items-center justify-center rounded-md ${browser.status === 'online' ? 'bg-emerald-500/10 text-emerald-300' : browser.status === 'error' ? 'bg-rose-500/10 text-rose-300' : 'bg-white/[0.04] text-slate-400'}`}>
          <Monitor size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-slate-200">
            {browser.status === 'online' ? browser.version ?? 'Chromium' : browser.status === 'error' ? 'Chromium failed to launch' : 'Chromium not running'}
          </p>
          <p className="truncate text-[10px] text-slate-500">
            {browser.status === 'online'
              ? `${browser.headless ? 'Headless' : 'Visible'} · ${browser.activeContexts} context(s) · idle close ${Math.round((browser.idleCloseMs ?? 0) / 1000)}s`
              : browser.lastError ?? browser.executablePath ?? 'Starts automatically with the first run'}
          </p>
        </div>
      </div>
    </section>
  );
}

function GaugeBlock({ icon: Icon, label, value, tone, detail }) {
  const display = value === undefined || value === null ? null : Number(value);
  return (
    <div className="flex flex-col items-center rounded-xl border border-white/[0.05] bg-black/20 px-2 py-3">
      <Ring value={display ?? 0} size={58} stroke={5} tone={tone}>
        <span className="text-[11px] font-semibold text-white">{display === null ? '—' : `${Math.round(display)}%`}</span>
      </Ring>
      <div className="mt-2 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-400">
        <Icon size={10} /> {label}
      </div>
      <p className="mt-0.5 max-w-full truncate text-center text-[9px] text-slate-600" title={detail}>{detail}</p>
    </div>
  );
}

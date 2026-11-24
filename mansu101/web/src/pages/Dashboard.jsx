import RunControl from '../components/RunControl.jsx';
import StatsGrid from '../components/StatsGrid.jsx';
import HealthPanel from '../components/HealthPanel.jsx';
import RunCharts from '../components/Charts.jsx';
import SessionsPanel from '../components/SessionsPanel.jsx';
import LogTerminal from '../components/LogTerminal.jsx';

export default function Dashboard({ onTabChange, onOpenVnc }) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid gap-4 xl:grid-cols-[1.85fr_1fr]">
        <RunControl
          onOpenSettings={() => onTabChange('settings')}
          onOpenVnc={onOpenVnc}
        />
        <HealthPanel />
      </div>

      <StatsGrid />
      <RunCharts />
      <SessionsPanel />

      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-white">Live terminal</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">Events streamed directly from the VPS automation engine</p>
          </div>
          <button type="button" onClick={() => onTabChange('logs')} className="text-[11px] font-medium text-violet-300 transition hover:text-violet-200">
            Open full log view →
          </button>
        </div>
        <LogTerminal mode="compact" onOpenLogs={() => onTabChange('logs')} />
      </div>
    </div>
  );
}

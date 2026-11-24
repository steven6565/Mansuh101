import { useStore } from '../store.jsx';
import { Modal } from './ui.jsx';
import { Monitor, Shield, External } from './Icons.jsx';

export default function VncModal({ open, onClose }) {
  const { vncUrl } = useStore();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Remote desktop"
      subtitle="Secure browser-based VNC view of the VPS display"
      width="max-w-6xl"
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[10px] text-slate-500">
            <Shield size={11} /> VNC traffic is only as secure as the tunnel in front of it — use HTTPS + authentication.
          </p>
          {vncUrl && (
            <a href={vncUrl} target="_blank" rel="noreferrer" className="btn-ghost !py-1.5 !text-[11px]">
              Open in new tab <External size={12} />
            </a>
          )}
        </div>
      )}
    >
      {vncUrl ? (
        <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-black">
          <iframe
            title="Remote desktop via VNC"
            src={vncUrl}
            className="h-[65vh] w-full"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/[0.08] bg-black/20 p-6">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-300 ring-1 ring-inset ring-violet-400/20">
            <Monitor size={18} />
          </div>
          <h4 className="text-sm font-semibold text-white">VNC is not configured</h4>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-500">
            Set <code className="kbd">VNC_URL</code> in <code className="kbd">.env</code> to a secured noVNC URL
            (for example behind Nginx basic auth and HTTPS), then restart the server. The dashboard will embed
            the remote desktop here.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-slate-400">
{`# On the VPS (visible browser mode)
sudo apt install xvfb x11vnc novnc websockify
Xvfb :99 -screen 0 1600x1000x24 &
export DISPLAY=:99
x11vnc -display :99 -nopw -listen 127.0.0.1 -forever &
websockify --web /usr/share/novnc 6080 localhost:5900

# .env
BROWSER_HEADLESS=false
VNC_URL=https://your-vps/vnc.html?autoconnect=1&resize=scale`}
          </pre>
          <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
            In production, bind VNC to localhost only and expose it through Nginx with TLS and authentication.
            See <span className="font-mono">deploy/nginx.conf</span> for a template.
          </p>
        </div>
      )}
    </Modal>
  );
}

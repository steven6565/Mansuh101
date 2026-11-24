import net from 'node:net';
import tls from 'node:tls';

/**
 * Minimal SMTP client used only for report delivery.
 *
 * No dependency, STARTTLS + AUTH LOGIN support, 15s timeouts. When the
 * EMAIL_* variables are not set, verifyConnection() explains exactly what is
 * missing instead of pretending the report was sent.
 */

export function emailConfig() {
  return {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || Number(process.env.SMTP_PORT) === 465,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || '',
  };
}

export function verifyConnection() {
  const config = emailConfig();
  const missing = [];
  if (!config.host) missing.push('SMTP_HOST');
  if (!config.from) missing.push('EMAIL_FROM');
  if (!config.user) missing.push('SMTP_USER');
  if (!config.pass) missing.push('SMTP_PASS');
  if (missing.length) return { ok: false, reason: `missing ${missing.join(', ')}` };
  return { ok: true };
}

function readResponse(socket, { expect = [220] } = {}) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('timeout', onTimeout);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1] ?? '';
      if (/^\d{3} /.test(last)) {
        const code = Number(last.slice(0, 3));
        finish(null, { code, text: buffer });
      }
    };
    const onError = (error) => finish(error);
    const onTimeout = () => finish(new Error('SMTP timeout'));
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('timeout', onTimeout);
  });
}

async function command(socket, line, expect) {
  socket.write(`${line}\r\n`);
  const response = await readResponse(socket);
  if (expect && !expect.includes(response.code)) {
    throw new Error(`SMTP ${response.code}: ${response.text.trim().slice(0, 200)}`);
  }
  return response;
}

export async function sendMail({ to, subject, text, html }) {
  const readiness = verifyConnection();
  if (!readiness.ok) throw new Error(`Email delivery is not configured: ${readiness.reason}`);
  const config = emailConfig();
  const recipient = String(to).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) throw new Error('Invalid recipient email address');

  const boundary = `visitor-${Date.now().toString(36)}`;
  const message = [
    `From: ${config.from}`,
    `To: ${recipient}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html ?? `<pre style="font:13px/1.6 ui-monospace,monospace">${escapeHtml(text)}</pre>`,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const socket = await connect(config);
  try {
    await readResponse(socket, { expect: [220] });
    await command(socket, `EHLO visitor.local`, [250]);
    if (config.secure) {
      await command(socket, 'AUTH LOGIN', [334]);
    } else {
      const starttls = await command(socket, 'STARTTLS', [220]);
      void starttls;
      const secured = await upgrade(socket);
      socket = secured;
      await command(socket, 'EHLO visitor.local', [250]);
      await command(socket, 'AUTH LOGIN', [334]);
    }
    await command(socket, Buffer.from(config.user).toString('base64'), [334]);
    await command(socket, Buffer.from(config.pass).toString('base64'), [235]);
    await command(socket, `MAIL FROM:<${extractAddress(config.from)}>`, [250]);
    await command(socket, `RCPT TO:<${recipient}>`, [250, 251]);
    await command(socket, 'DATA', [354]);
    socket.write(`${message.replace(/\n\./g, '\n..')}\r\n.\r\n`);
    await readResponse(socket, { expect: [250] });
    await command(socket, 'QUIT', [221]).catch(() => {});
    return { ok: true };
  } finally {
    socket.end();
    socket.destroy();
  }
}

function extractAddress(value) {
  const match = String(value).match(/<([^>]+)>/);
  return match ? match[1] : String(value).trim();
}

function connect(config) {
  return new Promise((resolve, reject) => {
    const options = { host: config.host, port: config.port, timeout: 15000 };
    const socket = config.secure
      ? tls.connect({ ...options, servername: config.host })
      : net.connect(options);
    socket.once('error', reject);
    socket.once('timeout', () => reject(new Error('SMTP connection timeout')));
    socket.once(config.secure ? 'secureConnect' : 'connect', () => resolve(socket));
  });
}

function upgrade(socket) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({ socket, servername: emailConfig().host, timeout: 15000 }, () => resolve(secured));
    secured.once('error', reject);
    secured.once('timeout', () => reject(new Error('STARTTLS timeout')));
  });
}

export async function sendReportEmail({ report, to }) {
  const data = report.data;
  const gsc = data.searchConsole.totals ?? {};
  const ga4 = data.analytics.totals ?? {};
  const text = [
    `SEO report — ${data.site.name}`,
    `Period: ${data.range.from} → ${data.range.to}`,
    '',
    'Search Console',
    `  Clicks:      ${gsc.clicks ?? 0}`,
    `  Impressions: ${gsc.impressions ?? 0}`,
    `  CTR:         ${((gsc.ctr ?? 0) * 100).toFixed(1)}%`,
    `  Avg. pos:    ${(gsc.position ?? 0).toFixed(1)}`,
    '',
    'Google Analytics 4',
    `  Sessions:    ${ga4.sessions ?? 0}`,
    `  Users:       ${ga4.activeUsers ?? 0}`,
    `  Engagement:  ${((ga4.engagementRate ?? 0) * 100).toFixed(1)}%`,
    '',
    data.audit ? `Latest audit score: ${data.audit.score?.value ?? '—'}/100` : 'No audit has been run yet.',
    '',
    'Open the Visitor dashboard for the full breakdown.',
  ].join('\n');

  return sendMail({
    to,
    subject: `SEO report — ${data.site.name} (${data.range.from} → ${data.range.to})`,
    text,
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

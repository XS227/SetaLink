export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

export function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond === 0) return '0 bps';
  const k = 1000;
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  const i = Math.floor(Math.log(bitsPerSecond) / Math.log(k));
  return `${(bitsPerSecond / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatTimer(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(n => n.toString().padStart(2, '0')).join(':');
}

export function formatPing(ms: number): string {
  return `${ms} ms`;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today     = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) {
    return `Today, ${d.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}`;
  }
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${d.toLocaleDateString('en-US', { day: 'numeric', month: 'long' })}`;
  }
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60)    return 'just now';
  if (seconds < 3600)  return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return formatDate(d);
}

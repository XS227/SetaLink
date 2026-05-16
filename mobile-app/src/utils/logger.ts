/* eslint-disable no-console */
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function log(level: LogLevel, tag: string, ...args: unknown[]): void {
  if (!__DEV__) return;
  const prefix = `[SetaLink:${tag}]`;
  const ts     = new Date().toISOString().slice(11, 23);
  switch (level) {
    case 'error': console.error(prefix, ts, ...args); break;
    case 'warn':  console.warn(prefix,  ts, ...args); break;
    default:      console.log(prefix,   ts, ...args); break;
  }
}

export const Logger = {
  info:  (tag: string, ...args: unknown[]) => log('info',  tag, ...args),
  warn:  (tag: string, ...args: unknown[]) => log('warn',  tag, ...args),
  error: (tag: string, ...args: unknown[]) => log('error', tag, ...args),
  debug: (tag: string, ...args: unknown[]) => log('debug', tag, ...args),
};

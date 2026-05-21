// Single source of truth for app version — reads from package.json at build time.
// All screens and services import from here; never hardcode version strings.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string };

export const APP_VERSION  = pkg.version;
export const APP_BUILD    = '30';

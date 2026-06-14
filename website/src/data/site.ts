import { releases } from './releases';

export const VERSION = releases[0].version;
export const TAG = `v${VERSION}`;
export const REPO = 'https://github.com/hendurhance/pandia';
export const RELEASES = `${REPO}/releases`;
export const RELEASE_BASE = `${RELEASES}/download/${TAG}`;

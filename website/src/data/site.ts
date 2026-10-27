import { releases } from './releases';

export const REPO = 'https://github.com/hendurhance/pandia';
export const RELEASES = `${REPO}/releases`;

async function publishedVersion(): Promise<string> {
  const res = await fetch(`${RELEASES}/latest`, { redirect: 'manual' });
  const version = res.headers.get('location')?.match(/\/releases\/tag\/v([^/]+)$/)?.[1];
  if (!version) {
    throw new Error(
      `Could not read the latest published release from ${RELEASES}/latest (HTTP ${res.status}).`,
    );
  }
  return version;
}

const isAfter = (a: string, b: string) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
};

export const VERSION = await publishedVersion();
export const TAG = `v${VERSION}`;
export const RELEASE_BASE = `${RELEASES}/download/${TAG}`;
export const SPONSOR = 'https://github.com/sponsors/hendurhance';
export const publishedReleases = releases.filter((r) => !isAfter(r.version, VERSION));

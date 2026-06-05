
export function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
	if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
	return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

export function formatSize(bytes?: number): string {
	if (bytes == null) return '';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let n = bytes / 1024;
	let u = 0;
	while (n >= 1024 && u < units.length - 1) {
		n /= 1024;
		u++;
	}
	return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[u]}`;
}

export function relativeTime(iso: string): string {
	const t = new Date(iso).getTime();
	const dt = Date.now() - t;
	if (Number.isNaN(dt) || dt < 0) return '';
	const sec = Math.floor(dt / 1000);
	if (sec < 60) return 'just now';
	const min = Math.floor(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.floor(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const d = Math.floor(hr / 24);
	if (d < 30) return `${d}d ago`;
	const mo = Math.floor(d / 30);
	if (mo < 12) return `${mo}mo ago`;
	const y = Math.floor(mo / 12);
	return `${y}y ago`;
}

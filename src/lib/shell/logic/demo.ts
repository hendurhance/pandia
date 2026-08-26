import type { OpenSource } from '$lib/ipc/bindings';

export function buildDemoSource(): OpenSource {
	const text = JSON.stringify(
		{
			app: 'pandia',
			version: '1.5.0',
			features: ['tree', 'code', 'grid', 'graph'],
			config: {
				theme: 'dark-default',
				accent: '#1B1B1D',
				mono: 'IBM Plex Mono',
			},
			events: Array.from({ length: 25 }, (_, i) => ({
				id: i,
				ts: new Date(Date.UTC(2026, 4, 7, 0, 0, i)).toISOString(),
				level: i % 5 === 0 ? 'warn' : 'info',
				msg: `event #${i}`,
			})),
			meta: { open: true, count: 25, ratio: 0.42 },
		},
		null,
		0,
	);
	return { kind: 'text', text, name: 'demo.json' };
}

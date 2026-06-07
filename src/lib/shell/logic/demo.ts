import type { OpenSource } from '$lib/ipc/types';

export function buildDemoSource(): OpenSource {
	const text = JSON.stringify(
		{
			app: 'pandia',
			version: '1.0.0-alpha',
			features: ['tree', 'code', 'grid', 'graph'],
			config: {
				theme: 'terminal-noir',
				accent: '#D6571F',
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

export const SITE_URL = 'https://www.pandia.app';

export interface Faq {
	q: string;
	a: string;
}

export interface Crumb {
	name: string;
	path?: string;
}

export function breadcrumb(trail: Crumb[]) {
	return {
		'@type': 'BreadcrumbList',
		itemListElement: [{ name: 'Home' } as Crumb, ...trail].map((c, i) => ({
			'@type': 'ListItem',
			position: i + 1,
			name: c.name,
			item: c.path ? `${SITE_URL}${c.path}` : SITE_URL,
		})),
	};
}

export function faqSchema(items: Faq[], path: string) {
	return {
		'@type': 'FAQPage',
		'@id': `${SITE_URL}${path}#faq`,
		mainEntity: items.map((f) => ({
			'@type': 'Question',
			name: f.q,
			acceptedAnswer: { '@type': 'Answer', text: f.a },
		})),
	};
}

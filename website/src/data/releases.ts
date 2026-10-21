import data from './releases.json';

export interface ReleaseNote {
	title: string;
	detail?: string;
}

export interface Release {
	version: string;
	date: string;
	tag?: string;
	tagKind?: 'beta' | 'stable';
	groups: { label: string; items: ReleaseNote[] }[];
}

export const releases: Release[] = data as Release[];

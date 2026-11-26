import { describe, expect, it } from 'vitest';
import { groupBy } from './group';

describe('groupBy', () => {
	it('groups items by key and keeps their order', () => {
		const groups = groupBy(['ant', 'bee', 'ape'], (w) => w[0]);
		expect([...groups]).toEqual([
			['a', ['ant', 'ape']],
			['b', ['bee']],
		]);
	});
});

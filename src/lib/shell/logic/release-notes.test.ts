import { describe, it, expect } from 'vitest';
import { releases } from './releases';
import {
	compareVersions,
	fromMarkdown,
	inlineSegments,
	toMarkdown,
	unseenVersions,
	type ReleaseGroup,
} from './release-notes';

describe('compareVersions', () => {
	it('compares each part as a number', () => {
		expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
		expect(compareVersions('0.1.0', '1.0.0')).toBeLessThan(0);
		expect(compareVersions('1.0.8', '1.0.8')).toBe(0);
	});
});

describe('unseenVersions', () => {
	const versions = ['1.0.8', '1.0.7', '1.0.6', '1.0.5'];

	it('shows nothing on a fresh install', () => {
		expect(
			unseenVersions(versions, { running: '1.0.8', lastSeen: null, existingUser: false }),
		).toEqual([]);
	});

	it('shows only the running version to an existing user who has never seen notes', () => {
		expect(
			unseenVersions(versions, { running: '1.0.8', lastSeen: null, existingUser: true }),
		).toEqual(['1.0.8']);
	});

	it('includes every version skipped since the last one seen, up to the running one', () => {
		expect(
			unseenVersions(versions, { running: '1.0.7', lastSeen: '1.0.5', existingUser: true }),
		).toEqual(['1.0.7', '1.0.6']);
	});

	it('shows nothing once the running version has been seen', () => {
		expect(
			unseenVersions(versions, { running: '1.0.8', lastSeen: '1.0.8', existingUser: true }),
		).toEqual([]);
		expect(
			unseenVersions(versions, { running: '1.0.8', lastSeen: '1.0.9', existingUser: true }),
		).toEqual([]);
	});

	it('shows nothing for a build whose version has no notes, such as a dev build', () => {
		expect(
			unseenVersions(versions, { running: '1.1.0', lastSeen: '1.0.5', existingUser: true }),
		).toEqual([]);
		expect(
			unseenVersions(versions, { running: '1.1.0', lastSeen: null, existingUser: true }),
		).toEqual([]);
	});
});

describe('inlineSegments', () => {
	it('splits code spans out of plain text', () => {
		expect(inlineSegments('Run `pandia -` to read stdin.')).toEqual([
			{ kind: 'text', text: 'Run ' },
			{ kind: 'code', text: 'pandia -' },
			{ kind: 'text', text: ' to read stdin.' },
		]);
	});

	it('turns an https link into a link', () => {
		expect(inlineSegments('See [#27](https://github.com/hendurhance/pandia/issues/27).')).toEqual([
			{ kind: 'text', text: 'See ' },
			{
				kind: 'link',
				text: '#27',
				href: 'https://github.com/hendurhance/pandia/issues/27',
			},
			{ kind: 'text', text: '.' },
		]);
	});

	it('points a site-relative link at pandia.app', () => {
		expect(inlineSegments('[the guide](/docs/command-line)')).toEqual([
			{ kind: 'link', text: 'the guide', href: 'https://www.pandia.app/docs/command-line' },
		]);
	});

	it.each(['javascript:alert(document.cookie)', 'http://example.com', '//evil.example/x'])(
		'keeps a link to %s as plain text',
		(href) => {
			const text = `Click [here](${href}) now`;
			expect(inlineSegments(text)).toEqual([{ kind: 'text', text }]);
		},
	);

	it('keeps HTML and an unclosed backtick as literal text', () => {
		const text = '<img src=x onerror="alert(1)"> & a stray ` here';
		expect(inlineSegments(text)).toEqual([{ kind: 'text', text }]);
	});
});

describe('release notes as markdown', () => {
	it('writes a heading per group and one bullet per note', () => {
		const md = toMarkdown({
			version: '9.9.9',
			date: 'January 1, 2027',
			groups: [
				{ label: 'New', items: [{ title: 'Open `a.json`', detail: 'From [here](/docs).' }] },
				{ label: 'Fixed', items: [{ title: 'No detail' }] },
			],
		});
		expect(md).toBe(
			'### New\n\n- **Open `a.json`**: From [here](https://www.pandia.app/docs).\n\n### Fixed\n\n- **No detail**',
		);
	});

	const shown = (groups: ReleaseGroup[] | null) =>
		groups?.map((g) => ({
			label: g.label,
			items: g.items.map((it) => [
				inlineSegments(it.title),
				it.detail && inlineSegments(it.detail),
			]),
		}));

	it.each(releases.map((r) => [r.version, r] as const))(
		'reads back the notes for %s as they were written',
		(_, r) => {
			expect(shown(fromMarkdown(toMarkdown(r)))).toEqual(shown(r.groups));
		},
	);

	it('does not recognise text in any other shape, such as the old placeholder', () => {
		expect(fromMarkdown('See assets to download and install this version.')).toBeNull();
		expect(fromMarkdown('')).toBeNull();
	});
});

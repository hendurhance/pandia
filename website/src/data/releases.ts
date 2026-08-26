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

export const releases: Release[] = [
	{
		version: '1.0.6',
		date: 'August 26, 2026',
		tag: 'Stable',
		tagKind: 'stable',
		groups: [
			{
				label: 'New',
				items: [
					{
						title: 'Generate Dart models for Flutter',
						detail:
							'Dart joins TypeScript, Rust, Go, Kotlin, Python, PHP, Java, Zod and JSON Schema in the Types panel. You get null-safe classes with `fromJson` and `toJson`, and no packages to add to your project.',
					},
					{
						title: 'Choose the view every file opens in',
						detail:
							'Pick Tree, Code, Grid or Graph under Settings → Layout. Contributed by [@mcbyte-it](https://github.com/mcbyte-it).',
					},
				],
			},
			{
				label: 'Improved',
				items: [
					{
						title: 'Error messages tell you what to do about it',
						detail:
							'`document too large: 2147483649 bytes (limit 2147483648 bytes)` now reads “This document is 2.00 GiB — the limit for this action is 2.00 GiB. Use a smaller file.” Every error keeps the technical detail a developer needs and drops the raw byte counts.',
					},
					{
						title: 'YAML, CSV, XML and cURL convert however the file arrives',
						detail:
							'Dropping one in, opening it from the file picker or reopening it from recent files now offers the same conversion that pasting always did.',
					},
					{
						title: 'Files with comments warn you before you lose them',
						detail:
							'Opening a `.jsonc` says the comments were removed in order to read it, and saving asks once more — with Save As offered so the original file survives untouched.',
					},
					{
						title: 'Scrolling holds its place in Grid, Compare and the Outline',
						detail:
							'Rows arriving above the viewport used to shift what you were reading out from under you. The Tree already held its position; now every list does.',
					},
					{
						title: 'Exit moved to the File menu on Windows and Linux',
						detail:
							'It used to sit at the bottom of Help, which is not where anyone looks for it. macOS is unchanged — Quit stays in the Pandia menu.',
					},
					{
						title: 'Auto-repair runs wherever a document fails to parse',
						detail: 'Not only on paste. The setting is renamed to match what it does.',
					},
					{
						title: 'Copy buttons say when the clipboard is unavailable',
						detail: 'Previously they did nothing at all.',
					},
				],
			},
			{
				label: 'Fixed',
				items: [
					{
						title: 'Compare showed differences that were not real',
						detail:
							'A file with a dozen small edits spread through it — 154 KB was enough to trigger it — reported every line on both sides as changed. Nothing warned you; the comparison simply looked like a full rewrite. Comparing is now exact at any size Pandia can open.',
					},
					{
						title: 'Compare refused any file over 3 MB',
						detail:
							'That limit is gone. Both documents are now compared in Rust and only the lines on screen are fetched, so an 800,000-line comparison takes about 40 milliseconds.',
					},
					{
						title: 'Compare could report no change when a number had changed',
						detail:
							'Any integer of 16 digits or more was rounded before the two sides were compared, so two Discord or Twitter snowflakes within about 128 of each other read as identical — and `10.00` against `10.0` showed nothing at all. Numbers are now compared exactly as they appear in your file.',
					},
					{
						title: 'Editing a number could silently change it',
						detail:
							'Clicking into a value and clicking away without typing anything was enough: a 100-digit integer came back as `1.2345678901234568e+99`, and `1e309` came back as `null`. Every digit you type is now stored exactly as written, and undo restores the original text.',
					},
					{
						title: 'Editing a long string could shorten it',
						detail:
							'Values over 1,000 characters are shown abbreviated in the tree, and if the full value could not be fetched the editor opened on the abbreviation — saving then wrote that over your data. The editor now refuses to open rather than risk it.',
					},
					{
						title: 'Grid filters treated two different big numbers as equal',
						detail:
							'Two 19-digit IDs differing only in the last digit matched the same filter, and a number range rounded the bounds you typed before comparing. Filters now compare numbers exactly.',
					},
					{
						title: 'Copying a value could round a large number',
						detail:
							'Copy value on a node holding a 64-bit ID put the rounded form on your clipboard.',
					},
					{
						title: 'The filter list showed large numbers as `{…}`',
						detail:
							'Values that needed full precision fell through to the placeholder meant for objects, so you could not tell them apart or pick one.',
					},
					{
						title: 'Graph view would not open very large objects',
						detail:
							'An object too big to count its children up front was drawn as a leaf, with no way to expand it.',
					},
					{
						title: 'Undo and redo left Find results stale',
						detail:
							'Search hits kept pointing at the document as it was before you undid. Every edit path now refreshes them.',
					},
					{
						title: 'The theme setting did nothing',
						detail:
							'The Dark, Light and Auto buttons only filtered which theme cards were listed below them; clicking one looked like a choice but changed nothing, before or after a relaunch. They now switch the theme immediately, and Auto follows your system appearance.',
					},
					{
						title: 'Three crashes while scrolling and editing',
						detail:
							'Scrolling the tree while rows loaded in above you, clicking a row that had just collapsed, and expanding a gap in Compare while the diff reloaded could each fail and leave the pane blank.',
					},
					{
						title: 'Compare jumped back to the top while you were scrolling',
						detail:
							'Scrolling quickly or dragging the scrollbar pulled the view back to the first difference every time new rows arrived.',
					},
					{
						title: 'The tree view could not scroll sideways',
						detail:
							'Deeply nested documents and very long values ran off the right edge with no way to reach them.',
					},
					{
						title: 'Long file names were unreadable in Compare',
						detail:
							'Two files differing only at the end — `orders.a.json` and `orders.b.json` — displayed identically. Names now keep both ends, so the part that tells them apart survives.',
					},
					{
						title: 'Grid cells could sit on “loading” forever',
						detail: 'A failed fetch reported nothing and the cells never resolved.',
					},
				],
			},
		],
	},
	{
		version: '1.0.5',
		date: 'July 29, 2026',
		tag: 'Stable',
		tagKind: 'stable',
		groups: [
			{
				label: 'Improved',
				items: [
					{
						title: 'Error messages say what is actually wrong',
						detail:
							'`parse error: expected value at line 1 column 1` was the same sentence for a stray quote, a bare word and an empty document. You now get “One comma too many”, “The document is cut off”, “A property has no value” — with the offending character marked in a snippet of your own text.',
					},
					{
						title: 'One-click fixes',
						detail:
							'Where the problem is repairable the message carries a button that applies it and reloads, instead of leaving you to hunt through a long line by hand.',
					},
					{
						title: 'Opening a YAML, XML, CSV or cURL file offers to convert it',
						detail:
							'Pandia has always done this for pasted text; as a file it used to report a stray byte somewhere in the middle.',
					},
					{
						title: 'Every way in explains itself',
						detail:
							'Paste, the file picker, drag-and-drop, recent files and URL fetch. Previously only some of them did.',
					},
				],
			},
			{
				label: 'Fixed',
				items: [
					{
						title: 'JSON wrapped in quotes opens as your data',
						detail:
							'In 1.0.4 a document copied out of code, a shell command or a spreadsheet cell — `\'{"orderId":917399}\'` — loaded as one long piece of text instead of an object. Single quotes, smart quotes and backticks are all understood, at either end or both.',
					},
					{
						title: 'A stray quote at one end no longer stops the file opening',
						detail: 'Which is what a slightly-short selection leaves behind.',
					},
					{
						title: 'Invisible characters before the first bracket no longer break a paste',
						detail:
							'1.0.4 handled the byte order mark; zero-width spaces, word joiners, direction marks and nulls now go too — the ones that made a file fail with nothing visibly wrong, where deleting a single character you could not see fixed it.',
					},
					{
						title: 'A failed paste keeps your text',
						detail:
							'Pasting something Pandia could not read used to empty the box, so you had to go back and copy it again.',
					},
				],
			},
		],
	},
	{
		version: '1.0.4',
		date: 'July 25, 2026',
		tag: 'Stable',
		tagKind: 'stable',
		groups: [
			{
				label: 'Improved',
				items: [
					{
						title: 'NDJSON files round-trip',
						detail:
							'Saving a `.ndjson` or `.jsonl` file writes one record per line again rather than silently rewriting it as a JSON array, and untouched records are written back byte for byte. Save As picks the format from the extension you choose.',
					},
					{
						title: 'Numbers keep every digit through all of this',
						detail:
							'64-bit IDs and snowflakes in an NDJSON or JSON5 file stay exact, and multi-gigabyte NDJSON still opens on the streaming path.',
					},
				],
			},
			{
				label: 'Fixed',
				items: [
					{
						title: 'NDJSON and JSON Lines files open',
						detail:
							'A `.ndjson` or `.jsonl` file loads as an array of its records — one value per line, pretty-printed records, blank lines and CRLF all handled — instead of failing with “trailing characters at line 2”.',
					},
					{
						title: 'JSONC files open',
						detail:
							'Line and block comments and trailing commas are accepted, so a `tsconfig.jsonc` or any commented config loads straight away.',
					},
					{
						title: 'JSON5 files open',
						detail:
							'Unquoted keys, single-quoted strings, hex numbers, leading and trailing decimal points, `+1`, `Infinity`, `NaN` and escaped line continuations are all understood.',
					},
					{
						title: 'Files saved with a UTF-8 byte order mark open',
						detail:
							'These are common on Windows and previously failed on the very first character.',
					},
					{
						title: '`.jsonl` and `.ndjson` appear in the Open dialog',
						detail:
							'They were missing, so those files could not even be selected. All six extensions now appear in Open, in the recent-files picker and in Compare.',
					},
					{
						title: 'Undoing back to the last saved state clears the unsaved marker',
					},
				],
			},
		],
	},
	{
		version: '1.0.3',
		date: 'July 23, 2026',
		tag: 'Stable',
		tagKind: 'stable',
		groups: [
			{
				label: 'Improved',
				items: [
					{ title: 'Settings opens from its own entry in the menu bar' },
					{
						title: 'Graph export is a split button',
						detail:
							'Download in your last-used format with one click, or open the menu to pick another.',
					},
				],
			},
			{
				label: 'Fixed',
				items: [
					{
						title: 'Keyboard shortcuts work on Windows and Linux',
						detail:
							'Save, find, new tab, switching views and the rest now fire reliably even where the native menu accelerators did not.',
					},
					{
						title: 'Shortcut hints read correctly on every platform',
						detail:
							'⌘, ⇧, ⌥ and ⏎ now show as Ctrl, Shift, Alt and Enter on Windows and Linux across menus, tooltips, the command palette and inline editors.',
					},
					{
						title: 'Graph panning and zoom are smooth on Windows',
						detail:
							'Mouse-wheel and precision-touchpad scrolling no longer crawls, lurches or overshoots, and Ctrl with +/− zooms even when a touchpad swallows the pinch gesture.',
					},
				],
			},
		],
	},
	{
		version: '1.0.2',
		date: 'June 25, 2026',
		tag: 'Stable',
		tagKind: 'stable',
		groups: [
			{
				label: 'Fixed',
				items: [
					{
						title: 'The traffic light buttons close the app on macOS',
						detail: 'Closing the window used to need a force quit.',
					},
				],
			},
		],
	},
	{
		version: '1.0.1',
		date: 'June 14, 2026',
		tag: 'Stable',
		tagKind: 'stable',
		groups: [
			{
				label: 'Fixed',
				items: [
					{
						title: 'Big integers stay exact everywhere',
						detail:
							'Editing, duplicating, copying, pasting or filtering a large number — 64-bit IDs, snowflakes — no longer rounds its last digits, including multi-row copy and extract in the grid.',
					},
					{
						title: 'Grid copy, extract and filter report their errors',
						detail: 'They used to fail silently.',
					},
					{ title: 'Fixed a memory leak from opening and closing many tabs in one session' },
				],
			},
		],
	},
	{
		version: '1.0.0',
		date: 'June 7, 2026',
		tag: 'Stable',
		tagKind: 'stable',
		groups: [
			{
				label: 'Highlights',
				items: [
					{ title: 'First stable release — Pandia is now 1.0' },
					{
						title: 'The full workbench',
						detail:
							'Five views (Tree, Code, Grid, Graph, Compare), type generation for nine languages, validate, compare, repair and export.',
					},
					{ title: 'Opens and scrolls multi-gigabyte files with no lag' },
					{ title: 'Offline, private and free — your data never leaves your machine' },
				],
			},
		],
	},
	{
		version: '0.1.0',
		date: 'February 14, 2026',
		tag: 'Beta',
		tagKind: 'beta',
		groups: [
			{
				label: 'Highlights',
				items: [
					{
						title: 'First public beta',
						detail: 'A native JSON workbench for macOS, Windows and Linux, built with Rust and Tauri.',
					},
					{ title: 'Open, navigate and edit JSON across multiple views' },
					{ title: 'Generate types from any document' },
					{ title: 'Import and export JSON, YAML, XML and CSV' },
					{ title: 'Compare documents and auto-repair malformed JSON' },
					{ title: 'Offline, private and free — your data never leaves your machine' },
				],
			},
		],
	},
];

export interface Guide {
  slug: string;
  cardTitle: string;
  title: string;
  description: string;
  blurb: string;
  datePublished: string;
}

export const guides: Guide[] = [
  {
    slug: 'open-large-json-file',
    cardTitle: 'How to open a large JSON file',
    title: 'Open a Large JSON File on Windows, Mac & Linux',
    description:
      "Large JSON file won't open? Open and view multi-gigabyte JSON on Windows, Mac and Linux without freezing, crashing or size limits. Free and offline.",
    blurb:
      'Your editor freezes, the browser tab crashes, the online tool says "file too large". Here is why big JSON breaks ordinary tools — and how to open hundreds of MB or multiple GB instantly.',
    datePublished: '2026-07-20',
  },
  {
    slug: 'vscode-large-json',
    cardTitle: 'Fix VS Code freezing on large JSON',
    title: 'Why VS Code Freezes on Large JSON (and the Fix)',
    description:
      "VS Code hangs or crashes on a big JSON file? Here's why, and how to open multi-gigabyte JSON instantly with a native viewer. Free, offline, no upload.",
    blurb:
      'VS Code loads and tokenizes the whole file, then formats and folds it — three passes that stall on a large document. Here is what is happening and the native fix.',
    datePublished: '2026-07-20',
  },
  {
    slug: 'notepad-plus-plus-large-json',
    cardTitle: "Notepad++ can't open large JSON?",
    title: "Notepad++ Can't Open Large JSON? Do This Instead",
    description:
      'Notepad++ stalling on a large JSON file? See why, and how to open, read and search multi-gigabyte JSON instantly on Windows. Free and offline.',
    blurb:
      'Notepad++ can open a big file, but plugins like JSON Viewer choke on it, and there is no tree to navigate. Here is a native alternative built for the size.',
    datePublished: '2026-07-20',
  },
];

export const guidesBySlug = Object.fromEntries(guides.map((g) => [g.slug, g]));

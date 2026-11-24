export interface FaqItem {
  q: string;
  a: string;
}

export const faqs: FaqItem[] = [
  {
    q: 'Is my data uploaded anywhere?',
    a: "No. Pandia is a desktop app and processes everything on your computer. It only goes online to check for a new version once a day, and when <em>you</em> fetch a URL or send a cURL request. There are no accounts and no usage tracking.",
  },
  {
    q: 'How large a file can it open?',
    a: "Any size, including files of several gigabytes. From <code>10 MB</code> up, Pandia skips building the full tree and only decodes the part of the file you're looking at, so opening and scrolling have no size limit. Editing the whole document at once, exporting it and validating it need the full file in memory, so those work up to about 200 MB.",
  },
  {
    q: 'Which formats can I import and export?',
    a: "Import and auto-detect <code>JSON</code>, <code>YAML</code>, <code>XML</code> and <code>CSV</code>, fetch from a URL, or paste a <code>cURL</code> command to send it and open the response. Export documents as JSON, JSON-min, YAML, CSV or XML, and graph images as PNG, JPEG or SVG. (CSV export needs a root array of objects.)",
  },
  {
    q: 'Can it generate types from my JSON?',
    a: "Yes — ten targets: <code>TypeScript</code>, <code>Rust</code>, <code>Go</code>, <code>Kotlin</code>, <code>Python</code>, <code>PHP</code>, <code>Java</code>, <code>Dart</code>, <code>Zod</code> and <code>JSON Schema (2020-12)</code>. Optional fields are inferred from the data; generation is deliberately not configurable.",
  },
  {
    q: 'Can AI coding agents use Pandia?',
    a: 'Yes. Any agent that can run a terminal command, such as Claude Code, Cursor or Codex CLI, can hand its JSON to Pandia with the <code>pandia</code> command and wait while you review it. You check it against a schema, fix it and press Save, and the agent gets back what you saved. Everything stays on your machine. See <a href="/guides/review-ai-agent-json">reviewing JSON from AI agents</a>.',
  },
  {
    q: 'Does it have a query language like jq or JMESPath?',
    a: "No. Pandia doesn't ship a query language. Instead you navigate the tree, run substring find &amp; replace, and use the Grid's column filters (13 operators, OR-of-AND groups) and sorting to slice arrays of objects.",
  },
  {
    q: 'Is it really free?',
    a: 'Yes. Pandia is free and open source under <code>Apache-2.0</code>. There are no paid tiers and no plans for any. The source lives at <a href="https://github.com/hendurhance/pandia">github.com/hendurhance/pandia</a>.',
  },
];

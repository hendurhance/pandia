export interface FaqItem {
  q: string;
  a: string;
}

export const faqs: FaqItem[] = [
  {
    q: 'Is my data uploaded anywhere?',
    a: "No. Pandia is a native desktop app and everything is processed locally. The only time it touches the network is when <em>you</em> fetch a document from a URL. No accounts, no cloud, no telemetry.",
  },
  {
    q: 'How large a file can it open?',
    a: "Any size — hundreds of MB, multiple GB. At <code>≥ 10 MB</code>, lazy zero-copy slicing (via sonic-rs) opens the file without parsing the whole tree, and the UI only fetches what's on screen — so there's no cap on opening or viewing. Only whole-document edit, export and validation materialize the root (a ~200 MB ceiling).",
  },
  {
    q: 'Which formats can I import and export?',
    a: "Import and auto-detect <code>JSON</code>, <code>YAML</code>, <code>XML</code>, <code>CSV</code> and <code>cURL</code>, or fetch from a URL. Export documents as JSON, JSON-min, YAML, CSV or XML, and graph images as PNG, JPEG or SVG. (CSV export needs a root array of objects.)",
  },
  {
    q: 'Can it generate types from my JSON?',
    a: "Yes — nine targets: <code>TypeScript</code>, <code>Rust</code>, <code>Go</code>, <code>Kotlin</code>, <code>Python</code>, <code>PHP</code>, <code>Java</code>, <code>Zod</code> and <code>JSON Schema (2020-12)</code>. Optional fields are inferred from the data; generation is deliberately not configurable.",
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

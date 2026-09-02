// Drives the /json-to-<slug> pages (src/pages/json-to-[target].astro) and the
export interface Converter {
  slug: string;
  kind: 'type' | 'format';
  name: string;
  title: string;
  description: string;
  sub: string;
  inputJson: string;
  outputLang: string;
  output: string;
  intro: string;
  bullets: string[];
  faq: { q: string; a: string }[];
}

const TYPE_INPUT = `{
  "id": 42,
  "name": "Ada",
  "active": true,
  "tags": ["admin", "early"]
}`;

const ARRAY_INPUT = `[
  { "id": 1, "name": "Ada",   "active": true },
  { "id": 2, "name": "Linus", "active": false }
]`;

const localAngle = (verb: string) =>
  `Because Pandia runs on your machine, you can ${verb} a multi-gigabyte file without pasting it into a website — nothing is uploaded, and there's no size limit on opening.`;

export const converters: Converter[] = [
  {
    slug: 'typescript',
    kind: 'type',
    name: 'TypeScript',
    title: 'JSON to TypeScript — Generate Types & Interfaces',
    description: 'Convert JSON to TypeScript interfaces, with optional and nullable fields inferred. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Generate ready-to-paste TypeScript interfaces from any JSON document. Optional and nullable fields are inferred for you — no configuration, no upload.',
    inputJson: TYPE_INPUT,
    outputLang: 'TypeScript',
    output: `export interface Root {
  id: number;
  name: string;
  active: boolean;
  tags: string[];
}`,
    intro: 'Pandia turns a JSON document into an idiomatic <code>export interface</code> hierarchy. It samples the data and infers the shape: fields that are missing in some objects become optional, and <code>null</code> values become nullable — so the types match the data you actually have.',
    bullets: [
      'Idiomatic <code>export interface</code> output with a <code>Root</code> entry point.',
      'Optional (<code>?</code>) and nullable fields inferred from the document.',
      'Nested objects and arrays become their own named interfaces.',
      'Deterministic and not configurable — pick the target, copy, paste.',
    ],
    faq: [
      { q: 'How does Pandia generate TypeScript from JSON?', a: 'Open the Types panel, choose TypeScript, and Pandia infers an interface hierarchy from the document — copy the output and paste it into your project.' },
      { q: 'Are optional and nullable fields handled?', a: 'Yes. Fields missing from some objects are marked optional, and null values become nullable, so the generated interfaces reflect the real data.' },
      { q: 'Does it work offline and on large files?', a: 'Yes — generation runs entirely on your machine with no upload, and Pandia handles multi-gigabyte JSON without freezing.' },
    ],
  },
  {
    slug: 'go',
    kind: 'type',
    name: 'Go',
    title: 'JSON to Go — Generate Go Structs from JSON',
    description: 'Convert JSON to Go structs with matching JSON tags and idiomatic casing. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Generate Go structs — complete with `json:"…"` tags — from any JSON document. Idiomatic casing and inferred optionals, with nothing uploaded.',
    inputJson: TYPE_INPUT,
    outputLang: 'Go',
    output: `type Root struct {
	ID     int      \`json:"id"\`
	Name   string   \`json:"name"\`
	Active bool     \`json:"active"\`
	Tags   []string \`json:"tags"\`
}`,
    intro: 'Pandia turns a JSON document into Go <code>struct</code> definitions with the matching <code>json:"…"</code> tags. Field names are converted to idiomatic exported Go casing (and common initialisms like <code>ID</code> are preserved) while the tags keep the original JSON keys.',
    bullets: [
      'Exported <code>struct</code> fields with correct <code>json:"…"</code> tags.',
      'Idiomatic Go casing, with initialisms like <code>ID</code> and <code>URL</code> preserved.',
      'Nested objects and arrays become named structs and slices.',
      'Deterministic output — no options to tweak.',
    ],
    faq: [
      { q: 'How do I generate Go structs from JSON?', a: 'Open the Types panel in Pandia, choose Go, and copy the generated structs — each with the JSON tags needed to unmarshal the original document.' },
      { q: 'Are JSON tags included?', a: 'Yes. Every field gets a json:"…" tag matching the original key, so encoding/json round-trips your data correctly.' },
      { q: 'Does it work offline and on large files?', a: 'Yes — everything runs locally with no upload, and Pandia opens multi-gigabyte JSON without lag.' },
    ],
  },
  {
    slug: 'rust',
    kind: 'type',
    name: 'Rust',
    title: 'JSON to Rust — Generate serde Structs from JSON',
    description: 'Convert JSON to Rust structs that derive serde Serialize and Deserialize. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Generate serde-ready Rust structs from any JSON document. Inferred optionals, idiomatic snake_case, and nothing leaves your machine.',
    inputJson: TYPE_INPUT,
    outputLang: 'Rust',
    output: `use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Root {
    pub id: i64,
    pub name: String,
    pub active: bool,
    pub tags: Vec<String>,
}`,
    intro: 'Pandia turns a JSON document into Rust <code>struct</code> definitions that derive <code>Serialize</code> and <code>Deserialize</code>. Fields use idiomatic <code>snake_case</code>, optional fields become <code>Option&lt;T&gt;</code>, and arrays become <code>Vec&lt;T&gt;</code> — ready to drop into a serde project.',
    bullets: [
      'Structs with <code>#[derive(Serialize, Deserialize)]</code> for serde.',
      'Optional fields inferred as <code>Option&lt;T&gt;</code>; arrays as <code>Vec&lt;T&gt;</code>.',
      'Idiomatic <code>snake_case</code> field names.',
      'Pandia itself is built in Rust — the generator is fast and deterministic.',
    ],
    faq: [
      { q: 'How do I generate Rust structs from JSON?', a: 'Open the Types panel, choose Rust, and copy the serde-ready structs into your project.' },
      { q: 'Does it use serde?', a: 'Yes. The generated structs derive Serialize and Deserialize, so they work directly with serde_json.' },
      { q: 'Does it work offline and on large files?', a: 'Yes — generation is fully local with no upload, and Pandia handles multi-gigabyte JSON without freezing.' },
    ],
  },
  {
    slug: 'python',
    kind: 'type',
    name: 'Python',
    title: 'JSON to Python — Generate Dataclasses from JSON',
    description: 'Convert JSON to Python dataclasses with type hints and Optional fields. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Generate typed Python <code>@dataclass</code> definitions from any JSON document. Inferred optionals, idiomatic snake_case, nothing uploaded.',
    inputJson: TYPE_INPUT,
    outputLang: 'Python',
    output: `from dataclasses import dataclass

@dataclass
class Root:
    id: int
    name: str
    active: bool
    tags: list[str]`,
    intro: 'Pandia turns a JSON document into Python <code>@dataclass</code> definitions with type hints. Field names use <code>snake_case</code>, optional fields are inferred, and nested structures become their own dataclasses.',
    bullets: [
      'Typed <code>@dataclass</code> output with standard-library type hints.',
      'Optional fields inferred; nested objects become nested dataclasses.',
      'Idiomatic <code>snake_case</code> field names.',
      'No dependencies required — plain <code>dataclasses</code>.',
    ],
    faq: [
      { q: 'How do I generate Python types from JSON?', a: 'Open the Types panel in Pandia, choose Python, and copy the @dataclass definitions into your code.' },
      { q: 'Does it use Pydantic or dataclasses?', a: 'Pandia generates standard-library dataclasses with type hints, so there are no extra dependencies.' },
      { q: 'Does it work offline and on large files?', a: 'Yes — everything runs locally with no upload, and Pandia opens multi-gigabyte JSON without lag.' },
    ],
  },
  {
    slug: 'zod',
    kind: 'type',
    name: 'Zod',
    title: 'JSON to Zod — Generate Zod Schemas from JSON',
    description: 'Convert JSON to Zod schemas you can paste straight into a project. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Generate a <code>z.object(...)</code> schema from any JSON document, with an inferred TypeScript type for free. Runs locally, nothing uploaded.',
    inputJson: TYPE_INPUT,
    outputLang: 'TypeScript',
    output: `import { z } from "zod";

export const Root = z.object({
  id: z.number(),
  name: z.string(),
  active: z.boolean(),
  tags: z.array(z.string()),
});

export type Root = z.infer<typeof Root>;`,
    intro: 'Pandia turns a JSON document into a Zod <code>z.object(...)</code> schema you can use for runtime validation — plus a <code>z.infer</code> type alias so you get a static TypeScript type from the same source of truth.',
    bullets: [
      'A <code>z.object(...)</code> schema for runtime validation.',
      'A matching <code>z.infer&lt;typeof Root&gt;</code> TypeScript type.',
      'Optional and nullable fields inferred from the data.',
      'Great for validating API responses against real payloads.',
    ],
    faq: [
      { q: 'How do I generate a Zod schema from JSON?', a: 'Open the Types panel in Pandia, choose Zod, and copy the z.object(...) schema into your project.' },
      { q: 'Do I get a TypeScript type too?', a: 'Yes. The output includes a z.infer type alias, so the schema and the static type stay in sync.' },
      { q: 'Does it work offline and on large files?', a: 'Yes — generation is fully local with no upload, and Pandia handles multi-gigabyte JSON without freezing.' },
    ],
  },
  {
    slug: 'kotlin',
    kind: 'type',
    name: 'Kotlin',
    title: 'JSON to Kotlin — Generate Data Classes from JSON',
    description: 'Convert JSON to Kotlin data classes with nullable fields inferred. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Generate idiomatic Kotlin <code>data class</code> definitions from any JSON document. Nullable fields are inferred, nested objects become their own classes, and nothing is uploaded.',
    inputJson: TYPE_INPUT,
    outputLang: 'Kotlin',
    output: `data class Root(
    val id: Long,
    val name: String,
    val active: Boolean,
    val tags: List<String>
)`,
    intro: 'Pandia turns a JSON document into Kotlin <code>data class</code> declarations. Integer values map to <code>Long</code>, fields missing from some objects become nullable (<code>?</code>), and nested objects and arrays become their own named classes — ready to drop into a Kotlin or Android project.',
    bullets: [
      'Idiomatic <code>data class</code> output with <code>val</code> properties.',
      'Nullable (<code>?</code>) fields inferred from the document.',
      'Nested objects and arrays become named classes and <code>List&lt;T&gt;</code>.',
      'Deterministic output — pick the target, copy, paste.',
    ],
    faq: [
      { q: 'How do I generate Kotlin data classes from JSON?', a: 'Open the Types panel in Pandia, choose Kotlin, and copy the generated data classes into your project.' },
      { q: 'Does it work with kotlinx.serialization, Moshi or Gson?', a: 'The output is plain Kotlin data classes, so it works with any of them — add your serializer’s annotations if you need them.' },
      { q: 'Does it run offline on large files?', a: 'Yes — the generator runs on your machine with nothing uploaded, and Pandia opens multi-gigabyte JSON without lag.' },
    ],
  },
  {
    slug: 'java',
    kind: 'type',
    name: 'Java',
    title: 'JSON to Java — Generate Java Classes from JSON',
    description: 'Convert JSON to Java classes (POJOs) with getters and setters. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Generate Java classes — plain POJOs with typed fields, getters and setters — from any JSON document. Boxed types and nested classes inferred, nothing uploaded.',
    inputJson: TYPE_INPUT,
    outputLang: 'Java',
    output: `public class Root {
    private Long id;
    private String name;
    private Boolean active;
    private List<String> tags;

    public Long getId() { return this.id; }
    public void setId(Long id) { this.id = id; }
    public String getName() { return this.name; }
    public void setName(String name) { this.name = name; }
    public Boolean getActive() { return this.active; }
    public void setActive(Boolean active) { this.active = active; }
    public List<String> getTags() { return this.tags; }
    public void setTags(List<String> tags) { this.tags = tags; }
}`,
    intro: 'Pandia turns a JSON document into Java classes — classic POJOs with private fields and public getters and setters. Numbers use boxed types (<code>Long</code>, <code>Double</code>) so nulls are representable, and nested objects and arrays become their own classes and <code>List&lt;T&gt;</code> fields.',
    bullets: [
      'POJO classes with private fields plus public getters and setters.',
      'Boxed types (<code>Long</code>, <code>Double</code>, <code>Boolean</code>) so every field is nullable.',
      'Nested objects and arrays become named classes and <code>List&lt;T&gt;</code>.',
      'Works with Jackson or Gson — add annotations if your setup needs them.',
    ],
    faq: [
      { q: 'How do I generate Java classes from JSON?', a: 'Open the Types panel in Pandia, choose Java, and copy the generated classes — each field comes with a getter and setter.' },
      { q: 'Are these records or classic POJOs?', a: 'Pandia generates classic POJOs with getters and setters, which work on every Java version and with Jackson, Gson and most frameworks.' },
      { q: 'Does it work offline, even on big files?', a: 'Yes — everything runs locally with no upload, and Pandia handles multi-gigabyte documents without freezing.' },
    ],
  },
  {
    slug: 'php',
    kind: 'type',
    name: 'PHP',
    title: 'JSON to PHP — Generate PHP 8 Classes from JSON',
    description: 'Convert JSON to modern PHP 8 classes with typed properties. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Generate modern PHP 8 classes — <code>final readonly</code> with promoted constructor properties — from any JSON document. Typed, nullable-aware, nothing uploaded.',
    inputJson: TYPE_INPUT,
    outputLang: 'PHP',
    output: `<?php

declare(strict_types=1);

final readonly class Root
{
    public function __construct(
        public int $id,
        public string $name,
        public bool $active,
        public array $tags
    ) {}
}`,
    intro: 'Pandia turns a JSON document into modern PHP 8 classes: <code>final readonly</code> classes with constructor property promotion and <code>declare(strict_types=1)</code>. Types are inferred (<code>int</code>, <code>string</code>, <code>bool</code>, <code>array</code>), optional fields become nullable with a <code>null</code> default, and nested objects become their own classes.',
    bullets: [
      'Modern <code>final readonly</code> classes with promoted constructor properties.',
      'Strict types via <code>declare(strict_types=1)</code>.',
      'Optional fields inferred as nullable (<code>?T = null</code>).',
      'Nested objects become their own classes.',
    ],
    faq: [
      { q: 'How do I generate PHP classes from JSON?', a: 'Open the Types panel in Pandia, choose PHP, and copy the generated classes into your project.' },
      { q: 'Which PHP version does the output target?', a: 'PHP 8.1+ — the output uses readonly classes and constructor property promotion. For older PHP, declare explicit properties and a constructor body instead.' },
      { q: 'Is anything uploaded, and how big a file can it handle?', a: 'Nothing is uploaded — conversion is fully local — and there is no size limit on opening, so multi-gigabyte JSON works fine.' },
    ],
  },
  {
    slug: 'json-schema',
    kind: 'type',
    name: 'JSON Schema',
    title: 'JSON to JSON Schema — Generate a Schema from JSON',
    description: 'Convert JSON to a JSON Schema (draft 2020-12). Pandia infers a ready-to-use schema from any JSON document, locally and offline. Free and open source.',
    sub: 'Infer a JSON Schema (draft 2020-12) from any JSON document — types, <code>required</code> fields and string formats detected automatically, nothing uploaded.',
    inputJson: TYPE_INPUT,
    outputLang: 'JSON',
    output: `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://example.com/root.schema.json",
  "title": "Root",
  "type": "object",
  "properties": {
    "id": { "type": "integer" },
    "name": { "type": "string" },
    "active": { "type": "boolean" },
    "tags": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["id", "name", "active", "tags"]
}`,
    intro: 'Pandia infers a <strong>JSON Schema</strong> (draft 2020-12) from a sample document. It walks the data, assigns a <code>type</code> to every field, lists non-null keys under <code>required</code>, and detects string <strong>formats</strong> like <code>date</code>, <code>date-time</code>, <code>email</code> and <code>uri</code> — a schema you can validate against straight away.',
    bullets: [
      'Draft 2020-12 schema with <code>$schema</code>, <code>$id</code> and <code>title</code>.',
      'Every property typed; non-null keys collected into <code>required</code>.',
      'String formats (<code>date</code>, <code>date-time</code>, <code>email</code>, <code>uri</code>) auto-detected.',
      'Nested objects and arrays produce nested schemas.',
    ],
    faq: [
      { q: 'How do I generate a JSON Schema from JSON?', a: 'Open the Types panel in Pandia, choose JSON Schema, and copy the inferred draft 2020-12 schema.' },
      { q: 'Which draft does it target?', a: 'Draft 2020-12. The output includes the $schema keyword so validators know which dialect to use.' },
      { q: 'Does it run locally, and is there a size limit?', a: 'Schema inference runs on your machine with nothing uploaded. Because it materializes the whole document, it targets files up to Pandia’s ~200 MB whole-document ceiling — larger files still open and browse without limit.' },
    ],
  },
  {
    slug: 'yaml',
    kind: 'format',
    name: 'YAML',
    title: 'JSON to YAML — Convert JSON to YAML',
    description: 'Convert JSON to clean, readable YAML. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Turn any JSON document into clean, readable YAML. Import auto-detects either format, and export goes the other way — all on your machine.',
    inputJson: TYPE_INPUT,
    outputLang: 'YAML',
    output: `id: 42
name: Ada
active: true
tags:
  - admin
  - early`,
    intro: 'Pandia converts between JSON and YAML in both directions. Import a <code>.yaml</code> file and Pandia auto-detects and parses it; or open JSON and export it as YAML. The conversion preserves structure, types and ordering.',
    bullets: [
      'Export any open JSON document as YAML.',
      'Import is bidirectional — YAML, JSON, XML, CSV and cURL are auto-detected.',
      'Structure, numbers, booleans and nesting are preserved.',
      localAngle('convert'),
    ],
    faq: [
      { q: 'How do I convert JSON to YAML in Pandia?', a: 'Open the JSON document and choose YAML from the export menu — Pandia writes a clean .yaml file. You can also import YAML and work with it as JSON.' },
      { q: 'Is the conversion lossless?', a: 'Structure, scalar types and ordering are preserved, so round-tripping JSON → YAML → JSON keeps your data intact.' },
      { q: 'Does it work offline and on large files?', a: 'Yes — conversion runs locally with no upload, and there is no size limit on opening the source document.' },
    ],
  },
  {
    slug: 'csv',
    kind: 'format',
    name: 'CSV',
    title: 'JSON to CSV — Convert JSON Arrays to CSV',
    description: 'Convert JSON to CSV. Pandia turns a JSON array of objects into a spreadsheet-ready CSV, locally and offline — even multi-gigabyte files. Free and open source.',
    sub: 'Turn a JSON array of objects into a spreadsheet-ready CSV. Open it, check it in the Grid, and export — no upload, no row limit.',
    inputJson: ARRAY_INPUT,
    outputLang: 'CSV',
    output: `id,name,active
1,Ada,true
2,Linus,false`,
    intro: 'Pandia exports a JSON array of objects as CSV — one row per object, with a header derived from the keys. View the data first in the <strong>Grid</strong> (sort, filter, scan columns), then export the result as CSV for a spreadsheet or data pipeline.',
    bullets: [
      'One row per object, with headers taken from the keys.',
      'Preview and sort the data in the Grid before exporting.',
      'Handles large arrays — there is no row cap on opening.',
      'Tip: CSV export expects a <strong>root array of objects</strong>.',
    ],
    faq: [
      { q: 'How do I convert JSON to CSV in Pandia?', a: 'Open a JSON array of objects, optionally review it in the Grid, then choose CSV from the export menu to write a spreadsheet-ready file.' },
      { q: 'What shape does the JSON need to be?', a: 'CSV export expects a root array of objects — each object becomes a row and its keys become the columns.' },
      { q: 'Does it work offline and on large files?', a: 'Yes — export runs locally with no upload, and Pandia opens multi-gigabyte arrays without freezing.' },
    ],
  },
  {
    slug: 'xml',
    kind: 'format',
    name: 'XML',
    title: 'JSON to XML — Convert JSON to XML',
    description: 'Convert JSON to XML. Runs on your machine. No upload, no size limit. Free and open source.',
    sub: 'Turn any JSON document into XML — and import XML back into a JSON tree. All on your machine, with no size limit on opening.',
    inputJson: TYPE_INPUT,
    outputLang: 'XML',
    output: `<root>
  <id>42</id>
  <name>Ada</name>
  <active>true</active>
  <tags>admin</tags>
  <tags>early</tags>
</root>`,
    intro: 'Pandia converts between JSON and XML in both directions. Import an <code>.xml</code> file and Pandia auto-detects and parses it into a JSON tree; or open JSON and export it as XML, with arrays expanded into repeated elements.',
    bullets: [
      'Export any open JSON document as XML.',
      'Import is bidirectional — XML, JSON, YAML, CSV and cURL are auto-detected.',
      'Arrays become repeated elements; nesting is preserved.',
      localAngle('convert'),
    ],
    faq: [
      { q: 'How do I convert JSON to XML in Pandia?', a: 'Open the JSON document and choose XML from the export menu. You can also import XML and Pandia will parse it into a JSON tree.' },
      { q: 'How are arrays represented?', a: 'Array items are written as repeated elements under their key, and nested objects keep their structure.' },
      { q: 'Does it work offline and on large files?', a: 'Yes — conversion runs locally with no upload, and there is no size limit on opening the source document.' },
    ],
  },
];

export const convertersBySlug = Object.fromEntries(converters.map((c) => [c.slug, c]));

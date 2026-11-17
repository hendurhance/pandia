export const JSON_EXTENSIONS = ['json', 'jsonc', 'json5', 'geojson', 'jsonl', 'ndjson'] as const;

export const JSON_OPEN_FILTERS = [
	{ name: 'JSON, YAML, XML, CSV', extensions: [...JSON_EXTENSIONS, 'yaml', 'yml', 'xml', 'csv'] },
];

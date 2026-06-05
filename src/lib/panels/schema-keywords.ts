const SCHEMA_KEYWORDS = new Set([
	'type',
	'properties',
	'required',
	'items',
	'prefixItems',
	'additionalProperties',
	'patternProperties',
	'enum',
	'const',
	'allOf',
	'anyOf',
	'oneOf',
	'not',
	'if',
	'then',
	'else',
	'$ref',
	'$defs',
	'definitions',
	'minimum',
	'maximum',
	'exclusiveMinimum',
	'exclusiveMaximum',
	'minLength',
	'maxLength',
	'pattern',
	'format',
	'minItems',
	'maxItems',
	'uniqueItems',
	'contains',
	'minContains',
	'maxContains',
	'propertyNames',
	'multipleOf',
	'dependentRequired',
	'dependentSchemas',
	'minProperties',
	'maxProperties',
	'additionalItems',
]);

export function hasSchemaKeywords(text: string): boolean {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return true; // parse failures surface as compile errors elsewhere
	}
	if (typeof parsed === 'boolean') return true; // `true`/`false` are intentional schemas
	let found = false;
	const visit = (v: unknown) => {
		if (found || !v || typeof v !== 'object') return;
		if (Array.isArray(v)) {
			for (const x of v) visit(x);
			return;
		}
		for (const [k, val] of Object.entries(v)) {
			if (SCHEMA_KEYWORDS.has(k)) {
				found = true;
				return;
			}
			visit(val);
		}
	};
	visit(parsed);
	return found;
}

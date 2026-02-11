import jmespath from 'jmespath';
import { jsonquery, parse } from '@jsonquerylang/jsonquery';
import _ from 'lodash';
import { formatError } from '../utils/error';

// Type Definitions

/**
 * Supported query engines
 */
export const QUERY_ENGINES = ['jsonquery', 'jmespath', 'lodash'] as const;
export type QueryEngine = (typeof QUERY_ENGINES)[number];

/**
 * JSON-compatible value types
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonArray = readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonArray | JsonObject;

/**
 * Successful query result
 */
interface QuerySuccess<T = unknown> {
	readonly success: true;
	readonly result: T;
	readonly executionTimeMs: number;
	readonly engine: QueryEngine;
	readonly query: string;
}

/**
 * Failed query result
 */
interface QueryFailure {
	readonly success: false;
	readonly error: QueryError;
	readonly executionTimeMs: number;
	readonly engine: QueryEngine;
	readonly query: string;
}

/**
 * Discriminated union for query results
 */
export type QueryResult<T = unknown> = QuerySuccess<T> | QueryFailure;

/**
 * Structured error information
 */
export interface QueryError {
	readonly message: string;
	readonly code: QueryErrorCode;
	readonly cause?: unknown;
}

/**
 * Error codes for categorizing query failures
 */
export const QUERY_ERROR_CODES = [
	'PARSE_ERROR',
	'EXECUTION_ERROR',
	'VALIDATION_ERROR',
	'UNSUPPORTED_ENGINE',
	'EMPTY_QUERY',
	'UNSAFE_OPERATION',
] as const;
export type QueryErrorCode = (typeof QUERY_ERROR_CODES)[number];

/**
 * Query validation result
 */
export interface ValidationResult {
	readonly isValid: boolean;
	readonly error?: string;
}

/**
 * Query example for documentation/help
 */
export interface QueryExample {
	readonly name: string;
	readonly description: string;
	readonly query: string;
	readonly sampleData: JsonValue;
	readonly expectedResult: JsonValue;
}

/**
 * Syntax help information
 */
export interface SyntaxHelp {
	readonly title: string;
	readonly examples: readonly string[];
}

// Error Handling

/**
 * Creates a structured query error
 */
function createQueryError(
	message: string,
	code: QueryErrorCode,
	cause?: unknown
): QueryError {
	return Object.freeze({ message, code, cause });
}

// Type Guards

/**
 * Type guard to check if a value is a valid query engine
 */
export function isQueryEngine(value: unknown): value is QueryEngine {
	return typeof value === 'string' && QUERY_ENGINES.includes(value as QueryEngine);
}

/**
 * Type guard to check if result is successful
 */
export function isQuerySuccess<T>(result: QueryResult<T>): result is QuerySuccess<T> {
	return result.success === true;
}

/**
 * Type guard to check if result is a failure
 */
export function isQueryFailure<T>(result: QueryResult<T>): result is QueryFailure {
	return result.success === false;
}

// Query Execution

/**
 * Measures execution time and wraps the result
 */
function measureExecution<T>(fn: () => T): { result: T; executionTimeMs: number } {
	const startTime = performance.now();
	const result = fn();
	const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;
	return { result, executionTimeMs };
}

/**
 * Execute a JSON Query Language query
 */
function executeJsonQuery(data: unknown, query: string): unknown {
	return jsonquery(data, query);
}

/**
 * Execute a JMESPath query
 */
function executeJmesPath(data: unknown, query: string): unknown {
	return jmespath.search(data, query);
}

/**
 * Dangerous patterns that are not allowed in Lodash queries
 */
const DANGEROUS_PATTERNS: readonly RegExp[] = [
	/\beval\b/,
	/\bFunction\b/,
	/\bimport\b/,
	/\brequire\b/,
	/\bprocess\b/,
	/\bglobal\b/,
	/\bwindow\b/,
	/\bdocument\b/,
	/\bfetch\b/,
	/\bXMLHttpRequest\b/,
	/__proto__/,
	/\bconstructor\s*\(/,
	/\bprototype\b/,
];

/**
 * Validates that a query doesn't contain dangerous patterns
 */
function validateQuerySafety(query: string): void {
	for (const pattern of DANGEROUS_PATTERNS) {
		if (pattern.test(query)) {
			throw new Error(`Query contains potentially unsafe pattern: ${pattern.source}`);
		}
	}
}

/**
 * Creates a controlled execution context for Lodash queries
 */
function createLodashContext(data: unknown): Record<string, unknown> {
	return {
		data,
		_,
		// Convenience shortcuts that operate on data
		get: (path: string, defaultValue?: unknown) => _.get(data, path, defaultValue),
		filter: (predicate: unknown) => _.filter(data as unknown[], predicate as never),
		map: (iteratee: unknown) => _.map(data as unknown[], iteratee as never),
		find: (predicate: unknown) => _.find(data as unknown[], predicate as never),
		groupBy: (iteratee: unknown) => _.groupBy(data as unknown[], iteratee as never),
		sortBy: (iteratees: unknown) => _.sortBy(data as unknown[], iteratees as never),
		orderBy: (iteratees: unknown, orders?: unknown) => 
			_.orderBy(data as unknown[], iteratees as never, orders as never),
		uniq: () => _.uniq(data as unknown[]),
		uniqBy: (iteratee: unknown) => _.uniqBy(data as unknown[], iteratee as never),
		pick: (paths: unknown) => _.pick(data as object, paths as never),
		omit: (paths: unknown) => _.omit(data as object, paths as never),
		keys: () => _.keys(data as object),
		values: () => _.values(data as object),
		size: () => _.size(data as object),
		isEmpty: () => _.isEmpty(data),
		flatten: () => _.flatten(data as unknown[]),
		flattenDeep: () => _.flattenDeep(data as unknown[]),
		compact: () => _.compact(data as unknown[]),
		sum: () => _.sum(data as number[]),
		sumBy: (iteratee: unknown) => _.sumBy(data as unknown[], iteratee as never),
		max: () => _.max(data as unknown[]),
		maxBy: (iteratee: unknown) => _.maxBy(data as unknown[], iteratee as never),
		min: () => _.min(data as unknown[]),
		minBy: (iteratee: unknown) => _.minBy(data as unknown[], iteratee as never),
		mean: () => _.mean(data as number[]),
		meanBy: (iteratee: unknown) => _.meanBy(data as unknown[], iteratee as never),
		first: () => _.first(data as unknown[]),
		last: () => _.last(data as unknown[]),
		head: () => _.head(data as unknown[]),
		tail: () => _.tail(data as unknown[]),
		take: (n?: number) => _.take(data as unknown[], n),
		drop: (n?: number) => _.drop(data as unknown[], n),
		reverse: () => _.reverse([...(data as unknown[])]),
		chunk: (size?: number) => _.chunk(data as unknown[], size),
		cloneDeep: () => _.cloneDeep(data),
	};
}

/**
 * Execute a Lodash-based query safely
 * Uses a controlled execution context instead of unsafe `with` statement
 */
function executeLodash(data: unknown, query: string): unknown {
	// Validate query safety first
	validateQuerySafety(query);

	// Create controlled context
	const context = createLodashContext(data);
	const contextKeys = Object.keys(context);
	const contextValues = Object.values(context);

	// Build and execute function with strict mode
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const executor = new Function(...contextKeys, `"use strict"; return (${query});`);
	return executor(...contextValues);
}

/**
 * Route query to appropriate engine
 */
function executeByEngine(data: unknown, query: string, engine: QueryEngine): unknown {
	switch (engine) {
		case 'jsonquery':
			return executeJsonQuery(data, query);
		case 'jmespath':
			return executeJmesPath(data, query);
		case 'lodash':
			return executeLodash(data, query);
	}
}

// Sample Data for Examples

const SAMPLE_DATA: JsonValue = Object.freeze({
	users: [
		{ name: 'John', age: 30, city: 'New York', active: true },
		{ name: 'Jane', age: 25, city: 'Los Angeles', active: false },
		{ name: 'Bob', age: 35, city: 'Chicago', active: true },
	],
	products: [
		{ name: 'Laptop', price: 999, category: 'Electronics' },
		{ name: 'Book', price: 19.99, category: 'Books' },
		{ name: 'Phone', price: 599, category: 'Electronics' },
	],
	meta: {
		total: 6,
		timestamp: '2024-01-01T12:00:00Z',
	},
});

type UserData = { name: string; age: number; city: string; active: boolean };

function getSampleUsers(): readonly UserData[] {
	return (SAMPLE_DATA as { users: UserData[] }).users;
}

// Public API

/**
 * JSON Query Processor
 * 
 * Provides a unified interface for querying JSON data using multiple engines.
 * 
 * @example
 * ```typescript
 * const result = await JSONQueryProcessor.execute(
 *   { users: [{ name: 'John', age: 30 }] },
 *   '.users | filter(.age > 25)',
 *   'jsonquery'
 * );
 * 
 * if (result.success) {
 *   console.log(result.result);
 * } else {
 *   console.error(result.error.message);
 * }
 * ```
 */
export const JSONQueryProcessor = {
	/**
	 * Execute a query against JSON data
	 * 
	 * @param data - The JSON data to query
	 * @param query - The query string
	 * @param engine - The query engine to use
	 * @returns A QueryResult containing either the result or an error
	 */
	execute<T = unknown>(data: unknown, query: string, engine: QueryEngine): QueryResult<T> {
		const trimmedQuery = query.trim();

		// Validate inputs
		if (!trimmedQuery) {
			return {
				success: false,
				error: createQueryError('Query cannot be empty', 'EMPTY_QUERY'),
				executionTimeMs: 0,
				engine,
				query,
			};
		}

		if (!isQueryEngine(engine)) {
			return {
				success: false,
				error: createQueryError(`Unsupported engine: ${String(engine)}`, 'UNSUPPORTED_ENGINE'),
				executionTimeMs: 0,
				engine,
				query,
			};
		}

		try {
			const { result, executionTimeMs } = measureExecution(() =>
				executeByEngine(data, trimmedQuery, engine)
			);

			return {
				success: true,
				result: result as T,
				executionTimeMs,
				engine,
				query: trimmedQuery,
			};
		} catch (error) {
			return {
				success: false,
				error: createQueryError(formatError(error), 'EXECUTION_ERROR', error),
				executionTimeMs: 0,
				engine,
				query: trimmedQuery,
			};
		}
	},

	/**
	 * Execute a query asynchronously (for compatibility with async workflows)
	 */
	async executeAsync<T = unknown>(
		data: unknown,
		query: string,
		engine: QueryEngine
	): Promise<QueryResult<T>> {
		return this.execute<T>(data, query, engine);
	},

	/**
	 * Validate a query without executing it
	 * 
	 * @param query - The query string to validate
	 * @param engine - The query engine
	 * @returns Validation result
	 */
	validate(query: string, engine: QueryEngine): ValidationResult {
		const trimmedQuery = query.trim();

		if (!trimmedQuery) {
			return { isValid: false, error: 'Query cannot be empty' };
		}

		try {
			switch (engine) {
				case 'jsonquery':
					parse(trimmedQuery);
					break;

				case 'jmespath':
					jmespath.compile(trimmedQuery);
					break;

				case 'lodash':
					// Validate safety patterns
					validateQuerySafety(trimmedQuery);
					// Basic syntax check
					// eslint-disable-next-line @typescript-eslint/no-implied-eval
					new Function(`"use strict"; return (${trimmedQuery});`);
					break;
			}

			return { isValid: true };
		} catch (error) {
			return { isValid: false, error: formatError(error) };
		}
	},

	/**
	 * Get example queries for a specific engine
	 * 
	 * @param engine - The query engine
	 * @returns Array of query examples
	 */
	getExamples(engine: QueryEngine): readonly QueryExample[] {
		const users = getSampleUsers();
		const usersAsJson = users as unknown as JsonValue;
		
		switch (engine) {
			case 'jsonquery':
				return Object.freeze([
					{
						name: 'Get all users',
						description: 'Retrieve the users array from the object',
						query: '.users',
						sampleData: SAMPLE_DATA,
						expectedResult: usersAsJson,
					},
					{
						name: 'Filter active users',
						description: 'Get users where active is true',
						query: '.users | filter(.active == true)',
						sampleData: SAMPLE_DATA,
						expectedResult: users.filter((u) => u.active) as unknown as JsonValue,
					},
					{
						name: 'Pick user names',
						description: 'Return only the name property for all users',
						query: '.users | pick(.name)',
						sampleData: SAMPLE_DATA,
						expectedResult: users.map((u) => ({ name: u.name })) as unknown as JsonValue,
					},
					{
						name: 'Sort by age',
						description: 'Sort users by age in ascending order',
						query: '.users | sort(.age)',
						sampleData: SAMPLE_DATA,
						expectedResult: [...users].sort((a, b) => a.age - b.age) as unknown as JsonValue,
					},
				]);

			case 'jmespath':
				return Object.freeze([
					{
						name: 'Get all users',
						description: 'Retrieve the users array',
						query: 'users',
						sampleData: SAMPLE_DATA,
						expectedResult: usersAsJson,
					},
					{
						name: 'Filter active users',
						description: 'Get users where active is true',
						query: 'users[?active == `true`]',
						sampleData: SAMPLE_DATA,
						expectedResult: users.filter((u) => u.active) as unknown as JsonValue,
					},
					{
						name: 'Get user names',
						description: 'Extract just the names of all users',
						query: 'users[*].name',
						sampleData: SAMPLE_DATA,
						expectedResult: users.map((u) => u.name) as unknown as JsonValue,
					},
					{
						name: 'Sort by age',
						description: 'Sort users by age in ascending order',
						query: 'users | sort_by(@, &age)',
						sampleData: SAMPLE_DATA,
						expectedResult: [...users].sort((a, b) => a.age - b.age) as unknown as JsonValue,
					},
				]);

			case 'lodash':
				return Object.freeze([
					{
						name: 'Get all users',
						description: 'Retrieve all users using Lodash get',
						query: "get('users')",
						sampleData: SAMPLE_DATA,
						expectedResult: usersAsJson,
					},
					{
						name: 'Filter active users',
						description: 'Filter users where active is true',
						query: '_.filter(data.users, { active: true })',
						sampleData: SAMPLE_DATA,
						expectedResult: users.filter((u) => u.active) as unknown as JsonValue,
					},
					{
						name: 'Get user names',
						description: 'Map to get just the names',
						query: "_.map(data.users, 'name')",
						sampleData: SAMPLE_DATA,
						expectedResult: users.map((u) => u.name) as unknown as JsonValue,
					},
					{
						name: 'Sort by age',
						description: 'Sort users by age using Lodash',
						query: "_.sortBy(data.users, 'age')",
						sampleData: SAMPLE_DATA,
						expectedResult: [...users].sort((a, b) => a.age - b.age) as unknown as JsonValue,
					},
					{
						name: 'Group by city',
						description: 'Group users by their city',
						query: "_.groupBy(data.users, 'city')",
						sampleData: SAMPLE_DATA,
						expectedResult: _.groupBy(users, 'city') as unknown as JsonValue,
					},
				]);

			default: {
				// Exhaustive check - TypeScript will error if a case is missing
				const _exhaustive: never = engine;
				return _exhaustive;
			}
		}
	},

	/**
	 * Get syntax help for a specific engine
	 * 
	 * @param engine - The query engine
	 * @returns Syntax help information
	 */
	getSyntaxHelp(engine: QueryEngine): SyntaxHelp {
		switch (engine) {
			case 'jsonquery':
				return Object.freeze({
					title: 'JSON Query Language Syntax',
					examples: Object.freeze([
						'.users - Get users property',
						'.users[0] - Get first user',
						'.users | filter(.age > 25) - Filter by condition',
						'.users | sort(.age) - Sort by property',
						'.users | pick(.name, .age) - Select specific fields',
						'.users | filter(.active) | sort(.name) - Chain operations',
					]),
				});

			case 'jmespath':
				return Object.freeze({
					title: 'JMESPath Syntax',
					examples: Object.freeze([
						'users - Get users array',
						'users[0] - Get first user',
						'users[?name == `John`] - Filter by condition',
						'users[*].name - Project all names',
						'users | sort_by(@, &age) - Sort by age',
						'length(users) - Get array length',
					]),
				});

			case 'lodash':
				return Object.freeze({
					title: 'Lodash (JavaScript) Syntax',
					examples: Object.freeze([
						'data.users - Access data directly',
						"get('users[0].name') - Safe property access",
						'_.filter(data.users, {active: true}) - Filter objects',
						"_.map(data.users, 'name') - Extract properties",
						"_.sortBy(data.users, 'age') - Sort by property",
						"_.groupBy(data.users, 'city') - Group by property",
					]),
				});

			default: {
				const _exhaustive: never = engine;
				return _exhaustive;
			}
		}
	},

	/**
	 * Get all supported query engines
	 */
	getEngines(): readonly QueryEngine[] {
		return QUERY_ENGINES;
	},
} as const;

// Re-export for convenience
export { JSONQueryProcessor as default };

export interface Snippet {
	id: string;
	name: string;
	description: string;
	content: string;
	category: string;
	tags: string[];
	createdAt: string;
	updatedAt: string;
}

export const SNIPPET_CATEGORIES = [
	'all',
	'api',
	'database',
	'config',
	'schema',
	'template',
	'example',
	'testing'
] as const;

export type SnippetCategory = typeof SNIPPET_CATEGORIES[number];

const STORAGE_KEY = 'pandia-snippets';

const BUILT_IN_SNIPPETS: Snippet[] = [
	{
		id: 'user-profile',
		name: 'User Profile',
		description: 'Basic user profile structure',
		content: JSON.stringify({
			id: 12345,
			name: "John Doe",
			email: "john@example.com",
			profile: {
				avatar: "https://example.com/avatar.jpg",
				bio: "Software developer",
				location: "New York, NY"
			},
			preferences: {
				theme: "dark",
				notifications: true,
				language: "en"
			},
			createdAt: "2024-01-01T00:00:00Z",
			updatedAt: "2024-01-01T00:00:00Z"
		}, null, 2),
		category: 'template',
		tags: ['user', 'profile', 'template'],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	},
	{
		id: 'api-response',
		name: 'API Response',
		description: 'Standard API response structure',
		content: JSON.stringify({
			success: true,
			message: "Operation completed successfully",
			data: {
				id: 1,
				name: "Sample Data"
			},
			meta: {
				timestamp: "2024-01-01T00:00:00Z",
				version: "1.0.0",
				requestId: "req_123456"
			},
			errors: []
		}, null, 2),
		category: 'api',
		tags: ['api', 'response', 'http'],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	},
	{
		id: 'config-app',
		name: 'App Configuration',
		description: 'Application configuration template',
		content: JSON.stringify({
			app: {
				name: "MyApp",
				version: "1.0.0",
				environment: "development"
			},
			server: {
				host: "localhost",
				port: 3000,
				ssl: false
			},
			database: {
				type: "postgresql",
				host: "localhost",
				port: 5432,
				name: "myapp_db",
				ssl: false
			},
			redis: {
				host: "localhost",
				port: 6379,
				db: 0
			},
			logging: {
				level: "info",
				format: "json",
				file: "/var/log/app.log"
			}
		}, null, 2),
		category: 'config',
		tags: ['config', 'app', 'server'],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	},
	{
		id: 'json-schema',
		name: 'JSON Schema',
		description: 'Basic JSON schema structure',
		content: JSON.stringify({
			$schema: "http://json-schema.org/draft-07/schema#",
			title: "Example Schema",
			type: "object",
			required: ["name", "email"],
			properties: {
				name: {
					type: "string",
					minLength: 1,
					description: "User's full name"
				},
				email: {
					type: "string",
					format: "email",
					description: "User's email address"
				},
				age: {
					type: "integer",
					minimum: 0,
					maximum: 150,
					description: "User's age"
				},
				preferences: {
					type: "object",
					properties: {
						theme: {
							type: "string",
							enum: ["light", "dark"]
						},
						notifications: {
							type: "boolean",
							default: true
						}
					}
				}
			}
		}, null, 2),
		category: 'schema',
		tags: ['schema', 'validation', 'json-schema'],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	},
	{
		id: 'test-data',
		name: 'Test Data Set',
		description: 'Sample test data for development',
		content: JSON.stringify({
			users: [
				{ id: 1, name: "Alice Johnson", role: "admin", active: true },
				{ id: 2, name: "Bob Smith", role: "user", active: true },
				{ id: 3, name: "Carol Williams", role: "user", active: false }
			],
			products: [
				{ id: 1, name: "Laptop", price: 999.99, category: "electronics" },
				{ id: 2, name: "Book", price: 19.99, category: "books" },
				{ id: 3, name: "Coffee Mug", price: 12.99, category: "home" }
			],
			orders: [
				{
					id: 1001,
					userId: 1,
					items: [
						{ productId: 1, quantity: 1, price: 999.99 }
					],
					total: 999.99,
					status: "completed",
					createdAt: "2024-01-01T10:00:00Z"
				}
			]
		}, null, 2),
		category: 'testing',
		tags: ['test', 'data', 'mock'],
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString()
	}
];

class SnippetService {
	private snippets: Snippet[] = [];
	private initialized = false;

	/**
	 * Initialize the service and load snippets from storage
	 */
	init(): Snippet[] {
		if (this.initialized) {
			return this.snippets;
		}

		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			try {
				const userSnippets = JSON.parse(saved);
				this.snippets = [...BUILT_IN_SNIPPETS, ...userSnippets];
			} catch {
				this.snippets = [...BUILT_IN_SNIPPETS];
			}
		} else {
			this.snippets = [...BUILT_IN_SNIPPETS];
		}

		this.initialized = true;
		return this.snippets;
	}

	/**
	 * Get all snippets
	 */
	getAll(): Snippet[] {
		if (!this.initialized) {
			this.init();
		}
		return [...this.snippets];
	}

	/**
	 * Filter snippets by search query and category
	 */
	filter(query: string, category: SnippetCategory): Snippet[] {
		return this.snippets.filter(snippet => {
			const matchesSearch = !query ||
				snippet.name.toLowerCase().includes(query.toLowerCase()) ||
				snippet.description.toLowerCase().includes(query.toLowerCase()) ||
				snippet.tags.some(tag => tag.toLowerCase().includes(query.toLowerCase()));

			const matchesCategory = category === 'all' || snippet.category === category;

			return matchesSearch && matchesCategory;
		});
	}

	/**
	 * Create a new snippet
	 */
	create(data: Omit<Snippet, 'id' | 'createdAt' | 'updatedAt'>): Snippet {
		const now = new Date().toISOString();
		const snippet: Snippet = {
			...data,
			id: this.generateId(),
			createdAt: now,
			updatedAt: now
		};

		this.snippets = [snippet, ...this.snippets];
		this.persist();
		return snippet;
	}

	/**
	 * Update an existing snippet
	 */
	update(id: string, data: Partial<Omit<Snippet, 'id' | 'createdAt'>>): Snippet | null {
		const index = this.snippets.findIndex(s => s.id === id);
		if (index === -1) return null;

		const updated: Snippet = {
			...this.snippets[index],
			...data,
			updatedAt: new Date().toISOString()
		};

		this.snippets[index] = updated;
		this.persist();
		return updated;
	}

	/**
	 * Delete a snippet (only user snippets can be deleted)
	 */
	delete(id: string): boolean {
		if (this.isBuiltIn(id)) {
			return false;
		}

		const index = this.snippets.findIndex(s => s.id === id);
		if (index === -1) return false;

		this.snippets = this.snippets.filter(s => s.id !== id);
		this.persist();
		return true;
	}

	/**
	 * Duplicate a snippet
	 */
	duplicate(snippet: Snippet): Snippet {
		const now = new Date().toISOString();
		const duplicate: Snippet = {
			...snippet,
			id: this.generateId(),
			name: `${snippet.name} (Copy)`,
			createdAt: now,
			updatedAt: now
		};

		this.snippets = [duplicate, ...this.snippets];
		this.persist();
		return duplicate;
	}

	/**
	 * Check if a snippet is built-in
	 */
	isBuiltIn(id: string): boolean {
		return BUILT_IN_SNIPPETS.some(s => s.id === id);
	}

	/**
	 * Export user snippets as JSON string
	 */
	export(): string {
		const userSnippets = this.snippets.filter(s => !this.isBuiltIn(s.id));
		return JSON.stringify(userSnippets, null, 2);
	}

	/**
	 * Export snippets as downloadable file
	 */
	exportAsFile(): void {
		const dataStr = this.export();
		const dataBlob = new Blob([dataStr], { type: 'application/json' });
		const url = URL.createObjectURL(dataBlob);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'pandia-snippets.json';
		link.click();
		URL.revokeObjectURL(url);
	}

	/**
	 * Import snippets from JSON string
	 */
	import(jsonString: string): { imported: number; errors: string[] } {
		const errors: string[] = [];
		let imported = 0;

		try {
			const data = JSON.parse(jsonString);
			const snippetsArray = Array.isArray(data) ? data : [data];

			const validSnippets = snippetsArray.filter((s: unknown): s is Snippet => {
				if (typeof s !== 'object' || s === null) {
					errors.push('Invalid snippet format');
					return false;
				}
				const obj = s as Record<string, unknown>;
				if (!obj.id || !obj.name || !obj.content || !obj.category) {
					errors.push(`Missing required fields in snippet: ${obj.name || 'unknown'}`);
					return false;
				}
				return true;
			}).map(s => ({
				...s,
				id: `${s.id}_imported_${Date.now()}`
			}));

			this.snippets = [...this.snippets, ...validSnippets];
			this.persist();
			imported = validSnippets.length;
		} catch (e) {
			errors.push('Failed to parse JSON');
		}

		return { imported, errors };
	}

	/**
	 * Import snippets from file
	 */
	async importFromFile(file: File): Promise<{ imported: number; errors: string[] }> {
		return new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				const result = this.import(e.target?.result as string);
				resolve(result);
			};
			reader.onerror = () => {
				resolve({ imported: 0, errors: ['Failed to read file'] });
			};
			reader.readAsText(file);
		});
	}

	private generateId(): string {
		return `snippet_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
	}

	private persist(): void {
		const userSnippets = this.snippets.filter(s => !this.isBuiltIn(s.id));
		localStorage.setItem(STORAGE_KEY, JSON.stringify(userSnippets));
	}
}

export const snippetService = new SnippetService();

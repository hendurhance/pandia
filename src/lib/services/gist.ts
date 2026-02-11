import { formatError } from '../utils/error';
import { http, fetchText } from '../utils/http';

const GITHUB_API_BASE = 'https://api.github.com';
export interface GistFile {
	filename: string;
	content: string;
	language?: string;
	type?: string;
	size?: number;
	raw_url?: string;
}

/**
 * Gist metadata
 */
export interface GistInfo {
	id: string;
	url: string;
	html_url: string;
	description: string;
	public: boolean;
	created_at: string;
	updated_at: string;
	files: Record<string, GistFile>;
	owner?: {
		login: string;
		avatar_url: string;
	};
}

/**
 * Create gist request
 */
export interface CreateGistRequest {
	description?: string;
	public?: boolean;
	files: Record<string, { content: string }>;
}

/**
 * Result types
 */
export type GistResult<T> =
	| { success: true; data: T }
	| { success: false; error: string };

/**
 * Parse a Gist URL to extract the gist ID
 * Supports formats:
 * - https://gist.github.com/username/gist_id
 * - https://gist.github.com/gist_id
 * - https://api.github.com/gists/gist_id
 * - gist_id (raw ID)
 */
export function parseGistUrl(input: string): string | null {
	const trimmed = input.trim();

	// Direct gist ID (alphanumeric, typically 32 chars)
	if (/^[a-f0-9]+$/i.test(trimmed)) {
		return trimmed;
	}

	// URL patterns
	const patterns = [
		/gist\.github\.com\/[^/]+\/([a-f0-9]+)/i,
		/gist\.github\.com\/([a-f0-9]+)/i,
		/api\.github\.com\/gists\/([a-f0-9]+)/i,
	];

	for (const pattern of patterns) {
		const match = trimmed.match(pattern);
		if (match) {
			return match[1];
		}
	}

	return null;
}

/**
 * Fetch a gist by ID or URL
 */
export async function fetchGist(idOrUrl: string): Promise<GistResult<GistInfo>> {
	const gistId = parseGistUrl(idOrUrl);

	if (!gistId) {
		return { success: false, error: 'Invalid Gist URL or ID' };
	}

	try {
		const response = await http<GistInfo>(`${GITHUB_API_BASE}/gists/${gistId}`, {
			method: 'GET',
			headers: {
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
			},
		});

		if (!response.ok) {
			if (response.status === 404) {
				return { success: false, error: 'Gist not found. It may be private or deleted.' };
			}
			if (response.status === 403) {
				return { success: false, error: 'Rate limit exceeded. Please try again later.' };
			}
			return { success: false, error: `GitHub API error: ${response.status}` };
		}

		return { success: true, data: response.data };
	} catch (error) {
		return { success: false, error: formatError(error, 'Failed to fetch gist') };
	}
}

/**
 * Get the content of a specific file from a gist
 */
export async function fetchGistFile(
	idOrUrl: string,
	filename?: string
): Promise<GistResult<{ content: string; filename: string; gist: GistInfo }>> {
	const gistResult = await fetchGist(idOrUrl);

	if (!gistResult.success) {
		return gistResult;
	}

	const gist = gistResult.data;
	const files = Object.values(gist.files);

	if (files.length === 0) {
		return { success: false, error: 'Gist has no files' };
	}

	// Find the target file
	let targetFile: GistFile;

	if (filename) {
		const found = gist.files[filename];
		if (!found) {
			return { success: false, error: `File "${filename}" not found in gist` };
		}
		targetFile = found;
	} else {
		// Get the first JSON file, or fall back to first file
		const jsonFile = files.find(
			(f) => f.filename.endsWith('.json') || f.type?.includes('json')
		);
		targetFile = jsonFile || files[0];
	}

	// Fetch raw content if not included
	if (!targetFile.content && targetFile.raw_url) {
		try {
			targetFile.content = await fetchText(targetFile.raw_url);
		} catch {
			return { success: false, error: 'Failed to fetch file content' };
		}
	}

	return {
		success: true,
		data: {
			content: targetFile.content,
			filename: targetFile.filename,
			gist,
		},
	};
}

/**
 * Create an anonymous gist (no authentication required)
 * Note: Anonymous gists cannot be edited or deleted
 */
export async function createAnonymousGist(
	content: string,
	filename: string = 'data.json',
	description: string = '',
	isPublic: boolean = true
): Promise<GistResult<GistInfo>> {
	try {
		const request: CreateGistRequest = {
			description: description || `Created with Pandia on ${new Date().toISOString()}`,
			public: isPublic,
			files: {
				[filename]: { content },
			},
		};

		const response = await http<GistInfo>(`${GITHUB_API_BASE}/gists`, {
			method: 'POST',
			headers: {
				Accept: 'application/vnd.github+json',
				'Content-Type': 'application/json',
				'X-GitHub-Api-Version': '2022-11-28',
			},
			body: JSON.stringify(request),
		});

		if (!response.ok) {
			if (response.status === 422) {
				return { success: false, error: 'Invalid gist content or filename' };
			}
			if (response.status === 403) {
				return { success: false, error: 'Rate limit exceeded. Please try again later.' };
			}
			return { success: false, error: `GitHub API error: ${response.status}` };
		}

		return { success: true, data: response.data };
	} catch (error) {
		return { success: false, error: formatError(error, 'Failed to create gist') };
	}
}

/**
 * List files in a gist
 */
export function listGistFiles(gist: GistInfo): GistFile[] {
	return Object.values(gist.files);
}

/**
 * Get a user-friendly display name for a gist
 */
export function getGistDisplayName(gist: GistInfo): string {
	const files = Object.keys(gist.files);
	if (gist.description) {
		return gist.description;
	}
	if (files.length === 1) {
		return files[0];
	}
	return `${files[0]} (+${files.length - 1} more)`;
}

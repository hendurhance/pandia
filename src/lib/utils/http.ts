/**
 * HTTP Client Utility
 *
 * Wraps @tauri-apps/plugin-http to provide CORS-free HTTP requests
 * for the Tauri desktop application.
 *
 * @module utils/http
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export interface HttpRequestOptions {
	method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
	headers?: Record<string, string>;
	body?: string | FormData | Blob | ArrayBuffer;
	timeout?: number;
}

export interface HttpResponse<T = unknown> {
	ok: boolean;
	status: number;
	statusText: string;
	headers: Headers;
	data: T;
}

/**
 * Make an HTTP request using Tauri's HTTP plugin (bypasses CORS)
 */
export async function http<T = unknown>(
	url: string,
	options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
	const { method = 'GET', headers = {}, body, timeout } = options;

	const response = await tauriFetch(url, {
		method,
		headers,
		body,
		signal: timeout ? AbortSignal.timeout(timeout) : undefined,
	});

	const contentType = response.headers.get('content-type') || '';
	let data: T;

	if (contentType.includes('application/json')) {
		data = (await response.json()) as T;
	} else {
		data = (await response.text()) as T;
	}

	return {
		ok: response.ok,
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
		data,
	};
}

/**
 * GET request helper
 */
export async function get<T = unknown>(
	url: string,
	headers?: Record<string, string>
): Promise<HttpResponse<T>> {
	return http<T>(url, { method: 'GET', headers });
}

/**
 * POST request helper
 */
export async function post<T = unknown>(
	url: string,
	body?: string | object,
	headers?: Record<string, string>
): Promise<HttpResponse<T>> {
	const finalHeaders = { ...headers };
	let finalBody: string | undefined;

	if (body && typeof body === 'object') {
		finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json';
		finalBody = JSON.stringify(body);
	} else {
		finalBody = body as string;
	}

	return http<T>(url, { method: 'POST', headers: finalHeaders, body: finalBody });
}

/**
 * Fetch raw text content from a URL
 */
export async function fetchText(url: string, headers?: Record<string, string>): Promise<string> {
	const response = await tauriFetch(url, {
		method: 'GET',
		headers,
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	return response.text();
}

/**
 * Fetch JSON content from a URL
 */
export async function fetchJson<T = unknown>(
	url: string,
	headers?: Record<string, string>
): Promise<T> {
	const response = await tauriFetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
			...headers,
		},
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	return response.json() as Promise<T>;
}

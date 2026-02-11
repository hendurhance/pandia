import { formatError } from '../utils/error';
import { http } from '../utils/http';

export interface WebhookConfig {
	url: string;
	method?: 'POST' | 'PUT' | 'PATCH';
	headers?: Record<string, string>;
	wrapInPayload?: boolean;
	payloadKey?: string;
}

/**
 * Common webhook presets
 */
export interface WebhookPreset {
	id: string;
	name: string;
	icon: string;
	description: string;
	urlPattern: RegExp;
	defaultConfig: Partial<WebhookConfig>;
	formatPayload?: (content: string, filename?: string) => unknown;
}

/**
 * Webhook send result
 */
export type WebhookResult =
	| { success: true; status: number; response?: string }
	| { success: false; error: string; status?: number };

/**
 * Common webhook presets for popular services
 */
export const WEBHOOK_PRESETS: WebhookPreset[] = [
	{
		id: 'slack',
		name: 'Slack',
		icon: 'message-square',
		description: 'Slack Incoming Webhook',
		urlPattern: /hooks\.slack\.com/i,
		defaultConfig: {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		},
		formatPayload: (content, filename) => {
			// Slack expects { text: string } format for simple messages
			// For JSON, we'll format it as a code block
			const truncated = content.length > 3000 ? content.slice(0, 3000) + '...' : content;
			return {
				text: filename ? `*${filename}*` : 'JSON Data',
				blocks: [
					{
						type: 'section',
						text: {
							type: 'mrkdwn',
							text: '```' + truncated + '```',
						},
					},
				],
			};
		},
	},
	{
		id: 'discord',
		name: 'Discord',
		icon: 'message-circle',
		description: 'Discord Webhook',
		urlPattern: /discord\.com\/api\/webhooks/i,
		defaultConfig: {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		},
		formatPayload: (content, filename) => {
			// Discord expects { content: string } format
			const truncated = content.length > 1900 ? content.slice(0, 1900) + '...' : content;
			return {
				content: filename ? `**${filename}**\n\`\`\`json\n${truncated}\n\`\`\`` : `\`\`\`json\n${truncated}\n\`\`\``,
			};
		},
	},
	{
		id: 'generic',
		name: 'Generic',
		icon: 'link',
		description: 'Custom webhook endpoint',
		urlPattern: /.*/,
		defaultConfig: {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
		},
	},
];

/**
 * Detect webhook type from URL
 */
export function detectWebhookType(url: string): WebhookPreset {
	for (const preset of WEBHOOK_PRESETS) {
		if (preset.id !== 'generic' && preset.urlPattern.test(url)) {
			return preset;
		}
	}
	return WEBHOOK_PRESETS.find((p) => p.id === 'generic')!;
}

/**
 * Validate webhook URL
 */
export function validateWebhookUrl(url: string): { valid: boolean; error?: string } {
	if (!url.trim()) {
		return { valid: false, error: 'URL is required' };
	}

	try {
		const parsed = new URL(url);
		if (!['http:', 'https:'].includes(parsed.protocol)) {
			return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
		}
		return { valid: true };
	} catch {
		return { valid: false, error: 'Invalid URL format' };
	}
}

/**
 * Send JSON to a webhook endpoint
 */
export async function sendToWebhook(
	content: string,
	config: WebhookConfig,
	filename?: string
): Promise<WebhookResult> {
	const validation = validateWebhookUrl(config.url);
	if (!validation.valid) {
		return { success: false, error: validation.error! };
	}

	const preset = detectWebhookType(config.url);

	try {
		// Prepare payload
		let payload: unknown;

		if (preset.formatPayload) {
			// Use preset's payload formatter
			payload = preset.formatPayload(content, filename);
		} else if (config.wrapInPayload && config.payloadKey) {
			// Wrap content in a custom key
			try {
				payload = { [config.payloadKey]: JSON.parse(content) };
			} catch {
				payload = { [config.payloadKey]: content };
			}
		} else {
			// Send raw JSON
			try {
				payload = JSON.parse(content);
			} catch {
				// If not valid JSON, wrap it
				payload = { data: content };
			}
		}

		const headers: Record<string, string> = {
			...preset.defaultConfig.headers,
			...config.headers,
		};

		const response = await http<string>(config.url, {
			method: config.method || preset.defaultConfig.method || 'POST',
			headers,
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorBody = typeof response.data === 'string' ? response.data : '';
			let errorMessage = `HTTP ${response.status}`;
			if (errorBody) {
				errorMessage += `: ${errorBody.slice(0, 200)}`;
			}
			return { success: false, error: errorMessage, status: response.status };
		}

		const responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

		return { success: true, status: response.status, response: responseText };
	} catch (error) {
		return { success: false, error: formatError(error, 'Failed to send webhook') };
	}
}

/**
 * Test a webhook URL with a simple ping
 */
export async function testWebhook(url: string): Promise<WebhookResult> {
	const testPayload = {
		test: true,
		message: 'Test from Pandia',
		timestamp: new Date().toISOString(),
	};

	return sendToWebhook(JSON.stringify(testPayload, null, 2), { url });
}

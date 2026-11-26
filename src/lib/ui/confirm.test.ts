import { describe, expect, it } from 'vitest';
import { ConfirmController } from './confirm.svelte';

const question = (title: string) => ({ title, message: title, primaryLabel: 'ok' });

describe('ConfirmController', () => {
	it('shows a second question only after the first is answered, and answers each its own', async () => {
		const confirm = new ConfirmController();
		const first = confirm.ask(question('large file'));
		const second = confirm.ask(question('load schema'));
		expect(confirm.state?.title).toBe('large file');

		confirm.pick('primary');
		expect(await first).toBe('primary');
		expect(confirm.state?.title).toBe('load schema');

		confirm.pick('secondary');
		expect(await second).toBe('secondary');
		expect(confirm.state).toBeNull();
	});
});

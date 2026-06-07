interface PromptState {
	message: string;
	defaultValue: string;
	resolve: (v: string | null) => void;
}

export class PromptController {
	state: PromptState | null = $state(null);

	show = (message: string, defaultValue = ''): Promise<string | null> =>
		new Promise((resolve) => {
			this.state = { message, defaultValue, resolve };
		});

	commit = (value: string) => {
		const r = this.state?.resolve;
		this.state = null;
		r?.(value);
	};

	cancel = () => {
		const r = this.state?.resolve;
		this.state = null;
		r?.(null);
	};
}

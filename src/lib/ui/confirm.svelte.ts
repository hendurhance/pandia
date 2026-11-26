export type ConfirmChoice = 'primary' | 'secondary' | 'cancel';

export interface ConfirmRequest {
	title: string;
	message: string;
	primaryLabel: string;
	secondaryLabel?: string;
	cancelLabel?: string;

	dangerPrimary?: boolean;
}

interface ActiveRequest extends ConfirmRequest {
	resolve: (choice: ConfirmChoice) => void;
}

export class ConfirmController {
	state: ActiveRequest | null = $state(null);
	private waiting: ActiveRequest[] = [];

	ask = (req: ConfirmRequest): Promise<ConfirmChoice> =>
		new Promise((resolve) => {
			const request = { ...req, resolve };
			if (this.state) this.waiting.push(request);
			else this.state = request;
		});

	pick = (choice: ConfirmChoice) => {
		const s = this.state;
		if (!s) return;
		this.state = this.waiting.shift() ?? null;
		s.resolve(choice);
	};
}

export type ConfirmChoice = 'primary' | 'secondary' | 'cancel';

export interface ConfirmRequest {
	title: string;
	message: string;
	primaryLabel: string;
	secondaryLabel: string;
	cancelLabel?: string;

	dangerPrimary?: boolean;
}

interface ActiveRequest extends ConfirmRequest {
	resolve: (choice: ConfirmChoice) => void;
}

export class ConfirmController {
	state: ActiveRequest | null = $state(null);

	ask = (req: ConfirmRequest): Promise<ConfirmChoice> => {
		if (this.state) this.state.resolve('cancel');
		return new Promise((resolve) => {
			this.state = { ...req, resolve };
		});
	};

	pick = (choice: ConfirmChoice) => {
		const s = this.state;
		if (!s) return;
		this.state = null;
		s.resolve(choice);
	};
}

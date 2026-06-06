export interface NonceRequest<T = unknown> {
	nonce: number;

	tabId: string;

	[key: string]: T | number | string;
}

export function makeNonceGate(): (
	req: { nonce: number; tabId: string } | null,
	myTabId: string,
	isActive: boolean,
) => boolean {
	let last = -1;
	return (req, myTabId, isActive) => {
		if (!req || req.tabId !== myTabId || !isActive) return false;
		if (req.nonce === last) return false;
		last = req.nonce;
		return true;
	};
}

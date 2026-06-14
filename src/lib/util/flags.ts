function flag(value: string | undefined, defaultOn: boolean): boolean {
	if (value === 'true') return true;
	if (value === 'false') return false;
	return defaultOn;
}

const isDev = import.meta.env.DEV;

export const BLOCK_CONTEXT_MENU = flag(import.meta.env.VITE_BLOCK_CONTEXT_MENU, !isDev);

export const SANDBOX_ENABLED = flag(import.meta.env.VITE_ENABLE_SANDBOX, isDev);

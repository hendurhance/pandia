const isDev = import.meta.env.DEV;

export const BLOCK_CONTEXT_MENU = !isDev;

export const SANDBOX_ENABLED = isDev;

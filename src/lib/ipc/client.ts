import { commands } from './bindings';
import { toIpcError } from './error';

type Commands = typeof commands;

function withIpcErrors(cmds: Commands): Commands {
	const wrapped: Record<string, unknown> = {};
	for (const [name, fn] of Object.entries(cmds)) {
		wrapped[name] = (...args: unknown[]) =>
			(fn as (...fnArgs: unknown[]) => Promise<unknown>)(...args).catch((e: unknown) => {
				throw toIpcError(e);
			});
	}
	return wrapped as Commands;
}

export const ipc = withIpcErrors(commands);

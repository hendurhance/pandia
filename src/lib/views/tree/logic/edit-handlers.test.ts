import { describe, expect, it, vi } from 'vitest';
import {
	createEditHandlers,
	editSize,
	nextNumberValue,
	valueTypeLabel,
} from './edit-handlers';

describe('editSize', () => {
	it('returns at least 4 for tiny buffers', () => {
		expect(editSize('')).toBe(4);
		expect(editSize('a')).toBe(4); // 1+1 = 2 → clamp up to 4
		expect(editSize('ab')).toBe(4); // 2+1 = 3 → clamp up to 4
		expect(editSize('abc')).toBe(4); // 3+1 = 4
	});

	it('grows with content length up to 60', () => {
		expect(editSize('abcd')).toBe(5);
		expect(editSize('a'.repeat(50))).toBe(51);
	});

	it('caps at 60 chars', () => {
		expect(editSize('a'.repeat(100))).toBe(60);
		expect(editSize('a'.repeat(1000))).toBe(60);
	});
});

describe('valueTypeLabel', () => {
	it('maps each kind to a 3-4 char label', () => {
		expect(valueTypeLabel('string')).toBe('Str');
		expect(valueTypeLabel('number')).toBe('Num');
		expect(valueTypeLabel('bool')).toBe('Bool');
		expect(valueTypeLabel('null')).toBe('Null');
		expect(valueTypeLabel('object')).toBe('Val');
		expect(valueTypeLabel('array')).toBe('Val');
	});
});

describe('nextNumberValue', () => {
	it('steps integer buffers by integer deltas', () => {
		expect(nextNumberValue('5', 1)).toBe('6');
		expect(nextNumberValue('5', -1)).toBe('4');
		expect(nextNumberValue('0', 10)).toBe('10');
	});

	it('treats non-numeric buffer as 0', () => {
		expect(nextNumberValue('', 1)).toBe('1');
		expect(nextNumberValue('abc', 5)).toBe('5');
		expect(nextNumberValue('NaN', 1)).toBe('1');
	});

	it('suppresses float drift', () => {
		expect(nextNumberValue('0.1', 0.2)).toBe('0.3');
	});

	it('parses leading numeric prefixes via parseFloat', () => {
		expect(nextNumberValue('3.14abc', 1)).toBe('4.14');
	});
});

describe('createEditHandlers', () => {
	function setup(initialBuffer = '') {
		let buf = initialBuffer;
		const callbacks = {
			onCommit: vi.fn(),
			onCancel: vi.fn(),
			onInput: vi.fn((v: string) => {
				buf = v;
			}),
			buffer: () => buf,
		};
		return { handlers: createEditHandlers(callbacks), callbacks };
	}

	function key(type: string, opts: Partial<KeyboardEvent> = {}) {
		return {
			key: type,
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			...opts,
		} as unknown as KeyboardEvent;
	}

	describe('onEditKeydown', () => {
		it('Enter commits', () => {
			const { handlers, callbacks } = setup();
			handlers.onEditKeydown(key('Enter'));
			expect(callbacks.onCommit).toHaveBeenCalledOnce();
		});

		it('Escape cancels', () => {
			const { handlers, callbacks } = setup();
			handlers.onEditKeydown(key('Escape'));
			expect(callbacks.onCancel).toHaveBeenCalledOnce();
		});

		it('other keys stop propagation but do nothing else', () => {
			const { handlers, callbacks } = setup();
			const e = key('a');
			handlers.onEditKeydown(e);
			expect(callbacks.onCommit).not.toHaveBeenCalled();
			expect(callbacks.onCancel).not.toHaveBeenCalled();
			expect(e.stopPropagation).toHaveBeenCalled();
		});
	});

	describe('onAreaKeydown (textarea)', () => {
		it('plain Enter does NOT commit (multi-line string)', () => {
			const { handlers, callbacks } = setup();
			handlers.onAreaKeydown(key('Enter'));
			expect(callbacks.onCommit).not.toHaveBeenCalled();
		});

		it('Cmd+Enter commits', () => {
			const { handlers, callbacks } = setup();
			handlers.onAreaKeydown(key('Enter', { metaKey: true }));
			expect(callbacks.onCommit).toHaveBeenCalledOnce();
		});

		it('Ctrl+Enter commits', () => {
			const { handlers, callbacks } = setup();
			handlers.onAreaKeydown(key('Enter', { ctrlKey: true }));
			expect(callbacks.onCommit).toHaveBeenCalledOnce();
		});

		it('Escape cancels', () => {
			const { handlers, callbacks } = setup();
			handlers.onAreaKeydown(key('Escape'));
			expect(callbacks.onCancel).toHaveBeenCalledOnce();
		});
	});

	describe('onBoolKeydown', () => {
		it('arrow keys flip the value (reading live buffer)', () => {
			const { handlers, callbacks } = setup('true');
			handlers.onBoolKeydown(key('ArrowRight'));
			expect(callbacks.onInput).toHaveBeenCalledWith('false');
		});

		it('arrow keys flip back to true when buffer is false', () => {
			const { handlers, callbacks } = setup('false');
			handlers.onBoolKeydown(key('ArrowLeft'));
			expect(callbacks.onInput).toHaveBeenCalledWith('true');
		});

		it('Enter commits, Escape cancels', () => {
			const { handlers, callbacks } = setup('true');
			handlers.onBoolKeydown(key('Enter'));
			expect(callbacks.onCommit).toHaveBeenCalledOnce();
			handlers.onBoolKeydown(key('Escape'));
			expect(callbacks.onCancel).toHaveBeenCalledOnce();
		});
	});

	describe('onNumberKeydown', () => {
		it('ArrowUp/Down step by 1', () => {
			const { handlers, callbacks } = setup('5');
			handlers.onNumberKeydown(key('ArrowUp'));
			expect(callbacks.onInput).toHaveBeenLastCalledWith('6');
			handlers.onNumberKeydown(key('ArrowDown'));
			expect(callbacks.onInput).toHaveBeenLastCalledWith('5'); // buffer was updated to 6 via onInput
		});

		it('Shift+ArrowUp/Down step by 10', () => {
			const { handlers, callbacks } = setup('5');
			handlers.onNumberKeydown(key('ArrowUp', { shiftKey: true }));
			expect(callbacks.onInput).toHaveBeenLastCalledWith('15');
			handlers.onNumberKeydown(key('ArrowDown', { shiftKey: true }));
			expect(callbacks.onInput).toHaveBeenLastCalledWith('5');
		});

		it('other keys defer to onEditKeydown semantics (Enter commits)', () => {
			const { handlers, callbacks } = setup('5');
			handlers.onNumberKeydown(key('Enter'));
			expect(callbacks.onCommit).toHaveBeenCalledOnce();
		});
	});

	describe('commitBool', () => {
		it('sets the buffer then commits', () => {
			const { handlers, callbacks } = setup('false');
			handlers.commitBool('true');
			expect(callbacks.onInput).toHaveBeenCalledWith('true');
			expect(callbacks.onCommit).toHaveBeenCalledOnce();
		});
	});

	describe('onBoolFocusOut', () => {
		it('commits when focus leaves the control entirely', () => {
			const { handlers, callbacks } = setup('true');
			const e = {
				relatedTarget: null,
				currentTarget: { contains: () => false } as unknown as HTMLElement,
			} as unknown as FocusEvent;
			handlers.onBoolFocusOut(e);
			expect(callbacks.onCommit).toHaveBeenCalledOnce();
		});

		it('does NOT commit when focus moves between internal segments', () => {
			const { handlers, callbacks } = setup('true');
			const inner = {} as unknown as Node;
			const e = {
				relatedTarget: inner,
				currentTarget: { contains: (n: Node) => n === inner } as unknown as HTMLElement,
			} as unknown as FocusEvent;
			handlers.onBoolFocusOut(e);
			expect(callbacks.onCommit).not.toHaveBeenCalled();
		});
	});
});

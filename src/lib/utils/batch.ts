import { BATCH_PROCESSING } from '$lib/constants';
import { formatError } from './error';

export interface BatchResult<T> {
	results: T[];
	errors: (string | null)[];
}

export interface BatchResultWithContext<T, E> {
	success: T[];
	errors: E[];
}

export async function processBatch<T, R>(
	items: T[],
	processor: (item: T) => Promise<R>,
	batchSize: number = BATCH_PROCESSING.DEFAULT_SIZE
): Promise<BatchResult<R>> {
	const results: R[] = [];
	const errors: (string | null)[] = [];

	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		const batchPromises = batch.map(processor);
		const batchResults = await Promise.allSettled(batchPromises);

		for (const result of batchResults) {
			if (result.status === 'fulfilled') {
				results.push(result.value);
				errors.push(null);
			} else {
				results.push(null as unknown as R);
				errors.push(formatError(result.reason));
			}
		}
	}

	return { results, errors };
}

/**
 * Process items in batches with context-aware error handling
 * Returns separate arrays for successes and errors (with context)
 */
export async function processBatchWithContext<T, R, E>(
	items: readonly T[],
	processor: (item: T) => Promise<R>,
	errorMapper: (item: T, error: unknown) => E,
	batchSize: number = BATCH_PROCESSING.DEFAULT_SIZE
): Promise<BatchResultWithContext<R, E>> {
	const success: R[] = [];
	const errors: E[] = [];

	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		const batchPromises = batch.map((item, batchIndex) => ({
			promise: processor(item),
			item,
			index: i + batchIndex
		}));

		const batchResults = await Promise.allSettled(
			batchPromises.map(({ promise }) => promise)
		);

		batchResults.forEach((result, batchIndex) => {
			const { item } = batchPromises[batchIndex];
			if (result.status === 'fulfilled') {
				success.push(result.value);
			} else {
				errors.push(errorMapper(item, result.reason));
			}
		});
	}

	return { success, errors };
}

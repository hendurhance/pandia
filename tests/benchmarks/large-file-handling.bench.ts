import { bench, describe } from 'vitest';
import { generateLargeJSON, measureTime } from '../setup/test-utils';

describe('Large File Handling Benchmarks', () => {
	// Test files at various sizes
	const sizes = [1, 5, 10]; // MB
	const testFiles = sizes.map((size) => ({
		size,
		content: generateLargeJSON(size)
	}));

	describe('File Size Analysis', () => {
		testFiles.forEach(({ size, content }) => {
			bench(`Analyze ${size}MB file size`, () => {
				const rawSize = content.length;
				// Estimate compression (simplified)
				const gzipEstimate = Math.floor(rawSize * 0.7);
				const brotliEstimate = Math.floor(rawSize * 0.6);
				return { rawSize, gzipEstimate, brotliEstimate };
			});
		});
	});

	describe('Line Counting', () => {
		testFiles.forEach(({ size, content }) => {
			bench(`Count lines ${size}MB`, () => {
				return content.split('\n').length;
			});
		});
	});

	describe('Character Search', () => {
		testFiles.forEach(({ size, content }) => {
			bench(`Search character ${size}MB`, () => {
				return content.indexOf('items');
			});
		});
	});

	describe('Memory-efficient Chunked Processing', () => {
		const CHUNK_SIZE = 100_000; // 100KB chunks

		testFiles.slice(0, 2).forEach(({ size, content }) => {
			bench(`Chunked read ${size}MB (100KB chunks)`, () => {
				let processed = 0;
				for (let i = 0; i < content.length; i += CHUNK_SIZE) {
					const chunk = content.slice(i, i + CHUNK_SIZE);
					processed += chunk.length;
				}
				return processed;
			});
		});
	});

	describe('Full Parse and Stringify Cycle', () => {
		testFiles.forEach(({ size, content }) => {
			bench(`Full cycle ${size}MB`, () => {
				const parsed = JSON.parse(content);
				return JSON.stringify(parsed, null, 2);
			});
		});
	});

	describe('Threshold Detection', () => {
		const LARGE_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB
		const VERY_LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

		testFiles.forEach(({ size, content }) => {
			bench(`Check thresholds ${size}MB`, () => {
				const isLarge = content.length > LARGE_FILE_THRESHOLD;
				const isVeryLarge = content.length > VERY_LARGE_FILE_THRESHOLD;
				return { isLarge, isVeryLarge };
			});
		});
	});
});

describe('Performance Timing Tests', () => {
	const mediumJSON = generateLargeJSON(1);

	bench('Measure parse time', () => {
		const { duration } = measureTime(() => JSON.parse(mediumJSON));
		return duration;
	});

	bench('Measure stringify time', () => {
		const parsed = JSON.parse(mediumJSON);
		const { duration } = measureTime(() => JSON.stringify(parsed));
		return duration;
	});

	bench('Measure format time', () => {
		const parsed = JSON.parse(mediumJSON);
		const { duration } = measureTime(() => JSON.stringify(parsed, null, 2));
		return duration;
	});
});

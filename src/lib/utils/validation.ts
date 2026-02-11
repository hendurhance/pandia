import { RESTRICTED_PATHS, FILE_LIMITS, FILE_EXTENSIONS, MIME_TYPES, BYTES, PERFORMANCE } from '$lib/constants';

export function isSecurePath(path: string): boolean {
	return !RESTRICTED_PATHS.some((restricted: string) => path.includes(restricted));
}

export function validatePathSecurity(path: string): void {
	if (!isSecurePath(path)) {
		throw new Error('Access to this directory is not allowed for security reasons.');
	}
}

export function getFileExtension(path: string): string | undefined {
	return path.split('.').pop()?.toLowerCase();
}

export function validateFileExtension<T extends readonly string[]>(
	path: string,
	allowedExtensions: T
): void {
	const ext = getFileExtension(path);
	if (ext && !allowedExtensions.includes(ext)) {
		throw new Error(
			`File type .${ext} is not supported. Allowed formats: ${allowedExtensions.join(', ')}`
		);
	}
}

export function validateFileSize(content: string, maxSize: number = FILE_LIMITS.MAX_FILE_SIZE): void {
	if (content.length > maxSize) {
		const sizeInMB = (content.length / BYTES.MB).toFixed(2);
		const maxInMB = (maxSize / BYTES.MB).toFixed(0);
		throw new Error(`File size exceeds the ${maxInMB}MB limit. File size: ${sizeInMB}MB`);
	}
}

export function extractFileName(path: string): string {
	return path.split('/').pop() || path.split('\\').pop() || 'Untitled';
}

export function isValidFileType(file: File): boolean {
	const validExtensions = FILE_EXTENSIONS.VALID_IMPORT;
	const validMimeTypes = MIME_TYPES.VALID;

	const hasValidExtension = validExtensions.some((ext: string) =>
		file.name.toLowerCase().endsWith(ext)
	);

	const hasValidMimeType = validMimeTypes.includes(file.type as typeof validMimeTypes[number]);
	const isSmallUnknownFile = file.size < PERFORMANCE.VERY_LARGE_FILE_THRESHOLD;

	return hasValidExtension || hasValidMimeType || isSmallUnknownFile;
}

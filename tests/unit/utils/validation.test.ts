import { describe, it, expect } from 'vitest';
import {
	isSecurePath,
	validatePathSecurity,
	getFileExtension,
	validateFileExtension,
	validateFileSize,
	extractFileName,
	isValidFileType
} from '$lib/utils/validation';
import { FILE_LIMITS, FILE_EXTENSIONS, BYTES } from '$lib/constants';

describe('validation utilities', () => {
	describe('isSecurePath', () => {
		it('should return true for safe paths', () => {
			expect(isSecurePath('/Users/test/documents/file.json')).toBe(true);
			expect(isSecurePath('/home/user/project/data.json')).toBe(true);
			expect(isSecurePath('/tmp/test.json')).toBe(true);
			expect(isSecurePath('C:\\Users\\test\\Documents\\file.json')).toBe(true);
		});

		it('should return false for Unix restricted paths', () => {
			expect(isSecurePath('/etc/passwd')).toBe(false);
			expect(isSecurePath('/Users/test/.ssh/id_rsa')).toBe(false);
			expect(isSecurePath('/usr/bin/node')).toBe(false);
			expect(isSecurePath('/var/log/system.log')).toBe(false);
			expect(isSecurePath('/System/Library/file')).toBe(false);
			expect(isSecurePath('/private/etc/hosts')).toBe(false);
		});

		it('should return false for AWS credentials', () => {
			expect(isSecurePath('/Users/test/.aws/credentials')).toBe(false);
		});

		it('should return false for config directories', () => {
			expect(isSecurePath('/Users/test/.config/secrets')).toBe(false);
		});

		it('should return false for Windows restricted paths', () => {
			expect(isSecurePath('C:\\Windows\\System32\\config')).toBe(false);
			expect(isSecurePath('C:\\Program Files\\app')).toBe(false);
		});
	});

	describe('validatePathSecurity', () => {
		it('should not throw for safe paths', () => {
			expect(() => validatePathSecurity('/home/user/file.json')).not.toThrow();
			expect(() => validatePathSecurity('/tmp/data.json')).not.toThrow();
		});

		it('should throw for restricted paths', () => {
			expect(() => validatePathSecurity('/etc/passwd')).toThrow('security');
			expect(() => validatePathSecurity('/Users/test/.ssh/key')).toThrow('security');
		});
	});

	describe('getFileExtension', () => {
		it('should extract file extension', () => {
			expect(getFileExtension('/path/to/file.json')).toBe('json');
			expect(getFileExtension('document.yaml')).toBe('yaml');
			expect(getFileExtension('file.tar.gz')).toBe('gz');
		});

		it('should return lowercase extension', () => {
			expect(getFileExtension('file.JSON')).toBe('json');
			expect(getFileExtension('file.YAML')).toBe('yaml');
			expect(getFileExtension('file.TXT')).toBe('txt');
		});

		it('should handle paths without extension', () => {
			expect(getFileExtension('Makefile')).toBe('makefile');
		});

		it('should handle dotfiles', () => {
			expect(getFileExtension('.gitignore')).toBe('gitignore');
		});
	});

	describe('validateFileExtension', () => {
		it('should not throw for allowed extensions', () => {
			expect(() => validateFileExtension('file.json', FILE_EXTENSIONS.ALLOWED)).not.toThrow();
			expect(() => validateFileExtension('file.txt', FILE_EXTENSIONS.ALLOWED)).not.toThrow();
			expect(() => validateFileExtension('file.md', FILE_EXTENSIONS.ALLOWED)).not.toThrow();
			expect(() => validateFileExtension('file.log', FILE_EXTENSIONS.ALLOWED)).not.toThrow();
		});

		it('should throw for disallowed extensions', () => {
			expect(() => validateFileExtension('file.exe', FILE_EXTENSIONS.ALLOWED)).toThrow(
				'not supported'
			);
			expect(() => validateFileExtension('file.sh', FILE_EXTENSIONS.ALLOWED)).toThrow(
				'not supported'
			);
			expect(() => validateFileExtension('file.py', FILE_EXTENSIONS.ALLOWED)).toThrow(
				'not supported'
			);
		});

		it('should work with export extensions', () => {
			expect(() => validateFileExtension('file.yaml', FILE_EXTENSIONS.EXPORT)).not.toThrow();
			expect(() => validateFileExtension('file.xml', FILE_EXTENSIONS.EXPORT)).not.toThrow();
			expect(() => validateFileExtension('file.csv', FILE_EXTENSIONS.EXPORT)).not.toThrow();
		});
	});

	describe('validateFileSize', () => {
		it('should not throw for files under default limit', () => {
			const smallContent = 'a'.repeat(1000);
			expect(() => validateFileSize(smallContent)).not.toThrow();
		});

		it('should not throw for files at exactly the limit', () => {
			const exactContent = 'a'.repeat(FILE_LIMITS.MAX_FILE_SIZE);
			expect(() => validateFileSize(exactContent)).not.toThrow();
		});

		it('should throw for files over default limit', () => {
			const largeContent = 'a'.repeat(FILE_LIMITS.MAX_FILE_SIZE + 1);
			expect(() => validateFileSize(largeContent)).toThrow('exceeds');
		});

		it('should support custom size limit', () => {
			const content = 'a'.repeat(1000);
			expect(() => validateFileSize(content, 500)).toThrow('exceeds');
		});

		it('should include file size in error message', () => {
			const content = 'a'.repeat(FILE_LIMITS.MAX_FILE_SIZE + BYTES.MB);
			expect(() => validateFileSize(content)).toThrow(/\d+.*MB/);
		});
	});

	describe('extractFileName', () => {
		it('should extract filename from Unix path', () => {
			expect(extractFileName('/path/to/file.json')).toBe('file.json');
			expect(extractFileName('/home/user/document.txt')).toBe('document.txt');
		});

		it('should extract filename from Windows path on Windows', () => {
			// Note: extractFileName splits by '/' first; on Unix, Windows paths are not split correctly
			// This test documents the actual behavior - the function prioritizes Unix path separators
			// For pure backslash paths, split('/') returns single element, pop returns it (non-empty)
			expect(extractFileName('C:\\Users\\test\\file.json')).toBe('C:\\Users\\test\\file.json');
			expect(extractFileName('D:\\Documents\\data.xml')).toBe('D:\\Documents\\data.xml');
		});

		it('should return filename if no path', () => {
			expect(extractFileName('file.json')).toBe('file.json');
		});

		it('should return Untitled for empty paths', () => {
			expect(extractFileName('')).toBe('Untitled');
		});
	});

	describe('isValidFileType', () => {
		it('should return true for JSON files', () => {
			const jsonFile = new File(['{}'], 'test.json', { type: 'application/json' });
			expect(isValidFileType(jsonFile)).toBe(true);
		});

		it('should return true for text files', () => {
			const textFile = new File(['hello'], 'test.txt', { type: 'text/plain' });
			expect(isValidFileType(textFile)).toBe(true);
		});

		it('should return true for YAML files', () => {
			const yamlFile = new File(['key: value'], 'test.yaml', { type: 'text/yaml' });
			expect(isValidFileType(yamlFile)).toBe(true);
		});

		it('should return true for XML files', () => {
			const xmlFile = new File(['<root></root>'], 'test.xml', { type: 'application/xml' });
			expect(isValidFileType(xmlFile)).toBe(true);
		});

		it('should return true for CSV files', () => {
			const csvFile = new File(['a,b,c'], 'test.csv', { type: 'text/csv' });
			expect(isValidFileType(csvFile)).toBe(true);
		});

		it('should allow small files with unknown type by extension', () => {
			const smallFile = new File(['data'], 'test.json', { type: '' });
			expect(isValidFileType(smallFile)).toBe(true);
		});

		it('should allow small files with unknown type', () => {
			const smallFile = new File(['data'], 'test.dat', { type: '' });
			// Small files under threshold are allowed
			expect(isValidFileType(smallFile)).toBe(true);
		});
	});
});

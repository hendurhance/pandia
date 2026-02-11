/** Byte multipliers for file size calculations */
export const BYTES = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
} as const;

/** File size limits for various operations */
export const FILE_LIMITS = {
  /** Maximum file size for import (50MB) */
  MAX_FILE_SIZE: 50 * BYTES.MB,
  /** Legacy max size for older file operations (10MB) */
  LEGACY_MAX_SIZE: 10 * BYTES.MB,
  /** Threshold for enabling large file optimizations (5MB) */
  LARGE_FILE_THRESHOLD: 5 * BYTES.MB,
  /** Maximum memory usage for operations (100MB) */
  MAX_MEMORY_USAGE: 100 * BYTES.MB,
  /** Maximum cache size for buffered data (100MB) */
  MAX_CACHE_SIZE: 100 * BYTES.MB,
  /** Maximum size for visualizer data (1MB) */
  MAX_VISUALIZER_SIZE: 1 * BYTES.MB,
} as const;

/** Supported file extensions for various operations */
export const FILE_EXTENSIONS = {
  /** Extensions allowed for import */
  ALLOWED: ['json', 'txt', 'md', 'log'] as const,
  /** Extensions allowed for export */
  EXPORT: ['json', 'txt', 'yaml', 'yml', 'xml', 'csv'] as const,
  /** Extensions with dot prefix for validation */
  VALID_IMPORT: ['.json', '.txt', '.yaml', '.yml', '.xml', '.csv'] as const,
} as const;

/** Valid MIME types for file operations */
export const MIME_TYPES = {
  VALID: [
    'application/json',
    'text/plain',
    'text/json',
    'application/xml',
    'text/xml',
    'text/yaml',
    'text/csv',
  ] as const,
} as const;

/** Paths that are restricted for security reasons */
export const RESTRICTED_PATHS = [
  // Unix/macOS system paths
  '/.ssh/',
  '/.aws/',
  '/.config/',
  '/etc/',
  '/usr/',
  '/bin/',
  '/sbin/',
  '/System/',
  '/Applications/',
  '/Library/',
  '/private/',
  '/var/',
  // Windows system paths
  '\\Windows\\',
  '\\Program Files\\',
  '\\System32\\',
] as const;

/** Performance thresholds and settings */
export const PERFORMANCE = {
  /** Memory usage warning threshold (50MB in bytes) */
  MEMORY_THRESHOLD: 50 * 1024 * 1024,
  /** Very large file threshold for special handling (10MB in bytes) */
  VERY_LARGE_FILE_THRESHOLD: 10 * 1024 * 1024,
  /** Slow operation threshold (50ms) */
  SLOW_OPERATION_THRESHOLD: 50,
  /** Very slow operation threshold (1000ms) */
  VERY_SLOW_OPERATION_THRESHOLD: 1000,
  /** Debounce time for idle detection (ms) */
  IDLE_DEBOUNCE_MS: 0,
  /** Chunk size for background processing (bytes) */
  CHUNK_PROCESSING_SIZE: 100_000,
  /** Chunk size for main thread processing (bytes) */
  SMALL_CHUNK_SIZE: 10_000,
} as const;

/** Batch processing configuration for various operations */
export const BATCH_PROCESSING = {
  /** Default batch size for general operations */
  DEFAULT_SIZE: 5,
  /** Batch size for file processing operations */
  FILE_PROCESSING: 3,
  /** Batch size for validation operations */
  VALIDATION: 10,
} as const;

/** Auto-save default settings */
export const AUTOSAVE = {
  /** Whether auto-save is enabled by default */
  ENABLED: true,
  /** Default save interval (seconds) */
  INTERVAL_SECONDS: 60,
  /** Whether to save on idle by default */
  SAVE_ON_IDLE: true,
  /** Idle timeout before save (seconds) */
  IDLE_TIMEOUT_SECONDS: 5,
  /** Maximum history states to keep */
  MAX_HISTORY_SIZE: 50,
  /** Default countdown display (seconds) */
  COUNTDOWN_DEFAULT: 30,
} as const;

/** IndexedDB configuration */
export const DATABASE = {
  /** Database name */
  NAME: 'pandia',
  /** Database schema version */
  VERSION: 1,
  /** Session identifier key */
  SESSION_ID: 'active-session',
  /** Maximum age for cached buffers (7 days in ms) */
  MAX_BUFFER_AGE: 7 * 24 * 60 * 60 * 1000,
  /** Maximum recent files to track */
  MAX_RECENT_FILES: 10,
} as const;

/** UI default values and dimensions */
export const UI = {
  /** Default sidebar width (px) */
  SIDEBAR_WIDTH: 250,
  /** Default editor font size (px) */
  FONT_SIZE: 14,
  /** Default indentation size (spaces) */
  INDENT_SIZE: 2,
  /** Default tab size (spaces) */
  TAB_SIZE: 2,
  /** Virtual scroll item height (px) */
  VIRTUAL_SCROLL_ITEM_HEIGHT: 25,
  /** Virtual scroll buffer multiplier */
  VIRTUAL_SCROLL_BUFFER: 0.5,
  /** Initialization delay for UI (ms) */
  INIT_DELAY_MS: 100,
} as const;

/** JSON formatting options */
export const FORMAT = {
  /** Default indentation spaces */
  DEFAULT_INDENT: 2,
  /** File size threshold to skip pretty printing (bytes) */
  SKIP_PRETTY_THRESHOLD: 500_000,
} as const;

/** Application metadata */
export const APP = {
  /** Application name */
  NAME: 'Pandia',
  /** Application version */
  VERSION: '0.1.0',
} as const;

export type AllowedExtension = typeof FILE_EXTENSIONS.ALLOWED[number];
export type ExportExtension = typeof FILE_EXTENSIONS.EXPORT[number];
export type ValidMimeType = typeof MIME_TYPES.VALID[number];

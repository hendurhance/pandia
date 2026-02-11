import { writable } from 'svelte/store';
import Ajv, { type JSONSchemaType } from 'ajv';
import addFormats from 'ajv-formats';
import { formatError } from '../utils/error';

export interface ValidationError {
    instancePath: string;
    schemaPath: string;
    keyword: string;
    params: Record<string, unknown>;
    message?: string;
    line?: number;
    column?: number;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    timestamp: number;
}

type JSONSchema = JSONSchemaType<unknown> | Record<string, unknown>;

class SchemaValidator {
    private ajv: Ajv;
    private currentSchema: JSONSchema | null = null;

    constructor() {
        this.ajv = new Ajv({ allErrors: true, verbose: true });
        addFormats(this.ajv);
    }

    setSchema(schema: JSONSchema): boolean {
        try {
            this.ajv.compile(schema);
            this.currentSchema = schema;
            return true;
        } catch (error) {
            console.error('Invalid schema:', error);
            return false;
        }
    }

    validate(data: unknown): ValidationResult {
        if (!this.currentSchema) {
            return {
                valid: true,
                errors: [],
                timestamp: Date.now()
            };
        }

        const validate = this.ajv.compile(this.currentSchema);
        const valid = validate(data);

        const errors: ValidationError[] = validate.errors?.map(error => ({
            instancePath: error.instancePath,
            schemaPath: error.schemaPath,
            keyword: error.keyword,
            params: error.params as Record<string, unknown>,
            message: error.message,
        })) || [];

        return {
            valid,
            errors,
            timestamp: Date.now()
        };
    }

    validateJSON(jsonString: string): ValidationResult {
        try {
            const data: unknown = JSON.parse(jsonString);
            return this.validate(data);
        } catch (error) {
            return {
                valid: false,
                errors: [{
                    instancePath: '',
                    schemaPath: '',
                    keyword: 'format',
                    params: {},
                    message: `Invalid JSON: ${formatError(error)}`
                }],
                timestamp: Date.now()
            };
        }
    }

    hasSchema(): boolean {
        return this.currentSchema !== null;
    }

    getSchema(): JSONSchema | null {
        return this.currentSchema;
    }

    clearSchema() {
        this.currentSchema = null;
    }
}

export const schemaValidator = new SchemaValidator();
export const validationResult = writable<ValidationResult | null>(null);
export const showSchemaModal = writable(false);
// Type declarations for json_typegen_wasm
declare module 'json_typegen_wasm' {
  /**
   * Generate types from JSON samples
   * @param name - The name of the root type
   * @param input - The JSON input string
   * @param options - JSON string of options including output_mode
   * @returns Generated type definitions
   */
  export function run(name: string, input: string, options: string): string;
}

// Type declarations for generate-schema
declare module 'generate-schema' {
  interface Schema {
    [key: string]: unknown;
  }

  interface BigQueryField {
    name: string;
    type: string;
    mode: string;
    fields?: BigQueryField[];
  }

  interface MongooseSchemaField {
    type: string;
    required?: boolean;
    [key: string]: unknown;
  }

  /**
   * Generate JSON Schema from data
   */
  export function json(data: unknown): Schema;

  /**
   * Generate Mongoose schema from data
   */
  export function mongoose(data: unknown): Record<string, MongooseSchemaField>;

  /**
   * Generate BigQuery schema from data
   */
  export function bigquery(data: unknown): BigQueryField[];

  /**
   * Generate MySQL CREATE TABLE statement from data
   */
  export function mysql(data: unknown, tableName?: string): string;

  /**
   * Generate ClickHouse schema from data
   */
  export function clickhouse(data: unknown, tableName?: string): string;

  /**
   * Generate generic schema from data
   */
  export function generic(data: unknown): Schema;
}

// Type declarations for @walmartlabs/json-to-simple-graphql-schema
declare module '@walmartlabs/json-to-simple-graphql-schema' {
  interface JsonToSchemaOptions {
    jsonInput: string;
    baseType?: string;
  }

  interface JsonToSchemaResult {
    value?: string;
    error?: Error;
  }

  /**
   * Convert JSON to GraphQL schema
   */
  export function jsonToSchema(options: JsonToSchemaOptions): JsonToSchemaResult;
}

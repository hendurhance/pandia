import { jsonToGo } from './json2go';
import { isPlainObject, formatError } from '../utils/error';

// Type for json_typegen_wasm - loaded dynamically for browser environment
type JsonTypegenRun = (name: string, input: string, options: string) => string;
let jsonTypegenRun: JsonTypegenRun | null = null;

// Lazy load json_typegen_wasm
async function getJsonTypegen(): Promise<JsonTypegenRun> {
  if (jsonTypegenRun) return jsonTypegenRun;
  
  try {
    const module = await import('json_typegen_wasm');
    jsonTypegenRun = module.run;
    return jsonTypegenRun;
  } catch (e) {
    console.error('Failed to load json_typegen_wasm:', e);
    throw new Error('WASM module failed to load');
  }
}

// Type for generate-schema
interface GenerateSchema {
  json: (data: unknown) => unknown;
  mongoose: (data: unknown) => unknown;
  bigquery: (data: unknown) => unknown;
  mysql: (data: unknown, tableName?: string) => string;
  clickhouse: (data: unknown, tableName?: string) => string;
}

let generateSchemaModule: GenerateSchema | null = null;

async function getGenerateSchema(): Promise<GenerateSchema> {
  if (generateSchemaModule) return generateSchemaModule;
  
  try {
    // @ts-ignore - CommonJS module
    const mod = await import('generate-schema');
    generateSchemaModule = mod.default || mod;
    return generateSchemaModule!;
  } catch (e) {
    console.error('Failed to load generate-schema:', e);
    throw new Error('generate-schema module failed to load');
  }
}

export enum SupportedLanguage {
  TypeScript = 'typescript',
  Go = 'go',
  Rust = 'rust',
  Kotlin = 'kotlin',
  JsonSchema = 'json-schema',
  Python = 'python',
  Php = 'php',
  Java = 'java',
  Zod = 'zod',
  BigQuery = 'bigquery',
  MySQL = 'mysql',
  Mongoose = 'mongoose',
  GraphQL = 'graphql'
}

export interface GenerateTypesOptions {
  typeName?: string;
  tableName?: string;
}

/**
 * Generate type definitions from JSON data
 * This is an async function because some generators require WASM loading
 */
export async function generateTypes(
  data: unknown,
  language: SupportedLanguage,
  options: GenerateTypesOptions = {}
): Promise<string> {
  const { typeName = 'Root', tableName = 'generated_table' } = options;
  const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  
  switch (language) {
    case SupportedLanguage.TypeScript:
      return generateWithJsonTypegen(jsonString, typeName, 'typescript');
    
    case SupportedLanguage.Rust:
      return generateWithJsonTypegen(jsonString, typeName, 'rust');
    
    case SupportedLanguage.Kotlin:
      return generateWithJsonTypegen(jsonString, typeName, 'kotlin/jackson');
    
    case SupportedLanguage.Python:
      return generateWithJsonTypegen(jsonString, typeName, 'python');
    
    case SupportedLanguage.Zod:
      // Note: json_typegen_wasm v0.7.0 on npm doesn't support Zod yet (added in Feb 2025 but not published)
      // Using custom implementation
      return generateZodSchema(data, typeName);
    
    case SupportedLanguage.Go:
      return generateGoTypes(jsonString, typeName);
    
    case SupportedLanguage.JsonSchema:
      return generateJsonSchema(data);
    
    case SupportedLanguage.BigQuery:
      return generateBigQuerySchema(data);
    
    case SupportedLanguage.MySQL:
      return generateMySQLSchema(data, tableName);
    
    case SupportedLanguage.Mongoose:
      return generateMongooseSchemaWithLib(data, typeName);
    
    case SupportedLanguage.GraphQL:
      return generateGraphQLSchemaWithLib(data, typeName);
    
    case SupportedLanguage.Php:
      return generatePhpTypes(data, typeName);
    
    case SupportedLanguage.Java:
      return generateJavaTypes(jsonString, typeName);
    
    default:
      return '// Unsupported language';
  }
}

/**
 * Synchronous version for backwards compatibility
 * Falls back to built-in generators if WASM is not loaded
 */
export function generateTypesSync(
  data: unknown,
  language: SupportedLanguage,
  options: GenerateTypesOptions = {}
): string {
  const { typeName = 'Root' } = options;
  const jsonString = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  
  // Use sync-compatible generators
  switch (language) {
    case SupportedLanguage.Go:
      return generateGoTypes(jsonString, typeName);
    
    case SupportedLanguage.Php:
      return generatePhpTypes(data, typeName);
    
    default:
      // For async-required languages, return a placeholder
      return `// Loading ${language} generator...\n// Please wait for the async version to complete.`;
  }
}

// json_typegen_wasm based generators

async function generateWithJsonTypegen(
  jsonString: string,
  typeName: string,
  outputMode: string
): Promise<string> {
  try {
    const run = await getJsonTypegen();
    const options = JSON.stringify({ output_mode: outputMode });
    const result = run(typeName, jsonString, options);
    return result;
  } catch (e) {
    console.error(`Error generating ${outputMode}:`, e);
    return `// Error generating types: ${formatError(e)}`;
  }
}

// Go Generator (using json2go)

function generateGoTypes(jsonString: string, typeName: string): string {
  try {
    const result = jsonToGo(jsonString, { typename: typeName, flatten: true });
    if (result.error) {
      return `// Error: ${result.error}`;
    }
    return result.go;
  } catch (e) {
    return `// Error generating Go types: ${formatError(e)}`;
  }
}

// Custom Schema Generators

async function generateJsonSchema(data: unknown): Promise<string> {
  const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
  return renderJsonSchema(parsedData, 'Root');
}

async function generateBigQuerySchema(data: unknown): Promise<string> {
  const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
  return renderBigQuerySchema(parsedData);
}

async function generateMySQLSchema(data: unknown, tableName: string): Promise<string> {
  const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
  return renderMySQLSchema(parsedData, tableName);
}

// generate-schema based generators (Mongoose & GraphQL)

async function generateMongooseSchemaWithLib(data: unknown, typeName: string): Promise<string> {
  try {
    const gs = await getGenerateSchema();
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    const schema = gs.mongoose(parsedData);
    
    // Format as a proper Mongoose schema definition
    const schemaName = capitalizeFirst(typeName) + 'Schema';
    const modelName = capitalizeFirst(typeName);
    
    let output = `const mongoose = require('mongoose');\n`;
    output += `const { Schema } = mongoose;\n\n`;
    output += `const ${schemaName} = new Schema(${JSON.stringify(schema, null, 2)}, { timestamps: true });\n\n`;
    output += `const ${modelName} = mongoose.model('${modelName}', ${schemaName});\n\n`;
    output += `module.exports = ${modelName};\n`;
    
    return output;
  } catch (e) {
    // Fallback to custom implementation if generate-schema fails (e.g., Buffer not available)
    console.warn('generate-schema failed, using custom implementation:', e);
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    return renderMongooseSchema(parsedData, typeName);
  }
}

async function generateGraphQLSchemaWithLib(data: unknown, typeName: string): Promise<string> {
  try {
    const gs = await getGenerateSchema();
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    
    // generate-schema doesn't have a direct GraphQL method, so we use the generic schema
    // and convert it to GraphQL format
    const genericSchema = gs.json(parsedData);
    return convertJsonSchemaToGraphQL(genericSchema, typeName);
  } catch (e) {
    // Fallback to custom implementation
    console.warn('generate-schema failed, using custom implementation:', e);
    const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
    return renderGraphQLSchema(parsedData, typeName);
  }
}

function convertJsonSchemaToGraphQL(schema: unknown, typeName: string): string {
  const out: string[] = [];
  const generatedTypes = new Set<string>();
  
  function getGraphQLTypeFromSchema(prop: Record<string, unknown>, fieldName: string): string {
    const type = prop.type as string;
    
    switch (type) {
      case 'string':
        return 'String';
      case 'integer':
        return 'Int';
      case 'number':
        return 'Float';
      case 'boolean':
        return 'Boolean';
      case 'array':
        const items = prop.items as Record<string, unknown> | undefined;
        if (items) {
          return `[${getGraphQLTypeFromSchema(items, fieldName)}]`;
        }
        return '[String]';
      case 'object':
        const nestedTypeName = toPascalCase(sanitizeIdentifier(fieldName, true));
        generateTypeFromSchema(prop, nestedTypeName);
        return nestedTypeName;
      default:
        return 'String';
    }
  }
  
  function generateTypeFromSchema(schema: Record<string, unknown>, name: string): void {
    if (generatedTypes.has(name)) return;
    generatedTypes.add(name);
    
    const properties = schema.properties as Record<string, Record<string, unknown>> | undefined;
    if (!properties) return;
    
    // First generate nested types
    for (const [key, prop] of Object.entries(properties)) {
      if (prop.type === 'object' && prop.properties) {
        generateTypeFromSchema(prop, toPascalCase(sanitizeIdentifier(key, true)));
      } else if (prop.type === 'array' && prop.items) {
        const items = prop.items as Record<string, unknown>;
        if (items.type === 'object' && items.properties) {
          generateTypeFromSchema(items, toPascalCase(sanitizeIdentifier(key, true)));
        }
      }
    }
    
    // Generate this type
    const fields: string[] = [];
    for (const [key, prop] of Object.entries(properties)) {
      const graphqlType = getGraphQLTypeFromSchema(prop, key);
      fields.push(`  ${toCamelCase(key)}: ${graphqlType}`);
    }
    
    out.push(`type ${name} {`);
    out.push(fields.join('\n'));
    out.push('}');
    out.push('');
  }
  
  const schemaObj = schema as Record<string, unknown>;
  if (schemaObj.type === 'array' && schemaObj.items) {
    const items = schemaObj.items as Record<string, unknown>;
    if (items.type === 'object') {
      generateTypeFromSchema(items, typeName);
    }
  } else if (schemaObj.type === 'object') {
    generateTypeFromSchema(schemaObj, typeName);
  }
  
  // Add Query type
  out.push('type Query {');
  out.push(`  get${typeName}(id: ID!): ${typeName}`);
  out.push(`  list${typeName}s: [${typeName}!]!`);
  out.push('}');
  
  return out.join('\n');
}



// Custom PHP Generator (kept inbuilt as per requirements)

function generatePhpTypes(data: unknown, typeName: string): string {
  const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
  const shape = inferShape(parsedData);
  return renderPhp(shape, typeName);
}

// Java Generator
// Uses Kotlin output from json_typegen_wasm and transforms it to Java.
// This approach is based on the work by Ritesh Kumar (ritz078):
// https://github.com/ritz078/transform/blob/master/pages/json-to-java.tsx

async function generateJavaTypes(jsonString: string, typeName: string): Promise<string> {
  try {
    const run = await getJsonTypegen();
    const options = JSON.stringify({ output_mode: 'kotlin' });
    const kotlinOutput = run(typeName, jsonString, options);
    return transformKotlinToJava(kotlinOutput);
  } catch (e) {
    console.error('Error generating Java types:', e);
    return `// Error generating Java types: ${formatError(e)}`;
  }
}

/**
 * Transform Kotlin data classes to Java classes with constructors, getters, and setters.
 * Based on the approach by Ritesh Kumar (ritz078) from:
 * https://github.com/ritz078/transform
 */
function transformKotlinToJava(kotlinCode: string): string {
  const lines = kotlinCode.split('\n');
  let javaCode = '';
  let currentClass = '';
  let variableNames: string[] = [];
  let variableTypes: string[] = [];

  for (const originalLine of lines) {
    const line = originalLine.trim();

    if (line === ')') {
      // Class is closing - generate constructor, getters and setters
      const args: string[] = [];
      const getters: string[] = [];
      const setters: string[] = [];

      for (let i = 0; i < variableNames.length; i++) {
        const type = variableTypes[i];
        const variableName = variableNames[i];
        const titleCaseVariable = variableName.charAt(0).toUpperCase() + variableName.substring(1);
        
        args.push(`${type} ${variableName}`);
        getters.push(`\tpublic ${type} get${titleCaseVariable}() {\n\t\treturn this.${variableName};\n\t}\n`);
        setters.push(`\tpublic void set${titleCaseVariable}(${type} ${variableName}) {\n\t\tthis.${variableName} = ${variableName};\n\t}\n`);
      }

      // Create constructor
      let constructor = `\tpublic ${currentClass}(${args.join(', ')}) {`;
      const properties = variableNames.map(v => `this.${v} = ${v};`);
      constructor += `\n\t\t${properties.join('\n\t\t')}\n\t}\n`;

      javaCode += `\n${constructor}\n${getters.join('\n')}\n${setters.join('\n')}}`;

      // Reset for next class
      currentClass = '';
      variableNames = [];
      variableTypes = [];
    } else if (line.startsWith('data class ')) {
      // Change 'data class Root(' to 'public class Root {'
      const classNameStartIndex = 11; // length of "data class "
      const classNameEndIndex = line.indexOf('(');
      const className = line.substring(classNameStartIndex, classNameEndIndex);
      javaCode += `public class ${className} {`;
      currentClass = className;
    } else if (line.startsWith('val')) {
      // Change 'val name: String' to 'private String name;'
      const processedLine = line.replace('?', '');
      const variableStartIndex = 4; // length of "val "
      const variableEndIndex = processedLine.indexOf(':');
      const variable = processedLine.substring(variableStartIndex, variableEndIndex);
      const typeStartIndex = processedLine.indexOf(':') + 2;
      let type = processedLine.substring(typeStartIndex, processedLine.length - 1);

      // Update Kotlin generic typing to Java generic typing
      type = type.replace('<Any>?', '<?>').replace('<Any>', '<?>');

      variableNames.push(variable);
      variableTypes.push(type);
      javaCode += `\tprivate ${type} ${variable};`;
    } else if (line.startsWith('typealias')) {
      // Convert typealias to a wrapper class
      const classNameStartIndex = 10; // length of "typealias "
      const classNameEndIndex = line.indexOf(' =');
      const className = line.substring(classNameStartIndex, classNameEndIndex);
      const typeNameEndIndex = line.indexOf('=') + 2;
      const type = line.substring(typeNameEndIndex, line.length - 1);
      const variable = className.charAt(0).toLowerCase() + className.substring(1);
      const titleCaseVariable = className;

      const getter = `\tpublic ${type} get${titleCaseVariable}() {\n\t\treturn this.${variable};\n\t}\n\n`;
      const setter = `\tpublic void set${titleCaseVariable}(${type} ${variable}) {\n\t\tthis.${variable} = ${variable};\n\t}\n\n`;
      const constructor = `\tpublic ${className}(${type} ${variable}) {\n\t\tthis.${variable} = ${variable};\n\t}\n`;

      javaCode += `public class ${className} {\n\tprivate ${type} ${variable};\n`;
      javaCode += `\n${constructor}\n${getter}${setter}}`;
    } else if (line.startsWith('import')) {
      javaCode += `${line};`;
    } else {
      // Any other line (probably newlines)
      javaCode += originalLine;
    }

    javaCode += '\n';
  }

  return javaCode;
}

// Internal Shape Inference (for PHP and Java)

type PrimitiveKind = 'null' | 'string' | 'number' | 'integer' | 'boolean' | 'any';

interface PrimitiveShape {
  kind: 'primitive';
  type: PrimitiveKind;
}

interface ArrayShape {
  kind: 'array';
  items: TypeShape;
}

interface ObjectShape {
  kind: 'object';
  properties: Record<string, { type: TypeShape; optional: boolean }>;
}

interface UnknownShape {
  kind: 'unknown';
}

type TypeShape = PrimitiveShape | ArrayShape | ObjectShape | UnknownShape;

const PRIMITIVE_ANY: PrimitiveShape = { kind: 'primitive', type: 'any' };

// isPlainObject imported from errorUtils

function inferPrimitive(value: unknown): PrimitiveShape {
  if (value === null) return { kind: 'primitive', type: 'null' };
  if (typeof value === 'string') return { kind: 'primitive', type: 'string' };
  if (typeof value === 'number') return { kind: 'primitive', type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'boolean') return { kind: 'primitive', type: 'boolean' };
  return PRIMITIVE_ANY;
}

function mergeShapes(a: TypeShape, b: TypeShape): TypeShape {
  if (a.kind === 'unknown') return b;
  if (b.kind === 'unknown') return a;
  
  if (a.kind === 'primitive' && b.kind === 'primitive') {
    if (a.type === b.type) return a;
    if ((a.type === 'integer' && b.type === 'number') || (a.type === 'number' && b.type === 'integer')) {
      return { kind: 'primitive', type: 'number' };
    }
    return PRIMITIVE_ANY;
  }
  
  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', items: mergeShapes(a.items, b.items) };
  }
  
  if (a.kind === 'object' && b.kind === 'object') {
    const props: Record<string, { type: TypeShape; optional: boolean }> = {};
    const allKeys = new Set([...Object.keys(a.properties), ...Object.keys(b.properties)]);
    
    for (const k of allKeys) {
      const propA = a.properties[k];
      const propB = b.properties[k];
      
      if (propA && propB) {
        props[k] = {
          type: mergeShapes(propA.type, propB.type),
          optional: propA.optional || propB.optional
        };
      } else if (propA) {
        props[k] = { type: propA.type, optional: true };
      } else {
        props[k] = { type: propB!.type, optional: true };
      }
    }
    return { kind: 'object', properties: props };
  }
  
  return PRIMITIVE_ANY;
}

function inferShape(value: unknown): TypeShape {
  if (value === undefined) return { kind: 'unknown' };
  if (value === null) return inferPrimitive(null);
  
  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'array', items: PRIMITIVE_ANY };
    const limit = Math.min(value.length, 50);
    let itemsShape = inferShape(value[0]);
    
    for (let i = 1; i < limit; i++) {
      itemsShape = mergeShapes(itemsShape, inferShape(value[i]));
    }
    return { kind: 'array', items: itemsShape };
  }
  
  if (isPlainObject(value)) {
    const props: Record<string, { type: TypeShape; optional: boolean }> = {};
    for (const [k, v] of Object.entries(value)) {
      props[k] = { type: inferShape(v), optional: false };
    }
    return { kind: 'object', properties: props };
  }
  
  return inferPrimitive(value);
}

// Helpers

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function lowerFirst(str: string): string {
  return str.charAt(0).toLowerCase() + str.slice(1);
}

function sanitizeIdentifier(name: string, capitalize = false): string {
  // Handle numeric keys by prefixing with "Item"
  let cleaned = name;
  if (/^\d+$/.test(name)) {
    cleaned = `Item${name}`;
  } else {
    cleaned = name.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^\d/.test(cleaned)) {
      cleaned = '_' + cleaned;
    }
  }
  return capitalize ? capitalizeFirst(cleaned) : cleaned;
}

function toCamelCase(str: string): string {
  return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
}

function toPascalCase(str: string): string {
  const camel = toCamelCase(str);
  return camel.charAt(0).toUpperCase() + camel.slice(1);
}

// PHP Renderer (Fixed for numeric keys and duplicate classes)

function renderPhp(shape: TypeShape, typeName: string): string {
  const out: string[] = ['<?php', '', 'declare(strict_types=1);', ''];
  const generatedClasses = new Set<string>();

  function phpType(s: TypeShape, name = 'RootType'): string {
    if (s.kind === 'primitive') {
      switch (s.type) {
        case 'string': return 'string';
        case 'integer': return 'int';
        case 'number': return 'float';
        case 'boolean': return 'bool';
        case 'null': return 'mixed';
        default: return 'mixed';
      }
    }
    if (s.kind === 'array') return 'array';
    if (s.kind === 'object') return sanitizeIdentifier(name, true);
    return 'mixed';
  }

  function phpPropertyName(name: string): string {
    // Handle numeric property names
    if (/^\d+$/.test(name)) {
      return `item${name}`;
    }
    return toCamelCase(name);
  }

  function renderClass(s: ObjectShape, name: string, parentPath = '') {
    const className = sanitizeIdentifier(name, true);
    const classKey = `${parentPath}_${className}`;
    
    if (generatedClasses.has(classKey)) return;
    generatedClasses.add(classKey);
    
    // First, collect all nested classes we need to generate
    const nestedClasses: Array<{ shape: ObjectShape; name: string; path: string }> = [];
    
    const entries = Object.entries(s.properties);
    for (const [k, v] of entries) {
      const propName = toPascalCase(sanitizeIdentifier(k, true));
      if (v.type.kind === 'object') {
        nestedClasses.push({ 
          shape: v.type, 
          name: propName,
          path: classKey
        });
      } else if (v.type.kind === 'array' && v.type.items.kind === 'object') {
        nestedClasses.push({ 
          shape: v.type.items as ObjectShape, 
          name: `${propName}Item`,
          path: classKey
        });
      }
    }
    
    // Generate nested classes first
    for (const nested of nestedClasses) {
      renderClass(nested.shape, nested.name, nested.path);
    }
    
    // Now generate this class
    out.push(`final readonly class ${className}`);
    out.push('{');
    out.push('    public function __construct(');
    
    entries.forEach(([k, v], i) => {
      const { type, optional } = v;
      const comma = i < entries.length - 1 ? ',' : '';
      const propName = phpPropertyName(k);
      let t = phpType(type, toPascalCase(sanitizeIdentifier(k, true)));
      if (type.kind === 'array' && type.items.kind === 'object') {
        t = 'array'; // /** @var TypeItem[] */
      }
      if (optional) t = `?${t}`;
      out.push(`        public ${t} $${propName}${optional ? ' = null' : ''}${comma}`);
    });
    
    out.push('    ) {}');
    out.push('}');
    out.push('');
  }

  if (shape.kind === 'object') {
    renderClass(shape, typeName);
  } else if (shape.kind === 'array' && shape.items.kind === 'object') {
    renderClass(shape.items, `${typeName}Item`);
    out.push(`/** @var ${typeName}Item[] */`);
    out.push(`$${lowerFirst(typeName)} = []; // Array of ${typeName}Item`);
  } else {
    out.push(`final readonly class ${typeName}DTO { public mixed $value; }`);
  }

  return out.join('\n');
}

// JSON Schema Renderer (Custom Implementation)

function renderJsonSchema(data: unknown, typeName: string): string {
  function getJsonSchemaType(value: unknown): Record<string, unknown> {
    if (value === null) return { type: 'null' };
    
    switch (typeof value) {
      case 'string':
        // Check for format hints
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: 'string', format: 'date' };
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return { type: 'string', format: 'date-time' };
        if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) return { type: 'string', format: 'email' };
        if (/^https?:\/\//.test(value)) return { type: 'string', format: 'uri' };
        return { type: 'string' };
      case 'number':
        return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
      case 'boolean':
        return { type: 'boolean' };
      case 'object':
        if (Array.isArray(value)) {
          if (value.length === 0) return { type: 'array', items: {} };
          return { type: 'array', items: getJsonSchemaType(value[0]) };
        }
        return getObjectSchema(value as Record<string, unknown>);
      default:
        return {};
    }
  }
  
  function getObjectSchema(obj: Record<string, unknown>): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    
    for (const [key, value] of Object.entries(obj)) {
      properties[key] = getJsonSchemaType(value);
      if (value !== null && value !== undefined) {
        required.push(key);
      }
    }
    
    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined
    };
  }
  
  let schema: Record<string, unknown>;
  
  if (Array.isArray(data)) {
    if (data.length === 0) {
      schema = { type: 'array', items: {} };
    } else {
      schema = { type: 'array', items: getJsonSchemaType(data[0]) };
    }
  } else if (typeof data === 'object' && data !== null) {
    schema = getObjectSchema(data as Record<string, unknown>);
  } else {
    schema = getJsonSchemaType(data);
  }
  
  const fullSchema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://example.com/${typeName.toLowerCase()}.schema.json`,
    title: typeName,
    ...schema
  };
  
  return JSON.stringify(fullSchema, null, 2);
}

// BigQuery Schema Renderer

function renderBigQuerySchema(data: unknown): string {
  function getBigQueryType(value: unknown): { type: string; mode: string; fields?: unknown[] } {
    if (value === null) return { type: 'STRING', mode: 'NULLABLE' };
    
    switch (typeof value) {
      case 'string':
        // Check for date/time patterns
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { type: 'DATE', mode: 'NULLABLE' };
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return { type: 'TIMESTAMP', mode: 'NULLABLE' };
        return { type: 'STRING', mode: 'NULLABLE' };
      case 'number':
        return Number.isInteger(value) ? { type: 'INTEGER', mode: 'NULLABLE' } : { type: 'FLOAT', mode: 'NULLABLE' };
      case 'boolean':
        return { type: 'BOOLEAN', mode: 'NULLABLE' };
      case 'object':
        if (Array.isArray(value)) {
          if (value.length === 0) return { type: 'STRING', mode: 'REPEATED' };
          const itemType = getBigQueryType(value[0]);
          return { ...itemType, mode: 'REPEATED' };
        }
        const fields = Object.entries(value as Record<string, unknown>).map(([key, val]) => ({
          name: key,
          ...getBigQueryType(val)
        }));
        return { type: 'RECORD', mode: 'NULLABLE', fields };
      default:
        return { type: 'STRING', mode: 'NULLABLE' };
    }
  }
  
  if (Array.isArray(data)) {
    if (data.length === 0) return '[]';
    data = data[0];
  }
  
  if (typeof data !== 'object' || data === null) {
    return JSON.stringify([getBigQueryType(data)], null, 2);
  }
  
  const schema = Object.entries(data as Record<string, unknown>).map(([key, value]) => ({
    name: key,
    ...getBigQueryType(value)
  }));
  
  return JSON.stringify(schema, null, 2);
}

// MySQL Schema Renderer

function renderMySQLSchema(data: unknown, tableName: string): string {
  // UUID regex pattern
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function getMySQLType(value: unknown): string {
    if (value === null) return 'VARCHAR(255)';

    switch (typeof value) {
      case 'string':
        // Check for UUID pattern
        if (UUID_REGEX.test(value as string)) {
          return 'CHAR(36)';
        }
        // Check for datetime patterns
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value as string)) {
          return 'DATETIME';
        }
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value as string)) {
          return 'DATETIME';
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(value as string)) {
          return 'DATE';
        }
        const len = (value as string).length;
        if (len > 65535) return 'LONGTEXT';
        if (len > 255) return 'TEXT';
        return `VARCHAR(${Math.max(255, Math.ceil(len / 50) * 50)})`;
      case 'number':
        if (Number.isInteger(value)) {
          if (value > 2147483647 || value < -2147483648) return 'BIGINT';
          return 'INT';
        }
        return 'DOUBLE';
      case 'boolean':
        return 'TINYINT(1)';
      case 'object':
        if (Array.isArray(value)) return 'JSON';
        return 'JSON';
      default:
        return 'VARCHAR(255)';
    }
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return `-- Empty array, cannot infer schema`;
    data = data[0];
  }

  if (typeof data !== 'object' || data === null) {
    return `-- Cannot generate table from primitive value`;
  }

  const obj = data as Record<string, unknown>;
  const entries = Object.entries(obj);

  const lines: string[] = [];
  lines.push(`CREATE TABLE \`${tableName}\` (`);

  entries.forEach(([key, value], i) => {
    const mysqlType = getMySQLType(value);
    const isLast = i === entries.length - 1;

    // Make the 'id' field a PRIMARY KEY
    if (key === 'id') {
      lines.push(`  \`${key}\` ${mysqlType} PRIMARY KEY${isLast ? '' : ','}`);
    } else {
      lines.push(`  \`${key}\` ${mysqlType}${isLast ? '' : ','}`);
    }
  });

  lines.push(`) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);

  return lines.join('\n');
}

// Zod Schema Renderer (Custom Implementation)
// Note: json_typegen_wasm v0.7.0 on npm doesn't support Zod yet (added in Feb 2025 but not published)

function generateZodSchema(data: unknown, typeName: string): string {
  const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
  return renderZodSchema(parsedData, typeName);
}

function renderZodSchema(data: unknown, typeName: string): string {
  const generatedSchemas: string[] = [];
  const generatedNames = new Set<string>();
  
  function getZodType(value: unknown, fieldName: string, depth = 0): string {
    if (value === null) return 'z.null()';
    if (value === undefined) return 'z.undefined()';
    
    switch (typeof value) {
      case 'string':
        // Check for format hints
        if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value)) {
          return 'z.string().email()';
        }
        if (/^https?:\/\//.test(value)) {
          return 'z.string().url()';
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return 'z.string().date()';
        }
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          return 'z.string().datetime()';
        }
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          return 'z.string().uuid()';
        }
        return 'z.string()';
      
      case 'number':
        return Number.isInteger(value) ? 'z.number().int()' : 'z.number()';
      
      case 'boolean':
        return 'z.boolean()';
      
      case 'object':
        if (Array.isArray(value)) {
          if (value.length === 0) {
            return 'z.array(z.unknown())';
          }
          const itemType = getZodType(value[0], fieldName, depth);
          return `z.array(${itemType})`;
        }
        
        // Nested object - create a named schema for it
        const nestedSchemaName = toPascalCase(sanitizeIdentifier(fieldName, true)) + 'Schema';
        if (!generatedNames.has(nestedSchemaName)) {
          generateSchema(value as Record<string, unknown>, nestedSchemaName, depth + 1);
        }
        return nestedSchemaName;
      
      default:
        return 'z.unknown()';
    }
  }
  
  function generateSchema(obj: Record<string, unknown>, schemaName: string, depth = 0): void {
    if (generatedNames.has(schemaName)) return;
    generatedNames.add(schemaName);
    
    // First, recursively process any nested objects to generate their schemas
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object') {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
          const nestedName = toPascalCase(sanitizeIdentifier(key, true)) + 'Schema';
          generateSchema(value[0] as Record<string, unknown>, nestedName, depth + 1);
        } else if (!Array.isArray(value)) {
          const nestedName = toPascalCase(sanitizeIdentifier(key, true)) + 'Schema';
          generateSchema(value as Record<string, unknown>, nestedName, depth + 1);
        }
      }
    }
    
    // Generate this schema
    const lines: string[] = [];
    lines.push(`const ${schemaName} = z.object({`);
    
    for (const [key, value] of Object.entries(obj)) {
      const zodType = getZodType(value, key, depth);
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `"${key}"`;
      
      // Make null values optional
      if (value === null) {
        lines.push(`  ${safeKey}: ${zodType}.nullable().optional(),`);
      } else {
        lines.push(`  ${safeKey}: ${zodType},`);
      }
    }
    
    lines.push('});');
    lines.push('');
    
    // Add TypeScript type inference
    const typeName = schemaName.replace(/Schema$/, '');
    lines.push(`type ${typeName} = z.infer<typeof ${schemaName}>;`);
    
    generatedSchemas.push(lines.join('\n'));
  }
  
  // Handle root data
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return `import { z } from 'zod';\n\nconst ${typeName}Schema = z.array(z.unknown());\n\ntype ${typeName} = z.infer<typeof ${typeName}Schema>;`;
    }
    
    if (typeof data[0] === 'object' && data[0] !== null) {
      const itemSchemaName = typeName + 'ItemSchema';
      generateSchema(data[0] as Record<string, unknown>, itemSchemaName, 0);
      
      const out: string[] = [];
      out.push(`import { z } from 'zod';`);
      out.push('');
      
      // Add all generated schemas (nested first)
      out.push(generatedSchemas.join('\n\n'));
      out.push('');
      
      // Add array schema for root
      out.push(`const ${typeName}Schema = z.array(${itemSchemaName});`);
      out.push('');
      out.push(`type ${typeName} = z.infer<typeof ${typeName}Schema>;`);
      
      return out.join('\n');
    }
    
    return `import { z } from 'zod';\n\nconst ${typeName}Schema = z.array(${getZodType(data[0], typeName, 0)});\n\ntype ${typeName} = z.infer<typeof ${typeName}Schema>;`;
  }
  
  if (typeof data === 'object' && data !== null) {
    generateSchema(data as Record<string, unknown>, typeName + 'Schema', 0);
    
    const out: string[] = [];
    out.push(`import { z } from 'zod';`);
    out.push('');
    out.push(generatedSchemas.join('\n\n'));
    
    return out.join('\n');
  }
  
  // Primitive root
  return `import { z } from 'zod';\n\nconst ${typeName}Schema = ${getZodType(data, typeName, 0)};\n\ntype ${typeName} = z.infer<typeof ${typeName}Schema>;`;
}

// Mongoose Schema Renderer (Custom Implementation - no Buffer dependency)

function renderMongooseSchema(data: unknown, typeName: string): string {
  function getMongooseType(value: unknown): string {
    if (value === null) return 'Schema.Types.Mixed';
    
    switch (typeof value) {
      case 'string':
        return 'String';
      case 'number':
        return 'Number';
      case 'boolean':
        return 'Boolean';
      case 'object':
        if (Array.isArray(value)) {
          if (value.length === 0) return '[Schema.Types.Mixed]';
          return `[${getMongooseType(value[0])}]`;
        }
        // Nested object
        return getMongooseSchemaObject(value as Record<string, unknown>);
      default:
        return 'Schema.Types.Mixed';
    }
  }
  
  function getMongooseSchemaObject(obj: Record<string, unknown>): string {
    const fields: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const type = getMongooseType(value);
      if (type.startsWith('{')) {
        fields.push(`    ${key}: ${type}`);
      } else {
        fields.push(`    ${key}: { type: ${type} }`);
      }
    }
    return `{\n${fields.join(',\n')}\n  }`;
  }
  
  if (Array.isArray(data)) {
    if (data.length === 0) return `// Empty array, cannot infer schema`;
    data = data[0];
  }
  
  if (typeof data !== 'object' || data === null) {
    return `// Cannot generate schema from primitive value`;
  }
  
  const schemaName = toPascalCase(typeName) + 'Schema';
  const modelName = toPascalCase(typeName);
  
  const out: string[] = [];
  out.push(`const mongoose = require('mongoose');`);
  out.push(`const { Schema } = mongoose;`);
  out.push('');
  out.push(`const ${schemaName} = new Schema({`);
  
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const type = getMongooseType(value);
    if (type.startsWith('{') || type.startsWith('[')) {
      out.push(`  ${key}: ${type},`);
    } else {
      out.push(`  ${key}: { type: ${type} },`);
    }
  }
  
  out.push('}, { timestamps: true });');
  out.push('');
  out.push(`const ${modelName} = mongoose.model('${modelName}', ${schemaName});`);
  out.push('');
  out.push(`module.exports = ${modelName};`);
  
  return out.join('\n');
}

// GraphQL Schema Renderer (Custom Implementation - no external dependencies)

function renderGraphQLSchema(data: unknown, typeName: string): string {
  const generatedTypes = new Set<string>();
  const out: string[] = [];
  
  function getGraphQLType(value: unknown, fieldName: string, isRequired = false): string {
    const suffix = isRequired ? '!' : '';
    
    if (value === null) return `String${suffix}`;
    
    switch (typeof value) {
      case 'string':
        return `String${suffix}`;
      case 'number':
        return Number.isInteger(value) ? `Int${suffix}` : `Float${suffix}`;
      case 'boolean':
        return `Boolean${suffix}`;
      case 'object':
        if (Array.isArray(value)) {
          if (value.length === 0) return `[String]${suffix}`;
          const itemType = getGraphQLType(value[0], fieldName, false);
          return `[${itemType}]${suffix}`;
        }
        // Create a new type for nested objects
        const nestedTypeName = toPascalCase(sanitizeIdentifier(fieldName, true));
        generateType(value as Record<string, unknown>, nestedTypeName);
        return `${nestedTypeName}${suffix}`;
      default:
        return `String${suffix}`;
    }
  }
  
  function generateType(obj: Record<string, unknown>, name: string): void {
    if (generatedTypes.has(name)) return;
    generatedTypes.add(name);
    
    // First, generate any nested types
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && typeof value === 'object') {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
          generateType(value[0] as Record<string, unknown>, toPascalCase(sanitizeIdentifier(key, true)));
        } else if (!Array.isArray(value)) {
          generateType(value as Record<string, unknown>, toPascalCase(sanitizeIdentifier(key, true)));
        }
      }
    }
    
    // Then generate this type
    const fields: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      const graphqlType = getGraphQLType(value, key, value !== null);
      fields.push(`  ${toCamelCase(key)}: ${graphqlType}`);
    }
    
    out.push(`type ${name} {`);
    out.push(fields.join('\n'));
    out.push('}');
    out.push('');
  }
  
  if (Array.isArray(data)) {
    if (data.length === 0) {
      out.push(`type ${typeName} {`);
      out.push('  id: ID!');
      out.push('}');
    } else if (typeof data[0] === 'object' && data[0] !== null) {
      generateType(data[0] as Record<string, unknown>, typeName);
    }
  } else if (typeof data === 'object' && data !== null) {
    generateType(data as Record<string, unknown>, typeName);
  } else {
    out.push(`scalar ${typeName}`);
  }
  
  // Add Query type
  out.push('type Query {');
  out.push(`  get${typeName}(id: ID!): ${typeName}`);
  out.push(`  list${typeName}s: [${typeName}!]!`);
  out.push('}');
  
  return out.join('\n');
}

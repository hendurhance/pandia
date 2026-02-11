/*
	JSON-to-Go
	by Matt Holt

	https://github.com/mholt/json-to-go

	A simple utility to translate JSON into a Go type definition.
	Converted to TypeScript for use in this project.
*/

import { formatError } from '../utils/error';

export interface JsonToGoResult {
  go: string;
  error?: string;
}

export interface JsonToGoOptions {
  typename?: string;
  flatten?: boolean;
  example?: boolean;
  allOmitempty?: boolean;
}

export function jsonToGo(
  json: string,
  options: JsonToGoOptions = {}
): JsonToGoResult {
  const {
    typename: inputTypename,
    flatten = true,
    example = false,
    allOmitempty = false
  } = options;

  let data: unknown;
  let scope: unknown;
  let go = "";
  let tabs = 0;

  const seen: Record<string, string[]> = {};
  const stack: string[] = [];
  let accumulator = "";
  let innerTabs = 0;
  let parent = "";

  try {
    // hack that forces floats to stay as floats
    data = JSON.parse(json.replace(/(:\s*\[?\s*-?\d*)\.0/g, "$1.1"));
    scope = data;
  } catch (e) {
    return {
      go: "",
      error: formatError(e, 'Failed to parse JSON'),
    };
  }

  const typename = format(inputTypename || "Root");
  append(`type ${typename} `);

  parseScope(scope);

  return {
    go: flatten ? (go += accumulator) : go,
  };

  function parseScope(scope: unknown, depth = 0): void {
    if (typeof scope === "object" && scope !== null) {
      if (Array.isArray(scope)) {
        let sliceType: string | undefined;
        const scopeLength = scope.length;

        for (let i = 0; i < scopeLength; i++) {
          const thisType = goType(scope[i]);
          if (!sliceType) sliceType = thisType;
          else if (sliceType !== thisType) {
            sliceType = mostSpecificPossibleGoType(thisType, sliceType);
            if (sliceType === "any") break;
          }
        }

        const slice =
          flatten && ["struct", "slice"].includes(sliceType || "")
            ? `[]${parent}`
            : "[]";

        if (flatten && depth >= 2) appender(slice);
        else append(slice);

        if (sliceType === "struct") {
          const allFields: Record<string, { value: unknown; count: number }> = {};

          // for each field counts how many times appears
          for (let i = 0; i < scopeLength; i++) {
            const item = scope[i] as Record<string, unknown>;
            const keys = Object.keys(item);
            for (const k in keys) {
              let keyname = keys[k];
              if (!(keyname in allFields)) {
                allFields[keyname] = {
                  value: item[keyname],
                  count: 0,
                };
              } else {
                const existingValue = allFields[keyname].value;
                const currentValue = item[keyname];

                if (compareObjects(existingValue, currentValue)) {
                  const comparisonResult = compareObjectKeys(
                    Object.keys(currentValue as Record<string, unknown>),
                    Object.keys(existingValue as Record<string, unknown>)
                  );
                  if (!comparisonResult) {
                    keyname = `${keyname}_${uuidv4()}`;
                    allFields[keyname] = {
                      value: currentValue,
                      count: 0,
                    };
                  }
                }
              }
              allFields[keyname].count++;
            }
          }

          // create a common struct with all fields found in the current array
          // omitempty dict indicates if a field is optional
          const keys = Object.keys(allFields);
          const struct: Record<string, unknown> = {};
          const omitempty: Record<string, boolean> = {};
          
          for (const k in keys) {
            const keyname = keys[k];
            const elem = allFields[keyname];
            struct[keyname] = elem.value;
            omitempty[keyname] = elem.count !== scopeLength;
          }
          parseStruct(depth + 1, innerTabs, struct, omitempty);
        } else if (sliceType === "slice") {
          parseScope(scope[0], depth);
        } else {
          if (flatten && depth >= 2) {
            appender(sliceType || "any");
          } else {
            append(sliceType || "any");
          }
        }
      } else {
        if (flatten) {
          if (depth >= 2) {
            appender(parent);
          } else {
            append(parent);
          }
        }
        parseStruct(depth + 1, innerTabs, scope as Record<string, unknown>);
      }
    } else {
      if (flatten && depth >= 2) {
        appender(goType(scope));
      } else {
        append(goType(scope));
      }
    }
  }

  function parseStruct(
    depth: number,
    innerTabsLocal: number,
    scope: Record<string, unknown>,
    omitempty?: Record<string, boolean>
  ): void {
    if (flatten) {
      stack.push(depth >= 2 ? "\n" : "");
    }

    const seenTypeNames: string[] = [];

    if (flatten && depth >= 2) {
      const parentType = `type ${parent}`;
      const scopeKeys = formatScopeKeys(Object.keys(scope));

      // this can only handle two duplicate items
      if (parent in seen && compareObjectKeys(scopeKeys, seen[parent])) {
        stack.pop();
        return;
      }
      seen[parent] = scopeKeys;

      appender(`${parentType} struct {\n`);
      ++innerTabsLocal;
      const keys = Object.keys(scope);
      for (const i in keys) {
        const keyname = getOriginalName(keys[i]);
        indenter(innerTabsLocal);
        const tn = uniqueTypeName(format(keyname), seenTypeNames);
        seenTypeNames.push(tn);

        appender(tn + " ");
        parent = tn;
        parseScope(scope[keys[i]], depth);
        appender(' `json:"' + keyname);
        if (allOmitempty || (omitempty && omitempty[keys[i]] === true)) {
          appender(",omitempty");
        }
        appender('"`\n');
      }
      indenter(--innerTabsLocal);
      appender("}");
    } else {
      append("struct {\n");
      ++tabs;
      const keys = Object.keys(scope);
      for (const i in keys) {
        const keyname = getOriginalName(keys[i]);
        indent(tabs);
        const tn = uniqueTypeName(format(keyname), seenTypeNames);
        seenTypeNames.push(tn);
        append(tn + " ");
        parent = tn;
        parseScope(scope[keys[i]], depth);
        append(' `json:"' + keyname);
        if (allOmitempty || (omitempty && omitempty[keys[i]] === true)) {
          append(",omitempty");
        }
        if (
          example &&
          scope[keys[i]] !== "" &&
          typeof scope[keys[i]] !== "object"
        ) {
          append('" example:"' + scope[keys[i]]);
        }
        append('"`\n');
      }
      indent(--tabs);
      append("}");
    }
    if (flatten) accumulator += stack.pop();
  }

  function indent(t: number): void {
    for (let i = 0; i < t; i++) go += "\t";
  }

  function append(str: string): void {
    go += str;
  }

  function indenter(t: number): void {
    for (let i = 0; i < t; i++) stack[stack.length - 1] += "\t";
  }

  function appender(str: string): void {
    stack[stack.length - 1] += str;
  }

  function uniqueTypeName(name: string, seenNames: string[]): string {
    if (seenNames.indexOf(name) === -1) {
      return name;
    }

    let i = 0;
    while (true) {
      const newName = name + i.toString();
      if (seenNames.indexOf(newName) === -1) {
        return newName;
      }
      i++;
    }
  }

  function format(str: string): string {
    str = formatNumber(str);

    const sanitized = toProperCase(str).replace(/[^a-z0-9]/gi, "");
    if (!sanitized) {
      return "NAMING_FAILED";
    }

    return formatNumber(sanitized);
  }

  function formatNumber(str: string): string {
    if (!str) return "";
    else if (str.match(/^\d+$/)) str = "Num" + str;
    else if (str.charAt(0).match(/\d/)) {
      const numbers: Record<string, string> = {
        "0": "Zero_",
        "1": "One_",
        "2": "Two_",
        "3": "Three_",
        "4": "Four_",
        "5": "Five_",
        "6": "Six_",
        "7": "Seven_",
        "8": "Eight_",
        "9": "Nine_",
      };
      str = numbers[str.charAt(0)] + str.substr(1);
    }

    return str;
  }

  function goType(val: unknown): string {
    if (val === null) return "any";

    switch (typeof val) {
      case "string":
        if (
          /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?(\+\d\d:\d\d|Z)/.test(
            val as string
          )
        )
          return "time.Time";
        else return "string";
      case "number":
        if ((val as number) % 1 === 0) {
          if ((val as number) > -2147483648 && (val as number) < 2147483647)
            return "int";
          else return "int64";
        } else return "float64";
      case "boolean":
        return "bool";
      case "object":
        if (Array.isArray(val)) return "slice";
        return "struct";
      default:
        return "any";
    }
  }

  function mostSpecificPossibleGoType(typ1: string, typ2: string): string {
    if (typ1.substr(0, 5) === "float" && typ2.substr(0, 3) === "int")
      return typ1;
    else if (typ1.substr(0, 3) === "int" && typ2.substr(0, 5) === "float")
      return typ2;
    else return "any";
  }

  function toProperCase(str: string): string {
    // ensure that the SCREAMING_SNAKE_CASE is converted to snake_case
    if (str.match(/^[_A-Z0-9]+$/)) {
      str = str.toLowerCase();
    }

    const commonInitialisms = [
      "ACL", "API", "ASCII", "CPU", "CSS", "DNS", "EOF", "GUID", "HTML",
      "HTTP", "HTTPS", "ID", "IP", "JSON", "LHS", "QPS", "RAM", "RHS",
      "RPC", "SLA", "SMTP", "SQL", "SSH", "TCP", "TLS", "TTL", "UDP",
      "UI", "UID", "UUID", "URI", "URL", "UTF8", "VM", "XML", "XMPP",
      "XSRF", "XSS",
    ];

    return str
      .replace(/(^|[^a-zA-Z])([a-z]+)/g, function (unused, sep, frag) {
        if (commonInitialisms.indexOf(frag.toUpperCase()) >= 0)
          return sep + frag.toUpperCase();
        else return sep + frag[0].toUpperCase() + frag.substr(1).toLowerCase();
      })
      .replace(/([A-Z])([a-z]+)/g, function (unused, sep, frag) {
        if (commonInitialisms.indexOf(sep + frag.toUpperCase()) >= 0)
          return (sep + frag).toUpperCase();
        else return sep + frag;
      });
  }

  function uuidv4(): string {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  }

  function getOriginalName(unique: string): string {
    const reLiteralUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const uuidLength = 36;

    if (unique.length >= uuidLength) {
      const tail = unique.substr(-uuidLength);
      if (reLiteralUUID.test(tail)) {
        return unique.slice(0, -1 * (uuidLength + 1));
      }
    }
    return unique;
  }

  function compareObjects(objectA: unknown, objectB: unknown): boolean {
    const object = "[object Object]";
    return (
      Object.prototype.toString.call(objectA) === object &&
      Object.prototype.toString.call(objectB) === object
    );
  }

  function compareObjectKeys(itemAKeys: string[], itemBKeys: string[]): boolean {
    const lengthA = itemAKeys.length;
    const lengthB = itemBKeys.length;

    if (lengthA === 0 && lengthB === 0) return true;
    if (lengthA !== lengthB) return false;

    for (const item of itemAKeys) {
      if (!itemBKeys.includes(item)) return false;
    }
    return true;
  }

  function formatScopeKeys(keys: string[]): string[] {
    for (const i in keys) {
      keys[i] = format(keys[i]);
    }
    return keys;
  }
}

export default jsonToGo;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use std::collections::BTreeMap;
use std::fmt::Write as _;

pub(crate) const ARRAY_SAMPLE_CAP: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum TypegenLang {
    Typescript,
    Rust,
    Go,
    Kotlin,
    #[serde(rename = "json-schema")]
    JsonSchema,
    Python,
    Php,
    Java,
    Zod,
    Dart,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TypeShape {
    Primitive(PrimitiveKind),
    Array(Box<TypeShape>),
    Object(BTreeMap<String, ObjectProp>),
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrimitiveKind {
    Null,
    Bool,
    Integer,
    Unsigned,
    Float,
    String,
    Any,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ObjectProp {
    pub shape: TypeShape,
    pub optional: bool,
}

pub fn infer(value: &Value) -> TypeShape {
    match value {
        Value::Null => TypeShape::Primitive(PrimitiveKind::Null),
        Value::Bool(_) => TypeShape::Primitive(PrimitiveKind::Bool),
        Value::Number(n) => {
            if n.is_i64() {
                TypeShape::Primitive(PrimitiveKind::Integer)
            } else if n.is_u64() {
                TypeShape::Primitive(PrimitiveKind::Unsigned)
            } else {
                TypeShape::Primitive(PrimitiveKind::Float)
            }
        }
        Value::String(_) => TypeShape::Primitive(PrimitiveKind::String),
        Value::Array(items) => {
            if items.is_empty() {
                TypeShape::Array(Box::new(TypeShape::Primitive(PrimitiveKind::Any)))
            } else {
                let limit = items.len().min(ARRAY_SAMPLE_CAP);
                let mut acc = infer(&items[0]);
                for it in items.iter().take(limit).skip(1) {
                    acc = merge(acc, infer(it));
                }
                TypeShape::Array(Box::new(acc))
            }
        }
        Value::Object(map) => {
            let mut props = BTreeMap::new();
            for (k, v) in map {
                props.insert(
                    k.clone(),
                    ObjectProp {
                        shape: infer(v),
                        optional: false,
                    },
                );
            }
            TypeShape::Object(props)
        }
    }
}

pub(crate) fn merge(a: TypeShape, b: TypeShape) -> TypeShape {
    use TypeShape::*;
    match (a, b) {
        (Unknown, x) | (x, Unknown) => x,
        (Primitive(p1), Primitive(p2)) if p1 == p2 => Primitive(p1),
        (Primitive(PrimitiveKind::Integer), Primitive(PrimitiveKind::Unsigned))
        | (Primitive(PrimitiveKind::Unsigned), Primitive(PrimitiveKind::Integer)) => {
            Primitive(PrimitiveKind::Unsigned)
        }
        (
            Primitive(PrimitiveKind::Integer | PrimitiveKind::Unsigned),
            Primitive(PrimitiveKind::Float),
        )
        | (
            Primitive(PrimitiveKind::Float),
            Primitive(PrimitiveKind::Integer | PrimitiveKind::Unsigned),
        ) => Primitive(PrimitiveKind::Float),
        (Primitive(_), Primitive(_)) => Primitive(PrimitiveKind::Any),
        (Array(a1), Array(a2)) => Array(Box::new(merge(*a1, *a2))),
        (Object(p1), Object(p2)) => {
            let mut out: BTreeMap<String, ObjectProp> = BTreeMap::new();
            let mut keys: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
            for k in p1.keys() {
                keys.insert(k.clone());
            }
            for k in p2.keys() {
                keys.insert(k.clone());
            }
            for k in keys {
                let a = p1.get(&k);
                let b = p2.get(&k);
                match (a, b) {
                    (Some(a), Some(b)) => {
                        out.insert(
                            k,
                            ObjectProp {
                                shape: merge(a.shape.clone(), b.shape.clone()),
                                optional: a.optional || b.optional,
                            },
                        );
                    }
                    (Some(only), None) | (None, Some(only)) => {
                        out.insert(
                            k,
                            ObjectProp {
                                shape: only.shape.clone(),
                                optional: true,
                            },
                        );
                    }
                    (None, None) => continue,
                }
            }
            Object(out)
        }
        _ => Primitive(PrimitiveKind::Any),
    }
}

fn type_ident(type_name: &str) -> String {
    let name = sanitize_ident(type_name, true);
    if name.is_empty() {
        "Root".to_string()
    } else {
        name
    }
}

pub fn generate(value: &Value, lang: TypegenLang, type_name: &str) -> String {
    if let TypegenLang::JsonSchema = lang {
        return render_json_schema(value, &type_ident(type_name));
    }
    generate_from_shape(&infer(value), lang, type_name)
}

pub fn generate_from_shape(shape: &TypeShape, lang: TypegenLang, type_name: &str) -> String {
    let name = type_ident(type_name);
    match lang {
        TypegenLang::Typescript => render_typescript(shape, &name),
        TypegenLang::Rust => render_rust(shape, &name),
        TypegenLang::Go => render_go(shape, &name),
        TypegenLang::Kotlin => render_kotlin(shape, &name),
        TypegenLang::Python => render_python(shape, &name),
        TypegenLang::Php => render_php(shape, &name),
        TypegenLang::Java => render_java(shape, &name),
        TypegenLang::Zod => render_zod(shape, &name),
        TypegenLang::Dart => render_dart(shape, &name),
        TypegenLang::JsonSchema => {
            "{ \"$schema\": \"http://json-schema.org/draft-07/schema#\" }".to_string()
        }
    }
}

fn sanitize_ident(name: &str, capitalize: bool) -> String {
    let cleaned: String = if name.chars().all(|c| c.is_ascii_digit()) {
        format!("Item{name}")
    } else {
        let mut s: String = name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        if s.chars()
            .next()
            .map(|c| c.is_ascii_digit())
            .unwrap_or(false)
        {
            s.insert(0, '_');
        }
        s
    };
    if capitalize {
        capitalize_first(&cleaned)
    } else {
        cleaned
    }
}

fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

fn to_camel_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut upper = false;
    for c in s.chars() {
        if c == '-' || c == '_' {
            upper = true;
            continue;
        }
        if upper {
            out.extend(c.to_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    out
}

fn to_pascal_case(s: &str) -> String {
    capitalize_first(&to_camel_case(s))
}

fn snake_case(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 4);
    for (i, c) in s.chars().enumerate() {
        if c.is_uppercase() && i > 0 {
            out.push('_');
        }
        for lc in c.to_lowercase() {
            out.push(lc);
        }
    }
    out
}

fn camel_ident(key: &str) -> String {
    let name = to_camel_case(&sanitize_ident(key, false));
    if name.starts_with(|c: char| c.is_ascii_digit()) {
        format!("x{name}")
    } else {
        name
    }
}

fn unique_name(
    base: &str,
    fallback: &str,
    taken: &mut std::collections::BTreeSet<String>,
    key: fn(&str) -> String,
) -> String {
    let usable = base.chars().any(|c| c.is_ascii_alphanumeric());
    let stem = if usable { base } else { fallback };
    let name = (1..)
        .map(|n| match n {
            1 if usable => base.to_string(),
            n => format!("{stem}{n}"),
        })
        .find(|name| !taken.contains(&key(name)))
        .expect("the candidate space is unbounded");
    taken.insert(key(&name));
    name
}

fn claim_type_name<'a>(
    names: &mut BTreeMap<String, &'a TypeShape>,
    shape: &'a TypeShape,
    base: String,
    parent: &str,
    reserved: impl Fn(&str) -> bool,
) -> (String, bool) {
    let qualified = format!("{parent}{base}");
    let name = [base, qualified.clone()]
        .into_iter()
        .chain((2..).map(|n| format!("{qualified}{n}")))
        .find(|n| !reserved(n) && names.get(n).is_none_or(|&s| s == shape))
        .expect("the candidate space is unbounded");
    let fresh = names.insert(name.clone(), shape).is_none();
    (name, fresh)
}

fn render_typescript(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: BTreeMap<String, &TypeShape> = BTreeMap::new();
    let _ = ts_type(shape, name, "", &mut classes, &mut seen);
    let mut out = String::new();
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn ts_type<'a>(
    shape: &'a TypeShape,
    name: &str,
    parent: &str,
    classes: &mut Vec<String>,
    seen: &mut BTreeMap<String, &'a TypeShape>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => ts_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = ts_type(inner, &item_name, parent, classes, seen);
            format!("{inner_ty}[]")
        }
        TypeShape::Object(props) => {
            let (class_name, fresh) =
                claim_type_name(seen, shape, sanitize_ident(name, true), parent, |_| false);
            if fresh {
                let mut body = format!("export interface {class_name} {{\n");
                for (k, v) in props {
                    let prop_name = ts_prop_name(k);
                    let ty = ts_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        &class_name,
                        classes,
                        seen,
                    );
                    let q = if v.optional { "?" } else { "" };
                    let _ = writeln!(body, "  {prop_name}{q}: {ty};");
                }
                body.push('}');
                classes.push(body);
            }
            class_name
        }
        TypeShape::Unknown => "unknown".to_string(),
    }
}

fn ts_primitive(p: PrimitiveKind) -> &'static str {
    match p {
        PrimitiveKind::Null => "null",
        PrimitiveKind::Bool => "boolean",
        PrimitiveKind::Integer | PrimitiveKind::Unsigned | PrimitiveKind::Float => "number",
        PrimitiveKind::String => "string",
        PrimitiveKind::Any => "unknown",
    }
}

fn ts_prop_name(k: &str) -> String {
    if k.is_empty()
        || k.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(true)
        || !k
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
    {
        serde_json::to_string(k).unwrap_or_default()
    } else {
        k.to_string()
    }
}

const RUST_KEYWORDS: &[&str] = &[
    "Self", "abstract", "as", "async", "await", "become", "box", "break", "const", "continue",
    "crate", "do", "dyn", "else", "enum", "extern", "false", "final", "fn", "for", "gen", "if",
    "impl", "in", "let", "loop", "macro", "match", "mod", "move", "mut", "override", "priv", "pub",
    "ref", "return", "self", "static", "struct", "super", "trait", "true", "try", "type", "typeof",
    "unsafe", "unsized", "use", "virtual", "where", "while", "yield",
];

const RUST_TYPES: &[&str] = &["Deserialize", "Option", "Serialize", "String", "Vec"];

fn render_rust(shape: &TypeShape, name: &str) -> String {
    let mut structs: Vec<String> = Vec::new();
    let mut seen: BTreeMap<String, &TypeShape> = BTreeMap::new();
    let _ = rust_type(shape, name, "", &mut structs, &mut seen);
    let mut out = String::from("use serde::{Deserialize, Serialize};\n\n");
    for s in structs {
        out.push_str(&s);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn rust_type<'a>(
    shape: &'a TypeShape,
    name: &str,
    parent: &str,
    structs: &mut Vec<String>,
    seen: &mut BTreeMap<String, &'a TypeShape>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => rust_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = rust_type(inner, &item_name, parent, structs, seen);
            format!("Vec<{inner_ty}>")
        }
        TypeShape::Object(props) => {
            let (struct_name, fresh) =
                claim_type_name(seen, shape, sanitize_ident(name, true), parent, |n| {
                    RUST_KEYWORDS.contains(&n) || RUST_TYPES.contains(&n)
                });
            if fresh {
                let mut body = String::new();
                body.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
                let _ = writeln!(body, "pub struct {struct_name} {{");
                let mut taken = std::collections::BTreeSet::new();
                for (k, v) in props {
                    let base = snake_case(&sanitize_ident(k, false));

                    let base = if matches!(base.as_str(), "self" | "super" | "crate") {
                        format!("{base}_")
                    } else {
                        base
                    };
                    let name = unique_name(&base, "field", &mut taken, str::to_string);

                    let rename = if name != *k {
                        format!("    #[serde(rename = {k:?})]\n")
                    } else {
                        String::new()
                    };
                    let field = if RUST_KEYWORDS.contains(&name.as_str()) {
                        format!("r#{name}")
                    } else {
                        name
                    };
                    let ty = rust_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        &struct_name,
                        structs,
                        seen,
                    );
                    let ty = if v.optional {
                        format!("Option<{ty}>")
                    } else {
                        ty
                    };
                    body.push_str(&rename);
                    let _ = writeln!(body, "    pub {field}: {ty},");
                }
                body.push('}');
                structs.push(body);
            }
            struct_name
        }
        TypeShape::Unknown => "serde_json::Value".to_string(),
    }
}

fn rust_primitive(p: PrimitiveKind) -> &'static str {
    match p {
        PrimitiveKind::Null => "Option<serde_json::Value>",
        PrimitiveKind::Bool => "bool",
        PrimitiveKind::Integer => "i64",
        PrimitiveKind::Unsigned => "u64",
        PrimitiveKind::Float => "f64",
        PrimitiveKind::String => "String",
        PrimitiveKind::Any => "serde_json::Value",
    }
}

static GO_TAG_NAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[\p{L}\p{Nd}!#$%&()*+\-./:;<=>?@\[\]^_{|}~ ]+$").unwrap());

fn render_go(shape: &TypeShape, name: &str) -> String {
    let mut structs: Vec<String> = Vec::new();
    let mut seen: BTreeMap<String, &TypeShape> = BTreeMap::new();
    let _ = go_type(shape, name, "", &mut structs, &mut seen);
    let mut out = String::from("package types\n\n");
    for s in structs {
        out.push_str(&s);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn go_type<'a>(
    shape: &'a TypeShape,
    name: &str,
    parent: &str,
    structs: &mut Vec<String>,
    seen: &mut BTreeMap<String, &'a TypeShape>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => go_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = go_type(inner, &item_name, parent, structs, seen);
            format!("[]{inner_ty}")
        }
        TypeShape::Object(props) => {
            let (struct_name, fresh) =
                claim_type_name(seen, shape, sanitize_ident(name, true), parent, |_| false);
            if fresh {
                let mut body = format!("type {struct_name} struct {{\n");
                let mut taken = std::collections::BTreeSet::new();
                for (k, v) in props {
                    let field = unique_name(
                        &capitalize_first(&camel_ident(k)),
                        "Field",
                        &mut taken,
                        str::to_string,
                    );
                    let ty = go_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        &struct_name,
                        structs,
                        seen,
                    );
                    let ty = if v.optional { format!("*{ty}") } else { ty };

                    let options = if v.optional {
                        ",omitempty"
                    } else if k == "-" {
                        ","
                    } else {
                        ""
                    };
                    let tag = if GO_TAG_NAME.is_match(k) {
                        format!("`json:\"{k}{options}\"`")
                    } else {
                        let _ = writeln!(body, "    // JSON key {k:?} can't be named in a Go struct tag, so it won't decode into this field.");
                        "`json:\"-\"`".to_string()
                    };
                    let _ = writeln!(body, "    {field} {ty} {tag}");
                }
                body.push('}');
                structs.push(body);
            }
            struct_name
        }
        TypeShape::Unknown => "interface{}".to_string(),
    }
}

fn go_primitive(p: PrimitiveKind) -> &'static str {
    match p {
        PrimitiveKind::Null => "interface{}",
        PrimitiveKind::Bool => "bool",
        PrimitiveKind::Integer => "int64",
        PrimitiveKind::Unsigned => "uint64",
        PrimitiveKind::Float => "float64",
        PrimitiveKind::String => "string",
        PrimitiveKind::Any => "interface{}",
    }
}

const KOTLIN_KEYWORDS: &[&str] = &[
    "as",
    "break",
    "class",
    "continue",
    "do",
    "else",
    "false",
    "for",
    "fun",
    "if",
    "in",
    "interface",
    "is",
    "null",
    "object",
    "package",
    "return",
    "super",
    "this",
    "throw",
    "true",
    "try",
    "typealias",
    "typeof",
    "val",
    "var",
    "when",
    "while",
];

const KOTLIN_TYPES: &[&str] = &["Any", "Boolean", "Double", "List", "Long", "String"];

fn render_kotlin(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: BTreeMap<String, &TypeShape> = BTreeMap::new();
    let _ = kotlin_type(shape, name, "", &mut classes, &mut seen);
    let mut out = String::new();
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn kotlin_type<'a>(
    shape: &'a TypeShape,
    name: &str,
    parent: &str,
    classes: &mut Vec<String>,
    seen: &mut BTreeMap<String, &'a TypeShape>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => kotlin_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = kotlin_type(inner, &item_name, parent, classes, seen);
            format!("List<{inner_ty}>")
        }
        TypeShape::Object(props) => {
            let (class_name, fresh) =
                claim_type_name(seen, shape, sanitize_ident(name, true), parent, |n| {
                    KOTLIN_TYPES.contains(&n)
                });
            if fresh {
                let mut body = format!("data class {class_name}(\n");
                let entries: Vec<_> = props.iter().collect();
                let mut taken = std::collections::BTreeSet::new();
                for (i, (k, v)) in entries.iter().enumerate() {
                    let prop_name =
                        unique_name(&camel_ident(k), "field", &mut taken, capitalize_first);
                    let prop_name = if KOTLIN_KEYWORDS.contains(&prop_name.as_str()) {
                        format!("`{prop_name}`")
                    } else {
                        prop_name
                    };
                    let ty = kotlin_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        &class_name,
                        classes,
                        seen,
                    );
                    let ty = if v.optional { format!("{ty}?") } else { ty };
                    let comma = if i + 1 < entries.len() { "," } else { "" };
                    let _ = writeln!(body, "    val {prop_name}: {ty}{comma}");
                }
                body.push(')');
                classes.push(body);
            }
            class_name
        }
        TypeShape::Unknown => "Any".to_string(),
    }
}

fn kotlin_primitive(p: PrimitiveKind) -> &'static str {
    match p {
        PrimitiveKind::Null => "Any?",
        PrimitiveKind::Bool => "Boolean",
        PrimitiveKind::Integer | PrimitiveKind::Unsigned => "Long",
        PrimitiveKind::Float => "Double",
        PrimitiveKind::String => "String",
        PrimitiveKind::Any => "Any",
    }
}

const PYTHON_KEYWORDS: &[&str] = &[
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import",
    "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
    "with", "yield",
];

const PYTHON_TYPES: &[&str] = &["Any", "Optional"];

fn render_python(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: BTreeMap<String, &TypeShape> = BTreeMap::new();
    let _ = python_type(shape, name, "", &mut classes, &mut seen);
    let mut out = String::from("from __future__ import annotations\n");
    out.push_str("from dataclasses import dataclass\n");
    out.push_str("from typing import Any, Optional\n\n\n");
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n\n");
    }
    out.trim_end().to_string()
}

fn python_type<'a>(
    shape: &'a TypeShape,
    name: &str,
    parent: &str,
    classes: &mut Vec<String>,
    seen: &mut BTreeMap<String, &'a TypeShape>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => python_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = python_type(inner, &item_name, parent, classes, seen);
            format!("list[{inner_ty}]")
        }
        TypeShape::Object(props) => {
            let (class_name, fresh) =
                claim_type_name(seen, shape, sanitize_ident(name, true), parent, |n| {
                    PYTHON_KEYWORDS.contains(&n) || PYTHON_TYPES.contains(&n)
                });
            if fresh {
                let mut body = format!("@dataclass\nclass {class_name}:\n");
                if props.is_empty() {
                    body.push_str("    pass");
                } else {
                    let mut entries: Vec<_> = props.iter().collect();
                    entries.sort_by_key(|(_, v)| v.optional);
                    let mut taken = std::collections::BTreeSet::new();
                    for (k, v) in entries {
                        let base = snake_case(&sanitize_ident(k, false));
                        let base = if PYTHON_KEYWORDS.contains(&base.as_str()) {
                            format!("{base}_")
                        } else {
                            base
                        };
                        let field = unique_name(&base, "field", &mut taken, str::to_string);
                        let ty = python_type(
                            &v.shape,
                            &to_pascal_case(&sanitize_ident(k, true)),
                            &class_name,
                            classes,
                            seen,
                        );
                        let ty = if v.optional {
                            format!("Optional[{ty}] = None")
                        } else {
                            ty
                        };
                        let _ = writeln!(body, "    {field}: {ty}");
                    }
                    body = body.trim_end().to_string();
                }
                classes.push(body);
            }
            class_name
        }
        TypeShape::Unknown => "Any".to_string(),
    }
}

fn python_primitive(p: PrimitiveKind) -> &'static str {
    match p {
        PrimitiveKind::Null => "Optional[Any]",
        PrimitiveKind::Bool => "bool",
        PrimitiveKind::Integer | PrimitiveKind::Unsigned => "int",
        PrimitiveKind::Float => "float",
        PrimitiveKind::String => "str",
        PrimitiveKind::Any => "Any",
    }
}

const PHP_RESERVED: &[&str] = &[
    "abstract",
    "and",
    "array",
    "as",
    "bool",
    "break",
    "callable",
    "case",
    "catch",
    "class",
    "clone",
    "const",
    "continue",
    "declare",
    "default",
    "die",
    "do",
    "echo",
    "else",
    "elseif",
    "empty",
    "enddeclare",
    "endfor",
    "endforeach",
    "endif",
    "endswitch",
    "endwhile",
    "eval",
    "exit",
    "extends",
    "false",
    "final",
    "finally",
    "float",
    "fn",
    "for",
    "foreach",
    "function",
    "global",
    "goto",
    "if",
    "implements",
    "include",
    "include_once",
    "instanceof",
    "insteadof",
    "int",
    "interface",
    "isset",
    "iterable",
    "list",
    "match",
    "mixed",
    "namespace",
    "never",
    "new",
    "null",
    "object",
    "or",
    "parent",
    "print",
    "private",
    "protected",
    "public",
    "readonly",
    "require",
    "require_once",
    "return",
    "self",
    "static",
    "string",
    "switch",
    "throw",
    "trait",
    "true",
    "try",
    "unset",
    "use",
    "var",
    "void",
    "while",
    "xor",
    "yield",
];

fn render_php(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: BTreeMap<String, &TypeShape> = BTreeMap::new();
    let _ = php_type(shape, name, "", &mut classes, &mut seen);
    let mut out = String::from("<?php\n\ndeclare(strict_types=1);\n\n");
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn php_type<'a>(
    shape: &'a TypeShape,
    name: &str,
    parent: &str,
    classes: &mut Vec<String>,
    seen: &mut BTreeMap<String, &'a TypeShape>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => php_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let _ = php_type(inner, &item_name, parent, classes, seen);
            "array".to_string()
        }
        TypeShape::Object(props) => {
            let (class_name, fresh) =
                claim_type_name(seen, shape, sanitize_ident(name, true), parent, |n| {
                    PHP_RESERVED.contains(&n.to_ascii_lowercase().as_str())
                });
            if fresh {
                let mut body = format!("final readonly class {class_name}\n{{\n");
                body.push_str("    public function __construct(\n");

                let mut entries: Vec<_> = props.iter().collect();
                entries.sort_by_key(|(_, v)| v.optional);
                let mut taken = std::collections::BTreeSet::new();
                for (i, (k, v)) in entries.iter().enumerate() {
                    let prop_name = to_camel_case(&sanitize_ident(k, false));
                    let prop_name = if prop_name
                        .chars()
                        .next()
                        .map(|c| c.is_ascii_digit())
                        .unwrap_or(false)
                    {
                        format!("item{prop_name}")
                    } else {
                        prop_name
                    };
                    let prop_name = if matches!(prop_name.as_str(), "this" | "GLOBALS") {
                        format!("{prop_name}_")
                    } else {
                        prop_name
                    };
                    let prop_name = unique_name(&prop_name, "field", &mut taken, str::to_string);
                    let ty = php_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        &class_name,
                        classes,
                        seen,
                    );
                    let ty = if v.optional && ty != "mixed" {
                        format!("?{ty}")
                    } else {
                        ty
                    };
                    let default = if v.optional { " = null" } else { "" };
                    let comma = if i + 1 < entries.len() { "," } else { "" };
                    let _ = writeln!(body, "        public {ty} ${prop_name}{default}{comma}");
                }
                body.push_str("    ) {}\n}");
                classes.push(body);
            }
            class_name
        }
        TypeShape::Unknown => "mixed".to_string(),
    }
}

fn php_primitive(p: PrimitiveKind) -> &'static str {
    match p {
        PrimitiveKind::Null => "mixed",
        PrimitiveKind::Bool => "bool",
        PrimitiveKind::Integer | PrimitiveKind::Unsigned => "int",
        PrimitiveKind::Float => "float",
        PrimitiveKind::String => "string",
        PrimitiveKind::Any => "mixed",
    }
}

const JAVA_KEYWORDS: &[&str] = &[
    "abstract",
    "assert",
    "boolean",
    "break",
    "byte",
    "case",
    "catch",
    "char",
    "class",
    "const",
    "continue",
    "default",
    "do",
    "double",
    "else",
    "enum",
    "extends",
    "false",
    "final",
    "finally",
    "float",
    "for",
    "goto",
    "if",
    "implements",
    "import",
    "instanceof",
    "int",
    "interface",
    "long",
    "native",
    "new",
    "null",
    "package",
    "private",
    "protected",
    "public",
    "return",
    "short",
    "static",
    "strictfp",
    "super",
    "switch",
    "synchronized",
    "this",
    "throw",
    "throws",
    "transient",
    "true",
    "try",
    "void",
    "volatile",
    "while",
];

const JAVA_TYPES: &[&str] = &[
    "BigInteger",
    "Boolean",
    "Double",
    "List",
    "Long",
    "Object",
    "String",
];

fn render_java(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: BTreeMap<String, &TypeShape> = BTreeMap::new();
    let _ = java_type(shape, name, "", &mut classes, &mut seen, true);
    let Some(outer) = classes.pop() else {
        return String::new();
    };
    let mut body = outer.strip_suffix('}').unwrap_or(&outer).to_string();
    for class in classes {
        body.push('\n');
        for line in class
            .replacen("public class", "public static class", 1)
            .lines()
        {
            if !line.is_empty() {
                body.push_str("    ");
                body.push_str(line);
            }
            body.push('\n');
        }
    }
    body.push('}');

    let mut out = String::new();
    for (used, import) in [
        ("BigInteger", "java.math.BigInteger"),
        ("List<", "java.util.List"),
    ] {
        if body.contains(used) {
            let _ = writeln!(out, "import {import};");
        }
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(&body);
    out
}

fn java_type<'a>(
    shape: &'a TypeShape,
    name: &str,
    parent: &str,
    classes: &mut Vec<String>,
    seen: &mut BTreeMap<String, &'a TypeShape>,
    boxed: bool,
) -> String {
    match shape {
        TypeShape::Primitive(p) => java_primitive(*p, boxed).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = java_type(inner, &item_name, parent, classes, seen, true);
            format!("List<{inner_ty}>")
        }
        TypeShape::Object(props) => {
            let (class_name, fresh) =
                claim_type_name(seen, shape, sanitize_ident(name, true), parent, |n| {
                    JAVA_TYPES.contains(&n)
                });
            if fresh {
                let mut body = format!("public class {class_name} {{\n");
                let mut taken = std::collections::BTreeSet::from(["Class".to_string()]);
                let mut fields = Vec::with_capacity(props.len());
                for (k, v) in props {
                    let base = camel_ident(k);
                    let base = if JAVA_KEYWORDS.contains(&base.as_str()) {
                        format!("{base}_")
                    } else {
                        base
                    };
                    // The getter capitalizes the first letter: `Name` and `name` both give getName().
                    let field = unique_name(&base, "field", &mut taken, capitalize_first);
                    let ty = java_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        &class_name,
                        classes,
                        seen,
                        true,
                    );
                    let _ = writeln!(body, "    private {ty} {field};");
                    fields.push((field, ty));
                }
                body.push('\n');
                for (field, ty) in fields {
                    let cap = capitalize_first(&field);
                    let _ = writeln!(
                        body,
                        "    public {ty} get{cap}() {{ return this.{field}; }}"
                    );
                    let _ = writeln!(
                        body,
                        "    public void set{cap}({ty} {field}) {{ this.{field} = {field}; }}"
                    );
                }
                body.push('}');
                classes.push(body);
            }
            class_name
        }
        TypeShape::Unknown => "Object".to_string(),
    }
}

fn java_primitive(p: PrimitiveKind, boxed: bool) -> &'static str {
    match (p, boxed) {
        (PrimitiveKind::Null, _) => "Object",
        (PrimitiveKind::Bool, true) => "Boolean",
        (PrimitiveKind::Bool, false) => "boolean",
        (PrimitiveKind::Integer, true) => "Long",
        (PrimitiveKind::Integer, false) => "long",
        (PrimitiveKind::Unsigned, _) => "BigInteger",
        (PrimitiveKind::Float, true) => "Double",
        (PrimitiveKind::Float, false) => "double",
        (PrimitiveKind::String, _) => "String",
        (PrimitiveKind::Any, _) => "Object",
    }
}

fn render_zod(shape: &TypeShape, name: &str) -> String {
    let mut out = String::from("import { z } from 'zod';\n\n");
    let body = zod_schema(shape, name);
    let _ = writeln!(out, "export const {} = {};", capitalize_first(name), body);
    let _ = write!(
        out,
        "export type {} = z.infer<typeof {}>;",
        capitalize_first(name),
        capitalize_first(name)
    );
    out
}

fn zod_schema(shape: &TypeShape, _name: &str) -> String {
    match shape {
        TypeShape::Primitive(p) => zod_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            format!("z.array({})", zod_schema(inner, "Item"))
        }
        TypeShape::Object(props) => {
            let mut body = String::from("z.object({\n");
            for (k, v) in props {
                let key = ts_prop_name(k);
                let inner = zod_schema(&v.shape, k);
                let inner = if v.optional {
                    format!("{inner}.optional()")
                } else {
                    inner
                };
                let _ = writeln!(body, "  {key}: {inner},");
            }
            body.push_str("})");
            body
        }
        TypeShape::Unknown => "z.unknown()".to_string(),
    }
}

fn zod_primitive(p: PrimitiveKind) -> &'static str {
    match p {
        PrimitiveKind::Null => "z.null()",
        PrimitiveKind::Bool => "z.boolean()",
        PrimitiveKind::Integer | PrimitiveKind::Unsigned => "z.number().int()",
        PrimitiveKind::Float => "z.number()",
        PrimitiveKind::String => "z.string()",
        PrimitiveKind::Any => "z.unknown()",
    }
}

const DART_RESERVED: &[&str] = &[
    "assert", "break", "case", "catch", "class", "const", "continue", "default", "do", "else",
    "enum", "extends", "false", "final", "finally", "for", "if", "in", "is", "new", "null",
    "rethrow", "return", "super", "switch", "this", "throw", "true", "try", "var", "void", "while",
    "with",
];

const DART_MEMBERS: &[&str] = &[
    "toJson",
    "fromJson",
    "hashCode",
    "runtimeType",
    "toString",
    "noSuchMethod",
];

const DART_TYPES: &[&str] = &["List", "Map", "String"];

fn render_dart(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: BTreeMap<String, &TypeShape> = BTreeMap::new();
    let root = dart_type(shape, name, "", &mut classes, &mut seen);
    let mut out = String::new();
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n");
    }

    if !matches!(shape, TypeShape::Object(_)) {
        let _ = writeln!(out, "typedef {} = {root};", dart_class_name(name));
    }
    out.trim_end().to_string()
}

fn dart_type<'a>(
    shape: &'a TypeShape,
    name: &str,
    parent: &str,
    classes: &mut Vec<String>,
    seen: &mut BTreeMap<String, &'a TypeShape>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => dart_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            format!(
                "List<{}>",
                dart_type(inner, &item_name, parent, classes, seen)
            )
        }
        TypeShape::Object(props) => {
            let (class_name, fresh) =
                claim_type_name(seen, shape, dart_class_name(name), parent, |n| {
                    DART_TYPES.contains(&n)
                });
            if fresh {
                let body = dart_class(&class_name, props, classes, seen);
                classes.push(body);
            }
            class_name
        }
        TypeShape::Unknown => "dynamic".to_string(),
    }
}

fn dart_class<'a>(
    class_name: &str,
    props: &'a BTreeMap<String, ObjectProp>,
    classes: &mut Vec<String>,
    seen: &mut BTreeMap<String, &'a TypeShape>,
) -> String {
    let mut taken: Vec<String> = vec![class_name.to_string()];
    let mut fields: Vec<(String, String, String, String, bool)> = Vec::new();
    for (key, prop) in props {
        let field = dart_field_name(key, &taken);
        taken.push(field.clone());
        let hint = to_pascal_case(&sanitize_ident(key, true));
        let ty = dart_type(&prop.shape, &hint, class_name, classes, seen);
        let ty = if prop.optional { format!("{ty}?") } else { ty };
        let src = format!("json[{}]", dart_string_lit(key));
        let from = dart_from_json(&prop.shape, &hint, class_name, &src, prop.optional, seen);
        let to = dart_to_json(&prop.shape, &field, prop.optional);
        fields.push((field, ty, from, to, prop.optional));
    }

    let mut body = format!("class {class_name} {{\n");

    if fields.is_empty() {
        let _ = writeln!(body, "  const {class_name}();\n");
        let _ = writeln!(
            body,
            "  factory {class_name}.fromJson(Map<String, dynamic> json) => const {class_name}();\n"
        );
        let _ = writeln!(
            body,
            "  Map<String, dynamic> toJson() => <String, dynamic>{{}};"
        );
        body.push('}');
        return body;
    }

    let _ = writeln!(body, "  const {class_name}({{");
    for (field, _, _, _, optional) in fields.iter().filter(|f| !f.4) {
        let _ = writeln!(body, "    required this.{field},");
        let _ = optional;
    }
    for (field, _, _, _, _) in fields.iter().filter(|f| f.4) {
        let _ = writeln!(body, "    this.{field},");
    }
    let _ = writeln!(body, "  }});\n");

    let _ = writeln!(
        body,
        "  factory {class_name}.fromJson(Map<String, dynamic> json) => {class_name}("
    );
    for (field, _, from, _, _) in &fields {
        let _ = writeln!(body, "        {field}: {from},");
    }
    let _ = writeln!(body, "      );\n");

    for (field, ty, _, _, _) in &fields {
        let _ = writeln!(body, "  final {ty} {field};");
    }
    body.push('\n');

    let _ = writeln!(body, "  Map<String, dynamic> toJson() => {{");
    for ((key, _), (_, _, _, to, _)) in props.iter().zip(fields.iter()) {
        let _ = writeln!(body, "        {}: {to},", dart_string_lit(key));
    }
    let _ = writeln!(body, "      }};");
    body.push('}');
    body
}

fn dart_primitive(p: PrimitiveKind) -> &'static str {
    match p {
        PrimitiveKind::Null | PrimitiveKind::Any => "dynamic",
        PrimitiveKind::Bool => "bool",
        PrimitiveKind::Integer | PrimitiveKind::Unsigned => "int",
        PrimitiveKind::Float => "double",
        PrimitiveKind::String => "String",
    }
}

fn dart_from_json<'a>(
    shape: &'a TypeShape,
    name: &str,
    parent: &str,
    src: &str,
    optional: bool,
    seen: &mut BTreeMap<String, &'a TypeShape>,
) -> String {
    let q = if optional { "?" } else { "" };
    match shape {
        TypeShape::Primitive(PrimitiveKind::Null | PrimitiveKind::Any) | TypeShape::Unknown => {
            src.to_string()
        }
        TypeShape::Primitive(PrimitiveKind::Float) => {
            if optional {
                format!("({src} as num?)?.toDouble()")
            } else {
                format!("({src} as num).toDouble()")
            }
        }
        TypeShape::Primitive(p) => format!("{src} as {}{q}", dart_primitive(*p)),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let body = match inner.as_ref() {
                TypeShape::Primitive(PrimitiveKind::Null | PrimitiveKind::Any)
                | TypeShape::Unknown => return format!("{src} as List<dynamic>{q}"),
                TypeShape::Primitive(PrimitiveKind::Float)
                | TypeShape::Object(_)
                | TypeShape::Array(_) => {
                    let elem = dart_from_json(inner, &item_name, parent, "e", false, seen);
                    format!("({src} as List<dynamic>).map((e) => {elem}).toList()")
                }
                TypeShape::Primitive(p) => {
                    format!("List<{}>.from({src} as List<dynamic>)", dart_primitive(*p))
                }
            };
            dart_guard_null(src, body, optional)
        }
        TypeShape::Object(_) => {
            let (cls, _) = claim_type_name(seen, shape, dart_class_name(name), parent, |n| {
                DART_TYPES.contains(&n)
            });
            let body = format!("{cls}.fromJson({src} as Map<String, dynamic>)");
            dart_guard_null(src, body, optional)
        }
    }
}

fn dart_guard_null(src: &str, body: String, optional: bool) -> String {
    if optional {
        format!("{src} == null ? null : {body}")
    } else {
        body
    }
}

fn dart_to_json(shape: &TypeShape, field: &str, optional: bool) -> String {
    let q = if optional { "?" } else { "" };
    match shape {
        TypeShape::Object(_) => format!("{field}{q}.toJson()"),
        TypeShape::Array(inner) => {
            let elem = dart_to_json(inner, "e", false);
            if elem == "e" {
                field.to_string()
            } else {
                format!("{field}{q}.map((e) => {elem}).toList()")
            }
        }
        _ => field.to_string(),
    }
}

fn dart_class_name(name: &str) -> String {
    let cleaned = to_pascal_case(&sanitize_ident(name, true));
    let cleaned = cleaned.trim_start_matches('_').to_string();
    let base = if cleaned.is_empty() {
        "Root".to_string()
    } else {
        cleaned
    };
    if DART_RESERVED.contains(&base.as_str()) || base == "Function" {
        format!("{base}_")
    } else {
        base
    }
}

fn dart_field_name(key: &str, taken: &[String]) -> String {
    let leading_underscores = key.len() - key.trim_start_matches('_').len();
    let mut out = String::with_capacity(key.len());
    let mut upper = false;
    for c in key.trim_start_matches('_').chars() {
        if c.is_ascii_alphanumeric() {
            if upper {
                out.extend(c.to_uppercase());
                upper = false;
            } else {
                out.push(c);
            }
        } else if !out.is_empty() {
            upper = true;
        }
    }
    let mut base: String = {
        let mut chars = out.chars();
        match chars.next() {
            Some(c) => c.to_lowercase().chain(chars).collect(),
            None => String::new(),
        }
    };
    for _ in 0..leading_underscores {
        base.push('_');
    }
    if base.is_empty() {
        base = "field".to_string();
    }
    if base.chars().next().map(|c| c.is_ascii_digit()) == Some(true) {
        base.insert(0, 'x');
    }
    if DART_RESERVED.contains(&base.as_str()) || DART_MEMBERS.contains(&base.as_str()) {
        base.push('_');
    }
    if !taken.iter().any(|t| t == &base) {
        return base;
    }
    let underscored = format!("{base}_");
    if !taken.iter().any(|t| t == &underscored) {
        return underscored;
    }
    for n in 0.. {
        let candidate = format!("{base}_{n}");
        if !taken.iter().any(|t| t == &candidate) {
            return candidate;
        }
    }
    unreachable!("the candidate space is unbounded")
}

fn dart_string_lit(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '$' => out.push_str("\\$"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(c),
        }
    }
    out.push('\'');
    out
}

fn render_json_schema(value: &Value, name: &str) -> String {
    let mut schema = json_schema_of(&infer(value), &[value]);
    if let Value::Object(map) = &mut schema {
        let mut wrapped = serde_json::Map::new();
        wrapped.insert(
            "$schema".into(),
            Value::String("https://json-schema.org/draft/2020-12/schema".into()),
        );
        wrapped.insert(
            "$id".into(),
            Value::String(format!(
                "https://example.com/{}.schema.json",
                name.to_lowercase()
            )),
        );
        wrapped.insert("title".into(), Value::String(name.to_string()));
        for (k, v) in std::mem::take(map).into_iter() {
            wrapped.insert(k, v);
        }
        serde_json::to_string_pretty(&Value::Object(wrapped)).unwrap_or_default()
    } else {
        serde_json::to_string_pretty(&schema).unwrap_or_default()
    }
}

fn json_schema_of(shape: &TypeShape, samples: &[&Value]) -> Value {
    use serde_json::json;
    match shape {
        TypeShape::Primitive(PrimitiveKind::Null) => json!({"type": "null"}),
        TypeShape::Primitive(PrimitiveKind::Bool) => json!({"type": "boolean"}),
        TypeShape::Primitive(PrimitiveKind::Integer | PrimitiveKind::Unsigned) => {
            json!({"type": "integer"})
        }
        TypeShape::Primitive(PrimitiveKind::Float) => json!({"type": "number"}),
        TypeShape::Primitive(PrimitiveKind::String) => match string_format(samples) {
            Some(format) => json!({"type": "string", "format": format}),
            None => json!({"type": "string"}),
        },
        TypeShape::Primitive(PrimitiveKind::Any) | TypeShape::Unknown => json!({}),
        TypeShape::Array(inner) => {
            let items: Vec<&Value> = samples
                .iter()
                .filter_map(|v| v.as_array())
                .flat_map(|items| items.iter().take(ARRAY_SAMPLE_CAP))
                .collect();
            json!({"type": "array", "items": json_schema_of(inner, &items)})
        }
        TypeShape::Object(props) => {
            let mut properties = serde_json::Map::new();
            let mut required: Vec<Value> = Vec::new();
            for (k, prop) in props {
                let values: Vec<&Value> = samples.iter().filter_map(|v| v.get(k)).collect();
                properties.insert(k.clone(), json_schema_of(&prop.shape, &values));
                if !prop.optional && prop.shape != TypeShape::Primitive(PrimitiveKind::Null) {
                    required.push(Value::String(k.clone()));
                }
            }
            let mut obj = serde_json::Map::new();
            obj.insert("type".into(), Value::String("object".into()));
            obj.insert("properties".into(), Value::Object(properties));
            if !required.is_empty() {
                obj.insert("required".into(), Value::Array(required));
            }
            Value::Object(obj)
        }
    }
}

fn string_format(samples: &[&Value]) -> Option<&'static str> {
    let mut formats = samples.iter().filter_map(|v| v.as_str()).map(|s| {
        if is_date(s) {
            Some("date")
        } else if is_date_time(s) {
            Some("date-time")
        } else if is_email(s) {
            Some("email")
        } else if is_uri(s) {
            Some("uri")
        } else {
            None
        }
    });
    let first = formats.next().flatten()?;
    formats.all(|f| f == Some(first)).then_some(first)
}

fn is_date(s: &str) -> bool {
    s.len() == 10
        && s.chars().zip("YYYY-MM-DD".chars()).all(|(c, t)| match t {
            '-' => c == '-',
            _ => c.is_ascii_digit(),
        })
}

fn is_date_time(s: &str) -> bool {
    if s.len() < 19 || !s.is_char_boundary(10) {
        return false;
    }
    is_date(&s[..10]) && (s.as_bytes()[10] == b'T' || s.as_bytes()[10] == b' ')
}

fn is_email(s: &str) -> bool {
    let at = match s.find('@') {
        Some(i) => i,
        None => return false,
    };
    let (local, rest) = s.split_at(at);
    let domain = &rest[1..];
    !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
}

fn is_uri(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn gen(value: &Value, lang: TypegenLang) -> String {
        generate(value, lang, "Root")
    }

    #[test]
    fn typescript_simple_object() {
        let s = gen(&json!({"name": "Ada", "age": 36}), TypegenLang::Typescript);
        assert!(s.contains("export interface Root"));
        assert!(s.contains("name: string"));
        assert!(s.contains("age: number"));
    }

    #[test]
    fn typescript_optional_from_merge() {
        let s = gen(
            &json!([{"a": 1, "b": 2}, {"a": 3}]),
            TypegenLang::Typescript,
        );
        assert!(
            s.contains("b?:") || s.contains("b ?:"),
            "missing optional 'b': {}",
            s
        );
    }

    #[test]
    fn rust_simple_object() {
        let s = gen(&json!({"id": 1, "name": "x"}), TypegenLang::Rust);
        assert!(s.contains("pub struct Root"));
        assert!(s.contains("pub id: i64"));
        assert!(s.contains("pub name: String"));
        assert!(s.contains("Serialize"));
    }

    #[test]
    fn go_simple_object_tags() {
        let s = gen(&json!({"name": "x", "id": 1}), TypegenLang::Go);
        assert!(s.contains("type Root struct"));
        assert!(s.contains("`json:\"name\"`"));
        assert!(s.contains("Name string"));
    }

    #[test]
    fn go_optional_pointer() {
        let s = gen(&json!([{"a": 1}, {}]), TypegenLang::Go);
        assert!(s.contains("*int64"), "expected pointer for optional: {}", s);
        assert!(s.contains("omitempty"));
    }

    #[test]
    fn kotlin_data_class() {
        let s = gen(&json!({"name": "x"}), TypegenLang::Kotlin);
        assert!(s.contains("data class Root("));
        assert!(s.contains("val name: String"));
    }

    #[test]
    fn python_dataclass() {
        let s = gen(&json!({"id": 1, "name": "x"}), TypegenLang::Python);
        assert!(s.contains("@dataclass"));
        assert!(s.contains("class Root:"));
        assert!(s.contains("id: int"));
        assert!(s.contains("name: str"));
    }

    #[test]
    fn php_readonly_class() {
        let s = gen(&json!({"id": 1, "name": "x"}), TypegenLang::Php);
        assert!(s.contains("final readonly class Root"));
        assert!(s.contains("public int $id"));
        assert!(s.contains("public string $name"));
    }

    #[test]
    fn java_pojo_getters_setters() {
        let s = gen(&json!({"id": 1, "name": "x"}), TypegenLang::Java);
        assert!(s.contains("public class Root"));
        assert!(s.contains("public Long getId()"));
        assert!(s.contains("public void setId(Long id)"));
        assert!(s.contains("public String getName()"));
    }

    #[test]
    fn zod_emits_schema_and_inferred_type() {
        let s = gen(&json!({"id": 1, "name": "x"}), TypegenLang::Zod);
        assert!(s.contains("import { z } from 'zod'"));
        assert!(s.contains("z.object({"));
        assert!(s.contains("z.number().int()"));
        assert!(s.contains("z.string()"));
        assert!(s.contains("z.infer<typeof Root>"));
    }

    #[test]
    fn json_schema_format_hints() {
        let s = gen(
            &json!({
                "created_at": "2026-05-13T12:34:56Z",
                "url": "https://example.com",
                "email": "a@b.com",
                "birthday": "2000-01-01"
            }),
            TypegenLang::JsonSchema,
        );
        assert!(s.contains("\"format\": \"date-time\""), "{}", s);
        assert!(s.contains("\"format\": \"uri\""));
        assert!(s.contains("\"format\": \"email\""));
        assert!(s.contains("\"format\": \"date\""));
        assert!(s.contains("\"$schema\""));
    }

    #[test]
    fn nested_objects_emit_nested_types_ts() {
        let s = gen(
            &json!({"user": {"name": "x", "age": 1}}),
            TypegenLang::Typescript,
        );
        assert!(s.contains("interface Root"));
        assert!(s.contains("interface User"));
        assert!(s.contains("user: User"));
    }

    #[test]
    fn array_of_objects_emits_item_type_rust() {
        let s = gen(&json!({"events": [{"id": 1}]}), TypegenLang::Rust);
        assert!(s.contains("struct Root"));
        assert!(s.contains("Vec<EventsItem>"), "got: {}", s);
        assert!(s.contains("struct EventsItem"));
    }

    #[test]
    fn integer_float_merge_widens_to_float() {
        let s = gen(&json!({"x": [1, 2.5]}), TypegenLang::Rust);
        assert!(s.contains("Vec<f64>"), "got: {}", s);
        let s = gen(&json!({"x": [1, 2.5]}), TypegenLang::Typescript);
        assert!(s.contains("x: number[]"), "got: {}", s);
    }

    #[test]
    fn empty_object_renders_python_pass() {
        let s = gen(&json!({}), TypegenLang::Python);
        assert!(s.contains("class Root:"));
        assert!(s.contains("pass"));
    }

    #[test]
    fn dart_model_class_shape() {
        let s = gen(&json!({"id": 1, "name": "x"}), TypegenLang::Dart);
        assert!(s.contains("class Root {"), "{s}");
        assert!(s.contains("const Root({"));
        assert!(s.contains("required this.id,"));
        assert!(s.contains("factory Root.fromJson(Map<String, dynamic> json) => Root("));
        assert!(s.contains("id: json['id'] as int,"));
        assert!(s.contains("name: json['name'] as String,"));
        assert!(s.contains("final int id;"));
        assert!(s.contains("Map<String, dynamic> toJson() => {"));
        assert!(s.contains("'id': id,"));
    }

    #[test]
    fn dart_float_goes_through_num_never_as_double() {
        let s = gen(&json!({"score": 4.5}), TypegenLang::Dart);
        assert!(s.contains("(json['score'] as num).toDouble()"), "{s}");
        assert!(!s.contains("as double"), "{s}");
        let merged = gen(&json!([{"r": 3}, {"r": 3.5}]), TypegenLang::Dart);
        assert!(merged.contains("(json['r'] as num).toDouble()"), "{merged}");
        assert!(merged.contains("final double r;"), "{merged}");
    }

    #[test]
    fn dart_optional_is_nullable_and_not_required() {
        let s = gen(&json!([{"a": 1, "b": "x"}, {"a": 2}]), TypegenLang::Dart);
        assert!(
            s.contains("this.b,"),
            "optional param must not be required: {s}"
        );
        assert!(s.contains("required this.a,"));
        assert!(s.contains("final String? b;"), "{s}");
        assert!(s.contains("b: json['b'] as String?,"), "{s}");
    }

    #[test]
    fn dart_nullable_object_and_list_get_a_null_guard() {
        let s = gen(&json!([{"p": {"x": 1}, "t": ["a"]}, {}]), TypegenLang::Dart);
        assert!(
            s.contains(
                "p: json['p'] == null ? null : P.fromJson(json['p'] as Map<String, dynamic>),"
            ),
            "{s}"
        );
        assert!(
            s.contains(
                "t: json['t'] == null ? null : List<String>.from(json['t'] as List<dynamic>),"
            ),
            "{s}"
        );
        assert!(s.contains("'p': p?.toJson(),"), "{s}");
    }

    #[test]
    fn dart_collections_use_the_decided_idioms() {
        let s = gen(
            &json!({"tags": ["a"], "scores": [1.5], "rows": [{"n": 1}], "grid": [[1]]}),
            TypegenLang::Dart,
        );
        assert!(
            s.contains("List<String>.from(json['tags'] as List<dynamic>)"),
            "{s}"
        );
        assert!(
            s.contains(
                "(json['scores'] as List<dynamic>).map((e) => (e as num).toDouble()).toList()"
            ),
            "{s}"
        );
        assert!(
            s.contains("(json['rows'] as List<dynamic>).map((e) => RowsItem.fromJson(e as Map<String, dynamic>)).toList()"),
            "{s}"
        );
        assert!(
            s.contains("'rows': rows.map((e) => e.toJson()).toList(),"),
            "{s}"
        );
        assert!(s.contains("final List<List<int>> grid;"), "{s}");
        assert!(s.contains("class RowsItem {"), "{s}");
    }

    #[test]
    fn dart_untyped_shapes_pass_through_as_dynamic() {
        let s = gen(&json!([{"v": 1}, {"v": "x"}]), TypegenLang::Dart);
        assert!(s.contains("final dynamic v;"), "{s}");
        assert!(s.contains("v: json['v'],"), "no cast for dynamic: {s}");
        let empty = gen(&json!({"xs": []}), TypegenLang::Dart);
        assert!(empty.contains("final List<dynamic> xs;"), "{empty}");
    }

    #[test]
    fn dart_escapes_reserved_words_and_illegal_keys() {
        let s = gen(
            &json!({"class": 1, "_id": "a", "2fa": true, "toJson": 1, "user-name": "n"}),
            TypegenLang::Dart,
        );
        assert!(s.contains("final int class_;"), "reserved word: {s}");
        assert!(
            s.contains("class_: json['class'] as int,"),
            "key kept verbatim: {s}"
        );
        assert!(s.contains("final String id_;"), "{s}");
        assert!(!s.contains("final String _id;"), "{s}");
        assert!(s.contains("final bool x2fa;"), "leading digit: {s}");
        assert!(s.contains("final int toJson_;"), "member collision: {s}");
        assert!(s.contains("final String userName;"), "camelCase: {s}");
        assert!(s.contains("'user-name': userName,"), "{s}");
    }

    #[test]
    fn dart_string_literals_escape_interpolation() {
        let s = gen(&json!({"a$b": 1, "it's": 2}), TypegenLang::Dart);
        assert!(s.contains("json['a\\$b']"), "dollar must be escaped: {s}");
        assert!(s.contains("json['it\\'s']"), "quote must be escaped: {s}");
    }

    #[test]
    fn dart_empty_object_and_non_object_root() {
        let empty = gen(&json!({}), TypegenLang::Dart);
        assert!(empty.contains("const Root();"), "{empty}");
        assert!(
            empty.contains("Map<String, dynamic> toJson() => <String, dynamic>{};"),
            "{empty}"
        );
        let scalars = gen(&json!([1, 2]), TypegenLang::Dart);
        assert!(scalars.contains("typedef Root = List<int>;"), "{scalars}");
    }

    #[test]
    fn dart_array_of_objects_root_emits_item_class() {
        let s = gen(&json!([{"id": 1}]), TypegenLang::Dart);
        assert!(s.contains("class RootItem {"), "{s}");
        assert!(s.contains("typedef Root = List<RootItem>;"), "{s}");
    }

    #[test]
    fn rust_reserved_keys_use_raw_identifiers() {
        let s = gen(
            &json!({"type": "x", "in": 1, "self": 2, "crate": 3}),
            TypegenLang::Rust,
        );
        assert!(s.contains("    pub r#type: String,"), "{s}");
        assert!(s.contains("    pub r#in: i64,"), "{s}");
        assert!(!s.contains("rename = \"type\""), "serde unraws r#: {s}");
        assert!(
            s.contains("    #[serde(rename = \"self\")]\n    pub self_: i64,"),
            "{s}"
        );
        assert!(
            s.contains("    #[serde(rename = \"crate\")]\n    pub crate_: i64,"),
            "{s}"
        );
    }

    #[test]
    fn python_reserved_keys_get_a_trailing_underscore() {
        let s = gen(&json!({"from": "a", "class": 1}), TypegenLang::Python);
        assert!(s.contains("    class_: int"), "{s}");
        assert!(s.contains("    from_: str"), "{s}");
    }

    #[test]
    fn java_reserved_keys_get_a_trailing_underscore() {
        let s = gen(&json!({"default": true}), TypegenLang::Java);
        assert!(s.contains("    private Boolean default_;"), "{s}");
        assert!(
            s.contains("    public Boolean getDefault_() { return this.default_; }"),
            "{s}"
        );
    }

    #[test]
    fn kotlin_reserved_keys_are_backticked() {
        let s = gen(&json!({"class": "a", "object": 1}), TypegenLang::Kotlin);
        assert!(s.contains("    val `class`: String,"), "{s}");
        assert!(s.contains("    val `object`: Long"), "{s}");
    }

    #[test]
    fn php_this_key_is_renamed() {
        let s = gen(&json!({"this": 1, "class": 2}), TypegenLang::Php);
        assert!(s.contains("public int $this_"), "{s}");
        assert!(s.contains("public int $class,"), "{s}");
    }

    #[test]
    fn ts_and_zod_quote_keys_that_are_not_identifiers() {
        let v = json!({"2fa": true, "": 1, "a\\b": 2, "class": 3});
        let ts = gen(&v, TypegenLang::Typescript);
        assert!(ts.contains("  \"a\\\\b\": number;"), "{ts}");
        let zod = gen(&v, TypegenLang::Zod);
        assert!(zod.contains("  \"2fa\": z.boolean(),"), "{zod}");
        assert!(zod.contains("  \"\": z.number().int(),"), "{zod}");
        assert!(zod.contains("  \"a\\\\b\": z.number().int(),"), "{zod}");
        assert!(zod.contains("  class: z.number().int(),"), "{zod}");
    }

    #[test]
    fn reserved_type_names_are_qualified_by_their_parent() {
        let rust = gen(
            &json!({"_links": {"self": {"href": "x"}}}),
            TypegenLang::Rust,
        );
        assert!(rust.contains("pub struct LinksSelf {"), "{rust}");
        assert!(!rust.contains("struct Self"), "{rust}");
        let py = gen(&json!({"none": {"a": 1}}), TypegenLang::Python);
        assert!(py.contains("class RootNone:"), "{py}");
        let php = gen(&json!({"class": {"a": 1}}), TypegenLang::Php);
        assert!(php.contains("final readonly class RootClass"), "{php}");
        let java = gen(&json!({"list": {"a": 1}, "tags": ["x"]}), TypegenLang::Java);
        assert!(java.contains("public static class RootList {"), "{java}");
        let dart = gen(
            &json!({"string": {"a": 1}, "map": {"b": 1}}),
            TypegenLang::Dart,
        );
        assert!(dart.contains("class RootString {"), "{dart}");
        assert!(
            dart.contains("map: RootMap.fromJson(json['map'] as Map<String, dynamic>),"),
            "{dart}"
        );
    }

    #[test]
    fn python_and_php_put_required_fields_before_defaulted_ones() {
        let v = json!([{"id": 1, "name": "x", "avatar": "a"}, {"id": 2, "name": "y"}]);
        let py = gen(&v, TypegenLang::Python);
        assert!(
            py.contains("    id: int\n    name: str\n    avatar: Optional[str] = None"),
            "{py}"
        );
        let php = gen(&v, TypegenLang::Php);
        assert!(
            php.contains(
                "public int $id,\n        public string $name,\n        public ?string $avatar = null\n"
            ),
            "{php}"
        );
    }

    #[test]
    fn keys_that_sanitize_to_the_same_name_get_numbered() {
        let v = json!({"createdAt": 1, "created_at": 2});
        let rust = gen(&v, TypegenLang::Rust);
        assert!(
            rust.contains("    #[serde(rename = \"createdAt\")]\n    pub created_at: i64,"),
            "{rust}"
        );
        assert!(
            rust.contains("    #[serde(rename = \"created_at\")]\n    pub created_at2: i64,"),
            "{rust}"
        );
        let go = gen(&v, TypegenLang::Go);
        assert!(
            go.contains("    CreatedAt int64 `json:\"createdAt\"`"),
            "{go}"
        );
        assert!(
            go.contains("    CreatedAt2 int64 `json:\"created_at\"`"),
            "{go}"
        );
        let kt = gen(&v, TypegenLang::Kotlin);
        assert!(
            kt.contains("    val createdAt: Long,\n    val createdAt2: Long"),
            "{kt}"
        );
        let java = gen(&v, TypegenLang::Java);
        assert!(java.contains("    private Long createdAt2;"), "{java}");
        assert!(java.contains("public Long getCreatedAt2()"), "{java}");
        let php = gen(&v, TypegenLang::Php);
        assert!(php.contains("public int $createdAt,"), "{php}");
        assert!(php.contains("public int $createdAt2\n"), "{php}");
        let py = gen(&v, TypegenLang::Python);
        assert!(
            py.contains("    created_at: int\n    created_at2: int"),
            "{py}"
        );
    }

    #[test]
    fn keys_without_ascii_letters_or_digits_get_a_fallback_name() {
        let v = json!({"名前": "x", "住所": "y"});
        let rust = gen(&v, TypegenLang::Rust);
        assert!(
            rust.contains("    #[serde(rename = \"住所\")]\n    pub field1: String,"),
            "{rust}"
        );
        assert!(
            rust.contains("    #[serde(rename = \"名前\")]\n    pub field2: String,"),
            "{rust}"
        );
        let go = gen(&v, TypegenLang::Go);
        assert!(go.contains("    Field1 string `json:\"住所\"`"), "{go}");
        assert!(go.contains("    Field2 string `json:\"名前\"`"), "{go}");
        let dash = gen(&json!({"-": 1}), TypegenLang::Go);
        assert!(dash.contains("    Field1 int64 `json:\"-,\"`"), "{dash}");
        let kt = gen(&v, TypegenLang::Kotlin);
        assert!(
            kt.contains("    val field1: String,\n    val field2: String"),
            "{kt}"
        );
        let java = gen(&v, TypegenLang::Java);
        assert!(java.contains("    private String field2;"), "{java}");
        let php = gen(&v, TypegenLang::Php);
        assert!(php.contains("public string $field2\n"), "{php}");
        let py = gen(&v, TypegenLang::Python);
        assert!(py.contains("    field1: str\n    field2: str"), "{py}");
    }

    #[test]
    fn jvm_keys_differing_only_in_first_letter_case_get_numbered() {
        let v = json!({"Name": "a", "name": "b"});
        let java = gen(&v, TypegenLang::Java);
        assert!(java.contains("public String getName()"), "{java}");
        assert!(java.contains("public String getName2()"), "{java}");
        let kt = gen(&v, TypegenLang::Kotlin);
        assert!(
            kt.contains("    val Name: String,\n    val name2: String"),
            "{kt}"
        );
    }

    #[test]
    fn go_keys_a_struct_tag_cannot_name_are_skipped_with_a_comment() {
        let v = json!({"": 1, "a\"b": 2, "a\\b": 3, "a,b": 4, "m²": 5, "ok key": 6, "名前": 7});
        let go = gen(&v, TypegenLang::Go);
        assert!(
            go.contains(
                "    // JSON key \"a,b\" can't be named in a Go struct tag, so it won't decode into this field.\n    AB2 int64 `json:\"-\"`"
            ),
            "{go}"
        );
        assert_eq!(
            go.matches("can't be named in a Go struct tag").count(),
            5,
            "{go}"
        );
        assert_eq!(go.matches("`json:\"-\"`").count(), 5, "{go}");
        assert!(go.contains("`json:\"ok key\"`"), "{go}");
        assert!(go.contains("`json:\"名前\"`"), "{go}");
    }

    #[test]
    fn keys_starting_with_a_digit_stay_legal_identifiers() {
        let v = json!({"2fa": true});
        assert!(gen(&v, TypegenLang::Go).contains("    X2fa bool `json:\"2fa\"`"));
        assert!(gen(&v, TypegenLang::Kotlin).contains("    val x2fa: Boolean"));
        assert!(gen(&v, TypegenLang::Java).contains("    private Boolean x2fa;"));
    }

    #[test]
    fn same_type_name_with_a_different_shape_is_qualified_by_its_parent() {
        let v = json!({"user": {"name": "a"}, "post": {"user": {"id": 1}}});
        let ts = gen(&v, TypegenLang::Typescript);
        assert!(
            ts.contains("export interface User {\n  id: number;\n}"),
            "{ts}"
        );
        assert!(
            ts.contains("export interface RootUser {\n  name: string;\n}"),
            "{ts}"
        );
        assert!(ts.contains("  user: RootUser;"), "{ts}");
        for lang in [
            TypegenLang::Rust,
            TypegenLang::Go,
            TypegenLang::Kotlin,
            TypegenLang::Python,
            TypegenLang::Php,
            TypegenLang::Java,
            TypegenLang::Dart,
        ] {
            let s = gen(&v, lang);
            assert!(s.contains("RootUser"), "{lang:?}: {s}");
        }
        let dart = gen(&v, TypegenLang::Dart);
        assert!(
            dart.contains("user: RootUser.fromJson(json['user'] as Map<String, dynamic>),"),
            "{dart}"
        );

        let same = gen(
            &json!({"a": {"x": 1}, "b": {"a": {"x": 2}}}),
            TypegenLang::Typescript,
        );
        assert_eq!(same.matches("export interface A {").count(), 1, "{same}");
        assert!(
            !same.contains("RootA"),
            "identical shapes share a type: {same}"
        );
    }

    #[test]
    fn json_schema_items_merge_every_sampled_element() {
        let v = json!([{"id": 1, "name": "x", "score": 1}, {"id": 2, "score": 1.5}]);
        let s = gen(&v, TypegenLang::JsonSchema);
        let schema: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(schema["items"]["required"], json!(["id", "score"]), "{s}");
        assert_eq!(
            schema["items"]["properties"]["score"],
            json!({"type": "number"}),
            "{s}"
        );
        assert!(
            crate::doc::schema_validate::validate(&v, &s).unwrap().valid,
            "{s}"
        );

        let mixed = gen(
            &json!([{"d": "2020-01-01"}, {"d": "soon"}]),
            TypegenLang::JsonSchema,
        );
        assert!(!mixed.contains("\"format\""), "{mixed}");
    }

    #[test]
    fn java_output_compiles_as_one_file() {
        let s = gen(
            &json!({"user": {"name": "a"}, "tags": ["x"]}),
            TypegenLang::Java,
        );
        assert!(
            s.starts_with("import java.util.List;\n\npublic class Root {\n"),
            "{s}"
        );
        assert_eq!(s.matches("public class").count(), 1, "{s}");
        assert!(
            s.contains("\n\n    public static class User {\n        private String name;\n"),
            "{s}"
        );
        assert!(s.ends_with("\n    }\n}"), "{s}");
        let no_list = gen(&json!({"id": 1}), TypegenLang::Java);
        assert!(no_list.starts_with("public class Root {"), "{no_list}");
    }

    #[test]
    fn java_never_declares_get_class() {
        let s = gen(&json!({"Class": "a", "class": 1}), TypegenLang::Java);
        assert!(!s.contains("getClass()"), "{s}");
        assert!(s.contains("public String getClass2()"), "{s}");
        assert!(s.contains("public Long getClass_()"), "{s}");
    }

    #[test]
    fn php_optional_mixed_is_not_marked_nullable() {
        let s = gen(&json!([{"a": null, "b": 1}, {"b": 2}]), TypegenLang::Php);
        assert!(s.contains("public mixed $a = null"), "{s}");
        assert!(!s.contains("?mixed"), "{s}");
    }

    #[test]
    fn integers_above_i64_max_get_a_type_that_holds_them() {
        let v: Value = serde_json::from_str(r#"{"id": 18446744073709551615, "n": -1}"#).unwrap();
        let rust = gen(&v, TypegenLang::Rust);
        assert!(rust.contains("    pub id: u64,"), "{rust}");
        assert!(rust.contains("    pub n: i64,"), "{rust}");
        let go = gen(&v, TypegenLang::Go);
        assert!(go.contains("    Id uint64 `json:\"id\"`"), "{go}");
        let java = gen(&v, TypegenLang::Java);
        assert!(
            java.starts_with("import java.math.BigInteger;\n\npublic class Root {"),
            "{java}"
        );
        assert!(java.contains("    private BigInteger id;"), "{java}");
        let mixed: Value =
            serde_json::from_str(r#"[{"id": 1}, {"id": 18446744073709551615}]"#).unwrap();
        assert!(
            gen(&mixed, TypegenLang::Rust).contains("    pub id: u64,"),
            "a smaller id in the sample doesn't narrow the type"
        );
    }

    #[test]
    fn json_schema_string_with_multibyte_at_byte_10_does_not_panic() {
        // 19 bytes, byte 10 lands inside the 3-byte '€' — not a char boundary.
        let weird = "éééé€aaaaaaaa";
        assert!(!is_date_time(weird));
        let s = gen(&json!({ "k": weird }), TypegenLang::JsonSchema);
        assert!(s.contains("\"type\""));
    }
}

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
            if n.is_i64() || n.is_u64() {
                TypeShape::Primitive(PrimitiveKind::Integer)
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
        (Primitive(PrimitiveKind::Integer), Primitive(PrimitiveKind::Float))
        | (Primitive(PrimitiveKind::Float), Primitive(PrimitiveKind::Integer)) => {
            Primitive(PrimitiveKind::Float)
        }
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

fn render_typescript(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let _ = ts_type(shape, name, &mut classes, &mut seen);
    let mut out = String::new();
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn ts_type(
    shape: &TypeShape,
    name: &str,
    classes: &mut Vec<String>,
    seen: &mut std::collections::BTreeSet<String>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => ts_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = ts_type(inner, &item_name, classes, seen);
            format!("{inner_ty}[]")
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("export interface {class_name} {{\n");
                for (k, v) in props {
                    let prop_name = ts_prop_name(k);
                    let ty = ts_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
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
        PrimitiveKind::Integer | PrimitiveKind::Float => "number",
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
        format!("\"{}\"", k.replace('"', "\\\""))
    } else {
        k.to_string()
    }
}

fn render_rust(shape: &TypeShape, name: &str) -> String {
    let mut structs: Vec<String> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let _ = rust_type(shape, name, &mut structs, &mut seen);
    let mut out = String::from("use serde::{Deserialize, Serialize};\n\n");
    for s in structs {
        out.push_str(&s);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn rust_type(
    shape: &TypeShape,
    name: &str,
    structs: &mut Vec<String>,
    seen: &mut std::collections::BTreeSet<String>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => rust_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = rust_type(inner, &item_name, structs, seen);
            format!("Vec<{inner_ty}>")
        }
        TypeShape::Object(props) => {
            let struct_name = sanitize_ident(name, true);
            if !seen.contains(&struct_name) {
                seen.insert(struct_name.clone());
                let mut body = String::new();
                body.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
                let _ = writeln!(body, "pub struct {struct_name} {{");
                for (k, v) in props {
                    let field = snake_case(&sanitize_ident(k, false));
                    let rename = if field != *k {
                        format!("    #[serde(rename = \"{}\")]\n", k.replace('"', "\\\""))
                    } else {
                        String::new()
                    };
                    let ty = rust_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
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
        PrimitiveKind::Float => "f64",
        PrimitiveKind::String => "String",
        PrimitiveKind::Any => "serde_json::Value",
    }
}

fn render_go(shape: &TypeShape, name: &str) -> String {
    let mut structs: Vec<String> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let _ = go_type(shape, name, &mut structs, &mut seen);
    let mut out = String::from("package types\n\n");
    for s in structs {
        out.push_str(&s);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn go_type(
    shape: &TypeShape,
    name: &str,
    structs: &mut Vec<String>,
    seen: &mut std::collections::BTreeSet<String>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => go_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = go_type(inner, &item_name, structs, seen);
            format!("[]{inner_ty}")
        }
        TypeShape::Object(props) => {
            let struct_name = sanitize_ident(name, true);
            if !seen.contains(&struct_name) {
                seen.insert(struct_name.clone());
                let mut body = format!("type {struct_name} struct {{\n");
                for (k, v) in props {
                    let field = to_pascal_case(&sanitize_ident(k, true));
                    let ty = go_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        structs,
                        seen,
                    );
                    let ty = if v.optional { format!("*{ty}") } else { ty };
                    let tag = format!(
                        "`json:\"{}{}\"`",
                        k,
                        if v.optional { ",omitempty" } else { "" }
                    );
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
        PrimitiveKind::Float => "float64",
        PrimitiveKind::String => "string",
        PrimitiveKind::Any => "interface{}",
    }
}

fn render_kotlin(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let _ = kotlin_type(shape, name, &mut classes, &mut seen);
    let mut out = String::new();
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn kotlin_type(
    shape: &TypeShape,
    name: &str,
    classes: &mut Vec<String>,
    seen: &mut std::collections::BTreeSet<String>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => kotlin_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = kotlin_type(inner, &item_name, classes, seen);
            format!("List<{inner_ty}>")
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("data class {class_name}(\n");
                let entries: Vec<_> = props.iter().collect();
                for (i, (k, v)) in entries.iter().enumerate() {
                    let prop_name = to_camel_case(&sanitize_ident(k, false));
                    let ty = kotlin_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
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
        PrimitiveKind::Integer => "Long",
        PrimitiveKind::Float => "Double",
        PrimitiveKind::String => "String",
        PrimitiveKind::Any => "Any",
    }
}

fn render_python(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let _ = python_type(shape, name, &mut classes, &mut seen);
    let mut out = String::from("from __future__ import annotations\n");
    out.push_str("from dataclasses import dataclass\n");
    out.push_str("from typing import Any, Optional\n\n\n");
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n\n");
    }
    out.trim_end().to_string()
}

fn python_type(
    shape: &TypeShape,
    name: &str,
    classes: &mut Vec<String>,
    seen: &mut std::collections::BTreeSet<String>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => python_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = python_type(inner, &item_name, classes, seen);
            format!("list[{inner_ty}]")
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("@dataclass\nclass {class_name}:\n");
                if props.is_empty() {
                    body.push_str("    pass");
                } else {
                    for (k, v) in props {
                        let field = snake_case(&sanitize_ident(k, false));
                        let ty = python_type(
                            &v.shape,
                            &to_pascal_case(&sanitize_ident(k, true)),
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
        PrimitiveKind::Integer => "int",
        PrimitiveKind::Float => "float",
        PrimitiveKind::String => "str",
        PrimitiveKind::Any => "Any",
    }
}

fn render_php(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let _ = php_type(shape, name, &mut classes, &mut seen);
    let mut out = String::from("<?php\n\ndeclare(strict_types=1);\n\n");
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn php_type(
    shape: &TypeShape,
    name: &str,
    classes: &mut Vec<String>,
    seen: &mut std::collections::BTreeSet<String>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => php_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let _ = php_type(inner, &item_name, classes, seen);
            "array".to_string()
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("final readonly class {class_name}\n{{\n");
                body.push_str("    public function __construct(\n");
                let entries: Vec<_> = props.iter().collect();
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
                    let ty = php_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        classes,
                        seen,
                    );
                    let ty = if v.optional { format!("?{ty}") } else { ty };
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
        PrimitiveKind::Integer => "int",
        PrimitiveKind::Float => "float",
        PrimitiveKind::String => "string",
        PrimitiveKind::Any => "mixed",
    }
}

fn render_java(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let _ = java_type(shape, name, &mut classes, &mut seen, true);
    let mut out = String::new();
    for c in classes {
        out.push_str(&c);
        out.push_str("\n\n");
    }
    out.trim_end().to_string()
}

fn java_type(
    shape: &TypeShape,
    name: &str,
    classes: &mut Vec<String>,
    seen: &mut std::collections::BTreeSet<String>,
    boxed: bool,
) -> String {
    match shape {
        TypeShape::Primitive(p) => java_primitive(*p, boxed).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            let inner_ty = java_type(inner, &item_name, classes, seen, true);
            format!("List<{inner_ty}>")
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("public class {class_name} {{\n");
                for (k, v) in props {
                    let field = to_camel_case(&sanitize_ident(k, false));
                    let ty = java_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        classes,
                        seen,
                        true,
                    );
                    let _ = writeln!(body, "    private {ty} {field};");
                }
                body.push('\n');
                for (k, v) in props {
                    let field = to_camel_case(&sanitize_ident(k, false));
                    let cap = capitalize_first(&field);
                    let ty = java_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        classes,
                        seen,
                        true,
                    );
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
                let key = if k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
                    k.clone()
                } else {
                    format!("\"{}\"", k.replace('"', "\\\""))
                };
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
        PrimitiveKind::Integer => "z.number().int()",
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

fn render_dart(shape: &TypeShape, name: &str) -> String {
    let mut classes: Vec<String> = Vec::new();
    let mut seen: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let root = dart_type(shape, name, &mut classes, &mut seen);
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

fn dart_type(
    shape: &TypeShape,
    name: &str,
    classes: &mut Vec<String>,
    seen: &mut std::collections::BTreeSet<String>,
) -> String {
    match shape {
        TypeShape::Primitive(p) => dart_primitive(*p).to_string(),
        TypeShape::Array(inner) => {
            let item_name = format!("{name}Item");
            format!("List<{}>", dart_type(inner, &item_name, classes, seen))
        }
        TypeShape::Object(props) => {
            let class_name = dart_class_name(name);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let body = dart_class(&class_name, props, classes, seen);
                classes.push(body);
            }
            class_name
        }
        TypeShape::Unknown => "dynamic".to_string(),
    }
}

fn dart_class(
    class_name: &str,
    props: &BTreeMap<String, ObjectProp>,
    classes: &mut Vec<String>,
    seen: &mut std::collections::BTreeSet<String>,
) -> String {
    let mut taken: Vec<String> = vec![class_name.to_string()];
    let mut fields: Vec<(String, String, String, String, bool)> = Vec::new();
    for (key, prop) in props {
        let field = dart_field_name(key, &taken);
        taken.push(field.clone());
        let hint = to_pascal_case(&sanitize_ident(key, true));
        let ty = dart_type(&prop.shape, &hint, classes, seen);
        let ty = if prop.optional { format!("{ty}?") } else { ty };
        let src = format!("json[{}]", dart_string_lit(key));
        let from = dart_from_json(&prop.shape, &hint, &src, prop.optional);
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
        PrimitiveKind::Integer => "int",
        PrimitiveKind::Float => "double",
        PrimitiveKind::String => "String",
    }
}

fn dart_from_json(shape: &TypeShape, name: &str, src: &str, optional: bool) -> String {
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
                    let elem = dart_from_json(inner, &item_name, "e", false);
                    format!("({src} as List<dynamic>).map((e) => {elem}).toList()")
                }
                TypeShape::Primitive(p) => {
                    format!("List<{}>.from({src} as List<dynamic>)", dart_primitive(*p))
                }
            };
            dart_guard_null(src, body, optional)
        }
        TypeShape::Object(_) => {
            let cls = dart_class_name(name);
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
    let mut schema = json_schema_of(value);
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

fn json_schema_of(value: &Value) -> Value {
    use serde_json::json;
    match value {
        Value::Null => json!({"type": "null"}),
        Value::Bool(_) => json!({"type": "boolean"}),
        Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                json!({"type": "integer"})
            } else {
                json!({"type": "number"})
            }
        }
        Value::String(s) => {
            if is_date(s) {
                json!({"type": "string", "format": "date"})
            } else if is_date_time(s) {
                json!({"type": "string", "format": "date-time"})
            } else if is_email(s) {
                json!({"type": "string", "format": "email"})
            } else if is_uri(s) {
                json!({"type": "string", "format": "uri"})
            } else {
                json!({"type": "string"})
            }
        }
        Value::Array(items) => {
            if items.is_empty() {
                json!({"type": "array", "items": {}})
            } else {
                json!({"type": "array", "items": json_schema_of(&items[0])})
            }
        }
        Value::Object(map) => {
            let mut properties = serde_json::Map::new();
            let mut required: Vec<Value> = Vec::new();
            for (k, v) in map {
                properties.insert(k.clone(), json_schema_of(v));
                if !v.is_null() {
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
    fn json_schema_string_with_multibyte_at_byte_10_does_not_panic() {
        // 19 bytes, byte 10 lands inside the 3-byte '€' — not a char boundary.
        let weird = "éééé€aaaaaaaa";
        assert!(!is_date_time(weird));
        let s = gen(&json!({ "k": weird }), TypegenLang::JsonSchema);
        assert!(s.contains("\"type\""));
    }
}

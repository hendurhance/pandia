
use serde::{Deserialize, Serialize};
use serde_json::Value;

use std::collections::BTreeMap;
use std::fmt::Write as _;

pub(crate) const ARRAY_SAMPLE_CAP: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
                    (None, None) => unreachable!(),
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
        TypegenLang::JsonSchema => {
            "{ \"$schema\": \"http://json-schema.org/draft-07/schema#\" }".to_string()
        }
    }
}

fn sanitize_ident(name: &str, capitalize: bool) -> String {
    let cleaned: String = if name.chars().all(|c| c.is_ascii_digit()) {
        format!("Item{}", name)
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
            let item_name = format!("{}Item", name);
            let inner_ty = ts_type(inner, &item_name, classes, seen);
            format!("{}[]", inner_ty)
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("export interface {} {{\n", class_name);
                for (k, v) in props {
                    let prop_name = ts_prop_name(k);
                    let ty = ts_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        classes,
                        seen,
                    );
                    let q = if v.optional { "?" } else { "" };
                    let _ = writeln!(body, "  {}{}: {};", prop_name, q, ty);
                }
                body.push_str("}");
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
            let item_name = format!("{}Item", name);
            let inner_ty = rust_type(inner, &item_name, structs, seen);
            format!("Vec<{}>", inner_ty)
        }
        TypeShape::Object(props) => {
            let struct_name = sanitize_ident(name, true);
            if !seen.contains(&struct_name) {
                seen.insert(struct_name.clone());
                let mut body = String::new();
                body.push_str("#[derive(Debug, Clone, Serialize, Deserialize)]\n");
                let _ = writeln!(body, "pub struct {} {{", struct_name);
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
                        format!("Option<{}>", ty)
                    } else {
                        ty
                    };
                    body.push_str(&rename);
                    let _ = writeln!(body, "    pub {}: {},", field, ty);
                }
                body.push_str("}");
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
            let item_name = format!("{}Item", name);
            let inner_ty = go_type(inner, &item_name, structs, seen);
            format!("[]{}", inner_ty)
        }
        TypeShape::Object(props) => {
            let struct_name = sanitize_ident(name, true);
            if !seen.contains(&struct_name) {
                seen.insert(struct_name.clone());
                let mut body = format!("type {} struct {{\n", struct_name);
                for (k, v) in props {
                    let field = to_pascal_case(&sanitize_ident(k, true));
                    let ty = go_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        structs,
                        seen,
                    );
                    let ty = if v.optional { format!("*{}", ty) } else { ty };
                    let tag = format!(
                        "`json:\"{}{}\"`",
                        k,
                        if v.optional { ",omitempty" } else { "" }
                    );
                    let _ = writeln!(body, "    {} {} {}", field, ty, tag);
                }
                body.push_str("}");
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
            let item_name = format!("{}Item", name);
            let inner_ty = kotlin_type(inner, &item_name, classes, seen);
            format!("List<{}>", inner_ty)
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("data class {}(\n", class_name);
                let entries: Vec<_> = props.iter().collect();
                for (i, (k, v)) in entries.iter().enumerate() {
                    let prop_name = to_camel_case(&sanitize_ident(k, false));
                    let ty = kotlin_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        classes,
                        seen,
                    );
                    let ty = if v.optional { format!("{}?", ty) } else { ty };
                    let comma = if i + 1 < entries.len() { "," } else { "" };
                    let _ = writeln!(body, "    val {}: {}{}", prop_name, ty, comma);
                }
                body.push_str(")");
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
            let item_name = format!("{}Item", name);
            let inner_ty = python_type(inner, &item_name, classes, seen);
            format!("list[{}]", inner_ty)
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("@dataclass\nclass {}:\n", class_name);
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
                            format!("Optional[{}] = None", ty)
                        } else {
                            ty
                        };
                        let _ = writeln!(body, "    {}: {}", field, ty);
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
            let item_name = format!("{}Item", name);
            let _ = php_type(inner, &item_name, classes, seen);
            "array".to_string()
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("final readonly class {}\n{{\n", class_name);
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
                        format!("item{}", prop_name)
                    } else {
                        prop_name
                    };
                    let ty = php_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        classes,
                        seen,
                    );
                    let ty = if v.optional { format!("?{}", ty) } else { ty };
                    let default = if v.optional { " = null" } else { "" };
                    let comma = if i + 1 < entries.len() { "," } else { "" };
                    let _ = writeln!(
                        body,
                        "        public {} ${}{}{}",
                        ty, prop_name, default, comma
                    );
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
            let item_name = format!("{}Item", name);
            let inner_ty = java_type(inner, &item_name, classes, seen, true);
            format!("List<{}>", inner_ty)
        }
        TypeShape::Object(props) => {
            let class_name = sanitize_ident(name, true);
            if !seen.contains(&class_name) {
                seen.insert(class_name.clone());
                let mut body = format!("public class {} {{\n", class_name);
                for (k, v) in props {
                    let field = to_camel_case(&sanitize_ident(k, false));
                    let ty = java_type(
                        &v.shape,
                        &to_pascal_case(&sanitize_ident(k, true)),
                        classes,
                        seen,
                        true,
                    );
                    let _ = writeln!(body, "    private {} {};", ty, field);
                }
                body.push_str("\n");
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
                        "    public {} get{}() {{ return this.{}; }}",
                        ty, cap, field
                    );
                    let _ = writeln!(
                        body,
                        "    public void set{}({} {}) {{ this.{} = {}; }}",
                        cap, ty, field, field, field
                    );
                }
                body.push_str("}");
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
                    format!("{}.optional()", inner)
                } else {
                    inner
                };
                let _ = writeln!(body, "  {}: {},", key, inner);
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
    if s.len() < 19 {
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
}

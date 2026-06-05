
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaValidationResult {
    pub valid: bool,
    pub errors: Vec<SchemaError>,
    pub error_count: u32,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaError {
    pub instance_path: String,
    pub schema_path: String,
    pub message: String,
}

#[derive(Debug, Error)]
pub enum SchemaCompileError {
    #[error("schema is not valid JSON: {0}")]
    Parse(String),
    #[error("schema compile error: {0}")]
    Compile(String),
}

const DEFAULT_MAX_ERRORS: usize = 500;

pub fn validate(
    instance: &Value,
    schema_text: &str,
) -> Result<SchemaValidationResult, SchemaCompileError> {
    let schema_json: Value = serde_json::from_str(schema_text.trim())
        .map_err(|e| SchemaCompileError::Parse(e.to_string()))?;

    let validator = jsonschema::validator_for(&schema_json)
        .map_err(|e| SchemaCompileError::Compile(e.to_string()))?;

    let mut errors: Vec<SchemaError> = Vec::new();
    let mut total: u32 = 0;
    let mut truncated = false;

    for err in validator.iter_errors(instance) {
        total += 1;
        if errors.len() < DEFAULT_MAX_ERRORS {
            errors.push(SchemaError {
                instance_path: err.instance_path.to_string(),
                schema_path: err.schema_path.to_string(),
                message: err.to_string(),
            });
        } else {
            truncated = true;
        }
    }

    Ok(SchemaValidationResult {
        valid: total == 0,
        errors,
        error_count: total,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn schema(s: &str) -> String {
        s.to_string()
    }

    #[test]
    fn valid_instance_against_simple_schema() {
        let s = schema(
            r#"{"type": "object", "required": ["id"], "properties": {"id": {"type": "string"}}}"#,
        );
        let r = validate(&json!({"id": "abc"}), &s).unwrap();
        assert!(r.valid);
        assert_eq!(r.error_count, 0);
        assert!(r.errors.is_empty());
    }

    #[test]
    fn nested_error_instance_path_is_json_pointer() {
        let s = schema(r#"{"properties": {"a": {"properties": {"b": {"type": "string"}}}}}"#);
        let r = validate(&json!({"a": {"b": 1}}), &s).unwrap();
        assert!(!r.valid);
        assert_eq!(r.errors[0].instance_path, "/a/b");
    }

    #[test]
    fn array_error_instance_path_uses_index() {
        let s = schema(r#"{"type": "array", "items": {"type": "string"}}"#);
        let r = validate(&json!(["ok", 5]), &s).unwrap();
        assert!(!r.valid);
        assert_eq!(r.errors[0].instance_path, "/1");
    }

    #[test]
    fn missing_required_property() {
        let s = schema(r#"{"type": "object", "required": ["id"]}"#);
        let r = validate(&json!({}), &s).unwrap();
        assert!(!r.valid);
        assert_eq!(r.error_count, 1);
        assert!(r.errors[0].message.to_lowercase().contains("id"));
    }

    #[test]
    fn wrong_type_for_property() {
        let s = schema(r#"{"type": "object", "properties": {"id": {"type": "string"}}}"#);
        let r = validate(&json!({"id": 123}), &s).unwrap();
        assert!(!r.valid);
        assert_eq!(r.error_count, 1);
        assert_eq!(r.errors[0].instance_path, "/id");
    }

    #[test]
    fn array_item_constraint() {
        let s = schema(
            r#"{
            "type": "array",
            "items": {"type": "integer"}
        }"#,
        );
        let r = validate(&json!([1, 2, "three", 4]), &s).unwrap();
        assert!(!r.valid);
        assert!(r.error_count >= 1);
        assert!(r.errors.iter().any(|e| e.instance_path == "/2"));
    }

    #[test]
    fn draft07_via_dollar_schema_keyword() {
        let s = schema(
            r#"{
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "required": ["name"]
        }"#,
        );
        let r = validate(&json!({}), &s).unwrap();
        assert!(!r.valid);
        assert_eq!(r.error_count, 1);
    }

    #[test]
    fn draft202012_via_dollar_schema_keyword() {
        let s = schema(
            r#"{
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "required": ["name"]
        }"#,
        );
        let r = validate(&json!({}), &s).unwrap();
        assert!(!r.valid);
        assert_eq!(r.error_count, 1);
    }

    #[test]
    fn invalid_schema_text_errors_at_compile() {
        let s = schema(r#"{"type": "not-a-real-type"}"#);
        let err = validate(&json!({}), &s).unwrap_err();
        assert!(matches!(err, SchemaCompileError::Compile(_)));
    }

    #[test]
    fn unparseable_schema_text_errors_at_parse() {
        let err = validate(&json!({}), "this isn't json").unwrap_err();
        assert!(matches!(err, SchemaCompileError::Parse(_)));
    }

    #[test]
    fn nested_object_paths() {
        let s = schema(
            r#"{
            "type": "object",
            "properties": {
                "user": {
                    "type": "object",
                    "properties": {"age": {"type": "integer", "minimum": 0}}
                }
            }
        }"#,
        );
        let r = validate(&json!({"user": {"age": -5}}), &s).unwrap();
        assert!(!r.valid);
        assert_eq!(r.errors[0].instance_path, "/user/age");
    }

    #[test]
    fn error_cap_truncates() {
        let mut arr: Vec<Value> = Vec::new();
        for _ in 0..600 {
            arr.push(json!("not-an-int"));
        }
        let s = schema(r#"{"type": "array", "items": {"type": "integer"}}"#);
        let r = validate(&Value::Array(arr), &s).unwrap();
        assert!(!r.valid);
        assert_eq!(r.error_count, 600);
        assert_eq!(r.errors.len(), 500);
        assert!(r.truncated);
    }
}

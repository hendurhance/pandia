use std::collections::HashMap;
use std::io::Read;
use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::doc::diff::{compute_diff, DiffKind};
use crate::doc::document::{Document, EDIT_SIZE_LIMIT, MAX_DOC_BYTES};
use crate::doc::export::ExportFormat;
use crate::doc::jobs::CancelFlag;
use crate::doc::open::{load_text, Loaded, OpenOptions};
use crate::doc::repair::repair;
use crate::doc::schema_validate::{self, SchemaCompileError};
use crate::doc::search::SearchOptions;
use crate::doc::typegen::{self, PrimitiveKind, TypeShape, TypegenLang};
use crate::doc::types::{DocError, NodeKind, Path, PathSegment};

pub(crate) const USAGE: &str = "\
Commands, for scripts and AI agents (print to stdout, open no window):
  pandia get <file> <path>              print the value at a path, like $.items[0] or /items/0
  pandia shape <file> [path]            print the keys, types and counts
  pandia validate <file> --schema <s>   check the file against a JSON Schema (path or URL)
  pandia diff <a> <b>                   list what changed between two files
  pandia search <file> <text>           list the paths whose key or value contains the text
  pandia types <file> --lang <lang>     generate types: ts, zod, rust, go, python, java, ...
  pandia convert <file> --to <format>   convert to json, json-min, yaml, csv or xml
  pandia repair <file>                  fix broken JSON and print it
  Use - as <file> to read stdin. Run pandia <command> --help for its options.
  Exit codes: 0 done or yes, 1 no (not found, invalid, different), 2 a mistake or an unreadable file.
";

const SEARCH_LIMIT: u32 = 1000;
const SCHEMA_FETCH_TIMEOUT: Duration = Duration::from_secs(30);

struct Command {
    name: &'static str,
    help: &'static str,
    values: &'static [&'static str],
    switches: &'static [&'static str],
    run: fn(&Args, &mut dyn Read) -> Result<Answer, String>,
}

const COMMANDS: &[Command] = &[
    Command {
        name: "get",
        help: "\
Usage: pandia get <file> <path>

Prints the JSON value at <path>. Write the path the way Pandia shows it, like
$.items[0].name or $[\"first name\"], or as a JSON Pointer, like /items/0/name.
Works on files of any size. Exits 1 if the path doesn't exist, and says why on stderr.
",
        values: &[],
        switches: &[],
        run: get,
    },
    Command {
        name: "shape",
        help: "\
Usage: pandia shape <file> [path]

Prints what the document holds without printing the data: its kind, item count and a
sketch of its types, like {\"id\": \"integer\", \"tags\": [\"string\"], \"email?\": \"string\"}.
A key ending in ? is missing from some items, and \"string | null\" is sometimes null.
Arrays are sampled, so a huge file is fast.
",
        values: &[],
        switches: &[],
        run: shape,
    },
    Command {
        name: "validate",
        help: "\
Usage: pandia validate <file> --schema <path|url>

Checks the file against a JSON Schema and prints {\"valid\", \"errorCount\", \"errors\"},
where each error has a JSON Pointer to the value and a message. Exits 0 if valid, 1 if not.
",
        values: &["--schema"],
        switches: &[],
        run: validate,
    },
    Command {
        name: "diff",
        help: "\
Usage: pandia diff <a> <b>

Compares two documents by structure, so reordered keys aren't changes, and prints each
added, removed, changed or moved value with its path and its values before and after.
Exits 0 if they match, 1 if they differ.
",
        values: &[],
        switches: &[],
        run: diff,
    },
    Command {
        name: "search",
        help: "\
Usage: pandia search <file> <text> [--case-sensitive] [--limit <n>]

Prints the path of every key or value that contains <text>, ignoring case unless
--case-sensitive. Stops after --limit matches (1000 by default). Exits 1 if nothing matches.
",
        values: &["--limit"],
        switches: &["--case-sensitive"],
        run: search,
    },
    Command {
        name: "types",
        help: "\
Usage: pandia types <file> --lang <lang> [--name <TypeName>]

Generates types from the document, like the Types panel. <lang> is one of:
ts, zod, rust, go, python, java, kotlin, php, dart, json-schema.
",
        values: &["--lang", "--name"],
        switches: &[],
        run: types,
    },
    Command {
        name: "convert",
        help: "\
Usage: pandia convert <file> --to <format>

Converts the document to json, json-min, yaml, csv or xml. The input can be JSON, YAML,
XML or CSV. CSV output needs an array of objects.
",
        values: &["--to"],
        switches: &[],
        run: convert,
    },
    Command {
        name: "repair",
        help: "\
Usage: pandia repair <file>

Fixes broken JSON, such as trailing commas, comments, single quotes or a cut-off end, and
prints the result. Lists each fix on stderr. Exits 2 if the file can't be repaired.
",
        values: &[],
        switches: &[],
        run: repair_cmd,
    },
];

#[derive(Debug, Default, PartialEq)]
pub(crate) struct Answer {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl Answer {
    fn json(code: i32, value: &impl serde::Serialize) -> Self {
        let mut stdout = serde_json::to_string_pretty(value).unwrap_or_default();
        stdout.push('\n');
        Answer {
            code,
            stdout,
            stderr: String::new(),
        }
    }

    fn text(mut stdout: String) -> Self {
        if !stdout.ends_with('\n') {
            stdout.push('\n');
        }
        Answer {
            stdout,
            ..Answer::default()
        }
    }

    fn no(message: String) -> Self {
        Answer {
            code: 1,
            stderr: message,
            ..Answer::default()
        }
    }
}

pub(crate) fn run(args: &[String]) -> Option<i32> {
    let answer = answer(args, &mut std::io::stdin().lock())?;
    print!("{}", answer.stdout);
    for line in answer.stderr.lines() {
        eprintln!("pandia: {line}");
    }
    Some(answer.code)
}

fn answer(args: &[String], stdin: &mut dyn Read) -> Option<Answer> {
    let command = COMMANDS
        .iter()
        .find(|c| Some(c.name) == args.first().map(String::as_str))?;
    let rest = &args[1..];
    if rest.iter().any(|a| a == "-h" || a == "--help") {
        return Some(Answer::text(command.help.to_string()));
    }
    let result = Args::parse(rest, command).and_then(|args| (command.run)(&args, stdin));
    Some(result.unwrap_or_else(|message| Answer {
        code: 2,
        stderr: message,
        ..Answer::default()
    }))
}

struct Args {
    command: &'static str,
    positional: Vec<String>,
    values: HashMap<&'static str, String>,
    switches: Vec<&'static str>,
}

impl Args {
    fn parse(args: &[String], command: &Command) -> Result<Self, String> {
        let mut out = Args {
            command: command.name,
            positional: Vec::new(),
            values: HashMap::new(),
            switches: Vec::new(),
        };
        let mut args = args.iter();
        while let Some(arg) = args.next() {
            if arg == "--" {
                out.positional.extend(args.by_ref().cloned());
                break;
            }
            if arg == "-" || !arg.starts_with('-') {
                out.positional.push(arg.clone());
                continue;
            }
            let (flag, inline) = match arg.split_once('=') {
                Some((flag, value)) => (flag, Some(value.to_string())),
                None => (arg.as_str(), None),
            };
            if let Some(name) = command.values.iter().find(|v| **v == flag) {
                let value = inline.or_else(|| args.next().cloned()).ok_or_else(|| {
                    format!(
                        "{name} needs a value after it. Run pandia {} --help.",
                        command.name
                    )
                })?;
                out.values.insert(name, value);
            } else if let Some(name) = command.switches.iter().find(|s| **s == flag) {
                out.switches.push(name);
            } else {
                return Err(format!(
                    "{arg} isn't an option of pandia {}. Run pandia {} --help.",
                    command.name, command.name
                ));
            }
        }
        Ok(out)
    }

    fn files<const N: usize>(&self, min: usize) -> Result<[Option<&str>; N], String> {
        let n = self.positional.len();
        if n < min || n > N {
            let usage = COMMANDS
                .iter()
                .find(|c| c.name == self.command)
                .and_then(|c| c.help.lines().next())
                .unwrap_or_default();
            return Err(usage.to_string());
        }
        Ok(std::array::from_fn(|i| {
            self.positional.get(i).map(String::as_str)
        }))
    }

    fn value(&self, flag: &str) -> Option<&str> {
        self.values.get(flag).map(String::as_str)
    }

    fn required(&self, flag: &str, example: &str) -> Result<&str, String> {
        self.value(flag)
            .ok_or_else(|| format!("pandia {} needs {flag}, like: {example}", self.command))
    }
}

struct Input {
    name: String,
    text: String,
}

fn read_input(arg: &str, stdin: &mut dyn Read) -> Result<Input, String> {
    if arg == "-" {
        let mut text = String::new();
        stdin
            .take(MAX_DOC_BYTES + 1)
            .read_to_string(&mut text)
            .map_err(|_| {
                "What was piped in isn't UTF-8 text, so it can't be read as JSON.".to_string()
            })?;
        if text.len() as u64 > MAX_DOC_BYTES {
            return Err(format!(
                "What was piped in is larger than {}, the most Pandia can read.",
                size(MAX_DOC_BYTES)
            ));
        }
        return Ok(Input {
            name: "stdin".into(),
            text,
        });
    }
    let text =
        Document::read_text_file(std::path::Path::new(arg)).map_err(|e| describe(&e, arg))?;
    Ok(Input {
        name: arg.to_string(),
        text,
    })
}

fn open(input: Input) -> Result<(Document, String), String> {
    let Input { name, text } = input;
    let loaded = load_text(
        text,
        Some(name.clone()),
        None,
        OpenOptions::default(),
        EDIT_SIZE_LIMIT,
    )
    .map_err(|e| describe(&e, &name))?;
    match loaded {
        Loaded::Opened(doc, _) => Ok((*doc, name)),
        Loaded::Failed(f) if f.too_large_to_fix => {
            Err(format!("{name} isn't valid JSON: {}.", f.detail))
        }
        Loaded::Failed(f) => Err(format!(
            "{name} isn't valid JSON: {}. Run pandia repair {} to fix what can be fixed.",
            f.detail,
            if name == "stdin" { "-" } else { &name }
        )),
    }
}

fn open_arg(arg: &str, stdin: &mut dyn Read) -> Result<(Document, String), String> {
    open(read_input(arg, stdin)?)
}

fn describe(e: &DocError, name: &str) -> String {
    use std::io::ErrorKind;
    match e {
        DocError::Io { source, .. } => match source.kind() {
            ErrorKind::NotFound => format!("There's no file at {name}. Check the path."),
            ErrorKind::PermissionDenied => {
                format!("Pandia doesn't have permission to read {name}.")
            }
            ErrorKind::IsADirectory => format!("{name} is a folder, not a file."),
            ErrorKind::InvalidData => {
                format!("{name} isn't UTF-8 text, so it can't be read as JSON.")
            }
            _ => format!("Couldn't read {name}: {source}."),
        },
        DocError::TooLarge { actual, limit } => format!(
            "{name} is {}, more than the {} this command can read at once.",
            size(*actual),
            size(*limit)
        ),
        DocError::TooDeep { limit } => {
            format!("{name} is nested more than {limit} levels deep, more than Pandia supports.")
        }
        other => format!("{name}: {other}."),
    }
}

fn size(bytes: u64) -> String {
    const MB: f64 = 1024.0 * 1024.0;
    let mb = bytes as f64 / MB;
    if mb >= 1024.0 {
        format!("{:.1} GB", mb / 1024.0)
    } else {
        format!("{mb:.1} MB")
    }
}

fn resolve(doc: &Document, arg: &str) -> Result<Path, String> {
    let Some(pointer) = arg.strip_prefix('/') else {
        return arg.parse::<Path>().map_err(|e| {
            format!("{arg} isn't a path Pandia can read: {e}. Write it like $.items[0].name or /items/0/name.")
        });
    };
    let mut path = Path::root();
    for token in pointer.split('/') {
        let token = token.replace("~1", "/").replace("~0", "~");
        let seg = match (doc.kind_at(&path), token.parse::<u32>()) {
            (Ok((NodeKind::Array, _)), Ok(i)) => PathSegment::Index(i),
            _ => PathSegment::Key(token),
        };
        path.push(seg);
    }
    Ok(path)
}

fn explain_missing(doc: &Document, path: &Path) -> String {
    let mut at = Path::root();
    for seg in &path.0 {
        let mut next = at.clone();
        next.push(seg.clone());
        if doc.kind_at(&next).is_ok() {
            at = next;
            continue;
        }
        let why = match (doc.kind_at(&at), seg) {
            (Ok((NodeKind::Array, Some(0))), _) => format!("{at} is an empty array."),
            (Ok((NodeKind::Array, Some(n))), PathSegment::Index(_)) => {
                format!("{at} has {n} items, so the last is {at}[{}].", n - 1)
            }
            (Ok((NodeKind::Array, _)), PathSegment::Key(k)) => {
                format!("{at} is an array, so it has no key {k:?}. Use an index, like {at}[0].")
            }
            (Ok((NodeKind::Object, _)), PathSegment::Key(k)) => format!("{at} has no key {k:?}."),
            (Ok((NodeKind::Object, _)), PathSegment::Index(i)) => {
                format!("{at} is an object, so it has no [{i}]. Use a key, like {at}[\"{i}\"].")
            }
            (Ok((kind, _)), _) => format!("{at} is {}, so nothing is inside it.", kind_name(kind)),
            (Err(_), _) => String::new(),
        };
        return format!("{path} doesn't exist. {why}")
            .trim_end()
            .to_string();
    }
    format!("{path} doesn't exist.")
}

fn kind_name(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Object => "an object",
        NodeKind::Array => "an array",
        NodeKind::String => "a string",
        NodeKind::Number => "a number",
        NodeKind::Bool => "true or false",
        NodeKind::Null => "null",
    }
}

fn get(args: &Args, stdin: &mut dyn Read) -> Result<Answer, String> {
    let [Some(file), Some(at)] = args.files::<2>(2)? else {
        unreachable!("files::<2>(2) returns two names")
    };
    let (doc, name) = open_arg(file, stdin)?;
    let path = resolve(&doc, at)?;
    match doc.get_value(&path) {
        Ok(value) => Ok(Answer::json(0, &value)),
        Err(DocError::InvalidPath(_)) => Ok(Answer::no(explain_missing(&doc, &path))),
        Err(e) => Err(describe(&e, &name)),
    }
}

fn shape(args: &Args, stdin: &mut dyn Read) -> Result<Answer, String> {
    let [Some(file), at] = args.files::<2>(1)? else {
        unreachable!("files::<2>(1) returns a file name")
    };
    let (doc, name) = open_arg(file, stdin)?;
    let path = match at {
        Some(at) => resolve(&doc, at)?,
        None => Path::root(),
    };
    let Ok((kind, count)) = doc.kind_at(&path) else {
        return Ok(Answer::no(explain_missing(&doc, &path)));
    };
    let shape = if path.is_root() {
        doc.infer_shape()
    } else {
        typegen::infer(&doc.get_value(&path).map_err(|e| describe(&e, &name))?)
    };

    let count = match (&shape, count) {
        (TypeShape::Object(props), None) if kind == NodeKind::Object => Some(props.len() as u32),
        _ => count,
    };
    let mut out = Map::new();
    out.insert("path".into(), path.to_string().into());
    out.insert("kind".into(), json!(kind));
    if let Some(count) = count {
        out.insert("count".into(), count.into());
    }
    if path.is_root() {
        out.insert("bytes".into(), doc.summary().source_size.into());
    }
    out.insert("shape".into(), sketch(&shape));
    Ok(Answer::json(0, &out))
}

fn sketch(shape: &TypeShape) -> Value {
    match shape {
        TypeShape::Primitive(p) => match p {
            PrimitiveKind::Null => "null",
            PrimitiveKind::Bool => "boolean",
            PrimitiveKind::Integer | PrimitiveKind::Unsigned => "integer",
            PrimitiveKind::Float => "number",
            PrimitiveKind::String => "string",
            PrimitiveKind::Any => "any",
        }
        .into(),
        TypeShape::Array(item) => Value::Array(vec![sketch(item)]),
        TypeShape::Object(props) => Value::Object(
            props
                .iter()
                .map(|(k, p)| {
                    let key = if p.optional {
                        format!("{k}?")
                    } else {
                        k.clone()
                    };
                    let value = match sketch(&p.shape) {
                        Value::String(ty) if p.nullable => format!("{ty} | null").into(),
                        other => other,
                    };
                    (key, value)
                })
                .collect(),
        ),
        TypeShape::Unknown => "unknown".into(),
    }
}

fn validate(args: &Args, stdin: &mut dyn Read) -> Result<Answer, String> {
    let [Some(file)] = args.files::<1>(1)? else {
        unreachable!("files::<1>(1) returns a file name")
    };
    let schema = args.required("--schema", "pandia validate data.json --schema schema.json")?;
    let schema_text = read_schema(schema)?;

    schema_validate::validate(&Value::Null, &schema_text).map_err(|e| match e {
        SchemaCompileError::Parse(detail) => {
            format!("The schema {schema} can't be used: it isn't valid JSON: {detail}.")
        }
        SchemaCompileError::Compile(detail) => format!("The schema {schema} can't be used: {detail}."),
        SchemaCompileError::ExternalRef(url) => format!(
            "The schema {schema} points to another schema at {url}, which Pandia doesn't load. Copy the definitions it needs into the schema under \"$defs\"."
        ),
    })?;
    let (doc, name) = open_arg(file, stdin)?;
    let result = doc
        .validate_schema(&schema_text)
        .map_err(|e| describe(&e, &name))?;
    let errors: Vec<Value> = result
        .errors
        .iter()
        .map(|e| json!({ "pointer": e.instance_path, "message": e.message }))
        .collect();
    Ok(Answer::json(
        i32::from(!result.valid),
        &json!({
            "valid": result.valid,
            "errorCount": result.error_count,
            "truncated": result.truncated,
            "errors": errors,
        }),
    ))
}

fn read_schema(schema: &str) -> Result<String, String> {
    if !(schema.starts_with("http://") || schema.starts_with("https://")) {
        return std::fs::read_to_string(schema).map_err(|e| describe(&DocError::from(e), schema));
    }
    let unreachable = || {
        format!("Couldn't download the schema from {schema}. Check the URL and your connection.")
    };
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| unreachable())?;
    runtime.block_on(async {
        use tauri_plugin_http::reqwest;
        let response = reqwest::Client::builder()
            .timeout(SCHEMA_FETCH_TIMEOUT)
            .build()
            .map_err(|_| unreachable())?
            .get(schema)
            .send()
            .await
            .map_err(|_| unreachable())?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!(
                "Couldn't download the schema from {schema}: the server answered {status}."
            ));
        }
        response.text().await.map_err(|_| unreachable())
    })
}

fn diff(args: &Args, stdin: &mut dyn Read) -> Result<Answer, String> {
    let [Some(a), Some(b)] = args.files::<2>(2)? else {
        unreachable!("files::<2>(2) returns two names")
    };
    if a == "-" && b == "-" {
        return Err("Only one side of pandia diff can be read from stdin.".into());
    }
    let whole = |arg: &str, stdin: &mut dyn Read| -> Result<Value, String> {
        let (doc, name) = open_arg(arg, stdin)?;
        doc.get_value(&Path::root())
            .map_err(|e| describe(&e, &name))
    };
    let (left, right) = (whole(a, stdin)?, whole(b, stdin)?);
    let entries = compute_diff(&left, &right, &CancelFlag::never()).map_err(|e| describe(&e, a))?;
    let changes: Vec<Value> = entries
        .iter()
        .map(|e| {
            let from = e.left_path.as_ref().unwrap_or(&e.path);
            let mut entry = Map::new();
            entry.insert("kind".into(), json!(e.kind));
            entry.insert("path".into(), e.path.to_string().into());
            if e.kind == DiffKind::Moved {
                entry.insert("from".into(), from.to_string().into());
            }
            if matches!(e.kind, DiffKind::Removed | DiffKind::Changed) {
                entry.insert(
                    "before".into(),
                    value_at(&left, from).cloned().unwrap_or(Value::Null),
                );
            }
            if matches!(e.kind, DiffKind::Added | DiffKind::Changed) {
                entry.insert(
                    "after".into(),
                    value_at(&right, &e.path).cloned().unwrap_or(Value::Null),
                );
            }
            Value::Object(entry)
        })
        .collect();
    Ok(Answer::json(
        i32::from(!changes.is_empty()),
        &json!({ "changes": changes.len(), "entries": changes }),
    ))
}

fn value_at<'a>(root: &'a Value, path: &Path) -> Option<&'a Value> {
    path.0.iter().try_fold(root, |v, seg| match seg {
        PathSegment::Key(k) => v.get(k),
        PathSegment::Index(i) => v.get(*i as usize),
    })
}

fn search(args: &Args, stdin: &mut dyn Read) -> Result<Answer, String> {
    let [Some(file), Some(query)] = args.files::<2>(2)? else {
        unreachable!("files::<2>(2) returns two names")
    };
    if query.is_empty() {
        return Err("pandia search needs some text to look for.".into());
    }
    let limit = match args.value("--limit") {
        Some(n) => n
            .parse::<u32>()
            .ok()
            .filter(|n| *n > 0)
            .ok_or_else(|| format!("--limit needs a whole number above 0, not {n}."))?,
        None => SEARCH_LIMIT,
    };
    let (doc, name) = open_arg(file, stdin)?;
    let opts = SearchOptions {
        query: query.to_string(),
        case_sensitive: args.switches.contains(&"--case-sensitive"),
        max_results: Some(limit),
    };
    let hits = doc
        .search(&opts, &CancelFlag::never())
        .map_err(|e| describe(&e, &name))?;
    let found: Vec<Value> = hits
        .iter()
        .map(|h| json!({ "path": h.path.to_string(), "in": h.match_field, "snippet": h.snippet }))
        .collect();
    Ok(Answer::json(
        i32::from(found.is_empty()),
        &json!({ "matches": found.len(), "limitReached": found.len() as u32 >= limit, "hits": found }),
    ))
}

fn types(args: &Args, stdin: &mut dyn Read) -> Result<Answer, String> {
    let [Some(file)] = args.files::<1>(1)? else {
        unreachable!("files::<1>(1) returns a file name")
    };
    let lang = args.required("--lang", "pandia types data.json --lang ts")?;
    let wire = match lang {
        "ts" => "typescript",
        "py" => "python",
        "rs" => "rust",
        other => other,
    };
    let lang: TypegenLang = serde_json::from_value(wire.into()).map_err(|_| {
        format!("{lang} isn't a language Pandia generates. Use ts, zod, rust, go, python, java, kotlin, php, dart or json-schema.")
    })?;
    let (doc, name) = open_arg(file, stdin)?;
    let code = doc
        .generate_types(lang, args.value("--name").unwrap_or("Root"))
        .map_err(|e| describe(&e, &name))?;
    Ok(Answer::text(code))
}

fn convert(args: &Args, stdin: &mut dyn Read) -> Result<Answer, String> {
    let [Some(file)] = args.files::<1>(1)? else {
        unreachable!("files::<1>(1) returns a file name")
    };
    let to = args.required("--to", "pandia convert data.yaml --to json")?;
    let format: ExportFormat = serde_json::from_value(to.into()).map_err(|_| {
        format!("{to} isn't a format Pandia converts to. Use json, json-min, yaml, csv or xml.")
    })?;
    let (doc, name) = open_arg(file, stdin)?;
    let text = doc.export(format).map_err(|e| match e {
        DocError::Export(detail) => format!("Couldn't convert {name} to {to}: {detail}."),
        other => describe(&other, &name),
    })?;
    Ok(Answer::text(text))
}

fn repair_cmd(args: &Args, stdin: &mut dyn Read) -> Result<Answer, String> {
    let [Some(file)] = args.files::<1>(1)? else {
        unreachable!("files::<1>(1) returns a file name")
    };
    let Input { name, text } = read_input(file, stdin)?;
    let parses = |s: &str| serde_json::from_str::<serde::de::IgnoredAny>(s);
    let Err(problem) = parses(&text) else {
        return Ok(Answer {
            stderr: format!("{name} is already valid JSON, so nothing changed."),
            ..Answer::text(text)
        });
    };
    if text.len() as u64 > EDIT_SIZE_LIMIT {
        return Err(format!(
            "{name} is {}, more than the {} Pandia can repair.",
            size(text.len() as u64),
            size(EDIT_SIZE_LIMIT)
        ));
    }
    match repair(&text).filter(|r| parses(&r.json).is_ok()) {
        Some(fixed) => Ok(Answer {
            stderr: fixed
                .notes
                .iter()
                .map(|n| format!("fixed: {n}\n"))
                .collect(),
            ..Answer::text(fixed.json)
        }),
        None => Err(format!("Pandia couldn't repair {name}: {problem}.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_with(args: &[&str], stdin: &str) -> Answer {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        answer(&args, &mut stdin.as_bytes()).expect("a headless command")
    }

    fn stdout_json(a: &Answer) -> Value {
        serde_json::from_str(&a.stdout).unwrap_or_else(|e| panic!("{e}: {}", a.stdout))
    }

    const USERS: &str = r#"{"users":[{"id":1,"name":"Ada","tags":["x"]},{"id":2,"name":"Lin","email":"l@x.dev","tags":[]}],"first name":"A"}"#;

    fn temp_file(contents: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!(
            "pandia-headless-{}.json",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::write(&path, contents).unwrap();
        path
    }

    #[test]
    fn only_command_names_are_headless_so_files_still_open_in_the_app() {
        let args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(answer(&args(&["data.json"]), &mut "".as_bytes()).is_none());
        assert!(answer(&args(&["--diff", "a", "b"]), &mut "".as_bytes()).is_none());
        assert!(answer(&args(&[]), &mut "".as_bytes()).is_none());
    }

    #[test]
    fn get_prints_the_value_at_a_path_or_a_pointer() {
        let a = run_with(&["get", "-", "$.users[1].name"], USERS);
        assert_eq!((a.code, a.stdout.as_str()), (0, "\"Lin\"\n"));
        let a = run_with(&["get", "-", "/users/0/tags"], USERS);
        assert_eq!(stdout_json(&a), json!(["x"]));
        let a = run_with(&["get", "-", r#"$["first name"]"#], USERS);
        assert_eq!(stdout_json(&a), json!("A"));
        let a = run_with(&["get", "-", "$"], r#"{"n":12345678901234567890.5}"#);
        assert_eq!(a.stdout, "{\n  \"n\": 12345678901234567890.5\n}\n");
    }

    #[test]
    fn a_pointer_step_is_an_index_only_inside_an_array() {
        let a = run_with(&["get", "-", "/0/1"], r#"{"0":["a","b"]}"#);
        assert_eq!(stdout_json(&a), json!("b"));
    }

    #[test]
    fn a_missing_path_exits_1_and_says_where_it_stops() {
        let a = run_with(&["get", "-", "$.users[5].name"], USERS);
        assert_eq!(a.code, 1);
        assert_eq!(a.stdout, "");
        assert_eq!(
            a.stderr,
            "$.users[5].name doesn't exist. $.users has 2 items, so the last is $.users[1]."
        );
        let a = run_with(&["get", "-", "$.users[0].mail"], USERS);
        assert_eq!(
            a.stderr,
            "$.users[0].mail doesn't exist. $.users[0] has no key \"mail\"."
        );
        let a = run_with(&["get", "-", "$.users[0].name.first"], USERS);
        assert_eq!(
            a.stderr,
            "$.users[0].name.first doesn't exist. $.users[0].name is a string, so nothing is inside it."
        );
    }

    #[test]
    fn mistakes_and_unreadable_input_exit_2_in_plain_words() {
        let a = run_with(&["get", "-"], USERS);
        assert_eq!(
            (a.code, a.stderr.as_str()),
            (2, "Usage: pandia get <file> <path>")
        );
        let a = run_with(&["get", "-", "$.users[x]"], USERS);
        assert_eq!(a.code, 2);
        assert!(
            a.stderr
                .starts_with("$.users[x] isn't a path Pandia can read"),
            "{}",
            a.stderr
        );
        let a = run_with(&["get", "/no/such/file.json", "$"], "");
        assert_eq!(
            (a.code, a.stderr.as_str()),
            (2, "There's no file at /no/such/file.json. Check the path.")
        );
        let a = run_with(&["get", "-", "$", "--fast"], USERS);
        assert_eq!(
            (a.code, a.stderr.as_str()),
            (
                2,
                "--fast isn't an option of pandia get. Run pandia get --help."
            )
        );
        let a = run_with(&["get", "-", "$"], r#"{"a":1,}x"#);
        assert_eq!(a.code, 2);
        assert!(
            a.stderr.starts_with("stdin isn't valid JSON: "),
            "{}",
            a.stderr
        );
        assert!(
            a.stderr
                .ends_with("Run pandia repair - to fix what can be fixed."),
            "{}",
            a.stderr
        );
    }

    #[test]
    fn help_describes_the_command_and_exits_0() {
        let a = run_with(&["shape", "--help"], "");
        assert_eq!(a.code, 0);
        assert!(a.stdout.starts_with("Usage: pandia shape <file> [path]"));
    }

    #[test]
    fn yaml_input_is_read_like_the_app_reads_it() {
        let a = run_with(&["get", "-", "$.server.port"], "server:\n  port: 8080\n");
        assert_eq!(stdout_json(&a), json!(8080));
    }

    #[test]
    fn shape_sketches_types_and_marks_keys_some_items_lack() {
        let a = run_with(&["shape", "-"], USERS);
        assert_eq!(a.code, 0);
        assert_eq!(
            stdout_json(&a),
            json!({
                "path": "$",
                "kind": "object",
                "count": 2,
                "bytes": USERS.len(),
                "shape": {
                    "first name": "string",
                    "users": [{"email?": "string", "id": "integer", "name": "string", "tags": ["string"]}]
                }
            })
        );
        let a = run_with(&["shape", "-", "$.users"], USERS);
        let out = stdout_json(&a);
        assert_eq!(
            (out["kind"].clone(), out["count"].clone()),
            (json!("array"), json!(2))
        );
        assert!(out.get("bytes").is_none());
    }

    #[test]
    fn shape_shows_a_field_that_is_sometimes_null() {
        let a = run_with(
            &["shape", "-"],
            r#"[{"email":"a@x.dev","n":1},{"email":null,"n":2}]"#,
        );
        assert_eq!(
            stdout_json(&a)["shape"],
            json!([{"email": "string | null", "n": "integer"}])
        );
    }

    #[test]
    fn shape_counts_the_root_of_a_large_file_too() {
        let big = format!(
            r#"{{"items":[{}0],"meta":{{}}}}"#,
            "1234567,".repeat(1_400_000)
        );
        let out = stdout_json(&run_with(&["shape", "-"], &big));
        assert_eq!(out["count"], json!(2));
        assert_eq!(out["shape"]["items"], json!(["integer"]));
        let big = format!("[{}0]", "1234567,".repeat(1_400_000));
        let out = stdout_json(&run_with(&["shape", "-"], &big));
        assert_eq!(out["count"], json!(1_400_001));
    }

    #[test]
    fn a_broken_schema_is_reported_before_the_document_is_read() {
        let schema = temp_file("{ not json");
        let a = run_with(
            &[
                "validate",
                "/no/such/data.json",
                "--schema",
                schema.to_str().unwrap(),
            ],
            "",
        );
        assert_eq!(a.code, 2);
        assert!(a.stderr.contains("can't be used"), "{}", a.stderr);
        std::fs::remove_file(schema).unwrap();
    }

    #[test]
    fn validate_reports_each_error_with_a_pointer_and_exits_1() {
        let schema = temp_file(r#"{"type":"object","properties":{"id":{"type":"integer"}}}"#);
        let schema = schema.to_str().unwrap();
        let a = run_with(&["validate", "-", "--schema", schema], r#"{"id":"seven"}"#);
        assert_eq!(a.code, 1);
        let out = stdout_json(&a);
        assert_eq!(out["valid"], json!(false));
        assert_eq!(out["errorCount"], json!(1));
        assert_eq!(out["errors"][0]["pointer"], json!("/id"));
        let a = run_with(
            &["validate", "-", &format!("--schema={schema}")],
            r#"{"id":7}"#,
        );
        assert_eq!((a.code, stdout_json(&a)["valid"].clone()), (0, json!(true)));
        let a = run_with(&["validate", "-"], "{}");
        assert_eq!(a.code, 2);
        assert!(
            a.stderr.starts_with("pandia validate needs --schema"),
            "{}",
            a.stderr
        );
        std::fs::remove_file(schema).unwrap();
    }

    #[test]
    fn diff_lists_changes_with_paths_and_full_values() {
        let old = temp_file(r#"{"a":1,"b":{"c":[1,2]},"gone":true}"#);
        let a = run_with(
            &["diff", old.to_str().unwrap(), "-"],
            r#"{"b":{"c":[1,2,3]},"a":2,"new":"x"}"#,
        );
        assert_eq!(a.code, 1);
        let out = stdout_json(&a);
        let entries = out["entries"].as_array().unwrap();
        assert_eq!(out["changes"], json!(entries.len()));
        assert!(
            entries.contains(&json!({"kind": "changed", "path": "$.a", "before": 1, "after": 2}))
        );
        assert!(entries.contains(&json!({"kind": "removed", "path": "$.gone", "before": true})));
        assert!(entries.contains(&json!({"kind": "added", "path": "$.new", "after": "x"})));
        assert!(entries.contains(&json!({"kind": "added", "path": "$.b.c[2]", "after": 3})));

        let same = run_with(
            &["diff", old.to_str().unwrap(), "-"],
            r#"{"gone":true,"b":{"c":[1,2]},"a":1}"#,
        );
        assert_eq!(
            (same.code, stdout_json(&same)["changes"].clone()),
            (0, json!(0))
        );
        std::fs::remove_file(old).unwrap();
    }

    #[test]
    fn search_lists_matching_paths_and_exits_1_when_nothing_matches() {
        let a = run_with(&["search", "-", "ada"], USERS);
        assert_eq!(a.code, 0);
        let out = stdout_json(&a);
        assert_eq!(out["matches"], json!(1));
        assert_eq!(out["hits"][0]["path"], json!("$.users[0].name"));
        assert_eq!(out["hits"][0]["in"], json!("value"));
        assert_eq!(
            run_with(&["search", "-", "ada", "--case-sensitive"], USERS).code,
            1
        );
        let a = run_with(&["search", "-", "a", "--limit", "1"], USERS);
        assert_eq!(stdout_json(&a)["limitReached"], json!(true));
    }

    #[test]
    fn types_and_convert_print_what_the_app_would_export() {
        let a = run_with(
            &["types", "-", "--lang", "ts", "--name", "User"],
            r#"{"id":1}"#,
        );
        assert_eq!(a.code, 0);
        assert!(a.stdout.contains("User"), "{}", a.stdout);
        assert!(a.stdout.contains("id: number"), "{}", a.stdout);
        let a = run_with(&["types", "-", "--lang", "cobol"], "{}");
        assert_eq!(a.code, 2);

        let a = run_with(&["convert", "-", "--to", "yaml"], r#"{"a":[1,2]}"#);
        assert_eq!((a.code, a.stdout.as_str()), (0, "a:\n  - 1\n  - 2\n"));
        let a = run_with(&["convert", "-", "--to", "json-min"], "a: 1\n");
        assert_eq!(a.stdout, "{\"a\":1}\n");
    }

    #[test]
    fn repair_prints_fixed_json_and_lists_each_fix() {
        let a = run_with(&["repair", "-"], "{\"a\": 1,}");
        assert_eq!(a.code, 0);
        assert_eq!(stdout_json(&a), json!({"a": 1}));
        assert!(a.stderr.starts_with("fixed: "), "{}", a.stderr);
        let a = run_with(&["repair", "-"], "{\"a\":1}");
        assert_eq!((a.code, a.stdout.as_str()), (0, "{\"a\":1}\n"));
        assert_eq!(a.stderr, "stdin is already valid JSON, so nothing changed.");
        let a = run_with(&["repair", "-"], "not json at all");
        assert_eq!(a.code, 2);
    }
}

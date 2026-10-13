use serde::Serialize;
use std::io::{BufReader, Read};

const MAX_DEPTH: usize = 128;
const MAX_KEY_BYTES: usize = 64 * 1024;
const MAX_PREVIEW_BYTES: usize = 500;
pub const MAX_TREE_CHILDREN: usize = 50;

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TreeKind {
    Object,
    Array,
    String,
    Number,
    Boolean,
    Null,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNodeSummary {
    pub kind: TreeKind,
    pub text: String,
    pub child_count: Option<usize>,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeChild {
    pub index: usize,
    pub key: String,
    pub node: TreeNodeSummary,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreePage {
    pub node: TreeNodeSummary,
    pub children: Vec<TreeChild>,
    pub offset: usize,
    pub total_children: usize,
    pub has_more: bool,
}

struct StringToken {
    raw: String,
    decoded: Option<String>,
    truncated: bool,
}

struct Scanner<R: Read> {
    reader: BufReader<R>,
    peeked: Option<Option<u8>>,
}

impl<R: Read> Scanner<R> {
    fn new(reader: R) -> Self {
        Self {
            reader: BufReader::new(reader),
            peeked: None,
        }
    }

    fn peek(&mut self) -> Result<Option<u8>, String> {
        if let Some(value) = self.peeked {
            return Ok(value);
        }
        let mut byte = [0];
        let value = match self.reader.read(&mut byte).map_err(|e| e.to_string())? {
            0 => None,
            _ => Some(byte[0]),
        };
        self.peeked = Some(value);
        Ok(value)
    }

    fn next(&mut self) -> Result<Option<u8>, String> {
        if let Some(value) = self.peeked.take() {
            return Ok(value);
        }
        let mut byte = [0];
        match self.reader.read(&mut byte).map_err(|e| e.to_string())? {
            0 => Ok(None),
            _ => Ok(Some(byte[0])),
        }
    }

    fn expect(&mut self, expected: u8) -> Result<(), String> {
        match self.next()? {
            Some(actual) if actual == expected => Ok(()),
            _ => Err(format!("Expected '{}'", expected as char)),
        }
    }

    fn whitespace(&mut self) -> Result<(), String> {
        while matches!(self.peek()?, Some(b' ' | b'\t' | b'\r' | b'\n')) {
            self.next()?;
        }
        Ok(())
    }

    fn string(&mut self, limit: usize, decode: bool) -> Result<StringToken, String> {
        self.expect(b'"')?;
        let mut captured = vec![b'"'];
        let mut truncated = false;
        let mut utf8 = Utf8State::default();
        loop {
            let byte = self.next()?.ok_or("Unterminated string")?;
            capture(&mut captured, byte, limit, &mut truncated);
            match byte {
                b'"' if utf8.complete() => break,
                b'\\' => {
                    if !utf8.complete() {
                        return Err("Invalid UTF-8 in string".into());
                    }
                    let escaped = self.next()?.ok_or("Unterminated escape")?;
                    capture(&mut captured, escaped, limit, &mut truncated);
                    match escaped {
                        b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => {}
                        b'u' => {
                            for _ in 0..4 {
                                let hex = self.next()?.ok_or("Unterminated unicode escape")?;
                                if !hex.is_ascii_hexdigit() {
                                    return Err("Invalid unicode escape".into());
                                }
                                capture(&mut captured, hex, limit, &mut truncated);
                            }
                        }
                        _ => return Err("Invalid string escape".into()),
                    }
                }
                0..=0x1f => return Err("Control character in string".into()),
                _ => utf8.feed(byte)?,
            }
        }
        let decoded = if decode && !truncated {
            Some(serde_json::from_slice(&captured).map_err(|e| e.to_string())?)
        } else {
            None
        };
        Ok(StringToken {
            raw: String::from_utf8_lossy(&captured).into_owned(),
            decoded,
            truncated,
        })
    }

    fn summary(&mut self, depth: usize) -> Result<TreeNodeSummary, String> {
        if depth > MAX_DEPTH {
            return Err("Tree depth exceeds 128".into());
        }
        self.whitespace()?;
        match self.peek()?.ok_or("Expected JSON value")? {
            b'{' => self.object_summary(depth),
            b'[' => self.array_summary(depth),
            b'"' => {
                let token = self.string(MAX_PREVIEW_BYTES, false)?;
                Ok(TreeNodeSummary {
                    kind: TreeKind::String,
                    text: token.raw,
                    child_count: None,
                    truncated: token.truncated,
                })
            }
            b't' => self.literal(b"true", TreeKind::Boolean),
            b'f' => self.literal(b"false", TreeKind::Boolean),
            b'n' => self.literal(b"null", TreeKind::Null),
            b'-' | b'0'..=b'9' => self.number(),
            _ => Err("Expected JSON value".into()),
        }
    }

    fn object_summary(&mut self, depth: usize) -> Result<TreeNodeSummary, String> {
        self.expect(b'{')?;
        self.whitespace()?;
        let mut count = 0;
        if self.peek()? != Some(b'}') {
            loop {
                self.string(MAX_KEY_BYTES, false)?;
                self.whitespace()?;
                self.expect(b':')?;
                self.summary(depth + 1)?;
                count += 1;
                self.whitespace()?;
                match self.next()? {
                    Some(b',') => self.whitespace()?,
                    Some(b'}') => break,
                    _ => return Err("Expected comma or object end".into()),
                }
            }
        } else {
            self.next()?;
        }
        Ok(container(TreeKind::Object, "{", count))
    }

    fn array_summary(&mut self, depth: usize) -> Result<TreeNodeSummary, String> {
        self.expect(b'[')?;
        self.whitespace()?;
        let mut count = 0;
        if self.peek()? != Some(b']') {
            loop {
                self.summary(depth + 1)?;
                count += 1;
                self.whitespace()?;
                match self.next()? {
                    Some(b',') => self.whitespace()?,
                    Some(b']') => break,
                    _ => return Err("Expected comma or array end".into()),
                }
            }
        } else {
            self.next()?;
        }
        Ok(container(TreeKind::Array, "[", count))
    }

    fn literal(&mut self, literal: &[u8], kind: TreeKind) -> Result<TreeNodeSummary, String> {
        for &byte in literal {
            self.expect(byte)?;
        }
        self.require_delimiter()?;
        Ok(TreeNodeSummary {
            kind,
            text: String::from_utf8_lossy(literal).into_owned(),
            child_count: None,
            truncated: false,
        })
    }

    fn number(&mut self) -> Result<TreeNodeSummary, String> {
        let mut bytes = Vec::new();
        let mut truncated = false;
        if self.peek()? == Some(b'-') {
            capture(
                &mut bytes,
                self.next()?.unwrap(),
                MAX_PREVIEW_BYTES,
                &mut truncated,
            );
        }
        match self.next()? {
            Some(b'0') => capture(&mut bytes, b'0', MAX_PREVIEW_BYTES, &mut truncated),
            Some(first @ b'1'..=b'9') => {
                capture(&mut bytes, first, MAX_PREVIEW_BYTES, &mut truncated);
                while matches!(self.peek()?, Some(b'0'..=b'9')) {
                    capture(
                        &mut bytes,
                        self.next()?.unwrap(),
                        MAX_PREVIEW_BYTES,
                        &mut truncated,
                    );
                }
            }
            _ => return Err("Invalid number".into()),
        }
        if self.peek()? == Some(b'.') {
            capture(
                &mut bytes,
                self.next()?.unwrap(),
                MAX_PREVIEW_BYTES,
                &mut truncated,
            );
            if !matches!(self.peek()?, Some(b'0'..=b'9')) {
                return Err("Invalid fraction".into());
            }
            while matches!(self.peek()?, Some(b'0'..=b'9')) {
                capture(
                    &mut bytes,
                    self.next()?.unwrap(),
                    MAX_PREVIEW_BYTES,
                    &mut truncated,
                );
            }
        }
        if matches!(self.peek()?, Some(b'e' | b'E')) {
            capture(
                &mut bytes,
                self.next()?.unwrap(),
                MAX_PREVIEW_BYTES,
                &mut truncated,
            );
            if matches!(self.peek()?, Some(b'+' | b'-')) {
                capture(
                    &mut bytes,
                    self.next()?.unwrap(),
                    MAX_PREVIEW_BYTES,
                    &mut truncated,
                );
            }
            if !matches!(self.peek()?, Some(b'0'..=b'9')) {
                return Err("Invalid exponent".into());
            }
            while matches!(self.peek()?, Some(b'0'..=b'9')) {
                capture(
                    &mut bytes,
                    self.next()?.unwrap(),
                    MAX_PREVIEW_BYTES,
                    &mut truncated,
                );
            }
        }
        self.require_delimiter()?;
        Ok(TreeNodeSummary {
            kind: TreeKind::Number,
            text: String::from_utf8(bytes).map_err(|e| e.to_string())?,
            child_count: None,
            truncated,
        })
    }

    fn require_delimiter(&mut self) -> Result<(), String> {
        match self.peek()? {
            None | Some(b' ' | b'\t' | b'\r' | b'\n' | b',' | b']' | b'}') => Ok(()),
            _ => Err("Invalid token boundary".into()),
        }
    }

    fn locate(
        &mut self,
        route: &[usize],
        depth: usize,
        offset: usize,
        limit: usize,
    ) -> Result<TreePage, String> {
        if depth == route.len() {
            return self.target(offset, limit, depth);
        }
        if depth > MAX_DEPTH {
            return Err("Tree depth exceeds 128".into());
        }
        self.whitespace()?;
        match self.peek()? {
            Some(b'{') => {
                self.expect(b'{')?;
                self.whitespace()?;
                if self.peek()? == Some(b'}') {
                    return Err("Tree path not found".into());
                }
                let mut index = 0;
                loop {
                    self.string(MAX_KEY_BYTES, false)?;
                    self.whitespace()?;
                    self.expect(b':')?;
                    if index == route[depth] {
                        return self.locate(route, depth + 1, offset, limit);
                    }
                    self.summary(depth + 1)?;
                    index += 1;
                    self.whitespace()?;
                    match self.next()? {
                        Some(b',') => self.whitespace()?,
                        Some(b'}') => return Err("Tree path not found".into()),
                        _ => return Err("Expected comma or object end".into()),
                    }
                }
            }
            Some(b'[') => {
                let target = route[depth];
                self.expect(b'[')?;
                self.whitespace()?;
                let mut index = 0;
                if self.peek()? == Some(b']') {
                    return Err("Tree path not found".into());
                }
                loop {
                    if index == target {
                        return self.locate(route, depth + 1, offset, limit);
                    }
                    self.summary(depth + 1)?;
                    index += 1;
                    self.whitespace()?;
                    match self.next()? {
                        Some(b',') => self.whitespace()?,
                        Some(b']') => return Err("Tree path not found".into()),
                        _ => return Err("Expected comma or array end".into()),
                    }
                }
            }
            _ => Err("Tree path crosses a scalar value".into()),
        }
    }

    fn target(&mut self, offset: usize, limit: usize, depth: usize) -> Result<TreePage, String> {
        self.whitespace()?;
        match self.peek()?.ok_or("Expected JSON value")? {
            b'{' => self.object_page(offset, limit, depth),
            b'[' => self.array_page(offset, limit, depth),
            _ => {
                let node = self.summary(depth)?;
                Ok(TreePage {
                    node,
                    children: vec![],
                    offset: 0,
                    total_children: 0,
                    has_more: false,
                })
            }
        }
    }

    fn object_page(
        &mut self,
        offset: usize,
        limit: usize,
        depth: usize,
    ) -> Result<TreePage, String> {
        self.expect(b'{')?;
        self.whitespace()?;
        let mut children = Vec::new();
        let mut count = 0;
        if self.peek()? != Some(b'}') {
            loop {
                let key = self.string(MAX_KEY_BYTES, true)?;
                self.whitespace()?;
                self.expect(b':')?;
                let node = self.summary(depth + 1)?;
                if count >= offset && children.len() < limit {
                    children.push(TreeChild {
                        index: count,
                        key: key
                            .decoded
                            .unwrap_or_else(|| format!("{}…", key.raw.trim_start_matches('"'))),
                        node,
                    });
                }
                count += 1;
                self.whitespace()?;
                match self.next()? {
                    Some(b',') => self.whitespace()?,
                    Some(b'}') => break,
                    _ => return Err("Expected comma or object end".into()),
                }
            }
        } else {
            self.next()?;
        }
        Ok(TreePage {
            node: container(TreeKind::Object, "{", count),
            children,
            offset,
            total_children: count,
            has_more: offset.saturating_add(limit) < count,
        })
    }

    fn array_page(
        &mut self,
        offset: usize,
        limit: usize,
        depth: usize,
    ) -> Result<TreePage, String> {
        self.expect(b'[')?;
        self.whitespace()?;
        let mut children = Vec::new();
        let mut count = 0;
        if self.peek()? != Some(b']') {
            loop {
                let node = self.summary(depth + 1)?;
                if count >= offset && children.len() < limit {
                    children.push(TreeChild {
                        index: count,
                        key: count.to_string(),
                        node,
                    });
                }
                count += 1;
                self.whitespace()?;
                match self.next()? {
                    Some(b',') => self.whitespace()?,
                    Some(b']') => break,
                    _ => return Err("Expected comma or array end".into()),
                }
            }
        } else {
            self.next()?;
        }
        Ok(TreePage {
            node: container(TreeKind::Array, "[", count),
            children,
            offset,
            total_children: count,
            has_more: offset.saturating_add(limit) < count,
        })
    }
}

#[derive(Default)]
struct Utf8State {
    remaining: u8,
    lower: u8,
    upper: u8,
}

impl Utf8State {
    fn complete(&self) -> bool {
        self.remaining == 0
    }

    fn feed(&mut self, byte: u8) -> Result<(), String> {
        if self.remaining > 0 {
            let lower = if self.lower == 0 { 0x80 } else { self.lower };
            let upper = if self.upper == 0 { 0xbf } else { self.upper };
            if !(lower..=upper).contains(&byte) {
                return Err("Invalid UTF-8 in string".into());
            }
            self.remaining -= 1;
            self.lower = 0;
            self.upper = 0;
            return Ok(());
        }
        match byte {
            0x00..=0x7f => Ok(()),
            0xc2..=0xdf => {
                self.remaining = 1;
                Ok(())
            }
            0xe0 => {
                self.remaining = 2;
                self.lower = 0xa0;
                Ok(())
            }
            0xe1..=0xec | 0xee..=0xef => {
                self.remaining = 2;
                Ok(())
            }
            0xed => {
                self.remaining = 2;
                self.upper = 0x9f;
                Ok(())
            }
            0xf0 => {
                self.remaining = 3;
                self.lower = 0x90;
                Ok(())
            }
            0xf1..=0xf3 => {
                self.remaining = 3;
                Ok(())
            }
            0xf4 => {
                self.remaining = 3;
                self.upper = 0x8f;
                Ok(())
            }
            _ => Err("Invalid UTF-8 in string".into()),
        }
    }
}

pub fn read_tree_page(
    reader: impl Read,
    route: &[usize],
    offset: usize,
    limit: usize,
) -> Result<TreePage, String> {
    if route.len() > MAX_DEPTH {
        return Err("Tree path exceeds 128 levels".into());
    }
    if limit == 0 || limit > MAX_TREE_CHILDREN {
        return Err("Tree page must contain 1–50 children".into());
    }
    let mut scanner = Scanner::new(reader);
    let page = scanner.locate(route, 0, offset, limit)?;
    if route.is_empty() {
        scanner.whitespace()?;
        if scanner.next()?.is_some() {
            return Err("Trailing content after JSON value".into());
        }
    }
    Ok(page)
}

fn capture(bytes: &mut Vec<u8>, byte: u8, limit: usize, truncated: &mut bool) {
    if bytes.len() < limit {
        bytes.push(byte);
    } else {
        *truncated = true;
    }
}

fn container(kind: TreeKind, text: &str, count: usize) -> TreeNodeSummary {
    TreeNodeSummary {
        kind,
        text: text.into(),
        child_count: Some(count),
        truncated: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_nested_objects_arrays_and_source_tokens() {
        let json =
            br#"{"a/b":{"n":9007199254740993,"e":1e-9},"items":[true,null,"x"],"a/b":false}"#;
        let root = read_tree_page(json.as_slice(), &[], 0, 2).unwrap();
        assert_eq!(root.total_children, 3);
        assert_eq!(root.children.len(), 2);
        assert!(root.has_more);
        assert_eq!(root.children[0].key, "a/b");
        assert_eq!(root.children[0].node.child_count, Some(2));

        let nested = read_tree_page(json.as_slice(), &[0], 0, 50).unwrap();
        assert_eq!(nested.children[0].node.text, "9007199254740993");
        assert_eq!(nested.children[1].node.text, "1e-9");

        let items = read_tree_page(json.as_slice(), &[1], 1, 2).unwrap();
        assert_eq!(items.children[0].key, "1");
        assert_eq!(items.children[0].node.text, "null");
        assert_eq!(items.children[1].node.text, "\"x\"");

        let duplicate = read_tree_page(json.as_slice(), &[2], 0, 50).unwrap();
        assert_eq!(duplicate.node.text, "false");
    }

    #[test]
    fn huge_strings_and_arrays_stay_preview_bounded() {
        let mut json = br#"{"payload":""#.to_vec();
        json.extend(std::iter::repeat_n(b'x', 3 * 1024 * 1024));
        json.extend_from_slice(br#"","items":[0,1,2,3],"number":"#);
        json.extend(std::iter::repeat_n(b'9', 600));
        json.push(b'}');
        let root = read_tree_page(json.as_slice(), &[], 0, 50).unwrap();
        assert_eq!(root.children.len(), 3);
        assert!(root.children[0].node.truncated);
        assert!(root.children[0].node.text.len() <= MAX_PREVIEW_BYTES);
        assert_eq!(root.children[1].node.child_count, Some(4));
        assert!(root.children[2].node.truncated);
        assert_eq!(root.children[2].node.text.len(), MAX_PREVIEW_BYTES);
    }

    #[test]
    fn rejects_invalid_paths_pages_and_json() {
        assert!(read_tree_page(b"{}".as_slice(), &[0], 0, 50).is_err());
        assert!(read_tree_page(b"{}".as_slice(), &[], 0, 51).is_err());
        assert!(read_tree_page(br#"{"x":[1]}"#.as_slice(), &[0, 2], 0, 50).is_err());
        assert!(read_tree_page(br#"{"x":"#.as_slice(), &[], 0, 50).is_err());
        assert!(read_tree_page(b"{\"x\":\"\xff\"}".as_slice(), &[], 0, 50).is_err());
        assert!(read_tree_page(b"{} false".as_slice(), &[], 0, 50).is_err());
    }
}

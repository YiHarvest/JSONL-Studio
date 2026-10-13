use crate::core::{parse, validate_json_bytes, Info, Page, Session, MAX_PAGE, MAX_RECORD};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

const MAX_EDITS: usize = 32 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
enum Piece {
    Source { from: usize, to: usize },
    Added(Vec<u8>),
}
impl Piece {
    fn lines(&self) -> usize {
        match self {
            Self::Source { from, to } => to - from,
            Self::Added(_) => 1,
        }
    }
}
#[derive(Clone)]
pub struct Document {
    source: Arc<Session>,
    pieces: Vec<Piece>,
    pub revision: u64,
    pub dirty: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    #[serde(flatten)]
    pub info: Info,
    pub revision: u64,
    pub dirty: bool,
}
#[derive(Serialize, Deserialize)]
struct Recovery {
    version: u32,
    path: Option<String>,
    fingerprint: Option<String>,
    memory: Option<Vec<u8>>,
    pieces: Vec<Piece>,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Edit {
    Replace { line: usize, text: String },
    Insert { line: usize, text: String },
    Delete { line: usize },
    Duplicate { line: usize },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub line: usize,
    pub pointer: String,
    pub preview: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub hits: Vec<SearchHit>,
    pub next_line: usize,
    pub has_more: bool,
}

fn fingerprint(path: &Path) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(format!(
        "{}:{:?}",
        meta.len(),
        meta.modified().map_err(|e| e.to_string())?
    ))
}
impl Document {
    pub fn new(source: Session) -> Self {
        let count = source.info.total_lines;
        let dirty = source.info.scratch && count > 0;
        Self {
            source: Arc::new(source),
            pieces: if count > 0 {
                vec![Piece::Source {
                    from: 1,
                    to: count + 1,
                }]
            } else {
                vec![]
            },
            revision: 0,
            dirty,
        }
    }
    pub fn info(&self) -> DocumentInfo {
        let mut info = self.source.info.clone();
        info.total_lines = self.pieces.iter().map(Piece::lines).sum();
        info.size = self
            .pieces
            .iter()
            .map(|p| match p {
                Piece::Source { from, to } => self.source.range_len(*from, *to),
                Piece::Added(bytes) => bytes.len() as u64,
            })
            .sum();
        DocumentInfo {
            info,
            revision: self.revision,
            dirty: self.dirty,
        }
    }
    pub fn changed(&self) -> bool {
        self.source.changed()
    }
    fn locate(&self, line: usize) -> Result<(usize, usize), String> {
        if line == 0 {
            return Err("Line numbers start at 1".into());
        }
        let mut begin = 1;
        for (index, piece) in self.pieces.iter().enumerate() {
            if line < begin + piece.lines() {
                return Ok((index, line - begin));
            }
            begin += piece.lines();
        }
        Err("Line out of range".into())
    }
    fn bytes(&self, line: usize, limit: usize) -> Result<(Vec<u8>, bool), String> {
        let (index, offset) = self.locate(line)?;
        match &self.pieces[index] {
            Piece::Source { from, .. } => {
                let mut bytes = self.source.bytes(from + offset, limit)?;
                if from + offset == 1 && line != 1 && bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
                    bytes.drain(..3);
                }
                Ok((bytes, self.source.source_len(from + offset) > limit as u64))
            }
            Piece::Added(bytes) => Ok((
                bytes[..bytes.len().min(limit)].to_vec(),
                bytes.len() > limit,
            )),
        }
    }
    pub fn page(&self, start: usize, count: usize) -> Result<Page, String> {
        if start == 0 || count == 0 || count > 1000 {
            return Err("Invalid page range".into());
        }
        if self.changed() {
            return Err("File changed on disk; reload or restore its original version".into());
        }
        let total: usize = self.pieces.iter().map(Piece::lines).sum();
        let mut records = vec![];
        let mut budget = 0;
        let mut next = start.min(total + 1);
        for line in start..start.saturating_add(count).min(total + 1) {
            let (bytes, truncated) = self.bytes(line, MAX_RECORD)?;
            if budget + bytes.len() > MAX_PAGE && !records.is_empty() {
                break;
            }
            budget += bytes.len();
            records.push(parse(line, &bytes, truncated));
            next = line + 1;
        }
        if self.changed() {
            return Err("File changed during reading".into());
        }
        Ok(Page {
            records,
            next_line: next,
            has_more: next <= total,
        })
    }
    fn split(&mut self, line: usize) -> Result<usize, String> {
        let total: usize = self.pieces.iter().map(Piece::lines).sum();
        if line == total + 1 {
            return Ok(self.pieces.len());
        }
        let (index, offset) = self.locate(line)?;
        if offset == 0 {
            return Ok(index);
        }
        if let Piece::Source { from, to } = self.pieces[index] {
            self.pieces.splice(
                index..=index,
                [
                    Piece::Source {
                        from,
                        to: from + offset,
                    },
                    Piece::Source {
                        from: from + offset,
                        to,
                    },
                ],
            );
        }
        Ok(index + 1)
    }
    pub fn edit(&mut self, edit: Edit, revision: u64) -> Result<DocumentInfo, String> {
        if revision != self.revision {
            return Err("Document changed; refresh before editing".into());
        }
        if self.changed() {
            return Err("Source changed externally; edits cannot be applied".into());
        }
        let mut next = self.clone();
        match edit {
            Edit::Replace { line, text } => {
                let bytes = next.record_bytes(&text)?;
                let begin = next.split(line)?;
                let end = next.split(line + 1)?;
                next.pieces.splice(begin..end, [Piece::Added(bytes)]);
            }
            Edit::Insert { line, text } => {
                let bytes = next.record_bytes(&text)?;
                let at = next.split(line)?;
                next.pieces.insert(at, Piece::Added(bytes));
            }
            Edit::Delete { line } => {
                let begin = next.split(line)?;
                let end = next.split(line + 1)?;
                next.pieces.drain(begin..end);
            }
            Edit::Duplicate { line } => {
                let (bytes, truncated) = next.bytes(line, MAX_RECORD)?;
                if truncated {
                    return Err("Oversized record cannot be duplicated through the editor".into());
                }
                let mut bytes = bytes;
                if line == 1 && bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
                    bytes.drain(..3);
                }
                let at = next.split(line + 1)?;
                next.pieces.insert(at, Piece::Added(bytes));
            }
        }
        let edit_bytes: usize = next
            .pieces
            .iter()
            .filter_map(|p| {
                if let Piece::Added(b) = p {
                    Some(b.len())
                } else {
                    None
                }
            })
            .sum();
        if edit_bytes > MAX_EDITS {
            return Err("Edit buffer is limited to 32 MiB; save before continuing".into());
        }
        next.dirty = true;
        next.revision += 1;
        *self = next;
        Ok(self.info())
    }
    fn record_bytes(&self, text: &str) -> Result<Vec<u8>, String> {
        if text.len() > MAX_RECORD {
            return Err("Record editor is limited to 2 MiB".into());
        }
        // RawValue validates and retains duplicate keys and numeric tokens.
        let value: Box<serde_json::value::RawValue> =
            serde_json::from_str(text).map_err(|e| e.to_string())?;
        let mut compact = Vec::new();
        let mut quoted = false;
        let mut escaped = false;
        for byte in value.get().bytes() {
            if quoted {
                compact.push(byte);
                if escaped {
                    escaped = false;
                } else if byte == b'\\' {
                    escaped = true;
                } else if byte == b'"' {
                    quoted = false;
                }
            } else if byte == b'"' {
                quoted = true;
                compact.push(byte);
            } else if !byte.is_ascii_whitespace() {
                compact.push(byte);
            }
        }
        compact.extend_from_slice(if self.source.info.newline == "CRLF" {
            b"\r\n"
        } else {
            b"\n"
        });
        Ok(compact)
    }
    pub fn validate(&self) -> Result<(usize, usize), String> {
        if self.changed() {
            return Err("File changed on disk; reload before validating".into());
        }
        let mut counts = (0, 0);
        for piece in &self.pieces {
            match piece {
                Piece::Source { from, to } => {
                    let next = self.source.validate_range(*from, *to)?;
                    counts.0 += next.0;
                    counts.1 += next.1;
                }
                Piece::Added(bytes) => {
                    if validate_json_bytes(bytes)? {
                        counts.0 += 1;
                    } else {
                        counts.1 += 1;
                    }
                }
            }
        }
        if self.changed() {
            return Err("File changed during validation".into());
        }
        Ok(counts)
    }
    fn write(&self, writer: &mut impl Write) -> Result<(), String> {
        let newline: &[u8] = if self.source.info.newline == "CRLF" {
            b"\r\n"
        } else {
            b"\n"
        };
        // Preserve BOM independently of deleting/replacing the first record.
        let bom = self.source.info.encoding == "UTF-8 BOM";
        let first_source = matches!(self.pieces.first(), Some(Piece::Source { from: 1, .. }));
        if bom && !first_source && !self.pieces.is_empty() {
            writer
                .write_all(&[0xef, 0xbb, 0xbf])
                .map_err(|e| e.to_string())?;
        }
        let mut previous_ended = true;
        for (position, piece) in self.pieces.iter().enumerate() {
            if !previous_ended {
                writer.write_all(newline).map_err(|e| e.to_string())?;
            }
            previous_ended = match piece {
                Piece::Source { from, to } => {
                    self.source.write_range_skip(
                        *from,
                        *to,
                        if bom && *from == 1 && position != 0 {
                            3
                        } else {
                            0
                        },
                        writer,
                    )?;
                    self.source.ends_with_newline(to - 1)?
                }
                Piece::Added(bytes) => {
                    writer.write_all(bytes).map_err(|e| e.to_string())?;
                    bytes.ends_with(b"\n")
                }
            };
        }
        Ok(())
    }
    pub fn save(
        &mut self,
        path: PathBuf,
        overwrite: bool,
        revision: u64,
    ) -> Result<DocumentInfo, String> {
        if revision != self.revision {
            return Err("Document changed before save".into());
        }
        if self.changed() {
            return Err("Source changed externally; save refused".into());
        }
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."))
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let name = path.file_name().ok_or("Invalid destination")?;
        let target = parent.join(name);
        let extension = target
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !["jsonl", "ndjson"].contains(&extension.as_str()) {
            return Err("Save with a .jsonl or .ndjson extension".into());
        }
        if fs::symlink_metadata(&target)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false)
        {
            return Err("Saving over a symbolic link is not supported".into());
        }
        let exists = target.exists();
        let same = self
            .source
            .info
            .path
            .as_ref()
            .map(|p| Path::new(p) == target)
            .unwrap_or(false);
        if exists && !same && !overwrite {
            return Err("Destination exists; confirm overwrite".into());
        }
        let stamp = if exists {
            Some(fingerprint(&target)?)
        } else {
            None
        };
        let mut temp = tempfile::Builder::new()
            .prefix(".jsonl-studio-")
            .suffix(".jsonl")
            .tempfile_in(&parent)
            .map_err(|e| e.to_string())?;
        if exists {
            temp.as_file()
                .set_permissions(
                    fs::metadata(&target)
                        .map_err(|e| e.to_string())?
                        .permissions(),
                )
                .map_err(|e| e.to_string())?;
        } else if let Some(path) = &self.source.info.path {
            temp.as_file()
                .set_permissions(fs::metadata(path).map_err(|e| e.to_string())?.permissions())
                .map_err(|e| e.to_string())?;
        }
        self.write(&mut temp)?;
        temp.flush().map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        // Build the new index before the commit point.
        let checked = Session::open(temp.path().to_path_buf())?;
        if self.changed() {
            return Err("Source changed during save; original retained".into());
        }
        let current = if target.exists() {
            Some(fingerprint(&target)?)
        } else {
            None
        };
        if current != stamp {
            return Err("Destination changed during save; original retained".into());
        }
        if exists {
            temp.persist(&target).map_err(|e| e.to_string())?;
        } else {
            temp.persist_noclobber(&target).map_err(|e| e.to_string())?;
        }
        let revision = self.revision + 1;
        let source = checked
            .retarget(target)
            .map_err(|e| format!("File was saved, but reopening failed: {e}"))?;
        *self = Self::new(source);
        self.revision = revision;
        // File data is synced; directory sync improves rename durability.
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
        Ok(self.info())
    }
    pub fn checkpoint(&self, path: &Path) -> Result<(), String> {
        if !self.dirty {
            return Self::discard_recovery(path);
        }
        let recovery = Recovery {
            version: 1,
            path: self.source.info.path.clone(),
            fingerprint: self
                .source
                .info
                .path
                .as_ref()
                .map(|p| fingerprint(Path::new(p)))
                .transpose()?,
            memory: self.source.memory_snapshot(),
            pieces: self.pieces.clone(),
        };
        if self.changed() {
            return Err("Cannot checkpoint a changed source".into());
        }
        let parent = path.parent().ok_or("Invalid recovery location")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut temp, &recovery).map_err(|e| e.to_string())?;
        temp.flush().map_err(|e| e.to_string())?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(path).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn restore(path: &Path) -> Result<Self, String> {
        if fs::metadata(path).map_err(|e| e.to_string())?.len() > 256 * 1024 * 1024 {
            return Err("Recovery file exceeds limit".into());
        }
        let recovery: Recovery =
            serde_json::from_reader(fs::File::open(path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        if recovery.version != 1 {
            return Err("Unsupported recovery version".into());
        }
        let source = if let Some(p) = recovery.path {
            if Some(fingerprint(Path::new(&p))?) != recovery.fingerprint {
                return Err("Recovery source changed; restore its original version first".into());
            }
            Session::open(PathBuf::from(p))?
        } else {
            Session::from_bytes(recovery.memory.ok_or("Missing recovery contents")?)?
        };
        let mut added = 0;
        for piece in &recovery.pieces {
            match piece {
                Piece::Source { from, to }
                    if *from == 0 || from >= to || *to > source.info.total_lines + 1 =>
                {
                    return Err("Invalid recovery range".into())
                }
                Piece::Added(b) => {
                    added += b.len();
                    if b.len() > MAX_RECORD {
                        return Err("Recovery record exceeds limit".into());
                    }
                }
                _ => {}
            }
        }
        if added > MAX_EDITS {
            return Err("Recovery edits exceed limit".into());
        }
        Ok(Self {
            source: Arc::new(source),
            pieces: recovery.pieces,
            revision: 0,
            dirty: true,
        })
    }
    pub fn discard_recovery(path: &Path) -> Result<(), String> {
        match fs::remove_file(path) {
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
    pub fn search(&self, query: &str, mode: &str, start: usize) -> Result<SearchPage, String> {
        if query.is_empty() || query.len() > 1024 || !["raw", "key", "value"].contains(&mode) {
            return Err("Invalid search query or mode".into());
        }
        let needle = query.to_lowercase();
        let mut hits = vec![];
        let mut line = start;
        let mut scanned = 0;
        loop {
            let page = self.page(line, 100)?;
            for r in page.records {
                if mode == "raw" {
                    if r.raw.to_lowercase().contains(&needle) {
                        hits.push(SearchHit {
                            line: r.line,
                            pointer: "".into(),
                            preview: r.raw.chars().take(160).collect(),
                        });
                    }
                } else if let Some(text) = &r.json {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text) {
                        search_value(&value, "", &needle, mode, r.line, &mut hits);
                    }
                }
            }
            line = page.next_line;
            scanned += 100;
            if hits.len() >= 100 || scanned >= 2000 || !page.has_more {
                return Ok(SearchPage {
                    hits,
                    next_line: line,
                    has_more: page.has_more,
                });
            }
        }
    }
}
fn search_value(
    value: &serde_json::Value,
    pointer: &str,
    needle: &str,
    mode: &str,
    line: usize,
    hits: &mut Vec<SearchHit>,
) {
    if hits.len() >= 100 {
        return;
    }
    match value {
        serde_json::Value::Object(map) => {
            for (key, value) in map {
                let path = format!("{pointer}/{}", key.replace('~', "~0").replace('/', "~1"));
                if mode == "key" && key.to_lowercase().contains(needle) {
                    hits.push(SearchHit {
                        line,
                        pointer: path.clone(),
                        preview: key.chars().take(160).collect(),
                    });
                }
                search_value(value, &path, needle, mode, line, hits);
            }
        }
        serde_json::Value::Array(items) => {
            for (index, value) in items.iter().enumerate() {
                search_value(
                    value,
                    &format!("{pointer}/{index}"),
                    needle,
                    mode,
                    line,
                    hits,
                );
            }
        }
        _ if mode == "value" => {
            let text = if let Some(s) = value.as_str() {
                s.to_owned()
            } else {
                value.to_string()
            };
            if text.to_lowercase().contains(needle) {
                hits.push(SearchHit {
                    line,
                    pointer: pointer.into(),
                    preview: text.chars().take(160).collect(),
                });
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn disk(bytes: &[u8]) -> (tempfile::TempDir, PathBuf, Document) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("input.jsonl");
        fs::write(&path, bytes).unwrap();
        let document = Document::new(Session::open(path.clone()).unwrap());
        (dir, path, document)
    }
    #[test]
    fn edit_sequence_save_preserves_untouched_bytes_and_numbers() {
        let (_dir, path, mut doc) =
            disk(b"\xef\xbb\xbf{\"x\":1}\r\nbad\n{\"id\":9007199254740993}");
        doc.edit(
            Edit::Replace {
                line: 1,
                text: "{\n\"x\":2,\"x\":3\n}".into(),
            },
            0,
        )
        .unwrap();
        doc.edit(Edit::Duplicate { line: 3 }, 1).unwrap();
        doc.edit(Edit::Delete { line: 2 }, 2).unwrap();
        assert_eq!(doc.info().info.total_lines, 3);
        doc.save(path.clone(), false, 3).unwrap();
        assert_eq!(
            fs::read(path).unwrap(),
            b"\xef\xbb\xbf{\"x\":2,\"x\":3}\n{\"id\":9007199254740993}\n{\"id\":9007199254740993}"
        );
        assert!(!doc.dirty);
    }
    #[test]
    fn source_conflict_and_destination_conflict_keep_files_intact() {
        let (dir, path, mut doc) = disk(b"{}\n");
        doc.edit(
            Edit::Insert {
                line: 2,
                text: "true".into(),
            },
            0,
        )
        .unwrap();
        let target = dir.path().join("existing.jsonl");
        fs::write(&target, b"false\n").unwrap();
        assert!(doc.save(target.clone(), false, 1).is_err());
        assert_eq!(fs::read(&target).unwrap(), b"false\n");
        fs::write(&path, b"\"external\"\n").unwrap();
        assert!(doc.save(path.clone(), false, 1).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"\"external\"\n");
    }
    #[test]
    fn invalid_edit_and_stale_revision_leave_document_unchanged() {
        let mut doc = Document::new(Session::import("{}\nfalse".into()).unwrap());
        assert!(doc
            .edit(
                Edit::Replace {
                    line: 1,
                    text: "{bad}".into()
                },
                0
            )
            .is_err());
        assert!(doc.edit(Edit::Delete { line: 1 }, 9).is_err());
        assert_eq!(doc.page(1, 10).unwrap().records[0].raw, "{}");
    }
    #[test]
    fn oversized_source_record_is_neutral_in_preview_and_validated_in_full() {
        let mut bytes = br#"{"payload":""#.to_vec();
        bytes.extend(std::iter::repeat_n(b'x', MAX_RECORD));
        bytes.extend_from_slice(b"\"}\n");
        let (_dir, _path, doc) = disk(&bytes);
        let record = &doc.page(1, 1).unwrap().records[0];
        assert!(record.truncated);
        assert!(record.error.is_none());
        assert_eq!(doc.validate().unwrap(), (1, 0));
    }
    #[test]
    fn failed_stream_write_does_not_touch_source() {
        struct Failing;
        impl Write for Failing {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("simulated disk full"))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let (_dir, path, doc) = disk(b"{}\n\xff\n");
        assert!(doc.write(&mut Failing).is_err());
        assert_eq!(fs::read(path).unwrap(), b"{}\n\xff\n");
    }
    #[test]
    fn recovery_roundtrip_and_changed_source_refusal() {
        let (dir, path, mut doc) = disk(b"{}\nfalse\n");
        doc.edit(
            Edit::Insert {
                line: 2,
                text: "{\"id\":9007199254740993}".into(),
            },
            0,
        )
        .unwrap();
        let recovery = dir.path().join("recovery.json");
        doc.checkpoint(&recovery).unwrap();
        let restored = Document::restore(&recovery).unwrap();
        assert_eq!(
            restored.page(1, 10).unwrap().records[1].raw,
            "{\"id\":9007199254740993}"
        );
        fs::write(path, b"true\n").unwrap();
        assert!(Document::restore(&recovery).is_err());
    }
    #[test]
    fn scratch_recovery_and_search_paths() {
        let dir = tempfile::tempdir().unwrap();
        let doc =
            Document::new(Session::import("{\"a/b\":[{\"name\":\"needle\"}]}".into()).unwrap());
        let path = dir.path().join("recovery.json");
        doc.checkpoint(&path).unwrap();
        let restored = Document::restore(&path).unwrap();
        assert_eq!(
            restored.search("needle", "value", 1).unwrap().hits[0].pointer,
            "/a~1b/0/name"
        );
        assert_eq!(
            restored.search("a/b", "key", 1).unwrap().hits[0].pointer,
            "/a~1b"
        );
    }
    #[test]
    fn save_as_preserves_source_permissions_and_invalid_bytes() {
        let (dir, path, mut doc) = disk(b"{}\r\n\xff\r\n");
        let target = dir.path().join("output.ndjson");
        doc.save(target.clone(), false, 0).unwrap();
        assert_eq!(fs::read(&target).unwrap(), fs::read(&path).unwrap());
    }
    #[test]
    fn inserting_before_bom_and_deleting_all_are_valid() {
        let (dir, _path, mut doc) = disk(b"\xef\xbb\xbf{}\r\n");
        doc.edit(
            Edit::Insert {
                line: 1,
                text: "false".into(),
            },
            0,
        )
        .unwrap();
        assert!(doc.page(1, 10).unwrap().records[1].error.is_none());
        let target = dir.path().join("inserted.jsonl");
        doc.save(target.clone(), false, 1).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"\xef\xbb\xbffalse\r\n{}\r\n");
        doc.edit(Edit::Delete { line: 1 }, 2).unwrap();
        doc.edit(Edit::Delete { line: 1 }, 3).unwrap();
        assert_eq!(doc.info().info.total_lines, 0);
    }
    #[cfg(unix)]
    #[test]
    fn destination_symlink_refused_and_permissions_preserved() {
        use std::os::unix::{fs::symlink, fs::PermissionsExt};
        let (dir, path, mut doc) = disk(b"{}\n");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        let link = dir.path().join("link.jsonl");
        symlink(&path, &link).unwrap();
        assert!(doc.save(link, true, 0).is_err());
        let target = dir.path().join("saved.jsonl");
        doc.save(target.clone(), false, 0).unwrap();
        assert_eq!(
            fs::metadata(target).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }
}

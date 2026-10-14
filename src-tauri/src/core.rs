use crate::lazy_tree::{read_tree_page, TreePage};
use serde::{de::IgnoredAny, Deserialize, Serialize};
use std::{
    fs::{File, Metadata},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

pub const MAX_RECORD: usize = 2 * 1024 * 1024;
pub const MAX_PAGE: usize = 8 * 1024 * 1024;
const MAX_IMPORT: usize = 8 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub name: String,
    pub path: Option<String>,
    pub size: u64,
    pub total_lines: usize,
    pub modified: Option<u64>,
    pub newline: String,
    pub encoding: String,
    pub scratch: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub line: usize,
    pub raw: String,
    pub source: String,
    // Keep JSON as text over IPC, so integers never round through JavaScript numbers.
    pub json: Option<String>,
    pub error: Option<String>,
    pub column: Option<usize>,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub records: Vec<Record>,
    pub next_line: usize,
    pub has_more: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftIssue {
    pub line: usize,
    pub column: usize,
}

enum Source {
    Disk { path: PathBuf, stamp: Stamp },
    Memory(Vec<u8>),
}

#[derive(PartialEq)]
struct Stamp {
    size: u64,
    modified: Option<SystemTime>,
}
impl Stamp {
    fn from(meta: &Metadata) -> Self {
        Self {
            size: meta.len(),
            modified: meta.modified().ok(),
        }
    }
}

pub struct Session {
    source: Source,
    // One u64 start offset per physical line plus EOF sentinel.
    offsets: Vec<u64>,
    pub info: Info,
}

impl Session {
    /// Reuse a validated temporary file's index after atomic rename.
    pub(crate) fn retarget(mut self, path: PathBuf) -> Result<Self, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let expected = match &self.source {
            Source::Disk { stamp, .. } => stamp,
            Source::Memory(_) => return Err("Only indexed disk files can be retargeted".into()),
        };
        if !meta.is_file() || Stamp::from(&meta) != *expected {
            return Err("Saved file changed after replacement".into());
        }
        self.info.name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        self.info.path = Some(path.to_string_lossy().into_owned());
        self.source = Source::Disk {
            path,
            stamp: Stamp::from(&meta),
        };
        Ok(self)
    }
    pub fn range_len(&self, from: usize, to: usize) -> u64 {
        self.offsets[to - 1] - self.offsets[from - 1]
    }
    pub fn source_len(&self, line: usize) -> u64 {
        self.offsets[line] - self.offsets[line - 1]
    }
    pub fn bytes(&self, line: usize, limit: usize) -> Result<Vec<u8>, String> {
        if line == 0 || line > self.info.total_lines {
            return Err("Line out of range".into());
        }
        let from = self.offsets[line - 1];
        let take = (self.source_len(line) as usize).min(limit);
        let mut result = vec![0; take];
        match &self.source {
            Source::Disk { path, .. } => {
                let mut file = File::open(path).map_err(|e| e.to_string())?;
                file.seek(SeekFrom::Start(from))
                    .map_err(|e| e.to_string())?;
                file.read_exact(&mut result).map_err(|e| e.to_string())?;
            }
            Source::Memory(data) => {
                result.copy_from_slice(&data[from as usize..from as usize + take])
            }
        }
        Ok(result)
    }
    pub fn write_range(
        &self,
        from: usize,
        to: usize,
        writer: &mut impl std::io::Write,
    ) -> Result<(), String> {
        self.write_range_skip(from, to, 0, writer)
    }
    pub fn write_range_skip(
        &self,
        from: usize,
        to: usize,
        skip: u64,
        writer: &mut impl std::io::Write,
    ) -> Result<(), String> {
        let start = self.offsets[from - 1] + skip;
        let end = self.offsets[to - 1];
        match &self.source {
            Source::Disk { path, .. } => {
                let mut file = File::open(path).map_err(|e| e.to_string())?;
                file.seek(SeekFrom::Start(start))
                    .map_err(|e| e.to_string())?;
                let copied = std::io::copy(&mut file.take(end - start), writer)
                    .map_err(|e| e.to_string())?;
                if copied != end - start {
                    return Err("Source truncated during save".into());
                }
            }
            Source::Memory(data) => writer
                .write_all(&data[start as usize..end as usize])
                .map_err(|e| e.to_string())?,
        }
        Ok(())
    }
    pub fn ends_with_newline(&self, line: usize) -> Result<bool, String> {
        let end = self.offsets[line];
        match &self.source {
            Source::Disk { path, .. } => {
                let mut file = File::open(path).map_err(|e| e.to_string())?;
                file.seek(SeekFrom::Start(end - 1))
                    .map_err(|e| e.to_string())?;
                let mut b = [0];
                file.read_exact(&mut b).map_err(|e| e.to_string())?;
                Ok(b[0] == b'\n')
            }
            Source::Memory(data) => Ok(data[end as usize - 1] == b'\n'),
        }
    }
    pub fn memory_snapshot(&self) -> Option<Vec<u8>> {
        match &self.source {
            Source::Memory(data) => Some(data.clone()),
            _ => None,
        }
    }
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self, String> {
        if bytes.len() > MAX_IMPORT {
            return Err("Recovery input exceeds 8 MiB".into());
        }
        let (offsets, newline, bom) = index(std::io::Cursor::new(&bytes))?;
        let info = Info {
            name: "Untitled.jsonl".into(),
            path: None,
            size: bytes.len() as u64,
            total_lines: offsets.len() - 1,
            modified: None,
            newline,
            encoding: if bom { "UTF-8 BOM" } else { "UTF-8" }.into(),
            scratch: true,
        };
        Ok(Self {
            source: Source::Memory(bytes),
            offsets,
            info,
        })
    }
    pub fn open(path: PathBuf) -> Result<Self, String> {
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        if !["jsonl", "ndjson"].contains(&extension.to_ascii_lowercase().as_str()) {
            return Err("Choose a .jsonl or .ndjson file".into());
        }
        let file = File::open(&path).map_err(|e| e.to_string())?;
        let meta = file.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() {
            return Err("Not a regular file".into());
        }
        let stamp = Stamp::from(&meta);
        let (offsets, newline, bom) = index(BufReader::with_capacity(1024 * 1024, file))?;
        if Stamp::from(&std::fs::metadata(&path).map_err(|e| e.to_string())?) != stamp {
            return Err("File changed while indexing; open it again".into());
        }
        let info = Info {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            path: Some(path.to_string_lossy().into_owned()),
            size: meta.len(),
            total_lines: offsets.len() - 1,
            modified: stamp
                .modified
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
            newline,
            encoding: if bom { "UTF-8 BOM" } else { "UTF-8" }.into(),
            scratch: false,
        };
        Ok(Self {
            source: Source::Disk { path, stamp },
            offsets,
            info,
        })
    }

    pub fn import(text: String) -> Result<Self, String> {
        if text.len() > MAX_IMPORT {
            return Err("Paste is limited to 8 MiB; open a file for larger data".into());
        }
        let clean = text.trim_start_matches('\u{feff}').trim();
        let bytes = match serde_json::from_str::<serde_json::Value>(clean) {
            Ok(serde_json::Value::Array(items)) => {
                let mut bytes = Vec::new();
                for item in items {
                    serde_json::to_writer(&mut bytes, &item).map_err(|e| e.to_string())?;
                    bytes.push(b'\n');
                }
                bytes
            }
            Ok(value) => {
                let mut b = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
                b.push(b'\n');
                b
            }
            Err(_) => text.into_bytes(),
        };
        let (offsets, newline, bom) = index(std::io::Cursor::new(&bytes))?;
        let info = Info {
            name: "Untitled.jsonl".into(),
            path: None,
            size: bytes.len() as u64,
            total_lines: offsets.len() - 1,
            modified: None,
            newline,
            encoding: if bom { "UTF-8 BOM" } else { "UTF-8" }.into(),
            scratch: true,
        };
        Ok(Self {
            source: Source::Memory(bytes),
            offsets,
            info,
        })
    }

    pub fn validate_draft(text: &str) -> Result<Option<DraftIssue>, String> {
        if text.len() > MAX_IMPORT {
            return Err("Draft is limited to 8 MiB".into());
        }
        if text.is_empty() {
            return Ok(None);
        }
        let clean = text.trim_start_matches('\u{feff}').trim();
        if serde_json::from_str::<Box<serde_json::value::RawValue>>(clean).is_ok() {
            return Ok(None);
        }
        let mut lines = text.split('\n').collect::<Vec<_>>();
        if text.ends_with('\n') {
            lines.pop();
        }
        if lines.is_empty() {
            lines.push("");
        }
        for (index, source) in lines.into_iter().enumerate() {
            let source = source.strip_suffix('\r').unwrap_or(source);
            let source = if index == 0 {
                source.strip_prefix('\u{feff}').unwrap_or(source)
            } else {
                source
            };
            if let Err(error) = serde_json::from_str::<Box<serde_json::value::RawValue>>(source) {
                return Ok(Some(DraftIssue {
                    line: index + 1,
                    column: error.column().max(1),
                }));
            }
        }
        Ok(None)
    }

    pub fn changed(&self) -> bool {
        match &self.source {
            Source::Disk { path, stamp } => std::fs::metadata(path)
                .map(|m| Stamp::from(&m) != *stamp)
                .unwrap_or(true),
            Source::Memory(_) => false,
        }
    }

    pub fn page(&self, start: usize, count: usize) -> Result<Page, String> {
        if start == 0 || count == 0 || count > 1000 {
            return Err("Range must start at 1 and contain 1–1000 lines".into());
        }
        if self.changed() {
            return Err("File changed on disk; reload before reading".into());
        }
        let mut file = match &self.source {
            Source::Disk { path, .. } => Some(File::open(path).map_err(|e| e.to_string())?),
            _ => None,
        };
        let mut records = Vec::new();
        let mut budget = 0;
        let mut next = start.min(self.info.total_lines + 1);
        for line in start..start.saturating_add(count).min(self.info.total_lines + 1) {
            let from = self.offsets[line - 1];
            let len = (self.offsets[line] - from) as usize;
            let take = len.min(MAX_RECORD);
            if budget + take > MAX_PAGE && !records.is_empty() {
                break;
            }
            let mut bytes = vec![0; take];
            match &self.source {
                Source::Disk { .. } => {
                    let f = file.as_mut().unwrap();
                    f.seek(SeekFrom::Start(from)).map_err(|e| e.to_string())?;
                    f.read_exact(&mut bytes).map_err(|e| e.to_string())?;
                }
                Source::Memory(data) => {
                    bytes.copy_from_slice(&data[from as usize..from as usize + take])
                }
            }
            records.push(parse(line, &bytes, len > MAX_RECORD));
            budget += take;
            next = line + 1;
        }
        if self.changed() {
            return Err("File changed during reading; reload".into());
        }
        Ok(Page {
            records,
            next_line: next,
            has_more: next <= self.info.total_lines,
        })
    }

    pub fn validate(&self) -> Result<(usize, usize), String> {
        self.validate_range(1, self.info.total_lines + 1)
    }

    pub(crate) fn tree_page(
        &self,
        line: usize,
        route: &[usize],
        offset: usize,
        limit: usize,
    ) -> Result<TreePage, String> {
        if line == 0 || line > self.info.total_lines {
            return Err("Line out of range".into());
        }
        if self.changed() {
            return Err("File changed on disk; reload before reading".into());
        }
        let mut start = self.offsets[line - 1];
        if line == 1 && self.info.encoding == "UTF-8 BOM" {
            start += 3;
        }
        let end = self.offsets[line];
        let result = match &self.source {
            Source::Disk { path, .. } => {
                let mut file = File::open(path).map_err(|e| e.to_string())?;
                file.seek(SeekFrom::Start(start))
                    .map_err(|e| e.to_string())?;
                read_tree_page(file.take(end - start), route, offset, limit)
            }
            Source::Memory(data) => read_tree_page(
                std::io::Cursor::new(&data[start as usize..end as usize]),
                route,
                offset,
                limit,
            ),
        }?;
        if self.changed() {
            return Err("File changed during tree reading".into());
        }
        Ok(result)
    }

    pub(crate) fn validate_range(&self, from: usize, to: usize) -> Result<(usize, usize), String> {
        if from == 0 || from > to || to > self.info.total_lines + 1 {
            return Err("Invalid validation range".into());
        }
        if from == to {
            return Ok((0, 0));
        }
        if self.changed() {
            return Err("File changed on disk; reload before validating".into());
        }
        let mut counts = (0, 0);
        match &self.source {
            Source::Disk { path, .. } => {
                let mut file = File::open(path).map_err(|e| e.to_string())?;
                for line in from..to {
                    let (start, end) = self.validation_offsets(line);
                    file.seek(SeekFrom::Start(start))
                        .map_err(|e| e.to_string())?;
                    tally(&mut counts, validate_json((&mut file).take(end - start))?);
                }
            }
            Source::Memory(data) => {
                for line in from..to {
                    let (start, end) = self.validation_offsets(line);
                    tally(
                        &mut counts,
                        validate_json(std::io::Cursor::new(&data[start as usize..end as usize]))?,
                    );
                }
            }
        }
        if self.changed() {
            return Err("File changed during validation".into());
        }
        Ok(counts)
    }

    fn validation_offsets(&self, line: usize) -> (u64, u64) {
        let mut start = self.offsets[line - 1];
        if line == 1 && self.info.encoding == "UTF-8 BOM" {
            start += 3;
        }
        (start, self.offsets[line])
    }
}

pub(crate) fn validate_json_bytes(bytes: &[u8]) -> Result<bool, String> {
    validate_json(std::io::Cursor::new(bytes))
}

fn validate_json(reader: impl Read) -> Result<bool, String> {
    let mut deserializer = serde_json::Deserializer::from_reader(reader);
    match IgnoredAny::deserialize(&mut deserializer).and_then(|_| deserializer.end()) {
        Ok(()) => Ok(true),
        Err(error) if error.is_io() => Err(error.to_string()),
        Err(_) => Ok(false),
    }
}

fn tally(counts: &mut (usize, usize), valid: bool) {
    if valid {
        counts.0 += 1;
    } else {
        counts.1 += 1;
    }
}

fn index(mut reader: impl BufRead) -> Result<(Vec<u64>, String, bool), String> {
    let mut offsets = vec![0];
    let mut position = 0u64;
    let (mut lf, mut crlf) = (false, false);
    let (mut previous, mut prefix) = (0u8, Vec::new());
    loop {
        let buf = reader.fill_buf().map_err(|e| e.to_string())?;
        if buf.is_empty() {
            break;
        }
        for &b in buf.iter().take(3usize.saturating_sub(prefix.len())) {
            prefix.push(b);
        }
        for at in memchr::memchr_iter(b'\n', buf) {
            let before = if at == 0 { previous } else { buf[at - 1] };
            if before == b'\r' {
                crlf = true;
            } else {
                lf = true;
            }
            offsets.push(position + at as u64 + 1);
        }
        previous = *buf.last().unwrap();
        let len = buf.len();
        position += len as u64;
        reader.consume(len);
    }
    if *offsets.last().unwrap() != position {
        offsets.push(position);
    }
    // Empty file has no records; a final newline does not create an extra line.
    if position == 0 {
        offsets = vec![0];
    }
    let newline = match (lf, crlf) {
        (true, true) => "Mixed",
        (false, true) => "CRLF",
        _ => "LF",
    };
    Ok((offsets, newline.into(), prefix == [0xef, 0xbb, 0xbf]))
}

pub(crate) fn parse(line: usize, bytes: &[u8], truncated: bool) -> Record {
    let source = String::from_utf8_lossy(bytes).into_owned();
    let bytes = if line == 1 {
        bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes)
    } else {
        bytes
    };
    let text = String::from_utf8_lossy(bytes);
    let raw = text.strip_suffix('\n').unwrap_or(&text);
    let raw = raw.strip_suffix('\r').unwrap_or(raw).to_owned();
    let mut record = Record {
        line,
        raw,
        source,
        json: None,
        error: None,
        column: None,
        truncated,
    };
    if truncated {
        return record;
    }
    let text = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => {
            record.error = Some("Invalid UTF-8".into());
            record.column = Some(e.valid_up_to() + 1);
            return record;
        }
    };
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(_) => record.json = Some(text.trim().to_owned()),
        Err(e) => {
            record.column = Some(e.column());
            record.error = Some(e.to_string());
        }
    }
    record
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn disk(bytes: &[u8]) -> (tempfile::NamedTempFile, Session) {
        let mut file = tempfile::Builder::new()
            .suffix(".jsonl")
            .tempfile()
            .unwrap();
        file.write_all(bytes).unwrap();
        let session = Session::open(file.path().to_path_buf()).unwrap();
        (file, session)
    }
    #[test]
    fn physical_lines_errors_and_bom() {
        let (_f, s) = disk(b"\xef\xbb\xbf{\"x\":1}\r\n\nbad\n{\"x\":2}");
        assert_eq!(s.info.total_lines, 4);
        assert_eq!(s.info.newline, "Mixed");
        let page = s.page(1, 100).unwrap();
        assert!(page.records[0].json.is_some());
        assert!(page.records[1].error.is_some());
        assert!(page.records[2].column.is_some());
        assert!(page.records[3].json.is_some());
        assert_eq!(s.validate().unwrap(), (2, 2));
    }
    #[test]
    fn empty_and_terminal_newline() {
        for (bytes, expected) in [
            (b"".as_slice(), 0),
            (b"{}\n".as_slice(), 1),
            (b"\n\n".as_slice(), 2),
        ] {
            let (_f, s) = disk(bytes);
            assert_eq!(s.info.total_lines, expected);
        }
    }
    #[test]
    fn array_conversion_preserves_large_numbers() {
        let s = Session::import("[{\"id\":9007199254740993},false,null]".into()).unwrap();
        assert_eq!(s.info.total_lines, 3);
        assert!(s.page(1, 10).unwrap().records[0]
            .json
            .as_ref()
            .unwrap()
            .contains("9007199254740993"));
    }
    #[test]
    fn draft_validation_accepts_json_and_jsonl_but_rejects_bad_physical_line() {
        for valid in [
            "{\"x\":1}",
            "[{\"x\":1},false]",
            "{\n  \"x\": 1\n}",
            "{\"x\":1}\nfalse\n",
        ] {
            assert!(Session::validate_draft(valid).unwrap().is_none());
        }
        let issue = Session::validate_draft("{\"x\":1}\n{hihi}\n")
            .unwrap()
            .unwrap();
        assert_eq!(issue.line, 2);
        assert_eq!(issue.column, 2);
        assert!(Session::validate_draft("").unwrap().is_none());
        let whitespace = Session::validate_draft(" ").unwrap().unwrap();
        assert_eq!((whitespace.line, whitespace.column), (1, 1));
    }
    #[test]
    fn external_change_is_rejected() {
        let (mut f, s) = disk(b"{}\n");
        f.write_all(b"false\n").unwrap();
        assert!(s.changed());
        assert!(s.page(1, 10).is_err());
    }
    #[test]
    fn invalid_encoding_and_large_record_are_isolated() {
        let mut data = vec![b'x'; MAX_RECORD + 1];
        data.extend_from_slice(b"\n\xff\n{}\n");
        let (_f, s) = disk(&data);
        let p = s.page(1, 10).unwrap();
        assert!(p.records[0].truncated);
        assert!(p.records[0].error.is_none());
        assert!(p.records[0].json.is_none());
        assert_eq!(p.records[1].error.as_deref(), Some("Invalid UTF-8"));
        assert!(p.records[2].json.is_some());
        assert_eq!(s.validate().unwrap(), (1, 2));
    }
    #[test]
    fn oversized_valid_record_is_stream_validated_without_becoming_preview_error() {
        let mut data = br#"{"payload":""#.to_vec();
        data.extend(std::iter::repeat_n(b'x', MAX_RECORD));
        data.extend_from_slice(b"\",\"nested\":{\"items\":[0,1,2]}}\n");
        let (_f, s) = disk(&data);
        let record = &s.page(1, 1).unwrap().records[0];
        assert!(record.truncated);
        assert!(record.error.is_none());
        assert!(record.json.is_none());
        assert_eq!(s.validate().unwrap(), (1, 0));
        let root = s.tree_page(1, &[], 0, 50).unwrap();
        assert_eq!(root.total_children, 2);
        assert!(root.children[0].node.truncated);
        let nested = s.tree_page(1, &[1, 0], 1, 2).unwrap();
        assert_eq!(nested.total_children, 3);
        assert_eq!(nested.children[0].node.text, "1");
        assert_eq!(nested.children[1].node.text, "2");

        let mut invalid = br#"{"payload":""#.to_vec();
        invalid.extend(std::iter::repeat_n(b'x', MAX_RECORD));
        invalid.extend_from_slice(b"\"\n");
        let (_f, s) = disk(&invalid);
        assert!(s.page(1, 1).unwrap().records[0].truncated);
        assert_eq!(s.validate().unwrap(), (0, 1));
    }
    #[test]
    fn bounded_pages_and_invalid_ranges() {
        let s = Session::import("{}\n{}\n{}".into()).unwrap();
        assert!(s.page(0, 10).is_err());
        assert!(s.page(1, 1001).is_err());
        let p = s.page(2, 1).unwrap();
        assert_eq!(p.next_line, 3);
        assert!(p.has_more);
    }
    #[test]
    fn source_range_keeps_bom_crlf_and_terminal_newline() {
        let bytes = b"\xef\xbb\xbf{\"n\":1e-9,\"n\":9007199254740993}\r\nfalse\n";
        let (_f, s) = disk(bytes);
        let p = s.page(1, 10).unwrap();
        assert_eq!(
            p.records
                .iter()
                .map(|r| r.source.as_str())
                .collect::<String>()
                .as_bytes(),
            bytes
        );
        assert_eq!(
            p.records[0].json.as_deref(),
            Some("{\"n\":1e-9,\"n\":9007199254740993}")
        );
    }
    #[test]
    fn retarget_reuses_index_and_rejects_changed_destination() {
        let (file, session) = disk(b"{}\r\nfalse\n");
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("saved.jsonl");
        let index_allocation = session.offsets.as_ptr();
        file.persist(&path).unwrap();
        let session = session.retarget(path.clone()).unwrap();
        assert_eq!(session.offsets.as_ptr(), index_allocation);
        assert_eq!(session.info.name, "saved.jsonl");
        assert_eq!(session.page(1, 10).unwrap().records.len(), 2);
        std::fs::write(&path, b"\"changed\"\n").unwrap();
        assert!(session.retarget(path).is_err());
    }
}

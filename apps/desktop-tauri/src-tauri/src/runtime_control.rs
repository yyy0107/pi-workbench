use std::{fmt, str};

use serde::{Deserialize, Serialize, de::IgnoredAny};
use url::Url;

pub const RUNTIME_HOST_CONTROL_VERSION: u64 = 1;
pub const RUNTIME_HOST_PROTOCOL_VERSION: u64 = 1;
pub const RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES: usize = 64 * 1024;

const JS_MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, PartialEq, Eq)]
pub struct SecretString(String);

impl SecretString {
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("[REDACTED]")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlNdjsonDecodeErrorCode {
    FrameTooLarge,
    InvalidEncoding,
    InvalidJson,
    IncompleteFrame,
    Finished,
}

impl ControlNdjsonDecodeErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::FrameTooLarge => "frame-too-large",
            Self::InvalidEncoding => "invalid-encoding",
            Self::InvalidJson => "invalid-json",
            Self::IncompleteFrame => "incomplete-frame",
            Self::Finished => "decoder-finished",
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{code}", code = .code.as_str())]
pub struct ControlNdjsonDecodeError {
    pub code: ControlNdjsonDecodeErrorCode,
}

impl ControlNdjsonDecodeError {
    fn new(code: ControlNdjsonDecodeErrorCode) -> Self {
        Self { code }
    }
}

/// A byte-bounded decoder matching `@workbench/host-contracts/control-ndjson`.
///
/// LF terminates every record and is not counted against the 64 KiB content limit. Records are
/// returned as raw bytes so the directional DTO parser, rather than a generic JSON value, retains
/// authority over duplicate-field behavior.
#[derive(Debug, Default)]
pub struct ControlNdjsonDecoder {
    pending: Vec<u8>,
    finished: bool,
}

impl ControlNdjsonDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Vec<u8>>, ControlNdjsonDecodeError> {
        if self.finished {
            return Err(ControlNdjsonDecodeError::new(
                ControlNdjsonDecodeErrorCode::Finished,
            ));
        }

        let mut records = Vec::new();
        for byte in chunk {
            if *byte != b'\n' {
                if self.pending.len() == RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES {
                    return Err(ControlNdjsonDecodeError::new(
                        ControlNdjsonDecodeErrorCode::FrameTooLarge,
                    ));
                }
                self.pending.push(*byte);
                continue;
            }

            if str::from_utf8(&self.pending).is_err() {
                return Err(ControlNdjsonDecodeError::new(
                    ControlNdjsonDecodeErrorCode::InvalidEncoding,
                ));
            }
            if serde_json::from_slice::<IgnoredAny>(&self.pending).is_err() {
                return Err(ControlNdjsonDecodeError::new(
                    ControlNdjsonDecodeErrorCode::InvalidJson,
                ));
            }
            records.push(std::mem::take(&mut self.pending));
        }
        Ok(records)
    }

    pub fn finish(&mut self) -> Result<(), ControlNdjsonDecodeError> {
        if self.finished {
            return Ok(());
        }
        self.finished = true;
        if self.pending.is_empty() {
            Ok(())
        } else {
            Err(ControlNdjsonDecodeError::new(
                ControlNdjsonDecodeErrorCode::IncompleteFrame,
            ))
        }
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RuntimeHostControlFrameError {
    #[error("invalid-runtime-host-control-frame")]
    InvalidFrame,
    #[error("runtime-host-control-frame-too-large")]
    FrameTooLarge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RuntimeHostShutdownReason {
    #[serde(rename = "requested")]
    Requested,
    #[serde(rename = "container-exit")]
    ContainerExit,
    #[serde(rename = "restart")]
    Restart,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeHostStartFrame {
    pub access_token: SecretString,
    pub allowed_origins: Vec<String>,
}

impl RuntimeHostStartFrame {
    pub fn new(
        access_token: String,
        allowed_origins: impl IntoIterator<Item = String>,
    ) -> Result<Self, RuntimeHostControlFrameError> {
        if !credential_safe(&access_token, 8_192) {
            return Err(RuntimeHostControlFrameError::InvalidFrame);
        }
        let allowed_origins = allowed_origins
            .into_iter()
            .map(|origin| canonical_renderer_origin(&origin))
            .collect::<Option<Vec<_>>>()
            .ok_or(RuntimeHostControlFrameError::InvalidFrame)?;
        if allowed_origins.is_empty()
            || allowed_origins.len() > 16
            || allowed_origins
                .iter()
                .enumerate()
                .any(|(index, origin)| allowed_origins[..index].contains(origin))
        {
            return Err(RuntimeHostControlFrameError::InvalidFrame);
        }
        Ok(Self {
            access_token: SecretString(access_token),
            allowed_origins,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeHostShutdownFrame {
    pub reason: RuntimeHostShutdownReason,
    pub deadline_ms: u64,
}

impl RuntimeHostShutdownFrame {
    pub fn new(
        reason: RuntimeHostShutdownReason,
        deadline_ms: u64,
    ) -> Result<Self, RuntimeHostControlFrameError> {
        if !(1..=60_000).contains(&deadline_ms) {
            return Err(RuntimeHostControlFrameError::InvalidFrame);
        }
        Ok(Self {
            reason,
            deadline_ms,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeHostControlInputFrame {
    Start(RuntimeHostStartFrame),
    Shutdown(RuntimeHostShutdownFrame),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeHostReadyFrame {
    pub instance_id: String,
    pub pid: u64,
    pub http_origin: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub enum RuntimeHostStartupErrorCode {
    #[serde(rename = "invalid-control-frame")]
    InvalidControlFrame,
    #[serde(rename = "unsupported-control-version")]
    UnsupportedControlVersion,
    #[serde(rename = "startup-failed")]
    StartupFailed,
}

impl RuntimeHostStartupErrorCode {
    pub const fn message(self) -> &'static str {
        match self {
            Self::InvalidControlFrame => "Runtime Host control input is invalid.",
            Self::UnsupportedControlVersion => {
                "Runtime Host control protocol version is unsupported."
            }
            Self::StartupFailed => "Runtime Host startup failed.",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeHostControlOutputFrame {
    Ready(RuntimeHostReadyFrame),
    StartupError(RuntimeHostStartupErrorCode),
    ShutdownAck,
}

#[derive(Serialize)]
struct StartWire<'a> {
    #[serde(rename = "type")]
    frame_type: &'static str,
    #[serde(rename = "controlVersion")]
    control_version: u64,
    #[serde(rename = "authMode")]
    auth_mode: &'static str,
    #[serde(rename = "accessToken")]
    access_token: &'a str,
    #[serde(rename = "allowedOrigins")]
    allowed_origins: &'a [String],
}

#[derive(Serialize)]
struct ShutdownWire {
    #[serde(rename = "type")]
    frame_type: &'static str,
    #[serde(rename = "controlVersion")]
    control_version: u64,
    reason: RuntimeHostShutdownReason,
    #[serde(rename = "deadlineMs")]
    deadline_ms: u64,
}

pub fn encode_runtime_host_control_input_frame(
    frame: &RuntimeHostControlInputFrame,
) -> Result<Vec<u8>, RuntimeHostControlFrameError> {
    let mut encoded = match frame {
        RuntimeHostControlInputFrame::Start(frame) => serde_json::to_vec(&StartWire {
            frame_type: "start",
            control_version: RUNTIME_HOST_CONTROL_VERSION,
            auth_mode: "desktop-sidecar",
            access_token: frame.access_token.expose(),
            allowed_origins: &frame.allowed_origins,
        }),
        RuntimeHostControlInputFrame::Shutdown(frame) => serde_json::to_vec(&ShutdownWire {
            frame_type: "shutdown",
            control_version: RUNTIME_HOST_CONTROL_VERSION,
            reason: frame.reason,
            deadline_ms: frame.deadline_ms,
        }),
    }
    .map_err(|_| RuntimeHostControlFrameError::InvalidFrame)?;
    if encoded.len() > RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES {
        return Err(RuntimeHostControlFrameError::FrameTooLarge);
    }
    encoded.push(b'\n');
    Ok(encoded)
}

#[cfg(test)]
#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum InputWire {
    #[serde(rename = "start")]
    Start {
        #[serde(rename = "controlVersion")]
        control_version: u64,
        #[serde(rename = "authMode")]
        auth_mode: String,
        #[serde(rename = "accessToken")]
        access_token: String,
        #[serde(rename = "allowedOrigins")]
        allowed_origins: Vec<String>,
    },
    #[serde(rename = "shutdown")]
    Shutdown {
        #[serde(rename = "controlVersion")]
        control_version: u64,
        reason: RuntimeHostShutdownReason,
        #[serde(rename = "deadlineMs")]
        deadline_ms: u64,
    },
}

#[cfg(test)]
pub fn parse_runtime_host_control_input_frame(
    bytes: &[u8],
) -> Result<RuntimeHostControlInputFrame, RuntimeHostControlFrameError> {
    let wire: InputWire =
        serde_json::from_slice(bytes).map_err(|_| RuntimeHostControlFrameError::InvalidFrame)?;
    match wire {
        InputWire::Start {
            control_version,
            auth_mode,
            access_token,
            allowed_origins,
        } if control_version == RUNTIME_HOST_CONTROL_VERSION && auth_mode == "desktop-sidecar" => {
            RuntimeHostStartFrame::new(access_token, allowed_origins)
                .map(RuntimeHostControlInputFrame::Start)
        }
        InputWire::Shutdown {
            control_version,
            reason,
            deadline_ms,
        } if control_version == RUNTIME_HOST_CONTROL_VERSION => {
            RuntimeHostShutdownFrame::new(reason, deadline_ms)
                .map(RuntimeHostControlInputFrame::Shutdown)
        }
        _ => Err(RuntimeHostControlFrameError::InvalidFrame),
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
enum OutputWire {
    #[serde(rename = "ready")]
    Ready {
        #[serde(rename = "controlVersion")]
        control_version: u64,
        #[serde(rename = "hostProtocolVersion")]
        host_protocol_version: u64,
        #[serde(rename = "instanceId")]
        instance_id: String,
        pid: u64,
        #[serde(rename = "httpOrigin")]
        http_origin: String,
    },
    #[serde(rename = "startup-error")]
    StartupError {
        #[serde(rename = "controlVersion")]
        control_version: u64,
        code: RuntimeHostStartupErrorCode,
        message: String,
    },
    #[serde(rename = "shutdown-ack")]
    ShutdownAck {
        #[serde(rename = "controlVersion")]
        control_version: u64,
    },
}

pub fn parse_runtime_host_control_output_frame(
    bytes: &[u8],
) -> Result<RuntimeHostControlOutputFrame, RuntimeHostControlFrameError> {
    let wire: OutputWire =
        serde_json::from_slice(bytes).map_err(|_| RuntimeHostControlFrameError::InvalidFrame)?;
    match wire {
        OutputWire::Ready {
            control_version,
            host_protocol_version,
            instance_id,
            pid,
            http_origin,
        } if control_version == RUNTIME_HOST_CONTROL_VERSION
            && host_protocol_version == RUNTIME_HOST_PROTOCOL_VERSION
            && credential_safe(&instance_id, 512)
            && (1..=JS_MAX_SAFE_INTEGER).contains(&pid)
            && canonical_loopback_http_origin(&http_origin) =>
        {
            Ok(RuntimeHostControlOutputFrame::Ready(
                RuntimeHostReadyFrame {
                    instance_id,
                    pid,
                    http_origin,
                },
            ))
        }
        OutputWire::StartupError {
            control_version,
            code,
            message,
        } if control_version == RUNTIME_HOST_CONTROL_VERSION && message == code.message() => {
            Ok(RuntimeHostControlOutputFrame::StartupError(code))
        }
        OutputWire::ShutdownAck { control_version }
            if control_version == RUNTIME_HOST_CONTROL_VERSION =>
        {
            Ok(RuntimeHostControlOutputFrame::ShutdownAck)
        }
        _ => Err(RuntimeHostControlFrameError::InvalidFrame),
    }
}

pub fn canonical_renderer_origin(value: &str) -> Option<String> {
    if value.is_empty()
        || value.trim() != value
        || value == "*"
        || value == "null"
        || utf16_len(value) > 2_048
        || value.contains(['\r', '\n'])
    {
        return None;
    }
    let parsed = Url::parse(value).ok()?;
    if parsed.host().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !(parsed.path().is_empty() || parsed.path() == "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return None;
    }

    let standard_origin = parsed.origin().ascii_serialization();
    if standard_origin != "null" {
        return Some(standard_origin);
    }

    let mut origin = format!("{}://{}", parsed.scheme(), parsed.host()?);
    if let Some(port) = parsed.port() {
        origin.push(':');
        origin.push_str(&port.to_string());
    }
    Some(origin)
}

fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

fn credential_safe(value: &str, maximum_utf16_length: usize) -> bool {
    !value.is_empty()
        && utf16_len(value) <= maximum_utf16_length
        && value
            .chars()
            .all(|character| !matches!(character as u32, 0..=32 | 127))
}

fn canonical_loopback_http_origin(value: &str) -> bool {
    let Ok(parsed) = Url::parse(value) else {
        return false;
    };
    let Some(port) = parsed.port() else {
        return false;
    };
    parsed.scheme() == "http"
        && parsed.host_str() == Some("127.0.0.1")
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && parsed.path() == "/"
        && parsed.query().is_none()
        && parsed.fragment().is_none()
        && value == format!("http://127.0.0.1:{port}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    const SHARED_RUNTIME_CONTROL_FIXTURES: &str = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/workbench/host-contracts/fixtures/runtime-host-control/v1/cases.json"
    ));

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixtureDocument {
        fixture_schema_version: u64,
        control_version: u64,
        host_protocol_version: u64,
        maximum_frame_bytes: usize,
        cases: Vec<FixtureCase>,
        compatibility_exceptions: Vec<CompatibilityException>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixtureCase {
        id: String,
        direction: FixtureDirection,
        bytes: ByteRecipe,
        byte_length: usize,
        #[serde(default)]
        canonical_serialization: bool,
        chunkings: Vec<FixtureChunking>,
        expect: FixtureExpectation,
    }

    #[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "kebab-case")]
    enum FixtureDirection {
        ContainerToHost,
        HostToContainer,
        FramingOnly,
    }

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
    enum ByteRecipe {
        Utf8 { value: String },
        Hex { value: String },
        Segments { value: Vec<ByteSegment> },
    }

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
    enum ByteSegment {
        Hex { value: String },
        RepeatHex { value: String, count: usize },
    }

    #[derive(Deserialize)]
    #[serde(untagged)]
    enum FixtureChunking {
        Named(String),
        Cuts { cuts: Vec<usize> },
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct FixtureExpectation {
        ndjson: NdjsonExpectation,
        #[serde(default)]
        dto: Option<DtoExpectation>,
        #[serde(default)]
        input_error_code: Option<String>,
    }

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
    enum NdjsonExpectation {
        Frames { count: usize },
        Error { code: String, when: ErrorStage },
    }

    #[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "kebab-case")]
    enum ErrorStage {
        Push,
        Finish,
    }

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
    enum DtoExpectation {
        Accept {
            #[serde(rename = "type")]
            frame_type: String,
        },
        Reject,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct CompatibilityException {
        id: String,
        parity_gate: bool,
        bytes: ByteRecipe,
        typescript_current_behavior: String,
        rust_requirement: String,
    }

    enum DecodeObservation {
        Frames(Vec<Vec<u8>>),
        Error {
            stage: ErrorStage,
            code: ControlNdjsonDecodeErrorCode,
        },
    }

    fn shared_fixtures() -> FixtureDocument {
        serde_json::from_str(SHARED_RUNTIME_CONTROL_FIXTURES)
            .expect("shared Runtime Host control fixtures must match their versioned schema")
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        assert_eq!(value.len() % 2, 0, "hex fixture length must be even");
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let pair = std::str::from_utf8(pair).expect("hex fixture must be ASCII");
                u8::from_str_radix(pair, 16).expect("hex fixture must contain only hex digits")
            })
            .collect()
    }

    fn bytes_from_recipe(recipe: &ByteRecipe) -> Vec<u8> {
        match recipe {
            ByteRecipe::Utf8 { value } => value.as_bytes().to_vec(),
            ByteRecipe::Hex { value } => decode_hex(value),
            ByteRecipe::Segments { value } => value
                .iter()
                .flat_map(|segment| match segment {
                    ByteSegment::Hex { value } => decode_hex(value),
                    ByteSegment::RepeatHex { value, count } => {
                        let bytes = decode_hex(value);
                        assert_eq!(bytes.len(), 1, "repeat-hex must describe exactly one byte");
                        vec![bytes[0]; *count]
                    }
                })
                .collect(),
        }
    }

    fn chunks_for<'a>(bytes: &'a [u8], chunking: &FixtureChunking) -> Vec<&'a [u8]> {
        match chunking {
            FixtureChunking::Named(name) if name == "whole" => vec![bytes],
            FixtureChunking::Named(name) if name == "one-byte" => (0..bytes.len())
                .map(|index| &bytes[index..index + 1])
                .collect(),
            FixtureChunking::Named(name) => panic!("unknown fixture chunking {name}"),
            FixtureChunking::Cuts { cuts } => {
                assert!(
                    cuts.windows(2).all(|pair| pair[0] < pair[1]),
                    "fixture cuts must be strictly increasing"
                );
                assert!(
                    cuts.iter().all(|cut| *cut > 0 && *cut < bytes.len()),
                    "fixture cuts must be internal byte offsets"
                );
                let boundaries = std::iter::once(0)
                    .chain(cuts.iter().copied())
                    .chain(std::iter::once(bytes.len()))
                    .collect::<Vec<_>>();
                boundaries
                    .windows(2)
                    .map(|pair| &bytes[pair[0]..pair[1]])
                    .collect()
            }
        }
    }

    fn decode_fixture(bytes: &[u8], chunking: &FixtureChunking) -> DecodeObservation {
        let mut decoder = ControlNdjsonDecoder::default();
        let mut records = Vec::new();
        for chunk in chunks_for(bytes, chunking) {
            match decoder.push(chunk) {
                Ok(mut decoded) => records.append(&mut decoded),
                Err(error) => {
                    return DecodeObservation::Error {
                        stage: ErrorStage::Push,
                        code: error.code,
                    };
                }
            }
        }
        match decoder.finish() {
            Ok(()) => DecodeObservation::Frames(records),
            Err(error) => DecodeObservation::Error {
                stage: ErrorStage::Finish,
                code: error.code,
            },
        }
    }

    fn input_frame_type(frame: &RuntimeHostControlInputFrame) -> &'static str {
        match frame {
            RuntimeHostControlInputFrame::Start(_) => "start",
            RuntimeHostControlInputFrame::Shutdown(_) => "shutdown",
        }
    }

    fn output_frame_type(frame: &RuntimeHostControlOutputFrame) -> &'static str {
        match frame {
            RuntimeHostControlOutputFrame::Ready(_) => "ready",
            RuntimeHostControlOutputFrame::StartupError(_) => "startup-error",
            RuntimeHostControlOutputFrame::ShutdownAck => "shutdown-ack",
        }
    }

    fn assert_dto_expectation(fixture: &FixtureCase, bytes: &[u8], records: &[Vec<u8>]) {
        let Some(expectation) = &fixture.expect.dto else {
            return;
        };
        assert_eq!(records.len(), 1, "{} must decode one DTO", fixture.id);
        let record = &records[0];
        match (fixture.direction, expectation) {
            (FixtureDirection::ContainerToHost, DtoExpectation::Accept { frame_type }) => {
                let parsed = parse_runtime_host_control_input_frame(record)
                    .unwrap_or_else(|_| panic!("{} must be an accepted input DTO", fixture.id));
                assert_eq!(input_frame_type(&parsed), frame_type);
                if fixture.canonical_serialization {
                    assert_eq!(
                        encode_runtime_host_control_input_frame(&parsed)
                            .expect("canonical input DTO must encode"),
                        bytes,
                        "{} must retain the shared canonical bytes",
                        fixture.id
                    );
                }
            }
            (FixtureDirection::ContainerToHost, DtoExpectation::Reject) => {
                assert!(
                    parse_runtime_host_control_input_frame(record).is_err(),
                    "{} must reject the input DTO",
                    fixture.id
                );
                assert!(
                    matches!(
                        fixture.expect.input_error_code.as_deref(),
                        Some("invalid-control-frame" | "unsupported-control-version")
                    ),
                    "{} must document the Host-side input error class",
                    fixture.id
                );
            }
            (FixtureDirection::HostToContainer, DtoExpectation::Accept { frame_type }) => {
                let parsed = parse_runtime_host_control_output_frame(record)
                    .unwrap_or_else(|_| panic!("{} must be an accepted output DTO", fixture.id));
                assert_eq!(output_frame_type(&parsed), frame_type);
            }
            (FixtureDirection::HostToContainer, DtoExpectation::Reject) => assert!(
                parse_runtime_host_control_output_frame(record).is_err(),
                "{} must reject the output DTO",
                fixture.id
            ),
            (FixtureDirection::FramingOnly, _) => {
                panic!(
                    "{} cannot assign a DTO expectation to framing-only bytes",
                    fixture.id
                )
            }
        }
    }

    #[test]
    fn consumes_the_shared_runtime_control_golden_fixtures() {
        let fixtures = shared_fixtures();
        assert_eq!(fixtures.fixture_schema_version, 1);
        assert_eq!(fixtures.control_version, RUNTIME_HOST_CONTROL_VERSION);
        assert_eq!(
            fixtures.host_protocol_version,
            RUNTIME_HOST_PROTOCOL_VERSION
        );
        assert_eq!(
            fixtures.maximum_frame_bytes,
            RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES
        );

        let mut ids = HashSet::new();
        for fixture in &fixtures.cases {
            assert!(
                ids.insert(&fixture.id),
                "duplicate fixture id {}",
                fixture.id
            );
            let bytes = bytes_from_recipe(&fixture.bytes);
            assert_eq!(
                bytes.len(),
                fixture.byte_length,
                "{} byte length",
                fixture.id
            );

            for chunking in &fixture.chunkings {
                match (&fixture.expect.ndjson, decode_fixture(&bytes, chunking)) {
                    (NdjsonExpectation::Frames { count }, DecodeObservation::Frames(records)) => {
                        assert_eq!(records.len(), *count, "{} frame count", fixture.id);
                        assert_dto_expectation(fixture, &bytes, &records);
                    }
                    (
                        NdjsonExpectation::Error { code, when },
                        DecodeObservation::Error {
                            stage,
                            code: actual_code,
                        },
                    ) => {
                        assert_eq!(stage, *when, "{} error stage", fixture.id);
                        assert_eq!(actual_code.as_str(), code, "{} error code", fixture.id);
                    }
                    _ => panic!("{} produced the wrong NDJSON result", fixture.id),
                }
            }
        }

        let mut exception_ids = HashSet::new();
        for exception in &fixtures.compatibility_exceptions {
            assert!(
                exception_ids.insert(&exception.id),
                "duplicate compatibility exception id {}",
                exception.id
            );
            assert!(!exception.parity_gate);
            assert!(!bytes_from_recipe(&exception.bytes).is_empty());
            assert!(!exception.typescript_current_behavior.is_empty());
            assert!(!exception.rust_requirement.is_empty());
        }
    }

    #[test]
    fn decodes_coalesced_shared_frames_across_utf8_and_record_boundaries() {
        let fixtures = shared_fixtures();
        let selected = [
            "host.ready.utf8-splits",
            "host.shutdown-ack",
            "container.start.tauri-origin",
            "container.shutdown.requested",
        ]
        .map(|id| {
            let fixture = fixtures
                .cases
                .iter()
                .find(|fixture| fixture.id == id)
                .unwrap_or_else(|| panic!("missing shared fixture {id}"));
            bytes_from_recipe(&fixture.bytes)
        });
        let bytes = selected.concat();
        let chunking = FixtureChunking::Cuts {
            cuts: vec![1, 74, 77, 80, 84, 137, 180, 181],
        };
        let DecodeObservation::Frames(records) = decode_fixture(&bytes, &chunking) else {
            panic!("coalesced shared fixtures must decode");
        };
        assert_eq!(records.len(), 4);
        assert_eq!(
            output_frame_type(
                &parse_runtime_host_control_output_frame(&records[0]).expect("ready frame")
            ),
            "ready"
        );
        assert_eq!(
            output_frame_type(
                &parse_runtime_host_control_output_frame(&records[1]).expect("ack frame")
            ),
            "shutdown-ack"
        );
        assert_eq!(
            input_frame_type(
                &parse_runtime_host_control_input_frame(&records[2]).expect("start frame")
            ),
            "start"
        );
        assert_eq!(
            input_frame_type(
                &parse_runtime_host_control_input_frame(&records[3]).expect("shutdown frame")
            ),
            "shutdown"
        );
    }

    #[test]
    fn canonicalizes_the_bundled_tauri_origin_without_accepting_remote_paths() {
        assert_eq!(
            canonical_renderer_origin("tauri://localhost/"),
            Some("tauri://localhost".to_string())
        );
        assert_eq!(
            canonical_renderer_origin("http://tauri.localhost/"),
            Some("http://tauri.localhost".to_string())
        );
        assert_eq!(canonical_renderer_origin("tauri://localhost/path"), None);
        assert_eq!(canonical_renderer_origin("null"), None);
        assert_eq!(canonical_renderer_origin("*"), None);
    }

    #[test]
    fn encodes_exact_start_and_shutdown_frames_without_debugging_the_token() {
        let start = RuntimeHostControlInputFrame::Start(
            RuntimeHostStartFrame::new(
                "fixture-access-token".to_string(),
                ["tauri://localhost/".to_string()],
            )
            .expect("valid start frame"),
        );
        assert_eq!(
            encode_runtime_host_control_input_frame(&start).expect("encoded start"),
            br#"{"type":"start","controlVersion":1,"authMode":"desktop-sidecar","accessToken":"fixture-access-token","allowedOrigins":["tauri://localhost"]}
"#
        );
        assert!(!format!("{start:?}").contains("fixture-access-token"));

        let shutdown = RuntimeHostControlInputFrame::Shutdown(
            RuntimeHostShutdownFrame::new(RuntimeHostShutdownReason::ContainerExit, 5_000)
                .expect("valid shutdown frame"),
        );
        assert_eq!(
            encode_runtime_host_control_input_frame(&shutdown).expect("encoded shutdown"),
            br#"{"type":"shutdown","controlVersion":1,"reason":"container-exit","deadlineMs":5000}
"#
        );
    }

    #[test]
    fn decoder_is_byte_bounded_and_requires_a_final_lf() {
        let mut decoder = ControlNdjsonDecoder::default();
        assert!(decoder.push(br#"{"type":"shutdown"}"#).unwrap().is_empty());
        assert_eq!(
            decoder.finish().unwrap_err().code,
            ControlNdjsonDecodeErrorCode::IncompleteFrame
        );

        let mut decoder = ControlNdjsonDecoder::default();
        let oversized = vec![b'a'; RUNTIME_HOST_CONTROL_MAX_FRAME_BYTES + 1];
        assert_eq!(
            decoder.push(&oversized).unwrap_err().code,
            ControlNdjsonDecodeErrorCode::FrameTooLarge
        );

        let mut decoder = ControlNdjsonDecoder::default();
        assert_eq!(
            decoder.push(&[0xff, b'\n']).unwrap_err().code,
            ControlNdjsonDecodeErrorCode::InvalidEncoding
        );
    }

    #[test]
    fn output_parser_rejects_extra_keys_and_noncanonical_runtime_identity() {
        let ready = br#"{"type":"ready","controlVersion":1,"hostProtocolVersion":1,"instanceId":"runtime-fixture","pid":4242,"httpOrigin":"http://127.0.0.1:43127"}"#;
        assert_eq!(
            parse_runtime_host_control_output_frame(ready).expect("valid ready"),
            RuntimeHostControlOutputFrame::Ready(RuntimeHostReadyFrame {
                instance_id: "runtime-fixture".to_string(),
                pid: 4_242,
                http_origin: "http://127.0.0.1:43127".to_string(),
            })
        );
        assert!(
            parse_runtime_host_control_output_frame(
                br#"{"type":"ready","controlVersion":1,"hostProtocolVersion":1,"instanceId":"runtime-fixture","pid":4242,"httpOrigin":"http://127.0.0.1:43127","accessToken":"leak"}"#
            )
            .is_err()
        );
        assert!(
            parse_runtime_host_control_output_frame(
                br#"{"type":"ready","controlVersion":1,"hostProtocolVersion":1,"instanceId":"runtime-fixture","pid":0,"httpOrigin":"http://127.0.0.1:43127"}"#
            )
            .is_err()
        );
        assert!(
            parse_runtime_host_control_output_frame(
                br#"{"type":"ready","controlVersion":1,"hostProtocolVersion":1,"instanceId":"runtime-fixture","pid":4242,"httpOrigin":"http://localhost:43127"}"#
            )
            .is_err()
        );
    }
}

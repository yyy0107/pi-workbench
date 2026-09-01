use std::{
    fmt::Write as _,
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Read},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const ENVELOPE_SCHEMA_VERSION: u64 = 1;
const ENVELOPE_KIND: &str = "workbench-tauri-sidecar-envelope";
const ENVELOPE_FILENAME: &str = "tauri-sidecar-envelope.json";
const MATERIALIZED_TREE_ALGORITHM: &str = "sha256-utf8-path-type-size-content-v1";
const RUNTIME_MANIFEST_FILENAME: &str = "artifact-manifest.json";
const RUNTIME_SIDECAR_BASENAME: &str = "workbench-runtime-node";
const MAXIMUM_ENVELOPE_BYTES: u64 = 64 * 1024;
const MAXIMUM_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, thiserror::Error)]
#[error("runtime-sidecar-envelope-invalid")]
pub struct RuntimeEnvelopeError;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NodeArtifactTarget {
    runtime_flavor: String,
    platform: String,
    arch: String,
    target_triple: String,
    libc: String,
    node_version: String,
    node_module_abi: u64,
    napi_version: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct NodeBinaryEnvelope {
    filename: String,
    size: u64,
    sha256: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SourceManifestEnvelope {
    filename: String,
    size: u64,
    sha256: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MaterializedTreeEnvelope {
    algorithm: String,
    sha256: String,
    file_count: u64,
    directory_count: u64,
    total_bytes: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TauriSidecarEnvelope {
    schema_version: u64,
    kind: String,
    target: NodeArtifactTarget,
    node_binary: NodeBinaryEnvelope,
    source_manifest: SourceManifestEnvelope,
    materialized_tree: MaterializedTreeEnvelope,
}

#[derive(Debug, PartialEq, Eq)]
struct FileMeasurement {
    size: u64,
    sha256: String,
}

#[derive(Debug)]
enum TreeRecord {
    Directory {
        path: String,
    },
    File {
        path: String,
        size: u64,
        sha256: String,
    },
}

impl TreeRecord {
    fn path(&self) -> &str {
        match self {
            Self::Directory { path } | Self::File { path, .. } => path,
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
struct TreeDigest {
    sha256: String,
    file_count: u64,
    directory_count: u64,
    total_bytes: u64,
}

fn invalid<T>() -> Result<T, RuntimeEnvelopeError> {
    Err(RuntimeEnvelopeError)
}

fn is_lowercase_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn sha256_hex(hasher: Sha256) -> String {
    let bytes = hasher.finalize();
    let mut encoded = String::with_capacity(64);
    for byte in bytes {
        write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

fn path_is_inside(root: &Path, candidate: &Path) -> bool {
    candidate == root || candidate.strip_prefix(root).is_ok()
}

fn open_without_following(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    options.open(path)
}

#[cfg(unix)]
fn same_file_metadata(left: &Metadata, right: &Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    left.dev() == right.dev()
        && left.ino() == right.ino()
        && left.mode() == right.mode()
        && left.size() == right.size()
        && left.mtime() == right.mtime()
        && left.mtime_nsec() == right.mtime_nsec()
        && left.ctime() == right.ctime()
        && left.ctime_nsec() == right.ctime_nsec()
}

#[cfg(windows)]
fn same_file_metadata(left: &Metadata, right: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    left.file_attributes() == right.file_attributes()
        && left.creation_time() == right.creation_time()
        && left.last_write_time() == right.last_write_time()
        && left.file_size() == right.file_size()
}

#[cfg(not(any(unix, windows)))]
fn same_file_metadata(left: &Metadata, right: &Metadata) -> bool {
    left.len() == right.len()
        && left.modified().ok() == right.modified().ok()
        && left.permissions().readonly() == right.permissions().readonly()
}

fn require_single_link(metadata: &Metadata) -> Result<(), RuntimeEnvelopeError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() != 1 {
            return invalid();
        }
    }
    Ok(())
}

fn measure_regular_file(
    path: &Path,
    confined_root: &Path,
) -> Result<FileMeasurement, RuntimeEnvelopeError> {
    let lexical = fs::symlink_metadata(path).map_err(|_| RuntimeEnvelopeError)?;
    if !lexical.is_file() || lexical.file_type().is_symlink() {
        return invalid();
    }
    let resolved = fs::canonicalize(path).map_err(|_| RuntimeEnvelopeError)?;
    if resolved != path || !path_is_inside(confined_root, &resolved) {
        return invalid();
    }
    let mut file = open_without_following(path).map_err(|_| RuntimeEnvelopeError)?;
    let before = file.metadata().map_err(|_| RuntimeEnvelopeError)?;
    if !before.is_file() {
        return invalid();
    }
    require_single_link(&before)?;
    if before.len() > MAXIMUM_SAFE_INTEGER {
        return invalid();
    }
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    let mut size = 0_u64;
    loop {
        let count = file.read(&mut buffer).map_err(|_| RuntimeEnvelopeError)?;
        if count == 0 {
            break;
        }
        size = size
            .checked_add(u64::try_from(count).map_err(|_| RuntimeEnvelopeError)?)
            .filter(|value| *value <= MAXIMUM_SAFE_INTEGER)
            .ok_or(RuntimeEnvelopeError)?;
        hasher.update(&buffer[..count]);
    }
    let after = file.metadata().map_err(|_| RuntimeEnvelopeError)?;
    let lexical_after = fs::symlink_metadata(path).map_err(|_| RuntimeEnvelopeError)?;
    let resolved_after = fs::canonicalize(path).map_err(|_| RuntimeEnvelopeError)?;
    if size != before.len()
        || !same_file_metadata(&before, &after)
        || !lexical_after.is_file()
        || lexical_after.file_type().is_symlink()
        || resolved_after != resolved
    {
        return invalid();
    }
    Ok(FileMeasurement {
        size,
        sha256: sha256_hex(hasher),
    })
}

fn read_envelope(runtime_root: &Path) -> Result<TauriSidecarEnvelope, RuntimeEnvelopeError> {
    let path = runtime_root.join(ENVELOPE_FILENAME);
    let lexical = fs::symlink_metadata(&path).map_err(|_| RuntimeEnvelopeError)?;
    if !lexical.is_file()
        || lexical.file_type().is_symlink()
        || lexical.len() == 0
        || lexical.len() > MAXIMUM_ENVELOPE_BYTES
    {
        return invalid();
    }
    let resolved = fs::canonicalize(&path).map_err(|_| RuntimeEnvelopeError)?;
    if resolved != path || resolved.parent() != Some(runtime_root) {
        return invalid();
    }
    let mut file = open_without_following(&path).map_err(|_| RuntimeEnvelopeError)?;
    let before = file.metadata().map_err(|_| RuntimeEnvelopeError)?;
    require_single_link(&before)?;
    let mut bytes = Vec::with_capacity(usize::try_from(before.len()).unwrap_or(0));
    file.read_to_end(&mut bytes)
        .map_err(|_| RuntimeEnvelopeError)?;
    let after = file.metadata().map_err(|_| RuntimeEnvelopeError)?;
    if !same_file_metadata(&before, &after) || u64::try_from(bytes.len()).ok() != Some(before.len())
    {
        return invalid();
    }
    let envelope: TauriSidecarEnvelope =
        serde_json::from_slice(&bytes).map_err(|_| RuntimeEnvelopeError)?;
    let canonical = format!(
        "{}\n",
        serde_json::to_string_pretty(&envelope).map_err(|_| RuntimeEnvelopeError)?
    );
    if canonical.as_bytes() != bytes {
        return invalid();
    }
    Ok(envelope)
}

fn canonical_directory(path: &Path) -> Result<PathBuf, RuntimeEnvelopeError> {
    if !path.is_absolute() {
        return invalid();
    }
    let lexical = fs::symlink_metadata(path).map_err(|_| RuntimeEnvelopeError)?;
    if !lexical.is_dir() || lexical.file_type().is_symlink() {
        return invalid();
    }
    let resolved = fs::canonicalize(path).map_err(|_| RuntimeEnvelopeError)?;
    if resolved != path {
        return invalid();
    }
    Ok(resolved)
}

fn collect_tree_records(
    root: &Path,
    directory: &Path,
    relative: &str,
    records: &mut Vec<TreeRecord>,
) -> Result<(), RuntimeEnvelopeError> {
    let lexical = fs::symlink_metadata(directory).map_err(|_| RuntimeEnvelopeError)?;
    if !lexical.is_dir() || lexical.file_type().is_symlink() {
        return invalid();
    }
    let resolved = fs::canonicalize(directory).map_err(|_| RuntimeEnvelopeError)?;
    if resolved != directory || !path_is_inside(root, &resolved) {
        return invalid();
    }
    records.push(TreeRecord::Directory {
        path: relative.to_owned(),
    });

    for entry in fs::read_dir(directory).map_err(|_| RuntimeEnvelopeError)? {
        let entry = entry.map_err(|_| RuntimeEnvelopeError)?;
        let name = entry.file_name();
        let name = name.to_str().ok_or(RuntimeEnvelopeError)?;
        let child_relative = if relative == "." {
            name.to_owned()
        } else {
            format!("{relative}/{name}")
        };
        if relative == "." && child_relative == ENVELOPE_FILENAME {
            continue;
        }
        let child = entry.path();
        let child_lexical = fs::symlink_metadata(&child).map_err(|_| RuntimeEnvelopeError)?;
        if child_lexical.file_type().is_symlink() {
            return invalid();
        }
        if child_lexical.is_dir() {
            collect_tree_records(root, &child, &child_relative, records)?;
        } else if child_lexical.is_file() {
            let measurement = measure_regular_file(&child, root)?;
            records.push(TreeRecord::File {
                path: child_relative,
                size: measurement.size,
                sha256: measurement.sha256,
            });
        } else {
            return invalid();
        }
    }
    Ok(())
}

fn digest_runtime_tree(runtime_root: &Path) -> Result<TreeDigest, RuntimeEnvelopeError> {
    let mut records = Vec::new();
    collect_tree_records(runtime_root, runtime_root, ".", &mut records)?;
    records.sort_by(|left, right| left.path().as_bytes().cmp(right.path().as_bytes()));
    let mut seen = None::<&str>;
    let mut aggregate = Sha256::new();
    let mut file_count = 0_u64;
    let mut directory_count = 0_u64;
    let mut total_bytes = 0_u64;
    for record in &records {
        if seen == Some(record.path()) {
            return invalid();
        }
        seen = Some(record.path());
        let path_bytes = record.path().as_bytes();
        match record {
            TreeRecord::Directory { .. } => {
                aggregate.update(b"D\0");
                aggregate.update(path_bytes.len().to_string().as_bytes());
                aggregate.update(b"\0");
                aggregate.update(path_bytes);
                aggregate.update(b"\n");
                directory_count = directory_count.checked_add(1).ok_or(RuntimeEnvelopeError)?;
            }
            TreeRecord::File { size, sha256, .. } => {
                aggregate.update(b"F\0");
                aggregate.update(path_bytes.len().to_string().as_bytes());
                aggregate.update(b"\0");
                aggregate.update(path_bytes);
                aggregate.update(b"\0");
                aggregate.update(size.to_string().as_bytes());
                aggregate.update(b"\0");
                aggregate.update(sha256.as_bytes());
                aggregate.update(b"\n");
                file_count = file_count.checked_add(1).ok_or(RuntimeEnvelopeError)?;
                total_bytes = total_bytes
                    .checked_add(*size)
                    .filter(|value| *value <= MAXIMUM_SAFE_INTEGER)
                    .ok_or(RuntimeEnvelopeError)?;
            }
        }
    }
    Ok(TreeDigest {
        sha256: sha256_hex(aggregate),
        file_count,
        directory_count,
        total_bytes,
    })
}

fn expected_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    return "darwin";
    #[cfg(target_os = "linux")]
    return "linux";
    #[cfg(target_os = "windows")]
    return "win32";
    #[allow(unreachable_code)]
    "unsupported"
}

fn expected_architecture() -> &'static str {
    #[cfg(target_arch = "x86_64")]
    return "x64";
    #[cfg(target_arch = "aarch64")]
    return "arm64";
    #[allow(unreachable_code)]
    "unsupported"
}

fn expected_libc() -> &'static str {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    return "glibc";
    #[cfg(all(target_os = "linux", target_env = "musl"))]
    return "musl";
    #[cfg(not(target_os = "linux"))]
    return "none";
    #[allow(unreachable_code)]
    "unsupported"
}

fn validate_target(target: &NodeArtifactTarget) -> Result<(), RuntimeEnvelopeError> {
    if target.runtime_flavor != "node"
        || target.platform != expected_platform()
        || target.arch != expected_architecture()
        || target.target_triple != env!("TAURI_ENV_TARGET_TRIPLE")
        || target.libc != expected_libc()
        || target.node_version.is_empty()
        || target.node_version.len() > 128
        || !target.node_version.is_ascii()
        || target.node_module_abi == 0
        || target.node_module_abi > MAXIMUM_SAFE_INTEGER
        || target.napi_version == 0
        || target.napi_version > MAXIMUM_SAFE_INTEGER
    {
        return invalid();
    }
    Ok(())
}

fn expected_source_binary_filename(target: &NodeArtifactTarget) -> String {
    format!(
        "{RUNTIME_SIDECAR_BASENAME}-{}{}",
        target.target_triple,
        if target.platform == "win32" {
            ".exe"
        } else {
            ""
        }
    )
}

fn expected_runtime_binary_filename() -> &'static str {
    #[cfg(windows)]
    return "workbench-runtime-node.exe";
    #[cfg(not(windows))]
    return RUNTIME_SIDECAR_BASENAME;
}

fn validate_envelope_shape(envelope: &TauriSidecarEnvelope) -> Result<(), RuntimeEnvelopeError> {
    validate_target(&envelope.target)?;
    if envelope.schema_version != ENVELOPE_SCHEMA_VERSION
        || envelope.kind != ENVELOPE_KIND
        || envelope.node_binary.filename != expected_source_binary_filename(&envelope.target)
        || envelope.node_binary.size == 0
        || envelope.node_binary.size > MAXIMUM_SAFE_INTEGER
        || !is_lowercase_sha256(&envelope.node_binary.sha256)
        || envelope.source_manifest.filename != RUNTIME_MANIFEST_FILENAME
        || envelope.source_manifest.size == 0
        || envelope.source_manifest.size > MAXIMUM_SAFE_INTEGER
        || !is_lowercase_sha256(&envelope.source_manifest.sha256)
        || envelope.materialized_tree.algorithm != MATERIALIZED_TREE_ALGORITHM
        || !is_lowercase_sha256(&envelope.materialized_tree.sha256)
        || envelope.materialized_tree.file_count == 0
        || envelope.materialized_tree.file_count > MAXIMUM_SAFE_INTEGER
        || envelope.materialized_tree.directory_count == 0
        || envelope.materialized_tree.directory_count > MAXIMUM_SAFE_INTEGER
        || envelope.materialized_tree.total_bytes == 0
        || envelope.materialized_tree.total_bytes > MAXIMUM_SAFE_INTEGER
    {
        return invalid();
    }
    Ok(())
}

pub fn verify_runtime_envelope(
    runtime_root: &Path,
    runtime_executable: &Path,
) -> Result<(), RuntimeEnvelopeError> {
    let runtime_root = canonical_directory(runtime_root)?;
    if !runtime_executable.is_absolute()
        || runtime_executable
            .file_name()
            .and_then(|name| name.to_str())
            != Some(expected_runtime_binary_filename())
    {
        return invalid();
    }
    let executable_parent = runtime_executable.parent().ok_or(RuntimeEnvelopeError)?;
    let executable_parent = canonical_directory(executable_parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::symlink_metadata(runtime_executable)
            .map_err(|_| RuntimeEnvelopeError)?
            .permissions()
            .mode();
        if mode & 0o111 == 0 {
            return invalid();
        }
    }
    let executable = measure_regular_file(runtime_executable, &executable_parent)?;
    let envelope = read_envelope(&runtime_root)?;
    validate_envelope_shape(&envelope)?;
    if executable.size != envelope.node_binary.size
        || executable.sha256 != envelope.node_binary.sha256
    {
        return invalid();
    }
    let manifest =
        measure_regular_file(&runtime_root.join(RUNTIME_MANIFEST_FILENAME), &runtime_root)?;
    if manifest.size != envelope.source_manifest.size
        || manifest.sha256 != envelope.source_manifest.sha256
    {
        return invalid();
    }
    let tree = digest_runtime_tree(&runtime_root)?;
    if tree.sha256 != envelope.materialized_tree.sha256
        || tree.file_count != envelope.materialized_tree.file_count
        || tree.directory_count != envelope.materialized_tree.directory_count
        || tree.total_bytes != envelope.materialized_tree.total_bytes
    {
        return invalid();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct EnvelopeFixture {
        root: PathBuf,
        runtime_root: PathBuf,
        runtime_executable: PathBuf,
    }

    impl EnvelopeFixture {
        fn new() -> Self {
            let temporary_root =
                fs::canonicalize(std::env::temp_dir()).expect("canonical temp root");
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("current time")
                .as_nanos();
            let root = temporary_root.join(format!(
                "workbench-tauri-envelope-{}-{nonce}-{}",
                std::process::id(),
                FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            let runtime_root = root.join("runtime");
            let binary_root = root.join("bin");
            fs::create_dir_all(runtime_root.join("nested")).expect("create Runtime fixture");
            fs::create_dir(&binary_root).expect("create binary fixture");
            fs::write(runtime_root.join(RUNTIME_MANIFEST_FILENAME), b"{}\n")
                .expect("write manifest fixture");
            fs::write(runtime_root.join("server.mjs"), b"export {};\n")
                .expect("write entrypoint fixture");
            fs::write(runtime_root.join("nested").join("model.txt"), b"fixture\n")
                .expect("write nested fixture");

            let runtime_executable = binary_root.join(expected_runtime_binary_filename());
            fs::copy(
                fs::canonicalize(std::env::current_exe().expect("test executable"))
                    .expect("canonical test executable"),
                &runtime_executable,
            )
            .expect("copy Runtime executable fixture");

            let fixture = Self {
                root,
                runtime_root,
                runtime_executable,
            };
            fixture.publish_envelope();
            fixture
        }

        fn publish_envelope(&self) {
            let binary = measure_regular_file(
                &self.runtime_executable,
                self.runtime_executable.parent().expect("binary parent"),
            )
            .expect("measure binary fixture");
            let manifest = measure_regular_file(
                &self.runtime_root.join(RUNTIME_MANIFEST_FILENAME),
                &self.runtime_root,
            )
            .expect("measure manifest fixture");
            let tree = digest_runtime_tree(&self.runtime_root).expect("digest Runtime fixture");
            let target = NodeArtifactTarget {
                runtime_flavor: "node".to_owned(),
                platform: expected_platform().to_owned(),
                arch: expected_architecture().to_owned(),
                target_triple: env!("TAURI_ENV_TARGET_TRIPLE").to_owned(),
                libc: expected_libc().to_owned(),
                node_version: "24.16.0".to_owned(),
                node_module_abi: 137,
                napi_version: 10,
            };
            let envelope = TauriSidecarEnvelope {
                schema_version: ENVELOPE_SCHEMA_VERSION,
                kind: ENVELOPE_KIND.to_owned(),
                node_binary: NodeBinaryEnvelope {
                    filename: expected_source_binary_filename(&target),
                    size: binary.size,
                    sha256: binary.sha256,
                },
                source_manifest: SourceManifestEnvelope {
                    filename: RUNTIME_MANIFEST_FILENAME.to_owned(),
                    size: manifest.size,
                    sha256: manifest.sha256,
                },
                materialized_tree: MaterializedTreeEnvelope {
                    algorithm: MATERIALIZED_TREE_ALGORITHM.to_owned(),
                    sha256: tree.sha256,
                    file_count: tree.file_count,
                    directory_count: tree.directory_count,
                    total_bytes: tree.total_bytes,
                },
                target,
            };
            fs::write(
                self.runtime_root.join(ENVELOPE_FILENAME),
                format!(
                    "{}\n",
                    serde_json::to_string_pretty(&envelope).expect("serialize envelope fixture")
                ),
            )
            .expect("write envelope fixture");
        }
    }

    impl Drop for EnvelopeFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn verifies_the_canonical_binary_manifest_and_complete_resource_tree() {
        let fixture = EnvelopeFixture::new();
        verify_runtime_envelope(&fixture.runtime_root, &fixture.runtime_executable)
            .expect("valid envelope");

        fs::write(fixture.runtime_root.join("server.mjs"), b"tampered\n")
            .expect("tamper Runtime fixture");
        assert!(
            verify_runtime_envelope(&fixture.runtime_root, &fixture.runtime_executable).is_err()
        );
    }

    #[test]
    fn rejects_binary_drift_and_noncanonical_envelope_shapes() {
        let binary_fixture = EnvelopeFixture::new();
        fs::write(&binary_fixture.runtime_executable, b"tampered binary")
            .expect("tamper binary fixture");
        assert!(
            verify_runtime_envelope(
                &binary_fixture.runtime_root,
                &binary_fixture.runtime_executable,
            )
            .is_err()
        );

        let shape_fixture = EnvelopeFixture::new();
        let envelope_path = shape_fixture.runtime_root.join(ENVELOPE_FILENAME);
        let mut envelope: serde_json::Value =
            serde_json::from_slice(&fs::read(&envelope_path).expect("read envelope fixture"))
                .expect("parse envelope fixture");
        envelope
            .as_object_mut()
            .expect("envelope object")
            .insert("unexpected".to_owned(), serde_json::Value::Bool(true));
        fs::write(
            envelope_path,
            format!(
                "{}\n",
                serde_json::to_string_pretty(&envelope).expect("serialize malformed envelope")
            ),
        )
        .expect("write malformed envelope");
        assert!(
            verify_runtime_envelope(
                &shape_fixture.runtime_root,
                &shape_fixture.runtime_executable,
            )
            .is_err()
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_resource_links_and_external_hard_links() {
        use std::os::unix::fs::symlink;

        let link_fixture = EnvelopeFixture::new();
        symlink(
            link_fixture.runtime_root.join("server.mjs"),
            link_fixture.runtime_root.join("linked-server.mjs"),
        )
        .expect("create resource symlink fixture");
        assert!(
            verify_runtime_envelope(&link_fixture.runtime_root, &link_fixture.runtime_executable,)
                .is_err()
        );

        let hard_link_fixture = EnvelopeFixture::new();
        fs::hard_link(
            hard_link_fixture.runtime_root.join("server.mjs"),
            hard_link_fixture.root.join("external-server.mjs"),
        )
        .expect("create external hard link fixture");
        assert!(
            verify_runtime_envelope(
                &hard_link_fixture.runtime_root,
                &hard_link_fixture.runtime_executable,
            )
            .is_err()
        );
    }

    #[test]
    fn matches_the_cross_language_utf8_tree_framing() {
        let fixture = EnvelopeFixture::new();
        for entry in fs::read_dir(&fixture.runtime_root).expect("read Runtime fixture") {
            let entry = entry.expect("Runtime fixture entry");
            let path = entry.path();
            if path.is_dir() {
                fs::remove_dir_all(path).expect("remove fixture directory");
            } else {
                fs::remove_file(path).expect("remove fixture file");
            }
        }
        fs::write(fixture.runtime_root.join("\u{e000}"), b"bmp\n").expect("write BMP fixture");
        fs::write(fixture.runtime_root.join("\u{10000}"), b"astral\n")
            .expect("write astral fixture");
        let digest = digest_runtime_tree(&fixture.runtime_root).expect("digest Unicode fixture");
        assert_eq!(
            digest.sha256,
            "8c25a0724d49af400360477e9de4c690f669f3d64224d7701432a337178ee69f"
        );
        assert_eq!(
            (
                digest.file_count,
                digest.directory_count,
                digest.total_bytes
            ),
            (2, 1, 11)
        );
    }
}

#!/usr/bin/env python3
"""Private, incremental Drive backups of the local Convex catalog and file storage.

No browser state is accessed. Restore assembles an ordinary Convex import ZIP;
it never imports into or overwrites a deployment itself.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / ".convex/drive-backup"
MANIFEST = "_ourchival_backup/manifest.json"
CHUNK = 8 * 1024 * 1024


def save(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, sort_keys=True) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def digest(path, algorithm="sha256"):
    result = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK), b""):
            result.update(chunk)
    return result.hexdigest()


def is_storage(name):
    return name.startswith("_storage/") and not name.endswith(".jsonl")


def pack(snapshot, destination, previous):
    """Include all current metadata, and only storage bytes absent from the chain."""
    with zipfile.ZipFile(snapshot) as source:
        fingerprints = {i.filename: [i.CRC, i.file_size] for i in source.infolist() if is_storage(i.filename)}
        new_files = {n for n, fp in fingerprints.items() if previous.get("storage", {}).get(n) != fp}
        manifest = {"version": 1, "createdAt": time.time(), "previous": previous.get("parts", []),
                    "requiredStorage": sorted(fingerprints), "newStorageFiles": len(new_files)}
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as target:
            for info in source.infolist():
                if is_storage(info.filename) and info.filename not in new_files:
                    continue
                with source.open(info) as incoming, target.open(info.filename, "w") as outgoing:
                    for chunk in iter(lambda: incoming.read(CHUNK), b""):
                        outgoing.write(chunk)
            target.writestr(MANIFEST, json.dumps(manifest))
    destination.chmod(0o600)
    return fingerprints, manifest


def assemble(parts, destination):
    """Fail closed on missing/changed chain parts; never restore a partial archive."""
    if destination.exists():
        raise ValueError("Restore destination already exists")
    indexed = {digest(p): p for p in parts}
    with zipfile.ZipFile(parts[-1]) as latest:
        manifest = json.loads(latest.read(MANIFEST))
        ordered = []
        for part in manifest["previous"]:
            if part["sha256"] not in indexed:
                raise ValueError("Required backup part is missing or changed")
            ordered.append(indexed[part["sha256"]])
        ordered.append(parts[-1])
        storage = {}
        for part in ordered:
            with zipfile.ZipFile(part) as archive:
                for name in archive.namelist():
                    if is_storage(name):
                        storage[name] = part
        if any(name not in storage for name in manifest["requiredStorage"]):
            raise ValueError("Required stored image is missing")
        with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as output:
            for name in latest.namelist():
                if name != MANIFEST and not is_storage(name):
                    output.writestr(name, latest.read(name))
            for name in manifest["requiredStorage"]:
                with zipfile.ZipFile(storage[name]) as archive, archive.open(name) as incoming, output.open(name, "w") as outgoing:
                    for chunk in iter(lambda: incoming.read(CHUNK), b""):
                        outgoing.write(chunk)
    destination.chmod(0o600)


def request(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=90)
    except urllib.error.HTTPError as exc:
        if exc.code != 308:
            raise RuntimeError(f"Drive HTTP {exc.code}") from None
        response = exc
    with response:
        return response.code, response.headers, response.read()


def local_setting(name):
    result = subprocess.run(["pnpm", "exec", "convex", "env", "get", "--deployment", "local", name],
                            cwd=ROOT, capture_output=True, text=True, timeout=60)
    if result.returncode or not result.stdout.strip():
        raise RuntimeError(f"Local Drive setting unavailable: {name}")
    return result.stdout.strip()


def drive_access():
    config = {name: local_setting(name) for name in ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "GOOGLE_DRIVE_PARENT_FOLDER_ID"]}
    _, _, body = request("https://oauth2.googleapis.com/token", urllib.parse.urlencode({
        "client_id": config["GOOGLE_CLIENT_ID"], "client_secret": config["GOOGLE_CLIENT_SECRET"],
        "refresh_token": config["GOOGLE_REFRESH_TOKEN"], "grant_type": "refresh_token",
    }).encode(), {"Content-Type": "application/x-www-form-urlencoded"})
    return json.loads(body)["access_token"], config["GOOGLE_DRIVE_PARENT_FOLDER_ID"]


def restore_latest(destination):
    """Download and verify the durable chain, then assemble without touching a DB."""
    if destination.exists():
        raise ValueError("Restore destination already exists")
    token, parent = drive_access()
    auth = {"Authorization": "Bearer " + token}
    query = f"'{parent}' in parents and trashed=false and name contains 'ourchival-backup-'"
    _, _, body = request("https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode({
        "q": query, "orderBy": "createdTime desc", "pageSize": 1,
        "fields": "files(id,name,size,md5Checksum,appProperties)",
    }), headers=auth)
    files = json.loads(body).get("files", [])
    if not files or not files[0].get("appProperties", {}).get("ourchivalBackupSha256"):
        raise RuntimeError("No verified Ourchival backup candidate found")
    workspace = destination.parent / (destination.name + ".parts")
    workspace.mkdir(mode=0o700, parents=True, exist_ok=True)

    def download(file_id, expected_sha):
        path = workspace / (file_id + ".zip")
        if not path.exists() or digest(path) != expected_sha:
            with urllib.request.urlopen(urllib.request.Request(
                "https://www.googleapis.com/drive/v3/files/" + file_id + "?alt=media", headers=auth,
            ), timeout=90) as incoming, path.open("wb") as outgoing:
                for chunk in iter(lambda: incoming.read(CHUNK), b""):
                    outgoing.write(chunk)
            path.chmod(0o600)
        if digest(path) != expected_sha:
            raise RuntimeError("Downloaded backup SHA-256 verification failed")
        return path

    latest = download(files[0]["id"], files[0]["appProperties"]["ourchivalBackupSha256"])
    with zipfile.ZipFile(latest) as archive:
        manifest = json.loads(archive.read(MANIFEST))
    previous = [download(part["id"], part["sha256"]) for part in manifest["previous"]]
    assemble(previous + [latest], destination)
    # These are disposable verified downloads, not the user's source snapshots.
    for part in set(previous + [latest]):
        part.unlink()
    workspace.rmdir()


def upload(path, pending):
    token, parent = drive_access()
    auth = {"Authorization": "Bearer " + token}
    sha, md5, size = digest(path), digest(path, "md5"), path.stat().st_size
    fields = "id,name,size,md5Checksum,webViewLink"
    # Reconcile an ambiguous completed upload before creating another object.
    query = f"'{parent}' in parents and trashed=false and appProperties has {{ key='ourchivalBackupSha256' and value='{sha}' }}"
    _, _, body = request("https://www.googleapis.com/drive/v3/files?" + urllib.parse.urlencode({"q": query, "fields": f"files({fields})", "pageSize": 10}), headers=auth)
    matches = json.loads(body).get("files", [])
    result = next((r for r in matches if r.get("md5Checksum") == md5 and int(r.get("size", 0)) == size), None)
    if not result:
        uri = pending.get("uploadUri")
        if not uri:
            _, headers, _ = request("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=" + fields,
                json.dumps({"name": path.name, "parents": [parent], "appProperties": {"ourchivalBackupSha256": sha}}).encode(),
                {**auth, "Content-Type": "application/json", "X-Upload-Content-Type": "application/zip", "X-Upload-Content-Length": str(size)})
            uri = headers["Location"]
            pending["uploadUri"] = uri
            save(STATE / "pending.json", pending)
        # The session URL is a capability: keep it private and never print it.
        parsed = urllib.parse.urlparse(uri)
        if parsed.scheme != "https" or parsed.hostname != "www.googleapis.com":
            raise RuntimeError("Unexpected resumable upload host")
        try:
            code, headers, body = request(uri, b"", {**auth, "Content-Range": f"bytes */{size}"}, "PUT")
        except RuntimeError as exc:
            if str(exc) == "Drive HTTP 404":
                pending.pop("uploadUri", None)
                save(STATE / "pending.json", pending)
            raise
        if code in (200, 201):
            result = json.loads(body)
        else:
            offset = int(headers.get("Range", "bytes=0--1").rsplit("-", 1)[-1]) + 1 if headers.get("Range") else 0
            with path.open("rb") as stream:
                while offset < size:
                    stream.seek(offset)
                    data = stream.read(CHUNK)
                    code, headers, body = request(uri, data, {**auth, "Content-Type": "application/zip", "Content-Range": f"bytes {offset}-{offset+len(data)-1}/{size}"}, "PUT")
                    if code in (200, 201):
                        result = json.loads(body)
                        break
                    next_offset = int(headers["Range"].rsplit("-", 1)[-1]) + 1
                    if next_offset <= offset or next_offset > size:
                        raise RuntimeError("Upload did not advance")
                    offset = next_offset
                    save(STATE / "progress.json", {"phase": "uploading", "uploadedBytes": offset, "totalBytes": size, "updatedAt": time.time()})
    if not result:
        raise RuntimeError("Upload completion was not confirmed")
    _, _, body = request("https://www.googleapis.com/drive/v3/files/" + result["id"] + "?fields=" + fields, headers=auth)
    result = json.loads(body)
    if result.get("md5Checksum") != md5 or int(result.get("size", 0)) != size:
        raise RuntimeError("Drive checksum or size verification failed")
    return {**result, "sha256": sha}


def backup(snapshot=None):
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / "lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        state_file, pending_file = STATE / "state.json", STATE / "pending.json"
        state = json.loads(state_file.read_text()) if state_file.exists() else {}
        if pending_file.exists():
            pending = json.loads(pending_file.read_text())
        else:
            if snapshot is None:
                snapshot = STATE / "snapshot.zip"
                snapshot.unlink(missing_ok=True)
                save(STATE / "progress.json", {"phase": "exporting", "updatedAt": time.time()})
                result = subprocess.run(["pnpm", "exec", "convex", "export", "--deployment", "local", "--include-file-storage", "--path", str(snapshot)], cwd=ROOT, capture_output=True, timeout=1800)
                if result.returncode:
                    raise RuntimeError("Local snapshot export failed")
            part = STATE / ("ourchival-backup-" + time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + ".zip")
            storage, manifest = pack(snapshot, part, state)
            pending = {"path": str(part), "storage": storage, "manifest": manifest}
            save(pending_file, pending)
        part = Path(pending["path"])
        result = upload(part, pending)
        parts = state.get("parts", [])
        if not any(p["id"] == result["id"] for p in parts):
            parts = parts + [{"id": result["id"], "name": result["name"], "sha256": result["sha256"]}]
        state = {"storage": pending["storage"], "parts": parts, "lastVerifiedAt": time.time(), "latest": result}
        save(state_file, state)
        save(STATE / "progress.json", {"phase": "verified", "lastVerifiedAt": state["lastVerifiedAt"], "parts": len(parts), "storedFilesCovered": len(state["storage"]), "latest": result})
        pending_file.unlink()
        part.unlink()
        (STATE / "snapshot.zip").unlink(missing_ok=True)
        print(json.dumps({"phase": "verified", "parts": len(parts), "storedFilesCovered": len(state["storage"]), "bytesUploaded": int(result["size"])}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot", type=Path)
    parser.add_argument("--assemble", nargs="+", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--restore-latest", action="store_true")
    args = parser.parse_args()
    try:
        if args.restore_latest:
            if not args.output:
                parser.error("--restore-latest requires --output")
            restore_latest(args.output)
            print("Latest Drive backup downloaded, hash-verified, and assembled; no deployment was changed.")
        elif args.assemble:
            if not args.output:
                parser.error("--assemble requires --output")
            assemble(args.assemble, args.output)
            print("Verified backup chain assembled; no deployment was changed.")
        else:
            backup(args.snapshot)
    except Exception as exc:
        STATE.mkdir(parents=True, exist_ok=True)
        save(STATE / "progress.json", {"phase": "interrupted", "errorType": type(exc).__name__, "updatedAt": time.time()})
        print("Backup interrupted; last verified backup and resume checkpoint preserved.")
        raise SystemExit(1)

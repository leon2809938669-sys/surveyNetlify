#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo; this installs an isolated runtime under /opt/survey, not the system Node."
  exit 1
fi
python3 - <<'PY'
import hashlib
import pathlib
import platform
import subprocess
import tarfile
import tempfile
import urllib.request

destination = pathlib.Path('/opt/survey/runtime')
node = destination / 'bin/node'
if node.exists():
    version = subprocess.check_output([str(node), '--version'], text=True).strip()
    if not version.startswith('v24.'):
        raise SystemExit('Existing isolated runtime is not Node 24; inspect it before replacing it.')
    print('Existing isolated Node 24 runtime is ready.')
else:
    arch = {'x86_64': 'x64', 'aarch64': 'arm64'}.get(platform.machine())
    if arch is None:
        raise SystemExit('Supported architectures: Linux x64 and arm64.')
    version = 'v24.22.2'
    name = f'node-{version}-linux-{arch}.tar.xz'
    url = f'https://nodejs.org/dist/{version}/'
    checks = urllib.request.urlopen(url + 'SHASUMS256.txt', timeout=30).read().decode()
    expected = next(line.split()[0] for line in checks.splitlines() if line.endswith('  ' + name))
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.node-install-', dir=destination.parent) as temporary:
        archive = pathlib.Path(temporary) / name
        with urllib.request.urlopen(url + name, timeout=60) as response, archive.open('wb') as output:
            while data := response.read(1024 * 1024):
                output.write(data)
        if hashlib.file_digest(archive.open('rb'), 'sha256').hexdigest() != expected:
            raise SystemExit('Runtime SHA-256 verification failed.')
        destination.mkdir()
        with tarfile.open(archive) as bundle:
            prefix = name.removesuffix('.tar.xz') + '/'
            for member in bundle.getmembers():
                if member.name.startswith(prefix):
                    member.name = member.name[len(prefix):]
                    if member.name:
                        bundle.extract(member, destination, filter='data')
    print('Verified isolated Node 24 runtime installed.')
PY

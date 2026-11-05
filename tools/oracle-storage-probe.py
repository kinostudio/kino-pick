"""Run over the existing verified SSH channel; isolated localhost-only S3 candidate."""
import hashlib
import io
import json
import os
import platform
import subprocess
import tarfile
import urllib.request
from pathlib import Path

VERSION = '4.52'
INSTALL = Path('/opt/kino-pick-storage-probe')


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Kino-Pick-storage-probe'})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def main():
    assert os.geteuid() == 0
    assert INSTALL.resolve() == INSTALL and not INSTALL.is_symlink()
    INSTALL.mkdir(mode=0o700, exist_ok=True)
    arch = {'aarch64': 'arm64', 'x86_64': 'amd64'}[platform.machine()]
    release = json.loads(fetch('https://api.github.com/repos/seaweedfs/seaweedfs/releases/tags/' + VERSION))
    asset_name = 'linux_' + arch + '.tar.gz'
    asset = next(item for item in release['assets'] if item['name'] == asset_name)
    expected = asset.get('digest', '')
    if not expected.startswith('sha256:'):
        raise RuntimeError('Official release asset digest required')
    digest = expected[7:]
    binary = INSTALL / 'weed'
    receipt = INSTALL / 'binary-receipt.json'
    if not binary.exists():
        payload = fetch(asset['browser_download_url'])
        assert hashlib.sha256(payload).hexdigest() == digest, 'Release checksum mismatch'
        with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
            member = archive.getmember('weed')
            assert member.isfile() and member.size < 500_000_000
            with archive.extractfile(member) as source:
                binary.write_bytes(source.read())
        binary.chmod(0o755)
        receipt.write_text(json.dumps({'version': VERSION, 'archive_sha256': digest, 'binary_sha256': hashlib.sha256(binary.read_bytes()).hexdigest()}))
    recorded = json.loads(receipt.read_text())
    assert recorded['version'] == VERSION and hashlib.sha256(binary.read_bytes()).hexdigest() == recorded['binary_sha256']
    for arguments in (['version'], ['server', '-h']):
        result = subprocess.run([str(binary), *arguments], capture_output=True, text=True, timeout=15)
        print(result.stdout + result.stderr)
    print(json.dumps({'installed': True, **recorded, 'public_route_created': False, 'service_started': False}))


if __name__ == '__main__':
    main()

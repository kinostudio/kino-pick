"""Add only the dedicated object path; run via the existing verified VM SSH channel."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time

CONFIG = Path('/etc/caddy/Caddyfile')
MARKER = '# Kino Pick private overflow objects'
SNIPPET = '''
    # Kino Pick private overflow objects
    @kino_storage path /kino-pick-overflow/*
    handle @kino_storage {
        @bucket_root path /kino-pick-overflow/
        respond @bucket_root 403
        @quota_query expression `{http.request.uri.query}.matches('(?i)(^|&)seaweedfs-quota(=|&|$)')`
        respond @quota_query 403
        @unsupported not method GET HEAD PUT OPTIONS
        respond @unsupported 405
        reverse_proxy 127.0.0.1:15336
    }
'''


def main():
    assert os.geteuid() == 0
    assert CONFIG.resolve() == CONFIG and CONFIG.is_file() and not CONFIG.is_symlink()
    original = CONFIG.read_bytes()
    text = original.decode()
    if MARKER in text:
        assert SNIPPET.strip() in text, 'Existing Pick route differs; stop for review'
        print(json.dumps({'status': 'already_connected', 'sha256': hashlib.sha256(original).hexdigest()}))
        return
    assert text.count('drive.kinostudio.tw {') == 1
    block = text.index('drive.kinostudio.tw {')
    anchor = re.search(r'(?m)^[ \t]*@media path /media/\* /api/\*\s*$', text[block:])
    assert anchor, 'Expected Review media route missing'
    insertion = block + anchor.start()
    assert 'handle {' not in text[block:insertion], 'Unexpected route ordering'
    candidate = CONFIG.with_name('KinoPick.Caddyfile.candidate')
    assert not candidate.exists(), 'Preserve previous candidate for review'
    with candidate.open('xb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write((text[:insertion] + SNIPPET + text[insertion:]).encode())
    subprocess.run(['caddy', 'validate', '--config', str(candidate), '--adapter', 'caddyfile'], check=True, capture_output=True)
    backup = CONFIG.with_name('Caddyfile.before-kino-pick-' + str(time.time_ns()))
    with backup.open('xb') as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(original)
    assert CONFIG.read_bytes() == original, 'Caddy changed during validation'
    candidate.chmod(CONFIG.stat().st_mode & 0o777)
    os.chown(candidate, CONFIG.stat().st_uid, CONFIG.stat().st_gid)
    os.replace(candidate, CONFIG)
    try:
        subprocess.run(['systemctl', 'reload', 'caddy'], check=True, capture_output=True)
    except subprocess.CalledProcessError:
        CONFIG.write_bytes(original)
        subprocess.run(['systemctl', 'reload', 'caddy'], check=True, capture_output=True)
        raise RuntimeError('Caddy reload failed; original restored') from None
    print(json.dumps({'status': 'connected', 'beforeSha256': hashlib.sha256(original).hexdigest(),
        'afterSha256': hashlib.sha256(CONFIG.read_bytes()).hexdigest(), 'backup': str(backup)}))


if __name__ == '__main__':
    main()

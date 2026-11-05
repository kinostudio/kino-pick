"""Capture only the dedicated bucket identity through the existing verified SSH wrapper."""
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
private = root / '.local/oracle-private'
target = private / 'storage.json'
assert private.is_dir() and not private.is_symlink()
assert not target.exists(), 'Preserve existing credentials; review rotation separately'
assert subprocess.run(['git', 'check-ignore', '--quiet', str(target)], cwd=root).returncode == 0
script = private / 'export-app.py'
script.write_text("from pathlib import Path\nimport os,stat,sys\np=Path('/etc/kino-pick-storage/app-credentials.json')\ns=p.lstat()\nassert stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600\nsys.stdout.buffer.write(p.read_bytes())\n", encoding='utf-8')
result = subprocess.run([sys.executable,
    r'C:\Users\Aaron\Documents\Codex\KINO Review\.secrets\run_vm.py', str(script)],
    capture_output=True, timeout=60)
if result.returncode:
    raise SystemExit('Dedicated app credential capture failed; all output withheld')
try:
    value = json.loads(result.stdout)
    assert set(value) == {'endpoint', 'region', 'bucketName', 'accessKeyId', 'secretAccessKey'}
    assert value['endpoint'] == 'https://drive.kinostudio.tw'
    assert value['region'] == 'us-east-1' and value['bucketName'] == 'kino-pick-overflow'
    assert all(isinstance(value[k], str) and 16 <= len(value[k]) <= 256 for k in ['accessKeyId', 'secretAccessKey'])
except Exception:
    raise SystemExit('Dedicated app credential schema invalid; all output withheld') from None
with target.open('x', encoding='utf-8') as stream:
    json.dump(value, stream)
print(json.dumps({'saved': True, 'bucketScopedIdentityOnly': True, 'valuesPrinted': False}))

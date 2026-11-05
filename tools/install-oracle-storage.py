#!/usr/bin/env python3
"""Idempotently install the fixed, loopback-only Kino Pick SeaweedFS node."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))
import oracle_storage_fs as storage_fs

SOURCE = Path('/opt/kino-pick-storage-probe/weed')
SOURCE_SHA256 = '81cb23a563d03fe54aa7a765e85405c95c085271654efb1f3cad200c5651b782'
INSTALL = Path('/opt/kino-pick-storage')
ETC = Path('/etc/kino-pick-storage')
STATE = Path('/var/lib/kino-pick-storage')
LOG = Path('/var/log/kino-pick-storage')
BUCKET = 'kino-pick-overflow'
APP_ORIGIN = 'https://kino-pic-staging.kino-pick-aaron2026.workers.dev'
ENDPOINT = 'http://127.0.0.1:15336'
PUBLIC_ENDPOINT = 'https://drive.kinostudio.tw'


def run(*args, input_text=None, timeout=120):
    return subprocess.run(
        [str(arg) for arg in args], input=input_text, check=True,
        capture_output=True, text=True, timeout=timeout,
    )


def write_private(path, payload, mode=0o600):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.parent.is_symlink():
        raise RuntimeError('private config directory is a symlink')
    temp = path.with_name(path.name + '.new-' + secrets.token_hex(6))
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), mode)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(temp, 0, 0)
        os.chmod(temp, mode)
        os.replace(temp, path)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def ensure_fixed_credentials(path, name):
    if path.exists():
        if path.is_symlink() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
            raise RuntimeError('credential file ownership or mode is unsafe')
        data = json.loads(path.read_text())
        expected = (
            {'endpoint', 'region', 'bucketName', 'accessKeyId', 'secretAccessKey'}
            if name == 'app' else {'accessKey', 'secretKey'}
        )
        if set(data) != expected or not all(isinstance(data[k], str) and data[k] for k in data):
            raise RuntimeError('existing credential file has an unexpected shape')
        if name == 'app' and (data['endpoint'], data['region'], data['bucketName']) != (PUBLIC_ENDPOINT, 'us-east-1', BUCKET):
            raise RuntimeError('existing app credential target differs from fixed storage')
        return data
    if name == 'app':
        data = {
            'endpoint': PUBLIC_ENDPOINT, 'region': 'us-east-1', 'bucketName': BUCKET,
            'accessKeyId': 'KINO' + secrets.token_hex(12).upper(), 'secretAccessKey': secrets.token_hex(32),
        }
    else:
        data = {'accessKey': 'KINO' + secrets.token_hex(12).upper(), 'secretKey': secrets.token_hex(32)}
    write_private(path, (json.dumps(data, separators=(',', ':')) + '\n').encode())
    return data


def signed_request(method, path, query='', body=b'', content_type='application/octet-stream', credentials=None):
    import datetime
    import hmac
    import urllib.parse

    if credentials is None:
        raise RuntimeError('S3 credentials are unavailable')
    access_key = credentials.get('accessKeyId', credentials.get('accessKey'))
    secret_key = credentials.get('secretAccessKey', credentials.get('secretKey'))
    payload_hash = hashlib.sha256(body).hexdigest()
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date = now.strftime('%Y%m%dT%H%M%SZ')
    date = now.strftime('%Y%m%d')
    canonical_path = urllib.parse.quote(path, safe='/-_.~')
    canonical_query = '&'.join(
        f'{urllib.parse.quote(k, safe="-_.~")}={urllib.parse.quote(v, safe="-_.~")}'
        for k, v in sorted(urllib.parse.parse_qsl(query, keep_blank_values=True))
    )
    host = '127.0.0.1:15336'
    headers = {
        'content-type': content_type,
        'host': host,
        'x-amz-content-sha256': payload_hash,
        'x-amz-date': amz_date,
    }
    signed_headers = ';'.join(sorted(headers))
    canonical_headers = ''.join(f'{key}:{headers[key].strip()}\n' for key in sorted(headers))
    canonical = '\n'.join((method, canonical_path, canonical_query, canonical_headers, signed_headers, payload_hash))
    scope = f'{date}/us-east-1/s3/aws4_request'
    string_to_sign = 'AWS4-HMAC-SHA256\n' + amz_date + '\n' + scope + '\n' + hashlib.sha256(canonical.encode()).hexdigest()

    def sign(key, value):
        return hmac.new(key, value.encode(), hashlib.sha256).digest()

    key = sign(('AWS4' + secret_key).encode(), date)
    key = sign(key, 'us-east-1')
    key = sign(key, 's3')
    key = sign(key, 'aws4_request')
    signature = hmac.new(key, string_to_sign.encode(), hashlib.sha256).hexdigest()
    headers['Authorization'] = (
        f'AWS4-HMAC-SHA256 Credential={access_key}/{scope}, '
        f'SignedHeaders={signed_headers}, Signature={signature}'
    )
    url = ENDPOINT + canonical_path + (('?' + query) if query else '')
    request = urllib.request.Request(url, data=body if body else None, headers=headers, method=method)

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=20) as response:
            return response.status, response.read(1024 * 1024 + 1), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(1024 * 1024 + 1), dict(error.headers)


def ensure_bucket(bootstrap_credentials):
    status, _, _ = signed_request('PUT', '/' + BUCKET, credentials=bootstrap_credentials)
    if status not in (200, 409):
        raise RuntimeError(f'bucket create failed with HTTP {status}')
    cors = (
        '<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
        '<CORSRule><AllowedOrigin>' + APP_ORIGIN + '</AllowedOrigin>'
        '<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod><AllowedMethod>PUT</AllowedMethod>'
        '<AllowedHeader>content-type</AllowedHeader><AllowedHeader>content-length</AllowedHeader>'
        '<AllowedHeader>if-none-match</AllowedHeader><AllowedHeader>x-amz-checksum-sha256</AllowedHeader>'
        '<ExposeHeader>ETag</ExposeHeader><ExposeHeader>x-amz-checksum-sha256</ExposeHeader>'
        '<MaxAgeSeconds>600</MaxAgeSeconds></CORSRule></CORSConfiguration>'
    ).encode()
    status, _, _ = signed_request('PUT', '/' + BUCKET, 'cors=', cors, 'application/xml', bootstrap_credentials)
    if status != 200:
        raise RuntimeError(f'bucket CORS update failed with HTTP {status}')
    status, body, _ = signed_request('GET', '/' + BUCKET, 'cors=', credentials=bootstrap_credentials)
    if status != 200:
        raise RuntimeError(f'bucket CORS verification failed with HTTP {status}')
    root = ET.fromstring(body)
    rule = root[0]
    actual = {}
    for element in rule:
        actual.setdefault(element.tag.rsplit('}', 1)[-1], []).append(element.text)
    required = {
        'AllowedOrigin': [APP_ORIGIN], 'AllowedMethod': ['GET', 'HEAD', 'PUT'],
        'AllowedHeader': ['content-type', 'content-length', 'if-none-match', 'x-amz-checksum-sha256'],
        'ExposeHeader': ['ETag', 'x-amz-checksum-sha256'],
    }
    if any(sorted(actual.get(key, [])) != sorted(value) for key, value in required.items()):
        raise RuntimeError('bucket CORS verification did not match the fixed policy')


def ensure_initial_policy(app_credentials, quota_bytes):
    key = '/kino-pick-overflow/_kino/system/storage-policy.json'
    status, body, _ = signed_request('GET', key, credentials=app_credentials)
    if status == 404:
        payload = json.dumps({'quotaBytes': quota_bytes, 'revision': 0}, separators=(',', ':')).encode()
        status, _, _ = signed_request('PUT', key, body=payload, content_type='application/json', credentials=app_credentials)
        if status not in (200, 201):
            raise RuntimeError(f'initial storage policy write failed with HTTP {status}')
        return {'quotaBytes': quota_bytes, 'revision': 0}
    if status != 200:
        raise RuntimeError(f'storage policy read failed with HTTP {status}')
    return storage_fs.parse_storage_policy(body)


def install_service_files(uid, gid):
    INSTALL.mkdir(mode=0o755, parents=True, exist_ok=True)
    os.chown(INSTALL, 0, 0)
    os.chmod(INSTALL, 0o755)
    LOG.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(LOG, uid, gid)
    os.chmod(LOG, 0o700)
    log_file = LOG / 'server.log'
    if not log_file.exists():
        fd = os.open(log_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
    if log_file.is_symlink() or not log_file.is_file():
        raise RuntimeError('server log path is not a regular file')
    os.chown(log_file, uid, gid)
    os.chmod(log_file, 0o600)

    binary_bytes = SOURCE.read_bytes()
    if hashlib.sha256(binary_bytes).hexdigest() != SOURCE_SHA256:
        raise RuntimeError('installed SeaweedFS source binary checksum mismatch')
    target = INSTALL / 'weed'
    if target.exists():
        if target.is_symlink() or not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != SOURCE_SHA256:
            raise RuntimeError('existing installed binary differs from accepted binary')
    else:
        temp = INSTALL / '.weed.new'
        with temp.open('xb') as stream:
            stream.write(binary_bytes)
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(temp, 0, 0)
        os.chmod(temp, 0o755)
        os.replace(temp, target)

    for name in ('oracle_storage_fs.py', 'oracle-storage-health.py'):
        source = Path(__file__).resolve().with_name(name)
        target = INSTALL / name
        payload = source.read_bytes()
        if target.exists() and target.is_symlink():
            raise RuntimeError('installed helper path is a symlink')
        write_private(target, payload, 0o755)

    mount_name = run('systemd-escape', '--path', '--suffix=mount', str(storage_fs.MOUNT)).stdout.strip()
    data_mount_name = run('systemd-escape', '--path', '--suffix=mount', str(storage_fs.DATA_ROOT)).stdout.strip()
    mount_unit = f'''[Unit]\nDescription=Kino Pick fixed ext4 capacity image\nRequires={data_mount_name}\nAfter={data_mount_name}\n\n[Mount]\nWhat={storage_fs.IMAGE}\nWhere={storage_fs.MOUNT}\nType=ext4\nOptions=loop,nodev,nosuid,noexec\nTimeoutSec=45\n\n[Install]\nWantedBy=local-fs.target\n'''
    service_unit = f'''[Unit]\nDescription=Kino Pick private object storage\nAfter=network.target {mount_name}\nRequires={mount_name}\nRequiresMountsFor={storage_fs.MOUNT}\n\n[Service]\nType=simple\nUser=kino-pick-storage\nGroup=kino-pick-storage\nUMask=0077\nWorkingDirectory={storage_fs.MOUNT}\nLoadCredential=s3.json:{ETC / 's3.json'}\nExecStart={INSTALL / 'weed'} server -ip=127.0.0.1 -ip.bind=127.0.0.1 -dir={storage_fs.MOUNT} -master.port=15333 -volume.port=15334 -filer -filer.port=15335 -s3 -s3.port=15336 -s3.config=%d/s3.json -s3.iam=false -master.volumeSizeLimitMB=256 -volume.max=512 -master.telemetry=false -s3.concurrentFileUploadLimit=8 -s3.allowedOrigins={APP_ORIGIN}\nStandardOutput=append:{LOG / 'server.log'}\nStandardError=append:{LOG / 'server.log'}\nRestart=on-failure\nRestartSec=3\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectSystem=strict\nProtectHome=yes\nProtectKernelTunables=yes\nProtectKernelModules=yes\nProtectControlGroups=yes\nReadWritePaths={storage_fs.MOUNT} {LOG}\nMemoryMax=2G\nCPUQuota=200%\nTasksMax=256\nLimitNOFILE=65536\n'''
    health_service = f'''[Unit]\nDescription=Sync Kino Pick capacity policy and health\nAfter=kino-pick-storage.service\nRequires=kino-pick-storage.service\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/python3 {INSTALL / 'oracle-storage-health.py'}\nTimeoutStartSec=120\nProtectSystem=strict\nProtectHome=yes\nPrivateTmp=yes\nReadWritePaths={storage_fs.IMAGE} {storage_fs.MOUNT} {STATE.parent}\n'''
    timer = '''[Unit]\nDescription=Refresh Kino Pick storage policy and capacity evidence\n\n[Timer]\nOnBootSec=15s\nOnUnitActiveSec=60s\nAccuracySec=5s\nPersistent=true\nUnit=kino-pick-storage-health.service\n\n[Install]\nWantedBy=timers.target\n'''
    units = {
        Path('/etc/systemd/system') / mount_name: mount_unit,
        Path('/etc/systemd/system/kino-pick-storage.service'): service_unit,
        Path('/etc/systemd/system/kino-pick-storage-health.service'): health_service,
        Path('/etc/systemd/system/kino-pick-storage-health.timer'): timer,
    }
    for path, content in units.items():
        write_private(path, content.encode(), 0o644)
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(STATE, 0, 0)
    os.chmod(STATE, 0o700)
    run('systemctl', 'daemon-reload')
    run('systemctl', 'enable', '--now', mount_name)
    run('systemctl', 'enable', '--now', 'kino-pick-storage.service')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--quota-gb', type=int, default=30, help='initial logical quota in decimal GB (1..100)')
    args = parser.parse_args()
    quota_bytes = storage_fs.quota_bytes_for_gb(args.quota_gb)
    if os.geteuid() != 0 or sys.platform != 'linux':
        raise SystemExit('run this installer as root on the target Linux VM')
    user = pwd.getpwnam('kino-pick-storage')
    storage_fs.assert_data_root()
    if SOURCE.is_symlink() or not SOURCE.is_file() or hashlib.sha256(SOURCE.read_bytes()).hexdigest() != SOURCE_SHA256:
        raise RuntimeError('accepted SeaweedFS 4.52 source binary is missing or changed')

    ETC.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chown(ETC, 0, 0)
    os.chmod(ETC, 0o700)
    app = ensure_fixed_credentials(ETC / 'app-credentials.json', 'app')
    bootstrap = ensure_fixed_credentials(ETC / 'bootstrap-credentials.json', 'bootstrap')
    s3_config = {
        'identities': [
            {'name': 'kino-pick-worker', 'credentials': [{'accessKey': app['accessKeyId'], 'secretKey': app['secretAccessKey']}],
             'actions': [f'Read:{BUCKET}', f'Write:{BUCKET}', f'List:{BUCKET}']},
            {'name': 'kino-pick-root-bootstrap', 'credentials': [bootstrap], 'actions': ['Admin']},
        ]
    }
    s3_path = ETC / 's3.json'
    serialized = (json.dumps(s3_config, separators=(',', ':')) + '\n').encode()
    if s3_path.exists():
        if s3_path.is_symlink() or s3_path.read_bytes() != serialized:
            raise RuntimeError('existing S3 IAM config differs from fixed identities')
    else:
        write_private(s3_path, serialized)

    storage_fs.ensure_image_capacity(quota_bytes, user.pw_uid, user.pw_gid)
    install_service_files(user.pw_uid, user.pw_gid)
    ready = False
    for _ in range(120):
        with socket.socket() as connection:
            if connection.connect_ex(('127.0.0.1', 15336)) == 0:
                ready = True
                break
        time.sleep(0.5)
    if not ready:
        raise RuntimeError('local S3 service did not become ready')
    ensure_bucket(bootstrap)
    policy = ensure_initial_policy(app, quota_bytes)
    storage_fs.ensure_image_capacity(policy['quotaBytes'], user.pw_uid, user.pw_gid)
    run('/usr/bin/python3', INSTALL / 'oracle-storage-health.py', timeout=120)
    run('systemctl', 'enable', '--now', 'kino-pick-storage-health.timer')
    print(json.dumps({
        'status': 'installed', 'version': '4.52', 'binarySha256': SOURCE_SHA256,
        'bucket': BUCKET, 'quotaBytes': policy['quotaBytes'], 'revision': policy['revision'],
        'imageBytes': storage_fs.IMAGE.stat().st_size, 'loopbackPorts': [15333, 15334, 15335, 15336],
        'credentialsStoredRootOnly': True,
    }, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'failed', 'reason': type(error).__name__}), file=sys.stderr)
        raise

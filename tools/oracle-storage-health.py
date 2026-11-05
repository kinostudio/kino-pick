#!/usr/bin/env python3
"""Apply the fixed S3 quota policy and publish bounded, private health evidence."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import pwd
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parent))
import oracle_storage_fs as storage_fs

ENDPOINT = 'http://127.0.0.1:15336'
BUCKET = 'kino-pick-overflow'
APP_CREDS = Path('/etc/kino-pick-storage/app-credentials.json')
BOOTSTRAP_CREDS = Path('/etc/kino-pick-storage/bootstrap-credentials.json')
STATE = Path('/var/lib/kino-pick-storage/applied-policy.json')
WEED = Path('/opt/kino-pick-storage/weed')
HEALTH_KEY = '/kino-pick-overflow/_kino/system/storage-health.json'
POLICY_KEY = '/kino-pick-overflow/_kino/system/storage-policy.json'
MAX_BODY = 16 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read_credentials(path, app=False):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != 0 or path.stat().st_mode & 0o077:
        raise RuntimeError('private credentials are unavailable')
    value = json.loads(path.read_text())
    expected = (
        {'endpoint', 'region', 'bucketName', 'accessKeyId', 'secretAccessKey'}
        if app else {'accessKey', 'secretKey'}
    )
    if set(value) != expected or not all(isinstance(value[k], str) and value[k] for k in value):
        raise RuntimeError('private credentials have an invalid shape')
    if app and (value['endpoint'], value['region'], value['bucketName']) != (
        'https://drive.kinostudio.tw', 'us-east-1', BUCKET
    ):
        raise RuntimeError('app credentials target an unexpected endpoint')
    return value


def s3_request(method, key, credentials, query='', body=b'', content_type='application/octet-stream'):
    import datetime

    payload_hash = hashlib.sha256(body).hexdigest()
    now = datetime.datetime.now(datetime.timezone.utc)
    amz_date, date = now.strftime('%Y%m%dT%H%M%SZ'), now.strftime('%Y%m%d')
    path = urllib.parse.quote(key, safe='/-_.~')
    canonical_query = '&'.join(
        f'{urllib.parse.quote(k, safe="-_.~")}={urllib.parse.quote(v, safe="-_.~")}'
        for k, v in sorted(urllib.parse.parse_qsl(query, keep_blank_values=True))
    )
    headers = {
        'content-type': content_type,
        'host': '127.0.0.1:15336',
        'x-amz-content-sha256': payload_hash,
        'x-amz-date': amz_date,
    }
    signed_headers = ';'.join(sorted(headers))
    canonical_headers = ''.join(f'{name}:{headers[name].strip()}\n' for name in sorted(headers))
    canonical_request = '\n'.join((method, path, canonical_query, canonical_headers, signed_headers, payload_hash))
    scope = f'{date}/us-east-1/s3/aws4_request'
    string_to_sign = 'AWS4-HMAC-SHA256\n' + amz_date + '\n' + scope + '\n' + hashlib.sha256(canonical_request.encode()).hexdigest()

    def sign(key_bytes, message):
        return hmac.new(key_bytes, message.encode(), hashlib.sha256).digest()

    access_key = credentials.get('accessKeyId', credentials.get('accessKey'))
    secret_key = credentials.get('secretAccessKey', credentials.get('secretKey'))
    key_bytes = sign(('AWS4' + secret_key).encode(), date)
    key_bytes = sign(key_bytes, 'us-east-1')
    key_bytes = sign(key_bytes, 's3')
    key_bytes = sign(key_bytes, 'aws4_request')
    signature = hmac.new(key_bytes, string_to_sign.encode(), hashlib.sha256).hexdigest()
    headers['Authorization'] = (
        f'AWS4-HMAC-SHA256 Credential={access_key}/{scope}, '
        f'SignedHeaders={signed_headers}, Signature={signature}'
    )
    url = ENDPOINT + path + (('?' + query) if query else '')
    request = urllib.request.Request(url, data=body if body else None, headers=headers, method=method)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=12) as response:
            payload = response.read(MAX_BODY + 1)
            if len(payload) > MAX_BODY:
                raise RuntimeError('S3 response exceeds fixed limit')
            return response.status, payload
    except urllib.error.HTTPError as error:
        payload = error.read(MAX_BODY + 1)
        if len(payload) > MAX_BODY:
            raise RuntimeError('S3 error response exceeds fixed limit') from None
        return error.code, payload


def expect_success(response, label, allowed=(200,)):
    status, body = response
    if status not in allowed:
        raise RuntimeError(f'{label} failed with HTTP {status}')
    return body


def read_applied_state():
    if not STATE.exists():
        return None
    if STATE.is_symlink() or not STATE.is_file() or STATE.stat().st_uid != 0 or STATE.stat().st_mode & 0o077:
        raise RuntimeError('applied policy state is unsafe')
    value = json.loads(STATE.read_text())
    if (
        not isinstance(value, dict) or set(value) != {'quotaBytes', 'revision'}
        or type(value.get('revision')) is not int or value['revision'] < 0
    ):
        raise RuntimeError('applied policy state is invalid')
    storage_fs.quota_gb_for_bytes(value.get('quotaBytes'))
    return value


def write_applied_state(policy):
    STATE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = STATE.with_name(STATE.name + '.new-' + secrets.token_hex(6))
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(json.dumps(policy, separators=(',', ':')).encode() + b'\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(temp, 0, 0)
        os.chmod(temp, 0o600)
        os.replace(temp, STATE)
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass


def configured_quota(credentials):
    status, body = s3_request('GET', '/' + BUCKET, credentials, 'seaweedfs-quota=')
    if status == 404:
        return None
    expect_success((status, body), 'quota read')
    value = json.loads(body)
    return value.get('quota_size'), value.get('quota_unit'), value.get('quota_enabled')


def apply_quota(credentials, quota_bytes):
    payload = json.dumps(
        {'quota_size': quota_bytes, 'quota_unit': 'B', 'quota_enabled': True},
        separators=(',', ':')
    ).encode()
    expect_success(
        s3_request('PUT', '/' + BUCKET, credentials, 'seaweedfs-quota=', payload, 'application/json'),
        'quota update',
        (200, 204),
    )
    if configured_quota(credentials) != (quota_bytes, 'B', True):
        raise RuntimeError('provider quota did not match policy')


def enforce_quota():
    result = subprocess.run(
        [str(WEED), 'shell', '-master=127.0.0.1:15333', '-filer=127.0.0.1:15335'],
        input='s3.bucket.quota.enforce -apply\n', capture_output=True, text=True, timeout=45,
    )
    if result.returncode:
        raise RuntimeError('provider quota enforcement failed')


def write_health(app, mounted, free_bytes, maximum_bytes, quota_bytes):
    payload = {
        'observedAtMs': int(time.time() * 1000),
        'mounted': bool(mounted),
        'freeBytes': max(0, int(free_bytes)),
        'maximumQuotaBytes': max(1, int(maximum_bytes)),
        'quotaBytes': max(1, int(quota_bytes)),
    }
    response = s3_request(
        'PUT', HEALTH_KEY, app, body=json.dumps(payload, separators=(',', ':')).encode(),
        content_type='application/json',
    )
    expect_success(response, 'health publication', (200, 201))
    return payload


def main():
    if os.geteuid() != 0:
        raise SystemExit('health sync must run as root')
    app = read_credentials(APP_CREDS, app=True)
    bootstrap = read_credentials(BOOTSTRAP_CREDS)
    try:
        policy_body = expect_success(s3_request('GET', POLICY_KEY, app), 'policy read')
        policy = storage_fs.parse_storage_policy(policy_body)
        previous = read_applied_state()
        if previous and policy['revision'] < previous['revision']:
            raise RuntimeError('storage policy revision moved backwards')
        if previous and policy['revision'] == previous['revision'] and policy['quotaBytes'] != previous['quotaBytes']:
            raise RuntimeError('storage policy changed without a new revision')

        if not storage_fs._verify_mount():
            raise RuntimeError('host storage image mount is unavailable')
        user = pwd.getpwnam('kino-pick-storage')
        capacity = storage_fs.ensure_image_capacity(policy['quotaBytes'], user.pw_uid, user.pw_gid)
        if capacity['maximumQuotaBytes'] < policy['quotaBytes']:
            raise RuntimeError('mounted capacity cannot support the requested quota')
        if configured_quota(bootstrap) != (policy['quotaBytes'], 'B', True):
            apply_quota(bootstrap, policy['quotaBytes'])
        enforce_quota()
        if not previous or previous != policy:
            write_applied_state(policy)
        write_health(
            app, capacity['mounted'], capacity['freeBytes'],
            capacity['maximumQuotaBytes'], policy['quotaBytes'],
        )
        print(json.dumps({'status': 'healthy', 'revision': policy['revision']}))
    except Exception as error:
        try:
            disk = storage_fs.shutil.disk_usage(storage_fs.DATA_ROOT).free if storage_fs.DATA_ROOT.exists() else 0
            write_health(app, False, disk, 1, 1)
        except Exception:
            pass
        print(json.dumps({'status': 'unhealthy', 'reason': type(error).__name__, 'detail': str(error)[:200]}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__':
    main()

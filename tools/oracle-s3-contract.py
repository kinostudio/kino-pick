"""Remote-only bounded conformance check. No public route or product data."""
import base64
import concurrent.futures
import glob
import hashlib
import json
import os
import pwd
import secrets
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import parse_qs, urlsplit
from pathlib import Path

sys.path.extend(glob.glob('/opt/kino-review/.venv/lib/python*/site-packages'))
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

BASE = Path('/opt/kino-pick-storage-probe')
MOUNT = Path('/srv/kino-review/kino-pick-storage-probe')
IMAGE = Path('/srv/kino-review/.kino-pick-storage-probe.ext4')
BUCKET = 'kino-pick-probe-' + secrets.token_hex(6)
PORTS = (14333, 14334, 14335, 14336, 24333, 24334, 24335)


def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def main():
    global BUCKET
    assert os.geteuid() == 0 and os.path.ismount('/srv/kino-review')
    assert not MOUNT.is_symlink() and not IMAGE.is_symlink()
    for port in PORTS:
        with socket.socket() as connection:
            assert connection.connect_ex(('127.0.0.1', port)) != 0, 'Probe port already occupied'
    try:
        user = pwd.getpwnam('kino-pick-storage')
    except KeyError:
        run('useradd', '--system', '--no-create-home', '--shell', '/usr/sbin/nologin', 'kino-pick-storage')
        user = pwd.getpwnam('kino-pick-storage')
    BASE.chmod(0o755)
    MOUNT.mkdir(mode=0o700, exist_ok=True)
    assert not os.path.ismount(MOUNT), 'Unexpected existing probe mount'
    assert not any(MOUNT.iterdir()), 'Probe mountpoint is not empty'
    if not IMAGE.exists():
        with IMAGE.open('xb') as stream:
            stream.truncate(512 * 1024 * 1024)
        IMAGE.chmod(0o600)
        run('mkfs.ext4', '-q', '-F', str(IMAGE))
    assert IMAGE.is_file() and IMAGE.stat().st_size == 512 * 1024 * 1024
    run('mount', '-o', 'loop,nodev,nosuid,noexec', str(IMAGE), str(MOUNT))
    process = None
    checks = {}
    try:
        os.chown(MOUNT, user.pw_uid, user.pw_gid)
        MOUNT.chmod(0o700)
        access, secret = secrets.token_hex(16), secrets.token_hex(32)
        config = MOUNT / 's3.json'
        config.write_text(json.dumps({'identities': [{'name': 'isolated-contract', 'credentials': [{'accessKey': access, 'secretKey': secret}], 'actions': ['Admin', 'Read', 'Write', 'List', 'Tagging']}]}))
        config.chmod(0o600)
        os.chown(config, user.pw_uid, user.pw_gid)
        binary = BASE / 'weed'
        receipt = json.loads((BASE / 'binary-receipt.json').read_text())
        assert hashlib.sha256(binary.read_bytes()).hexdigest() == receipt['binary_sha256']
        args = [str(binary), 'server', '-ip=127.0.0.1', '-ip.bind=127.0.0.1', '-dir=' + str(MOUNT),
                '-master.port=14333', '-volume.port=14334', '-filer', '-filer.port=14335',
                '-s3', '-s3.port=14336', '-s3.config=' + str(config), '-s3.iam=false',
                '-master.volumeSizeLimitMB=16', '-volume.max=6', '-master.telemetry=false',
                '-s3.concurrentFileUploadLimit=8', '-s3.allowedOrigins=http://127.0.0.1:4194']
        log = BASE / 'server.log'
        log.touch(mode=0o600, exist_ok=True)
        log.chmod(0o600)
        with log.open('ab') as output:
            process = subprocess.Popen(args, cwd=MOUNT, stdout=output, stderr=output,
                user=user.pw_uid, group=user.pw_gid, extra_groups=[], start_new_session=True)
        for _ in range(150):
            assert process.poll() is None, 'Candidate exited; inspect private server log'
            with socket.socket() as connection:
                if connection.connect_ex(('127.0.0.1', 14336)) == 0:
                    break
            time.sleep(0.2)
        def make_client(headers=None):
            instance = boto3.client('s3', endpoint_url='http://127.0.0.1:14336', region_name='us-east-1',
                aws_access_key_id=access, aws_secret_access_key=secret,
                config=Config(signature_version='s3v4', s3={'addressing_style': 'path'}, retries={'max_attempts': 0}))
            if headers:
                # The installed SDK predates conditional PUT model fields; sign the exact headers.
                def add_headers(request, **unused):
                    for name, value in headers.items():
                        request.headers[name] = value
                instance.meta.events.register('before-sign.s3.PutObject', add_headers)
            return instance
        client = make_client()
        for _ in range(40):
            try:
                existing = client.list_buckets().get('Buckets', [])
                previous = next((item['Name'] for item in existing
                    if item['Name'].startswith('kino-pick-probe-')
                    and client.list_objects_v2(Bucket=item['Name'], MaxKeys=1).get('Contents')), None)
                if previous:
                    BUCKET = previous
                else:
                    client.create_bucket(Bucket=BUCKET)
                break
            except Exception:
                time.sleep(0.3)
        else:
            raise RuntimeError('S3 candidate did not become ready')
        data = b'Kino Pick isolated storage contract\n'
        prefix = secrets.token_hex(12) + '/'
        checksum = base64.b64encode(hashlib.sha256(data).digest()).decode()
        common = dict(Bucket=BUCKET, Body=data, ContentType='image/jpeg', ContentLength=len(data), ChecksumSHA256=checksum)

        def attempt(key, **extra):
            headers = {name: extra.pop(field) for field, name in (('IfNoneMatch', 'If-None-Match'), ('IfMatch', 'If-Match')) if field in extra}
            try:
                return make_client(headers).put_object(Key=prefix + key, **common, **extra)['ResponseMetadata']['HTTPStatusCode']
            except ClientError as error:
                return error.response['ResponseMetadata']['HTTPStatusCode']

        readiness = []
        for _ in range(6):
            state = attempt('readiness-probe', IfNoneMatch='*')
            readiness.append(state)
            if state in (200, 412):
                verified = client.get_object(Bucket=BUCKET, Key=prefix + 'readiness-probe')['Body'].read()
                assert verified == data, 'Readiness probe bytes mismatch'
                break
        else:
            raise RuntimeError('Candidate never became writable')
        checks['write_readiness_verified'] = True
        print(json.dumps({'phase': 'write_readiness', 'statuses': readiness}), flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            race = list(pool.map(lambda _: attempt('race-original', IfNoneMatch='*'), range(8)))
        checks['immutable_race_statuses'] = sorted(race)
        print(json.dumps({'phase': 'immutable_race', 'statuses': sorted(race)}), flush=True)
        checks['immutable_single_winner'] = race.count(200) == 1 and race.count(412) == 7
        assert checks['immutable_single_winner'], 'Immutable race contract failed'
        head = client.head_object(Bucket=BUCKET, Key=prefix + 'race-original', ChecksumMode='ENABLED')
        checks['head_sha256'] = head.get('ChecksumSHA256') == checksum
        checks['head_size'] = head['ContentLength'] == len(data)
        checks['range_read'] = client.get_object(Bucket=BUCKET, Key=prefix + 'race-original', Range='bytes=2-5')['Body'].read() == data[2:6]
        try:
            make_client({'If-None-Match': '*'}).put_object(**{**common, 'Key': prefix + 'bad-checksum', 'ChecksumSHA256': base64.b64encode(bytes(32)).decode()})
            checks['bad_checksum_rejected'] = False
        except ClientError as error:
            checks['bad_checksum_rejected'] = error.response['ResponseMetadata']['HTTPStatusCode'] == 400
        make_client({'If-None-Match': '*'}).put_object(Bucket=BUCKET, Key=prefix + 'fenced-original', Body=b'', ContentType='application/x-kino-pic-upload-fence', Metadata={'kinoUploadFence': 'isolated-test'})
        checks['late_upload_fenced'] = attempt('fenced-original', IfNoneMatch='*') == 412
        checks['stale_etag_rejected'] = attempt('race-original', IfMatch='"stale-etag"') == 412
        make_client({'If-Match': head['ETag']}).put_object(Bucket=BUCKET, Key=prefix + 'race-original', Body=b'', ContentType='application/x-kino-pic-deleted-asset', Metadata={'kinoDeletionAsset': 'isolated-test'})
        fenced = client.head_object(Bucket=BUCKET, Key=prefix + 'race-original')
        checks['conditional_erase_fence'] = fenced['ContentLength'] == 0 and fenced.get('Metadata', {}).get('kinodeletionasset') == 'isolated-test'
        params = {**common, 'Key': prefix + 'signed-original'}
        params.pop('Body')
        url = make_client({'If-None-Match': '*'}).generate_presigned_url('put_object', Params=params, ExpiresIn=60)
        headers = {'Content-Type': 'image/jpeg', 'Content-Length': str(len(data)), 'If-None-Match': '*', 'x-amz-checksum-sha256': checksum}
        checks['signed_headers_bound'] = parse_qs(urlsplit(url).query).get('X-Amz-SignedHeaders') == ['content-length;content-type;host;if-none-match;x-amz-checksum-sha256']
        try:
            urllib.request.urlopen(urllib.request.Request(url, data=data, method='PUT', headers={**headers, 'Content-Type': 'image/png'}), timeout=15)
            checks['tampered_signed_header_rejected'] = False
        except urllib.error.HTTPError as error:
            checks['tampered_signed_header_rejected'] = error.code == 403
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method='PUT', headers=headers), timeout=15) as response:
            checks['signed_exact_put'] = response.status == 200
        try:
            urllib.request.urlopen(f'http://127.0.0.1:14336/{BUCKET}/{prefix}signed-original', timeout=10)
            checks['anonymous_denied'] = False
        except urllib.error.HTTPError as error:
            checks['anonymous_denied'] = error.code in (401, 403)
        listeners = run('ss', '-lntp').stdout.splitlines()
        relevant = [line for line in listeners if f'pid={process.pid},' in line]
        checks['loopback_only'] = bool(relevant) and all('127.0.0.1:' in line or '[::1]:' in line for line in relevant)
        report = {'version': receipt['version'], 'checks': checks, 'passed': all(value is True for key,value in checks.items() if key != 'immutable_race_statuses'), 'public_route_created': False, 'product_routing_changed': False, 'hard_test_filesystem_bytes': IMAGE.stat().st_size}
        (BASE / 'contract-proof.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        try:
            if process and process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=10)
        finally:
            run('umount', str(MOUNT))


if __name__ == '__main__':
    main()

"""Read-only Oracle bucket observation; no D1 reconciliation or public route changes."""
import hashlib
import json
import re
import runpy
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET

BUCKET = 'kino-pick-overflow'
SYSTEM_KEYS = {'_kino/system/storage-health.json', '_kino/system/storage-policy.json'}
WORKSPACE_KEY = re.compile(r'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.+$')


def observe():
    helper = runpy.run_path('/opt/kino-pick-storage/oracle-storage-health.py', run_name='kino_readonly_inventory')
    credentials = helper['read_credentials'](helper['APP_CREDS'], app=True)
    request = helper['s3_request']
    request.__globals__['MAX_BODY'] = 4 * 1024 * 1024
    started = time.monotonic()
    keys, cursors, workspaces = set(), set(), set()
    total_bytes = workspace_bytes = system_bytes = unknown_bytes = 0
    workspace_count = system_count = unknown_count = key_bytes = 0
    manifest = []
    cursor = None
    for page_number in range(1, 65):
        assert time.monotonic() - started < 15, 'OBSERVATION_DEADLINE'
        query = 'list-type=2&encoding-type=url&max-keys=1000'
        if cursor is not None:
            query += '&continuation-token=' + urllib.parse.quote(cursor, safe='')
        status, body = request('GET', '/' + BUCKET + '/', credentials, query=query)
        assert status == 200 and len(body) <= 4 * 1024 * 1024 and b'<!' not in body
        root = ET.fromstring(body)
        field = lambda name: root.findtext('{*}' + name)
        assert root.tag.split('}')[-1] == 'ListBucketResult'
        assert field('Name') == BUCKET and field('EncodingType') == 'url'
        assert field('Prefix') in (None, '') and field('MaxKeys') == '1000'
        assert field('ContinuationToken') == cursor
        entries = root.findall('{*}Contents')
        assert len(entries) <= 1000 and field('KeyCount') == str(len(entries))
        assert not root.findall('{*}CommonPrefixes')
        for entry in entries:
            encoded_key = entry.findtext('{*}Key')
            size = entry.findtext('{*}Size')
            assert encoded_key and size and re.fullmatch(r'[0-9]+', size)
            key = urllib.parse.unquote(encoded_key, errors='strict')
            size = int(size)
            assert size <= 9007199254740991 and key not in keys
            key_size = len(key.encode('utf8'))
            assert 0 < key_size <= 1024
            keys.add(key)
            key_bytes += key_size
            total_bytes += size
            assert len(keys) <= 20000 and key_bytes <= 4194304 and total_bytes <= 9007199254740991
            manifest.append((key, size))
            match = WORKSPACE_KEY.fullmatch(key)
            if match:
                workspaces.add(match.group(1)); workspace_count += 1; workspace_bytes += size
            elif key in SYSTEM_KEYS:
                system_count += 1; system_bytes += size
            else:
                unknown_count += 1; unknown_bytes += size
        truncated = field('IsTruncated')
        assert truncated in ('true', 'false')
        next_cursor = field('NextContinuationToken')
        if truncated == 'false':
            assert next_cursor in (None, '')
            break
        assert next_cursor and len(next_cursor.encode('utf8')) <= 4096 and next_cursor not in cursors
        cursors.add(next_cursor); cursor = next_cursor
    else:
        raise RuntimeError('PAGE_LIMIT')
    assert time.monotonic() - started < 15
    assert workspace_count + system_count + unknown_count == len(keys)
    assert workspace_bytes + system_bytes + unknown_bytes == total_bytes
    digest = hashlib.sha256(json.dumps(sorted(manifest), ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    return {'status': 'observed_complete_listing_only', 'bucket': BUCKET, 'pages': page_number,
            'objects': len(keys), 'objectBytes': total_bytes, 'workspacePrefixes': len(workspaces),
            'workspaceObjects': workspace_count, 'workspaceBytes': workspace_bytes,
            'systemObjects': system_count, 'systemBytes': system_bytes,
            'unrecognizedObjects': unknown_count, 'unrecognizedBytes': unknown_bytes,
            'manifestSha256': digest, 'databaseCompared': False, 'atomicSnapshot': False,
            'healthyAsserted': False, 'objectsModified': False, 'publicRouteChanged': False,
            'credentialsExported': False, 'rawKeysExported': False}


if __name__ == '__main__':
    try:
        print(json.dumps(observe()))
    except Exception as error:
        print(json.dumps({'status': 'observation_failed', 'reason': type(error).__name__, 'detailsWithheld': True}))
        sys.exit(1)

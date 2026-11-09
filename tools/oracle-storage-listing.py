"""Prepare the bounded, signed Oracle S3 bucket-list route in Caddy.

The default command writes and validates a private candidate only. Applying it
requires the explicit --apply option and a fresh configuration hash check.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

CONFIG = Path('/etc/caddy/Caddyfile')
MARKER = '# Kino Pick private overflow objects'
LISTING_PATH = '/kino-pick-overflow/'
LISTING_METHOD = 'GET'
LISTING_AUTHORIZATION = 'AWS4-HMAC-SHA256*'
UPSTREAM = '127.0.0.1:15336'
CANDIDATE_PREFIX = 'KinoPick.Listing.Caddyfile.'
LIST_QUERY_MAX_CHARS = 12400

# High percent octets can be UTF-8 continuation bytes, including emoji cursors.
_TOKEN_PATTERN = r'([A-Za-z0-9._~+*-]|%([2-6][0-9A-Fa-f]|7[0-9A-Ea-e]|[89A-Fa-f][0-9A-Fa-f]))+'
LIST_QUERY_PATTERN = (
    r'^list-type=2&encoding-type=url&prefix='
    r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}%2F'
    r'&max-keys=([1-9]|[1-9][0-9]|[1-9][0-9]{2}|1000)'
    r'(&continuation-token=' + _TOKEN_PATTERN + r')?$'
)

OLD_SNIPPET = '''    # Kino Pick private overflow objects
    @kino_storage path /kino-pick-overflow/*
    handle @kino_storage {
        @bucket_root path /kino-pick-overflow/
        respond @bucket_root 403
        @quota_query expression `{http.request.uri.query}.matches('(?i)(^|&)seaweedfs-quota(=|&|$)')`
        respond @quota_query 403
        @unsupported not method GET HEAD PUT OPTIONS
        respond @unsupported 405
        reverse_proxy 127.0.0.1:15336
    }'''

NEW_SNIPPET = '\n'.join(
    [
        '    # Kino Pick private overflow objects',
        '    @kino_storage path /kino-pick-overflow/*',
        '    handle @kino_storage {',
        '        @kino_listing {',
        '            method GET',
        '            path /kino-pick-overflow/',
        f'            header Authorization "{LISTING_AUTHORIZATION}"',
        f"            expression `{{http.request.uri.query}}.matches('{LIST_QUERY_PATTERN}') && {{http.request.uri.query}}.size() <= {LIST_QUERY_MAX_CHARS}`",
        '        }',
        '        @bucket_root path /kino-pick-overflow/',
        "        @quota_query expression `{http.request.uri.query}.matches('(?i)(^|&)seaweedfs-quota(=|&|$)')`",
        '        @unsupported not method GET HEAD PUT OPTIONS',
        '        route {',
        f'            reverse_proxy @kino_listing {UPSTREAM}',
        '            respond @bucket_root 403',
        '            respond @quota_query 403',
        '            respond @unsupported 405',
        f'            reverse_proxy {UPSTREAM}',
        '        }',
        '    }',
    ]
)


class ListingToolError(RuntimeError):
    def __init__(self, code, **details):
        super().__init__(code)
        self.code = code
        self.details = details


def listing_query_allowed(query):
    """Test the same strict raw-query pattern rendered into the Caddy matcher."""
    return (
        isinstance(query, str)
        and len(query) <= LIST_QUERY_MAX_CHARS
        and re.fullmatch(LIST_QUERY_PATTERN, query) is not None
    )


def listing_request_allowed(method, path, authorization, query):
    """Mirror only the Caddy gate; SeaweedFS remains responsible for SigV4."""
    return (
        method == LISTING_METHOD
        and path == LISTING_PATH
        and isinstance(authorization, str)
        and authorization.startswith(LISTING_AUTHORIZATION[:-1])
        and listing_query_allowed(query)
    )


def render_candidate(text):
    if not isinstance(text, str):
        raise ListingToolError('CONFIG_NOT_TEXT')
    marker_count = text.count(MARKER)
    new_count = text.count(NEW_SNIPPET)
    if new_count:
        if marker_count == 1 and new_count == 1:
            return text
        raise ListingToolError('CONFIG_SNIPPET_DRIFT')
    if marker_count > 1:
        raise ListingToolError('CONFIG_SNIPPET_DRIFT')
    if text.count(OLD_SNIPPET) != 1:
        raise ListingToolError('CONFIG_SNIPPET_DRIFT')
    return text.replace(OLD_SNIPPET, NEW_SNIPPET, 1)


def _sha256(value):
    return hashlib.sha256(value).hexdigest()


def _require_root():
    geteuid = getattr(os, 'geteuid', None)
    if geteuid is None or geteuid() != 0:
        raise ListingToolError('ROOT_REQUIRED')


def _read_config(path):
    try:
        metadata = path.lstat()
    except OSError:
        raise ListingToolError('CONFIG_UNAVAILABLE') from None
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise ListingToolError('CONFIG_UNAVAILABLE')
    try:
        resolved = path.resolve(strict=True)
    except OSError:
        raise ListingToolError('CONFIG_UNAVAILABLE') from None
    if resolved != path:
        raise ListingToolError('CONFIG_PATH_UNEXPECTED')
    try:
        contents = path.read_bytes()
        contents.decode('utf-8')
    except (OSError, UnicodeError):
        raise ListingToolError('CONFIG_UNAVAILABLE') from None
    return contents, metadata


def _set_fd_mode(fd, path, mode):
    if hasattr(os, 'fchmod'):
        os.fchmod(fd, mode)
    else:
        os.chmod(path, mode)


def _write_exclusive(path, contents, mode):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(str(path), flags, mode)
    except OSError:
        raise ListingToolError('OUTPUT_PATH_UNAVAILABLE') from None
    try:
        _set_fd_mode(fd, path, mode)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
    except OSError:
        try:
            path.unlink()
        except OSError:
            pass
        raise ListingToolError('OUTPUT_WRITE_FAILED') from None


def _validate(path):
    try:
        subprocess.run(
            ['caddy', 'validate', '--config', str(path), '--adapter', 'caddyfile'],
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError):
        raise ListingToolError('CADDY_VALIDATE_FAILED') from None


def _fresh_config(path, expected_hash):
    contents, metadata = _read_config(path)
    if _sha256(contents) != expected_hash:
        raise ListingToolError('CONFIG_CHANGED')
    return contents, metadata


def _preserve_owner_mode(path, metadata):
    if hasattr(os, 'chown'):
        try:
            os.chown(path, metadata.st_uid, metadata.st_gid)
        except OSError:
            raise ListingToolError('CONFIG_METADATA_PRESERVE_FAILED') from None
    elif os.name != 'nt':
        raise ListingToolError('CONFIG_METADATA_PRESERVE_FAILED')
    try:
        os.chmod(path, stat.S_IMODE(metadata.st_mode))
    except OSError:
        raise ListingToolError('CONFIG_METADATA_PRESERVE_FAILED') from None


def _atomic_replace(path, contents, metadata, expected_hash=None):
    staging = path.with_name(
        f'.{path.name}.kino-listing-{os.getpid()}-{time.time_ns()}'
    )
    _write_exclusive(staging, contents, 0o600)
    try:
        _preserve_owner_mode(staging, metadata)
        if expected_hash is not None:
            _fresh_config(path, expected_hash)
        os.replace(staging, path)
        if hasattr(os, 'O_DIRECTORY'):
            directory_fd = os.open(str(path.parent), os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    finally:
        try:
            staging.unlink()
        except FileNotFoundError:
            pass


def _reload_caddy():
    try:
        subprocess.run(['systemctl', 'reload', 'caddy'], check=True, capture_output=True)
    except (OSError, subprocess.CalledProcessError):
        raise ListingToolError('CADDY_RELOAD_FAILED') from None


def prepare(
    config_path=None,
    apply=False,
    expected_before_sha256=None,
    expected_candidate_sha256=None,
):
    """Prepare a 0600 candidate; apply requires hashes for the reviewed pair."""
    if apply:
        if expected_before_sha256 is None or expected_candidate_sha256 is None:
            raise ListingToolError('EXPECTED_HASHES_REQUIRED')
        if any(
            not isinstance(value, str) or re.fullmatch(r'[0-9a-f]{64}', value) is None
            for value in (expected_before_sha256, expected_candidate_sha256)
        ):
            raise ListingToolError('EXPECTED_HASH_FORMAT_INVALID')
    _require_root()
    path = Path(config_path) if config_path is not None else CONFIG
    original, metadata = _read_config(path)
    original_hash = _sha256(original)
    try:
        candidate = render_candidate(original.decode('utf-8')).encode('utf-8')
    except UnicodeError:
        raise ListingToolError('CONFIG_UNAVAILABLE') from None
    candidate_hash = _sha256(candidate)
    if apply:
        if original_hash != expected_before_sha256:
            raise ListingToolError('EXPECTED_BEFORE_SHA256_MISMATCH')
        if candidate_hash != expected_candidate_sha256:
            raise ListingToolError('EXPECTED_CANDIDATE_SHA256_MISMATCH')
    if candidate == original:
        return {'status': 'already_current', 'sha256': original_hash}

    if not apply:
        candidate_path = path.with_name(
            CANDIDATE_PREFIX + str(time.time_ns()) + '.candidate'
        )
        _write_exclusive(candidate_path, candidate, 0o600)
        _validate(candidate_path)
        return {
            'status': 'candidate_ready',
            'beforeSha256': original_hash,
            'candidateSha256': candidate_hash,
            'candidate': str(candidate_path),
        }

    staging = path.with_name(
        f'.{path.name}.kino-listing-validate-{os.getpid()}-{time.time_ns()}'
    )
    _write_exclusive(staging, candidate, 0o600)
    try:
        _validate(staging)
        _, fresh_metadata = _fresh_config(path, original_hash)
        backup = path.with_name(
            'Caddyfile.before-kino-storage-' + str(time.time_ns())
        )
        _write_exclusive(backup, original, 0o600)
        _, fresh_metadata = _fresh_config(path, original_hash)
        try:
            _atomic_replace(path, candidate, fresh_metadata, original_hash)
        except Exception:
            try:
                current_hash = _sha256(path.read_bytes())
            except OSError:
                current_hash = None
            raise ListingToolError(
                'INSTALL_STATE_UNVERIFIED',
                backup=str(backup),
                beforeSha256=original_hash,
                candidateSha256=candidate_hash,
                currentSha256=current_hash,
                reloadRequested=False,
            ) from None
        try:
            _reload_caddy()
        except ListingToolError:
            try:
                installed = path.read_bytes()
            except OSError:
                installed = b''
            if installed != candidate:
                raise ListingToolError(
                    'RELOAD_FAILED_CONCURRENT_CONFIG_PRESERVED',
                    backup=str(backup),
                    beforeSha256=original_hash,
                    candidateSha256=candidate_hash,
                ) from None
            try:
                _atomic_replace(path, original, fresh_metadata, candidate_hash)
            except Exception as error:
                if not isinstance(error, ListingToolError) or error.code != 'CONFIG_CHANGED':
                    try:
                        current_hash = _sha256(path.read_bytes())
                    except OSError:
                        current_hash = None
                    raise ListingToolError(
                        'ROLLBACK_STATE_UNVERIFIED',
                        backup=str(backup),
                        beforeSha256=original_hash,
                        candidateSha256=candidate_hash,
                        currentSha256=current_hash,
                        reloadRequested=True,
                    ) from None
                raise ListingToolError(
                    'RELOAD_FAILED_CONCURRENT_CONFIG_PRESERVED',
                    backup=str(backup),
                    beforeSha256=original_hash,
                    candidateSha256=candidate_hash,
                ) from None
            try:
                _reload_caddy()
            except ListingToolError:
                raise ListingToolError(
                    'RELOAD_FAILED_ORIGINAL_RESTORED_RELOAD_FAILED',
                    backup=str(backup),
                    beforeSha256=original_hash,
                    candidateSha256=candidate_hash,
                ) from None
            raise ListingToolError(
                'RELOAD_FAILED_ORIGINAL_RESTORED',
                backup=str(backup),
                beforeSha256=original_hash,
                candidateSha256=candidate_hash,
            ) from None
        try:
            installed = path.read_bytes()
        except OSError:
            installed = b''
        if installed != candidate:
            raise ListingToolError(
                'CONFIG_CHANGED_AFTER_RELOAD',
                backup=str(backup),
                beforeSha256=original_hash,
                candidateSha256=candidate_hash,
                currentSha256=_sha256(installed),
            )
        return {
            'status': 'applied',
            'beforeSha256': original_hash,
            'afterSha256': candidate_hash,
            'backup': str(backup),
        }
    finally:
        try:
            staging.unlink()
        except FileNotFoundError:
            pass


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--apply',
        action='store_true',
        help='atomically replace the Caddyfile and reload Caddy (default: prepare only)',
    )
    parser.add_argument('--expected-before-sha256')
    parser.add_argument('--expected-candidate-sha256')
    args = parser.parse_args(argv)
    try:
        result = prepare(
            apply=args.apply,
            expected_before_sha256=args.expected_before_sha256,
            expected_candidate_sha256=args.expected_candidate_sha256,
        )
    except ListingToolError as error:
        result = {'status': 'blocked', 'reason': error.code, **error.details}
        print(json.dumps(result, sort_keys=True))
        return 2
    except Exception:
        print(json.dumps({'status': 'blocked', 'reason': 'TOOL_FAILED'}))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[2] / 'tools' / 'oracle-storage-listing.py'
SPEC = importlib.util.spec_from_file_location('oracle_storage_listing', MODULE_PATH)
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)

WORKSPACE = '123e4567-e89b-12d3-a456-426614174000'
OTHER_WORKSPACE = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'


def query(prefix=WORKSPACE, maximum='1000', token=None):
    value = (
        'list-type=2&encoding-type=url&prefix='
        + prefix
        + '%2F&max-keys='
        + maximum
    )
    if token is not None:
        value += '&continuation-token=' + token
    return value


def legacy_config():
    return (
        '{\n    admin off\n}\n\n'
        'drive.kinostudio.tw {\n'
        '    # Existing Review media route\n'
        + tool.OLD_SNIPPET
        + '\n'
        '    # Existing protected Review route\n'
        '    reverse_proxy 127.0.0.1:15336\n'
        '}\n'
    )


def fake_success(command, **kwargs):
    return subprocess.CompletedProcess(command, 0, stdout=b'private-output', stderr=b'private-error')


class OracleStorageListingTests(unittest.TestCase):
    def test_query_and_request_gate_accepts_only_canonical_list_requests(self):
        for maximum in ('1', '1000'):
            self.assertTrue(tool.listing_query_allowed(query(maximum=maximum)))
        self.assertTrue(
            tool.listing_query_allowed(query(token='c*+'))
        )
        self.assertTrue(
            tool.listing_query_allowed(query(token='opaque%2B%2F%3D%26%2A'))
        )
        self.assertTrue(tool.listing_query_allowed(query(token='opaque%F0%9F%98%80')))
        self.assertTrue(tool.listing_query_allowed(query(prefix=OTHER_WORKSPACE)))
        self.assertTrue(
            tool.listing_query_allowed(query(token='a' * 12288))
        )
        self.assertFalse(
            tool.listing_query_allowed(query(token='a' * tool.LIST_QUERY_MAX_CHARS))
        )

        self.assertTrue(
            tool.listing_request_allowed(
                'GET',
                tool.LISTING_PATH,
                'AWS4-HMAC-SHA256 Credential=test',
                query(),
            )
        )
        for method in ('HEAD', 'POST', 'PUT', 'OPTIONS', 'PATCH'):
            self.assertFalse(
                tool.listing_request_allowed(
                    method,
                    tool.LISTING_PATH,
                    'AWS4-HMAC-SHA256 Credential=test',
                    query(),
                )
            )
        for path in ('/kino-pick-overflow', '/kino-pick-overflow/photo.jpg'):
            self.assertFalse(
                tool.listing_request_allowed(
                    'GET',
                    path,
                    'AWS4-HMAC-SHA256 Credential=test',
                    query(),
                )
            )
        for authorization in ('', 'Bearer test', 'AWS4-HMAC-SHA255 test'):
            self.assertFalse(
                tool.listing_request_allowed(
                    'GET', tool.LISTING_PATH, authorization, query()
                )
            )

        invalid_queries = [
            query(prefix='not-a-workspace'),
            query(prefix=WORKSPACE + '%2Fnested'),
            query(prefix=WORKSPACE, maximum='0'),
            query(prefix=WORKSPACE, maximum='1001'),
            query(prefix=WORKSPACE, maximum='01'),
            query() + '&acl',
            query() + '&seaweedfs-quota=1',
            query() + '&delimiter=%2F',
            query() + '&start-after=photo',
            query() + '&prefix=' + WORKSPACE + '%2F',
            query(prefix=WORKSPACE + '%252F'),
            query() + '\n',
            query().replace('list-type=2', 'list-type=1'),
            query(token=''),
            query(token='opaque%2G'),
            query(token='opaque%0A'),
            query(token='opaque%7f'),
            query(token='opaque/raw'),
            query(token='a&extra=1'),
        ]
        for value in invalid_queries:
            with self.subTest(query=value[:80]):
                self.assertFalse(tool.listing_query_allowed(value))

    def test_caddy_snippet_has_exact_matcher_and_literal_handler_order(self):
        snippet = tool.NEW_SNIPPET
        matcher = snippet.index('@kino_listing {')
        route = snippet.index('        route {')
        handlers = [
            snippet.index('            reverse_proxy @kino_listing'),
            snippet.index('            respond @bucket_root 403'),
            snippet.index('            respond @quota_query 403'),
            snippet.index('            respond @unsupported 405'),
            snippet.rindex('            reverse_proxy 127.0.0.1:15336'),
        ]
        self.assertLess(matcher, route)
        self.assertEqual(handlers, sorted(handlers))
        self.assertIn('path /kino-pick-overflow/', snippet)
        self.assertIn('method GET', snippet)
        self.assertIn('header Authorization "AWS4-HMAC-SHA256*"', snippet)
        self.assertIn(tool.LIST_QUERY_PATTERN, snippet)
        self.assertIn(f'.size() <= {tool.LIST_QUERY_MAX_CHARS}', snippet)
        self.assertNotIn('handle_path', snippet)
        self.assertEqual(snippet.count('reverse_proxy'), 2)

    def test_render_preserves_every_byte_outside_the_exact_legacy_snippet(self):
        before = '{\n    # untouched global options\n}\n\ndrive.kinostudio.tw {\n'
        after = '\n    # untouched Review config\n    respond /review/* 403\n}\n'
        source = before + tool.OLD_SNIPPET + after
        candidate = tool.render_candidate(source)

        self.assertEqual(candidate, before + tool.NEW_SNIPPET + after)
        self.assertEqual(tool.render_candidate(candidate), candidate)
        self.assertEqual(candidate.count(tool.MARKER), 1)

    def test_render_rejects_duplicate_or_drifted_markers(self):
        for source in (
            tool.OLD_SNIPPET + '\n' + tool.OLD_SNIPPET,
            tool.OLD_SNIPPET.replace('respond @bucket_root 403', 'respond 200'),
            tool.NEW_SNIPPET + '\n' + tool.NEW_SNIPPET,
            tool.NEW_SNIPPET.replace('method GET', 'method GET POST'),
        ):
            with self.subTest(source_length=len(source)):
                with self.assertRaises(tool.ListingToolError) as error:
                    tool.render_candidate(source)
                self.assertEqual(error.exception.code, 'CONFIG_SNIPPET_DRIFT')

    def test_default_cli_writes_private_candidate_validates_and_never_applies(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'Caddyfile'
            config.write_bytes(legacy_config().encode())
            output = io.StringIO()
            set_mode = patch.object(tool, '_set_fd_mode', wraps=tool._set_fd_mode)
            with (
                patch.object(tool, 'CONFIG', config),
                patch.object(tool.os, 'geteuid', return_value=0, create=True),
                patch.object(tool.subprocess, 'run', side_effect=fake_success) as run,
                set_mode as mode_mock,
                contextlib.redirect_stdout(output),
            ):
                self.assertEqual(tool.main([]), 0)

            result = json.loads(output.getvalue())
            self.assertEqual(result['status'], 'candidate_ready')
            candidate = Path(result['candidate'])
            self.assertEqual(candidate.read_bytes(), tool.render_candidate(legacy_config()).encode())
            self.assertEqual(mode_mock.call_args_list[0].args[2], 0o600)
            if os.name != 'nt':
                self.assertEqual(stat.S_IMODE(candidate.stat().st_mode), 0o600)
            self.assertEqual(run.call_count, 1)
            self.assertEqual(run.call_args.args[0][:2], ['caddy', 'validate'])
            self.assertTrue(run.call_args.kwargs['capture_output'])
            self.assertEqual(config.read_text(encoding='utf-8'), legacy_config())
            self.assertNotIn('private-output', output.getvalue())
            self.assertNotIn('Existing Review', output.getvalue())
            self.assertNotIn('systemctl', str(run.call_args.args))

    def test_nonroot_is_rejected_before_config_access(self):
        with (
            patch.object(tool.os, 'geteuid', return_value=1000, create=True),
            self.assertRaises(tool.ListingToolError) as error,
        ):
            tool.prepare('/missing/Caddyfile')
        self.assertEqual(error.exception.code, 'ROOT_REQUIRED')

    def test_explicit_apply_uses_hash_check_private_backup_atomic_replace_and_reload(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'Caddyfile'
            original = legacy_config().encode()
            config.write_bytes(original)
            metadata = config.stat()
            calls = []

            def run(command, **kwargs):
                calls.append((command, kwargs))
                return fake_success(command, **kwargs)

            with (
                patch.object(tool.os, 'geteuid', return_value=0, create=True),
                patch.object(tool, '_preserve_owner_mode', wraps=tool._preserve_owner_mode) as preserve,
                patch.object(tool.subprocess, 'run', side_effect=run),
            ):
                result = tool.prepare(config, apply=True)

            self.assertEqual(result['status'], 'applied')
            self.assertEqual(result['beforeSha256'], tool._sha256(original))
            self.assertEqual(config.read_bytes(), tool.render_candidate(original.decode()).encode())
            backup = Path(result['backup'])
            self.assertEqual(backup.read_bytes(), original)
            self.assertEqual(calls[0][0][:2], ['caddy', 'validate'])
            self.assertEqual(calls[1][0], ['systemctl', 'reload', 'caddy'])
            self.assertEqual(preserve.call_count, 1)
            if os.name != 'nt':
                self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE(config.stat().st_mode), stat.S_IMODE(metadata.st_mode))

    def test_apply_hash_cas_preserves_concurrent_edit_and_does_not_reload(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'Caddyfile'
            config.write_bytes(legacy_config().encode())
            concurrent = b'{\n    # concurrent Review change\n}\n'

            def run(command, **kwargs):
                if command[0] == 'caddy':
                    config.write_bytes(concurrent)
                return fake_success(command, **kwargs)

            with (
                patch.object(tool.os, 'geteuid', return_value=0, create=True),
                patch.object(tool.subprocess, 'run', side_effect=run) as mocked,
            ):
                with self.assertRaises(tool.ListingToolError) as error:
                    tool.prepare(config, apply=True)

            self.assertEqual(error.exception.code, 'CONFIG_CHANGED')
            self.assertEqual(config.read_bytes(), concurrent)
            self.assertEqual(mocked.call_count, 1)
            self.assertFalse(any('Caddyfile.before-' in item.name for item in Path(directory).iterdir()))

    def test_failed_reload_rolls_back_only_if_config_is_still_our_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'Caddyfile'
            original = legacy_config().encode()
            config.write_bytes(original)
            reloads = 0

            def failed_once(command, **kwargs):
                nonlocal reloads
                if command[0] == 'systemctl':
                    reloads += 1
                    if reloads == 1:
                        raise subprocess.CalledProcessError(1, command)
                return fake_success(command, **kwargs)

            with (
                patch.object(tool.os, 'geteuid', return_value=0, create=True),
                patch.object(tool.subprocess, 'run', side_effect=failed_once),
            ):
                with self.assertRaises(tool.ListingToolError) as error:
                    tool.prepare(config, apply=True)
            self.assertEqual(error.exception.code, 'RELOAD_FAILED_ORIGINAL_RESTORED')
            self.assertEqual(config.read_bytes(), original)
            self.assertEqual(reloads, 2)

        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'Caddyfile'
            config.write_bytes(legacy_config().encode())
            concurrent = b'{\n    # concurrent after install\n}\n'
            reloads = 0

            def concurrent_after_install(command, **kwargs):
                nonlocal reloads
                if command[0] == 'systemctl':
                    reloads += 1
                    config.write_bytes(concurrent)
                    raise subprocess.CalledProcessError(1, command)
                return fake_success(command, **kwargs)

            with (
                patch.object(tool.os, 'geteuid', return_value=0, create=True),
                patch.object(tool.subprocess, 'run', side_effect=concurrent_after_install),
            ):
                with self.assertRaises(tool.ListingToolError) as error:
                    tool.prepare(config, apply=True)
            self.assertEqual(
                error.exception.code,
                'RELOAD_FAILED_CONCURRENT_CONFIG_PRESERVED',
            )
            self.assertEqual(config.read_bytes(), concurrent)
            self.assertEqual(reloads, 1)

    def test_post_reload_cas_never_reports_applied_over_a_concurrent_edit(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'Caddyfile'
            config.write_bytes(legacy_config().encode())
            concurrent = b'{\n    # changed during reload\n}\n'

            def edit_after_reload(command, **kwargs):
                if command[0] == 'systemctl':
                    config.write_bytes(concurrent)
                return fake_success(command, **kwargs)

            with (
                patch.object(tool.os, 'geteuid', return_value=0, create=True),
                patch.object(tool.subprocess, 'run', side_effect=edit_after_reload),
            ):
                with self.assertRaises(tool.ListingToolError) as error:
                    tool.prepare(config, apply=True)
            self.assertEqual(error.exception.code, 'CONFIG_CHANGED_AFTER_RELOAD')
            self.assertEqual(config.read_bytes(), concurrent)


if __name__ == '__main__':
    unittest.main()

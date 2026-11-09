import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.parse
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('oracle_inventory', Path(__file__).resolve().parents[2] / 'tools/oracle-storage-inventory.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


def page(objects, cursor=None, next_cursor=None, truncated=False):
    root = ET.Element('ListBucketResult', xmlns='http://s3.amazonaws.com/doc/2006-03-01/')
    fields = {'Name': tool.BUCKET, 'EncodingType': 'url', 'MaxKeys': '1000', 'KeyCount': str(len(objects)), 'IsTruncated': str(truncated).lower()}
    if cursor is not None: fields['ContinuationToken'] = cursor
    if next_cursor is not None: fields['NextContinuationToken'] = next_cursor
    for key, value in fields.items(): ET.SubElement(root, key).text = value
    for key, size in objects:
        content = ET.SubElement(root, 'Contents')
        ET.SubElement(content, 'Key').text = urllib.parse.quote(key, safe='')
        ET.SubElement(content, 'Size').text = str(size)
    return ET.tostring(root)


class ObservationTest(unittest.TestCase):
    def observe(self, pages, clock=None):
        remaining = iter(pages)
        calls = []
        def request(method, path, credentials, query):
            calls.append((method, path, query))
            return 200, next(remaining)
        helper = {'APP_CREDS': 'synthetic', 'read_credentials': lambda path, app: {}, 's3_request': request}
        with patch.object(tool.runpy, 'run_path', return_value=helper):
            if clock is None: result = tool.observe()
            else:
                with patch.object(tool.time, 'monotonic', side_effect=clock): result = tool.observe()
        return result, calls

    def test_counts_unknown_objects_without_exporting_or_ignoring_keys(self):
        key = '11111111-1111-4111-8111-111111111111/photo.jpg'
        result, calls = self.observe([page([(key, 3), ('_kino/system/storage-policy.json', 2), ('unclassified/object', 4)])])
        self.assertEqual((result['objects'], result['objectBytes']), (3, 9))
        self.assertEqual((result['workspaceObjects'], result['systemObjects'], result['unrecognizedObjects']), (1, 1, 1))
        self.assertFalse(result['databaseCompared']); self.assertFalse(result['healthyAsserted'])
        self.assertFalse(result['rawKeysExported']); self.assertNotIn(key, str(result))
        self.assertEqual(calls, [('GET', '/kino-pick-overflow/', 'list-type=2&encoding-type=url&max-keys=1000')])

    def test_opaque_cursor_is_encoded_and_each_page_is_counted(self):
        result, calls = self.observe([page([('one', 1)], next_cursor='t+/=', truncated=True), page([('two', 2)], cursor='t+/=')])
        self.assertEqual((result['pages'], result['objectBytes']), (2, 3))
        self.assertTrue(calls[1][2].endswith('continuation-token=t%2B%2F%3D'))

    def test_duplicate_objects_or_nonterminal_cursor_are_rejected(self):
        for pages in [[page([('one', 1), ('one', 2)])], [page([], next_cursor='bad')], [page([], next_cursor='loop', truncated=True), page([], cursor='loop', next_cursor='loop', truncated=True)]]:
            with self.assertRaises(AssertionError): self.observe(pages)

    def test_malformed_xml_declared_entities_and_wrong_bucket_are_rejected(self):
        for body in [b'not xml', b'<!DOCTYPE x><ListBucketResult/>', page([]).replace(b'kino-pick-overflow', b'other-bucket')]:
            with self.assertRaises((AssertionError, ET.ParseError)): self.observe([body])

    def test_invalid_sizes_and_total_bound_are_rejected(self):
        for objects in [[('key', -1)], [('key', 9007199254740992)], [('one', 9007199254740991), ('two', 1)]]:
            with self.assertRaises(AssertionError): self.observe([page(objects)])

    def test_deadline_is_not_a_successful_partial_listing(self):
        with self.assertRaises(AssertionError): self.observe([page([])], clock=[0, 16])


if __name__ == '__main__': unittest.main()

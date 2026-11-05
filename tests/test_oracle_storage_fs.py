import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import oracle_storage_fs as storage_fs


class EffectiveFreeBytesTests(unittest.TestCase):
    def test_host_free_below_floor_is_reported_as_below_floor(self):
        host_free = storage_fs.HOST_FREE_FLOOR_BYTES - 1
        inner_free = storage_fs.FILESYSTEM_HEADROOM_BYTES + storage_fs.GB
        self.assertEqual(storage_fs.effective_free_bytes(host_free, inner_free), host_free)

    def test_full_and_nearly_full_image_keep_only_the_floor(self):
        floor = storage_fs.HOST_FREE_FLOOR_BYTES
        scratch = storage_fs.FILESYSTEM_HEADROOM_BYTES
        host_free = floor + 100 * storage_fs.GB
        self.assertEqual(storage_fs.effective_free_bytes(host_free, 0), floor)
        self.assertEqual(storage_fs.effective_free_bytes(host_free, scratch - 1), floor)
        self.assertEqual(storage_fs.effective_free_bytes(host_free, scratch + 1), floor + 1)

    def test_outer_filesystem_limits_inner_free_capacity(self):
        floor = storage_fs.HOST_FREE_FLOOR_BYTES
        host_free = floor + 3 * storage_fs.GB
        inner_free = storage_fs.FILESYSTEM_HEADROOM_BYTES + 8 * storage_fs.GB
        self.assertEqual(storage_fs.effective_free_bytes(host_free, inner_free), host_free)

    def test_normal_capacity_subtracts_inner_scratch(self):
        floor = storage_fs.HOST_FREE_FLOOR_BYTES
        host_free = floor + 100 * storage_fs.GB
        inner_free = storage_fs.FILESYSTEM_HEADROOM_BYTES + 10 * storage_fs.GB
        self.assertEqual(storage_fs.effective_free_bytes(host_free, inner_free), floor + 10 * storage_fs.GB)

    def test_inputs_must_be_nonnegative_exact_integers(self):
        for invalid in (-1, 1.5, True, False, None, '1'):
            with self.subTest(value=invalid, argument='host'):
                with self.assertRaises(ValueError):
                    storage_fs.effective_free_bytes(invalid, 0)
            with self.subTest(value=invalid, argument='inner'):
                with self.assertRaises(ValueError):
                    storage_fs.effective_free_bytes(0, invalid)


if __name__ == '__main__':
    unittest.main()

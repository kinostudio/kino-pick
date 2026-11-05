"""Fixed-path filesystem safeguards for the Kino Pick SeaweedFS node."""

import os
import re
import shutil
import stat
import subprocess
from pathlib import Path

GB = 1_000_000_000
GIB = 1024**3
MIN_QUOTA_BYTES = GB
MAX_QUOTA_BYTES = 100 * GB
HOST_FREE_FLOOR_BYTES = 20 * GB
FILESYSTEM_HEADROOM_BYTES = 512 * 1024 * 1024
DATA_ROOT = Path('/srv/kino-review')
IMAGE = DATA_ROOT / '.kino-pick-storage.ext4'
MOUNT = DATA_ROOT / 'kino-pick-storage'


def quota_bytes_for_gb(value):
    if type(value) is not int or not 1 <= value <= 100:
        raise ValueError('quota must be an integer from 1 to 100 GB')
    return value * GB


def quota_gb_for_bytes(value):
    if (
        type(value) is not int
        or value < MIN_QUOTA_BYTES
        or value > MAX_QUOTA_BYTES
        or value % GB
    ):
        raise ValueError('quotaBytes must be a whole decimal GB from 1 to 100 GB')
    return value // GB


def image_bytes_for_quota(quota_bytes):
    quota_gb_for_bytes(quota_bytes)
    overhead = max(GIB, (quota_bytes + 9) // 10)
    return quota_bytes + overhead


def maximum_quota_for_image(image_bytes):
    if type(image_bytes) is not int or image_bytes < 0:
        raise ValueError('invalid image size')
    result = 0
    for quota_gb in range(1, 101):
        candidate = quota_gb * GB
        if image_bytes_for_quota(candidate) > image_bytes:
            break
        result = candidate
    return result


def maximum_quota_for_filesystem(filesystem_bytes):
    if type(filesystem_bytes) is not int or filesystem_bytes < 0:
        raise ValueError('invalid filesystem size')
    available = max(0, filesystem_bytes - FILESYSTEM_HEADROOM_BYTES)
    return (available // GB) * GB


def effective_free_bytes(host_free_bytes, inner_available_bytes):
    if any(type(value) is not int or value < 0 for value in (host_free_bytes, inner_available_bytes)):
        raise ValueError('free-space values must be nonnegative integers')
    # Worker subtracts the host floor, so encode the smaller usable budget in the existing health field.
    inner_safe_bytes = HOST_FREE_FLOOR_BYTES + max(
        0, inner_available_bytes - FILESYSTEM_HEADROOM_BYTES
    )
    return min(host_free_bytes, inner_safe_bytes)


def parse_storage_policy(payload):
    import json

    if not isinstance(payload, bytes) or len(payload) > 4096:
        raise ValueError('invalid storage policy size')
    try:
        policy = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError('invalid storage policy JSON') from error
    if not isinstance(policy, dict) or set(policy) != {'quotaBytes', 'revision'}:
        raise ValueError('invalid storage policy fields')
    quota_gb_for_bytes(policy['quotaBytes'])
    if type(policy['revision']) is not int or policy['revision'] < 0:
        raise ValueError('invalid storage policy revision')
    return policy


def _assert_no_symlink_components(path):
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode):
            raise RuntimeError('storage path contains a symlink')


def _run(*args, capture=True):
    return subprocess.run(
        [str(arg) for arg in args],
        check=True,
        capture_output=capture,
        text=True,
        timeout=120,
    )


def assert_data_root():
    _assert_no_symlink_components(DATA_ROOT)
    if not DATA_ROOT.is_dir() or DATA_ROOT.resolve(strict=True) != DATA_ROOT:
        raise RuntimeError('storage data root is not the fixed directory')
    if not os.path.ismount(DATA_ROOT):
        raise RuntimeError('storage data filesystem is not mounted')
    result = _run('findmnt', '-n', '-o', 'TARGET,FSTYPE', '--target', DATA_ROOT)
    fields = result.stdout.strip().split()
    if fields != [str(DATA_ROOT), 'ext4']:
        raise RuntimeError('storage data root is not the expected ext4 mount')


def assert_host_free_floor(required_additional_bytes=0):
    free = shutil.disk_usage(DATA_ROOT).free
    if free - required_additional_bytes < HOST_FREE_FLOOR_BYTES:
        raise RuntimeError('host free-space floor would be breached')
    return free


def _path_is_mounted(path):
    result = subprocess.run(
        ['mountpoint', '-q', str(path)],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode not in (0, 32):
        raise RuntimeError('could not inspect storage mount')
    return result.returncode == 0


def _mounted_image_device():
    source = _run('findmnt', '-n', '-o', 'SOURCE', '--target', MOUNT).stdout.strip()
    devices = _run('losetup', '-j', IMAGE).stdout.splitlines()
    attached = {line.split(':', 1)[0] for line in devices if ':' in line}
    device = source.split('[', 1)[0]
    if device not in attached:
        raise RuntimeError('storage mount does not use the fixed image')
    return device


def _verify_mount():
    if not _path_is_mounted(MOUNT):
        return False
    fields = _run('findmnt', '-n', '-o', 'FSTYPE,OPTIONS', '--target', MOUNT)
    parts = fields.stdout.strip().split(None, 1)
    if len(parts) != 2 or parts[0] != 'ext4':
        raise RuntimeError('storage image mount is not ext4')
    options = set(parts[1].split(','))
    if not {'nodev', 'nosuid', 'noexec'} <= options:
        raise RuntimeError('storage image mount lacks restrictive options')
    _mounted_image_device()
    return True


def _verify_image_file():
    _assert_no_symlink_components(IMAGE)
    info = IMAGE.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != 0:
        raise RuntimeError('storage image is not a root-owned regular file')
    if info.st_mode & 0o077:
        raise RuntimeError('storage image permissions are not private')
    return info


def _ext4_bytes(device):
    result = _run('dumpe2fs', '-h', device)
    text = result.stdout + result.stderr
    blocks = re.search(r'^Block count:\s+(\d+)\s*$', text, re.MULTILINE)
    size = re.search(r'^Block size:\s+(\d+)\s*$', text, re.MULTILINE)
    if not blocks or not size:
        raise RuntimeError('could not read ext4 image capacity')
    return int(blocks.group(1)) * int(size.group(1))


def ensure_image_capacity(quota_bytes, service_uid, service_gid):
    quota_gb_for_bytes(quota_bytes)
    assert_data_root()
    _assert_no_symlink_components(MOUNT)
    MOUNT.mkdir(mode=0o700, exist_ok=True)
    if not MOUNT.is_dir() or MOUNT.resolve(strict=True) != MOUNT:
        raise RuntimeError('storage mount path is not the fixed directory')

    mounted = _verify_mount()
    if not mounted and any(MOUNT.iterdir()):
        raise RuntimeError('storage mountpoint is not empty')

    target_bytes = image_bytes_for_quota(quota_bytes)
    created = False
    opened_identity = None
    grew_image = False
    try:
        if not IMAGE.exists():
            _assert_no_symlink_components(IMAGE.parent)
            flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
            descriptor = os.open(IMAGE, flags, 0o600)
            created = True
            opened_identity = os.fstat(descriptor)
        else:
            info = _verify_image_file()
            filesystem = _run('blkid', '-p', '-s', 'TYPE', '-o', 'value', IMAGE)
            if filesystem.stdout.strip() != 'ext4':
                raise RuntimeError('existing storage image is not ext4')
            if _ext4_bytes(IMAGE) > info.st_size:
                raise RuntimeError('ext4 image is larger than its backing file')
            descriptor = os.open(
                IMAGE,
                os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0),
            )
            opened_identity = os.fstat(descriptor)
            if (opened_identity.st_dev, opened_identity.st_ino) != (info.st_dev, info.st_ino):
                os.close(descriptor)
                raise RuntimeError('storage image changed during validation')

        try:
            image_stat = os.fstat(descriptor)
            current_bytes = image_stat.st_size
            if current_bytes < target_bytes:
                extra = target_bytes - current_bytes
                assert_host_free_floor(extra)
                if not hasattr(os, 'posix_fallocate'):
                    raise RuntimeError('posix_fallocate is required')
                os.posix_fallocate(descriptor, current_bytes, extra)
                grew_image = True
                if shutil.disk_usage(DATA_ROOT).free < HOST_FREE_FLOOR_BYTES:
                    raise RuntimeError('host free-space floor was breached')
            # mkfs discard or a copied sparse image must not over-promise shared disk capacity.
            allocation_bytes = max(current_bytes, target_bytes)
            allocated_bytes = os.fstat(descriptor).st_blocks * 512
            if allocated_bytes < allocation_bytes:
                assert_host_free_floor(allocation_bytes - allocated_bytes)
                os.posix_fallocate(descriptor, 0, allocation_bytes)
                if os.fstat(descriptor).st_blocks * 512 < allocation_bytes:
                    raise RuntimeError('storage image is not physically preallocated')
            os.fchmod(descriptor, 0o600)
            os.fchown(descriptor, 0, 0)
        finally:
            os.close(descriptor)

        if created:
            _run('mkfs.ext4', '-F', '-m', '0', '-E', 'nodiscard', '-L', 'kino-pick-storage', IMAGE)

        if mounted:
            device = _mounted_image_device()
            if grew_image:
                _run('losetup', '-c', device)
            if IMAGE.stat().st_size - _ext4_bytes(device) >= 65536:
                _run('resize2fs', device)
        else:
            if IMAGE.stat().st_size - _ext4_bytes(IMAGE) >= 65536:
                _run('resize2fs', IMAGE)
            _run('mount', '-o', 'loop,nodev,nosuid,noexec', IMAGE, MOUNT)
        if not _verify_mount():
            raise RuntimeError('storage image mount failed verification')
        os.chown(MOUNT, service_uid, service_gid)
        os.chmod(MOUNT, 0o700)
        if shutil.disk_usage(DATA_ROOT).free < HOST_FREE_FLOOR_BYTES:
            raise RuntimeError('host free-space floor is below 20 GB')
        image_bytes = IMAGE.stat().st_size
        stats = os.statvfs(MOUNT)
        filesystem_bytes = stats.f_blocks * stats.f_frsize
        filesystem_available_bytes = stats.f_bavail * stats.f_frsize
        host_free_bytes = shutil.disk_usage(DATA_ROOT).free
        if filesystem_bytes < quota_bytes + FILESYSTEM_HEADROOM_BYTES:
            raise RuntimeError('mounted filesystem capacity is below requested headroom')
        return {
            'imageBytes': image_bytes,
            'maximumQuotaBytes': min(
                maximum_quota_for_image(image_bytes),
                maximum_quota_for_filesystem(filesystem_bytes),
            ),
            'mounted': True,
            'freeBytes': effective_free_bytes(
                host_free_bytes, filesystem_available_bytes
            ),
            'filesystemBytes': filesystem_bytes,
        }
    except Exception:
        if created and not _path_is_mounted(MOUNT) and opened_identity is not None:
            try:
                current = IMAGE.lstat()
                if (current.st_dev, current.st_ino) == (opened_identity.st_dev, opened_identity.st_ino):
                    IMAGE.unlink()
            except FileNotFoundError:
                pass
        raise

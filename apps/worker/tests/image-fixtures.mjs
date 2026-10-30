// Real 1x1 RGBA PNG, decoded by Chromium in the browser upload regression.
export const pngFixture = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJ64KDwHwAAAP//aNVp2wAAAAZJREFUAwAFjgJCwPPv6AAAAABJRU5ErkJggg==',
    'base64',
  );

// Real Chromium-generated and decoded 2x3 JPEG/WebP fixtures.
export const jpegFixture = () =>
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAADAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABwj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCKABi3X//Z',
    'base64',
  );
export const webpFixture = () =>
  Buffer.from(
    'UklGRk4AAABXRUJQVlA4WAoAAAAAAAAAAQAAAgAAVlA4IDAAAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+6tR//NgVzXPv9/+8Z/uM/3Gf+7gAAAA=',
    'base64',
  );

// Deliberately inconsistent raster payload for pre-decode dimension-limit tests.
// The IHDR itself has a correct CRC; this is not a valid large image fixture.
export function pngWithDimensions(width, height) {
  const bytes = pngFixture();
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  return bytes;
}

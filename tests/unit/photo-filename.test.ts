import { expect, it } from 'vitest';
import { photoDisplayName } from '../../apps/web/target-ui/photo-filename';

it('hides only the last extension in photo display names', () => {
  expect(photoDisplayName('DSC_001.JPG')).toBe('DSC_001');
  expect(photoDisplayName('portrait.v2.final.jpg')).toBe('portrait.v2.final');
  expect(photoDisplayName('相片 01.png')).toBe('相片 01');
  expect(photoDisplayName('.hidden')).toBe('.hidden');
  expect(photoDisplayName('untitled')).toBe('untitled');
  expect(photoDisplayName('untitled.')).toBe('untitled.');
});

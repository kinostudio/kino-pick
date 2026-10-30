import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_COORDINATE_SCALE,
  annotationGeometrySchema,
  type AnnotationGeometry,
} from '../../packages/contracts/src/annotation-geometry';

const scale = ANNOTATION_COORDINATE_SCALE;

const point = {
  type: 'point',
  coordinateSpace: 'normalized_1e6',
  x: 120_000,
  y: 340_000,
} satisfies AnnotationGeometry;

const rectangle = {
  type: 'rectangle',
  coordinateSpace: 'normalized_1e6',
  x: 120_000,
  y: 340_000,
  width: 250_000,
  height: 300_000,
} satisfies AnnotationGeometry;

const freehand = {
  type: 'freehand',
  coordinateSpace: 'normalized_1e6',
  version: 1,
  points: [
    { x: 120_000, y: 340_000 },
    { x: 370_000, y: 640_000 },
  ],
} satisfies AnnotationGeometry;

describe('shared annotation geometry contract', () => {
  it('accepts the existing point and rectangle shapes without changing their data', () => {
    expect(annotationGeometrySchema.parse(point)).toEqual(point);
    expect(annotationGeometrySchema.parse(rectangle)).toEqual(rectangle);
  });

  it('accepts a versioned normalized freehand stroke in the shared union', () => {
    expect(annotationGeometrySchema.parse(freehand)).toEqual(freehand);
    expect(
      freehand.points.every(
        ({ x, y }) => x >= 0 && y >= 0 && x <= scale && y <= scale,
      ),
    ).toBe(true);
  });

  it('keeps freehand versioning, strict keys, and point validation fail-closed', () => {
    expect(
      annotationGeometrySchema.safeParse({ ...freehand, version: 2 }).success,
    ).toBe(false);
    expect(
      annotationGeometrySchema.safeParse({ ...freehand, extra: true }).success,
    ).toBe(false);
    expect(
      annotationGeometrySchema.safeParse({
        ...freehand,
        points: [freehand.points[0], freehand.points[0]],
      }).success,
    ).toBe(false);
  });
});

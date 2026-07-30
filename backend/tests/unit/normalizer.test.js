const { normalizeCoordinates } = require('../../lib/figma-builder');

describe('Coordinate Normalizer', () => {
  test('root node stays at parent-relative origin when parent is at 0,0', () => {
    var coords = normalizeCoordinates(150, 200, { x: 0, y: 0 }, false, {});
    expect(coords.x).toBe(150);
    expect(coords.y).toBe(200);
  });

  test('child becomes relative to parent position', () => {
    var coords = normalizeCoordinates(170, 220, { x: 150, y: 200 }, false, {});
    expect(coords.x).toBe(20);
    expect(coords.y).toBe(20);
  });

  test('absolute positioned element inside auto-layout parent uses viewport offset', () => {
    var coords = normalizeCoordinates(170, 220, { x: 150, y: 200 }, true, { position: "absolute" });
    expect(coords.x).toBe(20);
    expect(coords.y).toBe(20);
  });
});

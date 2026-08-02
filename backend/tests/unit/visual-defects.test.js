const { parseLinearGradient, parseCssGradient } = require('../../lib/gradient-parser');
const { flattenStackingContexts } = require('../../lib/stacking-flattener');
const { adjustTextVerticalOffset } = require('../../lib/figma-builder');
const { buildTree, deduplicateWrappers } = require('../../lib/tree-builder');

describe('Visual Defect Fixes', () => {
  test('Gradient parser converts 90deg to Figma handles', () => {
    const result = parseLinearGradient('linear-gradient(90deg, #ff0000 0%, #0000ff 100%)');
    expect(result.type).toBe('GRADIENT_LINEAR');
    expect(result.gradientHandlePositions[0].x).toBeCloseTo(0.5, 1);
    expect(result.gradientHandlePositions[1].x).toBeCloseTo(0.5, 1);
  });

  test('Gradient parser handles stops without explicit positions', () => {
    const result = parseLinearGradient('linear-gradient(#ff0000, #0000ff)');
    expect(result).not.toBeNull();
    expect(result.gradientStops.length).toBe(2);
    expect(result.gradientStops[0].position).toBe(0);
    expect(result.gradientStops[1].position).toBe(1);
  });

  test('Gradient parser handles named colors', () => {
    const result = parseLinearGradient('linear-gradient(to right, red 0%, blue 100%)');
    expect(result).not.toBeNull();
    expect(result.gradientStops[0].color.r).toBe(1);
    expect(result.gradientStops[1].color.b).toBe(1);
    expect(result.gradientStops[0].color.g).toBeCloseTo(0, 1);
  });

  test('parseCssGradient returns [] for non-gradient values', () => {
    expect(parseCssGradient('none')).toEqual([]);
    expect(parseCssGradient('url(foo.png)')).toEqual([]);
  });

  test('Text offset calculates correct Y shift', () => {
    const node = { type: 'TEXT', y: 100, height: 30 };
    const styles = { fontSize: '16px', lineHeight: '24px' };
    const adjusted = adjustTextVerticalOffset(node, styles);
    expect(adjusted.y).toBe(104);
    expect(adjusted.height).toBe(16);
    expect(adjusted.textAlignVertical).toBe('TOP');
  });

  test('Text offset leaves tight line-height text unchanged', () => {
    const node = { type: 'TEXT', y: 100, height: 20 };
    const adjusted = adjustTextVerticalOffset(node, { fontSize: '16px', lineHeight: '16px' });
    expect(adjusted.y).toBe(100);
    expect(adjusted.height).toBe(20);
  });

  test('Stacking flattener promotes high-z children', () => {
    const root = {
      zIndex: 'auto',
      children: [
        { id: 'parent', zIndex: 1, children: [{ id: 'child', zIndex: 999 }] },
      ],
    };
    const result = flattenStackingContexts(root);
    expect(result.promoted.length).toBe(1);
    expect(result.promoted[0].id).toBe('child');
    expect(root.children.map((c) => c.id)).toContain('child');
  });

  test('Stacking flattener leaves low-z children inside parent', () => {
    const root = {
      zIndex: 'auto',
      children: [
        { id: 'parent', zIndex: 1, children: [{ id: 'child', zIndex: 2 }] },
      ],
    };
    const result = flattenStackingContexts(root);
    expect(result.promoted.length).toBe(0);
    expect(root.children.map((c) => c.id)).toEqual(['parent']);
    expect(root.children[0].children.map((c) => c.id)).toEqual(['child']);
  });

  test('Tree builder drops transparent wrappers that duplicate a styled sibling', () => {
    const elements = [
      { id: 1, tag: 'div', cls: 'content', x: 0, y: 0, w: 100, h: 50, props: { 'background-color': '#ffffff' }, attrs: {}, text: 'Hello' },
      { id: 2, tag: 'div', cls: 'wrapper', x: 0, y: 0, w: 100, h: 50, props: {}, attrs: {}, text: '' },
    ];
    const filtered = deduplicateWrappers(elements);
    expect(filtered.map((e) => e.id)).toEqual([1]);
    const tree = buildTree(elements, 100, 100);
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].element.id).toBe(1);
  });

  test('Tree builder keeps two identical-rect empty elements when neither has weight', () => {
    const elements = [
      { id: 1, tag: 'div', x: 0, y: 0, w: 100, h: 50, props: {}, attrs: {}, text: '' },
      { id: 2, tag: 'div', x: 0, y: 0, w: 100, h: 50, props: {}, attrs: {}, text: '' },
    ];
    const filtered = deduplicateWrappers(elements);
    expect(filtered.length).toBe(2);
  });

  test('Tree builder promotes conflicting z-index descendants', () => {
    const elements = [
      { id: 1, tag: 'div', x: 0, y: 0, w: 100, h: 100, props: { 'z-index': '1' }, attrs: {}, text: '' },
      { id: 2, tag: 'div', x: 5, y: 5, w: 50, h: 50, props: { 'z-index': '999' }, attrs: {}, text: '' },
    ];
    const tree = buildTree(elements, 100, 100);
    const childIds = tree.children.map((n) => n.element.id);
    expect(childIds).toEqual([1, 2]);
    expect(tree.children[1]._stackingContext).toBe(999);
  });
});

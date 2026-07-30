const { buildTree } = require('../../lib/tree-builder');

describe('Tree Builder Containment', () => {
  test('correctly nests fully contained child inside parent', () => {
    var elements = [
      { id: 'parent', x: 0, y: 0, w: 100, h: 100, tag: 'div', cls: '', props: {}, attrs: {} },
      { id: 'child', x: 10, y: 10, w: 20, h: 20, tag: 'div', cls: '', props: {}, attrs: {} },
    ];
    var tree = buildTree(elements, 100, 100);
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].element.id).toBe('parent');
    expect(tree.children[0].children.length).toBe(1);
    expect(tree.children[0].children[0].element.id).toBe('child');
  });

  test('nests element by center-point when overlap is small', () => {
    var elements = [
      { id: 'parent', x: 0, y: 0, w: 200, h: 200, tag: 'div', cls: '', props: {}, attrs: {} },
      { id: 'child', x: 10, y: 10, w: 30, h: 30, tag: 'div', cls: '', props: {}, attrs: {} },
    ];
    var tree = buildTree(elements, 200, 200);
    expect(tree.children[0].element.id).toBe('parent');
    expect(tree.children[0].children[0].element.id).toBe('child');
  });

  test('center of child inside parent triggers containment', () => {
    var elements = [
      { id: 'parent', x: 0, y: 0, w: 100, h: 100, tag: 'div', cls: '', props: {}, attrs: {} },
      { id: 'child', x: 1, y: 1, w: 98, h: 98, tag: 'div', cls: '', props: {}, attrs: {} },
    ];
    var tree = buildTree(elements, 100, 100);
    expect(tree.children[0].element.id).toBe('parent');
    expect(tree.children[0].children[0].element.id).toBe('child');
  });
});

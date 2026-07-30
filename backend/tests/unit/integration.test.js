const { buildTree } = require('../../lib/tree-builder');
const { buildDocument } = require('../../lib/figma-builder');
const { shouldEnableAutoLayout } = require('../../lib/layout');

describe('Pipeline Integration', () => {
  test('buildTree produces correct parent-child nesting', () => {
    var elements = [
      { id: 1, tag: 'div', cls: 'container', x: 0, y: 0, w: 500, h: 500, props: {}, attrs: {}, text: '' },
      { id: 2, tag: 'div', cls: 'child', x: 50, y: 50, w: 100, h: 100, props: {}, attrs: {}, text: '' },
    ];
    var tree = buildTree(elements, 500, 500);
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].element.id).toBe(1);
    expect(tree.children[0].children.length).toBe(1);
    expect(tree.children[0].children[0].element.id).toBe(2);
  });

  test('buildDocument returns a graph with root frame', async () => {
    var elements = [
      { id: 1, tag: 'div', cls: 'root', x: 0, y: 0, w: 800, h: 600, props: {}, attrs: {}, text: '' },
    ];
    var tree = buildTree(elements, 800, 600);
    var graph = await buildDocument(tree, 800, 600, 'test', null, null);
    expect(graph).toBeDefined();
    var pages = graph.getPages();
    expect(pages.length).toBeGreaterThan(0);
  });

  test('shouldEnableAutoLayout rejects high-variance children', () => {
    var children = [
      { element: { w: 100, h: 50 } },
      { element: { w: 200, h: 300 } },
      { element: { w: 50, h: 20 } },
    ];
    expect(shouldEnableAutoLayout(children)).toBe(false);
  });

  test('shouldEnableAutoLayout accepts consistent children', () => {
    var children = [
      { element: { w: 100, h: 50 } },
      { element: { w: 102, h: 48 } },
      { element: { w: 98, h: 52 } },
    ];
    expect(shouldEnableAutoLayout(children)).toBe(true);
  });
});

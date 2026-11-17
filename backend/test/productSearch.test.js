import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductWhere } from '../src/lib/productSearch.js';

test('no search term returns only the active condition', () => {
  assert.deepEqual(buildProductWhere(undefined), { active: true });
  assert.deepEqual(buildProductWhere('   '), { active: true });
});

test('a search term matches the name or the description', () => {
  const where = buildProductWhere('  privacy ');
  assert.equal(where.active, true);
  assert.equal(where.OR.length, 2);
  assert.deepEqual(where.OR[0], { name: { contains: 'privacy', mode: 'insensitive' } });
  assert.deepEqual(where.OR[1], { description: { contains: 'privacy', mode: 'insensitive' } });
});

test('a repeated search parameter (array) is ignored, not a crash', () => {
  assert.deepEqual(buildProductWhere(['a', 'b']), { active: true });
});

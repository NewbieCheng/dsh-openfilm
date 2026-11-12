import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandCssVars, getBrand, replaceTitle, validateBrand } from '../src/brand.mjs';

const RAW = Object.freeze({
  name: '不加班剪辑',
  nameEn: 'No996 Studio',
  slug: 'no996-studio',
  vendor: '不加班',
  tagline: '把一句话剪成一支片',
  colors: { accent: '#FF6400', accentDeep: '#d84700', paper: '#f5f0e5', ink: '#18171c', night: '#051d43' },
  links: { home: 'https://bujiaban.top' },
  upstream: { name: 'OpenFilm', version: '0.3.2', license: 'MIT', notice: '保留上游版权与商标声明。' },
});

test('the repository brand file is valid and frozen', () => {
  const brand = getBrand();
  assert.equal(brand.name, '不加班剪辑');
  assert.equal(brand.nameEn, 'No996 Studio');
  assert.equal(brand.upstream.name, 'OpenFilm');
  assert.ok(Object.isFrozen(brand));
  assert.ok(Object.isFrozen(brand.colors));
});

test('colours are normalised and required tokens are present', () => {
  const brand = validateBrand(structuredClone(RAW));
  assert.equal(brand.colors.accent, '#ff6400');
  assert.throws(() => validateBrand({ ...structuredClone(RAW), colors: { accent: 'orange' } }), /colors\.accent/);
  assert.throws(() => validateBrand({ ...structuredClone(RAW), colors: { ink: '#18171c' } }), /colors\.accent is required/);
});

test('attribution cannot be dropped while rebranding', () => {
  const missing = structuredClone(RAW);
  delete missing.upstream;
  assert.throws(() => validateBrand(missing), /upstream attribution is required/);
});

test('names and slug stay in the shapes CSS and URLs can carry', () => {
  assert.throws(() => validateBrand({ ...structuredClone(RAW), slug: 'No996 Studio' }), /kebab-case/);
  assert.throws(() => validateBrand({ ...structuredClone(RAW), name: '' }), /name must be/);
  assert.throws(() => validateBrand({ ...structuredClone(RAW), name: 'x'.repeat(25) }), /name must be/);
});

test('every brand colour becomes a custom property', () => {
  const css = brandCssVars(validateBrand(structuredClone(RAW)));
  for (const [key, value] of Object.entries(RAW.colors)) {
    assert.match(css, new RegExp(`--n996-${key}: ${value.toLowerCase()}`));
  }
  assert.match(css, /--n996-font:/);
});

test('the upstream document title is replaced, not appended', () => {
  assert.equal(replaceTitle('<html><head><title>OpenFilm</title></head></html>', getBrand()), '<html><head><title>不加班剪辑</title></head></html>');
  assert.equal(replaceTitle('<html><head></head></html>', getBrand()), '<html><head></head></html>');
  const escaped = replaceTitle('<title>x</title>', validateBrand({ ...structuredClone(RAW), name: 'A<B' }));
  assert.match(escaped, /<title>A&lt;B<\/title>/);
});

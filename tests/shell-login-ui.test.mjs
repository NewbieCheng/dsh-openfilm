import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../assets/shell-login.js', import.meta.url), 'utf8');

test('the login page paints a day/night sky from the timeline', () => {
  assert.match(js, /lg-sky/);
  assert.match(js, /function paintSky\(v\)/);
  assert.match(js, /function mixLayers\(layers\)/);
  assert.match(js, /sky\.style\.background=css/);
  assert.match(js, /setOpacity\(skyStars,night\*\.85\)/);
  // 天色只在 p 前进时改变，暂停后必须冻结在同一时刻。
  assert.match(js, /paintSky\(p\)/);
});

test('the city background is throttled and stops when the page is hidden', () => {
  assert.match(js, /CITY_INTERVAL=33/);
  assert.match(js, /document\.hidden/);
  assert.match(js, /now-lastCityAt>=CITY_INTERVAL/);
  assert.match(js, /CITY_SPEED=\.2/);
});

test('the timeline moves the playhead with transform and writes text on change', () => {
  assert.match(js, /playhead\.style\.transform='translateX\('/);
  assert.match(js, /if\(m!==lastMinute\)/);
  assert.match(js, /if\(st!==lastSeg\)/);
});

test('the sun sets and becomes the moon', () => {
  assert.match(js, /function paintOrb\(v\)/);
  assert.match(js, /var x=82-68\*v/);
  assert.match(js, /querySelector\('#nof-sun'\)/);
  assert.match(js, /setOpacity\(orbMoon,smooth\(\.93,\.99,v\)\)/);
});

test('pausing and reduced motion still stop the clock', () => {
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /playing=!reduced/);
  assert.match(js, /setPlaying\(!playing\)/);
});

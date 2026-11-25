import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLanguage,
  detectTextDirection,
  getSpeechLocale,
  splitSubtitleSegments,
} from './language';

test('detectLanguage identifies Persian and English accurately', () => {
  assert.equal(detectLanguage('سلام، حالت چطوره؟'), 'fa');
  assert.equal(detectLanguage('Hello, how are you today?'), 'en');
  // Mixed Persian with an English term remains Persian RTL
  assert.equal(detectLanguage('لطفاً مدل GLB جدید را بارگذاری کن'), 'fa');
  assert.equal(detectLanguage('   ', 'fa'), 'fa');
  assert.equal(detectLanguage('12345', 'en'), 'en');
});

test('detectTextDirection and getSpeechLocale map correctly', () => {
  assert.equal(detectTextDirection('سلام دنیا'), 'rtl');
  assert.equal(detectTextDirection('Hello world'), 'ltr');
  assert.equal(getSpeechLocale('fa'), 'fa-IR');
  assert.equal(getSpeechLocale('en'), 'en-US');
});

test('splitSubtitleSegments keeps short text intact and wraps long text cleanly', () => {
  assert.deepEqual(splitSubtitleSegments('Short luminous greeting.'), ['Short luminous greeting.']);

  const longText =
    'Welcome to the holographic interface. You can upload any upper-body 3D model and speak naturally in Persian or English at any time.';
  const segments = splitSubtitleSegments(longText, 75);
  assert.ok(segments.length >= 2);
  for (const seg of segments) {
    assert.ok(seg.length <= 75, `Segment too long: ${seg.length}`);
  }
});

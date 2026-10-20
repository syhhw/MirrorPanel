import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardToRestore } from '../src/session';

const ours = 'com.mirrorpanel.companion/.MirrorInput';
const gboard = 'com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME';

test("the person's own keyboard is the one given back", () => {
  assert.equal(keyboardToRestore(gboard, [gboard, ours], ours), gboard);
});

test('a keyboard left selected by a session that lost the phone is not taken as the choice', () => {
  assert.equal(keyboardToRestore(ours, [gboard, ours], ours), gboard);
  assert.equal(keyboardToRestore(ours, [ours, '', gboard], ours), gboard);
  // With no other keyboard enabled there is nothing better to give back.
  assert.equal(keyboardToRestore(ours, [ours], ours), ours);
});

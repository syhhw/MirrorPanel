import assert from 'node:assert/strict';
import test from 'node:test';
import { html } from '../src/html';

test('line breaks next to tags and at the template edges disappear', () => {
  const name = 'Moto';
  assert.equal(
    html`
      <label>
        ${name}
        <input name="name">
      </label>
    `,
    '<label>Moto<input name="name"></label>',
  );
});

test('line breaks between words or attributes become one space', () => {
  assert.equal(
    html`
      <button type="button"
        class="danger">Parar
        espelhamento</button>
    `,
    '<button type="button" class="danger">Parar espelhamento</button>',
  );
  const disabled = 'disabled';
  assert.equal(
    html`
      <button data-tool="wifi"
        ${disabled}>Wi-Fi</button>
    `,
    '<button data-tool="wifi" disabled>Wi-Fi</button>',
  );
});

test('same-line spaces and interpolated values are kept exactly', () => {
  const icon = '<svg>\n</svg>';
  assert.equal(
    html`<span></span> <select>${icon} ${'a\nb'}</select>`,
    '<span></span> <select><svg>\n</svg> a\nb</select>',
  );
  assert.equal(html`<b>${0}</b>${''}`, '<b>0</b>');
});

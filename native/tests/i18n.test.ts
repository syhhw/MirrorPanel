import assert from 'node:assert/strict';
import test from 'node:test';
import { language, setLanguage, t } from '../src/i18n';
import { validateControl } from '../src/protocol';

test('texts follow the interface language, Portuguese by default', () => {
  assert.equal(language(), 'pt');
  assert.equal(t('Sim', 'Yes'), 'Sim');
  setLanguage('en');
  assert.equal(t('Sim', 'Yes'), 'Yes');
  setLanguage('pt');
});

test('main-process errors are raised in the interface language', () => {
  setLanguage('en');
  assert.throws(() => validateControl(null), /^Error: Invalid control$/);
  setLanguage('pt');
  assert.throws(() => validateControl(null), /^Error: Controle inválido$/);
});

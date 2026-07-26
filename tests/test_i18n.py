"""Testes do sistema de traducao - troca de idioma, formatacao e integridade
do dicionario (toda chave usada na interface precisa existir de verdade)."""
import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mirrorpanel import i18n

PROJECT_ROOT = Path(__file__).resolve().parent.parent


class TranslationTest(unittest.TestCase):
    def setUp(self):
        self._original_lang = i18n.get_language()

    def tearDown(self):
        i18n.set_language(self._original_lang)

    def test_pt_and_en_differ_for_known_key(self):
        i18n.set_language("pt")
        pt_text = i18n.t("btn.cancel")
        i18n.set_language("en")
        en_text = i18n.t("btn.cancel")
        self.assertEqual(pt_text, "Cancelar")
        self.assertEqual(en_text, "Cancel")
        self.assertNotEqual(pt_text, en_text)

    def test_placeholder_formatting(self):
        i18n.set_language("pt")
        self.assertIn("5", i18n.t("app.summary", n=5))

    def test_unknown_key_returns_key_itself_not_crash(self):
        self.assertEqual(i18n.t("chave.que.nao.existe"), "chave.que.nao.existe")

    def test_invalid_language_is_ignored(self):
        i18n.set_language("pt")
        i18n.set_language("klingon")
        self.assertEqual(i18n.get_language(), "pt")

    def test_init_language_uses_saved_value(self):
        i18n.init_language("en")
        self.assertEqual(i18n.get_language(), "en")

    def test_init_language_falls_back_to_detection_when_unsaved(self):
        i18n.init_language(None)
        self.assertIn(i18n.get_language(), i18n.LANGUAGES)

    def test_every_dictionary_key_has_both_languages(self):
        missing = [(key, lang) for key, entry in i18n._STRINGS.items()
                   for lang in i18n.LANGUAGES if lang not in entry]
        self.assertEqual(missing, [], f"chaves sem traducao para algum idioma: {missing}")


class PanelUsesOnlyRealKeysTest(unittest.TestCase):
    """Varre panel.py atras de toda chamada t("chave") e confere que ela
    existe de verdade no dicionario - pega chave digitada errada ou esquecida
    sem precisar abrir a interface manualmente pra notar que o texto sumiu."""

    def test_all_translation_keys_used_in_panel_exist(self):
        source = (PROJECT_ROOT / "mirrorpanel" / "panel.py").read_text(encoding="utf-8")
        # \b antes do "t" e essencial - sem isso, "insert(", "get(", "int(" etc
        # tambem "combinam" (a busca acha o "t(" no fim desses nomes), gerando
        # um monte de falso positivo que nao tem nada a ver com i18n.t(...)
        used_keys = set(re.findall(r'\bt\("([a-zA-Z0-9_.]+)"', source))
        self.assertTrue(used_keys, "nao achei nenhuma chamada a t(...) em panel.py - regex desatualizada?")
        missing = sorted(k for k in used_keys if k not in i18n._STRINGS)
        self.assertEqual(missing, [], f"panel.py usa chaves que nao existem em i18n.py: {missing}")


if __name__ == "__main__":
    unittest.main()

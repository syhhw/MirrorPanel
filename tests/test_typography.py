"""Contrato de carregamento privado das fontes empacotadas no Windows."""

import unittest
from unittest.mock import MagicMock, patch

from mirrorpanel import typography


class PrivateFontTest(unittest.TestCase):
    def setUp(self):
        typography.load_font_family.cache_clear()

    def tearDown(self):
        typography.load_font_family.cache_clear()

    def test_both_fonts_are_loaded_once_with_private_flag(self):
        gdi = MagicMock()
        gdi.AddFontResourceExW.return_value = 1
        with patch.object(typography.ctypes.windll, "gdi32", gdi):
            self.assertEqual(typography.load_font_family(), "Inter")
            self.assertEqual(typography.load_font_family(), "Inter")
        self.assertEqual(gdi.AddFontResourceExW.call_count, 2)
        for call in gdi.AddFontResourceExW.call_args_list:
            self.assertEqual(call.args[1:], (0x10, None))
        gdi.RemoveFontResourceExW.assert_not_called()

    def test_partial_failure_unloads_regular_font_and_uses_fallback(self):
        gdi = MagicMock()
        gdi.AddFontResourceExW.side_effect = [1, 0]
        with patch.object(typography.ctypes.windll, "gdi32", gdi):
            self.assertEqual(typography.load_font_family(), "Segoe UI")
        gdi.RemoveFontResourceExW.assert_called_once_with(
            str(typography.FONT_DIR / "Inter-Regular.otf"), 0x10, None)

    def test_missing_font_uses_fallback_without_loading_any_resource(self):
        gdi = MagicMock()
        with patch.object(typography.ctypes.windll, "gdi32", gdi), \
                patch.object(typography.Path, "is_file", return_value=False):
            self.assertEqual(typography.load_font_family(), "Segoe UI")
        gdi.AddFontResourceExW.assert_not_called()


if __name__ == "__main__":
    unittest.main()

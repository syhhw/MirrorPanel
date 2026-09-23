"""Verifica a fonte realmente resolvida pelo Tk no Windows."""
import tkinter as tk
import unittest
from tkinter import font as tkfont

from mirrorpanel import typography


class NativeTypographyTest(unittest.TestCase):
    def test_ui_font_resolves_to_native_windows_family(self):
        root = tk.Tk()
        root.withdraw()
        try:
            font = tkfont.Font(root=root, family=typography.load_font_family(), size=10)
            self.assertEqual(font.actual()['family'], 'Segoe UI')
            self.assertGreater(font.measure('Configurações'), 0)
        finally:
            root.destroy()


if __name__ == '__main__':
    unittest.main()

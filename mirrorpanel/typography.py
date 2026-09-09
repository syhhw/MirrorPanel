"""Fontes privadas do aplicativo; nao altera as fontes instaladas no Windows."""

import ctypes
import logging
import sys
from functools import cache
from pathlib import Path

FONT_DIR = Path(__file__).resolve().parent / "assets" / "fonts"
FR_PRIVATE = 0x10
logger = logging.getLogger(__name__)


@cache
def load_font_family() -> str:
    """Carrega Inter antes de criar o Tk, inclusive no pacote PyInstaller.

    O Windows libera os recursos privados ao encerrar o processo. Se algum
    arquivo faltar, desfaz o carregamento parcial e usa a fonte do sistema.
    """
    fallback = "Segoe UI"
    if sys.platform != "win32":
        return fallback

    gdi = ctypes.windll.gdi32
    add = gdi.AddFontResourceExW
    remove = gdi.RemoveFontResourceExW
    for function in (add, remove):
        function.argtypes = [ctypes.c_wchar_p, ctypes.c_uint, ctypes.c_void_p]
        function.restype = ctypes.c_int

    loaded = []
    for filename in ("Inter-Regular.otf", "Inter-Bold.otf"):
        path = FONT_DIR / filename
        if not path.is_file() or not add(str(path), FR_PRIVATE, None):
            for previous in loaded:
                remove(str(previous), FR_PRIVATE, None)
            logger.warning("Fonte Inter indisponivel; usando %s", fallback)
            return fallback
        loaded.append(path)
    return "Inter"

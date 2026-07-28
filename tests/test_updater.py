"""Testes de logica pura do updater - mocka requests, nunca toca a rede de verdade."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mirrorpanel import updater


class ParseVersionTest(unittest.TestCase):
    def test_simple(self):
        self.assertEqual(updater._parse_version("v1.2.3"), (1, 2, 3))

    def test_with_build_suffix(self):
        self.assertEqual(updater._parse_version("1.0.0-4"), (1, 0, 0, 4))

    def test_empty(self):
        self.assertEqual(updater._parse_version(""), (0,))

    def test_none(self):
        self.assertEqual(updater._parse_version(None), (0,))

    def test_minor_bump_beats_build_suffix(self):
        # 1.1.0 tem que contar como mais novo que 1.0.0-4, mesmo tendo menos
        # digitos no total - foi exatamente essa comparacao que decidiu ir de
        # "1.0.0-N" pra "1.1.0" sem quebrar quem ja tinha uma build antiga.
        self.assertGreater(updater._parse_version("1.1.0"), updater._parse_version("1.0.0-4"))

    def test_build_suffix_beats_bare_version(self):
        self.assertGreater(updater._parse_version("1.0.0-1"), updater._parse_version("1.0.0"))


class ExtractNotesForLanguageTest(unittest.TestCase):
    """As notas de uma release do GitHub podem trazer pt e en juntas, separadas
    por marcadores [pt]/[en] - a interface mostra so a secao do idioma atual
    do app (ver UpdateDialog em panel.py). updater.py recebe o idioma como
    parametro explicito, nunca importa i18n.py (motor/updater nao sabem de
    idioma sozinhos - so dividem o texto que ja veio pronto)."""

    def test_extracts_requested_language_section(self):
        body = "[pt]\nCorrigido o bug X.\n\n[en]\nFixed bug X.\n"
        self.assertEqual(updater.extract_notes_for_language(body, "pt"), "Corrigido o bug X.")
        self.assertEqual(updater.extract_notes_for_language(body, "en"), "Fixed bug X.")

    def test_language_section_order_does_not_matter(self):
        body = "[en]\nFixed bug X.\n\n[pt]\nCorrigido o bug X.\n"
        self.assertEqual(updater.extract_notes_for_language(body, "pt"), "Corrigido o bug X.")
        self.assertEqual(updater.extract_notes_for_language(body, "en"), "Fixed bug X.")

    def test_no_marker_returns_whole_body_unfiltered(self):
        """Releases antigas (lancadas antes dessa convencao) nao tem marcador
        nenhum - tem que continuar mostrando a nota inteira, nao sumir com ela."""
        body = "- Corrigido o bug X.\n- Nova funcionalidade Y.\n"
        self.assertEqual(updater.extract_notes_for_language(body, "en"), body.strip())

    def test_missing_language_falls_back_to_whole_body(self):
        """So tem [pt] escrito (esquecimento, ou release antiga parcialmente
        migrada) - pedir "en" nao pode dar um texto vazio/quebrado."""
        body = "[pt]\nCorrigido o bug X.\n"
        self.assertEqual(updater.extract_notes_for_language(body, "en"), body.strip())


class CheckForUpdateDetailedTest(unittest.TestCase):
    def _mock_response(self, json_data):
        resp = MagicMock()
        resp.json.return_value = json_data
        resp.raise_for_status.return_value = None
        return resp

    @patch("mirrorpanel.updater.requests.get")
    def test_update_available(self, mock_get):
        mock_get.return_value = self._mock_response({
            "tag_name": "v99.0.0",
            "body": "novidades",
            "assets": [{"name": "MirrorPanel-Setup.exe", "browser_download_url": "http://x/y.exe", "size": 12345}],
        })
        with patch("mirrorpanel.updater.APP_VERSION", "1.0.0"):
            result = updater.check_for_update_detailed()
        self.assertEqual(result["status"], "update")
        self.assertEqual(result["info"]["version"], "v99.0.0")
        self.assertEqual(result["info"]["size"], 12345)

    @patch("mirrorpanel.updater.requests.get")
    def test_already_current(self, mock_get):
        mock_get.return_value = self._mock_response({"tag_name": "v0.0.1", "assets": []})
        with patch("mirrorpanel.updater.APP_VERSION", "99.0.0"):
            result = updater.check_for_update_detailed()
        self.assertEqual(result["status"], "current")
        self.assertIsNone(result["info"])

    @patch("mirrorpanel.updater.requests.get")
    def test_network_failure_is_swallowed_not_raised(self, mock_get):
        mock_get.side_effect = Exception("sem internet")
        result = updater.check_for_update_detailed()
        self.assertEqual(result["status"], "error")
        self.assertIsNone(result["info"])

    @patch("mirrorpanel.updater.requests.get")
    def test_no_exe_asset_is_error(self, mock_get):
        mock_get.return_value = self._mock_response({
            "tag_name": "v99.0.0", "assets": [{"name": "readme.txt", "browser_download_url": "http://x"}],
        })
        with patch("mirrorpanel.updater.APP_VERSION", "1.0.0"):
            result = updater.check_for_update_detailed()
        self.assertEqual(result["status"], "error")

    @patch("mirrorpanel.updater.requests.get")
    def test_missing_tag_is_error(self, mock_get):
        mock_get.return_value = self._mock_response({"assets": []})
        result = updater.check_for_update_detailed()
        self.assertEqual(result["status"], "error")


class DownloadUpdateTest(unittest.TestCase):
    """O download passou a conferir o tamanho informado pela API contra o que
    realmente chegou - antes, um download truncado (conexao caiu no meio)
    virava "sucesso" so por nao ter lancado excecao."""

    @patch("mirrorpanel.updater.requests.get")
    def test_size_mismatch_fails_and_deletes_partial_file(self, mock_get):
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.headers = {}
        resp.iter_content.return_value = [b"so uns bytes"]
        mock_get.return_value.__enter__.return_value = resp

        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "out.exe")
            ok = updater.download_update("http://x/y.exe", dest, expected_size=999999)
            self.assertFalse(ok)
            self.assertFalse(os.path.exists(dest))

    @patch("mirrorpanel.updater.requests.get")
    def test_matching_size_succeeds(self, mock_get):
        payload = b"x" * 100
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.headers = {}
        resp.iter_content.return_value = [payload]
        mock_get.return_value.__enter__.return_value = resp

        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "out.exe")
            ok = updater.download_update("http://x/y.exe", dest, expected_size=len(payload))
            self.assertTrue(ok)
            with open(dest, "rb") as f:
                self.assertEqual(f.read(), payload)

    @patch("mirrorpanel.updater.requests.get")
    def test_no_expected_size_skips_check(self, mock_get):
        """Se a API nao informou tamanho nenhum (expected_size=0), nao ha o
        que conferir - continua funcionando como antes."""
        payload = b"qualquer coisa"
        resp = MagicMock()
        resp.raise_for_status.return_value = None
        resp.headers = {}
        resp.iter_content.return_value = [payload]
        mock_get.return_value.__enter__.return_value = resp

        with tempfile.TemporaryDirectory() as tmp:
            dest = os.path.join(tmp, "out.exe")
            ok = updater.download_update("http://x/y.exe", dest, expected_size=0)
            self.assertTrue(ok)


class ApplyUpdateAndRestartTest(unittest.TestCase):
    """apply_update_and_restart devolve (chave_i18n, parametros) - nao mais uma
    string pronta - pra quem chamou (panel.py) traduzir, ja que este modulo nao
    sabe de idioma nenhum. So os caminhos de ERRO sao testados aqui: o caminho
    de sucesso encerra o processo com os._exit(0), que mataria o proprio
    executor de testes."""

    def test_missing_installer_returns_error_tuple(self):
        result = updater.apply_update_and_restart("C:/nao/existe/instalador.exe")
        self.assertEqual(result, ("error.installer_missing", {"path": "C:/nao/existe/instalador.exe"}))

    def test_installer_too_small_returns_error_tuple(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = os.path.join(tmp, "fake.exe")
            with open(fake, "wb") as f:
                f.write(b"x" * 100)  # bem menor que 1 MB - nao e um instalador de verdade
            result = updater.apply_update_and_restart(fake)
        self.assertEqual(result[0], "error.installer_missing")

    @patch("mirrorpanel.updater.subprocess.Popen")
    def test_popen_failure_returns_error_tuple(self, mock_popen):
        mock_popen.side_effect = OSError("arquivo nao executavel")
        with tempfile.TemporaryDirectory() as tmp:
            fake = os.path.join(tmp, "fake.exe")
            with open(fake, "wb") as f:
                f.write(b"x" * 2_000_000)  # passa da checagem de tamanho minimo
            result = updater.apply_update_and_restart(fake)
        self.assertEqual(result[0], "error.installer_start_failed")
        self.assertIn("arquivo nao executavel", result[1]["error"])

    @patch("mirrorpanel.updater.time.sleep")
    @patch("mirrorpanel.updater.subprocess.Popen")
    def test_installer_immediate_nonzero_exit_returns_error_tuple(self, mock_popen, mock_sleep):
        proc = MagicMock()
        proc.poll.return_value = 1
        proc.returncode = 1
        mock_popen.return_value = proc
        with tempfile.TemporaryDirectory() as tmp:
            fake = os.path.join(tmp, "fake.exe")
            with open(fake, "wb") as f:
                f.write(b"x" * 2_000_000)
            result = updater.apply_update_and_restart(fake)
        self.assertEqual(result, ("error.installer_exited", {"code": 1}))
        mock_sleep.assert_called_once()


if __name__ == "__main__":
    unittest.main()

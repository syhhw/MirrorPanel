"""Testes de logica pura do mirror_engine - sem celular real, sem rede.

Roda com: python -m unittest discover -s tests   (a partir da raiz do projeto)
"""
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import mirror_engine as engine


class SlotManagerTest(unittest.TestCase):
    def test_single_device_fills_whole_width(self):
        sm = engine.SlotManager(0, 0, 1920, 1080)
        slot = sm.acquire()
        self.assertEqual(sm.rect_for(slot), (0, 0, 1920, 1080))

    def test_ensure_capacity_grows_before_batch(self):
        sm = engine.SlotManager(0, 0, 1920, 1080)
        sm.ensure_capacity(3)
        self.assertEqual(sm.cols, 3)

    def test_ensure_capacity_never_shrinks(self):
        sm = engine.SlotManager(0, 0, 1920, 1080)
        sm.ensure_capacity(4)
        sm.ensure_capacity(1)
        self.assertEqual(sm.cols, 4)

    def test_release_shrinks_grid_to_fit_survivors(self):
        """Regressao do bug: sobrevivente ficava 'espremido' num tamanho de
        coluna antigo mesmo depois dos outros aparelhos fecharem."""
        sm = engine.SlotManager(0, 0, 1920, 1080)
        sm.ensure_capacity(4)
        slots = [sm.acquire() for _ in range(4)]
        for s in slots[1:]:
            sm.release(s)
        self.assertEqual(sm.cols, 1)
        self.assertEqual(sm.rect_for(slots[0]), (0, 0, 1920, 1080))

    def test_release_to_empty_keeps_at_least_one_column(self):
        sm = engine.SlotManager(0, 0, 1920, 1080)
        slot = sm.acquire()
        sm.release(slot)
        self.assertEqual(sm.cols, 1)

    def test_acquire_grows_grid_when_full(self):
        sm = engine.SlotManager(0, 0, 1920, 1080)
        sm.acquire()
        sm.acquire()
        self.assertEqual(sm.cols, 2)

    def test_slots_never_collide(self):
        sm = engine.SlotManager(0, 0, 1920, 1080)
        sm.ensure_capacity(3)
        slots = [sm.acquire() for _ in range(3)]
        self.assertEqual(len(set(slots)), 3)


class BuildFlagsTest(unittest.TestCase):
    def test_default_settings(self):
        flags = engine.build_flags({})
        self.assertIn("--video-codec=h264", flags)
        self.assertIn("-b 8M", flags)
        self.assertIn("--max-fps 60", flags)
        self.assertIn("--audio-codec=opus", flags)

    def test_audio_disabled(self):
        flags = engine.build_flags({"audio": False})
        self.assertIn("--no-audio", flags)
        self.assertNotIn("--audio-codec", flags)

    def test_custom_codec_and_bitrate(self):
        flags = engine.build_flags({"video_codec": "h265", "bitrate": "16M", "max_fps": 90})
        self.assertIn("--video-codec=h265", flags)
        self.assertIn("-b 16M", flags)
        self.assertIn("--max-fps 90", flags)



class ApkLogScanTest(unittest.TestCase):
    """O scrcpy instala APK via arrastar-e-soltar sozinho (recurso nativo dele)
    e escreve o progresso no proprio log - essas expressoes que reconhecem
    essas linhas sao a unica logica "nossa" nesse fluxo, entao sao o que
    precisa de teste automatizado (o resto e o scrcpy fazendo o trabalho)."""

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.log_path = Path(self.tmpdir.name) / "fake_scrcpy.log"
        self.log_path.write_text("", encoding="utf-8")
        # __new__ (sem __init__): esse metodo so usa "dev", nao precisa de adb
        # nem de monitores de verdade pra rodar
        self.mgr = engine.MirrorManager.__new__(engine.MirrorManager)

    def tearDown(self):
        self.tmpdir.cleanup()

    def _dev(self):
        return engine.ActiveDevice(
            proc=None, log_fh=None, model="TestPhone", port=1, slot=0,
            started_at=time.monotonic(), log_path=self.log_path, log_read_pos=0,
        )

    def _append(self, text):
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(text)

    def test_full_success_flow(self):
        dev = self._dev()
        self._append("INFO: Pushing app.apk...\n"
                      "INFO: Installing app.apk...\n"
                      "INFO: app.apk successfully installed\n")
        events = self.mgr._scan_apk_events(dev)
        self.assertEqual([e["type"] for e in events], ["apk_pushing", "apk_installing", "apk_installed"])
        self.assertTrue(all(e["name"] == "app.apk" for e in events))
        self.assertTrue(all(e["model"] == "TestPhone" for e in events))

    def test_no_duplicate_events_on_rescan(self):
        dev = self._dev()
        self._append("INFO: Pushing app.apk...\n")
        self.mgr._scan_apk_events(dev)
        self.assertEqual(self.mgr._scan_apk_events(dev), [])

    def test_only_new_lines_are_picked_up(self):
        dev = self._dev()
        self._append("INFO: Pushing first.apk...\n")
        first = self.mgr._scan_apk_events(dev)
        self._append("INFO: Pushing second.apk...\n")
        second = self.mgr._scan_apk_events(dev)
        self.assertEqual(first[0]["name"], "first.apk")
        self.assertEqual(second[0]["name"], "second.apk")

    def test_install_failure(self):
        dev = self._dev()
        self._append("ERROR: Failed to install app.apk\n")
        events = self.mgr._scan_apk_events(dev)
        self.assertEqual(events, [{"type": "apk_install_failed", "model": "TestPhone", "name": "app.apk"}])

    def test_generic_file_push_failure(self):
        dev = self._dev()
        self._append("ERROR: Failed to push photo.png to /sdcard/Download/photo.png\n")
        events = self.mgr._scan_apk_events(dev)
        self.assertEqual(events, [{"type": "apk_push_failed", "model": "TestPhone", "name": "photo.png"}])

    def test_extracts_basename_from_path(self):
        dev = self._dev()
        self._append("INFO: Installing C:/Users/test/Downloads/meuapp.apk...\n")
        events = self.mgr._scan_apk_events(dev)
        self.assertEqual(events[0]["name"], "meuapp.apk")

    def test_unrelated_log_lines_are_ignored(self):
        dev = self._dev()
        self._append("INFO: Renderer: direct3d11\nINFO: Texture: 1080x2340\n")
        self.assertEqual(self.mgr._scan_apk_events(dev), [])


class ClosedByUserVsCrashTest(unittest.TestCase):
    """Regressao de um bug relatado ao vivo (com print de tela): fechar a janela
    do scrcpy pelo proprio X (fora do painel) fazia o motor tratar isso como um
    crash e tentar reconectar sozinho - abrindo a janela de novo toda vez que o
    usuario fechava de proposito, num loop infinito de fechar-e-reabrir. O scrcpy
    documenta codigo de saida 0 como termino normal (WM_CLOSE); qualquer outro
    codigo e um crash de verdade. Ver tick() em mirror_engine.py."""

    def setUp(self):
        self.mgr = engine.MirrorManager.__new__(engine.MirrorManager)
        self.mgr.crash_counts = {}
        self.mgr.blocked = set()
        self.mgr.pending_reconnect = {}
        self.mgr.model_cache = {"SERIAL1": "TestPhone"}
        self.mgr.hw_serial_cache = {"SERIAL1": "SERIAL1"}  # evita chamada real de adb no dedupe
        self.mgr.last_ready = {"SERIAL1"}
        self.mgr.last_problems = {}
        self.mgr.used_ports = set()
        self.mgr.poll_count = 0
        self.mgr.wifi_devices = []

        sm = engine.SlotManager(0, 0, 1920, 1080)
        slot = sm.acquire()
        self.mgr.slot_managers = [sm]

        self.tmpdir = tempfile.TemporaryDirectory()
        log_path = Path(self.tmpdir.name) / "fake_scrcpy.log"
        log_path.write_text("", encoding="utf-8")

        self.fake_proc = MagicMock()
        self.dev = engine.ActiveDevice(
            proc=self.fake_proc, log_fh=MagicMock(), model="TestPhone", port=5001, slot=slot,
            started_at=time.monotonic(), log_path=log_path, log_read_pos=0, monitor_idx=0,
        )
        self.mgr.active = {"SERIAL1": self.dev}

    def tearDown(self):
        self.tmpdir.cleanup()

    def _tick_with_device_still_plugged_in(self):
        # "device" = aparelho continua conectado no adb - so o PROCESSO do
        # scrcpy que saiu sozinho, exatamente o cenario do bug relatado.
        # start_device tambem e mockado: um crash de verdade dispara uma
        # tentativa de reconexao silenciosa JA dentro do mesmo tick(), e essa
        # tentativa lancaria um processo scrcpy de verdade se nao fosse isso.
        with patch.object(engine, "list_devices", return_value={"SERIAL1": "device"}), \
                patch.object(self.mgr, "start_device", return_value=False):
            return self.mgr.tick()

    def test_exit_code_zero_is_treated_as_deliberate_close(self):
        self.fake_proc.poll.return_value = 0
        events = self._tick_with_device_still_plugged_in()
        self.assertEqual([e["type"] for e in events], ["closed_by_user"])
        self.assertEqual(events[0], {"type": "closed_by_user", "serial": "SERIAL1", "model": "TestPhone"})
        self.assertNotIn("SERIAL1", self.mgr.active)
        # o cerne do bug: nao pode entrar na fila de reconexao automatica
        self.assertNotIn("SERIAL1", self.mgr.pending_reconnect)

    def test_nonzero_exit_code_is_still_treated_as_a_real_crash(self):
        self.fake_proc.poll.return_value = 1
        events = self._tick_with_device_still_plugged_in()
        # crash de verdade nao avisa na hora - tenta reconectar em silencio primeiro
        self.assertEqual(events, [])
        self.assertIn("SERIAL1", self.mgr.pending_reconnect)
        self.assertEqual(self.mgr.pending_reconnect["SERIAL1"]["kind"], "crashed")

    def test_process_still_running_is_left_untouched(self):
        self.fake_proc.poll.return_value = None
        events = self._tick_with_device_still_plugged_in()
        self.assertEqual(events, [])
        self.assertIn("SERIAL1", self.mgr.active)
        self.assertEqual(self.mgr.pending_reconnect, {})


class ApplyInstallerLanguageMarkerTest(unittest.TestCase):
    """Regressao: o instalador grava um marcador com o idioma escolhido na
    propria tela dele TODA vez que roda (instalacao nova ou reinstalacao).
    Uma versao anterior gravava o idioma direto em settings.json, e so se ele
    ainda nao existisse - o que na pratica significava que so a PRIMEIRA
    instalacao aplicava a escolha, e reinstalar por cima (o caso comum, ja
    que o usuario tem uso acumulado) sempre ignorava o idioma escolhido."""

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.settings_path = Path(self.tmpdir.name) / "settings.json"
        self.marker_path = Path(self.tmpdir.name) / "installer_language.marker"
        self.patches = [
            patch.object(engine, "SETTINGS_PATH", self.settings_path),
            patch.object(engine, "INSTALLER_LANGUAGE_MARKER", self.marker_path),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmpdir.cleanup()

    def test_no_marker_is_a_no_op(self):
        engine.apply_installer_language_marker()
        self.assertFalse(self.settings_path.exists())

    def test_fresh_install_writes_language_and_deletes_marker(self):
        self.marker_path.write_text("en", encoding="utf-8")
        engine.apply_installer_language_marker()
        self.assertFalse(self.marker_path.exists())
        self.assertEqual(engine.load_settings()["language"], "en")

    def test_reinstall_over_existing_settings_updates_language_without_erasing_the_rest(self):
        """O cerne do bug relatado ao vivo: reinstalar (settings.json ja
        existente, com apelidos/Wi-Fi de uso real) tem que aplicar o idioma
        novo escolhido no instalador SEM apagar o resto do que ja tinha."""
        self.settings_path.write_text(
            '{"language": "pt", "nicknames": {"SERIAL1": "Meu celular"}, "wifi_devices": ["192.168.0.10:5555"]}',
            encoding="utf-8",
        )
        self.marker_path.write_text("en", encoding="utf-8")

        engine.apply_installer_language_marker()

        self.assertFalse(self.marker_path.exists())
        settings = engine.load_settings()
        self.assertEqual(settings["language"], "en")
        self.assertEqual(settings["nicknames"], {"SERIAL1": "Meu celular"})
        self.assertEqual(settings["wifi_devices"], ["192.168.0.10:5555"])

    def test_invalid_marker_content_is_ignored_but_still_deleted(self):
        self.marker_path.write_text("lixo", encoding="utf-8")
        engine.apply_installer_language_marker()
        self.assertFalse(self.marker_path.exists())
        self.assertFalse(self.settings_path.exists())


class SnapshotProblemStateTest(unittest.TestCase):
    """mirror_engine.py nao sabe de idioma nenhum - snapshot() precisa devolver
    o ESTADO cru do adb (quem traduz pra uma dica legivel e o painel, em
    _problem_hint_text)."""

    def test_problem_state_is_passed_through_raw_not_translated(self):
        mgr = engine.MirrorManager.__new__(engine.MirrorManager)
        mgr.active = {}
        mgr.blocked = set()
        mgr.model_cache = {}
        mgr.nicknames = {}
        mgr.recording = {}
        mgr.recording_started_at = {}
        mgr.last_ready = set()
        mgr.last_problems = {"SERIAL1": "unauthorized"}

        rows = mgr.snapshot()
        self.assertEqual(rows["SERIAL1"]["status"], "problem")
        self.assertEqual(rows["SERIAL1"]["problem_state"], "unauthorized")


if __name__ == "__main__":
    unittest.main()

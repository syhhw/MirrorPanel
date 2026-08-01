"""Testes de logica pura do mirror_engine - sem celular real, sem rede.

Roda com: python -m unittest discover -s tests   (a partir da raiz do projeto)
"""
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mirrorpanel import mirror_engine as engine


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


class StartDeviceAlwaysUsesPrimaryMonitorTest(unittest.TestCase):
    """Regressao pedida pelo usuario: start_device distribuia sozinho pro
    monitor menos ocupado, entao um segundo/terceiro aparelho podia abrir
    numa tela secundaria sem ele pedir ou mover nada. Agora sempre abre no
    monitor PRINCIPAL (indice 0) - so o usuario decide usar outro monitor,
    arrastando a janela pra la depois de aberta."""

    def setUp(self):
        self.mgr = engine.MirrorManager.__new__(engine.MirrorManager)
        self.mgr.active = {}
        self.mgr.model_cache = {}
        self.mgr.recording = {}
        self.mgr.recording_light = {}
        self.mgr.device_overrides = {}
        self.mgr.blocked = set()
        self.mgr.crash_counts = {}
        self.mgr.used_ports = set()
        self.mgr.stay_awake = True
        self.mgr.always_on_top = False

        # monitor principal ja com 3 janelas abertas, secundario vazio - a
        # logica antiga ("menos ocupado") teria escolhido o secundario aqui.
        self.primary = engine.SlotManager(0, 0, 1920, 1080)
        self.primary.ensure_capacity(3)
        for _ in range(3):
            self.primary.acquire()
        self.secondary = engine.SlotManager(1920, 0, 1920, 1080)
        self.mgr.slot_managers = [self.primary, self.secondary]

    def test_new_device_opens_on_primary_even_when_it_has_more_windows(self):
        fake_dev = MagicMock()
        with patch.object(engine, "launch_device", return_value=fake_dev) as mock_launch:
            ok = self.mgr.start_device("SERIAL1")
        self.assertTrue(ok)
        call_args = mock_launch.call_args.args
        self.assertIs(call_args[2], self.primary)  # "slots" passado e o do monitor principal
        self.assertEqual(call_args[8], 0)  # monitor_idx


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

    def test_full_push_flow_generic_file(self):
        """Mesmo fluxo do teste acima, mas pro caminho de PUSH generico (arquivo
        que nao e .apk) - o unico que faltava um evento de conclusao."""
        dev = self._dev()
        self._append("INFO: Pushing app.xapk...\n"
                      "INFO: app.xapk successfully pushed to /sdcard/Download/app.xapk\n")
        events = self.mgr._scan_apk_events(dev)
        self.assertEqual([e["type"] for e in events], ["apk_pushing", "apk_pushed"])
        self.assertTrue(all(e["name"] == "app.xapk" for e in events))

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

    def test_generic_file_push_success(self):
        """Regressao: a barra de progresso ficava presa pra sempre ao arrastar um
        .xapk (ou qualquer arquivo que nao seja .apk) - o scrcpy loga o sucesso
        do push como "X successfully pushed to Y" (confirmado direto no
        codigo-fonte real dele, app/src/file_pusher.c), mas so existia regex
        pro sucesso de INSTALACAO ("successfully installed"), nunca pro sucesso
        de PUSH. O evento "comecou" (apk_pushing) chegava, o par "terminou"
        nunca chegava, e a barra ficava girando pra sempre."""
        dev = self._dev()
        self._append("INFO: app.xapk successfully pushed to /sdcard/Download/app.xapk\n")
        events = self.mgr._scan_apk_events(dev)
        self.assertEqual(events, [{"type": "apk_pushed", "model": "TestPhone", "name": "app.xapk"}])

    def test_extracts_basename_from_path(self):
        dev = self._dev()
        self._append("INFO: Installing C:/Users/test/Downloads/meuapp.apk...\n")
        events = self.mgr._scan_apk_events(dev)
        self.assertEqual(events[0]["name"], "meuapp.apk")

    def test_unrelated_log_lines_are_ignored(self):
        dev = self._dev()
        self._append("INFO: Renderer: direct3d11\nINFO: Texture: 1080x2340\n")
        self.assertEqual(self.mgr._scan_apk_events(dev), [])


class InstallOrPushToDeviceTest(unittest.TestCase):
    """install_or_push_to_device e o passo de UM aparelho da transferencia em
    lote (o laco pelos aparelhos ativos fica em panel.py, que chama isso pra
    cada um) - decide instalar vs enviar so pela extensao do arquivo, igual o
    scrcpy faz no arrastar-e-soltar nativo dele (confirmado direto no
    codigo-fonte real do scrcpy, app/src/input_manager.c: is_apk() compara a
    extensao exata via strcmp, nao so verifica se contem "apk")."""

    def setUp(self):
        self.mgr = engine.MirrorManager.__new__(engine.MirrorManager)

    def _fake_result(self, returncode):
        result = MagicMock()
        result.returncode = returncode
        return result

    def test_apk_file_calls_install(self):
        with patch.object(engine, "run_adb", return_value=self._fake_result(0)) as mock_run:
            ok = self.mgr.install_or_push_to_device("SERIAL1", "C:/Users/test/app.apk")
        self.assertTrue(ok)
        mock_run.assert_called_once_with("-s", "SERIAL1", "install", "C:/Users/test/app.apk", timeout=120)

    def test_non_apk_file_calls_push_to_download_folder(self):
        """Qualquer extensao que nao seja .apk nem .xapk (essa tem tratamento
        proprio - ver test_xapk_routes_to_install_xapk_to_device) vira push
        generico, nunca install - senao o adb install rejeita o arquivo."""
        with patch.object(engine, "run_adb", return_value=self._fake_result(0)) as mock_run:
            ok = self.mgr.install_or_push_to_device("SERIAL1", "C:/Users/test/photo.png")
        self.assertTrue(ok)
        mock_run.assert_called_once_with(
            "-s", "SERIAL1", "push", "C:/Users/test/photo.png", "/sdcard/Download/", timeout=120)

    def test_extension_check_is_case_insensitive(self):
        with patch.object(engine, "run_adb", return_value=self._fake_result(0)) as mock_run:
            self.mgr.install_or_push_to_device("SERIAL1", "C:/Users/test/APP.APK")
        self.assertIn("install", mock_run.call_args.args)

    def test_nonzero_returncode_is_failure(self):
        with patch.object(engine, "run_adb", return_value=self._fake_result(1)):
            ok = self.mgr.install_or_push_to_device("SERIAL1", "app.apk")
        self.assertFalse(ok)

    def test_timeout_is_failure_not_exception(self):
        with patch.object(engine, "run_adb",
                           side_effect=subprocess.TimeoutExpired(cmd="adb", timeout=120)):
            ok = self.mgr.install_or_push_to_device("SERIAL1", "app.apk")
        self.assertFalse(ok)

    def test_xapk_routes_to_install_xapk_to_device(self):
        """install_or_push_to_device e so o roteador por extensao - a logica
        de verdade do .xapk mora em install_xapk_to_device (testado a fundo
        na classe abaixo); aqui so confere que o roteamento acontece."""
        with patch.object(self.mgr, "install_xapk_to_device", return_value=True) as mock_xapk:
            ok = self.mgr.install_or_push_to_device("SERIAL1", "app.xapk")
        self.assertTrue(ok)
        mock_xapk.assert_called_once_with("SERIAL1", "app.xapk")


class InstallXapkToDeviceTest(unittest.TestCase):
    """.xapk e um zip com o base.apk mais splits (idioma/densidade/abi) - so
    "adb install" rejeita isso, precisa extrair e usar "adb install-multiple"
    com todos os .apk de uma vez. Alguns .xapk (jogos grandes) tambem trazem
    dados OBB em Android/obb/ dentro do zip."""

    def setUp(self):
        self.mgr = engine.MirrorManager.__new__(engine.MirrorManager)
        self.tmpdir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.tmpdir.cleanup()

    def _make_xapk(self, name="app.xapk", apks=("base.apk", "config.en.apk"), obb_files=None):
        path = Path(self.tmpdir.name) / name
        with zipfile.ZipFile(path, "w") as zf:
            for apk_name in apks:
                zf.writestr(apk_name, b"conteudo falso de apk")
            for obb_path, content in (obb_files or {}).items():
                zf.writestr(obb_path, content)
        return str(path)

    def _fake_result(self, returncode=0):
        result = MagicMock()
        result.returncode = returncode
        return result

    def test_install_multiple_called_with_all_apks(self):
        xapk_path = self._make_xapk()
        with patch.object(engine, "run_adb", return_value=self._fake_result(0)) as mock_run:
            ok = self.mgr.install_xapk_to_device("SERIAL1", xapk_path)
        self.assertTrue(ok)
        call_args = mock_run.call_args_list[0].args
        self.assertEqual(call_args[:3], ("-s", "SERIAL1", "install-multiple"))
        self.assertIn("-r", call_args)
        self.assertTrue(any(a.endswith("base.apk") for a in call_args))
        self.assertTrue(any(a.endswith("config.en.apk") for a in call_args))

    def test_no_apk_inside_is_failure(self):
        path = Path(self.tmpdir.name) / "empty.xapk"
        with zipfile.ZipFile(path, "w") as zf:
            zf.writestr("manifest.json", b"{}")
        with patch.object(engine, "run_adb") as mock_run:
            ok = self.mgr.install_xapk_to_device("SERIAL1", str(path))
        self.assertFalse(ok)
        mock_run.assert_not_called()

    def test_install_multiple_nonzero_returncode_is_failure(self):
        xapk_path = self._make_xapk()
        with patch.object(engine, "run_adb", return_value=self._fake_result(1)):
            ok = self.mgr.install_xapk_to_device("SERIAL1", xapk_path)
        self.assertFalse(ok)

    def test_corrupt_zip_is_failure(self):
        path = Path(self.tmpdir.name) / "corrupt.xapk"
        path.write_bytes(b"isso nao e um zip de verdade")
        with patch.object(engine, "run_adb") as mock_run:
            ok = self.mgr.install_xapk_to_device("SERIAL1", str(path))
        self.assertFalse(ok)
        mock_run.assert_not_called()

    def test_obb_data_is_pushed_after_successful_install(self):
        xapk_path = self._make_xapk(obb_files={"Android/obb/com.example.app/main.1.obb": b"dados obb falsos"})
        with patch.object(engine, "run_adb", return_value=self._fake_result(0)) as mock_run:
            ok = self.mgr.install_xapk_to_device("SERIAL1", xapk_path)
        self.assertTrue(ok)
        push_calls = [c for c in mock_run.call_args_list if "push" in c.args]
        self.assertEqual(len(push_calls), 1)
        self.assertIn("/sdcard/Android/obb/com.example.app/", push_calls[0].args)

    def test_obb_push_failure_does_not_undo_successful_install(self):
        """OBB e complemento - se o app em si ja instalou certo, um timeout no
        push do OBB nao pode fazer a instalacao inteira parecer que falhou."""
        xapk_path = self._make_xapk(obb_files={"Android/obb/com.example.app/main.1.obb": b"x"})

        def side_effect(*args, **kwargs):
            if "install-multiple" in args:
                return self._fake_result(0)
            raise subprocess.TimeoutExpired(cmd="adb", timeout=180)

        with patch.object(engine, "run_adb", side_effect=side_effect):
            ok = self.mgr.install_xapk_to_device("SERIAL1", xapk_path)
        self.assertTrue(ok)

    def test_no_obb_folder_is_fine(self):
        xapk_path = self._make_xapk()
        with patch.object(engine, "run_adb", return_value=self._fake_result(0)) as mock_run:
            ok = self.mgr.install_xapk_to_device("SERIAL1", xapk_path)
        self.assertTrue(ok)
        mock_run.assert_called_once()  # so a chamada de install-multiple, nenhum push


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

    def test_exit_code_two_is_treated_as_disconnect_even_if_our_own_poll_still_sees_it(self):
        # SCRCPY_EXIT_DISCONNECTED (confirmado em scrcpy.h do source oficial v4.0) - o
        # proprio scrcpy detectou a desconexao por evento (fim do stream USB/video),
        # mais rapido que o nosso proximo "adb devices". Mesmo se o NOSSO poll ainda
        # achar o aparelho "ready" nesse instante exato (o cenario aqui simulado:
        # list_devices ainda devolve SERIAL1), tem que contar como desconexao de
        # verdade - sem penalidade de crash_counts, sem risco de bloquear o aparelho.
        self.fake_proc.poll.return_value = 2
        events = self._tick_with_device_still_plugged_in()
        self.assertEqual(events, [])
        self.assertIn("SERIAL1", self.mgr.pending_reconnect)
        self.assertEqual(self.mgr.pending_reconnect["SERIAL1"]["kind"], "departed")
        self.assertNotIn("SERIAL1", self.mgr.crash_counts)


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

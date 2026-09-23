"""Regressões de sessão, sem processos externos nem aparelhos reais."""
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from mirrorpanel import mirror_engine as engine


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        with patch.object(engine, "get_all_monitors", return_value=[(0, 0, 1920, 1080)]), \
                patch.object(engine, "load_settings", return_value={
                    "stay_awake": True, "always_on_top": False, "minimize_to_tray": False,
                    "wifi_devices": [], "device_overrides": {}, "nicknames": {}, "language": "pt"}):
            self.manager = engine.MirrorManager()
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.manager.model_cache = {"USB": "Pixel"}
        self.manager.hw_serial_cache = {"USB": "USB"}
        self.manager.last_ready = {"USB"}
        self.stop = patch.object(engine, "graceful_stop").start()
        self.addCleanup(patch.stopall)
        patch.object(engine, "time").start().monotonic.side_effect = time.monotonic

    def add_device(self, serial="USB", exit_code=None):
        proc = MagicMock()
        proc.poll.return_value = exit_code
        slots = self.manager.slot_managers[0]
        path = self.directory / "scrcpy.log"
        path.touch()
        dev = engine.ActiveDevice(proc, MagicMock(), "Pixel", 27183, slots.acquire(),
                                  time.monotonic(), path)
        self.manager.active[serial] = dev
        self.manager.used_ports.add(dev.port)
        return dev

    def mark_recording(self):
        self.manager.recording["USB"] = str(self.directory / "old.mp4")
        self.manager.recording_light["USB"] = True
        self.manager.recording_started_at["USB"] = time.monotonic()

    def test_stop_clears_recording_and_pending_reconnect(self):
        self.add_device()
        self.mark_recording()
        self.manager.pending_reconnect["USB"] = {"attempts": 1}
        self.manager.stop_device("USB")
        self.assertFalse(self.manager.recording)
        self.assertFalse(self.manager.recording_light)
        self.assertFalse(self.manager.recording_started_at)
        self.assertFalse(self.manager.pending_reconnect)

    def test_user_close_clears_recording_without_relaunch(self):
        self.add_device(exit_code=0)
        self.mark_recording()
        with patch.object(engine, "list_devices", return_value={"USB": "device"}), \
                patch.object(engine, "launch_device") as launch:
            events = self.manager.tick()
        self.assertFalse(self.manager.recording)
        self.assertIn("closed_by_user", [event["type"] for event in events])
        launch.assert_not_called()

    def test_manual_restart_after_recording_does_not_reuse_old_destination(self):
        self.add_device()
        self.mark_recording()
        self.manager.stop_device("USB")
        with patch.object(engine, "launch_device", return_value=self.add_device()) as launch:
            # Remove the fake device from active so start_device performs launch.
            self.manager.active.clear()
            self.manager.start_device("USB")
        self.assertIsNone(launch.call_args.args[6])

    def test_recording_success_passes_unique_path_and_light_profile(self):
        self.add_device()
        with patch.object(engine, "RECORDINGS_DIR", self.directory), \
                patch.object(engine, "launch_device", return_value=MagicMock(model="Pixel")) as launch:
            result = self.manager.start_recording("USB", light=True)
        self.assertEqual(launch.call_args.args[6], result)
        self.assertEqual(launch.call_args.args[4], engine.LIGHT_RECORDING_FLAGS)
        self.assertIn("USB", self.manager.recording_started_at)

    def test_recording_requires_active_device(self):
        self.assertIsNone(self.manager.start_recording("USB"))
        self.assertFalse(self.manager.recording)

    def test_record_launch_failure_rolls_back_and_reports_failure(self):
        self.add_device()
        with patch.object(engine, "RECORDINGS_DIR", self.directory), \
                patch.object(engine, "launch_device", return_value=None):
            result = self.manager.start_recording("USB", light=True)
        self.assertIsNone(result)
        self.assertFalse(self.manager.recording)
        self.assertFalse(self.manager.recording_started_at)

    def test_same_model_recordings_have_distinct_destinations(self):
        self.add_device()
        self.add_device("USB2")
        self.manager.model_cache["USB2"] = "Pixel"
        with patch.object(engine, "RECORDINGS_DIR", self.directory), \
                patch.object(engine, "datetime") as date, \
                patch.object(self.manager, "start_device", return_value=True):
            date.now.return_value.strftime.return_value = "same-timestamp"
            first = self.manager.start_recording("USB")
            second = self.manager.start_recording("USB2")
        self.assertNotEqual(first, second)
        self.assertTrue(first.endswith(".mp4"))

    def test_repeated_process_crashes_eventually_block(self):
        self.add_device(exit_code=1)

        def launch(*_args, **_kwargs):
            return self.add_device(exit_code=1)

        events = []
        with patch.object(engine, "list_devices", return_value={"USB": "device"}), \
                patch.object(engine, "launch_device", side_effect=launch):
            for _ in range(engine.MAX_CRASH_RETRIES + 2):
                events.extend(self.manager.tick())
        self.assertIn("USB", self.manager.blocked)
        self.assertNotIn("USB", self.manager.active)
        self.assertIn("blocked", [event["type"] for event in events])

    def test_disconnect_stops_tracked_process_before_releasing_it(self):
        dev = self.add_device()
        self.mark_recording()
        with patch.object(engine, "list_devices", return_value={}):
            self.manager.tick()
        self.stop.assert_called_once_with(dev.proc)
        self.assertFalse(self.manager.recording)

    def test_manual_retry_resets_previous_crash_limit(self):
        self.manager.crash_counts["USB"] = engine.MAX_CRASH_RETRIES
        self.manager.blocked.add("USB")
        with patch.object(engine, "launch_device", return_value=MagicMock(model="Pixel")):
            self.assertTrue(self.manager.start_device("USB"))
        self.assertNotIn("USB", self.manager.crash_counts)
        self.assertNotIn("USB", self.manager.blocked)

    def test_shutdown_stops_only_tracked_processes(self):
        dev = self.add_device()
        self.mark_recording()
        with patch.object(engine.subprocess, "run") as run, \
                patch.object(engine, "run_adb") as adb:
            self.manager.shutdown()
        self.stop.assert_called_once_with(dev.proc)
        run.assert_not_called()
        adb.assert_not_called()
        self.assertFalse(self.manager.active)
        self.assertFalse(self.manager.recording)
        self.assertFalse(self.manager.used_ports)


class LaunchCleanupTest(unittest.TestCase):
    def test_wifi_serial_is_valid_filename_and_failed_launch_releases_resources(self):
        slots = engine.SlotManager(0, 0, 1920, 1080)
        ports = set()
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(engine, "LOG_DIR", Path(tmp)), \
                patch.object(engine, "get_model", return_value="Pixel"), \
                patch.object(engine, "get_screen_resolution", return_value=(1080, 1920)), \
                patch.object(engine, "port_is_free", return_value=True), \
                patch.object(engine.subprocess, "Popen", side_effect=OSError("launch failed")) as launch:
            result = engine.launch_device("192.0.2.10:5555", "Pixel", slots, ports, "")
            self.assertIsNone(result)
            launch.assert_called_once()
            self.assertFalse(slots.used)
            self.assertFalse(ports)
            log = next(Path(tmp).glob("*.log"))
            self.assertNotIn(":", log.name)
            log.unlink()  # A closed file can be removed on Windows.


if __name__ == "__main__":
    unittest.main()

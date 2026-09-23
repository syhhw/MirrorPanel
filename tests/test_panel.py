"""UI real com motor isolado: nunca inicia ADB, scrcpy ou bandeja."""

import tkinter as tk
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mirrorpanel import i18n, panel


def create_app(language="pt"):
    manager = SimpleNamespace(stay_awake=True, always_on_top=False,
                              minimize_to_tray=False, active={}, recording={})
    with patch.object(panel.engine, "apply_installer_language_marker"), \
            patch.object(panel.engine, "load_settings", return_value={"language": language}), \
            patch.object(panel.engine, "MirrorManager", return_value=manager), \
            patch.object(panel.App, "_background_loop"), \
            patch.object(panel.App, "_setup_tray"):
        root = tk.Tk()
        root.withdraw()
        app = panel.App(root)
    return root, app


def destroy_app(root):
    for job in root.tk.call("after", "info"):
        root.after_cancel(job)
    root.destroy()
    panel._icon_cache.clear()


def device(status="ready", **extra):
    return {"status": status, "display_name": "Pixel 9", "model": "Pixel 9", **extra}


class PanelTest(unittest.TestCase):
    def setUp(self):
        self.language = i18n.get_language()
        self.root, self.app = create_app()
        self.app.loading_bar.stop()
        self.app.loading_frame.pack_forget()
        self.app.device_view.pack(fill="both", expand=True)
        self.root.deiconify()
        self.root.update()

    def tearDown(self):
        destroy_app(self.root)
        i18n.set_language(self.language)

    def test_filter_keeps_multiline_warnings_and_errors(self):
        self.app._log("informational event")
        self.app._log("warning first line\nwarning second line", "warning")
        self.app._log("failed event", "error")
        self.app.log_filter.set(i18n.t("activity.problems"))
        self.app._refresh_log(reset_view=True)
        content = self.app.log_text.get("1.0", "end")
        self.assertNotIn("informational event", content)
        self.assertIn("warning first line\nwarning second line", content)
        self.assertIn("failed event", content)
        self.app.log_filter.set(i18n.t("activity.all"))
        self.app._refresh_log(reset_view=True)
        self.assertIn("informational event", self.app.log_text.get("1.0", "end"))

    def test_new_logs_keep_reader_on_same_entry(self):
        for index in range(35):
            self.app._log(f"event {index}")
        self.root.update()
        self.app.log_text.yview("10.0")
        self.root.update()
        old_line = self.app.log_text.get("@0,0 linestart", "@0,0 lineend")
        self.app._log("another event")
        self.root.update()
        self.assertEqual(old_line, self.app.log_text.get("@0,0 linestart", "@0,0 lineend"))
        self.app.log_text.see("end")
        self.root.update()
        self.app._log("follow this event")
        self.root.update()
        self.assertGreaterEqual(self.app.log_text.yview()[1], 0.995)

    def test_buffer_eviction_preserves_reader_and_is_bounded(self):
        for index in range(panel.LOG_MAX_LINES):
            self.app._log(f"buffer event {index}")
        self.root.update()
        self.app.log_text.yview("20.0")
        self.root.update()
        old_line = self.app.log_text.get("@0,0 linestart", "@0,0 lineend")
        self.app._log("buffer latest")
        self.root.update()
        self.assertEqual(len(self.app._log_records), panel.LOG_MAX_LINES)
        self.assertEqual(old_line, self.app.log_text.get("@0,0 linestart", "@0,0 lineend"))
        self.assertNotIn("buffer event 0\n", self.app.log_text.get("1.0", "end"))

    def test_clear_resets_records_and_filter_empty_state(self):
        self.app._log("failure", "error")
        self.app.log_filter.set(i18n.t("activity.problems"))
        self.app._clear_log()
        self.assertFalse(self.app._log_records)
        self.app._log("success", "success")
        self.assertIn(i18n.t("activity.no_problems"), self.app.log_text.get("1.0", "end"))

    def test_copy_uses_only_filtered_records(self):
        self.app._log("ignore this info")
        self.app._log("copy this error", "error")
        self.app.log_filter.set(i18n.t("activity.problems"))
        with patch.object(self.root, "clipboard_clear") as clear, \
                patch.object(self.root, "clipboard_append") as append:
            self.app._copy_log()
        clear.assert_called_once()
        self.assertIn("copy this error", append.call_args.args[0])
        self.assertNotIn("ignore this info", append.call_args.args[0])

    def test_device_actions_keep_original_callbacks_and_record_state(self):
        self.app._render({"USB_DEMO": device("mirroring", recording=True, recording_seconds=83)})
        row = self.app.rows["USB_DEMO"]
        self.assertEqual(row.model_label.cget("text"), "Pixel 9")
        self.assertIn("01:23", row.recording_label.cget("text"))
        row.toggle_btn.invoke()
        self.assertEqual(self.app.action_queue.get_nowait(), {"type": "stop", "serial": "USB_DEMO"})
        row.update(device("problem", problem_state="unauthorized"))
        self.assertEqual(str(row.toggle_btn.cget("state")), "disabled")
        self.assertEqual(str(row.send_file_btn.cget("state")), "disabled")
        self.assertEqual(row.recording_label.cget("text"), "")

    def test_device_list_scrolls_and_empty_state_returns(self):
        self.app._render({f"USB_{i}": device() for i in range(12)})
        self.root.update()
        self.assertLess(self.app.device_canvas.yview()[1], 1.0)
        self.app._scroll_devices(SimpleNamespace(widget=self.app.rows["USB_0"].model_label, delta=-120))
        self.assertGreater(self.app.device_canvas.yview()[0], 0.0)
        previous = self.app.device_canvas.yview()
        self.app._scroll_devices(SimpleNamespace(widget=self.app.log_text, delta=-120))
        self.assertEqual(previous, self.app.device_canvas.yview())
        self.app._render({})
        self.root.update()
        self.assertFalse(self.app.rows)
        self.assertTrue(self.app.empty_label.winfo_ismapped())

    def test_progress_and_settings_save(self):
        self.app._mark_apk_busy()
        self.root.update()
        self.assertTrue(self.app.apk_progress.winfo_ismapped())
        self.app._mark_apk_done()
        self.root.update()
        self.assertFalse(self.app.apk_progress.winfo_ismapped())
        result = []
        dialog = panel.SettingsDialog(self.root, "USB", "Pixel 9", {}, result.append)
        dialog.codec_var.set("h265")
        dialog.audio_var.set(False)
        dialog._save()
        self.assertEqual(result, [{"video_codec": "h265", "bitrate": "8M", "max_fps": 60, "audio": False}])

    def test_dialogs_build_in_both_languages(self):
        for language in ("pt", "en"):
            i18n.set_language(language)
            for factory in (
                lambda: panel.AppSettingsDialog(self.root, [
                    (self.app.stay_awake_var, "app.stay_awake", None, lambda: None)]),
                lambda: panel.RenameDialog(self.root, "Pixel 9", "Desk", lambda _v: None),
                lambda: panel.RecordingDialog(self.root, "Pixel 9", Path("C:/Videos/Media"), lambda _v: None),
                lambda: panel.ShortcutsDialog(self.root),
            ):
                dialog = factory()
                self.root.update()
                self.assertTrue(dialog.winfo_ismapped())
                self.assertLess(dialog.winfo_width(), self.root.winfo_screenwidth())
                dialog.destroy()


if __name__ == "__main__":
    unittest.main()

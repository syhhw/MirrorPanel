"""MirrorPanel - painel grafico para gerenciar o espelhamento de varios Android.

Interface em cima do mirror_engine: mostra os aparelhos detectados, parados,
ate o usuario clicar "Abrir" em algum. Tambem da pra ativar Wi-Fi, gravar e
ajustar qualidade por aparelho - tudo por botao, sem editar arquivo nenhum.
Roda numa thread separada da UI pra nunca travar a janela.
"""
import ctypes
import logging
import queue
import threading
import time
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

import pystray
from PIL import ImageTk

import icons
import mirror_engine as engine
import updater

# Fonte padrao do app inteiro - Segoe UI e a fonte de sistema do Windows 10/11
# (limpa, sans-serif, ja instalada em qualquer maquina - sem depender de nada externo)
FONT_FAMILY = "Segoe UI"
FONT_DEFAULT = (FONT_FAMILY, 9)
FONT_BOLD = (FONT_FAMILY, 9, "bold")
FONT_MUTED = (FONT_FAMILY, 8)

STATUS_LABELS = {
    "mirroring": ("Espelhando", "#1a7f37"),
    "ready": ("Pronto para espelhar", "#57606a"),
    "problem": ("Atencao", "#9a6700"),
    "blocked": ("Falhou varias vezes", "#cf222e"),
}

BITRATE_OPTIONS = [
    ("Baixa - economiza dados", "2M"),
    ("Media", "4M"),
    ("Alta (recomendada)", "8M"),
    ("Muito alta", "16M"),
]
FPS_OPTIONS = [
    ("30 - economiza bateria", 30),
    ("60 (recomendado)", 60),
    ("90 - mais fluido", 90),
]

_icon_cache: dict = {}

# Espacamentos e regras padrao de TODAS as janelas de dialogo (pop-ups) - os
# mesmos valores em todo lugar da um ar desenhado, nao remendado.
DIALOG_OUTER_PAD = 20                        # margem externa ao redor do conteudo do dialogo
DIALOG_FORM_PAD = {"padx": 14, "pady": 6}    # espaco entre linhas de formulario (rotulo + campo)
DIALOG_MESSAGE_WRAPLENGTH = 300              # quebra de linha automatica de textos de aviso/mensagem
DIALOG_BUTTON_WIDTH = 12                     # largura minima dos botoes de acao, pra ficarem parelhos


def get_icon(name: str, size: int, color: str):
    key = (name, size, color)
    if key not in _icon_cache:
        img = getattr(icons, name)(size, color)
        _icon_cache[key] = ImageTk.PhotoImage(img)
    return _icon_cache[key]


def _center_on_parent(win: tk.Toplevel, parent: tk.Misc):
    """Centraliza uma janela de dialogo sobre a janela principal (nao no canto padrao do Windows).

    Cada dialogo comeca escondido (self.withdraw() logo no __init__, antes de
    montar qualquer widget) e so aparece aqui no final, ja na posicao certa -
    sem isso, a janela nasce visivel no canto padrao do SO por uma fracao de
    segundo antes de ser movida, o que da um "pulo" perceptivel na tela.

    Atualiza update_idletasks() tanto do dialogo quanto do PAI antes de ler
    qualquer geometria: winfo_reqwidth/reqheight do dialogo so ficam corretos
    depois que os widgets foram desenhados, e winfo_rootx/rooty do PAI podem
    devolver posicao desatualizada (as vezes ate 0,0) se a janela principal
    ainda nao tiver acabado de se posicionar na tela - foi exatamente isso
    que fazia os dialogos nascerem grudados no canto superior esquerdo em vez
    do meio da janela.
    """
    parent.update_idletasks()
    win.update_idletasks()
    pw, ph = parent.winfo_width(), parent.winfo_height()
    px, py = parent.winfo_rootx(), parent.winfo_rooty()
    w, h = win.winfo_reqwidth(), win.winfo_reqheight()
    x = px + (pw - w) // 2
    y = py + (ph - h) // 2
    # nunca deixa nascer fora da tela (janela principal perto da borda, monitor pequeno etc.)
    sw, sh = win.winfo_screenwidth(), win.winfo_screenheight()
    x = max(0, min(x, sw - w))
    y = max(0, min(y, sh - h))
    win.geometry(f"+{x}+{y}")
    win.deiconify()


class SettingsDialog(tk.Toplevel):
    """Ajuste de qualidade por aparelho - so opcoes prontas, sem digitar nada tecnico."""

    def __init__(self, parent, serial, model, current, on_save):
        super().__init__(parent)
        self.withdraw()
        self.title(f"Ajustes - {model}")
        self.resizable(False, False)
        self.transient(parent)
        self.on_save = on_save
        pad = DIALOG_FORM_PAD

        ttk.Label(self, text="Codec de video:").grid(row=0, column=0, sticky="w", **pad)
        self.codec_var = tk.StringVar(value=current.get("video_codec", "h264"))
        ttk.Combobox(self, textvariable=self.codec_var, values=["h264", "h265"],
                     state="readonly", width=24).grid(row=0, column=1, **pad)

        bitrate_by_value = {v: l for l, v in BITRATE_OPTIONS}
        ttk.Label(self, text="Qualidade:").grid(row=1, column=0, sticky="w", **pad)
        self.bitrate_var = tk.StringVar(
            value=bitrate_by_value.get(current.get("bitrate", "8M"), BITRATE_OPTIONS[2][0]))
        ttk.Combobox(self, textvariable=self.bitrate_var, values=[l for l, _ in BITRATE_OPTIONS],
                     state="readonly", width=24).grid(row=1, column=1, **pad)

        fps_by_value = {v: l for l, v in FPS_OPTIONS}
        ttk.Label(self, text="Taxa de quadros:").grid(row=2, column=0, sticky="w", **pad)
        self.fps_var = tk.StringVar(
            value=fps_by_value.get(current.get("max_fps", 60), FPS_OPTIONS[1][0]))
        ttk.Combobox(self, textvariable=self.fps_var, values=[l for l, _ in FPS_OPTIONS],
                     state="readonly", width=24).grid(row=2, column=1, **pad)

        self.audio_var = tk.BooleanVar(value=current.get("audio", True))
        ttk.Checkbutton(self, text="Transmitir audio do aparelho",
                         variable=self.audio_var).grid(row=3, column=0, columnspan=2,
                                                        sticky="w", padx=14, pady=(6, 14))

        btns = ttk.Frame(self)
        btns.grid(row=4, column=0, columnspan=2, pady=(0, 14))
        ttk.Button(btns, text="Cancelar", command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text="Salvar", command=self._save, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

        _center_on_parent(self, parent)
        self.grab_set()

    def _save(self):
        bitrate_by_label = {l: v for l, v in BITRATE_OPTIONS}
        fps_by_label = {l: v for l, v in FPS_OPTIONS}
        settings = {
            "video_codec": self.codec_var.get(),
            "bitrate": bitrate_by_label[self.bitrate_var.get()],
            "max_fps": fps_by_label[self.fps_var.get()],
            "audio": self.audio_var.get(),
        }
        self.on_save(settings)
        self.destroy()


class RecordingDialog(tk.Toplevel):
    """Confirma pasta de destino e qualidade antes de comecar a gravar."""

    def __init__(self, parent, model, default_folder, on_start):
        super().__init__(parent)
        self.withdraw()
        self.title(f"Gravar - {model}")
        self.resizable(False, False)
        self.transient(parent)
        self.on_start = on_start
        pad = DIALOG_FORM_PAD

        ttk.Label(self, text="Salvar em:").grid(row=0, column=0, sticky="w", **pad)
        self.folder_var = tk.StringVar(value=default_folder)
        entry = ttk.Entry(self, textvariable=self.folder_var, width=38, state="readonly")
        entry.grid(row=0, column=1, sticky="w", padx=(0, 6), pady=6)
        ttk.Button(self, text="Escolher...", command=self._choose_folder).grid(row=0, column=2, padx=(0, 14))

        self.light_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            self, text="Gravacao leve (recomendado para aparelhos antigos)",
            variable=self.light_var,
        ).grid(row=1, column=0, columnspan=3, sticky="w", padx=14, pady=(0, 4))
        ttk.Label(
            self, text="Reduz qualidade (bitrate/fps/resolucao) so durante a gravacao, "
                       "para nao travar celulares mais fracos.",
            foreground="#57606a", font=("Segoe UI", 8), justify="left", wraplength=380,
        ).grid(row=2, column=0, columnspan=3, sticky="w", padx=14, pady=(0, 10))

        btns = ttk.Frame(self)
        btns.grid(row=3, column=0, columnspan=3, pady=(0, 14))
        ttk.Button(btns, text="Cancelar", command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text="Gravar", command=self._start, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

        _center_on_parent(self, parent)
        self.grab_set()

    def _choose_folder(self):
        chosen = filedialog.askdirectory(parent=self, initialdir=self.folder_var.get() or None)
        if chosen:
            self.folder_var.set(chosen)

    def _start(self):
        self.on_start(self.folder_var.get(), self.light_var.get())
        self.destroy()


class UpdateDialog(tk.Toplevel):
    """Avisa que ha uma versao nova e pergunta se quer atualizar agora."""

    def __init__(self, parent, info: dict, on_accept):
        super().__init__(parent)
        self.withdraw()
        self.title("Atualizacao disponivel")
        self.resizable(False, False)
        self.transient(parent)
        self.on_accept = on_accept

        ttk.Label(self, text=f"MirrorPanel {info['version']} disponivel",
                  font=("Segoe UI", 10, "bold")).pack(padx=DIALOG_OUTER_PAD, pady=(16, 4), anchor="w")
        ttk.Label(self, text="Novidades desta versao:",
                  foreground="#57606a").pack(padx=DIALOG_OUTER_PAD, anchor="w")

        notes = tk.Text(self, width=52, height=10, wrap="word", font=("Segoe UI", 9),
                         relief="solid", borderwidth=1)
        notes.insert("1.0", info["notes"] or "(sem notas de versao)")
        notes.config(state="disabled")
        notes.pack(padx=DIALOG_OUTER_PAD, pady=(6, 12))

        btns = ttk.Frame(self)
        btns.pack(pady=(0, 16))
        ttk.Button(btns, text="Mais tarde", command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text="Atualizar", command=self._accept, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

        _center_on_parent(self, parent)
        self.grab_set()

    def _accept(self):
        self.on_accept()
        self.destroy()


class DownloadProgressDialog(tk.Toplevel):
    """Fica travada (sem X) durante o download, pra nao deixar fechar no meio."""

    def __init__(self, parent):
        super().__init__(parent)
        self.withdraw()
        self.title("Atualizando MirrorPanel")
        self.resizable(False, False)
        self.transient(parent)
        self.protocol("WM_DELETE_WINDOW", lambda: None)

        ttk.Label(self, text="Baixando atualizacao...").pack(padx=DIALOG_OUTER_PAD, pady=(18, 8))
        self.bar = ttk.Progressbar(self, mode="determinate", length=280, maximum=100)
        self.bar.pack(padx=DIALOG_OUTER_PAD, pady=(0, 6))
        self.pct_label = ttk.Label(self, text="0%", foreground="#57606a")
        self.pct_label.pack(pady=(0, 18))

        _center_on_parent(self, parent)
        self.grab_set()

    def set_progress(self, downloaded: int, total: int):
        if total > 0:
            pct = min(100, int(downloaded * 100 / total))
            self.bar.config(mode="determinate")
            self.bar["value"] = pct
            self.pct_label.config(text=f"{pct}%  ({downloaded // 1024} KB / {total // 1024} KB)")
        else:
            self.bar.config(mode="indeterminate")
            self.bar.start(15)
            self.pct_label.config(text=f"{downloaded // 1024} KB baixados")


class ScreenshotFlash(tk.Toplevel):
    """Janela sem borda, transparente a cliques, que pisca em cima da janela de
    video do scrcpy - simula o flash de camera no exato lugar onde o print foi
    tirado (nao da pra desenhar 'dentro' do scrcpy, e um processo separado, entao
    a gente sobrepoe uma janela por cima dele no momento certo)."""

    def __init__(self, root: tk.Tk, rect):
        super().__init__(root)
        x, y, w, h = rect
        self.overrideredirect(True)
        self.attributes("-topmost", True)
        self.configure(bg="white")
        self.geometry(f"{w}x{h}+{x}+{y}")
        self._alpha = 0.55
        try:
            self.attributes("-alpha", self._alpha)
        except tk.TclError:
            pass
        self.after(1, self._make_clickthrough)  # so depois que o HWND real existir
        self.after(60, self._fade)

    def _make_clickthrough(self):
        """Deixa cliques atravessarem a janela - e so um flash visual, nao deve
        atrapalhar quem estiver mexendo no celular durante os poucos ms que ela existe."""
        try:
            GWL_EXSTYLE = -20
            WS_EX_LAYERED, WS_EX_TRANSPARENT, WS_EX_NOACTIVATE = 0x80000, 0x20, 0x8000000
            hwnd = self.winfo_id()
            user32 = ctypes.windll.user32
            styles = user32.GetWindowLongW(hwnd, GWL_EXSTYLE)
            user32.SetWindowLongW(hwnd, GWL_EXSTYLE, styles | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE)
        except Exception:
            pass

    def _fade(self):
        self._alpha -= 0.09
        if self._alpha <= 0:
            self.destroy()
            return
        try:
            self.attributes("-alpha", self._alpha)
        except tk.TclError:
            self.destroy()
            return
        self.after(25, self._fade)


class ScreenshotConfirmDialog(tk.Toplevel):
    """Pop-up NAO-modal (sem grab_set) - o usuario pode seguir usando o painel
    com essa janela aberta, ela so pergunta se quer copiar o print."""

    def __init__(self, parent, on_copy):
        super().__init__(parent)
        self.withdraw()
        self.title("Print capturado")
        self.resizable(False, False)
        self.transient(parent)
        self.attributes("-topmost", True)

        ttk.Label(self, text="Print capturado!", font=FONT_BOLD).pack(padx=DIALOG_OUTER_PAD, pady=(16, 4))
        ttk.Label(
            self, text="Deseja copiar para a area de transferencia do Windows?",
            foreground="#57606a", justify="center", wraplength=DIALOG_MESSAGE_WRAPLENGTH,
        ).pack(padx=DIALOG_OUTER_PAD, pady=(0, 14))

        btns = ttk.Frame(self)
        btns.pack(pady=(0, 16))
        ttk.Button(btns, text="Nao", command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text="Sim", command=self._accept, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

        self.on_copy = on_copy
        _center_on_parent(self, parent)

    def _accept(self):
        self.on_copy()
        self.destroy()


class MirroringDisconnectedDialog(tk.Toplevel):
    """Quando o espelhamento de um aparelho para - cabo desplugado ou o scrcpy
    caiu sozinho - pergunta se quer tentar reconectar, em vez de so sumir e
    deixar o aparelho parado sem explicar o motivo."""

    def __init__(self, parent, serial: str, model: str, on_retry, on_close=None):
        super().__init__(parent)
        self.withdraw()
        self.title("Espelhamento desconectado")
        self.resizable(False, False)
        self.transient(parent)
        self.attributes("-topmost", True)
        self.protocol("WM_DELETE_WINDOW", self.destroy)

        ttk.Label(self, text="Espelhamento desconectado", font=FONT_BOLD).pack(padx=DIALOG_OUTER_PAD, pady=(16, 4))
        ttk.Label(
            self, text=f"A conexao com {model} foi interrompida.",
            foreground="#57606a", justify="center", wraplength=DIALOG_MESSAGE_WRAPLENGTH,
        ).pack(padx=DIALOG_OUTER_PAD, pady=(0, 14))

        btns = ttk.Frame(self)
        btns.pack(pady=(0, 16))
        ttk.Button(btns, text="Sair", command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text="Reconectar", command=self._retry, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

        self.on_retry = on_retry
        self.on_close = on_close
        _center_on_parent(self, parent)

    def _retry(self):
        self.on_retry()
        self.destroy()

    def destroy(self):
        if self.on_close:
            self.on_close()
            self.on_close = None
        super().destroy()


class DeviceRow:
    def __init__(self, parent, serial: str, callbacks: dict):
        self.serial = serial
        self.callbacks = callbacks
        self.status = None
        self.recording = False
        self.recording_anchor: float | None = None  # time.monotonic() de referencia local
        self.model_name = serial

        # borda fina (1px) ao redor de cada linha, pra parecer um "cartao" separado
        self.border = tk.Frame(parent, bg="#d0d7de")
        self.frame = ttk.Frame(self.border, padding=(12, 10), style="Card.TFrame")
        self.frame.pack(fill="both", expand=True, padx=1, pady=1)
        self.frame.columnconfigure(1, weight=1)

        self.dot = tk.Canvas(self.frame, width=12, height=12, highlightthickness=0,
                              bg="#ffffff", bd=0)
        self.dot.grid(row=0, column=0, rowspan=2, padx=(0, 12))
        self.dot_id = self.dot.create_oval(1, 1, 11, 11, fill="#999999", outline="")

        self.model_label = ttk.Label(self.frame, font=("Segoe UI", 10, "bold"), style="Card.TLabel")
        self.model_label.grid(row=0, column=1, sticky="w")

        self.detail_label = ttk.Label(self.frame, foreground="#57606a", font=("Segoe UI", 8),
                                       style="CardMuted.TLabel")
        self.detail_label.grid(row=1, column=1, sticky="w", pady=(2, 0))

        actions = ttk.Frame(self.frame, style="Card.TFrame")
        actions.grid(row=0, column=2, rowspan=2, padx=(10, 0))

        self.toggle_btn = ttk.Button(actions, command=self._toggle, width=9, compound="left",
                                      style="Toggle.TButton")
        self.toggle_btn.pack(side="left", padx=(0, 8))

        icons_box = ttk.Frame(actions, style="Card.TFrame")
        icons_box.pack(side="left")

        self.wifi_btn = ttk.Button(icons_box, image=get_icon("wifi", 15, "#1f6feb"),
                                    command=self._wifi, style="Icon.TButton")
        self.wifi_btn.pack(side="left", padx=1)

        self.screenshot_btn = ttk.Button(icons_box, image=get_icon("camera", 15, "#57606a"),
                                          command=self._screenshot, style="Icon.TButton")
        self.screenshot_btn.pack(side="left", padx=1)

        self.record_btn = ttk.Button(icons_box, command=self._record, style="Icon.TButton")
        self.record_btn.pack(side="left", padx=1)

        self.settings_btn = ttk.Button(icons_box, image=get_icon("gear", 15, "#57606a"),
                                        command=self._settings, style="Icon.TButton")
        self.settings_btn.pack(side="left", padx=1)

    def _toggle(self):
        self.callbacks["toggle"](self.serial, self.status)

    def _record(self):
        self.callbacks["record"](self.serial, self.recording)

    def _wifi(self):
        self.callbacks["wifi"](self.serial)

    def _screenshot(self):
        self.callbacks["screenshot"](self.serial)

    def _settings(self):
        self.callbacks["settings"](self.serial)

    def _render_model_text(self):
        text = self.model_name
        if self.recording_anchor is not None:
            secs = int(time.monotonic() - self.recording_anchor)
            text += f"   ● Gravando {secs // 60:02d}:{secs % 60:02d}"
        self.model_label.config(text=text, foreground="#cf222e" if self.recording_anchor is not None else "")

    def refresh_timer(self):
        """Chamado a cada 1s pela janela principal - atualiza so o cronometro, sem
        esperar o proximo ciclo de verificacao (que e a cada alguns segundos)."""
        if self.recording_anchor is not None:
            self._render_model_text()

    def update(self, info: dict):
        self.status = info["status"]
        self.recording = info.get("recording", False)
        self.model_name = info["model"]
        label, color = STATUS_LABELS.get(self.status, (self.status, "#000000"))
        self.dot.itemconfig(self.dot_id, fill=color)

        if self.recording:
            if self.recording_anchor is None:
                self.recording_anchor = time.monotonic() - (info.get("recording_seconds") or 0)
        else:
            self.recording_anchor = None
        self._render_model_text()

        detail = f"{self.serial}"
        if info["status"] == "mirroring" and info.get("port"):
            detail += f"  |  porta {info['port']}  |  {label}"
        elif info["status"] == "problem" and info.get("hint"):
            detail += f"  |  {info['hint']}"
        else:
            detail += f"  |  {label}"
        self.detail_label.config(text=detail)

        if self.status == "mirroring":
            self.toggle_btn.config(text="Parar", image=get_icon("stop", 13, "#cf222e"), state="normal")
        elif self.status in ("ready", "blocked"):
            self.toggle_btn.config(text="Iniciar", image=get_icon("play", 13, "#1a7f37"), state="normal")
        else:
            self.toggle_btn.config(text="Iniciar", image=get_icon("play", 13, "#1a7f37"), state="disabled")

        is_wireless = ":" in self.serial
        can_touch = self.status in ("mirroring", "ready", "blocked")
        self.wifi_btn.config(state="normal" if (can_touch and not is_wireless) else "disabled")
        self.settings_btn.config(state="normal" if can_touch else "disabled")
        self.screenshot_btn.config(state="normal" if can_touch else "disabled")

        if self.recording:
            self.record_btn.config(image=get_icon("stop", 13, "#cf222e"),
                                    state="normal" if self.status == "mirroring" else "disabled")
        else:
            self.record_btn.config(image=get_icon("record", 13, "#cf222e"),
                                    state="normal" if self.status == "mirroring" else "disabled")

    def flash(self):
        """Pisca a borda do cartao (fallback de feedback quando nao ha janela de
        video pra sobrepor - aparelho nao esta espelhando no momento)."""
        original = self.border.cget("bg")

        def step(n):
            if n <= 0 or not self.border.winfo_exists():
                if self.border.winfo_exists():
                    self.border.config(bg=original)
                return
            self.border.config(bg="#1f6feb" if n % 2 else original)
            self.border.after(90, lambda: step(n - 1))

        step(4)

    def destroy(self):
        self.border.destroy()


class App:
    BLUE = "#1f6feb"  # cor de identidade do app (icone/bandeja/topo), estilo Vysor

    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("MirrorPanel")
        root.geometry("640x580")
        root.minsize(520, 380)
        root.configure(bg="#f6f8fa")

        self._window_icon_img = ImageTk.PhotoImage(icons.app_icon(64))
        root.iconphoto(True, self._window_icon_img)

        self._setup_styles()

        self.manager = engine.MirrorManager()
        self.event_queue: "queue.Queue" = queue.Queue()
        self.action_queue: "queue.Queue" = queue.Queue()
        self.wake_event = threading.Event()
        self.stop_event = threading.Event()
        self.disconnect_dialogs: dict = {}
        self.rows: dict[str, DeviceRow] = {}
        self.first_tick_done = False
        self.tray_icon = None

        self._build_ui()
        self._log("Painel iniciado. Detectando dispositivos...")
        self._setup_tray()

        self.worker = threading.Thread(target=self._background_loop, daemon=True)
        self.worker.start()

        root.protocol("WM_DELETE_WINDOW", self._on_close)
        root.bind("<Unmap>", self._on_unmap)
        self.root.after(250, self._drain_queue)
        self.root.after(1000, self._tick_timers)

    def _tick_timers(self):
        for row in self.rows.values():
            row.refresh_timer()
        self.root.after(1000, self._tick_timers)

    def _setup_styles(self):
        # Fonte padrao pra TUDO (inclusive widgets tk.* que nao herdam do ttk.Style,
        # como Label/Text avulsos): "*Font" e um wildcard do Tk que cobre qualquer
        # widget sem fonte propria explicita. Widgets com font=(...) definido no
        # proprio construtor continuam mandando (isso aqui e so o padrao/fallback).
        self.root.option_add("*Font", FONT_DEFAULT)

        style = ttk.Style(self.root)
        try:
            style.theme_use("vista")
        except tk.TclError:
            pass
        style.configure(".", font=FONT_DEFAULT)  # padrao pra todos os widgets ttk
        style.configure("Card.TFrame", background="#ffffff")
        style.configure("Card.TLabel", background="#ffffff", font=("Segoe UI", 10, "bold"))
        style.configure("CardMuted.TLabel", background="#ffffff", foreground="#57606a")
        style.configure("Icon.TButton", padding=3)
        style.configure("Toggle.TButton", font=("Segoe UI", 9, "bold"))
        style.configure("Summary.TLabel", font=("Segoe UI", 9, "bold"), foreground="#24292f")
        style.configure("Header.TLabel", font=("Segoe UI", 9, "bold"), foreground="#24292f")

        style.configure("Blue.TCheckbutton", background=self.BLUE, foreground="white",
                         font=("Segoe UI", 9))
        style.map("Blue.TCheckbutton", background=[("active", self.BLUE)])

        style.configure("Update.TButton", font=("Segoe UI", 8), foreground=self.BLUE, padding=(8, 3))
        style.map("Update.TButton", foreground=[("disabled", "#8c959f")])

    # ---------------------------------------------------------------- UI --
    def _build_ui(self):
        top = tk.Frame(self.root, bg=self.BLUE, padx=14, pady=12)
        top.pack(fill="x")

        row1 = tk.Frame(top, bg=self.BLUE)
        row1.pack(fill="x")
        tk.Label(row1, text="MirrorPanel", bg=self.BLUE, fg="white",
                 font=("Segoe UI", 11, "bold")).pack(side="left")
        self.summary_label = tk.Label(row1, text="Carregando...", bg=self.BLUE, fg="white",
                                       font=("Segoe UI", 9, "bold"))
        self.summary_label.pack(side="right")

        tk.Label(top, text="Clique Abrir para espelhar um aparelho especifico.",
                 bg=self.BLUE, fg="#dbe9ff", font=("Segoe UI", 8)).pack(anchor="w", pady=(2, 0))

        row2 = tk.Frame(top, bg=self.BLUE)
        row2.pack(fill="x", pady=(8, 0))
        self.stay_awake_var = tk.BooleanVar(value=self.manager.stay_awake)
        ttk.Checkbutton(
            row2, text="Manter tela do celular sempre ligada",
            variable=self.stay_awake_var, command=self._toggle_stay_awake,
            style="Blue.TCheckbutton",
        ).pack(side="left")

        self.content = ttk.Frame(self.root)
        self.content.pack(fill="both", expand=True)

        self.loading_frame = ttk.Frame(self.content)
        self.loading_frame.pack(fill="both", expand=True)
        loading_box = ttk.Frame(self.loading_frame)
        loading_box.place(relx=0.5, rely=0.45, anchor="center")
        ttk.Label(loading_box, text="Carregando dispositivos ADB...",
                  font=("Segoe UI", 10)).pack(pady=(0, 10))
        self.loading_bar = ttk.Progressbar(loading_box, mode="indeterminate", length=220)
        self.loading_bar.pack()
        self.loading_bar.start(12)

        self.list_frame = ttk.Frame(self.content, padding=(14, 10))
        self.empty_label = ttk.Label(
            self.list_frame, text="Nenhum dispositivo detectado ainda.\nConecte um celular por USB.",
            foreground="#57606a", justify="center",
        )
        self.empty_label.pack(pady=40)

        bottom = ttk.Frame(self.root, padding=(14, 6))
        bottom.pack(fill="x")
        ttk.Label(bottom, text="Atividade recente", style="Header.TLabel").pack(side="left")
        ttk.Button(
            bottom, text=" Verificar atualizacoes", image=get_icon("refresh", 13, "#1f6feb"),
            compound="left", style="Update.TButton", command=self._on_check_update,
        ).pack(side="right")

        log_border = tk.Frame(self.root, bg="#d0d7de")
        log_border.pack(fill="x", padx=14, pady=(0, 8))
        self.log_text = tk.Text(log_border, height=6, state="disabled", font=("Consolas", 8),
                                 bg="#f6f8fa", relief="flat", padx=8, pady=6)
        self.log_text.pack(fill="x", padx=1, pady=1)

        footer = ttk.Frame(self.root, padding=(14, 0, 14, 10))
        footer.pack(fill="x")
        ttk.Label(footer, text="Minimizar manda para a bandeja. Fechar encerra os espelhamentos abertos.",
                  foreground="#57606a", font=FONT_MUTED).pack(side="left")
        ttk.Label(footer, text=f"v{updater.APP_VERSION}",
                  foreground="#8c959f", font=FONT_MUTED).pack(side="right")

    def _toggle_stay_awake(self):
        self.action_queue.put({"type": "set_stay_awake", "value": self.stay_awake_var.get()})
        self.wake_event.set()

    def _log(self, msg: str):
        self.log_text.config(state="normal")
        self.log_text.insert("end", f"{msg}\n")
        self.log_text.see("end")
        self.log_text.config(state="disabled")

    # ------------------------------------------------------------- tray --
    def _setup_tray(self):
        image = icons.app_icon(64)
        menu = pystray.Menu(
            pystray.MenuItem("Abrir painel", self._tray_open, default=True),
            pystray.MenuItem("Sair", self._tray_exit),
        )
        self.tray_icon = pystray.Icon("MirrorPanel", image, "MirrorPanel", menu)
        threading.Thread(target=self.tray_icon.run, daemon=True).start()

    def _tray_open(self, icon=None, item=None):
        self.root.after(0, self._restore_window)

    def _restore_window(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def _ensure_window_visible(self):
        """Traz o painel de volta da bandeja antes de abrir um dialogo disparado
        por um evento em segundo plano (queda de conexao, atualizacao disponivel).
        Sem isso, o dialogo seria centralizado sobre uma janela escondida - o
        que faz ele nascer fora do lugar (ou nem aparecer de verdade)."""
        if self.root.state() in ("withdrawn", "iconic"):
            self._restore_window()

    def _tray_exit(self, icon=None, item=None):
        self.root.after(0, self._on_close)

    def _on_unmap(self, event):
        if event.widget is self.root and self.root.state() == "iconic":
            self.root.withdraw()

    # ---------------------------------------------------- thread de fundo --
    def _background_loop(self):
        missing = engine.check_binaries()
        if missing:
            self.event_queue.put(("fatal", "Faltando: " + ", ".join(missing)))
            return

        engine.setup_logging()
        try:
            engine.run_adb("start-server", timeout=15)
        except Exception:
            pass
        engine.kill_existing_scrcpy()

        self._run_update_check()

        while not self.stop_event.is_set():
            try:
                while not self.action_queue.empty():
                    self._handle_action(self.action_queue.get())

                events = self.manager.tick()
                self.event_queue.put(("tick", events, self.manager.snapshot()))
            except Exception:
                # Nunca deixa a thread morrer (cabo arrancado, rede caiu, etc.) -
                # loga e segue pro proximo ciclo. Sem isso, uma excecao aqui deixaria
                # a UI "viva" mas parada pra sempre, sem nenhum aviso ao usuario.
                logging.exception("Erro no ciclo de verificacao - continuando")

            self.wake_event.wait(engine.POLL_INTERVAL_SECONDS)
            self.wake_event.clear()

    def _handle_action(self, action: dict):
        kind = action["type"]
        serial = action.get("serial")
        try:
            self._dispatch_action(kind, serial, action)
        except Exception:
            logging.exception("Erro ao processar acao %s para %s", kind, serial)

    def _dispatch_action(self, kind: str, serial: str, action: dict):
        if kind == "start":
            self.manager.start_device(serial)
        elif kind == "stop":
            self.manager.stop_device(serial)
        elif kind == "restart":
            self.manager.stop_device(serial)
            time.sleep(1)
            self.manager.start_device(serial)
        elif kind == "wifi":
            target = self.manager.enable_wifi(serial)
            self.event_queue.put(("wifi_result", serial, target))
        elif kind == "save_settings":
            self.manager.set_device_settings(serial, action["settings"])
            if serial in self.manager.active:
                self.manager.stop_device(serial)
                time.sleep(1)
                self.manager.start_device(serial)
        elif kind == "set_stay_awake":
            self.manager.set_stay_awake(action["value"])
        elif kind == "start_recording":
            path = self.manager.start_recording(serial, action.get("folder"), action.get("light", False))
            self.event_queue.put(("record_result", serial, True, path))
        elif kind == "stop_recording":
            self.manager.stop_recording(serial)
            self.event_queue.put(("record_result", serial, False, None))
        elif kind == "screenshot":
            path = self.manager.take_screenshot(serial)
            self.event_queue.put(("screenshot_result", serial, path))
        elif kind == "copy_screenshot":
            ok = self.manager.copy_image_to_clipboard(action["path"])
            self.event_queue.put(("clipboard_result", ok))

    # ------------------------------------------------------- thread da UI --
    def _drain_queue(self):
        try:
            while True:
                item = self.event_queue.get_nowait()
                if item[0] == "fatal":
                    messagebox.showerror("MirrorPanel", item[1])
                    self.root.destroy()
                    return
                if item[0] == "wifi_result":
                    _, serial, target = item
                    model = self.manager.model_cache.get(serial, serial)
                    if target:
                        self._log(f"[wifi] {model} conectado sem fio em {target}. Pode tirar o cabo.")
                    else:
                        self._log(f"[wifi] Nao foi possivel ativar Wi-Fi em {model}. "
                                   f"Confira se o celular esta na mesma rede.")
                    continue
                if item[0] == "record_result":
                    _, serial, started, path = item
                    model = self.manager.model_cache.get(serial, serial)
                    if started:
                        self._log(f"[gravar] Gravando {model} em {path}")
                    else:
                        self._log(f"[gravar] Gravacao de {model} salva.")
                    continue
                if item[0] == "screenshot_result":
                    _, serial, path = item
                    model = self.manager.model_cache.get(serial, serial)
                    if path:
                        self._log(f"[print] Screenshot de {model} salvo em {path}")
                        ScreenshotConfirmDialog(self.root, on_copy=lambda p=path: self._on_copy_screenshot(p))
                    else:
                        self._log(f"[print] Falha ao tirar screenshot de {model}.")
                    continue
                if item[0] == "clipboard_result":
                    _, ok = item
                    if ok:
                        self._log("[print] Copiado para a area de transferencia (Win+V pra ver).")
                    else:
                        self._log("[print] Nao foi possivel copiar para a area de transferencia.")
                    continue
                if item[0] == "update_check_result":
                    result = item[1]
                    if result["status"] == "update":
                        info = result["info"]
                        self._log(f"[update] Nova versao disponivel: {info['version']}")
                        self._ensure_window_visible()
                        UpdateDialog(self.root, info, on_accept=lambda: self._start_update_download(info))
                    elif result["status"] == "current":
                        self._log(f"[update] Voce esta atualizado (versao {updater.APP_VERSION}).")
                    else:
                        self._log("[update] Nao foi possivel verificar atualizacoes agora "
                                   "(sem internet ou GitHub indisponivel).")
                    continue
                if item[0] == "download_progress":
                    _, downloaded, total = item
                    if getattr(self, "download_dialog", None):
                        self.download_dialog.set_progress(downloaded, total)
                    continue
                if item[0] == "download_done":
                    _, success, path = item
                    if getattr(self, "download_dialog", None):
                        self.download_dialog.destroy()
                        self.download_dialog = None
                    if success:
                        self._log("[update] Download concluido. Aplicando atualizacao...")
                        self._apply_update(path)
                    else:
                        messagebox.showerror(
                            "MirrorPanel",
                            "Falha ao baixar a atualizacao. Tente novamente mais tarde.",
                        )
                    continue

                _, events, snapshot = item
                if not self.first_tick_done:
                    self.first_tick_done = True
                    self.loading_bar.stop()
                    self.loading_frame.pack_forget()
                    self.list_frame.pack(fill="both", expand=True)
                self._handle_events(events)
                self._render(snapshot)
        except queue.Empty:
            pass
        self.root.after(250, self._drain_queue)

    def _handle_events(self, events):
        for ev in events:
            t = ev.get("type")
            if t == "arrived":
                self._log(f"[+] {ev['model']} conectado (porta {ev['port']})")
            elif t == "departed":
                self._log(f"[-] {ev['model']} desconectado")
                self._show_disconnect_dialog(ev["serial"], ev["model"])
            elif t == "crashed":
                self._log(f"[!] {ev['model']} encerrou sozinho (tentativa {ev['attempt']})")
                self._show_disconnect_dialog(ev["serial"], ev["model"])
            elif t == "blocked":
                self._log(f"[!] {ev['model']} falhou varias vezes - veja logs/scrcpy_{ev['serial']}.log")
            elif t == "problem":
                self._log(f"[aviso] {ev['serial']}: {ev['hint']}")
            elif t == "error":
                self._log(f"[!] Falha ao iniciar {ev['serial']}")

    def _render(self, snapshot: dict):
        self.summary_label.config(text=f"{len(snapshot)} dispositivo(s)")

        if snapshot:
            self.empty_label.pack_forget()
        else:
            self.empty_label.pack(pady=40)

        for serial in list(self.rows):
            if serial not in snapshot:
                self.rows[serial].destroy()
                del self.rows[serial]

        callbacks = {"toggle": self._on_toggle, "wifi": self._on_wifi, "settings": self._on_settings,
                     "record": self._on_record, "screenshot": self._on_screenshot}
        for serial, info in sorted(snapshot.items(), key=lambda kv: kv[1]["model"]):
            if serial not in self.rows:
                row = DeviceRow(self.list_frame, serial, callbacks)
                row.border.pack(fill="x", pady=(0, 6))
                self.rows[serial] = row
            self.rows[serial].update(info)

    def _on_toggle(self, serial: str, status: str):
        kind = "stop" if status == "mirroring" else "start"
        self.action_queue.put({"type": kind, "serial": serial})
        self.wake_event.set()

    def _show_disconnect_dialog(self, serial: str, model: str):
        existing = self.disconnect_dialogs.get(serial)
        if existing:
            existing.destroy()
        self._ensure_window_visible()
        dlg = MirroringDisconnectedDialog(
            self.root, serial, model,
            on_retry=lambda s=serial: self._retry_after_disconnect(s),
            on_close=lambda s=serial: self.disconnect_dialogs.pop(s, None),
        )
        self.disconnect_dialogs[serial] = dlg

    def _retry_after_disconnect(self, serial: str):
        model = self.manager.model_cache.get(serial, serial)
        self._log(f"[+] Tentando reconectar {model}...")
        self.action_queue.put({"type": "start", "serial": serial})
        self.wake_event.set()

    def _on_wifi(self, serial: str):
        model = self.manager.model_cache.get(serial, serial)
        self._log(f"[wifi] Ativando Wi-Fi em {model}...")
        self.action_queue.put({"type": "wifi", "serial": serial})
        self.wake_event.set()

    def _on_screenshot(self, serial: str):
        self._flash_screenshot_feedback(serial)
        self.action_queue.put({"type": "screenshot", "serial": serial})
        self.wake_event.set()

    def _flash_screenshot_feedback(self, serial: str):
        """Feedback visual imediato (nao espera o print terminar de verdade).
        Se o aparelho esta espelhando, pisca em cima da janela de video dele;
        senao (print sem estar espelhando), pisca a propria linha no painel."""
        dev = self.manager.active.get(serial)
        if dev:
            rect = engine.get_window_rect_of_pid(dev.proc.pid)
            if rect:
                ScreenshotFlash(self.root, rect)
                return
        row = self.rows.get(serial)
        if row:
            row.flash()

    def _on_copy_screenshot(self, path: str):
        self.action_queue.put({"type": "copy_screenshot", "path": path})
        self.wake_event.set()

    def _run_update_check(self):
        """Consulta o GitHub e sempre reporta o resultado (atualizado, nova
        versao ou falha na verificacao) - chamado no inicio e pelo botao manual."""
        try:
            result = updater.check_for_update_detailed()
        except Exception:
            logging.exception("Erro ao verificar atualizacao")
            result = {"status": "error", "info": None}
        self.event_queue.put(("update_check_result", result))

    def _on_check_update(self):
        self._log("[update] Verificando atualizacoes...")
        threading.Thread(target=self._run_update_check, daemon=True).start()

    def _start_update_download(self, info: dict):
        self.download_dialog = DownloadProgressDialog(self.root)
        dest = updater.get_download_path(info["asset_name"])

        def worker():
            def on_progress(downloaded, total):
                self.event_queue.put(("download_progress", downloaded, total))
            ok = updater.download_update(info["url"], dest, on_progress)
            self.event_queue.put(("download_done", ok, dest))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_update(self, installer_path: str):
        # encerra os espelhamentos/gravacoes com calma antes de atualizar, pra
        # nao corromper um arquivo de gravacao em andamento
        self.manager.shutdown()
        if self.tray_icon:
            try:
                self.tray_icon.stop()
            except Exception:
                pass
        try:
            # o servidor do adb fica rodando em segundo plano por design (pra ficar
            # "quente" entre uma abertura e outra do programa) - isso segura o
            # arquivo adb.exe e faz o instalador abortar a atualizacao inteira
            # (Restart Manager nao consegue fechar, e o instalador desiste).
            engine.run_adb("kill-server", timeout=10)
        except Exception:
            logging.exception("Falha ao encerrar o servidor adb antes de atualizar")
        # se tudo der certo, apply_update_and_restart encerra o processo (os._exit)
        # e o codigo abaixo nunca roda. So chega aqui se algo falhar de forma
        # detectavel - antes, isso sumia silenciosamente e a atualizacao "nao fazia nada".
        error = updater.apply_update_and_restart(installer_path)
        if error:
            self._log(f"[update] {error}")
            messagebox.showerror("MirrorPanel", f"Falha ao aplicar a atualizacao:\n{error}")

    def _on_record(self, serial: str, currently_recording: bool):
        if currently_recording:
            self.action_queue.put({"type": "stop_recording", "serial": serial})
            self.wake_event.set()
            return

        model = self.manager.model_cache.get(serial, serial)

        def on_start(folder, light):
            self.action_queue.put({
                "type": "start_recording", "serial": serial, "folder": folder, "light": light,
            })
            self.wake_event.set()

        RecordingDialog(self.root, model, self.manager.last_recording_folder, on_start)

    def _on_settings(self, serial: str):
        model = self.manager.model_cache.get(serial, serial)
        current = self.manager.get_device_settings(serial)

        def on_save(settings):
            self.action_queue.put({"type": "save_settings", "serial": serial, "settings": settings})
            self.wake_event.set()
            self._log(f"[config] Ajustes salvos para {model}.")

        SettingsDialog(self.root, serial, model, current, on_save)

    def _on_close(self):
        self.stop_event.set()
        self.wake_event.set()
        self.manager.shutdown()
        if self.tray_icon:
            try:
                self.tray_icon.stop()
            except Exception:
                pass
        self.root.destroy()


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()

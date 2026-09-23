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
from collections import deque
from pathlib import Path
from tkinter import ttk, messagebox, filedialog
from tkinter import font as tkfont

import pystray
import qrcode
import sv_ttk
from PIL import ImageTk

from mirrorpanel import icons
from mirrorpanel import i18n
from mirrorpanel import mirror_engine as engine
from mirrorpanel import updater
from mirrorpanel.typography import load_font_family
from mirrorpanel.i18n import t

# Native Windows typography; monospace is reserved for time and shortcuts.
FONT_FAMILY = load_font_family()
FONT_DEFAULT = (FONT_FAMILY, 10)
FONT_BOLD = (FONT_FAMILY, 10, "bold")
FONT_MUTED = (FONT_FAMILY, 9)

BG = "#1c1c1c"
SURFACE = "#25272a"
BORDER = "#3b3e43"
FG = "#f1f2f4"
FG_MUTED = "#b0b5be"
FG_SUBTLE = "#9299a5"
ACCENT = "#9bbcf2"
GREEN = "#8ac6a3"
AMBER = "#e2bc7d"
RED = "#ee9b9f"
LOG_BG = "#202225"
HOVER = "#34383e"


LOG_MAX_LINES = 500      # nao deixa a Atividade recente crescer pra sempre numa sessao longa


def _status_labels():
    """Funcao (nao dict fixo) porque depende do idioma atual - so e chamada
    depois que i18n.init_language() ja rodou."""
    return {
        "mirroring": (t("status.mirroring"), GREEN),
        "ready": (t("status.ready"), FG_MUTED),
        "problem": (t("status.problem"), AMBER),
        "blocked": (t("status.blocked"), RED),
    }


def _bitrate_options():
    return [
        (t("settings.bitrate.low"), "2M"),
        (t("settings.bitrate.medium"), "4M"),
        (t("settings.bitrate.high"), "8M"),
        (t("settings.bitrate.veryhigh"), "16M"),
    ]


def _fps_options():
    return [
        (t("settings.fps.30"), 30),
        (t("settings.fps.60"), 60),
        (t("settings.fps.90"), 90),
    ]


def _problem_hint_text(state: str | None) -> str:
    """O motor (mirror_engine.py) so expoe o ESTADO cru do adb (unauthorized,
    offline etc.) - traduzir esse estado numa dica legivel e trabalho da
    interface, nao dele (o motor nao sabe de idioma nenhum)."""
    if state == "unauthorized":
        return t("hint.unauthorized")
    if state == "offline":
        return t("hint.offline")
    return state or ""


_icon_cache: dict = {}

# Espacamentos e regras padrao de TODAS as janelas de dialogo (pop-ups) - os
# mesmos valores em todo lugar da um ar desenhado, nao remendado.
DIALOG_OUTER_PAD = 24                        # margem externa ao redor do conteudo do dialogo
DIALOG_FORM_PAD = {"padx": 14, "pady": 6}    # espaco entre linhas de formulario (rotulo + campo)
DIALOG_MESSAGE_WRAPLENGTH = 380              # quebra de linha automatica de textos de aviso/mensagem
DIALOG_BUTTON_WIDTH = 12                     # largura minima dos botoes de acao, pra ficarem parelhos


def get_icon(name: str, size: int, color: str):
    key = (name, size, color)
    if key not in _icon_cache:
        img = getattr(icons, name)(size, color)
        _icon_cache[key] = ImageTk.PhotoImage(img)
    return _icon_cache[key]


def _apply_dark_titlebar(window: tk.Misc):
    """Forca a barra de titulo NATIVA do Windows (fechar/minimizar/maximizar) a
    seguir o tema escuro (DWMWA_USE_IMMERSIVE_DARK_MODE) - sem isso, so o
    INTERIOR da janela fica escuro e a moldura do Windows continua branca,
    quebrando a harmonia do dark mode. Isso so pede pro Windows pintar a
    barra de titulo DELE mesmo de escuro - nao troca a barra por uma customizada,
    entao snap layout, cantos arredondados e sombra nativos do Windows 11
    continuam intactos.

    winfo_id() devolve o HWND da area de DESENHO do Tk, que fica DENTRO da
    janela decorada de verdade (a que tem a barra de titulo) - GetParent() sobe
    um nivel e pega o HWND certo, que e o que a API do DWM espera receber.
    """
    try:
        window.update_idletasks()
        hwnd = ctypes.windll.user32.GetParent(window.winfo_id())
        value = ctypes.c_int(1)
        # 20 = valor oficial (Windows 10 versao 2004+ e Windows 11); builds do
        # Windows 10 anteriores a essa usavam o valor (nao documentado) 19 pro
        # mesmo efeito - tenta os dois, fica no primeiro que o Windows aceitar.
        for attribute in (20, 19):
            result = ctypes.windll.dwmapi.DwmSetWindowAttribute(
                hwnd, attribute, ctypes.byref(value), ctypes.sizeof(value))
            if result == 0:
                break
    except Exception:
        pass


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
    win.configure(bg=BG)
    parent.update_idletasks()
    win.update_idletasks()
    _apply_dark_titlebar(win)  # antes do deiconify() - senao a moldura clara pisca por um instante
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


class Tooltip:
    """Dica de texto ao passar o mouse - usada nos botoes so-icone (sem texto
    visivel) do cartao de aparelho, pra nao alargar a linha mas ainda deixar
    claro pra que serve cada um. Espera um instante antes de mostrar, pra nao
    piscar toda vez que o mouse so passa de raspao por cima do botao."""

    DELAY_MS = 450

    def __init__(self, widget: tk.Widget, text: str = ""):
        self.widget = widget
        self.text = text
        self._after_id = None
        self._tip: tk.Toplevel | None = None
        self._label: tk.Label | None = None
        widget.bind("<Enter>", self._schedule, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def set_text(self, text: str):
        self.text = text
        # atualiza o tooltip ja visivel tambem, se for o caso (ex: gravacao
        # parou com o mouse ainda em cima do botao) - senao ficava mostrando
        # a acao errada ate o mouse sair e entrar de novo.
        if self._label is not None and self._label.winfo_exists():
            self._label.config(text=text)
            self._reposition()

    def _schedule(self, _event=None):
        self._cancel_pending()
        self._after_id = self.widget.after(self.DELAY_MS, self._show)

    def _cancel_pending(self):
        if self._after_id is not None:
            self.widget.after_cancel(self._after_id)
            self._after_id = None

    def _show(self):
        self._after_id = None
        # o aparelho pode ter sido desconectado (linha removida) enquanto o
        # temporizador contava - sem essa checagem, criar o tooltip num botao
        # ja destruido lanca TclError
        if self._tip is not None or not self.text or not self.widget.winfo_exists():
            return
        self._tip = tk.Toplevel(self.widget)
        self._tip.overrideredirect(True)
        self._tip.attributes("-topmost", True)
        border = tk.Frame(self._tip, bg=BORDER)
        border.pack()
        self._label = tk.Label(border, text=self.text, bg=SURFACE, fg=FG, font=FONT_MUTED,
                                padx=8, pady=3)
        self._label.pack(padx=1, pady=1)
        self._reposition()

    def _reposition(self):
        self._tip.update_idletasks()
        x = self.widget.winfo_rootx() + self.widget.winfo_width() // 2 - self._tip.winfo_width() // 2
        y = self.widget.winfo_rooty() + self.widget.winfo_height() + 6
        sw = self._tip.winfo_screenwidth()
        x = max(0, min(x, sw - self._tip.winfo_width()))
        self._tip.geometry(f"+{x}+{y}")

    def _hide(self, _event=None):
        self._cancel_pending()
        if self._tip is not None:
            self._tip.destroy()
            self._tip = None
            self._label = None


def _dialog_heading(window, title, subtitle):
    header = ttk.Frame(window, padding=(DIALOG_OUTER_PAD, 22, DIALOG_OUTER_PAD, 20))
    header.pack(fill="x")
    ttk.Label(header, text=title, style="DialogTitle.TLabel").pack(anchor="w")
    ttk.Label(header, text=subtitle, foreground=FG_MUTED, wraplength=420,
              justify="left").pack(anchor="w", pady=(6, 0))


def _dialog_actions(window, label, command, cancel=True):
    footer = ttk.Frame(window, padding=(DIALOG_OUTER_PAD, 20, DIALOG_OUTER_PAD, 20))
    footer.pack(fill="x")
    ttk.Button(footer, text=label, command=command, style="Accent.TButton",
               width=DIALOG_BUTTON_WIDTH).pack(side="right")
    if cancel:
        ttk.Button(footer, text=t("btn.cancel"), command=window.destroy,
                   width=DIALOG_BUTTON_WIDTH).pack(side="right", padx=(0, 8))


class SettingsDialog(tk.Toplevel):
    """Ajuste de qualidade por aparelho, com hierarquia de video e audio."""

    def __init__(self, parent, serial, model, current, on_save):
        super().__init__(parent)
        self.withdraw()
        self.title(t("settings.title", model=model))
        self.resizable(False, False)
        self.transient(parent)
        self.on_save = on_save
        _dialog_heading(self, t("device.quality"), model)
        form = ttk.Frame(self, padding=16, style="Card.TFrame")
        form.pack(fill="x", padx=DIALOG_OUTER_PAD)
        bitrate_options = _bitrate_options()
        fps_options = _fps_options()
        bitrate_by_value = {v: label for label, v in bitrate_options}
        fps_by_value = {v: label for label, v in fps_options}
        self.codec_var = tk.StringVar(value=current.get("video_codec", "h264"))
        self.bitrate_var = tk.StringVar(value=bitrate_by_value.get(current.get("bitrate", "8M"), bitrate_options[2][0]))
        self.fps_var = tk.StringVar(value=fps_by_value.get(current.get("max_fps", 60), fps_options[1][0]))
        fields = (("settings.quality", self.bitrate_var, [label for label, _ in bitrate_options]),
                  ("settings.fps", self.fps_var, [label for label, _ in fps_options]),
                  ("settings.codec", self.codec_var, ["h264", "h265"]))
        for row, (key, variable, values) in enumerate(fields):
            ttk.Label(form, text=t(key), style="Card.TLabel").grid(
                row=row, column=0, sticky="w", padx=(0, 28), pady=8)
            field = ttk.Combobox(form, textvariable=variable, values=values, state="readonly", width=27)
            field.grid(row=row, column=1, sticky="ew", pady=8)
        self.audio_var = tk.BooleanVar(value=current.get("audio", True))
        tk.Frame(form, bg=BORDER, height=1).grid(row=3, column=0, columnspan=2, sticky="ew", pady=12)
        ttk.Checkbutton(form, text=t("settings.audio"), variable=self.audio_var,
                        style="Card.TCheckbutton").grid(row=4, column=0, columnspan=2, sticky="w", pady=(0, 4))
        ttk.Label(self, text=t("settings.restart_hint"), foreground=FG_MUTED, font=FONT_MUTED,
                  wraplength=430, justify="left").pack(padx=DIALOG_OUTER_PAD, pady=(12, 0), anchor="w")
        _dialog_actions(self, t("btn.save"), self._save)
        self.bind("<Escape>", lambda _e: self.destroy())
        _center_on_parent(self, parent)
        self.grab_set()


    def _save(self):
        bitrate_by_label = {l: v for l, v in _bitrate_options()}
        fps_by_label = {l: v for l, v in _fps_options()}
        settings = {
            "video_codec": self.codec_var.get(),
            "bitrate": bitrate_by_label[self.bitrate_var.get()],
            "max_fps": fps_by_label[self.fps_var.get()],
            "audio": self.audio_var.get(),
        }
        self.on_save(settings)
        self.destroy()


class RenameDialog(tk.Toplevel):
    """Apelido customizado por aparelho - so pra diferenciar dois do mesmo
    modelo na lista. Nao muda nada no aparelho, e so cosmetico no painel."""

    def __init__(self, parent, model, current_nickname, on_save):
        super().__init__(parent)
        self.withdraw()
        self.title(t("rename.title", model=model))
        self.resizable(False, False)
        self.transient(parent)
        self.on_save = on_save

        _dialog_heading(self, t("device.tip_rename"), model)
        ttk.Label(self, text=t("rename.label"), foreground=FG_MUTED).pack(
            padx=DIALOG_OUTER_PAD, pady=(0, 8), anchor="w")
        self.name_var = tk.StringVar(value=current_nickname or "")
        entry = ttk.Entry(self, textvariable=self.name_var, width=38)
        entry.pack(padx=DIALOG_OUTER_PAD, fill="x")
        entry.bind("<Return>", lambda _e: self._save())
        self.bind("<Escape>", lambda _e: self.destroy())
        _dialog_actions(self, t("btn.save"), self._save)


        _center_on_parent(self, parent)
        self.grab_set()
        entry.focus_set()
        entry.select_range(0, "end")

    def _save(self):
        self.on_save(self.name_var.get())
        self.destroy()


class RecordingDialog(tk.Toplevel):
    """Confirma qualidade antes de comecar a gravar. O destino e sempre a mesma
    pasta dedicada (MirrorPanel Media, dentro de Videos) - so informa onde vai
    ficar, sem perguntar (uma decisao a menos, organizacao sempre previsivel)."""

    def __init__(self, parent, model, recordings_dir, on_start):
        super().__init__(parent)
        self.withdraw()
        self.title(t("recording.title", model=model))
        self.resizable(False, False)
        self.transient(parent)
        self.on_start = on_start
        _dialog_heading(self, t("device.tip_record"), model)
        form = ttk.Frame(self, padding=16, style="Card.TFrame")
        form.pack(fill="x", padx=DIALOG_OUTER_PAD)
        ttk.Label(form, text=t("recording.save_to"), style="Card.TLabel").pack(anchor="w")
        ttk.Label(form, text=str(recordings_dir), style="CardMuted.TLabel", font=FONT_MUTED,
                  wraplength=400, justify="left").pack(anchor="w", pady=(6, 16))
        tk.Frame(form, bg=BORDER, height=1).pack(fill="x", pady=(0, 16))
        self.light_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(form, text=t("recording.light"), variable=self.light_var,
                        style="Card.TCheckbutton").pack(anchor="w")
        ttk.Label(form, text=t("recording.light_hint"), style="CardMuted.TLabel", font=FONT_MUTED,
                  wraplength=400, justify="left").pack(anchor="w", padx=(28, 0), pady=(6, 0))
        _dialog_actions(self, t("btn.record"), self._start)
        self.bind("<Escape>", lambda _e: self.destroy())
        _center_on_parent(self, parent)
        self.grab_set()


    def _start(self):
        self.on_start(self.light_var.get())
        self.destroy()


class UpdateDialog(tk.Toplevel):
    """Avisa que ha uma versao nova e pergunta se quer atualizar agora."""

    def __init__(self, parent, info: dict, on_accept):
        super().__init__(parent)
        self.withdraw()
        self.title(t("update.title"))
        self.resizable(False, False)
        self.transient(parent)
        self.attributes("-topmost", True)  # sem isso podia nascer atras de outra janela
        self.on_accept = on_accept

        ttk.Label(self, text=t("update.available", version=info['version']),
                  font=(FONT_FAMILY, 10, "bold")).pack(padx=DIALOG_OUTER_PAD, pady=(16, 4), anchor="w")
        ttk.Label(self, text=t("update.notes_header"),
                  foreground=FG_MUTED).pack(padx=DIALOG_OUTER_PAD, anchor="w")

        notes = tk.Text(self, width=52, height=10, wrap="word", font=(FONT_FAMILY, 9),
                         bg=SURFACE, fg=FG, insertbackground=FG, selectbackground=ACCENT,
                         relief="solid", borderwidth=1, highlightthickness=1,
                         highlightbackground=BORDER, highlightcolor=BORDER)
        # A release pode trazer as notas em pt e en juntas (marcadores [pt]/[en]) -
        # mostra so a secao do idioma atual do app, que segue o escolhido no
        # instalador (ver apply_installer_language_marker em mirror_engine.py).
        notes_text = updater.extract_notes_for_language(info["notes"], i18n.get_language())
        notes.insert("1.0", notes_text or t("update.no_notes"))
        notes.config(state="disabled")
        notes.pack(padx=DIALOG_OUTER_PAD, pady=(6, 12))

        btns = ttk.Frame(self)
        btns.pack(pady=(0, 16))
        ttk.Button(btns, text=t("btn.later"), command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text=t("btn.update"), command=self._accept, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

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
        self.title(t("update.downloading_title"))
        self.resizable(False, False)
        self.transient(parent)
        self.protocol("WM_DELETE_WINDOW", lambda: None)

        ttk.Label(self, text=t("update.downloading")).pack(padx=DIALOG_OUTER_PAD, pady=(18, 8))
        self.bar = ttk.Progressbar(self, mode="determinate", length=280, maximum=100)
        self.bar.pack(padx=DIALOG_OUTER_PAD, pady=(0, 6))
        self.pct_label = ttk.Label(self, text="0%", foreground=FG_MUTED)
        self.pct_label.pack(pady=(0, 18))

        _center_on_parent(self, parent)
        self.grab_set()

    def set_progress(self, downloaded: int, total: int):
        if total > 0:
            pct = min(100, int(downloaded * 100 / total))
            self.bar.config(mode="determinate")
            self.bar["value"] = pct
            self.pct_label.config(text=t("update.progress", pct=pct, done=downloaded // 1024, total=total // 1024))
        else:
            self.bar.config(mode="indeterminate")
            self.bar.start(15)
            self.pct_label.config(text=t("update.progress_unknown", done=downloaded // 1024))


class QrPairingDialog(tk.Toplevel):
    """Parear um aparelho novo (nunca conectado por cabo) direto por Wi-Fi -
    mostra um QR code que o proprio Android le em Depuracao via Wi-Fi >
    Parear dispositivo com codigo QR. Fica esperando o celular escanear em
    segundo plano (App._on_qr_pairing cuida disso), sem travar o painel -
    por isso nao e modal, o usuario pode continuar usando o resto da janela
    enquanto isso."""

    def __init__(self, parent, qr_image, on_close=None):
        super().__init__(parent)
        self.withdraw()
        self.title(t("qr_pairing.title"))
        self.resizable(False, False)
        self.transient(parent)
        self.protocol("WM_DELETE_WINDOW", self.destroy)
        self.configure(bg=BG)
        self.on_close = on_close

        _dialog_heading(self, t("qr_pairing.title"), t("qr_pairing.instructions"))

        # fundo branco ao redor do QR - "zona de silencio" que camera de
        # celular precisa pra ler direito, mesmo no tema escuro do painel
        self._qr_img = ImageTk.PhotoImage(qr_image)
        quiet_zone = tk.Frame(self, bg="#ffffff", padx=10, pady=10)
        quiet_zone.pack(padx=DIALOG_OUTER_PAD)
        tk.Label(quiet_zone, image=self._qr_img, bd=0).pack()

        ttk.Label(
            self, text=t("qr_pairing.dev_options_hint"), foreground=FG_SUBTLE,
            font=FONT_MUTED, justify="center", wraplength=280,
        ).pack(padx=DIALOG_OUTER_PAD, pady=(10, 4))

        ttk.Label(self, text=t("qr_pairing.waiting"), foreground=FG_MUTED).pack(pady=(6, 4))
        self.bar = ttk.Progressbar(self, mode="indeterminate", length=280)
        self.bar.pack(padx=DIALOG_OUTER_PAD, pady=(0, 12))
        self.bar.start(12)

        ttk.Button(self, text=t("btn.cancel"), command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(pady=(0, 16))

        _center_on_parent(self, parent)

    def destroy(self):
        if self.on_close:
            self.on_close()
            self.on_close = None
        super().destroy()


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
        self.title(t("screenshot.title"))
        self.resizable(False, False)
        self.transient(parent)
        self.attributes("-topmost", True)

        ttk.Label(self, text=t("screenshot.captured"), font=FONT_BOLD).pack(padx=DIALOG_OUTER_PAD, pady=(16, 4))
        ttk.Label(
            self, text=t("screenshot.copy_question"),
            foreground=FG_MUTED, justify="center", wraplength=DIALOG_MESSAGE_WRAPLENGTH,
        ).pack(padx=DIALOG_OUTER_PAD, pady=(0, 14))

        btns = ttk.Frame(self)
        btns.pack(pady=(0, 16))
        ttk.Button(btns, text=t("btn.no"), command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text=t("btn.yes"), command=self._accept, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

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
        self.title(t("disconnected.title"))
        self.resizable(False, False)
        self.transient(parent)
        self.attributes("-topmost", True)
        self.protocol("WM_DELETE_WINDOW", self.destroy)

        ttk.Label(self, text=t("disconnected.heading"), font=FONT_BOLD).pack(padx=DIALOG_OUTER_PAD, pady=(16, 4))
        ttk.Label(
            self, text=t("disconnected.message", model=model),
            foreground=FG_MUTED, justify="center", wraplength=DIALOG_MESSAGE_WRAPLENGTH,
        ).pack(padx=DIALOG_OUTER_PAD, pady=(0, 14))

        btns = ttk.Frame(self)
        btns.pack(pady=(0, 16))
        ttk.Button(btns, text=t("btn.exit"), command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text=t("btn.reconnect"), command=self._retry, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

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


class ConfirmActionDialog(tk.Toplevel):
    """Dialogo generico de aviso com 2 botoes (titulo + mensagem + cancelar/
    confirmar) - usado tanto pra fechar o painel quanto pra aplicar uma
    atualizacao com gravacao em andamento, pra nao cortar o video sem avisar
    em nenhum dos dois casos (o arquivo em si nao corrompe - o desligamento
    gracioso finaliza certinho - mas o video fica mais curto que o esperado)."""

    def __init__(self, parent, title: str, message: str, confirm_text: str, cancel_text: str, on_confirm):
        super().__init__(parent)
        self.withdraw()
        self.title(title)
        self.resizable(False, False)
        self.transient(parent)
        self.attributes("-topmost", True)
        self.on_confirm = on_confirm

        ttk.Label(self, text=title, font=FONT_BOLD).pack(padx=DIALOG_OUTER_PAD, pady=(16, 4))
        ttk.Label(
            self, text=message,
            foreground=FG_MUTED, justify="center", wraplength=DIALOG_MESSAGE_WRAPLENGTH,
        ).pack(padx=DIALOG_OUTER_PAD, pady=(0, 14))

        btns = ttk.Frame(self)
        btns.pack(pady=(0, 16))
        ttk.Button(btns, text=cancel_text, command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text=confirm_text, command=self._confirm, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

        _center_on_parent(self, parent)
        self.grab_set()

    def _confirm(self):
        self.on_confirm()
        self.destroy()


class AppSettingsDialog(tk.Toplevel):
    """Preferencias aplicadas imediatamente, com descricoes legiveis."""

    def __init__(self, parent, items):
        super().__init__(parent)
        self.withdraw()
        self.title(t("settings.app_title"))
        self.resizable(False, False)
        self.transient(parent)
        _dialog_heading(self, t("app.settings"), t("settings.app_hint"))
        form = ttk.Frame(self, padding=(16, 4), style="Card.TFrame")
        form.pack(fill="x", padx=DIALOG_OUTER_PAD)
        for index, (var, label_key, hint_key, command) in enumerate(items):
            if index:
                tk.Frame(form, bg=BORDER, height=1).pack(fill="x")
            row = ttk.Frame(form, padding=(0, 12), style="Card.TFrame")
            row.pack(fill="x")
            ttk.Checkbutton(row, text=t(label_key), variable=var, command=command,
                            style="Card.TCheckbutton").pack(anchor="w")
            if hint_key:
                ttk.Label(row, text=t(hint_key), style="CardMuted.TLabel", font=FONT_MUTED,
                          wraplength=380, justify="left").pack(padx=(28, 0), pady=(4, 0), anchor="w")
        _dialog_actions(self, t("btn.close"), self.destroy, cancel=False)
        self.bind("<Escape>", lambda _e: self.destroy())
        _center_on_parent(self, parent)
        self.grab_set()




class ShortcutsDialog(tk.Toplevel):
    """Referencia rapida dos atalhos de teclado nativos do scrcpy - eles ja
    funcionam sozinhos (e o proprio scrcpy que trata), mas o usuario nao tem
    como adivinhar que existem sem ler a documentacao dele em separado."""

    def __init__(self, parent):
        super().__init__(parent)
        self.withdraw()
        self.title(t("shortcuts.title"))
        self.resizable(False, False)
        self.transient(parent)

        _dialog_heading(self, t("shortcuts.title"), t("shortcuts.hint"))

        rows = [
            ("MOD+r", t("shortcuts.rotate")),
            ("MOD+h", t("shortcuts.home")),
            ("MOD+b", t("shortcuts.back")),
            ("MOD+s", t("shortcuts.app_switch")),
            ("MOD+n", t("shortcuts.notifications")),
            ("MOD+o", t("shortcuts.screen_off")),
            ("MOD+↑/↓", t("shortcuts.volume")),
            ("MOD+c", t("shortcuts.copy")),
            ("MOD+v", t("shortcuts.paste")),
            ("MOD+g", t("shortcuts.resize")),
            (".apk", t("shortcuts.drop_apk")),
        ]
        grid = ttk.Frame(self, padding=16, style="Card.TFrame")
        grid.pack(padx=DIALOG_OUTER_PAD, pady=(0, 8))
        for i, (key, desc) in enumerate(rows):
            tk.Label(grid, text=key, font=("Consolas", 9), foreground=FG,
                     background=HOVER, padx=8, pady=4).grid(
                         row=i, column=0, sticky="w", padx=(0, 16), pady=4)
            ttk.Label(grid, text=desc, style="CardMuted.TLabel", wraplength=320, justify="left").grid(
                row=i, column=1, sticky="w", pady=4)

        ttk.Label(self, text=t("shortcuts.mod_hint"), foreground=FG_SUBTLE, font=FONT_MUTED).pack(
            padx=DIALOG_OUTER_PAD, pady=(4, 0), anchor="w")

        _dialog_actions(self, t("btn.close"), self.destroy, cancel=False)
        self.bind("<Escape>", lambda _e: self.destroy())

        _center_on_parent(self, parent)
        self.grab_set()


class DeviceRow:
    def __init__(self, parent, serial: str, callbacks: dict):
        self.serial = serial
        self.callbacks = callbacks
        self.status = None
        self.recording = False
        self.recording_anchor: float | None = None  # time.monotonic() de referencia local
        self.display_name = serial

        self.border = tk.Frame(parent, bg=BORDER)
        self.frame = ttk.Frame(self.border, padding=(16, 12), style="Card.TFrame")
        self.frame.pack(fill="both", expand=True, padx=1, pady=1)
        self.frame.columnconfigure(1, weight=1)

        ttk.Label(self.frame, image=get_icon("phone", 30, FG_MUTED),
                  style="Card.TLabel").grid(row=0, column=0, rowspan=2, padx=(0, 14))
        name_box = ttk.Frame(self.frame, style="Card.TFrame")
        name_box.grid(row=0, column=1, sticky="ew")
        name_box.columnconfigure(0, weight=1)
        self.model_label = ttk.Label(name_box, font=(FONT_FAMILY, 12), style="Card.TLabel",
                                     cursor="hand2", anchor="w", width=1)
        self.model_label.grid(row=0, column=0, sticky="ew")
        self.model_label.bind("<Button-1>", lambda _e: self._rename())
        self.rename_btn = ttk.Button(name_box, image=get_icon("edit", 12, FG_SUBTLE),
                                     command=self._rename, style="Icon.TButton")
        self.rename_btn.grid(row=0, column=1, padx=(6, 8))
        Tooltip(self.rename_btn, t("device.tip_rename"))
        self.detail_label = ttk.Label(self.frame, foreground=FG_MUTED, font=FONT_MUTED,
                                      style="CardMuted.TLabel", width=1, anchor="w")
        self.detail_label.grid(row=1, column=1, sticky="ew", pady=(2, 0))

        state_box = ttk.Frame(self.frame, style="Card.TFrame")
        state_box.grid(row=0, column=2, rowspan=2, padx=(16, 14))
        self.status_label = ttk.Label(state_box, style="CardMuted.TLabel", font=FONT_MUTED)
        self.status_label.pack(anchor="e")
        self.recording_label = ttk.Label(state_box, style="Card.TLabel", foreground=RED, font=FONT_MUTED)
        self.recording_label.pack(anchor="e", pady=(3, 0))
        self.toggle_btn = ttk.Button(self.frame, command=self._toggle, width=9,
                                     compound="left", style="Toggle.TButton")
        self.toggle_btn.grid(row=0, column=3, rowspan=2)

        tk.Frame(self.frame, bg=BORDER, height=1).grid(row=2, column=0, columnspan=4,
                                                     sticky="ew", pady=(10, 6))
        actions = ttk.Frame(self.frame, style="Card.TFrame")
        actions.grid(row=3, column=0, columnspan=4, sticky="ew")
        self.wifi_btn = ttk.Button(actions, text=t("device.wifi"), image=get_icon("wifi", 14, FG_MUTED),
                                  compound="left", command=self._wifi, style="CardAction.TButton")
        self.wifi_btn.pack(side="left")
        Tooltip(self.wifi_btn, t("device.tip_wifi"))
        self.send_file_btn = ttk.Button(actions, text=t("device.send"), image=get_icon("upload", 14, FG_MUTED),
                                       compound="left", command=self._send_file, style="CardAction.TButton")
        self.send_file_btn.pack(side="left", padx=(4, 0))
        Tooltip(self.send_file_btn, t("device.tip_send_file"))
        self.screenshot_btn = ttk.Button(actions, text=t("device.capture"), image=get_icon("camera", 14, FG_MUTED),
                                        compound="left", command=self._screenshot, style="CardAction.TButton")
        self.screenshot_btn.pack(side="left", padx=(4, 0))
        Tooltip(self.screenshot_btn, t("device.tip_screenshot"))
        self.record_btn = ttk.Button(actions, text=t("btn.record"), compound="left",
                                    command=self._record, style="CardAction.TButton")
        self.record_btn.pack(side="left", padx=(4, 0))
        self.record_tip = Tooltip(self.record_btn, t("device.tip_record"))
        self.settings_btn = ttk.Button(actions, text=t("device.quality"), image=get_icon("gear", 14, FG_MUTED),
                                      compound="left", command=self._settings, style="CardAction.TButton")
        self.settings_btn.pack(side="right")
        Tooltip(self.settings_btn, t("device.tip_settings"))
        self._detail_tip = Tooltip(self.detail_label)
        self._name_tip = Tooltip(self.model_label)


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

    def _send_file(self):
        self.callbacks["send_file"](self.serial)

    def _rename(self):
        self.callbacks["rename"](self.serial)

    def _render_model_text(self):
        self.model_label.config(text=self.display_name)
        self._name_tip.set_text(self.display_name)
        recording_text = ""
        if self.recording_anchor is not None:
            secs = max(0, int(time.monotonic() - self.recording_anchor))
            recording_text = f"● {t('device.recording')} {secs // 60:02d}:{secs % 60:02d}"
        self.recording_label.config(text=recording_text)


    def refresh_timer(self):
        """Chamado a cada 1s pela janela principal - atualiza so o cronometro, sem
        esperar o proximo ciclo de verificacao (que e a cada alguns segundos)."""
        if self.recording_anchor is not None:
            self._render_model_text()

    def update(self, info: dict):
        self.status = info["status"]
        self.recording = info.get("recording", False)
        self.display_name = info["display_name"]
        label, color = _status_labels().get(self.status, (self.status, FG))
        self.status_label.config(text="●  " + label, foreground=color)

        if self.recording:
            if self.recording_anchor is None:
                self.recording_anchor = time.monotonic() - (info.get("recording_seconds") or 0)
        else:
            self.recording_anchor = None
        self._render_model_text()

        connection = "Wi-Fi" if ":" in self.serial else "USB"
        detail = f"{connection}   /   {self.serial}"
        if self.status == "problem" and info.get("problem_state"):
            detail = _problem_hint_text(info["problem_state"])
        self.detail_label.config(text=detail)
        self._detail_tip.set_text(detail)

        if self.status == "mirroring":
            self.toggle_btn.config(text=t("btn.stop"), image=get_icon("stop", 13, FG),
                                   state="normal", style="Toggle.TButton")
        else:
            self.toggle_btn.config(text=t("btn.start"), image=get_icon("play", 13, BG),
                                   state="normal" if self.status in ("ready", "blocked") else "disabled",
                                   style="Accent.TButton")


        is_wireless = ":" in self.serial
        can_touch = self.status in ("mirroring", "ready", "blocked")
        self.wifi_btn.config(state="normal" if (can_touch and not is_wireless) else "disabled")
        self.settings_btn.config(state="normal" if can_touch else "disabled")
        self.screenshot_btn.config(state="normal" if can_touch else "disabled")
        self.send_file_btn.config(state="normal" if can_touch else "disabled")

        if self.recording:
            self.record_btn.config(text=t("device.stop_record"), image=get_icon("stop", 13, RED),
                                    state="normal" if self.status == "mirroring" else "disabled")
            self.record_tip.set_text(t("device.tip_stop_recording"))
        else:
            self.record_btn.config(text=t("btn.record"), image=get_icon("record", 13, FG_MUTED),
                                    state="normal" if self.status == "mirroring" else "disabled")
            self.record_tip.set_text(t("device.tip_record"))

    def flash(self):
        """Pisca a borda do cartao (fallback de feedback quando nao ha janela de
        video pra sobrepor - aparelho nao esta espelhando no momento)."""
        original = self.border.cget("bg")

        def step(n):
            if n <= 0 or not self.border.winfo_exists():
                if self.border.winfo_exists():
                    self.border.config(bg=original)
                return
            self.border.config(bg=ACCENT if n % 2 else original)
            self.border.after(90, lambda: step(n - 1))

        step(4)

    def destroy(self):
        self.border.destroy()


class App:
    def __init__(self, root: tk.Tk):
        # Aplica o idioma escolhido no instalador (se acabou de instalar/
        # reinstalar) ANTES de ler settings.json - depois disso, idioma
        # detectado (ou lido de settings.json) ANTES de montar qualquer texto,
        # senao a interface inteira nasceria com as strings padrao (portugues)
        # e so mudaria depois, sem nenhum efeito visivel.
        engine.apply_installer_language_marker()
        i18n.init_language(engine.load_settings().get("language"))

        self.root = root
        root.title(t("app.title"))
        root.geometry("900x780")
        root.configure(bg=BG)
        _apply_dark_titlebar(root)  # antes de qualquer coisa aparecer na tela

        self._window_icon_images = [ImageTk.PhotoImage(icons.app_icon(size))
                                    for size in (16, 32, 48, 64, 256)]
        root.iconphoto(True, *self._window_icon_images)

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
        self._busy_apk_count = 0  # quantas instalacoes/transferencias estao em andamento agora

        self._build_ui()
        # minsize medido de verdade (nao um numero fixo) - senao a fileira de
        # botoes do cabecalho pode ficar espremida de novo (sem erro nenhum)
        # numa fonte/DPI/traducao diferente da que foi testada.
        self.root.update_idletasks()
        self.root.minsize(max(760, self._header_actions_row.winfo_reqwidth() + 48), 620)
        self._log(t("log.started"))
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
        sv_ttk.set_theme("dark", self.root)
        for name in ("TkDefaultFont", "TkTextFont", "TkMenuFont", "TkHeadingFont",
                     "TkCaptionFont", "TkSmallCaptionFont", "TkIconFont", "TkTooltipFont"):
            tkfont.nametofont(name, root=self.root).configure(family=FONT_FAMILY, size=10)
        style = ttk.Style(self.root)
        style.configure(".", font=FONT_DEFAULT)
        style.configure("TFrame", background=BG)
        style.configure("TLabel", background=BG, foreground=FG)
        style.configure("TButton", font=FONT_DEFAULT, padding=(12, 7))
        style.configure("TCheckbutton", font=FONT_DEFAULT)
        style.configure("TCombobox", font=FONT_DEFAULT, padding=(8, 6))
        self.root.option_add("*TCombobox*Listbox.font", FONT_DEFAULT)
        self.root.option_add("*TCombobox*Listbox.background", SURFACE)
        self.root.option_add("*TCombobox*Listbox.foreground", FG)
        self.root.option_add("*TCombobox*Listbox.selectBackground", HOVER)
        self.root.option_add("*TCombobox*Listbox.selectForeground", FG)
        style.configure("Card.TFrame", background=SURFACE)
        # Sun Valley already defines Card.TFrame with an image border; inner
        # groups must use the plain layout to avoid boxes around every label.
        style.layout("Card.TFrame", style.layout("TFrame"))
        style.configure("Card.TLabel", background=SURFACE, foreground=FG)
        style.configure("CardMuted.TLabel", background=SURFACE, foreground=FG_MUTED)
        style.configure("Card.TCheckbutton", background=SURFACE, font=FONT_DEFAULT)
        style.map("Card.TCheckbutton", background=[("active", SURFACE)])
        style.configure("Summary.TLabel", font=FONT_MUTED, foreground=FG_MUTED)
        style.configure("Header.TLabel", font=FONT_BOLD, foreground=FG)
        style.configure("Title.TLabel", font=(FONT_FAMILY, 20), foreground=FG)
        style.configure("DialogTitle.TLabel", font=(FONT_FAMILY, 16), foreground=FG)
        style.configure("Toggle.TButton", padding=(16, 7), font=FONT_DEFAULT)
        style.configure("Accent.TButton", padding=(16, 7), font=FONT_DEFAULT)
        # Native focus outline, quiet background. Secondary actions no longer
        # look like a wall of boxed primary buttons.
        quiet_layout = [("Button.focus", {"sticky": "nswe", "children": [
            ("Button.padding", {"sticky": "nswe", "children": [
                ("Button.label", {"sticky": "nswe"})]})]})]
        for name, background, padding in (
                ("Quiet.TButton", BG, (10, 7)),
                ("CardAction.TButton", SURFACE, (9, 6)),
                ("Icon.TButton", SURFACE, (6, 5)),
                ("Update.TButton", BG, (6, 3))):
            style.layout(name, quiet_layout)
            style.configure(name, background=background, foreground=FG_MUTED,
                            padding=padding, font=FONT_MUTED, borderwidth=0,
                            focusthickness=1, focuscolor=ACCENT, anchor="center")
            style.map(name, background=[("pressed", BORDER), ("active", HOVER)],
                      foreground=[("disabled", "#777e89"), ("active", FG)])

        self._primary_surfaces = [ImageTk.PhotoImage(icons.button_surface(color, outline))
                                  for color, outline in ((ACCENT, ACCENT), ("#b3cbf3", "#b3cbf3"),
                                                         ("#83a7dd", "#83a7dd"), ("#34383e", BORDER),
                                                         (ACCENT, FG))]
        normal, hover, pressed, disabled, focus = self._primary_surfaces
        style.element_create("Panel.primary", "image", normal, ("disabled", disabled),
                             ("pressed", pressed), ("active", hover), ("focus", focus),
                             border=6, sticky="nswe")
        style.layout("Accent.TButton", [("Panel.primary", {"sticky": "nswe", "children": [
            ("Button.padding", {"sticky": "nswe", "children": [("Button.label", {"sticky": "nswe"})]})]})])
        style.configure("Accent.TButton", foreground=BG)
        style.map("Accent.TButton", foreground=[("disabled", FG_SUBTLE), ("!disabled", BG)])

    def _button_group(self, parent, buttons):
        group = ttk.Frame(parent)
        for i, (text, icon_name, icon_color, command) in enumerate(buttons):
            ttk.Button(group, text=text, image=get_icon(icon_name, 14, icon_color),
                       compound="left", style="Quiet.TButton", command=command).pack(
                           side="left", padx=(0 if i == 0 else 4, 0))
        return group


    # ---------------------------------------------------------------- UI --
    def _build_ui(self):
        top = ttk.Frame(self.root, padding=(24, 20, 24, 16))
        top.pack(fill="x")
        heading = ttk.Frame(top)
        heading.pack(fill="x")
        self._brand_icon = ImageTk.PhotoImage(icons.app_icon(34))
        ttk.Label(heading, image=self._brand_icon).pack(side="left", padx=(0, 12))
        ttk.Label(heading, text=t("app.title"), style="Title.TLabel").pack(side="left")
        ttk.Button(heading, text=t("app.settings"), image=get_icon("gear", 15, FG_MUTED),
                   compound="left", style="Quiet.TButton", command=self._open_app_settings).pack(side="right")
        ttk.Label(top, text=t("app.subtitle"), foreground=FG_MUTED,
                  font=FONT_MUTED).pack(anchor="w", pady=(6, 0))

        self.stay_awake_var = tk.BooleanVar(value=self.manager.stay_awake)
        self.always_on_top_var = tk.BooleanVar(value=self.manager.always_on_top)
        self.minimize_to_tray_var = tk.BooleanVar(value=self.manager.minimize_to_tray)
        self._header_actions_row = ttk.Frame(top)
        self._header_actions_row.pack(fill="x", pady=(16, 0))
        self.start_all_btn = ttk.Button(self._header_actions_row, text=t("app.start_all"),
                                       image=get_icon("play", 13, FG), compound="left",
                                       command=self._on_start_all)
        self.start_all_btn.pack(side="left")
        self.stop_all_btn = ttk.Button(self._header_actions_row, text=t("app.stop_all"),
                                      style="Quiet.TButton", command=self._on_stop_all)
        self.stop_all_btn.pack(side="left", padx=(6, 0))
        self._button_group(self._header_actions_row, [
            (t("app.qr_pairing"), "qr", FG_MUTED, self._on_qr_pairing),
            (t("app.batch_transfer"), "upload", FG_MUTED, self._on_batch_transfer),
            (t("app.shortcuts"), "keyboard", FG_MUTED, self._on_show_shortcuts),
        ]).pack(side="right")
        tk.Frame(self.root, bg=BORDER, height=1).pack(fill="x", padx=24)

        section = ttk.Frame(self.root, padding=(24, 16, 24, 8))
        section.pack(fill="x")
        ttk.Label(section, text=t("app.devices"), style="Header.TLabel").pack(side="left")
        self.summary_label = ttk.Label(section, text=t("app.loading"), style="Summary.TLabel")
        self.summary_label.pack(side="right")

        # Reserve the activity/footer before the expanding list, including at
        # the minimum window height. The list alone takes the remaining space.
        footer = ttk.Frame(self.root, padding=(24, 6, 24, 12))
        footer.pack(side="bottom", fill="x")
        ttk.Label(footer, text=f"MirrorPanel  {updater.APP_VERSION}",
                  foreground=FG_SUBTLE, font=FONT_MUTED).pack(side="left")
        ttk.Button(footer, text=t("app.check_update"), style="Update.TButton",
                   command=self._on_check_update).pack(side="right")

        activity = ttk.Frame(self.root, padding=(24, 10, 24, 0))
        activity.pack(side="bottom", fill="x")
        toolbar = ttk.Frame(activity)
        toolbar.pack(fill="x", pady=(0, 8))
        ttk.Label(toolbar, text=t("app.activity"), style="Header.TLabel").pack(side="left")
        self.log_filter = tk.StringVar(value=t("activity.all"))
        filters = ttk.Combobox(toolbar, textvariable=self.log_filter, state="readonly",
                               values=(t("activity.all"), t("activity.problems")), width=18)
        filters.pack(side="left", padx=14)
        filters.bind("<<ComboboxSelected>>", lambda _e: self._refresh_log(reset_view=True))
        ttk.Button(toolbar, text=t("activity.clear"), style="Quiet.TButton",
                   command=self._clear_log).pack(side="right")
        ttk.Button(toolbar, text=t("activity.copy"), style="Quiet.TButton",
                   command=self._copy_log).pack(side="right", padx=(0, 4))
        log_border = tk.Frame(activity, bg=LOG_BG, highlightthickness=1,
                              highlightbackground=BORDER)
        log_border.pack(fill="x")
        self.apk_progress = ttk.Progressbar(log_border, mode="indeterminate")
        self.log_body = tk.Frame(log_border, bg=LOG_BG)
        self.log_body.pack(fill="both", expand=True)
        scrollbar = ttk.Scrollbar(self.log_body, orient="vertical")
        scrollbar.pack(side="right", fill="y", padx=(0, 4), pady=8)
        self.log_text = tk.Text(self.log_body, height=5, state="disabled", font=FONT_MUTED,
                               bg=LOG_BG, fg=FG_MUTED, insertbackground=FG,
                               selectbackground="#405778", selectforeground=FG,
                               relief="flat", highlightthickness=0, padx=14, pady=10,
                               spacing1=4, spacing3=4, wrap="word", cursor="arrow",
                               yscrollcommand=scrollbar.set)
        self.log_text.pack(fill="both", expand=True)
        scrollbar.configure(command=self.log_text.yview)
        timestamp_width = tkfont.Font(root=self.root, font=("Consolas", 9)).measure("00:00:00  ")
        level_width = max(tkfont.Font(root=self.root, font=FONT_MUTED).measure(t(f"activity.{level}"))
                          for level in ("info", "success", "warning", "error")) + 22
        self.log_text.configure(tabs=(timestamp_width, timestamp_width + level_width))
        self.log_text.tag_configure("timestamp", foreground=FG_SUBTLE, font=("Consolas", 9))
        self.log_text.tag_configure("message", foreground=FG_MUTED,
                                    lmargin2=timestamp_width + level_width)
        for level, color in (("info", FG_SUBTLE), ("success", GREEN), ("warning", AMBER), ("error", RED)):
            self.log_text.tag_configure(level, foreground=color)
        self._log_records = deque(maxlen=LOG_MAX_LINES)
        self._log_sequence = 0

        self.content = ttk.Frame(self.root)
        self.content.pack(fill="both", expand=True)
        self.loading_frame = ttk.Frame(self.content)
        self.loading_frame.pack(fill="both", expand=True)
        loading_box = ttk.Frame(self.loading_frame)
        loading_box.place(relx=0.5, rely=0.45, anchor="center")
        ttk.Label(loading_box, text=t("app.loading_devices"), foreground=FG_MUTED).pack(pady=(0, 12))
        self.loading_bar = ttk.Progressbar(loading_box, mode="indeterminate", length=180)
        self.loading_bar.pack()
        self.loading_bar.start(12)

        self.device_view = ttk.Frame(self.content, padding=(24, 0, 12, 0))
        self.device_canvas = tk.Canvas(self.device_view, bg=BG, highlightthickness=0, bd=0)
        device_scroll = ttk.Scrollbar(self.device_view, orient="vertical", command=self.device_canvas.yview)
        device_scroll.pack(side="right", fill="y")
        self.device_canvas.pack(side="left", fill="both", expand=True)
        self.device_canvas.configure(yscrollcommand=device_scroll.set)
        self.list_frame = ttk.Frame(self.device_canvas)
        self._list_window = self.device_canvas.create_window(0, 0, anchor="nw", window=self.list_frame)
        self.list_frame.bind("<Configure>", lambda _e: self.device_canvas.configure(
            scrollregion=self.device_canvas.bbox("all")))
        self.device_canvas.bind("<Configure>", lambda e: self.device_canvas.itemconfigure(
            self._list_window, width=e.width))
        self.root.bind("<MouseWheel>", self._scroll_devices, add="+")
        self.empty_label = ttk.Frame(self.list_frame, padding=(24, 32))
        ttk.Label(self.empty_label, image=get_icon("phone", 44, FG_SUBTLE)).pack(pady=(0, 14))
        ttk.Label(self.empty_label, text=t("app.empty_title"), font=(FONT_FAMILY, 13)).pack()
        ttk.Label(self.empty_label, text=t("app.empty"), foreground=FG_MUTED,
                  justify="center").pack(pady=(8, 16))
        ttk.Button(self.empty_label, text=t("app.qr_pairing"), command=self._on_qr_pairing).pack()
        self.empty_label.pack(fill="x")

    def _scroll_devices(self, event):
        widget = event.widget
        while widget is not None:
            if widget is self.device_view:
                if self.device_canvas.yview() != (0.0, 1.0):
                    self.device_canvas.yview_scroll(-int(event.delta / 120), "units")
                return "break"
            widget = getattr(widget, "master", None)


    def _toggle_setting(self, action_type: str, var: tk.BooleanVar):
        self.action_queue.put({"type": action_type, "value": var.get()})
        self.wake_event.set()

    def _set_apk_progress_visible(self, visible: bool):
        if visible:
            if not self.apk_progress.winfo_ismapped():
                self.apk_progress.pack(fill="x", padx=1, pady=(1, 0), before=self.log_body)
                self.apk_progress.start(12)
        else:
            self.apk_progress.stop()
            self.apk_progress.pack_forget()

    def _mark_apk_busy(self):
        # Contador simples, nao um set de (model, nome): duas instalacoes
        # concorrentes pro MESMO aparelho+arquivo (arrastar-e-soltar nativo
        # e o botao de enviar arquivo, por exemplo) tinham a mesma chave -
        # com um set, a PRIMEIRA a terminar removia a chave e escondia a
        # barra cedo demais, mesmo com a segunda ainda rodando.
        self._busy_apk_count += 1
        self._set_apk_progress_visible(True)

    def _mark_apk_done(self):
        self._busy_apk_count = max(0, self._busy_apk_count - 1)
        if self._busy_apk_count == 0:
            self._set_apk_progress_visible(False)

    def _log(self, msg: str, level: str = "info"):
        if level not in ("info", "success", "warning", "error"):
            level = "info"
        self._log_sequence += 1
        # Store records, not rendered lines: multiline messages stay intact.
        self._log_records.append((self._log_sequence, time.strftime("%H:%M:%S"), level, msg))
        self._refresh_log()

    def _visible_log_records(self):
        problems_only = self.log_filter.get() == t("activity.problems")
        return [record for record in self._log_records
                if not problems_only or record[2] in ("warning", "error")]

    def _refresh_log(self, reset_view=False):
        text = self.log_text
        at_bottom = text.yview()[1] >= 0.995
        top = text.index("@0,0")
        anchor = next((tag for tag in text.tag_names(top) if tag.startswith("entry-")), None)
        offset = 0
        if anchor:
            offset = text.count(text.tag_ranges(anchor)[0], top, "chars")[0] if str(text.tag_ranges(anchor)[0]) != top else 0
        text.configure(state="normal")
        text.delete("1.0", "end")
        for tag in text.tag_names():
            if tag.startswith("entry-"):
                text.tag_delete(tag)
        records = self._visible_log_records()
        for sequence, timestamp, level, message in records:
            start = text.index("end-1c")
            text.insert("end", timestamp + "\t", "timestamp")
            text.insert("end", t(f"activity.{level}") + "\t", level)
            text.insert("end", message + "\n", "message")
            text.tag_add(f"entry-{sequence}", start, "end-1c")
        if not records:
            text.insert("end", t("activity.no_problems") if self._log_records else t("activity.empty"), "info")
        text.configure(state="disabled")
        if reset_view or at_bottom:
            text.see("end")
        elif anchor and text.tag_ranges(anchor):
            text.yview(f"{text.tag_ranges(anchor)[0]} + {offset} chars")
        else:
            text.yview("1.0")

    def _clear_log(self):
        self._log_records.clear()
        self._refresh_log(reset_view=True)

    def _copy_log(self):
        records = self._visible_log_records()
        if records:
            self.root.clipboard_clear()
            self.root.clipboard_append("\n".join(
                f"{timestamp}  {t('activity.' + level)}  {message}"
                for _, timestamp, level, message in records))


    # ------------------------------------------------------------- tray --
    def _setup_tray(self):
        image = icons.app_icon(64)
        menu = pystray.Menu(
            pystray.MenuItem(t("tray.open"), self._tray_open, default=True),
            pystray.MenuItem(t("tray.exit"), self._tray_exit),
        )
        self.tray_icon = pystray.Icon("MirrorPanel", image, "MirrorPanel", menu)
        threading.Thread(target=self.tray_icon.run, daemon=True).start()

    def _notify(self, title: str, message: str):
        """Notificacao nativa do Windows (balao perto do relogio) - so faz
        sentido quando o painel esta ESCONDIDO (minimizado/bandeja). Com a
        janela visivel, o log (e o proprio dialogo, quando ha um) ja avisam
        na hora - notificar de novo seria repetir o aviso a toa. Antes disso,
        um aparelho bloqueado por falhas repetidas (evento "blocked") so
        virava uma linha de log silenciosa: minimizado, ninguem via.

        Nunca deixa uma falha aqui derrubar o app - e so um "a mais", nao
        algo essencial pro funcionamento (mesma filosofia do updater.py:
        invisivel ate ser preciso, e nunca a causa de um crash).
        """
        if self.root.state() not in ("withdrawn", "iconic"):
            return
        # .visible so fica True depois que o icone terminou de aparecer de
        # verdade na bandeja (run() cria isso numa thread separada, entao ha
        # uma janela curta logo na abertura do app onde self.tray_icon ja
        # existe como objeto mas o icone nativo ainda nao foi criado).
        if not self.tray_icon or not self.tray_icon.visible:
            return
        try:
            self.tray_icon.notify(message, title)
        except Exception:
            logging.exception("Falha ao mostrar notificacao da bandeja")

    def _tray_open(self, icon=None, item=None):
        self.root.after(0, self._restore_window)

    def _restore_window(self):
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def _ensure_window_visible(self):
        """Traz o painel de volta antes de abrir um dialogo disparado por um
        evento em segundo plano (queda de conexao, atualizacao disponivel) -
        senao o dialogo nasceria atras de uma janela escondida/minimizada.
        Escondida na bandeja (sem entrada na barra de tarefas) precisa do
        restore completo; so minimizada (o padrao agora) so desminimiza, sem
        roubar o foco de quem o usuario esta usando - minimizar sozinho nunca
        pediu pra reaparecer na tela."""
        state = self.root.state()
        if state == "withdrawn":
            self._restore_window()
        elif state == "iconic":
            self.root.deiconify()

    def _tray_exit(self, icon=None, item=None):
        self.root.after(0, self._on_close)

    def _on_unmap(self, event):
        # so esconde pra bandeja (sem entrada na barra de tarefas) se o
        # usuario ligou isso explicitamente no checkbox - por padrao,
        # minimizar se comporta como qualquer programa do Windows. Le a
        # BooleanVar (atualizada na hora, na thread da UI) e nao
        # self.manager.minimize_to_tray (so atualizado depois, quando a
        # thread de fundo processa a fila) - senao ligar o checkbox e
        # minimizar rapido em seguida podia nao valer na primeira vez.
        if (event.widget is self.root and self.root.state() == "iconic"
                and self.minimize_to_tray_var.get()):
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

        self._run_update_check()

        while not self.stop_event.is_set():
            try:
                while not self.stop_event.is_set() and not self.action_queue.empty():
                    self._handle_action(self.action_queue.get())

                if self.stop_event.is_set():
                    break
                events = self.manager.tick()
                self.event_queue.put(("tick", events, self.manager.snapshot()))
            except Exception:
                # Nunca deixa a thread morrer (cabo arrancado, rede caiu, etc.) -
                # loga e segue pro proximo ciclo. Sem isso, uma excecao aqui deixaria
                # a UI "viva" mas parada pra sempre, sem nenhum aviso ao usuario.
                logging.exception("Erro no ciclo de verificacao - continuando")

            # enquanto ha uma reconexao silenciosa em andamento, verifica bem mais
            # rapido (perto do intervalo combinado entre as tentativas) em vez de
            # esperar o ciclo normal inteiro - assim a reconexao acontece no ritmo
            # pedido, sem esperar o poll normal (mais espacado) entre uma tentativa
            # e outra.
            wait_time = (engine.SILENT_RECONNECT_INTERVAL if self.manager.has_pending_reconnects()
                         else engine.POLL_INTERVAL_SECONDS)
            self.wake_event.wait(wait_time)
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
            self._notify_recording_restart(serial)
            self.manager.stop_device(serial)
            time.sleep(1)
            self.manager.start_device(serial)
        elif kind == "wifi":
            target = self.manager.enable_wifi(serial)
            self.event_queue.put(("wifi_result", serial, target))
        elif kind == "save_settings":
            self.manager.set_device_settings(serial, action["settings"])
            if serial in self.manager.active:
                self._notify_recording_restart(serial)
                self.manager.stop_device(serial)
                time.sleep(1)
                self.manager.start_device(serial)
        elif kind == "set_stay_awake":
            self.manager.set_stay_awake(action["value"])
        elif kind == "set_always_on_top":
            self.manager.set_always_on_top(action["value"])
        elif kind == "set_minimize_to_tray":
            self.manager.set_minimize_to_tray(action["value"])
        elif kind == "set_nickname":
            self.manager.set_nickname(serial, action["nickname"])
            self.event_queue.put(("nickname_result", serial))
        elif kind == "start_recording":
            path = self.manager.start_recording(serial, action.get("light", False))
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
        elif kind == "batch_transfer":
            path = action["path"]
            serials = list(self.manager.last_ready)
            self.event_queue.put(("batch_transfer_started", Path(path).name, len(serials)))
            for target_serial in serials:
                if self.stop_event.is_set():
                    break
                self._transfer_file_to_device(target_serial, path)
        elif kind == "single_transfer":
            # mesmo caminho do batch_transfer acima, so que pra UM aparelho so
            # (reaproveita o mesmo evento batch_transfer_progress - a UI nao
            # precisa saber se veio do botao em lote ou do botao por aparelho).
            self._transfer_file_to_device(serial, action["path"])

    def _notify_recording_restart(self, serial: str):
        path = self.manager.recording.get(serial)
        if path:
            self.event_queue.put(("recording_interrupted", serial, path))

    def _transfer_file_to_device(self, serial: str, path: str):
        """Passo de UM aparelho da transferencia (lote ou individual) -
        instala (.apk/.xapk vira instalacao de verdade, install_xapk_to_device
        extrai e usa adb install-multiple) ou envia (qualquer outro arquivo,
        push generico)."""
        name = Path(path).name
        is_install = Path(path).suffix.lower() in (".apk", ".xapk")
        model = self.manager.display_name(serial)
        self.event_queue.put(("batch_transfer_progress", model, name, is_install, None))
        ok = self.manager.install_or_push_to_device(serial, path)
        self.event_queue.put(("batch_transfer_progress", model, name, is_install, ok))

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
                    model = self.manager.display_name(serial)
                    if target:
                        self._log(t("log.wifi_on", model=model, target=target), "success")
                    else:
                        self._log(t("log.wifi_failed", model=model), "error")
                    continue
                if item[0] == "record_result":
                    _, serial, started, path = item
                    model = self.manager.display_name(serial)
                    if started and not path:
                        self._log(t("log.recording_failed", model=model), "error")
                    elif started:
                        self._log(t("log.recording_started", model=model, path=path), "success")
                    else:
                        self._log(t("log.recording_saved", model=model), "success")
                    continue
                if item[0] == "recording_interrupted":
                    _, serial, path = item
                    self._log(t("log.recording_interrupted", model=self.manager.display_name(serial), path=path), "warning")
                    continue
                if item[0] == "screenshot_result":
                    _, serial, path = item
                    model = self.manager.display_name(serial)
                    if path:
                        self._log(t("log.screenshot_saved", model=model, path=path), "success")
                        ScreenshotConfirmDialog(self.root, on_copy=lambda p=path: self._on_copy_screenshot(p))
                    else:
                        self._log(t("log.screenshot_failed", model=model), "error")
                    continue
                if item[0] == "clipboard_result":
                    _, ok = item
                    if ok:
                        self._log(t("log.clipboard_ok"), "success")
                    else:
                        self._log(t("log.clipboard_failed"), "error")
                    continue
                if item[0] == "batch_transfer_started":
                    _, name, count = item
                    self._log(t("log.batch_transfer_started", name=name, count=count), "info")
                    continue
                if item[0] == "batch_transfer_progress":
                    _, model, name, is_install, ok = item
                    if ok is None:
                        self._log(t("log.apk_installing" if is_install else "log.apk_pushing",
                                     name=name, model=model), "info")
                        self._mark_apk_busy()
                    else:
                        self._mark_apk_done()
                        if ok:
                            self._log(t("log.apk_installed" if is_install else "log.apk_pushed",
                                         name=name, model=model), "success")
                        else:
                            self._log(t("log.apk_install_failed" if is_install else "log.apk_push_failed",
                                         name=name, model=model), "error")
                    continue
                if item[0] == "nickname_result":
                    _, serial = item
                    raw_model = self.manager.model_cache.get(serial, serial)
                    nickname = self.manager.display_name(serial)
                    self._log(t("log.nickname_saved", model=raw_model, nickname=nickname), "success")
                    continue
                if item[0] == "update_check_result":
                    result = item[1]
                    if result["status"] == "update":
                        info = result["info"]
                        msg = t("log.update_available", version=info['version'])
                        self._log(msg, "success")
                        self._notify(t("app.title"), msg)  # antes de _ensure_window_visible: senao o
                        self._ensure_window_visible()       # estado deixa de ser "minimizado" e a notificacao nunca dispara
                        UpdateDialog(self.root, info, on_accept=lambda: self._start_update_download(info))
                    elif result["status"] == "current":
                        self._log(t("log.update_current", version=updater.APP_VERSION), "info")
                    else:
                        self._log(t("log.update_check_failed"), "warning")
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
                        self._log(t("log.update_downloaded"), "success")
                        self._apply_update(path)
                    else:
                        messagebox.showerror("MirrorPanel", t("msg.update_download_failed"))
                    continue
                if item[0] == "qr_pairing_result":
                    _, target = item
                    if getattr(self, "qr_pairing_dialog", None):
                        self.qr_pairing_dialog.destroy()
                        self.qr_pairing_dialog = None
                    if target:
                        self._log(t("log.qr_pairing_success", target=target), "success")
                    else:
                        self._log(t("log.qr_pairing_failed"), "error")
                    continue

                _, events, snapshot = item
                if not self.first_tick_done:
                    self.first_tick_done = True
                    self.loading_bar.stop()
                    self.loading_frame.pack_forget()
                    self.device_view.pack(fill="both", expand=True)
                self._handle_events(events)
                self._render(snapshot)
        except queue.Empty:
            pass
        self.root.after(250, self._drain_queue)

    def _handle_events(self, events):
        for ev in events:
            t_ = ev.get("type")
            if t_ == "recording_interrupted":
                self._log(t("log.recording_interrupted", model=ev["model"], path=ev["path"]), "warning")
            elif t_ == "arrived":
                self._log(t("log.device_arrived", model=ev['model'], port=ev['port']), "success")
            elif t_ == "reconnected":
                self._log(t("log.device_reconnected", model=ev['model']), "success")
            elif t_ == "departed":
                msg = t("log.device_departed", model=ev['model'])
                self._log(msg, "warning")
                self._notify(t("app.title"), msg)
                self._show_disconnect_dialog(ev["serial"], ev["model"])
            elif t_ == "crashed":
                msg = t("log.device_crashed", model=ev['model'], attempt=ev['attempt'])
                self._log(msg, "error")
                self._notify(t("app.title"), msg)
                self._show_disconnect_dialog(ev["serial"], ev["model"])
            elif t_ == "closed_by_user":
                # janela fechada pelo proprio X do scrcpy (fora do painel) -
                # tratado como um "parar" manual: so avisa, sem tentar reconectar
                # nem mostrar pop-up (o usuario decidiu fechar de proposito).
                self._log(t("log.device_closed", model=ev['model']), "info")
            elif t_ == "blocked":
                # antes so virava uma linha de log - minimizado, ninguem via que
                # o aparelho parou de tentar reconectar sozinho.
                msg = t("log.device_blocked", model=ev['model'], serial=ev['serial'])
                self._log(msg, "error")
                self._notify(t("app.title"), msg)
            elif t_ == "problem":
                hint = _problem_hint_text(ev.get("state"))
                self._log(t("log.device_problem", serial=ev['serial'], hint=hint), "warning")
            elif t_ == "error":
                self._log(t("log.device_error", serial=ev['serial']), "error")
            elif t_ == "apk_pushing":
                self._log(t("log.apk_pushing", name=ev['name'], model=ev['model']), "info")
                self._mark_apk_busy()
            elif t_ == "apk_pushed":
                self._log(t("log.apk_pushed", name=ev['name'], model=ev['model']), "success")
                self._mark_apk_done()
            elif t_ == "apk_push_failed":
                self._log(t("log.apk_push_failed", name=ev['name'], model=ev['model']), "error")
                self._mark_apk_done()
            elif t_ == "apk_installing":
                self._log(t("log.apk_installing", name=ev['name'], model=ev['model']), "info")
                self._mark_apk_busy()
            elif t_ == "apk_installed":
                self._log(t("log.apk_installed", name=ev['name'], model=ev['model']), "success")
                self._mark_apk_done()
            elif t_ == "apk_install_failed":
                self._log(t("log.apk_install_failed", name=ev['name'], model=ev['model']), "error")
                self._mark_apk_done()

    def _render(self, snapshot: dict):
        self.summary_label.config(text=t("app.summary", n=len(snapshot)))
        self.start_all_btn.configure(state="normal" if any(
            info["status"] in ("ready", "blocked") for info in snapshot.values()) else "disabled")
        self.stop_all_btn.configure(state="normal" if any(
            info["status"] == "mirroring" for info in snapshot.values()) else "disabled")

        if snapshot:
            self.empty_label.pack_forget()
        else:
            self.empty_label.pack(fill="x")

        for serial in list(self.rows):
            if serial not in snapshot:
                self.rows[serial].destroy()
                del self.rows[serial]

        callbacks = {"toggle": self._on_toggle, "wifi": self._on_wifi, "settings": self._on_settings,
                     "record": self._on_record, "screenshot": self._on_screenshot, "rename": self._on_rename,
                     "send_file": self._on_send_file}
        for serial, info in sorted(snapshot.items(), key=lambda kv: kv[1]["display_name"]):
            if serial not in self.rows:
                row = DeviceRow(self.list_frame, serial, callbacks)
                row.border.pack(fill="x", pady=(0, 10))
                self.rows[serial] = row
            self.rows[serial].update(info)

    def _on_toggle(self, serial: str, status: str):
        kind = "stop" if status == "mirroring" else "start"
        self.action_queue.put({"type": kind, "serial": serial})
        self.wake_event.set()

    def _on_start_all(self):
        snapshot = self.manager.snapshot()
        targets = [s for s, info in snapshot.items() if info["status"] in ("ready", "blocked")]
        for serial in targets:
            self.action_queue.put({"type": "start", "serial": serial})
        self.wake_event.set()

    def _on_stop_all(self):
        snapshot = self.manager.snapshot()
        targets = [s for s, info in snapshot.items() if info["status"] == "mirroring"]
        for serial in targets:
            self.action_queue.put({"type": "stop", "serial": serial})
        self.wake_event.set()

    def _on_show_shortcuts(self):
        ShortcutsDialog(self.root)

    def _open_app_settings(self):
        AppSettingsDialog(self.root, [
            (self.stay_awake_var, "app.stay_awake", None,
             lambda: self._toggle_setting("set_stay_awake", self.stay_awake_var)),
            (self.always_on_top_var, "app.always_on_top", None,
             lambda: self._toggle_setting("set_always_on_top", self.always_on_top_var)),
            (self.minimize_to_tray_var, "app.minimize_to_tray", "app.minimize_to_tray_hint",
             lambda: self._toggle_setting("set_minimize_to_tray", self.minimize_to_tray_var)),
        ])

    def _on_batch_transfer(self):
        """Instala (.apk/.xapk) ou envia (qualquer outro arquivo) um arquivo
        escolhido pra TODOS os aparelhos detectados de uma vez - espelhando
        ou nao, diferente do arrastar-e-soltar (que so alcanca um aparelho
        por vez, o que estiver espelhando na janela onde o arquivo foi
        solto - e la, so um .apk de verdade vira instalacao)."""
        path = filedialog.askopenfilename(title=t("batch_transfer.pick_file"))
        if not path:
            return
        if not self.manager.last_ready:
            messagebox.showinfo("MirrorPanel", t("batch_transfer.no_devices"))
            return
        self.action_queue.put({"type": "batch_transfer", "path": path})
        self.wake_event.set()

    def _on_send_file(self, serial: str):
        """Mesma logica de instalar/enviar do botao em lote (.apk/.xapk vira
        instalacao de verdade, o resto vira push), mas so pra ESSE aparelho -
        o botao em lote nao dava jeito de escolher um so."""
        path = filedialog.askopenfilename(title=t("batch_transfer.pick_file"))
        if not path:
            return
        self.action_queue.put({"type": "single_transfer", "serial": serial, "path": path})
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
        model = self.manager.display_name(serial)
        self._log(t("log.retrying", model=model), "info")
        self.action_queue.put({"type": "start", "serial": serial})
        self.wake_event.set()

    def _on_wifi(self, serial: str):
        model = self.manager.display_name(serial)
        self._log(t("log.wifi_activating", model=model), "info")
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
        self._log(t("log.update_checking"), "info")
        threading.Thread(target=self._run_update_check, daemon=True).start()

    def _on_qr_pairing(self):
        # roda numa thread propria (nao pela fila de acao/thread de fundo
        # normal) porque pode levar ate mais de 1 minuto esperando o celular
        # escanear - pela fila normal, isso travaria o tick() de todo mundo
        # ate terminar.
        if getattr(self, "qr_pairing_dialog", None):  # ja tem um QR aberto
            return
        name, password = engine.generate_pairing_credentials()
        qr_img = qrcode.make(engine.qr_pairing_payload(name, password)).get_image()
        cancel_event = threading.Event()
        self.qr_pairing_cancel = cancel_event
        self.qr_pairing_dialog = QrPairingDialog(
            self.root, qr_img, on_close=self._on_qr_pairing_dialog_closed)
        self._log(t("log.qr_pairing_started"), "info")

        def worker():
            # o evento TEM que sair em qualquer caso - se a thread morrer sem
            # avisar, a janela do QR fica girando pra sempre sem resposta.
            target = None
            try:
                target = self.manager.pair_new_device_via_qr(name, password, cancel_event=cancel_event)
            except Exception:
                logging.exception("Erro no pareamento por QR")
            finally:
                if not cancel_event.is_set():
                    self.event_queue.put(("qr_pairing_result", target))

        threading.Thread(target=worker, daemon=True).start()

    def _on_qr_pairing_dialog_closed(self):
        self.qr_pairing_dialog = None
        cancel_event = getattr(self, "qr_pairing_cancel", None)
        if cancel_event:
            cancel_event.set()

    def _start_update_download(self, info: dict):
        self.download_dialog = DownloadProgressDialog(self.root)
        dest = updater.get_download_path(info["asset_name"])

        def worker():
            def on_progress(downloaded, total):
                self.event_queue.put(("download_progress", downloaded, total))
            ok = updater.download_update(info["url"], dest, on_progress, expected_size=info.get("size", 0))
            self.event_queue.put(("download_done", ok, dest))

        threading.Thread(target=worker, daemon=True).start()

    def _apply_update(self, installer_path: str):
        # aplicar a atualizacao encerra TODOS os espelhamentos (inclusive
        # gravacoes em andamento) - avisa antes, com chance de esperar, em vez
        # de cortar o video sem dizer nada (mesmo cuidado do botao de fechar).
        recording_count = len(self.manager.recording)
        if recording_count > 0:
            self._ensure_window_visible()
            ConfirmActionDialog(
                self.root, t("update_confirm.title"), t("update_confirm.message", n=recording_count),
                confirm_text=t("btn.update"), cancel_text=t("update_confirm.wait"),
                on_confirm=lambda: self._do_apply_update(installer_path),
            )
            return
        self._do_apply_update(installer_path)

    def _do_apply_update(self, installer_path: str):
        # mesmo motivo do _do_close: shutdown() pode levar alguns segundos com
        # aparelhos espelhando, e travar a thread da UI bem no meio de aplicar
        # uma atualizacao pareceria o programa tendo travado/crashado. Esconde
        # a janela JA (mesmo feedback instantaneo do fechar) - se a atualizacao
        # falhar, _recover_from_failed_update traz ela de volta.
        self.root.withdraw()
        if self.tray_icon:
            try:
                self.tray_icon.stop()
            except Exception:
                pass
        threading.Thread(target=self._shutdown_and_apply_update, args=(installer_path,), daemon=True).start()

    def _shutdown_and_apply_update(self, installer_path: str):
        self.stop_event.set()
        self.wake_event.set()
        self.worker.join()
        # Aguarda a fila parar antes de encerrar as sessoes rastreadas.
        # O servidor ADB compartilhado permanece disponivel a outras ferramentas.
        self.manager.shutdown()
        # se tudo der certo, apply_update_and_restart encerra o processo (os._exit)
        # e o codigo abaixo nunca roda. So chega aqui se algo falhar de forma
        # detectavel - antes, isso sumia silenciosamente e a atualizacao "nao fazia nada".
        error = updater.apply_update_and_restart(installer_path)
        if error:
            key, params = error
            error_text = t(key, **params)
            self.root.after(0, lambda: self._recover_from_failed_update(error_text))

    def _recover_from_failed_update(self, error_text: str):
        """apply_update_and_restart falhou de forma detectavel (instalador
        sumiu, nao abriu, saiu com erro) - a essa altura ja paramos a thread
        de fundo e o icone da bandeja, pra nao deixar um
        icone fantasma na bandeja caso a atualizacao desse certo e o
        processo encerrasse na hora (os._exit). Como nao deu certo, o
        programa continua rodando de verdade - sem reconstruir tudo isso do
        zero, a janela ficava visivel mas "morta": nunca mais detectava
        aparelho nenhum, sem icone na bandeja, ate o usuario fechar e abrir
        o programa de novo na mao."""
        self._log(error_text, "error")
        self.stop_event = threading.Event()
        self.worker = threading.Thread(target=self._background_loop, daemon=True)
        self.worker.start()
        self._setup_tray()
        self._restore_window()
        messagebox.showerror("MirrorPanel", t("msg.update_apply_failed", error=error_text))

    def _on_record(self, serial: str, currently_recording: bool):
        if currently_recording:
            self.action_queue.put({"type": "stop_recording", "serial": serial})
            self.wake_event.set()
            return

        model = self.manager.display_name(serial)

        def on_start(light):
            self.action_queue.put({"type": "start_recording", "serial": serial, "light": light})
            self.wake_event.set()

        RecordingDialog(self.root, model, engine.RECORDINGS_DIR, on_start)

    def _on_settings(self, serial: str):
        model = self.manager.display_name(serial)
        current = self.manager.get_device_settings(serial)

        def on_save(settings):
            self.action_queue.put({"type": "save_settings", "serial": serial, "settings": settings})
            self.wake_event.set()
            self._log(t("log.settings_saved", model=model), "success")

        SettingsDialog(self.root, serial, model, current, on_save)

    def _on_rename(self, serial: str):
        model = self.manager.model_cache.get(serial, serial)
        current = self.manager.nicknames.get(serial, "")

        def on_save(nickname):
            self.action_queue.put({"type": "set_nickname", "serial": serial, "nickname": nickname})
            self.wake_event.set()

        RenameDialog(self.root, model, current, on_save)

    def _on_close(self):
        recording_count = len(self.manager.recording)
        if recording_count > 0:
            self._ensure_window_visible()
            ConfirmActionDialog(
                self.root, t("close_confirm.title"), t("close_confirm.message", n=recording_count),
                confirm_text=t("btn.exit"), cancel_text=t("close_confirm.stay"), on_confirm=self._do_close,
            )
            return
        self._do_close()

    def _do_close(self):
        # esconde a janela JA (mesmo feedback instantaneo de minimizar pra bandeja)
        # - o desligamento de verdade (abaixo) pode levar alguns segundos se algum
        # scrcpy demorar pra responder ao WM_CLOSE, e isso roda numa thread separada
        # bem por isso: fechar direto na thread da UI travava a janela ("Nao
        # respondendo") ate terminar, com um ou mais aparelhos espelhando.
        self.root.withdraw()
        self.stop_event.set()
        self.wake_event.set()
        if self.tray_icon:
            try:
                self.tray_icon.stop()
            except Exception:
                pass
        threading.Thread(target=self._shutdown_and_destroy, daemon=True).start()

    def _shutdown_and_destroy(self):
        # espera o ciclo de verificacao em andamento (thread de fundo) terminar
        # antes de mexer em self.active - senao as duas threads tocam no mesmo
        # estado (aparelhos ativos, handles de log) ao mesmo tempo no instante
        # do fechamento.
        self.worker.join()
        self.manager.shutdown()
        self.root.after(0, self.root.destroy)


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()

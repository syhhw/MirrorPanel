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
from tkinter import ttk, messagebox

import pystray
import sv_ttk
from PIL import ImageTk

import icons
import i18n
import mirror_engine as engine
import updater
from i18n import t

# Fonte padrao do app inteiro - Segoe UI e a fonte de sistema do Windows 10/11
# (limpa, sans-serif, ja instalada em qualquer maquina - sem depender de nada externo)
FONT_FAMILY = "Segoe UI"
FONT_DEFAULT = (FONT_FAMILY, 9)
FONT_BOLD = (FONT_FAMILY, 9, "bold")
FONT_MUTED = (FONT_FAMILY, 8)

# Paleta Dark Mode. BG/FG/ACCENT usam os mesmos tons do tema sv_ttk "sun-valley-dark"
# (pra nao ter nenhuma costura visivel entre widgets ttk padrao e os estilos custom
# abaixo); os tons de status (verde/ambar/vermelho) vem da paleta Primer Dark do
# GitHub - testada e pensada especificamente pra contraste/acessibilidade em fundo
# escuro, e ja e a mesma familia de cores que o app usava no modo claro antes.
BG = "#1c1c1c"          # fundo da janela
SURFACE = "#282828"     # cartoes de aparelho, barra de log - uma camada acima do fundo
BORDER = "#3a3a3a"      # bordas sutis de cartoes/divisores
FG = "#fafafa"          # texto principal
FG_MUTED = "#9a9a9a"    # texto secundario/detalhes
FG_SUBTLE = "#6e7681"   # texto ainda mais discreto (rodape, estados desativados)
ACCENT = "#57c8ff"      # cor de destaque - mesma do tema, mantem tudo consistente
GREEN = "#3fb950"       # espelhando / sucesso
AMBER = "#d29922"       # atencao
RED = "#f85149"         # bloqueado / erro / gravando

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


class SettingsDialog(tk.Toplevel):
    """Ajuste de qualidade por aparelho - so opcoes prontas, sem digitar nada tecnico."""

    def __init__(self, parent, serial, model, current, on_save):
        super().__init__(parent)
        self.withdraw()
        self.title(t("settings.title", model=model))
        self.resizable(False, False)
        self.transient(parent)
        self.on_save = on_save
        pad = DIALOG_FORM_PAD
        bitrate_options = _bitrate_options()
        fps_options = _fps_options()

        ttk.Label(self, text=t("settings.codec")).grid(row=0, column=0, sticky="w", **pad)
        self.codec_var = tk.StringVar(value=current.get("video_codec", "h264"))
        ttk.Combobox(self, textvariable=self.codec_var, values=["h264", "h265"],
                     state="readonly", width=24).grid(row=0, column=1, **pad)

        bitrate_by_value = {v: l for l, v in bitrate_options}
        ttk.Label(self, text=t("settings.quality")).grid(row=1, column=0, sticky="w", **pad)
        self.bitrate_var = tk.StringVar(
            value=bitrate_by_value.get(current.get("bitrate", "8M"), bitrate_options[2][0]))
        ttk.Combobox(self, textvariable=self.bitrate_var, values=[l for l, _ in bitrate_options],
                     state="readonly", width=24).grid(row=1, column=1, **pad)

        fps_by_value = {v: l for l, v in fps_options}
        ttk.Label(self, text=t("settings.fps")).grid(row=2, column=0, sticky="w", **pad)
        self.fps_var = tk.StringVar(
            value=fps_by_value.get(current.get("max_fps", 60), fps_options[1][0]))
        ttk.Combobox(self, textvariable=self.fps_var, values=[l for l, _ in fps_options],
                     state="readonly", width=24).grid(row=2, column=1, **pad)

        self.audio_var = tk.BooleanVar(value=current.get("audio", True))
        ttk.Checkbutton(self, text=t("settings.audio"),
                         variable=self.audio_var).grid(row=3, column=0, columnspan=2,
                                                        sticky="w", padx=14, pady=(6, 14))

        btns = ttk.Frame(self)
        btns.grid(row=4, column=0, columnspan=2, pady=(0, 14))
        ttk.Button(btns, text=t("btn.cancel"), command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text=t("btn.save"), command=self._save, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

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

        ttk.Label(self, text=t("rename.label")).pack(padx=DIALOG_OUTER_PAD, pady=(16, 6), anchor="w")
        self.name_var = tk.StringVar(value=current_nickname or "")
        entry = ttk.Entry(self, textvariable=self.name_var, width=30)
        entry.pack(padx=DIALOG_OUTER_PAD, pady=(0, 16))
        entry.bind("<Return>", lambda _e: self._save())

        btns = ttk.Frame(self)
        btns.pack(pady=(0, 16))
        ttk.Button(btns, text=t("btn.cancel"), command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text=t("btn.save"), command=self._save, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

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
        pad = DIALOG_FORM_PAD

        ttk.Label(self, text=t("recording.save_to")).grid(row=0, column=0, sticky="w", **pad)
        ttk.Label(self, text=str(recordings_dir), foreground=FG_MUTED).grid(
            row=0, column=1, sticky="w", padx=(0, 14), pady=6)

        self.light_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(
            self, text=t("recording.light"),
            variable=self.light_var,
        ).grid(row=1, column=0, columnspan=2, sticky="w", padx=14, pady=(0, 4))
        ttk.Label(
            self, text=t("recording.light_hint"),
            foreground=FG_MUTED, font=("Segoe UI", 8), justify="left", wraplength=380,
        ).grid(row=2, column=0, columnspan=2, sticky="w", padx=14, pady=(0, 10))

        btns = ttk.Frame(self)
        btns.grid(row=3, column=0, columnspan=2, pady=(0, 14))
        ttk.Button(btns, text=t("btn.cancel"), command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)
        ttk.Button(btns, text=t("btn.record"), command=self._start, width=DIALOG_BUTTON_WIDTH).pack(side="left", padx=6)

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
        self.on_accept = on_accept

        ttk.Label(self, text=t("update.available", version=info['version']),
                  font=("Segoe UI", 10, "bold")).pack(padx=DIALOG_OUTER_PAD, pady=(16, 4), anchor="w")
        ttk.Label(self, text=t("update.notes_header"),
                  foreground=FG_MUTED).pack(padx=DIALOG_OUTER_PAD, anchor="w")

        notes = tk.Text(self, width=52, height=10, wrap="word", font=("Segoe UI", 9),
                         bg=SURFACE, fg=FG, insertbackground=FG, selectbackground=ACCENT,
                         relief="solid", borderwidth=1, highlightthickness=1,
                         highlightbackground=BORDER, highlightcolor=BORDER)
        notes.insert("1.0", info["notes"] or t("update.no_notes"))
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

        ttk.Label(self, text=t("shortcuts.title"), font=FONT_BOLD).pack(
            padx=DIALOG_OUTER_PAD, pady=(16, 4), anchor="w")
        ttk.Label(self, text=t("shortcuts.hint"), foreground=FG_MUTED).pack(
            padx=DIALOG_OUTER_PAD, anchor="w", pady=(0, 10))

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
        grid = ttk.Frame(self)
        grid.pack(padx=DIALOG_OUTER_PAD, pady=(0, 8))
        for i, (key, desc) in enumerate(rows):
            ttk.Label(grid, text=key, font=("Consolas", 9, "bold"), foreground=ACCENT).grid(
                row=i, column=0, sticky="w", padx=(0, 14), pady=3)
            ttk.Label(grid, text=desc, foreground=FG, wraplength=260, justify="left").grid(
                row=i, column=1, sticky="w", pady=3)

        ttk.Label(self, text=t("shortcuts.mod_hint"), foreground=FG_SUBTLE, font=FONT_MUTED).pack(
            padx=DIALOG_OUTER_PAD, pady=(4, 0), anchor="w")

        ttk.Button(self, text=t("btn.close"), command=self.destroy, width=DIALOG_BUTTON_WIDTH).pack(pady=16)

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

        # borda fina (1px) ao redor de cada linha, pra parecer um "cartao" separado
        self.border = tk.Frame(parent, bg=BORDER)
        self.frame = ttk.Frame(self.border, padding=(12, 10), style="Card.TFrame")
        self.frame.pack(fill="both", expand=True, padx=1, pady=1)
        self.frame.columnconfigure(1, weight=1)

        self.dot = tk.Canvas(self.frame, width=12, height=12, highlightthickness=0,
                              bg=SURFACE, bd=0)
        self.dot.grid(row=0, column=0, rowspan=2, padx=(0, 12))
        self.dot_id = self.dot.create_oval(1, 1, 11, 11, fill=FG_MUTED, outline="")

        name_box = ttk.Frame(self.frame, style="Card.TFrame")
        name_box.grid(row=0, column=1, sticky="w")
        self.model_label = ttk.Label(name_box, font=("Segoe UI", 10, "bold"), style="Card.TLabel",
                                      cursor="hand2")
        self.model_label.pack(side="left")
        self.model_label.bind("<Button-1>", lambda _e: self._rename())
        self.rename_btn = ttk.Button(name_box, image=get_icon("edit", 11, FG_MUTED),
                                      command=self._rename, style="Icon.TButton")
        self.rename_btn.pack(side="left", padx=(4, 0))

        self.detail_label = ttk.Label(self.frame, foreground=FG_MUTED, font=("Segoe UI", 8),
                                       style="CardMuted.TLabel")
        self.detail_label.grid(row=1, column=1, sticky="w", pady=(2, 0))

        actions = ttk.Frame(self.frame, style="Card.TFrame")
        actions.grid(row=0, column=2, rowspan=2, padx=(10, 0))

        self.toggle_btn = ttk.Button(actions, command=self._toggle, width=9, compound="left",
                                      style="Toggle.TButton")
        self.toggle_btn.pack(side="left", padx=(0, 8))

        icons_box = ttk.Frame(actions, style="Card.TFrame")
        icons_box.pack(side="left")

        self.wifi_btn = ttk.Button(icons_box, image=get_icon("wifi", 15, ACCENT),
                                    command=self._wifi, style="Icon.TButton")
        self.wifi_btn.pack(side="left", padx=1)

        self.screenshot_btn = ttk.Button(icons_box, image=get_icon("camera", 15, FG_MUTED),
                                          command=self._screenshot, style="Icon.TButton")
        self.screenshot_btn.pack(side="left", padx=1)

        self.record_btn = ttk.Button(icons_box, command=self._record, style="Icon.TButton")
        self.record_btn.pack(side="left", padx=1)

        self.settings_btn = ttk.Button(icons_box, image=get_icon("gear", 15, FG_MUTED),
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

    def _rename(self):
        self.callbacks["rename"](self.serial)

    def _render_model_text(self):
        text = self.display_name
        if self.recording_anchor is not None:
            secs = int(time.monotonic() - self.recording_anchor)
            text += f"   ● {t('device.recording')} {secs // 60:02d}:{secs % 60:02d}"
        self.model_label.config(text=text, foreground=RED if self.recording_anchor is not None else "")

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
        self.dot.itemconfig(self.dot_id, fill=color)

        if self.recording:
            if self.recording_anchor is None:
                self.recording_anchor = time.monotonic() - (info.get("recording_seconds") or 0)
        else:
            self.recording_anchor = None
        self._render_model_text()

        detail = f"{self.serial}"
        if info["status"] == "mirroring" and info.get("port"):
            detail += f"  |  {t('device.port')} {info['port']}  |  {label}"
        elif info["status"] == "problem" and info.get("problem_state"):
            detail += f"  |  {_problem_hint_text(info['problem_state'])}"
        else:
            detail += f"  |  {label}"
        self.detail_label.config(text=detail)

        if self.status == "mirroring":
            self.toggle_btn.config(text=t("btn.stop"), image=get_icon("stop", 13, RED), state="normal")
        elif self.status in ("ready", "blocked"):
            self.toggle_btn.config(text=t("btn.start"), image=get_icon("play", 13, GREEN), state="normal")
        else:
            self.toggle_btn.config(text=t("btn.start"), image=get_icon("play", 13, GREEN), state="disabled")

        is_wireless = ":" in self.serial
        can_touch = self.status in ("mirroring", "ready", "blocked")
        self.wifi_btn.config(state="normal" if (can_touch and not is_wireless) else "disabled")
        self.settings_btn.config(state="normal" if can_touch else "disabled")
        self.screenshot_btn.config(state="normal" if can_touch else "disabled")

        if self.recording:
            self.record_btn.config(image=get_icon("stop", 13, RED),
                                    state="normal" if self.status == "mirroring" else "disabled")
        else:
            self.record_btn.config(image=get_icon("record", 13, RED),
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
            self.border.config(bg=ACCENT if n % 2 else original)
            self.border.after(90, lambda: step(n - 1))

        step(4)

    def destroy(self):
        self.border.destroy()


class App:
    def __init__(self, root: tk.Tk):
        # Idioma detectado (ou lido de settings.json) ANTES de montar qualquer
        # texto - senao a interface inteira nasceria com as strings padrao
        # (portugues) e so mudaria depois, sem nenhum efeito visivel.
        i18n.init_language(engine.load_settings().get("language"))

        self.root = root
        root.title(t("app.title"))
        root.geometry("640x620")
        root.minsize(520, 400)
        root.configure(bg=BG)
        _apply_dark_titlebar(root)  # antes de qualquer coisa aparecer na tela

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
        # Fonte padrao pra TUDO (inclusive widgets tk.* que nao herdam do ttk.Style,
        # como Label/Text avulsos): "*Font" e um wildcard do Tk que cobre qualquer
        # widget sem fonte propria explicita. Widgets com font=(...) definido no
        # proprio construtor continuam mandando (isso aqui e so o padrao/fallback).
        self.root.option_add("*Font", FONT_DEFAULT)

        # Tema Sun Valley (sv_ttk) - da o visual Windows 11 moderno (cantos
        # arredondados, hover, cores) a QUALQUER widget ttk existente, sem precisar
        # trocar nenhum widget de lugar. Os estilos customizados abaixo (Card.*,
        # Header.*, etc.) so ajustam cor/fonte especificos por cima dele.
        sv_ttk.set_theme("dark", self.root)
        style = ttk.Style(self.root)
        style.configure(".", font=FONT_DEFAULT)  # padrao pra todos os widgets ttk
        style.configure("Card.TFrame", background=SURFACE)
        style.configure("Card.TLabel", background=SURFACE, foreground=FG, font=("Segoe UI", 10, "bold"))
        style.configure("CardMuted.TLabel", background=SURFACE, foreground=FG_MUTED)
        style.configure("Icon.TButton", padding=3)
        style.configure("Toggle.TButton", font=("Segoe UI", 9, "bold"))
        style.configure("Summary.TLabel", font=("Segoe UI", 9, "bold"), foreground=FG)
        style.configure("Header.TLabel", font=("Segoe UI", 9, "bold"), foreground=FG)
        style.configure("Title.TLabel", font=("Segoe UI", 13, "bold"), foreground=FG)

        style.configure("Update.TButton", font=("Segoe UI", 8), foreground=ACCENT, padding=(8, 3))
        style.map("Update.TButton", foreground=[("disabled", FG_SUBTLE)])
        style.configure("Bulk.TButton", font=("Segoe UI", 8), padding=(8, 3))

    # ---------------------------------------------------------------- UI --
    def _build_ui(self):
        # Cabecalho: chrome escuro unificado com o resto da janela (nada de bloco
        # solido colorido) - a identidade azul do app fica so no icone e nos
        # destaques (nome do app, botao de atualizar, icones de acao).
        top = ttk.Frame(self.root, padding=(16, 14, 16, 12))
        top.pack(fill="x")

        row1 = ttk.Frame(top)
        row1.pack(fill="x")
        ttk.Label(row1, text=t("app.title"), style="Title.TLabel").pack(side="left")
        self.summary_label = ttk.Label(row1, text=t("app.loading"), style="Summary.TLabel")
        self.summary_label.pack(side="right")

        ttk.Label(top, text=t("app.subtitle"),
                  foreground=FG_MUTED, font=("Segoe UI", 8)).pack(anchor="w", pady=(2, 0))

        row2 = ttk.Frame(top)
        row2.pack(fill="x", pady=(10, 0))
        self.stay_awake_var = tk.BooleanVar(value=self.manager.stay_awake)
        ttk.Checkbutton(
            row2, text=t("app.stay_awake"),
            variable=self.stay_awake_var, command=self._toggle_stay_awake,
        ).pack(side="left")

        self.always_on_top_var = tk.BooleanVar(value=self.manager.always_on_top)
        ttk.Checkbutton(
            row2, text=t("app.always_on_top"),
            variable=self.always_on_top_var, command=self._toggle_always_on_top,
        ).pack(side="left", padx=(16, 0))

        row3 = ttk.Frame(top)
        row3.pack(fill="x", pady=(8, 0))
        ttk.Button(row3, text=t("app.start_all"), style="Bulk.TButton",
                   command=self._on_start_all).pack(side="left")
        ttk.Button(row3, text=t("app.stop_all"), style="Bulk.TButton",
                   command=self._on_stop_all).pack(side="left", padx=(6, 0))
        ttk.Button(row3, text=t("app.shortcuts"), style="Bulk.TButton",
                   command=self._on_show_shortcuts).pack(side="left", padx=(6, 0))

        divider = tk.Frame(self.root, bg=BORDER, height=1)
        divider.pack(fill="x")

        self.content = ttk.Frame(self.root)
        self.content.pack(fill="both", expand=True)

        self.loading_frame = ttk.Frame(self.content)
        self.loading_frame.pack(fill="both", expand=True)
        loading_box = ttk.Frame(self.loading_frame)
        loading_box.place(relx=0.5, rely=0.45, anchor="center")
        ttk.Label(loading_box, text=t("app.loading_devices"),
                  font=("Segoe UI", 10)).pack(pady=(0, 10))
        self.loading_bar = ttk.Progressbar(loading_box, mode="indeterminate", length=220)
        self.loading_bar.pack()
        self.loading_bar.start(12)

        self.list_frame = ttk.Frame(self.content, padding=(14, 10))
        self.empty_label = ttk.Label(
            self.list_frame, text=t("app.empty"),
            foreground=FG_MUTED, justify="center",
        )
        self.empty_label.pack(pady=40)

        bottom = ttk.Frame(self.root, padding=(14, 6))
        bottom.pack(fill="x")
        ttk.Label(bottom, text=t("app.activity"), style="Header.TLabel").pack(side="left")
        ttk.Button(
            bottom, text=t("app.check_update"), image=get_icon("refresh", 13, ACCENT),
            compound="left", style="Update.TButton", command=self._on_check_update,
        ).pack(side="right")

        log_border = tk.Frame(self.root, bg=BORDER)
        log_border.pack(fill="x", padx=14, pady=(0, 8))
        self.log_text = tk.Text(log_border, height=6, state="disabled", font=("Consolas", 9),
                                 bg=SURFACE, fg=FG_MUTED, insertbackground=FG,
                                 selectbackground=ACCENT, relief="flat", padx=10, pady=8,
                                 spacing1=1, spacing3=1)
        self.log_text.pack(fill="x", padx=1, pady=1)
        # Uma cor por gravidade - da pra bater o olho e achar um erro no meio do
        # historico sem ler linha por linha. O timestamp fica sempre discreto,
        # so a mensagem em si muda de cor.
        self.log_text.tag_configure("timestamp", foreground=FG_SUBTLE)
        self.log_text.tag_configure("info", foreground=FG_MUTED)
        self.log_text.tag_configure("success", foreground=GREEN)
        self.log_text.tag_configure("warning", foreground=AMBER)
        self.log_text.tag_configure("error", foreground=RED)

        footer = ttk.Frame(self.root, padding=(14, 0, 14, 10))
        footer.pack(fill="x")
        ttk.Label(footer, text=t("app.footer_hint"),
                  foreground=FG_MUTED, font=FONT_MUTED).pack(side="left")
        ttk.Label(footer, text=f"v{updater.APP_VERSION}",
                  foreground=FG_SUBTLE, font=FONT_MUTED).pack(side="right")

    def _toggle_stay_awake(self):
        self.action_queue.put({"type": "set_stay_awake", "value": self.stay_awake_var.get()})
        self.wake_event.set()

    def _toggle_always_on_top(self):
        self.action_queue.put({"type": "set_always_on_top", "value": self.always_on_top_var.get()})
        self.wake_event.set()

    def _log(self, msg: str, level: str = "info"):
        """Adiciona uma linha na Atividade recente, com hora e cor por gravidade
        (info/success/warning/error) - level decide so a cor, a mensagem em si
        continua descrevendo o que aconteceu por extenso."""
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.config(state="normal")
        self.log_text.insert("end", f"{timestamp}  ", "timestamp")
        self.log_text.insert("end", f"{msg}\n", level)
        # nao deixa crescer pra sempre numa sessao longa (o app pode ficar dias
        # aberto na bandeja) - cada linha ocupa memoria e deixa o widget mais
        # pesado pra redesenhar/rolar
        total_lines = int(self.log_text.index("end-1c").split(".")[0])
        if total_lines > LOG_MAX_LINES:
            self.log_text.delete("1.0", f"{total_lines - LOG_MAX_LINES + 1}.0")
        self.log_text.see("end")
        self.log_text.config(state="disabled")

    # ------------------------------------------------------------- tray --
    def _setup_tray(self):
        image = icons.app_icon(64)
        menu = pystray.Menu(
            pystray.MenuItem(t("tray.open"), self._tray_open, default=True),
            pystray.MenuItem(t("tray.exit"), self._tray_exit),
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
        elif kind == "set_always_on_top":
            self.manager.set_always_on_top(action["value"])
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
                    if started:
                        self._log(t("log.recording_started", model=model, path=path), "success")
                    else:
                        self._log(t("log.recording_saved", model=model), "success")
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
                        self._log(t("log.update_available", version=info['version']), "success")
                        self._ensure_window_visible()
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
            t_ = ev.get("type")
            if t_ == "arrived":
                self._log(t("log.device_arrived", model=ev['model'], port=ev['port']), "success")
            elif t_ == "reconnected":
                self._log(t("log.device_reconnected", model=ev['model']), "success")
            elif t_ == "departed":
                self._log(t("log.device_departed", model=ev['model']), "warning")
                self._show_disconnect_dialog(ev["serial"], ev["model"])
            elif t_ == "crashed":
                self._log(t("log.device_crashed", model=ev['model'], attempt=ev['attempt']), "error")
                self._show_disconnect_dialog(ev["serial"], ev["model"])
            elif t_ == "closed_by_user":
                # janela fechada pelo proprio X do scrcpy (fora do painel) -
                # tratado como um "parar" manual: so avisa, sem tentar reconectar
                # nem mostrar pop-up (o usuario decidiu fechar de proposito).
                self._log(t("log.device_closed", model=ev['model']), "info")
            elif t_ == "blocked":
                self._log(t("log.device_blocked", model=ev['model'], serial=ev['serial']), "error")
            elif t_ == "problem":
                hint = _problem_hint_text(ev.get("state"))
                self._log(t("log.device_problem", serial=ev['serial'], hint=hint), "warning")
            elif t_ == "error":
                self._log(t("log.device_error", serial=ev['serial']), "error")
            elif t_ == "apk_pushing":
                self._log(t("log.apk_pushing", name=ev['name'], model=ev['model']), "info")
            elif t_ == "apk_push_failed":
                self._log(t("log.apk_push_failed", name=ev['name'], model=ev['model']), "error")
            elif t_ == "apk_installing":
                self._log(t("log.apk_installing", name=ev['name'], model=ev['model']), "info")
            elif t_ == "apk_installed":
                self._log(t("log.apk_installed", name=ev['name'], model=ev['model']), "success")
            elif t_ == "apk_install_failed":
                self._log(t("log.apk_install_failed", name=ev['name'], model=ev['model']), "error")

    def _render(self, snapshot: dict):
        self.summary_label.config(text=t("app.summary", n=len(snapshot)))

        if snapshot:
            self.empty_label.pack_forget()
        else:
            self.empty_label.pack(pady=40)

        for serial in list(self.rows):
            if serial not in snapshot:
                self.rows[serial].destroy()
                del self.rows[serial]

        callbacks = {"toggle": self._on_toggle, "wifi": self._on_wifi, "settings": self._on_settings,
                     "record": self._on_record, "screenshot": self._on_screenshot, "rename": self._on_rename}
        for serial, info in sorted(snapshot.items(), key=lambda kv: kv[1]["display_name"]):
            if serial not in self.rows:
                row = DeviceRow(self.list_frame, serial, callbacks)
                row.border.pack(fill="x", pady=(0, 6))
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
        # encerra os espelhamentos/gravacoes com calma (pra nao corromper um
        # arquivo de gravacao em andamento) e mata o servidor do adb - esse
        # mesmo shutdown() e usado ao fechar o painel normalmente, e e o que
        # evita o instalador travar com "arquivo em uso" no adb.exe.
        self.manager.shutdown()
        if self.tray_icon:
            try:
                self.tray_icon.stop()
            except Exception:
                pass
        # se tudo der certo, apply_update_and_restart encerra o processo (os._exit)
        # e o codigo abaixo nunca roda. So chega aqui se algo falhar de forma
        # detectavel - antes, isso sumia silenciosamente e a atualizacao "nao fazia nada".
        error = updater.apply_update_and_restart(installer_path)
        if error:
            key, params = error
            error_text = t(key, **params)
            self._log(error_text, "error")
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

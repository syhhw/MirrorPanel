"""Traducoes da interface - portugues (padrao) e ingles.

O idioma e detectado automaticamente a partir do idioma de exibicao do Windows
na primeira execucao; depois disso fica salvo em settings.json e so muda se o
usuario trocar manualmente (engrenagem > Idioma, ou equivalente).

Uso: from i18n import t
     t("chave")                      -> string fixa
     t("chave", model="Pixel 7")     -> string com {placeholders}, preenchidos
                                         via str.format()
"""
import ctypes

DEFAULT_LANG = "pt"
LANGUAGES = {"pt": "Portugues", "en": "English"}

_current_lang = DEFAULT_LANG

_STRINGS = {
    # ---------------------------------------------------------------- app --
    "app.title": {"pt": "MirrorPanel", "en": "MirrorPanel"},
    "app.subtitle": {
        "pt": "Clique Iniciar para espelhar um aparelho especifico.",
        "en": "Click Start to mirror a specific device.",
    },
    "app.loading": {"pt": "Carregando...", "en": "Loading..."},
    "app.loading_devices": {"pt": "Carregando dispositivos ADB...", "en": "Loading ADB devices..."},
    "app.summary": {"pt": "{n} dispositivo(s)", "en": "{n} device(s)"},
    "app.empty": {
        "pt": "Nenhum dispositivo detectado ainda.\nConecte um celular por USB.",
        "en": "No device detected yet.\nConnect a phone via USB.",
    },
    "app.activity": {"pt": "Atividade recente", "en": "Recent activity"},
    "app.check_update": {"pt": " Verificar atualizacoes", "en": " Check for updates"},
    "app.footer_hint": {
        "pt": "Fechar encerra os espelhamentos abertos.",
        "en": "Closing stops any open mirrors.",
    },
    "app.stay_awake": {"pt": "Manter tela do celular sempre ligada", "en": "Keep phone screen always on"},
    "app.always_on_top": {"pt": "Manter janelas sempre visiveis (por cima)", "en": "Keep mirror windows always on top"},
    "app.minimize_to_tray": {"pt": "Minimizar pra bandeja", "en": "Minimize to tray"},
    "app.minimize_to_tray_hint": {
        "pt": "Ligado, minimizar esconde o painel na bandeja em vez da barra de tarefas.",
        "en": "When on, minimizing hides the panel to the tray instead of the taskbar.",
    },
    "app.start_all": {"pt": "Iniciar todos", "en": "Start all"},
    "app.stop_all": {"pt": "Parar todos", "en": "Stop all"},
    "app.shortcuts": {"pt": "Atalhos", "en": "Shortcuts"},
    "app.batch_transfer": {"pt": "Enviar arquivo p/ todos", "en": "Send file to all"},
    "app.settings": {"pt": "Configuracoes", "en": "Settings"},

    # ------------------------------------------------ transferencia em lote --
    "batch_transfer.pick_file": {"pt": "Escolha um arquivo para enviar", "en": "Choose a file to send"},
    "batch_transfer.no_devices": {
        "pt": "Nenhum aparelho detectado no momento.",
        "en": "No device currently detected.",
    },

    # --------------------------------------------------------------- tray --
    "tray.open": {"pt": "Abrir painel", "en": "Open panel"},
    "tray.exit": {"pt": "Sair", "en": "Exit"},

    # ------------------------------------------------------------ status --
    "status.mirroring": {"pt": "Espelhando", "en": "Mirroring"},
    "status.ready": {"pt": "Pronto para espelhar", "en": "Ready to mirror"},
    "status.problem": {"pt": "Atencao", "en": "Attention"},
    "status.blocked": {"pt": "Falhou varias vezes", "en": "Failed repeatedly"},

    # ------------------------------------------------------------- botoes --
    "btn.start": {"pt": "Iniciar", "en": "Start"},
    "btn.stop": {"pt": "Parar", "en": "Stop"},
    "btn.cancel": {"pt": "Cancelar", "en": "Cancel"},
    "btn.save": {"pt": "Salvar", "en": "Save"},
    "btn.record": {"pt": "Gravar", "en": "Record"},
    "btn.no": {"pt": "Nao", "en": "No"},
    "btn.yes": {"pt": "Sim", "en": "Yes"},
    "btn.later": {"pt": "Mais tarde", "en": "Later"},
    "btn.update": {"pt": "Atualizar", "en": "Update"},
    "btn.exit": {"pt": "Sair", "en": "Exit"},
    "btn.reconnect": {"pt": "Reconectar", "en": "Reconnect"},
    "btn.close": {"pt": "Fechar", "en": "Close"},

    # -------------------------------------------------- device row/timer --
    "device.recording": {"pt": "Gravando", "en": "Recording"},
    "device.port": {"pt": "porta", "en": "port"},

    # ---------------------------------------------- dicas dos botoes-icone --
    # Os botoes do cartao de aparelho sao so icone (sem texto, pra nao alargar
    # a linha) - essas dicas aparecem ao passar o mouse por cima de cada um.
    "device.tip_rename": {"pt": "Renomear", "en": "Rename"},
    "device.tip_wifi": {"pt": "Ativar Wi-Fi", "en": "Enable Wi-Fi"},
    "device.tip_send_file": {"pt": "Enviar arquivo", "en": "Send file"},
    "device.tip_screenshot": {"pt": "Tirar print", "en": "Take screenshot"},
    "device.tip_record": {"pt": "Gravar tela", "en": "Record screen"},
    "device.tip_stop_recording": {"pt": "Parar gravacao", "en": "Stop recording"},
    "device.tip_settings": {"pt": "Ajustes de qualidade", "en": "Quality settings"},

    # -------------------------------------------------------- ajustes --
    "settings.app_title": {"pt": "Configuracoes do MirrorPanel", "en": "MirrorPanel settings"},
    "settings.title": {"pt": "Ajustes - {model}", "en": "Settings - {model}"},
    "settings.codec": {"pt": "Codec de video:", "en": "Video codec:"},
    "settings.quality": {"pt": "Qualidade:", "en": "Quality:"},
    "settings.fps": {"pt": "Taxa de quadros:", "en": "Frame rate:"},
    "settings.audio": {"pt": "Transmitir audio do aparelho", "en": "Stream device audio"},
    "settings.bitrate.low": {"pt": "Baixa - economiza dados", "en": "Low - saves data"},
    "settings.bitrate.medium": {"pt": "Media", "en": "Medium"},
    "settings.bitrate.high": {"pt": "Alta (recomendada)", "en": "High (recommended)"},
    "settings.bitrate.veryhigh": {"pt": "Muito alta", "en": "Very high"},
    "settings.fps.30": {"pt": "30 - economiza bateria", "en": "30 - saves battery"},
    "settings.fps.60": {"pt": "60 (recomendado)", "en": "60 (recommended)"},
    "settings.fps.90": {"pt": "90 - mais fluido", "en": "90 - smoother"},

    # ------------------------------------------------------- renomear --
    "rename.title": {"pt": "Renomear - {model}", "en": "Rename - {model}"},
    "rename.label": {"pt": "Apelido (so neste painel):", "en": "Nickname (this panel only):"},

    # -------------------------------------------------------- gravacao --
    "recording.title": {"pt": "Gravar - {model}", "en": "Record - {model}"},
    "recording.save_to": {"pt": "Sera salvo em:", "en": "Will be saved to:"},
    "recording.light": {
        "pt": "Gravacao leve (recomendado para aparelhos antigos)",
        "en": "Light recording (recommended for older devices)",
    },
    "recording.light_hint": {
        "pt": "Reduz qualidade (bitrate/fps/resolucao) so durante a gravacao, "
              "para nao travar celulares mais fracos.",
        "en": "Reduces quality (bitrate/fps/resolution) only during recording, "
              "so weaker phones don't lag.",
    },

    # --------------------------------------------------------- atualizar --
    "update.title": {"pt": "Atualizacao disponivel", "en": "Update available"},
    "update.available": {"pt": "MirrorPanel {version} disponivel", "en": "MirrorPanel {version} available"},
    "update.notes_header": {"pt": "Novidades desta versao:", "en": "What's new in this version:"},
    "update.no_notes": {"pt": "(sem notas de versao)", "en": "(no release notes)"},
    "update.downloading_title": {"pt": "Atualizando MirrorPanel", "en": "Updating MirrorPanel"},
    "update.downloading": {"pt": "Baixando atualizacao...", "en": "Downloading update..."},
    "update.progress": {"pt": "{pct}%  ({done} KB / {total} KB)", "en": "{pct}%  ({done} KB / {total} KB)"},
    "update.progress_unknown": {"pt": "{done} KB baixados", "en": "{done} KB downloaded"},

    # ------------------------------------------------------------- print --
    "screenshot.title": {"pt": "Print capturado", "en": "Screenshot captured"},
    "screenshot.captured": {"pt": "Print capturado!", "en": "Screenshot captured!"},
    "screenshot.copy_question": {
        "pt": "Deseja copiar para a area de transferencia do Windows?",
        "en": "Copy it to the Windows clipboard?",
    },

    # ---------------------------------------------------- desconectado --
    "disconnected.title": {"pt": "Espelhamento desconectado", "en": "Mirroring disconnected"},
    "disconnected.heading": {"pt": "Espelhamento desconectado", "en": "Mirroring disconnected"},
    "disconnected.message": {
        "pt": "A conexao com {model} foi interrompida.",
        "en": "The connection with {model} was interrupted.",
    },

    # ------------------------------------------------- confirmar saida --
    "close_confirm.title": {"pt": "Sair do MirrorPanel?", "en": "Exit MirrorPanel?"},
    "close_confirm.message": {
        "pt": "{n} gravacao(oes) em andamento sera(ao) interrompida(s) se voce sair agora.",
        "en": "{n} recording(s) in progress will be cut short if you exit now.",
    },
    "close_confirm.stay": {"pt": "Continuar gravando", "en": "Keep recording"},

    # ---------------------------------------------- confirmar atualizacao --
    "update_confirm.title": {"pt": "Aplicar atualizacao agora?", "en": "Apply update now?"},
    "update_confirm.message": {
        "pt": "{n} gravacao(oes) em andamento sera(ao) interrompida(s) se atualizar agora.",
        "en": "{n} recording(s) in progress will be cut short if you update now.",
    },
    "update_confirm.wait": {"pt": "Esperar terminar", "en": "Wait until done"},

    # ------------------------------------------------------------ atalhos --
    "shortcuts.title": {"pt": "Atalhos de teclado", "en": "Keyboard shortcuts"},
    "shortcuts.hint": {
        "pt": "Com a janela do espelhamento em foco, use:",
        "en": "With the mirror window focused, use:",
    },
    "shortcuts.rotate": {"pt": "Girar a tela do aparelho", "en": "Rotate device screen"},
    "shortcuts.home": {"pt": "Botao Inicio", "en": "Home button"},
    "shortcuts.back": {"pt": "Botao Voltar", "en": "Back button"},
    "shortcuts.app_switch": {"pt": "Aplicativos recentes", "en": "Recent apps"},
    "shortcuts.notifications": {"pt": "Abrir notificacoes", "en": "Expand notifications"},
    "shortcuts.screen_off": {"pt": "Desligar so a tela do aparelho (continua espelhando)", "en": "Turn off device screen only (mirroring continues)"},
    "shortcuts.volume": {"pt": "Volume +/-", "en": "Volume +/-"},
    "shortcuts.copy": {"pt": "Copiar do celular para o PC", "en": "Copy from phone to PC"},
    "shortcuts.paste": {"pt": "Colar do PC no celular", "en": "Paste from PC to phone"},
    "shortcuts.resize": {"pt": "Ajustar janela ao tamanho real (pixel a pixel)", "en": "Resize window to actual size (pixel-perfect)"},
    "shortcuts.drop_apk": {
        "pt": "Arrastar um .apk pra janela instala ele no aparelho (outros arquivos sao so enviados)",
        "en": "Drag a .apk onto the window to install it on the device (other files are just sent)",
    },
    "shortcuts.mod_hint": {
        "pt": "MOD = tecla Alt esquerdo ou Windows (Super)",
        "en": "MOD = Left Alt or Windows (Super) key",
    },

    # -------------------------------------------------------------- logs --
    "log.started": {"pt": "Painel iniciado. Detectando dispositivos...", "en": "Panel started. Detecting devices..."},
    "log.wifi_on": {
        "pt": "Wi-Fi ativado em {model} ({target}). Pode tirar o cabo.",
        "en": "Wi-Fi enabled on {model} ({target}). You can unplug the cable.",
    },
    "log.wifi_failed": {
        "pt": "Nao foi possivel ativar Wi-Fi em {model}. Confira se o celular esta na mesma rede.",
        "en": "Could not enable Wi-Fi on {model}. Check that the phone is on the same network.",
    },
    "log.wifi_activating": {"pt": "Ativando Wi-Fi em {model}...", "en": "Enabling Wi-Fi on {model}..."},
    "log.recording_started": {"pt": "Gravando {model} em {path}", "en": "Recording {model} to {path}"},
    "log.recording_saved": {"pt": "Gravacao de {model} salva.", "en": "Recording of {model} saved."},
    "log.screenshot_saved": {"pt": "Print de {model} salvo em {path}", "en": "Screenshot of {model} saved to {path}"},
    "log.screenshot_failed": {"pt": "Falha ao tirar print de {model}.", "en": "Failed to take screenshot of {model}."},
    "log.clipboard_ok": {
        "pt": "Print copiado para a area de transferencia (Win+V pra ver).",
        "en": "Screenshot copied to clipboard (Win+V to view).",
    },
    "log.clipboard_failed": {
        "pt": "Nao foi possivel copiar o print para a area de transferencia.",
        "en": "Could not copy the screenshot to the clipboard.",
    },
    "log.update_available": {"pt": "Nova versao disponivel: {version}", "en": "New version available: {version}"},
    "log.update_current": {"pt": "Voce esta atualizado (versao {version}).", "en": "You're up to date (version {version})."},
    "log.update_check_failed": {
        "pt": "Nao foi possivel verificar atualizacoes agora (sem internet ou GitHub indisponivel).",
        "en": "Could not check for updates right now (no internet or GitHub unavailable).",
    },
    "log.update_checking": {"pt": "Verificando atualizacoes...", "en": "Checking for updates..."},
    "log.update_downloaded": {"pt": "Download concluido. Aplicando atualizacao...", "en": "Download complete. Applying update..."},
    "log.device_arrived": {"pt": "{model} conectado (porta {port})", "en": "{model} connected (port {port})"},
    "log.device_reconnected": {"pt": "{model} reconectado automaticamente.", "en": "{model} reconnected automatically."},
    "log.device_departed": {"pt": "{model} desconectado", "en": "{model} disconnected"},
    "log.device_closed": {
        "pt": "{model}: janela de espelhamento fechada.",
        "en": "{model}: mirroring window closed.",
    },
    "log.device_crashed": {
        "pt": "{model} encerrou sozinho (tentativa {attempt})",
        "en": "{model} closed unexpectedly (attempt {attempt})",
    },
    "log.device_blocked": {
        "pt": "{model} falhou varias vezes - veja logs/scrcpy_{serial}.log",
        "en": "{model} failed repeatedly - see logs/scrcpy_{serial}.log",
    },
    "log.device_problem": {"pt": "{serial}: {hint}", "en": "{serial}: {hint}"},
    "log.device_error": {"pt": "Falha ao iniciar {serial}", "en": "Failed to start {serial}"},
    "log.apk_pushing": {"pt": "Enviando {name} para {model}...", "en": "Sending {name} to {model}..."},
    "log.apk_pushed": {
        "pt": "{name} enviado com sucesso para {model}.",
        "en": "{name} successfully sent to {model}.",
    },
    "log.apk_push_failed": {"pt": "Falha ao enviar {name} para {model}.", "en": "Failed to send {name} to {model}."},
    "log.apk_installing": {"pt": "Instalando {name} em {model}...", "en": "Installing {name} on {model}..."},
    "log.apk_installed": {
        "pt": "{name} instalado com sucesso em {model}.",
        "en": "{name} successfully installed on {model}.",
    },
    "log.apk_install_failed": {"pt": "Falha ao instalar {name} em {model}.", "en": "Failed to install {name} on {model}."},
    "log.batch_transfer_started": {
        "pt": "Enviando {name} para {count} aparelho(s)...",
        "en": "Sending {name} to {count} device(s)...",
    },
    "log.retrying": {"pt": "Tentando reconectar {model}...", "en": "Trying to reconnect {model}..."},
    "log.settings_saved": {"pt": "Ajustes salvos para {model}.", "en": "Settings saved for {model}."},
    "log.nickname_saved": {"pt": "{model} agora aparece como \"{nickname}\".", "en": "{model} now shows as \"{nickname}\"."},

    # --------------------------------------------------------- mensagens --
    "msg.update_apply_failed": {
        "pt": "Falha ao aplicar a atualizacao:\n{error}",
        "en": "Failed to apply the update:\n{error}",
    },
    "msg.update_download_failed": {
        "pt": "Falha ao baixar a atualizacao. Tente novamente mais tarde.",
        "en": "Failed to download the update. Please try again later.",
    },
    "error.installer_missing": {
        "pt": "Arquivo do instalador nao encontrado ou incompleto: {path}",
        "en": "Installer file not found or incomplete: {path}",
    },
    "error.installer_start_failed": {
        "pt": "Nao foi possivel iniciar o instalador: {error}",
        "en": "Could not start the installer: {error}",
    },
    "error.installer_exited": {
        "pt": "O instalador encerrou sozinho com erro (codigo {code}).",
        "en": "The installer exited on its own with an error (code {code}).",
    },

    # ------------------------------------------------------------- dicas --
    "hint.unauthorized": {
        "pt": "desbloqueie o celular e aceite 'Permitir depuracao USB'",
        "en": "unlock the phone and accept 'Allow USB debugging'",
    },
    "hint.offline": {
        "pt": "reconecte o cabo ou reinicie o ADB (offline)",
        "en": "reconnect the cable or restart ADB (offline)",
    },
}


def _detect_system_language() -> str:
    """Idioma de exibicao do Windows (LANG_PORTUGUESE = pt, qualquer outro = en) -
    usado so na primeira execucao, antes do usuario ter uma preferencia salva."""
    try:
        lang_id = ctypes.windll.kernel32.GetUserDefaultUILanguage()
        primary = lang_id & 0x3FF
        LANG_PORTUGUESE = 0x16
        return "pt" if primary == LANG_PORTUGUESE else "en"
    except Exception:
        return DEFAULT_LANG


def init_language(saved: str | None):
    """Chamado uma vez, no inicio do programa. 'saved' vem do settings.json (None
    se e a primeira execucao, e ai detecta do Windows)."""
    global _current_lang
    if saved in LANGUAGES:
        _current_lang = saved
    else:
        _current_lang = _detect_system_language()


def set_language(lang: str):
    global _current_lang
    if lang in LANGUAGES:
        _current_lang = lang


def get_language() -> str:
    return _current_lang


def t(key: str, **kwargs) -> str:
    entry = _STRINGS.get(key)
    if entry is None:
        return key
    template = entry.get(_current_lang) or entry.get(DEFAULT_LANG, key)
    return template.format(**kwargs) if kwargs else template

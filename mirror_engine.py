"""Motor de deteccao/lancamento de espelhamento Android via scrcpy/adb.

Usado tanto pelo console (connect.py) quanto pelo painel grafico (panel.py).
Nao imprime nada na tela - so loga e devolve eventos, pra caber em qualquer
interface (console ou GUI).
"""
import ctypes
import ctypes.wintypes
import json
import logging
import os
import re
import socket
import subprocess
import sys
import time
import winreg
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

# ================================================================
#  PERFIS PADRAO DE DISPOSITIVO (usados so se o aparelho nunca foi
#  ajustado pelo botao de engrenagem no painel - ai vale o settings.json)
#  Chave = serial (especifico) OU modelo (portavel entre cabos/PCs)
# ================================================================
PROFILES = {
    "RQ8N604W3DZ": "--video-codec=h264 --audio-codec=opus --audio-buffer=5 -b 4M --max-fps 60",
    "RQGL300X9QT": "--video-codec=h265 --audio-codec=opus --audio-buffer=5 -b 8M --max-fps 60",
}

# Flags para dispositivos sem perfil nem ajuste salvo
DEFAULT_FLAGS = "--video-codec=h264 --audio-codec=opus --audio-buffer=5 -b 8M --max-fps 60"

DEFAULT_DEVICE_SETTINGS = {"video_codec": "h264", "bitrate": "8M", "max_fps": 60, "audio": True}

# ================================================================
#  OPCOES GLOBAIS
# ================================================================
ALWAYS_ON_TOP = False        # janelas sempre acima das outras
DISABLE_SCREENSAVER = True   # impede o PC de bloquear/escurecer
DEFAULT_STAY_AWAKE = True    # mantem a tela do celular ligada enquanto espelhando (com cabo) - tem botao no painel
PREFER_TEXT_INPUT = True     # digita acentos (ç, é, ã...) corretamente; so atrapalha jogos que usam WASD

# Usado so durante a gravacao, quando o usuario marca "gravacao leve" (aparelhos antigos
# podem nao aguentar codificar em resolucao/fps altos ao mesmo tempo que gravam).
LIGHT_RECORDING_FLAGS = "--video-codec=h264 --no-audio -b 2M --max-fps 24 --max-size=1280"
AUTO_ARRANGE_WINDOWS = True  # organiza as janelas automaticamente em colunas
WINDOW_FILL_RATIO = 0.75     # % do espaco disponivel que a janela ocupa (deixa margem ao redor)
POLL_INTERVAL_SECONDS = 3    # intervalo entre verificacoes de dispositivos
WIFI_RETRY_EVERY = 10        # a cada N verificacoes, tenta reconectar Wi-Fi
MAX_CRASH_RETRIES = 3        # tentativas seguidas se o scrcpy cair sozinho (conectado)
SILENT_RECONNECT_ATTEMPTS = 3    # tentativas silenciosas em segundo plano antes de avisar
SILENT_RECONNECT_INTERVAL = 2.0  # segundos entre elas - filtra cabo com mau contato (oscilando)
                                   # sem incomodar o usuario com um pop-up a cada soluco
BASE_PORT = 27183

# ================================================================


def app_dir() -> Path:
    """Pasta onde o .exe de verdade fica salvo - usada pros logs, que precisam sobreviver
    entre execucoes (a pasta de extracao do onefile e temporaria e some ao fechar)."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def bin_dir() -> Path:
    """Pasta com adb.exe/scrcpy.exe. No .exe onefile isso e uma pasta temporaria
    (sys._MEIPASS) que o bootloader recria a cada execucao com os binarios embutidos."""
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", sys.executable))
    return Path(__file__).resolve().parent


def _videos_dir() -> Path:
    """Pasta 'Videos' de verdade do usuario, direto do registro do Windows - assim
    respeita se o usuario redirecionou a pasta pra outro lugar (outro disco, OneDrive
    etc.), em vez de simplesmente assumir que e "~\\Videos"."""
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
        ) as key:
            raw, _ = winreg.QueryValueEx(key, "My Video")
            return Path(os.path.expandvars(raw))
    except OSError:
        return Path.home() / "Videos"


SCRIPT_DIR = app_dir()
BIN_DIR = bin_dir()
ADB = BIN_DIR / "adb.exe"
SCRCPY = BIN_DIR / "scrcpy.exe"
LOG_DIR = SCRIPT_DIR / "logs"
SETTINGS_PATH = SCRIPT_DIR / "settings.json"

# Midia do usuario (prints/gravacoes) fica na biblioteca de Videos do Windows, nao
# dentro da pasta de instalacao do programa - assim sobra organizada e acessivel
# mesmo se o app for instalado em Program Files (sem precisar de admin pra gravar
# nela) ou reinstalado/desinstalado depois.
MEDIA_DIR = _videos_dir() / "MirrorPanel Media"
RECORDINGS_DIR = MEDIA_DIR / "Gravacoes"
SCREENSHOTS_DIR = MEDIA_DIR / "Capturas de tela"

SPI_GETWORKAREA = 0x0030
CREATE_NO_WINDOW = 0x08000000  # evita que cada chamada ao adb/tasklist abra um console visivel


def load_settings() -> dict:
    """Le settings.json (Wi-Fi salvos, ajuste por aparelho). So existe depois que
    o usuario mexe em algo pelo painel - nunca precisa ser editado a mao."""
    if SETTINGS_PATH.exists():
        try:
            data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            data.setdefault("wifi_devices", [])
            data.setdefault("device_overrides", {})
            data.setdefault("stay_awake", DEFAULT_STAY_AWAKE)
            return data
        except Exception:
            logging.exception("Falha ao ler settings.json - usando padrao")
    return {"wifi_devices": [], "device_overrides": {}, "stay_awake": DEFAULT_STAY_AWAKE}


def save_settings(data: dict):
    try:
        SETTINGS_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        logging.exception("Falha ao salvar settings.json")


def build_flags(device_settings: dict) -> str:
    """Traduz as opcoes amigaveis do painel (codec/qualidade/fps/audio) nas flags do scrcpy."""
    parts = [f"--video-codec={device_settings.get('video_codec', 'h264')}"]
    if device_settings.get("audio", True):
        parts += ["--audio-codec=opus", "--audio-buffer=5"]
    else:
        parts.append("--no-audio")
    parts.append(f"-b {device_settings.get('bitrate', '8M')}")
    parts.append(f"--max-fps {device_settings.get('max_fps', 60)}")
    return " ".join(parts)


@dataclass
class ActiveDevice:
    proc: subprocess.Popen
    log_fh: object
    model: str
    port: int
    slot: int
    started_at: float


class SlotManager:
    """Distribui colunas lado a lado (altura cheia da tela) sem jamais mover janelas ja abertas.

    Celular e retrato (estreito e alto), entao uma grade 2x2 prendia a fileira de
    cima no topo do monitor. Colunas de altura total mantêm toda janela centralizada
    verticalmente, sobrando so a largura para dividir entre os aparelhos.
    """

    def __init__(self, x, y, width, height):
        self.x, self.y, self.width, self.height = x, y, width, height
        self.cols = 1
        self.used: set[int] = set()

    def ensure_capacity(self, n: int):
        # Define o numero de colunas ANTES de posicionar um lote de janelas, para
        # que a primeira janela do lote nao reivindique a tela inteira so porque
        # as outras ainda nao tinham sido contabilizadas.
        self.cols = max(self.cols, n, 1)

    def acquire(self) -> int:
        while len(self.used) >= self.cols:
            self.cols += 1
        for slot in range(self.cols):
            if slot not in self.used:
                self.used.add(slot)
                return slot
        raise RuntimeError("nao foi possivel alocar um espaco na grade")

    def release(self, slot: int):
        self.used.discard(slot)

    def rect_for(self, slot: int):
        col_w = self.width // self.cols
        return self.x + slot * col_w, self.y, col_w, self.height


def setup_logging() -> Path:
    LOG_DIR.mkdir(exist_ok=True)
    log_file = LOG_DIR / f"connect_{datetime.now():%Y-%m-%d}.log"
    logging.basicConfig(
        filename=log_file, level=logging.INFO,
        format="%(asctime)s  %(message)s", datefmt="%H:%M:%S", encoding="utf-8",
    )
    return log_file


def run_adb(*args, timeout=10):
    return subprocess.run(
        [str(ADB), *args], capture_output=True, text=True, timeout=timeout,
        creationflags=CREATE_NO_WINDOW,
    )


def _close_windows_of_pid(pid: int) -> int:
    """Manda WM_CLOSE pra toda janela visivel desse processo - e assim que o scrcpy
    espera ser fechado (como clicar no X), o que garante gravacao finalizada direito."""
    WM_CLOSE = 0x0010
    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def _callback(hwnd, _lparam):
        owner_pid = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner_pid))
        if owner_pid.value == pid and user32.IsWindowVisible(hwnd):
            found.append(hwnd)
        return True

    user32.EnumWindows(_callback, 0)
    for hwnd in found:
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
    return len(found)


def get_window_rect_of_pid(pid: int):
    """Posicao/tamanho REAL (atual) da janela de video do scrcpy desse processo -
    usado pro flash da tela de print aparecer exatamente em cima dela, mesmo que
    o usuario tenha movido/redimensionado a janela manualmente."""
    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def _callback(hwnd, _lparam):
        owner_pid = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner_pid))
        if owner_pid.value == pid and user32.IsWindowVisible(hwnd):
            rect = ctypes.wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            found.append((rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top))
            return False
        return True

    user32.EnumWindows(_callback, 0)
    return found[0] if found else None


def graceful_stop(proc: subprocess.Popen, timeout: float = 3.0):
    """Fecha a janela do scrcpy (equivalente a clicar no X) pra ele finalizar sozinho
    qualquer gravacao em andamento, antes de partir pra um kill bruto como ultimo recurso."""
    try:
        if _close_windows_of_pid(proc.pid):
            proc.wait(timeout=timeout)
            return
    except Exception:
        pass
    try:
        proc.terminate()
    except Exception:
        pass


def check_binaries() -> list[str]:
    missing = []
    if not ADB.exists():
        missing.append("adb.exe")
    if not SCRCPY.exists():
        missing.append("scrcpy.exe")
    return missing


def get_work_area():
    """Area util do monitor principal (desconta a barra de tarefas)."""
    ctypes.windll.user32.SetProcessDPIAware()
    rect = ctypes.wintypes.RECT()
    ctypes.windll.user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rect), 0)
    return rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top


def kill_existing_scrcpy():
    """Limpeza unica na inicializacao (processos orfaos de uma execucao anterior)."""
    result = subprocess.run(
        ["tasklist", "/FI", "IMAGENAME eq scrcpy.exe", "/FO", "CSV", "/NH"],
        capture_output=True, text=True, creationflags=CREATE_NO_WINDOW,
    )
    running = [l for l in result.stdout.splitlines() if "scrcpy.exe" in l.lower()]
    if running:
        subprocess.run(
            ["taskkill", "/F", "/IM", "scrcpy.exe"],
            capture_output=True, text=True, creationflags=CREATE_NO_WINDOW,
        )
        time.sleep(2)
    return len(running)


def port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def next_free_port(start: int, used_ports: set[int]) -> int:
    # 'used_ports' evita que dois lancamentos na mesma rodada peguem a mesma porta
    # antes que o scrcpy anterior tenha efetivamente ocupado o socket (checagem
    # ao vivo sozinha tem uma corrida quando varios aparelhos chegam juntos).
    port = start
    while port in used_ports or not port_is_free(port):
        port += 1
    used_ports.add(port)
    return port


def list_devices() -> dict:
    """Uma consulta a 'adb devices'. Retorna {serial: estado}."""
    states = {}
    result = run_adb("devices", timeout=6)
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("List of devices"):
            continue
        parts = line.split()
        if len(parts) >= 2:
            states[parts[0]] = parts[1]
    return states


def get_model(serial: str, fallback: str) -> str:
    try:
        result = run_adb("-s", serial, "shell", "getprop", "ro.product.model", timeout=5)
        model = result.stdout.strip()
    except subprocess.TimeoutExpired:
        model = ""
    if model:
        safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in model)
        safe = "_".join(filter(None, safe.split("_")))
        if safe:
            return safe
    return fallback


def get_screen_resolution(serial: str):
    """Resolucao real da tela do aparelho (para a janela abrir do tamanho certo, nao esticada)."""
    try:
        result = run_adb("-s", serial, "shell", "wm", "size", timeout=5)
    except subprocess.TimeoutExpired:
        return None
    # "Override size" (se o usuario mudou a densidade/resolucao) tem prioridade sobre "Physical size"
    match = re.search(r"Override size:\s*(\d+)x(\d+)", result.stdout) or \
            re.search(r"Physical size:\s*(\d+)x(\d+)", result.stdout)
    if not match:
        return None
    w, h = int(match.group(1)), int(match.group(2))
    return (w, h) if w > 0 and h > 0 else None


def problem_hint(state: str) -> str:
    if state == "unauthorized":
        return "desbloqueie o celular e aceite 'Permitir depuracao USB'"
    if state == "offline":
        return "reconecte o cabo ou reinicie o ADB (offline)"
    return state


def launch_device(serial: str, num_hint: str, slots: SlotManager, used_ports: set[int], flags: str,
                   stay_awake: bool = DEFAULT_STAY_AWAKE, record_path: str | None = None) -> ActiveDevice | None:
    try:
        model = get_model(serial, num_hint)
        port = next_free_port(BASE_PORT, used_ports)
        slot = slots.acquire()

        window_args = ["--no-window-aspect-ratio-lock"]
        if PREFER_TEXT_INPUT:
            window_args.append("--prefer-text")
        if ALWAYS_ON_TOP:
            window_args.append("--always-on-top")
        if DISABLE_SCREENSAVER:
            window_args.append("--disable-screensaver")
        if stay_awake:
            window_args.append("--stay-awake")
        if record_path:
            window_args.append(f"--record={record_path}")
        if AUTO_ARRANGE_WINDOWS:
            cell_x, cell_y, cell_w, cell_h = slots.rect_for(slot)
            # limite-alvo menor que a coluna, para sobrar margem visivel ao redor
            target_w, target_h = cell_w * WINDOW_FILL_RATIO, cell_h * WINDOW_FILL_RATIO
            resolution = get_screen_resolution(serial)
            if resolution:
                dev_w, dev_h = resolution
                scale = min(target_w / dev_w, target_h / dev_h)
                win_w, win_h = max(1, int(dev_w * scale)), max(1, int(dev_h * scale))
            else:
                win_w, win_h = int(target_w), int(target_h)
            # centraliza a janela (com margem) dentro do seu quadrante
            win_x = cell_x + (cell_w - win_w) // 2
            win_y = cell_y + (cell_h - win_h) // 2
            window_args += [f"--window-x={win_x}", f"--window-y={win_y}", f"--window-width={win_w}", f"--window-height={win_h}"]

        log_path = LOG_DIR / f"scrcpy_{serial}.log"
        log_fh = open(log_path, "a", encoding="utf-8")
        log_fh.write(f"\n===== {datetime.now():%Y-%m-%d %H:%M:%S} iniciando =====\n")
        log_fh.flush()

        cmd = [str(SCRCPY), "-s", serial, "-p", str(port), "--window-title", model, *flags.split(), *window_args]
        # scrcpy.exe e um app de console e pode se auto-alocar um se nascer sem nenhum
        # (CREATE_NO_WINDOW sozinho nao segura isso de forma confiavel). Dar um console
        # NOVO porem ESCONDIDO satisfaz o scrcpy sem nunca deixar nada visivel.
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = 0  # SW_HIDE
        # CREATE_NEW_PROCESS_GROUP mantem cada scrcpy isolado dos outros no nivel do SO.
        proc = subprocess.Popen(
            cmd, cwd=str(BIN_DIR), stdout=log_fh, stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NEW_CONSOLE | subprocess.CREATE_NEW_PROCESS_GROUP,
            startupinfo=startupinfo,
        )

        logging.info("Conectado: %s (%s) porta=%s flags=%s", model, serial, port, flags)

        return ActiveDevice(proc=proc, log_fh=log_fh, model=model, port=port, slot=slot, started_at=time.monotonic())
    except Exception:
        logging.exception("Falha ao iniciar %s", serial)
        return None


class MirrorManager:
    """Mantem o estado de todos os aparelhos e decide o que fazer a cada 'tick'.

    Espelhamento e sempre sob demanda: um aparelho detectado so aparece na lista,
    parado, ate o usuario clicar 'Abrir' (start_device). Nunca abre sozinho.
    """

    def __init__(self):
        self.active: dict[str, ActiveDevice] = {}
        self.crash_counts: dict[str, int] = {}
        self.blocked: set[str] = set()  # falhou varias vezes seguidas - so volta ao desplugar/replugar
        self.pending_reconnect: dict[str, dict] = {}  # serial -> tentativas silenciosas em andamento
        self.recording: dict[str, str] = {}  # serial -> caminho do arquivo .mp4 sendo gravado
        self.recording_light: dict[str, bool] = {}  # serial -> gravacao leve (aparelhos antigos)
        self.recording_started_at: dict[str, float] = {}  # serial -> monotonic() de quando comecou
        self.model_cache: dict[str, str] = {}
        self.hw_serial_cache: dict[str, str] = {}  # serial adb -> numero de serie fisico do aparelho
        self.last_ready: set[str] = set()
        self.last_problems: dict[str, str] = {}
        self.used_ports: set[int] = set()
        self.poll_count = 0
        self.screen = get_work_area()
        self.slots = SlotManager(*self.screen)

        self.settings = load_settings()
        self.stay_awake: bool = self.settings["stay_awake"]
        self.wifi_devices: list[str] = list(self.settings["wifi_devices"])
        self.device_overrides: dict[str, dict] = dict(self.settings["device_overrides"])

    def _cache_model(self, serial: str) -> str:
        if serial not in self.model_cache:
            self.model_cache[serial] = get_model(serial, f"Device_{serial[-4:]}")
        return self.model_cache[serial]

    def _hw_serial(self, serial: str) -> str | None:
        """Numero de serie fisico do aparelho - igual em USB ou Wi-Fi, ao contrario do
        serial do adb (que muda pra 'ip:porta' quando e sem fio)."""
        if serial not in self.hw_serial_cache:
            try:
                result = run_adb("-s", serial, "shell", "getprop", "ro.serialno", timeout=5)
                self.hw_serial_cache[serial] = result.stdout.strip() or None
            except subprocess.TimeoutExpired:
                self.hw_serial_cache[serial] = None
        return self.hw_serial_cache[serial]

    def _dedupe_physical_devices(self, ready: set[str]) -> set[str]:
        """O mesmo celular pode aparecer com dois seriais (USB e ip:porta) quando o cabo
        fica conectado apos ativar o Wi-Fi. So deixa passar um - de preferencia o sem fio,
        que e o objetivo de quem ligou o Wi-Fi - e encerra a janela duplicada, se houver."""
        by_hw: dict[str, list[str]] = {}
        for serial in ready:
            key = self._hw_serial(serial) or serial
            by_hw.setdefault(key, []).append(serial)

        result = set()
        for hw, serials in by_hw.items():
            if len(serials) == 1:
                result.add(serials[0])
                continue
            active_ones = [s for s in serials if s in self.active]
            wireless_ones = [s for s in serials if ":" in s]
            chosen = active_ones[0] if active_ones else (wireless_ones[0] if wireless_ones else serials[0])
            result.add(chosen)
            for loser in serials:
                if loser != chosen and loser in self.active:
                    self.stop_device(loser)
        return result

    def resolve_flags(self, serial: str, model: str) -> str:
        """Gravacao leve (aparelho antigo) > ajuste salvo (engrenagem) > perfil padrao > flags genericas."""
        if self.recording.get(serial) and self.recording_light.get(serial):
            return LIGHT_RECORDING_FLAGS
        if serial in self.device_overrides:
            return build_flags(self.device_overrides[serial])
        return PROFILES.get(serial) or PROFILES.get(model) or DEFAULT_FLAGS

    def get_device_settings(self, serial: str) -> dict:
        return dict(self.device_overrides.get(serial, DEFAULT_DEVICE_SETTINGS))

    def set_device_settings(self, serial: str, settings: dict):
        """Chamado pela tela de ajuste (engrenagem) do painel. Persiste em settings.json."""
        self.device_overrides[serial] = settings
        self.settings["device_overrides"] = self.device_overrides
        save_settings(self.settings)

    def add_wifi_device(self, target: str):
        if target not in self.wifi_devices:
            self.wifi_devices.append(target)
            self.settings["wifi_devices"] = self.wifi_devices
            save_settings(self.settings)

    def set_stay_awake(self, value: bool):
        """Botao 'Manter tela do celular ligada'. Vale para os proximos espelhamentos
        lancados - quem ja esta rodando so pega o ajuste se for reiniciado."""
        self.stay_awake = value
        self.settings["stay_awake"] = value
        save_settings(self.settings)

    def start_recording(self, serial: str, light: bool = False) -> str:
        """Botao de gravar. Reinicia o espelhamento desse aparelho incluindo o arquivo.
        Sempre salva em RECORDINGS_DIR (pasta fixa e dedicada) - sem pedir pra
        escolher, pra manter tudo sempre organizado no mesmo lugar.

        light: usa flags leves (bitrate/fps/resolucao reduzidos) para nao travar
        aparelhos antigos enquanto gravam.
        """
        model = self.model_cache.get(serial, serial)
        safe_model = "".join(c if c.isalnum() or c in "-_" else "_" for c in model)

        RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        path = str(RECORDINGS_DIR / f"{safe_model}_{timestamp}.mp4")

        self.recording[serial] = path
        self.recording_light[serial] = light
        self.recording_started_at[serial] = time.monotonic()

        if serial in self.active:
            self.stop_device(serial)
            time.sleep(1)
            self.start_device(serial)
        return path

    def stop_recording(self, serial: str):
        """Desliga a gravacao e reinicia o espelhamento sem gravar mais."""
        self.recording.pop(serial, None)
        self.recording_light.pop(serial, None)
        self.recording_started_at.pop(serial, None)
        if serial in self.active:
            self.stop_device(serial)
            time.sleep(1)
            self.start_device(serial)

    def take_screenshot(self, serial: str) -> str | None:
        """Print rapido via adb - funciona espelhando ou nao, sem mexer no scrcpy."""
        model = self.model_cache.get(serial, serial)
        safe_model = "".join(c if c.isalnum() or c in "-_" else "_" for c in model)
        try:
            SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
        except Exception:
            logging.exception("Nao foi possivel criar a pasta de screenshots")
            return None

        timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        path = SCREENSHOTS_DIR / f"{safe_model}_{timestamp}.png"
        try:
            # exec-out precisa de bytes crus (sem text=True), senao o Windows corrompe o PNG.
            # timeout generoso (18s) porque aparelhos antigos podem demorar pra capturar/enviar.
            result = subprocess.run(
                [str(ADB), "-s", serial, "exec-out", "screencap", "-p"],
                capture_output=True, timeout=18, creationflags=CREATE_NO_WINDOW,
            )
        except (subprocess.TimeoutExpired, OSError):
            logging.exception("Falha ao tirar screenshot de %s", serial)
            return None

        if not result.stdout or not result.stdout.startswith(b"\x89PNG"):
            logging.warning("Screenshot de %s veio vazio ou invalido", serial)
            return None
        try:
            path.write_bytes(result.stdout)
        except OSError:
            logging.exception("Falha ao salvar screenshot em %s", path)
            return None
        return str(path)

    def copy_image_to_clipboard(self, path: str) -> bool:
        """Copia o PNG do print pra area de transferencia do Windows (Win+V mostra ele).
        Trata qualquer falha (arquivo sumiu, aparelho lento que ainda esta escrevendo, etc)
        sem levantar excecao - so devolve True/False."""
        try:
            import win32clipboard
            from PIL import Image
            import io

            p = Path(path)
            if not p.exists() or p.stat().st_size == 0:
                logging.warning("Print nao encontrado (ou vazio) pra copiar: %s", path)
                return False

            img = Image.open(p)
            img.load()  # forca leitura completa agora, com o arquivo ainda garantido no disco
            buf = io.BytesIO()
            img.convert("RGB").save(buf, "BMP")
            dib = buf.getvalue()[14:]  # CF_DIB quer o bitmap sem o cabecalho de arquivo (14 bytes)
            buf.close()

            win32clipboard.OpenClipboard()
            try:
                win32clipboard.EmptyClipboard()
                win32clipboard.SetClipboardData(win32clipboard.CF_DIB, dib)
            finally:
                win32clipboard.CloseClipboard()
            return True
        except Exception:
            logging.exception("Falha ao copiar print para a area de transferencia")
            return False

    def enable_wifi(self, serial: str) -> str | None:
        """Liga o modo Wi-Fi num aparelho conectado por cabo. Devolve 'ip:porta' se der certo."""
        try:
            result = run_adb("-s", serial, "shell", "ip", "route", timeout=6)
        except subprocess.TimeoutExpired:
            return None
        ip = None
        for line in result.stdout.splitlines():
            parts = line.split()
            if "wlan0" in parts and "src" in parts:
                ip = parts[parts.index("src") + 1]
                break
        if not ip:
            return None

        try:
            run_adb("-s", serial, "tcpip", "5555", timeout=8)
            time.sleep(2)
            target = f"{ip}:5555"
            result = run_adb("connect", target, timeout=8)
        except subprocess.TimeoutExpired:
            return None

        if "unable" in result.stdout.lower() or "failed" in result.stdout.lower():
            return None

        self.add_wifi_device(target)

        # o mesmo aparelho passa a existir com dois seriais (USB e ip:porta) se o cabo
        # continuar plugado - carrega o nome/ajustes pro novo serial e fecha a janela
        # USB antiga, senao a mesma tela fica espelhada duas vezes.
        if serial in self.model_cache:
            self.model_cache[target] = self.model_cache[serial]
        if serial in self.device_overrides:
            self.device_overrides[target] = self.device_overrides[serial]
            self.settings["device_overrides"] = self.device_overrides
            save_settings(self.settings)
        self.stop_device(serial)

        return target

    def start_device(self, serial: str) -> bool:
        """Lanca manualmente o espelhamento de um aparelho ja detectado (botao 'Iniciar')."""
        if serial in self.active:
            return True
        fallback = self.model_cache.get(serial, f"Device_{serial[-4:]}")
        if AUTO_ARRANGE_WINDOWS:
            self.slots.ensure_capacity(len(self.active) + 1)
        flags = self.resolve_flags(serial, fallback)
        new_dev = launch_device(serial, fallback, self.slots, self.used_ports, flags,
                                 self.stay_awake, self.recording.get(serial))
        if new_dev:
            self.active[serial] = new_dev
            self.model_cache[serial] = new_dev.model
            self.blocked.discard(serial)
            self.crash_counts.pop(serial, None)
            return True
        return False

    def stop_device(self, serial: str) -> bool:
        """Encerra manualmente o espelhamento de um aparelho (botao 'Parar')."""
        dev = self.active.pop(serial, None)
        if not dev:
            return False
        self.slots.release(dev.slot)
        self.used_ports.discard(dev.port)
        graceful_stop(dev.proc)
        dev.log_fh.close()
        self.blocked.discard(serial)
        self.crash_counts.pop(serial, None)
        return True

    def tick(self) -> list[dict]:
        """Uma rodada de verificacao. Devolve a lista de eventos ocorridos nesta rodada."""
        events = []
        self.poll_count += 1
        try:
            states = list_devices()
        except subprocess.TimeoutExpired:
            logging.warning("Timeout em 'adb devices', pulando este ciclo")
            return [{"type": "timeout"}]

        ready = {s for s, st in states.items() if st == "device"}
        problems = {s: st for s, st in states.items() if st != "device"}

        for serial in ready:
            self._cache_model(serial)

        ready = self._dedupe_physical_devices(ready)

        for serial, st in problems.items():
            if self.last_problems.get(serial) != st:
                events.append({"type": "problem", "serial": serial, "state": st, "hint": problem_hint(st)})
                logging.info("Estado de atencao: %s -> %s", serial, st)
        self.last_ready, self.last_problems = ready, problems

        # --- partidas: desplugado ou processo caiu sozinho ---
        for serial in list(self.active.keys()):
            dev = self.active[serial]
            unplugged = serial not in ready
            crashed = (not unplugged) and dev.proc.poll() is not None
            if not (unplugged or crashed):
                continue

            self.slots.release(dev.slot)
            self.used_ports.discard(dev.port)
            dev.log_fh.close()
            del self.active[serial]

            if unplugged:
                logging.info("Desconectado: %s (%s)", dev.model, serial)
                self.crash_counts.pop(serial, None)
                self.blocked.discard(serial)
            else:
                logging.warning("scrcpy caiu: %s (%s) codigo=%s", dev.model, serial, dev.proc.poll())

            # nao avisa na hora - guarda pra tentar reconectar sozinho, em silencio,
            # algumas vezes primeiro (ver bloco logo abaixo). Cabo com mau contato
            # nao deveria assustar o usuario com um pop-up a cada oscilacao.
            self.pending_reconnect[serial] = {
                "attempts": 0, "next_attempt_at": time.monotonic(),
                "model": dev.model, "kind": "departed" if unplugged else "crashed",
                # sessao que rodou de boa por um tempo antes de cair conta menos
                # contra o aparelho do que uma que morre logo de cara toda vez
                "long_uptime": (time.monotonic() - dev.started_at) > 10,
            }

        # --- tentativas silenciosas de reconexao, antes de avisar o usuario ---
        for serial, entry in list(self.pending_reconnect.items()):
            if serial in self.active:  # reconectou por outro caminho (ex: clique manual)
                self.pending_reconnect.pop(serial, None)
                continue
            if time.monotonic() < entry["next_attempt_at"]:
                continue

            if serial in ready and self.start_device(serial):
                logging.info("Reconectado sozinho: %s (%s)", entry["model"], serial)
                events.append({"type": "reconnected", "serial": serial, "model": entry["model"]})
                self.pending_reconnect.pop(serial)
                continue

            entry["attempts"] += 1
            if entry["attempts"] < SILENT_RECONNECT_ATTEMPTS:
                entry["next_attempt_at"] = time.monotonic() + SILENT_RECONNECT_INTERVAL
                continue

            # esgotou as tentativas silenciosas - agora sim avisa o usuario
            self.pending_reconnect.pop(serial)
            if entry["kind"] == "crashed":
                if entry["long_uptime"]:
                    self.crash_counts[serial] = 0
                self.crash_counts[serial] = self.crash_counts.get(serial, 0) + 1
                events.append({"type": "crashed", "serial": serial, "model": entry["model"],
                                "attempt": self.crash_counts[serial]})
                if self.crash_counts[serial] >= MAX_CRASH_RETRIES:
                    self.blocked.add(serial)
                    events.append({"type": "blocked", "serial": serial, "model": entry["model"]})
            else:
                events.append({"type": "departed", "serial": serial, "model": entry["model"]})

        # --- reconexao periodica dos dispositivos Wi-Fi salvos (ativados pelo painel) ---
        if self.wifi_devices and self.poll_count % WIFI_RETRY_EVERY == 0:
            for target in self.wifi_devices:
                if target not in ready:
                    try:
                        run_adb("connect", target, timeout=6)
                    except subprocess.TimeoutExpired:
                        pass

        return events

    def has_pending_reconnects(self) -> bool:
        """Usado pelo painel pra saber se deve verificar de novo mais rapido (perto
        do intervalo entre as tentativas silenciosas) em vez de esperar o ciclo
        normal inteiro - senao a reconexao "a cada 2s" na pratica vira bem mais
        lenta, no ritmo do POLL_INTERVAL_SECONDS."""
        return bool(self.pending_reconnect)

    def snapshot(self) -> dict[str, dict]:
        """Estado atual de todo aparelho conhecido nesta rodada, pra desenhar a UI."""
        rows = {}
        all_serials = self.last_ready | set(self.last_problems) | set(self.active)
        for serial in all_serials:
            if serial in self.active:
                status = "mirroring"
            elif serial in self.blocked:
                status = "blocked"
            elif serial in self.last_problems:
                status = "problem"
            else:
                status = "ready"
            rows[serial] = {
                "model": self.model_cache.get(serial, serial),
                "status": status,
                "hint": problem_hint(self.last_problems[serial]) if serial in self.last_problems else None,
                "port": self.active[serial].port if serial in self.active else None,
                "recording": serial in self.recording,
                "recording_seconds": (time.monotonic() - self.recording_started_at[serial])
                                      if serial in self.recording_started_at else None,
            }
        return rows

    def shutdown(self):
        """Fecha o painel E encerra tudo que ele abriu ou deixou rodando em segundo
        plano - scrcpy (dando chance de qualquer gravacao em andamento terminar o
        arquivo direito) e o servidor do adb.

        O servidor do adb roda como um processo PROPRIO, independente do processo
        que o iniciou (e ate sobrevive a ele, se so matarmos o processo em vez de
        pedir pra ele encerrar via protocolo) - se ele continuar de pe depois que o
        painel fechar, ele mantem um lock nos arquivos da pasta de instalacao, e o
        usuario nem consegue apagar/mover essa pasta ("arquivo em uso"). "adb
        kill-server" e a forma correta de parar esse processo (pede pra ele mesmo
        se desligar, em vez de so matar um PID que pode nem ser o processo certo).
        """
        for dev in self.active.values():
            graceful_stop(dev.proc)
            try:
                dev.log_fh.close()
            except Exception:
                pass
        self.active.clear()

        # varredura final - garante que nenhum scrcpy orfao sobreviva ao fechamento
        # (ex: um processo que nao respondeu a tempo ao WM_CLOSE nem ao terminate)
        try:
            kill_existing_scrcpy()
        except Exception:
            logging.exception("Falha ao varrer processos scrcpy orfaos no fechamento")

        try:
            run_adb("kill-server", timeout=10)
        except Exception:
            logging.exception("Falha ao encerrar o servidor adb no fechamento")

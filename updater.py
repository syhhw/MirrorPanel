"""Auto-update do MirrorPanel via GitHub Releases.

Filosofia: invisivel ate ser necessario. Qualquer falha de rede (sem internet,
rate limit da API, timeout, repositorio sem releases ainda) e engolida e vira
None/False - nunca deve incomodar ou travar o uso normal do programa.
"""
import logging
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

import requests

APP_VERSION = "1.0.0-3"  # mantenha igual ao MyAppVersion do installer.iss ao lancar uma nova versao
GITHUB_REPO = "syhhw/MirrorPanel"
API_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
REQUEST_HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "MirrorPanel-updater"}


def _parse_version(tag: str) -> tuple:
    """'v1.2.3' -> (1, 2, 3), pra comparar numericamente (nao como texto)."""
    numbers = re.findall(r"\d+", tag or "")
    return tuple(int(n) for n in numbers) if numbers else (0,)


def check_for_update_detailed(timeout: float = 6.0) -> dict:
    """Consulta o GitHub Releases e SEMPRE devolve um status, mesmo quando nao ha
    atualizacao ou a consulta falha - usado tanto na checagem automatica (pra
    logar 'esta atualizado') quanto no botao manual (que precisa avisar o
    usuario em qualquer um dos casos, nao so quando ha novidade).

    Devolve {"status": "update"|"current"|"error", "info": dict|None}.
    """
    try:
        resp = requests.get(API_URL, timeout=timeout, headers=REQUEST_HEADERS)
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        logging.info("Verificacao de atualizacao falhou (sem internet, rate limit ou sem releases ainda)")
        return {"status": "error", "info": None}

    tag = data.get("tag_name") or ""
    if not tag:
        return {"status": "error", "info": None}
    if _parse_version(tag) <= _parse_version(APP_VERSION):
        return {"status": "current", "info": None}

    asset_url = asset_name = None
    for asset in data.get("assets", []):
        name = asset.get("name", "")
        if name.lower().endswith(".exe"):
            asset_url = asset.get("browser_download_url")
            asset_name = name
            break
    if not asset_url:
        return {"status": "error", "info": None}

    info = {"version": tag, "notes": (data.get("body") or "").strip(), "url": asset_url, "asset_name": asset_name}
    return {"status": "update", "info": info}


def check_for_update(timeout: float = 6.0) -> dict | None:
    """Atalho: devolve so a info da atualizacao (ou None se nao ha ou a consulta falhou)."""
    result = check_for_update_detailed(timeout)
    return result["info"] if result["status"] == "update" else None


def get_download_path(asset_name: str) -> str:
    return str(Path(tempfile.gettempdir()) / asset_name)


def download_update(url: str, dest_path: str, on_progress=None, chunk_size: int = 65536,
                     timeout: float = 20.0) -> bool:
    """Baixa em pedacos (nao trava a UI, chamar de uma thread separada).
    on_progress(baixado, total) e chamado a cada pedaco - total pode ser 0 se
    o servidor nao informar o tamanho."""
    try:
        with requests.get(url, stream=True, timeout=timeout) as resp:
            resp.raise_for_status()
            total = int(resp.headers.get("content-length", 0))
            downloaded = 0
            with open(dest_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=chunk_size):
                    if not chunk:
                        continue
                    f.write(chunk)
                    downloaded += len(chunk)
                    if on_progress:
                        on_progress(downloaded, total)
        return True
    except Exception:
        logging.exception("Falha ao baixar atualizacao")
        try:
            Path(dest_path).unlink(missing_ok=True)
        except Exception:
            pass
        return False


def apply_update_and_restart(installer_path: str) -> str | None:
    """Roda o novo instalador e encerra o processo atual, liberando os arquivos
    a tempo do instalador substituir sem erro de "arquivo em uso".

    Devolve uma mensagem de erro (SEM encerrar o processo) se algo falhar de
    forma detectavel na hora - assim o programa avisa o usuario em vez de so
    sumir e deixar ele preso pedindo a mesma atualizacao pra sempre. Se tudo
    correr bem, esta funcao nunca retorna (o processo e encerrado).

    /CURRENTUSER forca a instalacao sem pedir elevacao (UAC) - a instalacao
    original ja e por usuario, sem admin; sem isso, o instalador as vezes fica
    esperando um clique de "Sim" na elevacao que ninguem ve, porque o programa
    ja fechou sozinho logo em seguida.

    /CLOSEAPPLICATIONS e /RESTARTAPPLICATIONS sao uma rede de seguranca do
    proprio Inno Setup: se o nosso processo demorar um instante pra sumir de
    verdade, o instalador detecta e fecha via Restart Manager do Windows, e
    reabre o MirrorPanel (ja atualizado) no final sozinho.
    """
    p = Path(installer_path)
    if not p.exists() or p.stat().st_size < 1_000_000:  # instalador real tem varios MB
        return f"Arquivo do instalador nao encontrado ou incompleto: {installer_path}"

    args = [installer_path, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER",
            "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS"]
    try:
        proc = subprocess.Popen(args, close_fds=True, cwd=str(p.parent))
    except OSError as exc:
        logging.exception("Falha ao iniciar o instalador da atualizacao")
        return f"Nao foi possivel iniciar o instalador: {exc}"

    time.sleep(1.5)  # da tempo de pegar uma falha IMEDIATA (instalador corrompido, etc)
    if proc.poll() is not None and proc.returncode != 0:
        return f"O instalador encerrou sozinho com erro (codigo {proc.returncode})."

    os._exit(0)  # sai AGORA - nao deixa nada (atexit, cleanup) atrasar a liberacao dos arquivos
    return None  # nunca chega aqui

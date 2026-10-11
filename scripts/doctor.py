#!/usr/bin/env python3
# scripts/doctor.py — diagnóstico do TYPER Magic no macOS.
# Valida: versões, build, variáveis do .env, token do Telegram, API do modelo, navegador,
# pyobjc e permissões TCC (Screen Recording / Accessibility). Sai com 1 se algo obrigatório falhar.
# Rode com o python do venv:  .venv/bin/python scripts/doctor.py   (ou: pnpm doctor)
# NUNCA imprime segredos — só presença/validade.
from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ERRORS: list[str] = []
WARNS: list[str] = []


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def warn(msg: str) -> None:
    WARNS.append(msg)
    print(f"  ⚠ {msg}")


def err(msg: str) -> None:
    ERRORS.append(msg)
    print(f"  ✗ {msg}")


def load_env() -> dict[str, str]:
    """Lê .env (chave=valor, # comentário) sem sobrescrever o ambiente já definido."""
    env: dict[str, str] = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    for k, v in os.environ.items():
        if k.startswith("TYPER_") or k == "EXA_API_KEY":
            env[k] = v
    return env


def run(cmd: list[str]) -> str | None:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return None


def http_json(url: str, headers: dict[str, str] | None = None, timeout: int = 15) -> tuple[int, dict]:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode() or "{}")
        except Exception:
            body = {}
        return e.code, body
    except Exception as e:  # rede
        return 0, {"error": str(e)}


def section(title: str) -> None:
    print(f"\n{title}")


def check_versions() -> None:
    section("1. Versões")
    if platform.system() != "Darwin":
        err(f"sistema não é macOS ({platform.system()})")
    else:
        ok(f"macOS {platform.mac_ver()[0]} {platform.machine()}")
    node = run(["node", "--version"])
    if not node:
        err("node não encontrado (brew install node)")
    else:
        major = int(node.lstrip("v").split(".")[0])
        (ok if major >= 20 else err)(f"node {node} (exige >=20)")
    pnpm = run(["pnpm", "--version"])
    (ok if pnpm else err)(f"pnpm {pnpm}" if pnpm else "pnpm não encontrado (brew install pnpm)")
    py = sys.version.split()[0]
    (ok if sys.version_info >= (3, 11) else err)(f"python {py} ({sys.executable})")
    rg = shutil.which("rg")
    (ok if rg else warn)("ripgrep (rg) presente" if rg else "ripgrep ausente — contexto de código sem trechos (brew install ripgrep)")
    (ok if shutil.which("ffmpeg") else warn)("ffmpeg presente" if shutil.which("ffmpeg") else "ffmpeg ausente — só afeta voz (opcional): brew install ffmpeg")


def check_build() -> None:
    section("2. Build")
    main = ROOT / "app" / "agent-cli" / "dist" / "main.js"
    (ok if main.exists() else err)(f"{main.relative_to(ROOT)} {'existe' if main.exists() else 'ausente — rode: pnpm -r build'}")
    pw = ROOT / "node_modules" / "playwright"
    (ok if pw.exists() else err)("playwright instalado" if pw.exists() else "playwright ausente — rode: pnpm install")


def check_env(env: dict[str, str]) -> None:
    section("3. Variáveis (.env)")
    if not (ROOT / ".env").exists():
        err(".env não existe — copie .env.example para .env e preencha")
    required = ["TYPER_TELEGRAM_TOKEN", "TYPER_TELEGRAM_ALLOW", "TYPER_ANTHROPIC_KEY"]
    for k in required:
        v = env.get(k, "")
        if k == "TYPER_ANTHROPIC_KEY" and not v:
            # alternativa: login OAuth em ~/.typer/auth.json ou chave OpenAI
            auth = Path.home() / ".typer" / "auth.json"
            if auth.exists() or env.get("TYPER_OPENAI_KEY"):
                ok("TYPER_ANTHROPIC_KEY vazio, mas há login OAuth/OpenAI alternativo")
                continue
        (ok if v else err)(f"{k} {'definido' if v else 'VAZIO'}")
    allow = [s.strip() for s in env.get("TYPER_TELEGRAM_ALLOW", "").split(",") if s.strip()]
    if allow and not all(a.lstrip("-").isdigit() for a in allow):
        err("TYPER_TELEGRAM_ALLOW deve conter só ids numéricos")
    for k in ["TYPER_MAX_PER_TX", "TYPER_MAX_PER_DAY"]:
        v = env.get(k, "0")
        if not v.isdigit():
            err(f"{k} deve ser inteiro (BRL)")
    if env.get("TYPER_MAX_PER_TX", "0") == "0":
        ok("pagamentos BLOQUEADOS (TYPER_MAX_PER_TX=0) — suba o teto quando quiser permitir")
    if not env.get("TYPER_CHECKOUT_ALLOW_HOSTS"):
        ok("checkout sem hosts permitidos — pagamento bloqueado em todo site")


def check_telegram(env: dict[str, str]) -> None:
    section("4. Telegram")
    tok = env.get("TYPER_TELEGRAM_TOKEN", "")
    if not tok:
        err("sem token — pulado")
        return
    status, body = http_json(f"https://api.telegram.org/bot{tok}/getMe")
    if status == 200 and body.get("ok"):
        ok(f"token válido — bot @{body['result'].get('username')}")
    elif status == 401:
        err("token INVÁLIDO (401) — gere outro no @BotFather")
    else:
        err(f"falha ao falar com api.telegram.org (HTTP {status})")


def check_model(env: dict[str, str]) -> None:
    section("5. API do modelo")
    key = env.get("TYPER_ANTHROPIC_KEY", "")
    if key:
        status, body = http_json(
            "https://api.anthropic.com/v1/models?limit=5",
            {"x-api-key": key, "anthropic-version": "2023-06-01"},
        )
        if status == 200:
            ids = [m.get("id") for m in body.get("data", [])][:3]
            ok(f"Anthropic OK — modelos visíveis: {', '.join(ids)}")
        elif status == 401:
            err("Anthropic: chave inválida (401)")
        else:
            err(f"Anthropic: HTTP {status} {body.get('error', '')}".strip())
    okey = env.get("TYPER_OPENAI_KEY", "")
    if okey:
        status, _ = http_json("https://api.openai.com/v1/models", {"Authorization": f"Bearer {okey}"})
        (ok if status == 200 else err)(f"OpenAI {'OK' if status == 200 else f'HTTP {status}'}")
    if not key and not okey:
        auth = Path.home() / ".typer" / "auth.json"
        (ok if auth.exists() else err)("login OAuth presente em ~/.typer/auth.json" if auth.exists() else "nenhuma credencial de modelo")


def check_browser(env: dict[str, str]) -> None:
    section("6. Navegador")
    path = env.get("TYPER_BROWSER_PATH") or "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
    if Path(path).exists():
        ok(f"binário: {path}")
    else:
        alt = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        (ok if Path(alt).exists() else err)(f"binário: {alt}" if Path(alt).exists() else f"navegador não encontrado em {path}")
    prof = os.path.expanduser(env.get("TYPER_BROWSER_PROFILE", "~/.typer/browser/cdp-profile"))
    personal = os.path.expanduser("~/Library/Application Support/BraveSoftware/Brave-Browser")
    if prof.startswith(personal) or prof.endswith("Google/Chrome"):
        err("TYPER_BROWSER_PROFILE aponta para o seu perfil PESSOAL — use um perfil dedicado")
    else:
        ok(f"perfil dedicado: {prof}")


def check_macos_permissions() -> None:
    section("7. macOS — pyobjc e permissões (TCC)")
    try:
        import Quartz  # type: ignore
        from ApplicationServices import AXIsProcessTrusted  # type: ignore
    except Exception as e:
        err(f"pyobjc não importa ({e}) — rode: uv pip install --python .venv/bin/python pyobjc-framework-Quartz pyobjc-framework-ApplicationServices pyobjc-framework-Cocoa pyobjc-framework-ScreenCaptureKit")
        return
    ok("pyobjc Quartz/ApplicationServices importam")
    real_py = Path(sys.executable).resolve()
    screen = bool(Quartz.CGPreflightScreenCaptureAccess())
    ax = bool(AXIsProcessTrusted())
    # Nota: o TCC atribui a permissão ao PROCESSO RESPONSÁVEL. No terminal, é o app do terminal
    # (Terminal/iTerm/Claude). No LaunchAgent, é o próprio binário do python do venv (abaixo).
    (ok if screen else err)(
        "Screen Recording concedido a este processo" if screen else
        "Screen Recording NÃO concedido → Ajustes do Sistema › Privacidade e Segurança › Gravação de Tela e Áudio do Sistema › (+) e adicione:\n"
        f"      {real_py}\n      (e o app do terminal, se for testar daqui). Depois reinicie o serviço."
    )
    (ok if ax else err)(
        "Accessibility concedido a este processo" if ax else
        "Accessibility NÃO concedido → Ajustes do Sistema › Privacidade e Segurança › Acessibilidade › (+) e adicione:\n"
        f"      {real_py}\n      (e o app do terminal, se for testar daqui)."
    )
    try:
        main_id = Quartz.CGMainDisplayID()
        w, h = Quartz.CGDisplayPixelsWide(main_id), Quartz.CGDisplayPixelsHigh(main_id)
        mode = Quartz.CGDisplayCopyDisplayMode(main_id)
        pw = Quartz.CGDisplayModeGetPixelWidth(mode)
        scale = pw / w if w else 1
        n = Quartz.CGGetActiveDisplayList(8, None, None)[1]
        ok(f"display principal {w}x{h} pt, escala {scale:.0f}x, {len(n)} display(s) ativo(s)")
    except Exception as e:
        warn(f"não li a geometria do display: {e}")


def main() -> int:
    print("TYPER Magic — doctor (macOS)")
    env = load_env()
    check_versions()
    check_build()
    check_env(env)
    check_telegram(env)
    check_model(env)
    check_browser(env)
    check_macos_permissions()
    print()
    if ERRORS:
        print(f"✗ {len(ERRORS)} erro(s), {len(WARNS)} aviso(s). Corrija os itens com ✗ acima.")
        return 1
    print(f"✓ tudo certo ({len(WARNS)} aviso(s) opcionais).")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Configuração e utilitários compartilhados pelo pipeline."""
from __future__ import annotations

import time
from pathlib import Path

import requests

ANOS = [2014, 2018, 2022]
UF = "SC"
CARGOS = {6: "DEPUTADO FEDERAL", 7: "DEPUTADO ESTADUAL"}

ROOT = Path(__file__).resolve().parent
RAW = ROOT / "raw"
OUT_JSON = ROOT.parent / "site" / "data" / "candidatos.json"
REPORT = ROOT / "relatorio_validacao.md"

CDN = "https://cdn.tse.jus.br/estatistica/sead/odsele"

# Prestação de contas: o nome do arquivo de 2014 é diferente dos demais anos.
CONTAS_2014 = [
    f"{CDN}/prestacao_contas/prestacao_final_2014.zip",
    f"{CDN}/prestacao_contas/prestacao_contas_final_2014.zip",
    f"{CDN}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_2014.zip",
]


def tse_urls(ano: int) -> dict[str, str]:
    urls = {
        "candidatos": f"{CDN}/consulta_cand/consulta_cand_{ano}.zip",
        "votacao": f"{CDN}/votacao_candidato_munzona/votacao_candidato_munzona_{ano}.zip",
    }
    if ano == 2014:
        for i, u in enumerate(CONTAS_2014):
            urls[f"contas{i}"] = u
    else:
        urls["contas"] = f"{CDN}/prestacao_contas/prestacao_de_contas_eleitorais_candidatos_{ano}.zip"
    return urls


HEADERS = {"User-Agent": "custo-por-voto-sc/1.0 (+https://github.com)"}


def download(url: str, dest_dir: Path, retries: int = 4) -> Path:
    """Baixa `url` para `dest_dir` (com cache: não baixa de novo se já existir)."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / url.rsplit("/", 1)[-1]
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            with requests.get(url, stream=True, timeout=120, headers=HEADERS) as r:
                r.raise_for_status()
                with open(tmp, "wb") as fh:
                    for chunk in r.iter_content(chunk_size=1 << 20):
                        fh.write(chunk)
            tmp.rename(dest)
            print(f"baixado {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)", flush=True)
            return dest
        except Exception as exc:  # noqa: BLE001
            print(f"falha ao baixar {url} (tentativa {attempt}): {exc}", flush=True)
            time.sleep(5 * attempt)
    raise RuntimeError(f"não foi possível baixar {url}")


def exists(url: str) -> bool:
    try:
        r = requests.head(url, timeout=60, allow_redirects=True, headers=HEADERS)
        return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False

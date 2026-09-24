"""IPCA mensal (Banco Central, SGS 433) e fatores de correção por ano de eleição.

Fator do ano A = produto de (1 + IPCA_m/100) de novembro de A até o último mês
disponível. Ou seja, leva valores de outubro de A (mês da eleição) para o mês mais recente.
Se a API do BCB falhar, usa a mesma série publicada pelo IBGE (SIDRA, tabela 1737, v63);
se as duas falharem, usa a cópia versionada em dados/ipca_433.json.
"""
from __future__ import annotations

import json
from datetime import date

import requests

from common import HEADERS, ROOT

BCB_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados?formato=json&dataInicial=01/01/2014"
SIDRA_URL = "https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/63/p/all?formato=json"


def _bcb() -> dict[str, float]:
    r = requests.get(BCB_URL, timeout=60, headers=HEADERS)
    r.raise_for_status()
    out = {}
    for item in r.json():
        d, m, y = item["data"].split("/")
        out[f"{y}-{m}"] = float(item["valor"])
    return out


def _sidra() -> dict[str, float]:
    r = requests.get(SIDRA_URL, timeout=60, headers=HEADERS)
    r.raise_for_status()
    out = {}
    for item in r.json()[1:]:
        per = item["D3C"]  # AAAAMM
        if int(per[:4]) >= 2014 and item["V"] not in ("...", "-", ""):
            out[f"{per[:4]}-{per[4:]}"] = float(item["V"])
    return out


SNAPSHOT = ROOT / "dados" / "ipca_433.json"


def serie_ipca() -> tuple[dict[str, float], str, str]:
    """Retorna (série mensal, URL da fonte, data da consulta)."""
    for nome, fn, url in (("BCB", _bcb, BCB_URL), ("SIDRA", _sidra, SIDRA_URL)):
        try:
            s = dict(sorted(fn().items()))
            hoje = date.today().isoformat()
            SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
            SNAPSHOT.write_text(json.dumps({"fonte": url, "baixado_em": hoje, "serie": s}, indent=1))
            return s, url, hoje
        except Exception as exc:  # noqa: BLE001
            print(f"{nome} falhou ({exc})", flush=True)
    snap = json.loads(SNAPSHOT.read_text())
    print(f"usando cópia local do IPCA baixada em {snap['baixado_em']}", flush=True)
    return dict(sorted(snap["serie"].items())), snap["fonte"], snap["baixado_em"]


def fatores_ipca(anos: list[int]) -> tuple[dict[str, float], dict]:
    serie, url, baixado = serie_ipca()
    ultimo = max(serie)
    fatores = {}
    for ano in anos:
        f = 1.0
        for mes, v in serie.items():
            if mes >= f"{ano}-11":
                f *= 1 + v / 100
        fatores[str(ano)] = round(f, 6)
    print(f"IPCA até {ultimo}: {fatores}", flush=True)
    return fatores, {"ate": ultimo, "url": url, "baixado_em": baixado}

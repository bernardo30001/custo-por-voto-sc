"""Inspeciona os arquivos do TSE antes do parser: URLs, membros dos zips e colunas.

Uso: python inspect_layouts.py [--download]
Imprime, para cada ano, os recursos do portal CKAN do TSE e o cabeçalho + 3 linhas
dos arquivos de SC dentro de cada zip.
"""
from __future__ import annotations

import io
import sys
import zipfile

import requests

from common import ANOS, RAW, download, tse_urls

CKAN = "https://dadosabertos.tse.jus.br/api/3/action"


def ckan_resources(ano: int) -> None:
    for q in (f"candidatos {ano}", f"resultados {ano}", f"prestacao de contas {ano}"):
        try:
            r = requests.get(f"{CKAN}/package_search", params={"q": q, "rows": 5}, timeout=60)
            r.raise_for_status()
            for pkg in r.json()["result"]["results"]:
                print(f"  [ckan] {pkg['name']}")
                for res in pkg.get("resources", []):
                    url = res.get("url", "")
                    if url.endswith(".zip"):
                        print(f"      {url}")
        except Exception as exc:  # noqa: BLE001
            print(f"  [ckan] falhou ({q}): {exc}")


def show_zip(path) -> None:
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        print(f"  {path.name}: {len(names)} membros")
        for n in names[:60]:
            print(f"      {n}  ({z.getinfo(n).file_size:,} bytes)")
        sc = [n for n in names if "_SC." in n.upper() or n.upper().endswith("SC.TXT") or n.upper().endswith("SC.CSV")]
        if not sc:
            sc = [n for n in names if n.lower().endswith((".csv", ".txt"))][:2]
        for n in sc:
            with z.open(n) as fh:
                head = io.TextIOWrapper(fh, encoding="latin-1", errors="replace")
                print(f"  --- {n}")
                for i, line in enumerate(head):
                    print("     ", line.rstrip()[:1500])
                    if i >= 3:
                        break


def main() -> None:
    do_download = "--download" in sys.argv
    for ano in ANOS:
        print(f"\n===== {ano} =====")
        ckan_resources(ano)
        for kind, url in tse_urls(ano).items():
            try:
                h = requests.head(url, timeout=60, allow_redirects=True)
                print(f"  [{kind}] {url} -> {h.status_code} {h.headers.get('Content-Length')}")
            except Exception as exc:  # noqa: BLE001
                print(f"  [{kind}] {url} -> ERRO {exc}")
                continue
            if do_download and h.status_code == 200:
                show_zip(download(url, RAW))


if __name__ == "__main__":
    main()

"""Pipeline do Custo por Voto SC.

Baixa do TSE (candidatos, votação por município/zona e prestação de contas) e do
Banco Central (IPCA, SGS 433), filtra Santa Catarina, cargos 6 e 7, 1º turno,
cruza tudo por SQ_CANDIDATO e gera:

  - ../site/data/candidatos.json   (dados do site)
  - relatorio_validacao.md          (contagens por ano/cargo e checagens)

Uso: python build.py
"""
from __future__ import annotations

import io
import json
import re
import unicodedata
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd

from common import ANOS, CARGOS, CONTAS_2014, OUT_JSON, RAW, REPORT, UF, download, exists, tse_urls
from ipca import fatores_ipca

# ----------------------------------------------------------------------------
# Leitura
# ----------------------------------------------------------------------------


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z0-9]+", "_", s.upper()).strip("_")


def read_member(z: zipfile.ZipFile, pattern: str) -> pd.DataFrame:
    """Lê o(s) membro(s) do zip cujo nome casa com `pattern` (regex, case-insensitive)."""
    rx = re.compile(pattern, re.I)
    names = [n for n in z.namelist() if rx.search(n)]
    if not names:
        raise FileNotFoundError(f"nenhum membro casa com {pattern!r}: {z.namelist()[:20]}")
    frames = []
    for n in names:
        raw = z.read(n)
        df = pd.read_csv(
            io.BytesIO(raw),
            sep=";",
            encoding="latin-1",
            dtype=str,
            keep_default_na=False,
            quotechar='"',
            on_bad_lines="warn",
            low_memory=False,
        )
        df.columns = [_norm(c) for c in df.columns]
        df["__arquivo"] = n
        frames.append(df)
    return pd.concat(frames, ignore_index=True)


def num(series: pd.Series) -> pd.Series:
    """Converte '1.234,56' / '1234.56' / '#NULO#' em float."""
    s = series.astype(str).str.strip()
    s = s.where(~s.isin(["", "#NULO#", "#NULO", "NULO", "#NE#", "-1"]), "0")
    has_comma = s.str.contains(",", regex=False)
    s = s.where(~has_comma, s.str.replace(".", "", regex=False).str.replace(",", ".", regex=False))
    return pd.to_numeric(s, errors="coerce").fillna(0.0)


def pick(df: pd.DataFrame, *cands: str) -> str:
    for c in cands:
        if c in df.columns:
            return c
    raise KeyError(f"nenhuma das colunas {cands} em {list(df.columns)[:60]}")


def pick_opt(df: pd.DataFrame, *cands: str) -> str | None:
    for c in cands:
        if c in df.columns:
            return c
    return None


# ----------------------------------------------------------------------------
# Candidatos
# ----------------------------------------------------------------------------


def situacao(ds: str) -> str:
    d = _norm(ds)
    if d.startswith("ELEITO"):
        return "eleito"
    if d == "SUPLENTE":
        return "suplente"
    if d in ("NAO_ELEITO",):
        return "nao_eleito"
    return "outro"


def load_candidatos(ano: int) -> pd.DataFrame:
    z = zipfile.ZipFile(download(tse_urls(ano)["candidatos"], RAW))
    df = read_member(z, rf"_{UF}\.(csv|txt)$")
    df = df[(df["SG_UF"] == UF) & (df["CD_CARGO"].isin(["6", "7"])) & (df["NR_TURNO"] == "1")].copy()
    df["CD_CARGO"] = df["CD_CARGO"].astype(int)
    sit_col = pick(df, "DS_SIT_TOT_TURNO")
    cand_col = pick_opt(df, "DS_SITUACAO_CANDIDATURA", "DS_DETALHE_SITUACAO_CAND", "DS_SITUACAO_CANDIDATO")
    det_col = pick_opt(df, "DS_DETALHE_SITUACAO_CAND")
    out = pd.DataFrame(
        {
            "ano": ano,
            "cargo": df["CD_CARGO"],
            "sq": df["SQ_CANDIDATO"].str.strip(),
            "nome": df["NM_CANDIDATO"].str.strip(),
            "urna": df["NM_URNA_CANDIDATO"].str.strip(),
            "numero": df["NR_CANDIDATO"].str.strip(),
            "partido": df["SG_PARTIDO"].str.strip(),
            "sit_tse": df[sit_col].str.strip(),
            "sit_cand": df[cand_col].str.strip() if cand_col else "",
            "det_cand": df[det_col].str.strip() if det_col else "",
        }
    )
    out = out.drop_duplicates("sq", keep="last")
    out["situacao"] = out["sit_tse"].map(situacao)
    return out


# ----------------------------------------------------------------------------
# Votação
# ----------------------------------------------------------------------------


def load_votacao(ano: int) -> pd.DataFrame:
    z = zipfile.ZipFile(download(tse_urls(ano)["votacao"], RAW))
    df = read_member(z, rf"_{UF}\.(csv|txt)$")
    df = df[(df["SG_UF"] == UF) & (df["CD_CARGO"].isin(["6", "7"])) & (df["NR_TURNO"] == "1")].copy()
    df["votos"] = num(df["QT_VOTOS_NOMINAIS"])
    valid_col = pick_opt(df, "QT_VOTOS_NOMINAIS_VALIDOS")
    df["validos"] = num(df[valid_col]) if valid_col else df["votos"]
    dest_col = pick_opt(df, "NM_TIPO_DESTINACAO_VOTOS", "DS_TIPO_DESTINACAO_VOTOS")
    df["anulado"] = df[dest_col].str.upper().str.contains("ANULAD") if dest_col else False
    g = df.groupby("SQ_CANDIDATO").agg(votos=("votos", "sum"), validos=("validos", "sum"), anulado=("anulado", "max"))
    g.index = g.index.str.strip()
    return g


# ----------------------------------------------------------------------------
# Prestação de contas
# ----------------------------------------------------------------------------

# Despesas que são repasses (doações/transferências) a outros candidatos ou partidos.
RX_REPASSE = re.compile(
    r"(DOAC(AO|OES)|TRANSFER).*(CANDIDAT|PARTID|COMITE|COMIT)|"
    r"(CANDIDAT|PARTID|COMITE).*(DOAC|TRANSFER)",
)


def is_repasse(texto: pd.Series) -> pd.Series:
    return texto.map(lambda t: bool(RX_REPASSE.search(_norm(t))))


def classifica_origem(fonte: str, origem: str) -> str:
    f = _norm(fonte)
    o = _norm(origem)
    if "FUNDO_ESPECIAL" in f or "FEFC" in f or "FINANCIAMENTO_DE_CAMPANHA" in f:
        return "fefc"
    if "FUNDO_PARTIDARIO" in f:
        return "fp"
    if "FUNDO_ESPECIAL" in o or "FEFC" in o:
        return "fefc"
    if "FUNDO_PARTIDARIO" in o:
        return "fp"
    if "PESSOAS_FISICAS" in o or "PESSOA_FISICA" in o or "INTERNET" in o:
        return "pf"
    if "PESSOAS_JURIDICAS" in o or "PESSOA_JURIDICA" in o:
        return "pj"
    if "PROPRIOS" in o or "PROPRIO" in o:
        return "rp"
    if "FINANCIAMENTO_COLETIVO" in o:
        return "fc"
    if "OUTROS_CANDIDATOS" in o or "COMITE" in o:
        return "cand"
    if "PARTIDO" in o:
        return "part"
    return "out"


def contas_zip(ano: int) -> zipfile.ZipFile:
    if ano == 2014:
        for url in CONTAS_2014:
            if exists(url):
                return zipfile.ZipFile(download(url, RAW))
        raise RuntimeError("zip de prestação de contas de 2014 não encontrado")
    return zipfile.ZipFile(download(tse_urls(ano)["contas"], RAW))


def load_contas(ano: int, sqs: set[str]) -> tuple[pd.DataFrame, dict]:
    z = contas_zip(ano)
    info: dict = {}
    # ---- receitas
    rec = read_member(z, rf"receitas_candidatos_(prestacao_contas_final_)?{ano}_{UF}\.(csv|txt)$")
    sq_r = pick(rec, "SQ_CANDIDATO", "SEQUENCIAL_CANDIDATO")
    vr_r = pick(rec, "VR_RECEITA", "VALOR_RECEITA")
    fonte_c = pick_opt(rec, "DS_FONTE_RECEITA", "FONTE_RECURSO")
    origem_c = pick(rec, "DS_ORIGEM_RECEITA", "TIPO_RECEITA")
    nat_c = pick_opt(rec, "DS_NATUREZA_RECEITA")
    esp_c = pick_opt(rec, "DS_ESPECIE_RECEITA", "ESPECIE_RECURSO")
    rec = rec.assign(sq=rec[sq_r].str.strip(), valor=num(rec[vr_r]))
    rec["origem"] = [
        classifica_origem(f, o) for f, o in zip(rec[fonte_c] if fonte_c else [""] * len(rec), rec[origem_c])
    ]
    if nat_c:
        rec["estimavel"] = rec[nat_c].map(_norm).str.contains("ESTIMAV")
    elif esp_c:
        rec["estimavel"] = rec[esp_c].map(_norm).str.contains("ESTIMAV")
    else:
        rec["estimavel"] = False
    info["receitas_linhas"] = len(rec)
    info["receitas_origens"] = rec.groupby(origem_c)["valor"].sum().sort_values(ascending=False).round(2).to_dict()
    if fonte_c:
        info["receitas_fontes"] = rec.groupby(fonte_c)["valor"].sum().round(2).to_dict()

    # ---- despesas contratadas
    pattern = (
        rf"despesas_candidatos_(prestacao_contas_final_)?{ano}_{UF}\.(csv|txt)$"
        if ano == 2014
        else rf"despesas_contratadas_candidatos_{ano}_{UF}\.(csv|txt)$"
    )
    dsp = read_member(z, pattern)
    sq_d = pick(dsp, "SQ_CANDIDATO", "SEQUENCIAL_CANDIDATO")
    vr_d = pick(dsp, "VR_DESPESA_CONTRATADA", "VALOR_DESPESA")
    tipo_c = pick(dsp, "DS_ORIGEM_DESPESA", "TIPO_DESPESA")
    dsp = dsp.assign(sq=dsp[sq_d].str.strip(), valor=num(dsp[vr_d]))
    dsp["repasse"] = is_repasse(dsp[tipo_c])
    info["despesas_linhas"] = len(dsp)
    info["despesas_tipos_repasse"] = sorted(dsp.loc[dsp["repasse"], tipo_c].unique().tolist())
    info["despesas_por_tipo"] = dsp.groupby(tipo_c)["valor"].sum().sort_values(ascending=False).round(2).head(40).to_dict()

    # ---- agrega
    r = rec.groupby("sq").agg(rt=("valor", "sum"))
    r["re"] = rec[rec["estimavel"]].groupby("sq")["valor"].sum()
    orig = rec.pivot_table(index="sq", columns="origem", values="valor", aggfunc="sum")
    d = dsp.groupby("sq").agg(dt=("valor", "sum"))
    d["gt"] = dsp[dsp["repasse"]].groupby("sq")["valor"].sum()
    out = r.join(orig, how="outer").join(d, how="outer").fillna(0.0)
    out["re"] = out["re"].fillna(0.0)
    out["rf"] = out["rt"] - out["re"]
    out["g"] = out["dt"] - out["gt"]
    info["sq_contas_fora_da_base"] = int(len(set(out.index) - sqs))
    return out, info


# ----------------------------------------------------------------------------
# Montagem
# ----------------------------------------------------------------------------

ORIGENS = ["fp", "fefc", "pf", "pj", "rp", "part", "cand", "fc", "out"]


def build_year(ano: int) -> tuple[pd.DataFrame, dict]:
    cand = load_candidatos(ano)
    vot = load_votacao(ano)
    contas, info = load_contas(ano, set(cand["sq"]))
    df = cand.set_index("sq").join(vot, how="left").join(contas, how="left")
    df["votos"] = df["votos"].fillna(0).astype(int)
    df["anulado"] = df["anulado"].fillna(False).astype(bool)
    for c in ["rt", "re", "rf", "dt", "gt", "g", *ORIGENS]:
        if c not in df.columns:
            df[c] = 0.0
        df[c] = df[c].fillna(0.0)
    df["tem_contas"] = df.index.isin(contas.index) & ((df["rt"] > 0) | (df["dt"] > 0))
    info["votos_sem_candidato"] = int(len(set(vot.index) - set(df.index)))
    return df.reset_index().rename(columns={"index": "sq"}), info


def flags(row) -> list[str]:
    f = []
    if not row.tem_contas:
        f.append("sem_contas")
    if row.anulado:
        f.append("votos_anulados")
    elif row.votos <= 0:
        f.append("sem_votos")
    return f


def main() -> None:
    fatores, ipca_meta = fatores_ipca(ANOS)
    fontes = []
    hoje = date.today().isoformat()
    all_rows = []
    validacao = []
    infos = {}
    for ano in ANOS:
        print(f"== {ano}", flush=True)
        df, info = build_year(ano)
        infos[ano] = info
        for u in tse_urls(ano).values():
            if (RAW / u.rsplit("/", 1)[-1]).exists():
                fontes.append({"nome": f"TSE · {u.rsplit('/', 1)[-1]}", "url": u, "baixado_em": hoje})
        for row in df.itertuples(index=False):
            fl = flags(row)
            all_rows.append(
                {
                    "a": ano,
                    "c": int(row.cargo),
                    "id": row.sq,
                    "n": row.nome,
                    "u": row.urna,
                    "num": row.numero,
                    "p": row.partido,
                    "s": row.situacao,
                    "sd": row.sit_tse if row.situacao == "outro" else "",
                    "v": int(row.votos),
                    "g": round(float(row.g), 2),
                    "gt": round(float(row.gt), 2),
                    "rt": round(float(row.rt), 2),
                    "rf": round(float(row.rf), 2),
                    "re": round(float(row.re), 2),
                    "o": {k: round(float(getattr(row, k)), 2) for k in ORIGENS},
                    "f": fl,
                }
            )
        for cargo in (6, 7):
            sub = [r for r in all_rows if r["a"] == ano and r["c"] == cargo]
            validacao.append(
                {
                    "ano": ano,
                    "cargo": cargo,
                    "candidatos": len(sub),
                    "eleitos": sum(r["s"] == "eleito" for r in sub),
                    "sem_contas": sum("sem_contas" in r["f"] for r in sub),
                    "sem_votos": sum("sem_votos" in r["f"] for r in sub),
                    "votos_anulados": sum("votos_anulados" in r["f"] for r in sub),
                    "na_media": sum(not r["f"] and r["v"] > 0 and r["g"] > 0 for r in sub),
                }
            )
    fontes.append({"nome": "Banco Central · SGS 433 (IPCA)", "url": ipca_meta["url"], "baixado_em": hoje})

    meta = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "anos": ANOS,
        "ipca": {"serie": 433, "ate": ipca_meta["ate"], "base": "mês seguinte à eleição (novembro)", "fatores": fatores},
        "fontes": fontes,
        "limites_2026": LIMITES_2026,
        "validacao": validacao,
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps({"meta": meta, "candidatos": all_rows}, ensure_ascii=False, separators=(",", ":")))
    print(f"gravado {OUT_JSON} ({OUT_JSON.stat().st_size / 1e6:.2f} MB, {len(all_rows)} candidatos)")
    write_report(meta, all_rows, infos)


# Limites de gastos de campanha 2026 (Portaria TSE nº 449/2026, que manteve os valores de 2022).
LIMITES_2026 = [
    {
        "cargo": 6,
        "valor": 3176572.53,
        "fonte": "Portaria TSE nº 449/2026",
        "url": "https://www.tre-sc.jus.br/eleicoes/eleicoes-2026/prestacao-de-contas/limites-gastos-campanha",
    },
    {
        "cargo": 7,
        "valor": 1270629.01,
        "fonte": "Portaria TSE nº 449/2026",
        "url": "https://www.tre-sc.jus.br/eleicoes/eleicoes-2026/prestacao-de-contas/limites-gastos-campanha",
    },
]


def brl(v: float) -> str:
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def intbr(n: int) -> str:
    return f"{int(n):,}".replace(",", ".")


def write_report(meta: dict, rows: list[dict], infos: dict) -> None:
    L = ["# Relatório de validação", "", f"Gerado em {meta['gerado_em']}. IPCA até {meta['ipca']['ate']}.", ""]
    L += ["## Contagens por ano e cargo", ""]
    L += ["| Ano | Cargo | Candidatos | Eleitos | Sem contas | 0 votos | Votos anulados | Nas médias |", "|---|---|---:|---:|---:|---:|---:|---:|"]
    for v in meta["validacao"]:
        L.append(
            f"| {v['ano']} | {CARGOS[v['cargo']].title()} | {v['candidatos']} | {v['eleitos']} | {v['sem_contas']} | {v['sem_votos']} | {v['votos_anulados']} | {v['na_media']} |"
        )
    L += ["", "## Fatores de correção (IPCA)", ""]
    for a, f in meta["ipca"]["fatores"].items():
        L.append(f"- {a}: × {f:.4f}")
    L += ["", "## Totais declarados (nominais)", "", "| Ano | Cargo | Despesas contratadas (sem repasses) | Repasses excluídos | Receitas | Votos nominais |", "|---|---|---:|---:|---:|---:|"]
    for ano in meta["anos"]:
        for cargo in (6, 7):
            sub = [r for r in rows if r["a"] == ano and r["c"] == cargo]
            L.append(
                f"| {ano} | {CARGOS[cargo].title()} | {brl(sum(r['g'] for r in sub))} | {brl(sum(r['gt'] for r in sub))} | {brl(sum(r['rt'] for r in sub))} | {intbr(sum(r['v'] for r in sub))} |"
            )
    L += ["", "## Mediana do CPV (despesas, nominal)", ""]
    for ano in meta["anos"]:
        for cargo in (6, 7):
            sub = [r["g"] / r["v"] for r in rows if r["a"] == ano and r["c"] == cargo and not r["f"] and r["v"] > 0 and r["g"] > 0]
            el = [r["g"] / r["v"] for r in rows if r["a"] == ano and r["c"] == cargo and r["s"] == "eleito" and not r["f"] and r["v"] > 0 and r["g"] > 0]
            L.append(f"- {ano} {CARGOS[cargo].title()}: geral {brl(pd.Series(sub).median())} (n={len(sub)}), eleitos {brl(pd.Series(el).median())} (n={len(el)})")
    L += ["", "## Eleitos por ano e cargo (conferência)", ""]
    for ano in meta["anos"]:
        for cargo in (6, 7):
            el = sorted([r for r in rows if r["a"] == ano and r["c"] == cargo and r["s"] == "eleito"], key=lambda r: -r["v"])
            L.append(f"<details><summary>{ano} · {CARGOS[cargo].title()} · {len(el)} eleitos</summary>\n")
            L.append("| Nome de urna | Partido | Votos | Despesas | CPV | SQ |")
            L.append("|---|---|---:|---:|---:|---|")
            for r in el:
                cpv = brl(r["g"] / r["v"]) if r["v"] else "—"
                L.append(f"| {r['u']} | {r['p']} | {intbr(r['v'])} | {brl(r['g'])} | {cpv} | {r['id']} |")
            L.append("\n</details>\n")
    L += ["", "## Detalhes do cruzamento", ""]
    for ano, info in infos.items():
        L.append(f"### {ano}")
        L.append("```json")
        L.append(json.dumps(info, ensure_ascii=False, indent=1)[:12000])
        L.append("```")
    REPORT.write_text("\n".join(L), encoding="utf-8")
    print(f"gravado {REPORT}")


if __name__ == "__main__":
    main()

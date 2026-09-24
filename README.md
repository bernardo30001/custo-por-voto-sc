# Custo por Voto SC

Quanto custou cada voto dos candidatos a **Deputado Federal** e **Deputado Estadual** em **Santa Catarina** nas eleições de **2014, 2018 e 2022**, com dados oficiais do TSE e correção pelo IPCA.

**Site:** https://bernardo30001.github.io/custo-por-voto-sc/

O site tem três partes:

- **Painel:** filtros por ano, cargo, partido, situação e nome; tabela ordenável; dispersão gasto × votos em escala log; cards com CPV mediano dos eleitos e geral, maior e menor CPV entre eleitos e a votação do último eleito; comparação da mediana corrigida entre os anos; composição das receitas por origem.
- **Simulador “Quanto rende o investimento?”:** para um cargo, um valor e um ano de referência (ou os três combinados), mostra sempre faixas: votos dos candidatos com gasto parecido (±20%, p25 a p75 e mediana), regressão log-log com intervalo, quantos deles se elegeram e a comparação com o último eleito. Mostra também o limite de gastos de 2026 com a fonte oficial.
- **Cenário “gasto não declarado”:** controle global de 0% a 100% que multiplica o gasto declarado de **todos** os candidatos pelo mesmo fator. É um exercício de sensibilidade hipotético, sem nenhuma afirmação sobre candidato específico.

Tudo é estático (Vite + TypeScript + Chart.js), sem backend. Os dados ficam em `site/data/candidatos.json`.

## Fontes

| Dado | Arquivo | Origem |
|---|---|---|
| Candidatos | `consulta_cand_{ANO}.zip` | [TSE Dados Abertos](https://dadosabertos.tse.jus.br) · `cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/` |
| Votação | `votacao_candidato_munzona_{ANO}.zip` | `cdn.tse.jus.br/estatistica/sead/odsele/votacao_candidato_munzona/` |
| Prestação de contas | `prestacao_de_contas_eleitorais_candidatos_{ANO}.zip` (2018, 2022) e o arquivo próprio de 2014 | `cdn.tse.jus.br/estatistica/sead/odsele/prestacao_contas/` |
| IPCA | SGS 433 | [API do Banco Central](https://dadosabertos.bcb.gov.br/dataset/433-indice-nacional-de-precos-ao-consumidor-amplo-ipca) (reserva: IBGE/SIDRA tabela 1737) |
| Limite de gastos 2026 | Portaria TSE nº 449/2026 | [TRE-SC](https://www.tre-sc.jus.br/eleicoes/eleicoes-2026/prestacao-de-contas/limites-gastos-campanha) |

Filtros: `SG_UF = SC`, `CD_CARGO` 6 (Dep. Federal) e 7 (Dep. Estadual), 1º turno.

## Regras de cálculo

- **Votos:** soma de `QT_VOTOS_NOMINAIS` por `SQ_CANDIDATO`.
- **Gasto declarado:** soma das despesas contratadas, **excluindo** doações e transferências a outros candidatos ou partidos (para não contar o mesmo dinheiro duas vezes).
- **Métrica alternativa:** receitas totais, separando financeiras e estimáveis.
- **CPV** = gasto declarado ÷ votos nominais.
- **IPCA:** fator acumulado de novembro do ano da eleição até o último mês disponível. O site alterna entre valores nominais e corrigidos.
- Candidatos com 0 votos, votos anulados ou sem prestação de contas ficam na base com uma marca e saem das médias.
- As receitas são classificadas por origem (Fundo Partidário, FEFC, pessoas físicas, pessoas jurídicas em 2014, recursos próprios, partido, outros candidatos, financiamento coletivo, outros).

Detalhes e limitações na página **Metodologia** do site.

## Estrutura

```
pipeline/            Python: download, limpeza, cruzamento e validação
  build.py           gera site/data/candidatos.json e relatorio_validacao.md
  inspect_layouts.py mostra URLs, membros dos zips e colunas de cada ano
  common.py          configuração (anos, UF, URLs) e download com cache
  ipca.py            série do IPCA e fatores de correção
  requirements.txt
site/                Vite + TypeScript
  data/candidatos.json
  src/
.github/workflows/
  deploy.yml         build e deploy no GitHub Pages a cada push na main
  pipeline.yml       roda o pipeline no GitHub e publica os dados (manual)
```

## Como rodar o pipeline

Localmente (precisa de acesso a `cdn.tse.jus.br` e `api.bcb.gov.br`; os zips somam alguns GB e ficam em `pipeline/raw/`):

```bash
cd pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python inspect_layouts.py --download   # opcional: confere colunas de cada ano
python build.py
```

Ou pelo GitHub: aba **Actions → Pipeline de dados (TSE + IPCA) → Run workflow**. O workflow roda o `build.py`, grava `site/data/candidatos.json` e `pipeline/relatorio_validacao.md` na `main` e dispara o deploy.

## Como rodar o site

```bash
cd site
npm ci
npm run dev      # http://localhost:5173
npm run build    # gera site/dist
```

## Como atualizar com os dados de 2026

1. Espere o TSE publicar os arquivos finais de 2026 (`consulta_cand_2026.zip`, `votacao_candidato_munzona_2026.zip` e `prestacao_de_contas_eleitorais_candidatos_2026.zip`). A prestação de contas final costuma sair semanas depois da eleição; antes disso só há dados parciais.
2. Em `pipeline/common.py`, acrescente `2026` em `ANOS`.
3. Rode `python inspect_layouts.py --download` e confira se as colunas mudaram (o parser procura nomes alternativos, mas o TSE às vezes renomeia campos). Ajuste `build.py` se preciso.
4. Rode `python build.py` e revise `relatorio_validacao.md` (total de candidatos, eleitos, sem contas, sem votos).
5. Confira alguns candidatos no [DivulgaCandContas](https://divulgacandcontas.tse.jus.br).
6. Faça commit do novo `candidatos.json`; o deploy é automático. O site lê os anos de `meta.anos`, então não é preciso mudar o frontend.

## Licença

Código sob licença MIT. Os dados são públicos, do TSE e do Banco Central.

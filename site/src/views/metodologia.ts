import { CARGO_NOME } from '../data';
import { dataset } from '../state';
import { esc, fmtBRL, fmtInt } from '../format';

const REPO = 'https://github.com/bernardo30001/custo-por-voto-sc';

export function renderMetodologia(root: HTMLElement) {
  const { meta } = dataset();
  const fontes = meta.fontes
    .map(
      (f) =>
        `<li><a href="${esc(f.url)}" rel="noopener" target="_blank">${esc(f.nome)}</a> <span class="muted small">baixado em ${esc(
          new Date(f.baixado_em).toLocaleDateString('pt-BR'),
        )}</span></li>`,
    )
    .join('');
  const val = meta.validacao
    .map(
      (v) =>
        `<tr><td>${v.ano}</td><td>${CARGO_NOME[v.cargo]}</td><td class="num">${fmtInt(v.candidatos)}</td><td class="num">${fmtInt(
          v.eleitos,
        )}</td><td class="num">${fmtInt(v.sem_contas)}</td><td class="num">${fmtInt(v.sem_votos)}</td><td class="num">${fmtInt(
          v.votos_anulados,
        )}</td><td class="num">${fmtInt(v.na_media)}</td></tr>`,
    )
    .join('');
  const fatores = Object.entries(meta.ipca.fatores)
    .map(([a, f]) => `<li>${a}: × ${f.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</li>`)
    .join('');
  const limites = meta.limites_2026
    .map(
      (l) =>
        `<li>${CARGO_NOME[l.cargo]}: <strong>${fmtBRL(l.valor)}</strong> (${esc(l.fonte)}, <a href="${esc(l.url)}" rel="noopener" target="_blank">fonte</a>)</li>`,
    )
    .join('');

  root.innerHTML = `
  <article class="prose" id="metodologia">
    <header class="page-head">
      <h1>Metodologia</h1>
      <p class="lede">De onde vêm os números, como foram calculados e o que eles não dizem.</p>
    </header>

    <nav class="toc" aria-label="Nesta página">
      <a href="#/metodologia#fontes">Fontes</a>
      <a href="#/metodologia#calculo">Cálculo</a>
      <a href="#/metodologia#exclusoes">Exclusões</a>
      <a href="#/metodologia#ao-vivo">2026 ao vivo</a>
      <a href="#/metodologia#cenario">Cenário</a>
      <a href="#/metodologia#limitacoes">Limitações</a>
      <a href="#/metodologia#validacao">Validação</a>
      <a href="#/metodologia#reproduzir">Reproduzir</a>
    </nav>

    <h2 id="fontes">Fontes</h2>
    <ul>${fontes}</ul>
    <p>Todos os arquivos vêm do Portal de Dados Abertos do TSE (CDN <code>cdn.tse.jus.br/estatistica/sead/odsele/</code>) e da API SGS do Banco Central. Foram usados apenas os arquivos e linhas de Santa Catarina (SG_UF = SC), cargos 6 (Deputado Federal) e 7 (Deputado Estadual), 1º turno. De cada zip oficial foram copiados só os arquivos de SC, byte a byte, com conferência do CRC32 de cada arquivo.</p>
    <p>Conferência manual: os totais de receitas e de despesas contratadas de candidatos de 2014, 2018 e 2022 foram comparados com o <a href="https://divulgacandcontas.tse.jus.br" rel="noopener" target="_blank">DivulgaCandContas</a> e bateram (em 2014, somando os repasses e estimáveis que o site exclui).</p>

    <h2 id="calculo">Regras de cálculo</h2>
    <ul>
      <li><strong>Votos:</strong> soma de <code>QT_VOTOS_NOMINAIS</code> em todas as zonas e municípios, por <code>SQ_CANDIDATO</code>. Em 2018 e 2022, quando <code>NM_TIPO_DESTINACAO_VOTOS</code> indica votos anulados, o candidato recebe a marca “votos anulados” e sai das medianas. O arquivo de 2014 não tem esse campo; ali os candidatos indeferidos já aparecem com 0 votos.</li>
      <li><strong>Gasto declarado (padrão):</strong> soma das <em>despesas contratadas</em> do candidato, <strong>excluindo</strong> doações e transferências feitas a outros candidatos ou partidos (“Doações financeiras a outros candidatos/partidos”). Sem essa exclusão o mesmo dinheiro seria contado duas vezes (no doador e no recebedor).</li>
      <li><strong>2014:</strong> o arquivo de despesas daquele ano também traz lançamentos de “Baixa de Estimáveis” (bens e serviços recebidos como doação e registrados como despesa). Os arquivos de despesas contratadas de 2018 e 2022 só têm gastos financeiros, então esses lançamentos de 2014 ficam fora do gasto para manter a comparação. Os estimáveis continuam na métrica de receitas.</li>
      <li><strong>Métrica alternativa:</strong> receitas totais do candidato, com a separação entre recursos financeiros e estimáveis em dinheiro (bens e serviços doados). Há também a opção “receitas financeiras”, que ignora os estimáveis.</li>
      <li><strong>Custo por voto (CPV):</strong> gasto declarado ÷ votos nominais.</li>
      <li><strong>Correção monetária:</strong> IPCA (SGS ${meta.ipca.serie}), acumulado do mês seguinte à eleição (${esc(meta.ipca.base)}) até ${esc(
        meta.ipca.ate,
      )}. Fatores aplicados:<ul>${fatores}</ul></li>
      <li><strong>Situação:</strong> “Eleito” reúne eleito por QP e por média; “Suplente” e “Não eleito” seguem o TSE; “Outra / indeferido” agrupa candidaturas sem resultado válido (<code>#NULO#</code> e similares).</li>
      <li><strong>Origem das receitas:</strong> Fundo Partidário e FEFC são identificados pela fonte do recurso (mesmo quando chegam via partido). O restante é classificado pela origem declarada: pessoas físicas, recursos próprios, partido, outros candidatos, financiamento coletivo e outros. Em 2014 ainda havia doações de pessoas jurídicas; o FEFC só existe a partir de 2018.</li>
      <li><strong>Último eleito:</strong> o eleito com menor votação nominal no cargo e ano (não confundir com o quociente eleitoral).</li>
    </ul>

    <h2 id="simulador-metodo">Simulador</h2>
    <ul>
      <li>Usa sempre valores corrigidos pelo IPCA, porque o investimento informado é em reais de hoje.</li>
      <li><strong>Gasto parecido:</strong> candidatos com gasto entre −20% e +20% do valor. Se houver menos de 5, a janela é ampliada (±30%, ±40%, ±50%) e o site avisa. Mostra do 1º ao 3º quartil (p25 a p75) e a mediana dos votos.</li>
      <li><strong>Regressão:</strong> mínimos quadrados de ln(votos) sobre ln(gasto), com intervalos de previsão de 50% e 90%.</li>
      <li><strong>Pelo CPV:</strong> votos ≈ investimento ÷ (CPV histórico × (1 + p)), usando os quartis de CPV dos candidatos com gasto parecido.</li>
      <li><strong>Referência 2026:</strong> ${limites ? `<ul>${limites}</ul>` : 'não disponível.'}</li>
    </ul>

    <h2 id="ao-vivo">Campanha 2026 ao vivo</h2>
    <ul>
      <li><strong>Fonte:</strong> prestações de contas parciais de 2026 no DivulgaCandContas (eleição 20322002026, SC, cargos 6 e 7), coletadas de hora em hora pelo painel <a href="https://bernardo30001.github.io/ranking-doacoes-novo-sc/" rel="noopener" target="_blank">Ranking de Doações · SC 2026</a>. A aba lê o <code>dados.json</code> e o <code>historico.json</code> publicados por esse painel e confere novas coletas a cada minuto enquanto está aberta.</li>
      <li><strong>Valores de 2026:</strong> arrecadação líquida (recebido menos devolvido), receitas financeiras e despesas contratadas, conforme a métrica escolhida no topo. São valores nominais de 2026, comparáveis aos históricos corrigidos pelo IPCA.</li>
      <li><strong>Referência histórica:</strong> para o valor atual de cada candidatura, o site procura candidatos do mesmo cargo que gastaram entre −20% e +20% disso na eleição de referência (ampliando até ±50% se houver menos de 5 casos) e mostra a faixa de votos do 1º ao 3º quartil, a mediana e quantos se elegeram.</li>
      <li><strong>Limitação principal:</strong> os valores de 2026 são parciais e os históricos são finais. A comparação mostra onde cada campanha está hoje, sem projetar o gasto final nem o resultado.</li>
      <li><strong>Variação recente:</strong> diferença da receita bruta em relação à última coleta registrada antes do dia atual. Pode incluir retificações, além de doações novas.</li>
      <li>Candidaturas com renúncia, indeferimento definitivo ou pedido não conhecido ficam de fora por padrão (dá para incluí-las desmarcando “Só candidaturas ativas”).</li>
    </ul>

    <h2 id="exclusoes">Exclusões e marcações</h2>
    <p>Nenhum candidato é removido da base. Ficam fora das médias, medianas, gráficos log e simulador (mas continuam na tabela, com a marca correspondente):</p>
    <ul>
      <li>candidatos com <strong>0 votos</strong> nominais válidos;</li>
      <li>candidatos com <strong>votos anulados</strong> (por exemplo, candidatura indeferida);</li>
      <li>candidatos <strong>sem prestação de contas</strong> nos arquivos do TSE (sem receitas nem despesas);</li>
      <li>candidatos com valor zero na métrica escolhida.</li>
    </ul>

    <h2 id="cenario">Cenário “gasto não declarado”</h2>
    <div class="callout callout-scenario">
      <p>Este é um <strong>cenário hipotético de sensibilidade</strong>. O controle deslizante multiplica o gasto declarado de <strong>todos os candidatos pelo mesmo fator</strong> (1 + p): CPV ajustado = gasto declarado × (1 + p) ÷ votos. No simulador, o custo histórico de cada voto passa a ser (1 + p) vezes maior, o que reduz os votos esperados para o mesmo investimento.</p>
      <p>O cenário <strong>não faz nenhuma afirmação ou insinuação sobre qualquer candidato específico</strong>, não gera ranking, selo ou destaque individual, e não se baseia em nenhum percentual “de mercado”. Serve apenas para mostrar quanto as conclusões mudariam se o custo real das campanhas fosse maior que o declarado.</p>
    </div>

    <h2 id="limitacoes">Limitações</h2>
    <ul>
      <li><strong>Despesa contratada ≠ despesa paga.</strong> O TSE publica as duas; usamos a contratada, que registra a obrigação assumida. Parte pode não ter sido paga ou ter sido paga depois.</li>
      <li><strong>Estimáveis</strong> (bens e serviços doados, como material impresso pelo partido) têm valor atribuído pelo próprio declarante e podem estar sub ou superestimados.</li>
      <li><strong>Candidaturas indeferidas</strong> ou sub judice podem ter votos anulados e contas incompletas.</li>
      <li>As prestações de contas podem ser retificadas depois do download; os valores refletem a data indicada em Fontes.</li>
      <li>Em 2014 o layout da prestação de contas é diferente e as categorias de despesa não são idênticas às de 2018 e 2022; a exclusão de repasses usa o tipo de despesa equivalente.</li>
      <li>Votos em eleição proporcional dependem de partido, federação, base regional, mandato e notoriedade. Correlação entre gasto e votos não é causalidade.</li>
      <li>Os resultados de 2026 (votos) ainda não fazem parte da base histórica; depois da eleição e da prestação de contas final, veja no repositório como incluí-los.</li>
    </ul>

    <h2 id="validacao">Validação da base</h2>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Ano</th><th>Cargo</th><th class="num">Candidatos</th><th class="num">Eleitos</th><th class="num">Sem contas</th><th class="num">0 votos</th><th class="num">Votos anulados</th><th class="num">Nas médias*</th></tr></thead>
      <tbody>${val}</tbody>
    </table></div>
    <p class="note">* Com a métrica padrão (despesas contratadas).</p>

    <h2 id="reproduzir">Como reproduzir</h2>
    <pre><code>git clone ${REPO}.git
cd custo-por-voto-sc/pipeline
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python build.py            # cruza os dados e gera ../site/data/candidatos.json
cd ../site && npm ci && npm run dev</code></pre>
    <p>O CDN do TSE só aceita conexões do Brasil. Para evitar baixar ~2,5 GB de zips nacionais, o repositório traz <code>pipeline/extrair_sc.js</code>, que copia só os arquivos de SC direto dos zips oficiais pelo navegador.</p>
    <p>O código-fonte, o relatório de validação e as instruções para incluir 2026 estão no <a href="${REPO}" rel="noopener" target="_blank">repositório no GitHub</a>. Os dados completos estão em <a href="${
      import.meta.env.BASE_URL
    }data/candidatos.json">candidatos.json</a>.</p>
    <p class="muted small">Base gerada em ${esc(new Date(meta.gerado_em).toLocaleString('pt-BR'))}.</p>
  </article>`;
}

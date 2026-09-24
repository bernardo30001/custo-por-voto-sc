/*
 * Extrai só os arquivos de Santa Catarina dos zips oficiais do TSE, sem baixar os zips inteiros.
 *
 * Por que existe: o CDN do TSE (cdn.tse.jus.br) bloqueia IPs fora do Brasil, inclusive os
 * servidores do GitHub Actions. Os zips completos somam ~2,5 GB, mas os arquivos de SC são ~30 MB.
 * Este script usa requisições HTTP Range para ler o diretório central de cada zip e copiar apenas
 * as entradas de SC (com os mesmos bytes comprimidos e CRC32 do arquivo oficial) para um zip novo.
 *
 * Como usar (de uma conexão no Brasil):
 *   1. Abra https://cdn.tse.jus.br/estatistica/sead/odsele/ no navegador (a página de erro serve,
 *      o importante é estar na mesma origem do CDN).
 *   2. Abra o console do navegador, cole este arquivo e rode: await baixarSC(2022)
 *   3. Mova o tse_sc_2022.zip baixado para pipeline/raw/ e rode python build.py.
 *
 * O build.py confere o CRC32 de cada arquivo ao ler o zip (zipfile falha se algo estiver corrompido).
 */
const BASE = 'https://cdn.tse.jus.br/estatistica/sead/odsele/';

const ARQUIVOS = (ano) => [
  `consulta_cand/consulta_cand_${ano}.zip`,
  `votacao_candidato_munzona/votacao_candidato_munzona_${ano}.zip`,
  ano === 2014 ? 'prestacao_contas/prestacao_final_2014.zip' : `prestacao_contas/prestacao_de_contas_eleitorais_candidatos_${ano}.zip`,
];

const QUERO = (n) =>
  /^(consulta_cand_\d{4}_SC\.csv|votacao_candidato_munzona_\d{4}_SC\.csv|receitas_candidatos_\d{4}_SC\.(csv|txt)|despesas_contratadas_candidatos_\d{4}_SC\.csv|despesas_candidatos_2014_SC\.txt|leiame.*\.pdf)$/i.test(n) &&
  !/partidos|comites|doador|pagas/i.test(n);

async function range(url, ini, fim) {
  const r = await fetch(url, { headers: { Range: `bytes=${ini}-${fim}` } });
  if (r.status !== 206) throw new Error(`${url}: status ${r.status}`);
  return { buf: new Uint8Array(await r.arrayBuffer()), total: +r.headers.get('content-range').split('/')[1] };
}

async function diretorioCentral(url) {
  const { total } = await range(url, 0, 0);
  const n0 = Math.min(total, 65557 + 76);
  const { buf: cauda } = await range(url, total - n0, total - 1);
  const dv = new DataView(cauda.buffer);
  let i = cauda.length - 22;
  while (i >= 0 && dv.getUint32(i, true) !== 0x06054b50) i--;
  let tam = dv.getUint32(i + 12, true), ini = dv.getUint32(i + 16, true);
  if (ini === 0xffffffff || tam === 0xffffffff) {
    const e64 = Number(dv.getBigUint64(i - 20 + 8, true));
    const { buf } = await range(url, e64, e64 + 55);
    const d2 = new DataView(buf.buffer);
    tam = Number(d2.getBigUint64(40, true));
    ini = Number(d2.getBigUint64(48, true));
  }
  const { buf: cd } = await range(url, ini, ini + tam - 1);
  const v = new DataView(cd.buffer);
  const td = new TextDecoder('latin1');
  const out = [];
  let p = 0;
  while (p < cd.length && v.getUint32(p, true) === 0x02014b50) {
    const e = {
      metodo: v.getUint16(p + 10, true), hora: v.getUint16(p + 12, true), data: v.getUint16(p + 14, true),
      crc: v.getUint32(p + 16, true), comp: v.getUint32(p + 20, true), orig: v.getUint32(p + 24, true),
      off: v.getUint32(p + 42, true),
    };
    const nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true);
    e.nome = td.decode(cd.subarray(p + 46, p + 46 + nl));
    for (let q = p + 46 + nl; q < p + 46 + nl + el; ) {
      const id = v.getUint16(q, true), sz = v.getUint16(q + 2, true);
      if (id === 1) {
        let k = q + 4;
        if (e.orig === 0xffffffff) { e.orig = Number(v.getBigUint64(k, true)); k += 8; }
        if (e.comp === 0xffffffff) { e.comp = Number(v.getBigUint64(k, true)); k += 8; }
        if (e.off === 0xffffffff) { e.off = Number(v.getBigUint64(k, true)); }
      }
      q += 4 + sz;
    }
    out.push(e);
    p += 46 + nl + el + cl;
  }
  return out;
}

async function baixarSC(ano) {
  const enc = new TextEncoder();
  const partes = [], centrais = [];
  let off = 0;
  for (const f of ARQUIVOS(ano)) {
    for (const e of (await diretorioCentral(BASE + f)).filter((e) => QUERO(e.nome))) {
      const { buf: lh } = await range(BASE + f, e.off, e.off + 29);
      const lv = new DataView(lh.buffer);
      const ini = e.off + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
      const { buf: dados } = await range(BASE + f, ini, ini + e.comp - 1);
      const pasta = f.split('/')[0];
      const nome = enc.encode(`${pasta}/${e.nome.replace(/^leiame/i, `leiame_${pasta}_${ano}`)}`);
      const h = new Uint8Array(30 + nome.length), hv = new DataView(h.buffer);
      hv.setUint32(0, 0x04034b50, true); hv.setUint16(4, 20, true); hv.setUint16(8, e.metodo, true);
      hv.setUint16(10, e.hora, true); hv.setUint16(12, e.data, true); hv.setUint32(14, e.crc, true);
      hv.setUint32(18, e.comp, true); hv.setUint32(22, e.orig, true); hv.setUint16(26, nome.length, true); h.set(nome, 30);
      const c = new Uint8Array(46 + nome.length), cv = new DataView(c.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, e.metodo, true);
      cv.setUint16(12, e.hora, true); cv.setUint16(14, e.data, true); cv.setUint32(16, e.crc, true); cv.setUint32(20, e.comp, true);
      cv.setUint32(24, e.orig, true); cv.setUint16(28, nome.length, true); cv.setUint32(42, off, true); c.set(nome, 46);
      partes.push(h, dados); centrais.push(c); off += h.length + dados.length;
    }
  }
  const tamCD = centrais.reduce((s, c) => s + c.length, 0);
  const fim = new Uint8Array(22), fv = new DataView(fim.buffer);
  fv.setUint32(0, 0x06054b50, true); fv.setUint16(8, centrais.length, true); fv.setUint16(10, centrais.length, true);
  fv.setUint32(12, tamCD, true); fv.setUint32(16, off, true);
  const blob = new Blob([...partes, ...centrais, fim], { type: 'application/zip' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `tse_sc_${ano}.zip` });
  document.body.appendChild(a); a.click(); a.remove();
  return `tse_sc_${ano}.zip: ${(blob.size / 1e6).toFixed(1)} MB, ${centrais.length} arquivos`;
}

// Regressão do bug b09-setup-indexes-conflito: database/setup-indexes.js pedia
// walletTransactions { referenceId, type, source } sem unique/parcial enquanto
// database/setupDatabase.js (fonte de verdade) o cria único parcial -> IndexKeySpecsConflict
// (code 86) e o script abortava. Sem banco: lê os dois arquivos e compara os createIndex.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ler = (nome) => readFileSync(fileURLToPath(new URL(`../../database/${nome}`, import.meta.url)), 'utf8');

/** Fatia o texto dos argumentos de uma chamada, a partir do '(' em `abre`. */
function argumentosDe(src, abre) {
  let prof = 0;
  let aspas = null;
  const partes = [];
  let inicio = abre + 1;
  for (let i = abre; i < src.length; i++) {
    const c = src[i];
    if (aspas) {
      if (c === '\\') i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') aspas = c;
    else if ('({['.includes(c)) prof++;
    else if (')}]'.includes(c)) {
      prof--;
      if (prof === 0) {
        partes.push(src.slice(inicio, i));
        return partes.map((p) => p.trim()).filter(Boolean);
      }
    } else if (c === ',' && prof === 1) {
      partes.push(src.slice(inicio, i));
      inicio = i + 1;
    }
  }
  throw new Error('parenteses desbalanceados');
}

const avaliar = (texto) => new Function(`return (${texto});`)();

/** Lista { colecao, chaves, opcoes } de cada `.collection('x').createIndex(...)` do arquivo. */
function indicesDe(src) {
  const semComentarios = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const re = /collection\(\s*(['"])(\w+)\1\s*\)\s*\.createIndex\s*\(/g;
  const achados = [];
  let m;
  while ((m = re.exec(semComentarios))) {
    const [chaves, opcoes] = argumentosDe(semComentarios, re.lastIndex - 1);
    const o = opcoes ? avaliar(opcoes) : {};
    achados.push({
      colecao: m[2],
      chaves: avaliar(chaves),
      opcoes: {
        unique: o.unique === true,
        sparse: o.sparse === true,
        expireAfterSeconds: o.expireAfterSeconds ?? null,
        partialFilterExpression: o.partialFilterExpression ?? null,
      },
    });
  }
  return achados;
}

const id = (i) => `${i.colecao} ${JSON.stringify(i.chaves)}`;
const mapa = (lista) => new Map(lista.map((i) => [id(i), i]));

const doBanco = indicesDe(ler('setupDatabase.js'));
const doScript = indicesDe(ler('setup-indexes.js'));
const D = mapa(doBanco);
const S = mapa(doScript);

describe('b09: setup-indexes.js x setupDatabase.js', () => {
  it('o extrator enxerga os índices dos dois scripts', () => {
    expect(doBanco.length).toBeGreaterThan(30);
    expect(doScript.length).toBeGreaterThan(20);
  });

  it('nenhum script repete a mesma chave dentro de si', () => {
    expect(S.size).toBe(doScript.length);
    expect(D.size).toBe(doBanco.length);
  });

  // 006-checkout-caucao (D-08): deixou de ser único; a idempotência é só por operacaoId.
  it('o índice por referenceId é parcial e não único nos dois', () => {
    const chave = 'walletTransactions {"referenceId":1,"type":1,"source":1}';
    const esperado = { unique: false, partialFilterExpression: { referenceId: { $type: 'string' } } };
    for (const lado of [S, D]) {
      expect(lado.get(chave)?.opcoes).toMatchObject(esperado);
    }
  });

  it('mesma chave => mesmas opções (evita IndexKeySpecsConflict)', () => {
    const divergentes = [...S.entries()]
      .filter(([k]) => D.has(k))
      .filter(([k, i]) => JSON.stringify(i.opcoes) !== JSON.stringify(D.get(k).opcoes))
      .map(([k]) => k);
    expect(divergentes).toEqual([]);
  });

  it('todo índice de setup-indexes.js também está em setupDatabase.js (fonte de verdade)', () => {
    const soNoScript = [...S.keys()].filter((k) => !D.has(k));
    expect(soNoScript).toEqual([]);
  });

  it('índices do ledger segmentado (002) idênticos e presentes nos dois', () => {
    const unicoOperacao = 'walletTransactions {"operacaoId":1,"walletId":1,"categoria":1,"type":1}';
    const saldoCategoria = 'walletTransactions {"walletId":1,"categoria":1,"status":1}';
    for (const lado of [S, D]) {
      expect(lado.get(unicoOperacao)?.opcoes).toMatchObject({
        unique: true,
        partialFilterExpression: { operacaoId: { $type: 'string' } },
      });
      expect(lado.has(saldoCategoria)).toBe(true);
    }
  });

  it('TTLs (rateLimits, verificationCodes, rotinas) iguais nos dois', () => {
    const ttls = [...D.values()].filter((i) => i.opcoes.expireAfterSeconds !== null).map(id);
    expect(ttls.length).toBeGreaterThanOrEqual(4);
    for (const k of ttls.filter((k) => S.has(k))) {
      expect(S.get(k).opcoes.expireAfterSeconds).toBe(D.get(k).opcoes.expireAfterSeconds);
    }
  });
});

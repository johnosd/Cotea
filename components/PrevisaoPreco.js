import { TAXA_COTEA_PERCENTUAL } from '../lib/preco';

const reais = (valor) => `R$ ${Number(valor).toFixed(2)}`;

/** Nota exibida ao membro junto do valor por vaga (003-preco-por-vaga, FR-014). */
export const NOTA_TAXA_COTEA = `inclui taxa Cotea de ${TAXA_COTEA_PERCENTUAL}%`;

/**
 * Prévia da decomposição do preço para o dono (FR-013). Recebe o retorno de
 * calcularPrecoVaga (lib/preco.js) — a mesma função que o servidor usa para gravar.
 */
export default function PrevisaoPreco({ preco, titulo = 'Previa do preco por vaga' }) {
  if (!preco?.valido) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500" aria-live="polite">
        {preco?.mensagem || 'Informe valor total e capacidade para ver o preco por vaga.'}
      </div>
    );
  }

  const linhas = [
    { rotulo: 'Membro paga por mes', valor: preco.valorPorVaga, destaque: true },
    { rotulo: 'Voce recebe por membro', valor: preco.repasse },
    { rotulo: `Taxa Cotea (${TAXA_COTEA_PERCENTUAL}%) por membro`, valor: preco.taxa },
    { rotulo: 'Sua parte (sem taxa)', valor: preco.parteDono },
  ];

  return (
    <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4" aria-live="polite">
      <p className="text-sm font-semibold text-gray-900">{titulo}</p>
      <dl className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {linhas.map((linha) => (
          <div key={linha.rotulo} className="flex items-baseline justify-between gap-2 rounded-lg bg-white px-3 py-2">
            <dt className="text-xs text-gray-600">{linha.rotulo}</dt>
            <dd className={linha.destaque ? 'text-base font-bold text-gray-900' : 'text-sm font-semibold text-gray-800'}>
              {reais(linha.valor)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-gray-500">
        O membro paga (valor total / capacidade) + {TAXA_COTEA_PERCENTUAL}% de taxa Cotea. Voce ocupa 1 vaga e nao paga taxa.
      </p>
    </div>
  );
}

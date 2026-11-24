import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Header from '../../components/Header';
import { ORDEM_CATEGORIAS_BLOQUEADAS, ROTULOS_CATEGORIAS } from '../../lib/ledger/rotulos';

const formatarReais = (valor) =>
  Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Resumo segmentado (002-ledger-segmentado, US2): disponível em destaque e
// cada valor não disponível com explicação e grupo de origem.
function ResumoCarteira({ balances }) {
  const resumo = balances.resumo || {
    total: balances.balance,
    disponivel: balances.available,
    saqueEmAndamento: balances.blockedDebits,
    categorias: {},
  };

  const linhas = [];
  if (Number(resumo.saqueEmAndamento) > 0) {
    linhas.push({ chave: 'saqueEmAndamento', valor: resumo.saqueEmAndamento, porGrupo: [] });
  }
  for (const cat of ORDEM_CATEGORIAS_BLOQUEADAS) {
    const item = resumo.categorias?.[cat];
    if (item && Number(item.valor) !== 0) linhas.push({ chave: cat, valor: item.valor, porGrupo: item.porGrupo || [] });
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="p-5 rounded-lg border border-green-200 bg-green-50">
        <p className="text-sm text-green-800">Saldo disponível</p>
        <p className="text-3xl font-bold text-gray-900">{formatarReais(resumo.disponivel)}</p>
        <p className="text-xs text-gray-600 mt-1">Pode ser usado em grupos ou sacado.</p>
      </div>

      <div className="p-4 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-between">
        <p className="text-sm text-gray-600">Saldo total</p>
        <p className="text-lg font-semibold text-gray-900">{formatarReais(resumo.total)}</p>
      </div>

      {linhas.length > 0 && (
        <section aria-labelledby="valores-nao-disponiveis">
          <h2 id="valores-nao-disponiveis" className="text-sm font-semibold text-gray-700 mb-2">
            Valores que ainda não estão disponíveis
          </h2>
          <ul className="space-y-3">
            {linhas.map((linha) => {
              const info = ROTULOS_CATEGORIAS[linha.chave];
              return (
                <li key={linha.chave} className="p-4 rounded-lg border border-gray-200">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-gray-900">{info?.rotulo || linha.chave}</p>
                    <p className="font-semibold text-gray-900">{formatarReais(linha.valor)}</p>
                  </div>
                  {info?.explicacao && <p className="text-xs text-gray-600 mt-1">{info.explicacao}</p>}
                  {linha.porGrupo.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {linha.porGrupo.map((g) => (
                        <li
                          key={`${g.grupoId}-${g.participacaoId || ''}`}
                          className="flex items-center justify-between text-sm text-gray-700"
                        >
                          <span>{g.grupoNome || 'Grupo removido'}</span>
                          <span>{formatarReais(g.valor)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function WalletHome() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [balances, setBalances] = useState(null);

  useEffect(() => {
    const load = async () => {
      if (!session) return;
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/wallet/balance');
        if (!res.ok) {
          throw new Error((await res.json())?.error || 'Falha ao carregar saldo');
        }
        const data = await res.json();
        setBalances(data);
      } catch (err) {
        setError(err.message || 'Erro ao carregar saldo');
      } finally {
        setLoading(false);
      }
    };
    if (status === 'authenticated') {
      load();
    }
  }, [status, session]);

  return (
    <>
      <Header />
      <main className="pt-28 pb-12 px-4">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Minha carteira</h1>
            <div className="flex gap-2">
              <Link href="/wallet/add" className="px-3 py-2 rounded bg-green-600 text-white hover:bg-green-700 text-sm">
                Adicionar via PIX
              </Link>
              <Link href="/wallet/pay" className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 text-sm">
                Usar saldo
              </Link>
              <Link href="/wallet/withdraw" className="px-3 py-2 rounded bg-purple-600 text-white hover:bg-purple-700 text-sm">
                Sacar
              </Link>
              <Link href="/wallet/invoices" className="px-3 py-2 rounded bg-gray-800 text-white hover:bg-gray-900 text-sm">
                Ver faturas
              </Link>
            </div>
          </div>

          {status === 'loading' && <p className="text-gray-500">Carregando sessão...</p>}
          {status === 'unauthenticated' && <p className="text-red-600">Faça login para ver sua carteira.</p>}
          {loading && <p className="text-gray-500">Atualizando saldo...</p>}
          {error && <p className="text-red-600">{error}</p>}

          {balances && <ResumoCarteira balances={balances} />}
        </div>
      </main>
    </>
  );
}

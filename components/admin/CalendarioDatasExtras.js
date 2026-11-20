import { useCallback, useEffect, useState } from 'react';

const formatarDia = (iso) => {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
};

async function lerJson(res, mensagemPadrao) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || mensagemPadrao);
  return data;
}

export default function CalendarioDatasExtras() {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [novaData, setNovaData] = useState('');
  const [descricao, setDescricao] = useState('');
  const [acao, setAcao] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDados(await lerJson(await fetch(`/api/admin/calendario?ano=${ano}`), 'Erro ao carregar calendario'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [ano]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const incluir = async (e) => {
    e.preventDefault();
    setAcao('incluir');
    setError('');
    setMensagem('');
    try {
      await lerJson(
        await fetch('/api/admin/calendario', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: novaData, descricao }),
        }),
        'Erro ao incluir data'
      );
      setMensagem(`Data ${formatarDia(novaData)} incluida.`);
      setNovaData('');
      setDescricao('');
      await carregar();
    } catch (err) {
      setError(err.message);
    } finally {
      setAcao('');
    }
  };

  const remover = async (data) => {
    setAcao(`remover-${data}`);
    setError('');
    setMensagem('');
    try {
      await lerJson(await fetch(`/api/admin/calendario?data=${encodeURIComponent(data)}`, { method: 'DELETE' }), 'Erro ao remover data');
      setMensagem(`Data ${formatarDia(data)} removida.`);
      await carregar();
    } catch (err) {
      setError(err.message);
    } finally {
      setAcao('');
    }
  };

  return (
    <div className="space-y-4 border-t border-gray-100 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Calendario de dias uteis</h3>
          <p className="text-sm text-gray-600">
            Fins de semana e feriados nacionais ja sao considerados. Cadastre aqui outras datas nao uteis
            (ex.: Carnaval, Corpus Christi, pontes). Prazos ainda nao vencidos passam a considera-las.
          </p>
        </div>
        <label className="text-sm flex items-center gap-2">
          Ano
          <select
            value={ano}
            onChange={(e) => setAno(Number(e.target.value))}
            className="border border-gray-200 rounded px-2 py-1"
          >
            {[anoAtual - 1, anoAtual, anoAtual + 1, anoAtual + 2].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensagem && <p className="text-sm text-green-700">{mensagem}</p>}
      {loading && !dados && <p className="text-sm text-gray-600">Carregando calendario...</p>}

      {dados && (
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-semibold mb-2">Feriados nacionais de {dados.ano}</h4>
            <ul className="text-sm text-gray-700 space-y-1">
              {dados.feriadosNacionais.map((d) => <li key={d}>{formatarDia(d)}</li>)}
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold">Datas extras de {dados.ano}</h4>
            {dados.datasExtras.length === 0 ? (
              <p className="text-sm text-gray-600">Nenhuma data extra cadastrada.</p>
            ) : (
              <ul className="text-sm space-y-2">
                {dados.datasExtras.map((d) => (
                  <li key={d.data} className="flex items-center justify-between gap-3">
                    <span>
                      <strong>{formatarDia(d.data)}</strong> — {d.descricao}
                    </span>
                    <button
                      type="button"
                      onClick={() => remover(d.data)}
                      disabled={Boolean(acao)}
                      className="px-2 py-1 rounded border border-red-200 text-red-700 text-xs hover:bg-red-50 disabled:opacity-50"
                    >
                      {acao === `remover-${d.data}` ? 'Removendo...' : 'Remover'}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={incluir} className="flex flex-wrap items-end gap-2">
              <label className="text-sm flex flex-col">
                Data
                <input
                  type="date"
                  required
                  value={novaData}
                  onChange={(e) => setNovaData(e.target.value)}
                  className="border border-gray-200 rounded px-2 py-1"
                />
              </label>
              <label className="text-sm flex flex-col flex-1 min-w-[160px]">
                Descricao
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  placeholder="Ex.: Carnaval"
                  className="border border-gray-200 rounded px-2 py-1"
                />
              </label>
              <button
                type="submit"
                disabled={Boolean(acao)}
                className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                {acao === 'incluir' ? 'Incluindo...' : 'Incluir'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

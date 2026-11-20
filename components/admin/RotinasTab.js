import { useCallback, useEffect, useState } from 'react';
import CalendarioDatasExtras from './CalendarioDatasExtras';

const RESULTADO_BADGE = {
  sucesso: 'bg-green-100 text-green-700',
  parcial: 'bg-yellow-100 text-yellow-800',
  erro: 'bg-red-100 text-red-700',
};

const SITUACAO_LABEL = { falha: 'Falha (vai retentar)', falha_definitiva: 'Falha definitiva' };

const formatarData = (valor) => (valor ? new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');
const formatarDuracao = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '-');

async function lerJson(res, mensagemPadrao) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || mensagemPadrao);
  return data;
}

function BadgeResultado({ resultado }) {
  if (!resultado) return <span className="text-xs text-gray-500">em andamento</span>;
  return (
    <span className={`text-xs font-semibold rounded px-2 py-1 ${RESULTADO_BADGE[resultado] || 'bg-gray-100 text-gray-700'}`}>
      {resultado}
    </span>
  );
}

function DetalheRotina({ rotinaId, onAtualizar }) {
  const [detalhe, setDetalhe] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [acao, setAcao] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setDetalhe(await lerJson(await fetch(`/api/admin/rotinas/${encodeURIComponent(rotinaId)}`), 'Erro ao carregar rotina'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [rotinaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const reexecutar = async (chave) => {
    setAcao(`item-${chave}`);
    setError('');
    setMensagem('');
    try {
      const data = await lerJson(
        await fetch(`/api/admin/rotinas/${encodeURIComponent(rotinaId)}/reexecutar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chave }),
        }),
        'Erro ao reexecutar item'
      );
      setMensagem(
        data.reprocessado
          ? `Item reexecutado: ${data.situacao}.`
          : `Item nao reprocessado (situacao atual: ${data.situacao}).`
      );
      await carregar();
      onAtualizar();
    } catch (err) {
      setError(err.message);
    } finally {
      setAcao('');
    }
  };

  if (loading && !detalhe) return <p className="text-sm text-gray-600">Carregando detalhe...</p>;
  if (!detalhe) return error ? <p className="text-sm text-red-600">{error}</p> : null;

  return (
    <div className="space-y-4 border-t border-gray-100 pt-4">
      <h3 className="text-lg font-semibold">Detalhe: {detalhe.id}</h3>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensagem && <p className="text-sm text-green-700">{mensagem}</p>}

      <div>
        <h4 className="font-semibold mb-2">Itens com falha ({detalhe.itensComFalha.length})</h4>
        {detalhe.itensComFalha.length === 0 ? (
          <p className="text-sm text-gray-600">Nenhum item com falha.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600 border-b">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2">Situacao</th>
                  <th className="px-3 py-2">Tentativas</th>
                  <th className="px-3 py-2">Ultimo erro</th>
                  <th className="px-3 py-2">Atualizado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {detalhe.itensComFalha.map((item) => (
                  <tr key={item.chave} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2 font-mono text-xs break-all">{item.chave}</td>
                    <td className="px-3 py-2">{SITUACAO_LABEL[item.situacao] || item.situacao}</td>
                    <td className="px-3 py-2">{item.tentativas}</td>
                    <td className="px-3 py-2 text-red-700 max-w-xs break-words">{item.ultimoErro || '-'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatarData(item.atualizadoEm)}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => reexecutar(item.chave)}
                        disabled={Boolean(acao)}
                        className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                      >
                        {acao === `item-${item.chave}` ? 'Reexecutando...' : 'Reexecutar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h4 className="font-semibold mb-2">Historico de execucoes (ultimas {detalhe.execucoes.length})</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-gray-600 border-b">
                <th className="px-3 py-2">Inicio</th>
                <th className="px-3 py-2">Origem</th>
                <th className="px-3 py-2">Resultado</th>
                <th className="px-3 py-2">Duracao</th>
                <th className="px-3 py-2">Proc.</th>
                <th className="px-3 py-2">Ign.</th>
                <th className="px-3 py-2">Falhas</th>
                <th className="px-3 py-2">Pulados</th>
              </tr>
            </thead>
            <tbody>
              {detalhe.execucoes.map((e) => (
                <tr key={e.execucaoId} className="border-b last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">{formatarData(e.inicio)}</td>
                  <td className="px-3 py-2">{e.origem === 'manual' ? `manual (${e.autorId || '-'})` : 'automatica'}</td>
                  <td className="px-3 py-2"><BadgeResultado resultado={e.resultado} /></td>
                  <td className="px-3 py-2">{formatarDuracao(e.duracaoMs)}</td>
                  <td className="px-3 py-2">{e.processados}</td>
                  <td className="px-3 py-2">{e.ignorados}</td>
                  <td className="px-3 py-2">{e.falhas}</td>
                  <td className="px-3 py-2">{e.pulados}</td>
                </tr>
              ))}
              {detalhe.execucoes.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-gray-600" colSpan={8}>Nenhuma execucao registrada.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function RotinasTab({ allowed }) {
  const [rotinas, setRotinas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [selecionada, setSelecionada] = useState('');
  const [executando, setExecutando] = useState('');
  const [versaoDetalhe, setVersaoDetalhe] = useState(0);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRotinas(await lerJson(await fetch('/api/admin/rotinas'), 'Erro ao carregar rotinas'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) carregar();
  }, [allowed, carregar]);

  const executarAgora = async (id) => {
    setExecutando(id);
    setError('');
    setMensagem('');
    try {
      const data = await lerJson(
        await fetch(`/api/admin/rotinas/${encodeURIComponent(id)}/executar`, { method: 'POST' }),
        'Erro ao executar rotina'
      );
      setMensagem(`Rotina ${id}: ${data.resultado} — ${data.processados} processados, ${data.falhas} falhas, ${data.pulados} pulados.`);
      await carregar();
      setVersaoDetalhe((v) => v + 1);
    } catch (err) {
      setError(err.message);
    } finally {
      setExecutando('');
    }
  };

  if (!allowed) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Rotinas agendadas</h2>
        <button
          type="button"
          onClick={carregar}
          disabled={loading}
          className="px-3 py-1 rounded border border-gray-200 bg-gray-50 text-sm hover:bg-gray-100 disabled:opacity-50"
        >
          {loading ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {mensagem && <p className="text-sm text-green-700">{mensagem}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600 border-b">
              <th className="px-3 py-2">Rotina</th>
              <th className="px-3 py-2">Ultima execucao</th>
              <th className="px-3 py-2">Resultado</th>
              <th className="px-3 py-2">Duracao</th>
              <th className="px-3 py-2">Proc. / Falhas</th>
              <th className="px-3 py-2">Itens em falha</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rotinas.map((r) => (
              <tr key={r.id} className={`border-b last:border-0 ${selecionada === r.id ? 'bg-blue-50' : ''}`}>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => setSelecionada(r.id)} className="text-blue-600 hover:underline font-semibold">
                    {r.id}
                  </button>
                  <p className="text-xs text-gray-600">{r.descricao}</p>
                  {!r.ativa && <p className="text-xs text-gray-500">inativa</p>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatarData(r.ultimaExecucao?.inicio)}</td>
                <td className="px-3 py-2">{r.ultimaExecucao ? <BadgeResultado resultado={r.ultimaExecucao.resultado} /> : '-'}</td>
                <td className="px-3 py-2">{formatarDuracao(r.ultimaExecucao?.duracaoMs)}</td>
                <td className="px-3 py-2">
                  {r.ultimaExecucao ? `${r.ultimaExecucao.processados} / ${r.ultimaExecucao.falhas}` : '-'}
                </td>
                <td className="px-3 py-2">
                  <span className={r.itensFalhaDefinitiva > 0 ? 'text-red-700 font-semibold' : ''}>
                    {r.itensFalhaDefinitiva} definitiva(s)
                  </span>
                  <span className="text-gray-600"> · {r.itensEmFalha} retentando</span>
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() => executarAgora(r.id)}
                    disabled={Boolean(executando)}
                    className="px-3 py-1 rounded bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                  >
                    {executando === r.id ? 'Executando...' : 'Executar agora'}
                  </button>
                </td>
              </tr>
            ))}
            {!loading && rotinas.length === 0 && (
              <tr>
                <td className="px-3 py-4 text-gray-600" colSpan={7}>Nenhuma rotina registrada.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selecionada && <DetalheRotina key={`${selecionada}-${versaoDetalhe}`} rotinaId={selecionada} onAtualizar={carregar} />}

      <CalendarioDatasExtras />
    </div>
  );
}

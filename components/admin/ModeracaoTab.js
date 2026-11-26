// Aba "Moderação" do /admin (005-aprovacao-grupos, US2/US3/US5 · FR-008, FR-009, FR-027).
// Duas visões: grupos em aprovação (mais antigos primeiro, com prazo restante) e grupos
// aprovados automaticamente aguardando revisão posterior. Suporte só lê; decisões só para
// o admin do sistema (`podeDecidir`, conferido também no servidor).
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

const VISOES = [
  { id: 'pendentes', label: 'Em aprovação', contagem: 'pendentes' },
  { id: 'revisao', label: 'Revisão posterior', contagem: 'revisao' },
  { id: 'aprovados', label: 'Aprovados', contagem: null },
];

// Ações por visão; `texto` = exige motivo/pendências.
const ACOES = {
  pendentes: [
    { id: 'aprovar', label: 'Aprovar', estilo: 'bg-green-600 hover:bg-green-700', confirmar: 'Aprovar e publicar este grupo?' },
    { id: 'pedir_ajuste', label: 'Pedir ajuste', estilo: 'bg-yellow-600 hover:bg-yellow-700', texto: 'Pendências que o dono deve corrigir' },
    { id: 'rejeitar', label: 'Rejeitar', estilo: 'bg-red-600 hover:bg-red-700', texto: 'Motivo da rejeição (definitiva)' },
  ],
  revisao: [
    { id: 'confirmar_revisao', label: 'Confirmar revisão', estilo: 'bg-green-600 hover:bg-green-700', confirmar: 'Confirmar a revisão? O repasse volta à regra normal.' },
    { id: 'reprovar_revisao', label: 'Reprovar (cancelar grupo)', estilo: 'bg-red-600 hover:bg-red-700', texto: 'Motivo da reprovação (o grupo será cancelado e os membros avisados)' },
    { id: 'cancelar', label: 'Cancelar pelo Cotea', estilo: 'bg-gray-700 hover:bg-gray-800', texto: 'Motivo do cancelamento (fraude, denúncia...). O grupo sai do ar e os membros são avisados' },
  ],
  aprovados: [
    { id: 'cancelar', label: 'Cancelar pelo Cotea', estilo: 'bg-gray-700 hover:bg-gray-800', texto: 'Motivo do cancelamento (fraude, denúncia...). O grupo sai do ar e os membros são avisados' },
  ],
};

const ROTULO_ACAO_HISTORICO = {
  enviado: 'Enviado para aprovação',
  migrado: 'Migrado (grupo anterior à moderação)',
  aprovar: 'Aprovado',
  aprovar_automatico: 'Aprovado automaticamente',
  pedir_ajuste: 'Ajuste pedido',
  reenviar: 'Reenviado',
  rejeitar: 'Rejeitado',
  confirmar_revisao: 'Revisão confirmada',
  reprovar_revisao: 'Revisão reprovada',
  cancelar: 'Cancelado pelo Cotea',
  desistir: 'Dono desistiu',
  encerrar: 'Encerrado pelo dono',
};

const formatarData = (valor) => (valor ? new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '-');
const reais = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-');

function prazoRestante(venceEm) {
  if (!venceEm) return null;
  const ms = new Date(venceEm).getTime() - Date.now();
  if (ms <= 0) return 'prazo vencido — aprovação automática na próxima execução da rotina';
  const horas = Math.floor(ms / 3_600_000);
  if (horas >= 24) return `vence em ${Math.floor(horas / 24)} d ${horas % 24} h (${formatarData(venceEm)})`;
  return `vence em ${horas} h (${formatarData(venceEm)})`;
}

function CartaoGrupo({ item, visao, podeDecidir, onDecidido }) {
  const [acaoAberta, setAcaoAberta] = useState(null);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const decidir = async (acao) => {
    setEnviando(true);
    setErro('');
    try {
      const res = await fetch(`/api/admin/grupos/${item._id}/moderacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: acao.id, texto: acao.texto ? texto : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Erro ao registrar a decisão');
      setAcaoAberta(null);
      setTexto('');
      onDecidido(data?.message || 'Decisão registrada');
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const prazo = visao === 'pendentes' ? prazoRestante(item.venceEm) : null;
  const historico = item.moderacao?.historico || [];

  return (
    <li className="border rounded-lg p-4 bg-white space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900">{item.nome}</h3>
          <p className="text-xs text-gray-500">
            {item.categoria} · envio {item.moderacao?.envio ?? '-'} em {formatarData(item.moderacao?.enviadoEm)}
            {visao === 'revisao' && ` · aprovado automaticamente em ${formatarData(item.moderacao?.aprovacao?.em)}`}
          </p>
          {prazo && <p className="text-xs font-medium text-orange-700">{prazo}</p>}
        </div>
        <Link href={`/grupos/${item._id}`} className="text-sm text-blue-600 hover:underline">Ver página do grupo</Link>
      </div>

      {item.necessitaAnalise && (
        <p className="text-xs font-semibold text-red-700 bg-red-50 rounded px-2 py-1 inline-block">Sinalizado para análise de risco</p>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline text-gray-500">Dono: </dt><dd className="inline">{item.dono?.nome} {item.dono?.email ? `(${item.dono.email})` : ''}</dd></div>
        <div><dt className="inline text-gray-500">Acesso: </dt><dd className="inline">{item.acesso || '-'}</dd></div>
        <div><dt className="inline text-gray-500">Valor total: </dt><dd className="inline">{reais(item.valorTotal)}</dd></div>
        <div><dt className="inline text-gray-500">Capacidade: </dt><dd className="inline">{item.capacidadeTotal ?? '-'}</dd></div>
        <div><dt className="inline text-gray-500">Membro paga: </dt><dd className="inline">{reais(item.valorPorVaga)} (dono {reais(item.repassePorVaga)} + taxa {reais(item.taxaPorVaga)})</dd></div>
        <div className="truncate">
          <dt className="inline text-gray-500">Link oficial: </dt>
          <dd className="inline">
            {item.linkOficial ? <a href={item.linkOficial} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{item.linkOficial}</a> : '-'}
          </dd>
        </div>
      </dl>
      {item.subtitulo && <p className="text-sm text-gray-800">{item.subtitulo}</p>}
      {item.descricao && <p className="text-sm text-gray-700 whitespace-pre-line">{item.descricao}</p>}
      {item.observacoesInternas && (
        <p className="text-sm text-gray-700 bg-gray-50 rounded p-2"><span className="font-medium">Observações internas: </span>{item.observacoesInternas}</p>
      )}

      {historico.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-600">Histórico de moderação ({historico.length})</summary>
          <ul className="mt-2 space-y-1">
            {historico.map((h, i) => (
              <li key={`${h.acao}-${i}`} className="text-gray-700">
                {formatarData(h.em)} — {ROTULO_ACAO_HISTORICO[h.acao] || h.acao}
                {h.automatico ? ' (automático)' : ''}
                {h.texto ? `: ${h.texto}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      {podeDecidir ? (
        <div className="space-y-2">
          {!acaoAberta && (
            <div className="flex flex-wrap gap-2">
              {ACOES[visao].map((acao) => (
                <button
                  key={acao.id}
                  type="button"
                  onClick={() => { setAcaoAberta(acao); setTexto(''); setErro(''); }}
                  className={`px-3 py-2 rounded text-white text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-offset-2 ${acao.estilo}`}
                >
                  {acao.label}
                </button>
              ))}
            </div>
          )}
          {acaoAberta && (
            <div className="border rounded p-3 bg-gray-50 space-y-2">
              {acaoAberta.texto ? (
                <>
                  <label htmlFor={`texto-${item._id}`} className="text-sm font-medium text-gray-800">{acaoAberta.texto}</label>
                  <textarea
                    id={`texto-${item._id}`}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    maxLength={1000}
                    rows={3}
                    className="w-full border rounded p-2 text-sm"
                  />
                  <p className="text-xs text-gray-500">{texto.length}/1000 — o dono verá este texto.</p>
                </>
              ) : (
                <p className="text-sm text-gray-800">{acaoAberta.confirmar}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={enviando || (acaoAberta.texto && !texto.trim())}
                  onClick={() => decidir(acaoAberta)}
                  className={`px-3 py-2 rounded text-white text-sm font-semibold disabled:opacity-50 ${acaoAberta.estilo}`}
                >
                  {enviando ? 'Enviando...' : `Confirmar: ${acaoAberta.label}`}
                </button>
                <button
                  type="button"
                  disabled={enviando}
                  onClick={() => setAcaoAberta(null)}
                  className="px-3 py-2 rounded bg-gray-200 text-gray-700 text-sm font-semibold hover:bg-gray-300 disabled:opacity-50"
                >
                  Voltar
                </button>
              </div>
            </div>
          )}
          {erro && <p className="text-sm text-red-600" role="alert">{erro}</p>}
        </div>
      ) : (
        <p className="text-xs text-gray-500">Somente o admin do sistema pode decidir. Você tem acesso de leitura.</p>
      )}
    </li>
  );
}

export default function ModeracaoTab({ allowed, onContagens = () => {} }) {
  const [visao, setVisao] = useState('pendentes');
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');

  // Só a resposta do pedido mais recente vale: trocar de visão rápido não pode deixar a
  // lista de uma visão com as ações de outra (achado na validação T048).
  const ultimoPedido = useRef(0);
  const carregar = useCallback(async () => {
    const pedido = ++ultimoPedido.current;
    setLoading(true);
    setErro('');
    try {
      const res = await fetch(`/api/admin/moderacao?visao=${visao}`);
      const data = await res.json().catch(() => ({}));
      if (pedido !== ultimoPedido.current) return;
      if (!res.ok) throw new Error(data?.error || 'Erro ao carregar a fila');
      setDados({ ...data, visao });
      onContagens(data.contagens);
    } catch (err) {
      if (pedido === ultimoPedido.current) setErro(err.message);
    } finally {
      if (pedido === ultimoPedido.current) setLoading(false);
    }
  }, [visao, onContagens]);

  useEffect(() => {
    if (allowed) carregar();
  }, [allowed, carregar]);

  if (!allowed) return null;

  const contagens = dados?.contagens || { pendentes: 0, revisao: 0 };
  // Itens só da visão atual (nunca de uma resposta de outra visão).
  const itens = dados?.visao === visao ? dados.itens : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Moderação de grupos</h2>
        <button type="button" onClick={carregar} className="text-sm text-blue-600 hover:underline">Atualizar</button>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Visões da fila de moderação">
        {VISOES.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={visao === v.id}
            onClick={() => { if (v.id !== visao) { setVisao(v.id); setDados((d) => (d ? { ...d, itens: [] , visao: null } : d)); } setMensagem(''); }}
            className={`px-3 py-2 rounded text-sm font-semibold ${visao === v.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {v.label}{v.contagem ? ` (${contagens[v.contagem] ?? 0})` : ''}
          </button>
        ))}
      </div>

      {mensagem && <p className="text-sm text-green-700" role="status">{mensagem}</p>}
      {erro && <p className="text-sm text-red-600" role="alert">{erro}</p>}
      {loading && <p className="text-sm text-gray-500">Carregando...</p>}

      {!loading && dados?.visao === visao && itens.length === 0 && (
        <p className="text-sm text-gray-600 bg-gray-50 rounded p-4">
          {{ pendentes: 'Nenhum grupo aguardando aprovação.', revisao: 'Nenhum grupo aprovado automaticamente aguardando revisão.', aprovados: 'Nenhum grupo aprovado.' }[visao]}
        </p>
      )}

      {itens.length > 0 && (
        <ul className="space-y-3">
          {itens.map((item) => (
            <CartaoGrupo
              key={item._id}
              item={item}
              visao={visao}
              podeDecidir={dados.podeDecidir}
              onDecidido={(msg) => { setMensagem(msg); carregar(); }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// Checkout v2 (006-checkout-caucao): mostra o resumo calculado no servidor, exige o aceite
// das regras da caução e confirma a entrada. Saldo primeiro; o Pix cobre só a diferença.
// A tela não calcula nem envia valores para cobrança. Ver
// sdd/specs/006-checkout-caucao/contracts/api-entrada.md ("Telas").
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Header from '../../components/Header';
import FlowStepper from '../../components/FlowStepper';
import { NOTA_TAXA_COTEA } from '../../components/PrevisaoPreco';
import CadastroFinanceiroForm, { ehCadastroIncompleto } from '../../components/CadastroFinanceiroForm';
import { VINCULOS, rotuloVinculo } from '../../lib/checkout';

const primeiro = (valor) => (Array.isArray(valor) ? valor[0] : valor) || '';
const reais = (valor) => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;

// Chave de idempotência da confirmação: repetir o mesmo pedido não cobra de novo.
const novaChave = () => (typeof window !== 'undefined' && window.crypto?.randomUUID
  ? window.crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

const AVISO_PIX_NO_SALDO = 'O valor do Pix está no seu saldo.';

export default function Pagamento() {
  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const grupoId = primeiro(router.query.grupoId);
  const nome = primeiro(router.query.nome);
  const vinculo = primeiro(router.query.vinculo);
  const vinculoValido = VINCULOS.some((v) => v.id === vinculo);

  const [grupoNome, setGrupoNome] = useState('');
  const [resumo, setResumo] = useState(null);
  const [recusa, setRecusa] = useState(null); // motivo que impede a entrada
  const [carregando, setCarregando] = useState(true);
  const [aceito, setAceito] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');
  // 004-cadastro-financeiro (US3): pendências devolvidas por pay/pix abrem o formulário embutido.
  const [pendenciasCadastro, setPendenciasCadastro] = useState(null);
  const chaveRef = useRef('');

  const voltarAoRelacionamento = useCallback(() => {
    const query = new URLSearchParams();
    if (grupoId) query.append('grupoId', grupoId);
    if (nome) query.append('nome', nome);
    router.replace(`/assinatura/relacionamento?${query.toString()}`);
  }, [router, grupoId, nome]);

  const carregarResumo = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch(`/api/assinaturas/resumo?grupoId=${encodeURIComponent(grupoId)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResumo(null);
        setRecusa({ codigo: data?.codigo, error: data?.error || 'Não foi possível carregar o resumo.' });
        return;
      }
      setRecusa(null);
      setGrupoNome(data.grupo?.nome || '');
      setResumo(data.resumo);
    } catch {
      setRecusa({ error: 'Não foi possível carregar o resumo. Verifique sua conexão e recarregue a página.' });
    } finally {
      setCarregando(false);
    }
  }, [grupoId]);

  useEffect(() => {
    if (!router.isReady) return;
    if (!grupoId) {
      setCarregando(false);
      setRecusa({ error: 'Grupo não identificado. Volte e escolha o grupo novamente.' });
      return;
    }
    if (!vinculoValido) {
      voltarAoRelacionamento();
      return;
    }
    if (sessionStatus === 'unauthenticated') {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(router.asPath || '/')}`);
      return;
    }
    if (sessionStatus === 'authenticated') carregarResumo();
    // `router` muda a cada navegação; o que importa aqui são os parâmetros.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, grupoId, vinculoValido, sessionStatus]);

  const chamarApi = async (url, corpo) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  };

  const confirmarEntrada = (base, saldoVisto) => chamarApi('/api/assinaturas/pay', {
    grupoId,
    chave: chaveRef.current,
    vinculo,
    aceiteRegras: { versao: base.regras.versao },
    versaoResumo: base.versaoResumo,
    saldoVisto,
  });

  /** Deposita a diferença no saldo (Pix simulado). Devolve o novo disponível. */
  const pagarPix = async (valor) => {
    const criado = await chamarApi('/api/pix/simulated/create', { amount: valor });
    if (!criado.ok) return { ok: false, data: criado.data };
    const confirmado = await chamarApi('/api/pix/simulated/confirm', { paymentId: criado.data.paymentId });
    if (!confirmado.ok) return { ok: false, data: confirmado.data };
    return { ok: true, disponivel: confirmado.data.available };
  };

  const tratarRecusa = async (data, pixCreditado) => {
    const complemento = pixCreditado ? ` ${AVISO_PIX_NO_SALDO}` : '';
    if (ehCadastroIncompleto(data)) {
      setPendenciasCadastro(data.pendencias);
      return;
    }
    if (data?.codigo === 'resumo_desatualizado' || data?.codigo === 'saldo_insuficiente') {
      if (data.resumo?.regras?.versao !== resumo.regras.versao) setAceito(false);
      if (data.resumo) setResumo(data.resumo);
      setErro(`Os valores ou o seu saldo mudaram. Confira o resumo e confirme novamente.${complemento}`);
      return;
    }
    if (data?.codigo === 'vinculo_invalido') {
      voltarAoRelacionamento();
      return;
    }
    // A chave não serve mais: a próxima confirmação é uma cobrança nova.
    if (data?.codigo === 'confirmacao_ja_utilizada') chaveRef.current = '';
    if (data?.codigo === 'aceite_obrigatorio') setAceito(false);
    setErro(`${data?.error || 'Não foi possível concluir a entrada.'}${complemento}`);
    await carregarResumo();
  };

  const handleFinalizar = async () => {
    if (!resumo || processando) return;
    if (!aceito) {
      setErro('Para continuar, aceite as regras da caução.');
      return;
    }
    setErro('');
    setMensagem('');
    setProcessando(true);
    if (!chaveRef.current) chaveRef.current = novaChave();

    let pixCreditado = false;
    try {
      let resposta = await confirmarEntrada(resumo, resumo.saldoDisponivel);

      // O servidor confirmou que o resumo é o atual e falta saldo: Pix da diferença.
      if (!resposta.ok && resposta.data?.codigo === 'saldo_insuficiente') {
        const atual = resposta.data.resumo;
        setResumo(atual);
        setMensagem('Gerando o Pix e creditando no seu saldo...');
        const pix = await pagarPix(atual.valorPix);
        if (!pix.ok) {
          await tratarRecusa(pix.data, false);
          return;
        }
        pixCreditado = true;
        setMensagem('Registrando sua entrada no grupo...');
        resposta = await confirmarEntrada(atual, pix.disponivel);
      }

      if (!resposta.ok) {
        await tratarRecusa(resposta.data, pixCreditado);
        return;
      }

      const query = new URLSearchParams({ grupoId });
      if (nome || grupoNome) query.append('nome', grupoNome || nome);
      if (resumo.retemMensalidade) query.append('aguardandoLotar', '1');
      router.push(`/assinatura/sucesso?${query.toString()}`);
    } catch {
      // Falha de rede: a chave é mantida, então repetir não cobra duas vezes.
      setErro(`Não foi possível confirmar agora. Tente de novo: a mesma confirmação não é cobrada duas vezes.${pixCreditado ? ` ${AVISO_PIX_NO_SALDO}` : ''}`);
    } finally {
      setProcessando(false);
      setMensagem('');
    }
  };

  const podeFinalizar = Boolean(resumo) && aceito && !processando;

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50 text-gray-900 px-4 pb-36 md:pb-24 pt-[110px]">
        <div className="max-w-4xl mx-auto space-y-6">
          <FlowStepper currentStep={2} steps={['Relacionamento', 'Pagamento', 'Sucesso']} />

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold">Pagamento</h1>
            <p className="text-gray-600 text-sm">Confira o que você paga hoje antes de entrar no grupo.</p>
            {vinculoValido && (
              <p className="text-gray-600 text-sm">
                Vínculo declarado: <strong>{rotuloVinculo(vinculo)}</strong>{' '}
                <button type="button" onClick={voltarAoRelacionamento} className="text-blue-600 font-semibold hover:underline">
                  Alterar
                </button>
              </p>
            )}
          </div>

          {carregando && !resumo && <p className="text-sm text-gray-600">Carregando o resumo...</p>}

          {recusa && (
            <section className="bg-white border border-amber-200 rounded-2xl shadow-sm p-5 space-y-3">
              <p className="text-sm text-amber-800">{recusa.error}</p>
              {grupoId && (
                <Link href={`/grupos/${grupoId}`} className="inline-block text-blue-700 font-semibold text-sm hover:underline">
                  Ver o grupo
                </Link>
              )}
            </section>
          )}

          {resumo && (
            <>
              <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-3">
                <p className="text-xs uppercase tracking-wide text-gray-500">Resumo</p>
                <p className="text-lg font-semibold">{grupoNome || nome || 'Grupo'}</p>
                <dl className="space-y-2 text-sm">
                  <Linha rotulo={`Mensalidade (${NOTA_TAXA_COTEA})`} valor={reais(resumo.mensalidade)} />
                  <Linha rotulo="Caução (1 mensalidade, devolvida conforme as regras abaixo)" valor={reais(resumo.caucao)} />
                  {resumo.taxa > 0 && <Linha rotulo="Taxa do meio de pagamento" valor={reais(resumo.taxa)} />}
                  <div className="border-t border-gray-100 pt-2">
                    <Linha rotulo="Total de hoje" valor={reais(resumo.total)} destaque />
                  </div>
                  <Linha rotulo={`Do seu saldo (disponível: ${reais(resumo.saldoDisponivel)})`} valor={reais(resumo.valorSaldo)} />
                  <Linha rotulo="No Pix" valor={reais(resumo.valorPix)} />
                </dl>
                {resumo.valorPix > 0 && (
                  <p className="text-xs text-gray-600">O Pix é gerado com o CPF do seu cadastro financeiro e entra no seu saldo antes da cobrança.</p>
                )}
              </section>

              {resumo.retemMensalidade && (
                <section className="bg-amber-50 border border-amber-200 rounded-2xl p-5 text-sm text-amber-900 space-y-1">
                  <p className="font-semibold">Este grupo só libera o acesso depois de lotar.</p>
                  <p>Sua mensalidade fica retida até lá. Se você sair, ou o grupo acabar, antes de lotar, tudo o que você pagou volta para o seu saldo.</p>
                </section>
              )}

              <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-2 text-sm text-gray-700">
                <p className="font-semibold text-gray-900">Vencimento e acesso</p>
                <p>
                  A mensalidade é mensal e conta a partir do envio do acesso: o próximo vencimento é no mesmo dia do mês
                  seguinte (se esse dia não existir, no último dia do mês), no horário de Brasília.
                </p>
                <p>
                  O dono tem até 5 dias corridos para enviar o acesso, contados {resumo.retemMensalidade ? 'de quando o grupo lotar' : 'da sua entrada'}.
                </p>
                {resumo.fidelidadeMeses > 0 && (
                  <p>
                    Fidelidade deste grupo: {resumo.fidelidadeMeses} {resumo.fidelidadeMeses === 1 ? 'mês' : 'meses'}, a partir do envio do acesso.
                  </p>
                )}
              </section>

              <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-3">
                <p className="font-semibold text-gray-900">Regras da caução</p>
                <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
                  {resumo.regras.itens.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <label className="flex items-start gap-3 border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-blue-300 transition">
                  <input
                    type="checkbox"
                    className="mt-1 w-5 h-5 accent-blue-600"
                    checked={aceito}
                    onChange={() => {
                      setAceito((v) => !v);
                      setErro('');
                    }}
                  />
                  <span className="text-sm text-gray-800">Li e aceito as regras da caução.</span>
                </label>
              </section>
            </>
          )}

          {pendenciasCadastro && (
            <CadastroFinanceiroForm
              pendencias={pendenciasCadastro}
              onCancelar={() => setPendenciasCadastro(null)}
              onSalvo={() => {
                setPendenciasCadastro(null);
                handleFinalizar();
              }}
            />
          )}
          {erro && <p role="alert" className="text-sm text-red-600">{erro}</p>}
          {mensagem && <p className="text-sm text-blue-700">{mensagem}</p>}
        </div>

        <div className="fixed bottom-0 left-0 right-0 md:static md:max-w-4xl md:mx-auto md:mt-8">
          <div className="bg-white border-t md:border border-gray-200 shadow-2xl md:shadow-sm px-4 py-4 md:rounded-2xl flex flex-col md:flex-row items-center md:items-stretch gap-3">
            <div className="flex-1 w-full">
              <p className="text-xs text-gray-500">Total de hoje</p>
              <p className="text-lg font-bold text-gray-900">{resumo ? reais(resumo.total) : '—'}</p>
              <p className="text-xs text-gray-600">{resumo && !aceito ? 'Aceite as regras da caução para continuar.' : 'Transação segura criptografada.'}</p>
            </div>
            <button
              type="button"
              onClick={handleFinalizar}
              disabled={!podeFinalizar}
              className={`w-full md:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold shadow-lg transition ${
                podeFinalizar ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-300 text-gray-600 cursor-not-allowed'
              }`}
            >
              <i className="fa fa-lock" aria-hidden="true"></i>
              {processando ? 'Processando...' : 'Finalizar pagamento'}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

function Linha({ rotulo, valor, destaque = false }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className={destaque ? 'font-semibold text-gray-900' : 'text-gray-600'}>{rotulo}</dt>
      <dd className={`whitespace-nowrap ${destaque ? 'text-xl font-bold' : 'font-semibold'}`}>{valor}</dd>
    </div>
  );
}

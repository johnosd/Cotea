import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Header from '../../components/Header';
import FlowStepper from '../../components/FlowStepper';

export default function Pagamento() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { grupoId, nome, preco, userId } = router.query;
  const [metodo, setMetodo] = useState('saldo');
  const [mostrarCupom, setMostrarCupom] = useState(false);
  const [cpfPix, setCpfPix] = useState('');
  const [cpfTouched, setCpfTouched] = useState(false);
  const [erroCpf, setErroCpf] = useState('');
  const [saldo, setSaldo] = useState(null);
  const [saldoErro, setSaldoErro] = useState('');
  const [saldoCarregando, setSaldoCarregando] = useState(false);
  const [processando, setProcessando] = useState(false);
  const [erroPagamento, setErroPagamento] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const grupoNome = nome || 'Grupo';
  const precoNumero = useMemo(() => {
    const n = Number(preco);
    return Number.isFinite(n) && n > 0 ? n : 35;
  }, [preco]);
  const saldoFormatado = useMemo(() => {
    if (saldo === null) return saldoCarregando ? 'Carregando...' : 'Indisponivel';
    return `R$ ${saldo.toFixed(2)}`;
  }, [saldo, saldoCarregando]);
  const saldoSuficiente = saldo !== null ? saldo >= precoNumero : false;
  const metodos = useMemo(
    () => [
      {
        id: 'saldo',
        titulo: 'Saldo disponivel',
        valor: saldoFormatado,
        badge: saldoCarregando ? 'Carregando...' : saldoSuficiente ? 'Sem taxas' : 'Saldo insuficiente',
        taxa: 0,
        disabled: !saldoSuficiente,
      },
      {
        id: 'pix',
        titulo: 'Pix - rapido e sem complicacoes',
        valor: `R$ ${(precoNumero + 0.68).toFixed(2)}`,
        badge: '+ R$ 0,68 (taxa)',
        taxa: 0.68,
        icon: 'fa-bolt',
        disabled: false,
      },
    ],
    [precoNumero, saldoFormatado, saldoCarregando, saldoSuficiente]
  );

  const sessionUserId =
    session?.user?.id || session?.user?._id || session?.user?.sub || session?.user?.userId || session?.user?.uid || '';

  // Limpa validacao se sair do Pix
  useEffect(() => {
    if (metodo !== 'pix') {
      setErroCpf('');
      setCpfTouched(false);
    }
  }, [metodo]);

  useEffect(() => {
    if (metodo === 'saldo' && !saldoCarregando && !saldoSuficiente) {
      setMetodo('pix');
    }
  }, [metodo, saldoCarregando, saldoSuficiente]);

  // Carrega saldo real da carteira
  useEffect(() => {
    const carregarSaldo = async () => {
      setSaldoCarregando(true);
      setSaldoErro('');
      try {
        const res = await fetch('/api/wallet/balance');
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Erro ao carregar saldo');
        const disponivel = Number(data?.available ?? data?.balance ?? 0);
        setSaldo(Number.isFinite(disponivel) ? disponivel : 0);
      } catch (error) {
        setSaldoErro(error?.message || 'Erro ao carregar saldo');
      } finally {
        setSaldoCarregando(false);
      }
    };
    if (session?.user) {
      carregarSaldo();
    }
  }, [session]);

  const validarCpf = (cpf) => {
    if (!cpf) return false;
    const num = cpf.replace(/\D/g, '');
    if (num.length !== 11 || /^(\d)\1{10}$/.test(num)) return false;
    const calc = (base) => {
      let sum = 0;
      for (let i = 0; i < base.length; i += 1) {
        sum += Number(num[i]) * (base.length + 1 - i);
      }
      const mod = (sum * 10) % 11;
      return mod === 10 ? 0 : mod;
    };
    return calc('123456789') === Number(num[9]) && calc('1234567890') === Number(num[10]);
  };

  const atualizarErroCpf = (valor, touched) => {
    if (metodo !== 'pix') {
      setErroCpf('');
      return;
    }
    if (!touched) {
      setErroCpf('');
      return;
    }
    if (!valor) {
      setErroCpf('Informe o CPF para pagar via Pix.');
      return;
    }
    if (valor.length !== 11) {
      setErroCpf('CPF deve ter 11 digitos.');
      return;
    }
    if (!validarCpf(valor)) {
      setErroCpf('CPF invalido.');
      return;
    }
    setErroCpf('');
  };

  const cpfValido = metodo === 'pix' ? (cpfPix.length === 11 && validarCpf(cpfPix)) : true;
  const podeFinalizar = metodo === 'saldo' || cpfValido;

  const pagarFaturaAssinatura = async (invoiceIdAtual) => {
    const payload = {
      grupoId,
      amount: precoNumero,
      ...(invoiceIdAtual ? { invoiceId: invoiceIdAtual } : {}),
    };
    const res = await fetch('/api/assinaturas/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Erro ao processar pagamento');
    }
    if (data?.invoiceId) setInvoiceId(data.invoiceId);
    return data;
  };

  const confirmarPix = async (valor, cpf) => {
    const createRes = await fetch('/api/pix/simulated/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: valor, cpf }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      throw new Error(createData?.error || 'Erro ao gerar pagamento Pix');
    }
    const confirmRes = await fetch('/api/pix/simulated/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId: createData.paymentId }),
    });
    const confirmData = await confirmRes.json();
    if (!confirmRes.ok) {
      throw new Error(confirmData?.error || 'Erro ao creditar Pix');
    }
    return confirmData;
  };

  const registrarEntradaNoGrupo = async (invoiceIdAtual) => {
    const res = await fetch(`/api/grupos/${grupoId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId: invoiceIdAtual }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || 'Erro ao registrar sua entrada no grupo');
    }
    return data;
  };

  const handleFinalizar = async () => {
    if (sessionStatus !== 'authenticated' || !sessionUserId) {
      const callbackUrl = encodeURIComponent(router.asPath || router.pathname || '/');
      router.push(`/auth/signin?callbackUrl=${callbackUrl}`);
      return;
    }
    if (!grupoId) {
      setErroPagamento('Grupo nao identificado. Volte e tente novamente.');
      return;
    }
    if (metodo === 'pix' && !cpfValido) {
      setCpfTouched(true);
      atualizarErroCpf(cpfPix, true);
      return;
    }

    setErroPagamento('');
    setErroCpf('');
    setMensagem('');
    setProcessando(true);

    let pagamento = null;
    try {
      pagamento = await pagarFaturaAssinatura(invoiceId || undefined);

      // Se saldo for insuficiente, direciona para Pix
      if (pagamento.status === 'aguardando_recarga') {
        setInvoiceId(pagamento.invoiceId);
        if (metodo !== 'pix') {
          setErroPagamento('Saldo insuficiente. Selecione Pix para recarregar e concluir o pagamento.');
          setMetodo('pix');
          setProcessando(false);
          return;
        }
        const faltante = Number(pagamento.faltante || precoNumero);
        const valorPix = (Number.isFinite(faltante) ? faltante : precoNumero) + 0.68;
        setMensagem('Gerando Pix e creditando saldo...');
        await confirmarPix(valorPix, cpfPix);
        pagamento = await pagarFaturaAssinatura(pagamento.invoiceId);
      }

      if (pagamento.status !== 'paga') {
        throw new Error('Nao foi possivel concluir o pagamento. Tente novamente.');
      }

      setMensagem('Registrando sua entrada no grupo...');
      await registrarEntradaNoGrupo(pagamento.invoiceId);

      const query = new URLSearchParams();
      if (grupoId) query.append('grupoId', grupoId);
      if (nome) query.append('nome', nome);
      if (precoNumero) query.append('preco', String(precoNumero));
      if (pagamento.invoiceId) query.append('invoiceId', pagamento.invoiceId);

      router.push(`/assinatura/sucesso${query.toString() ? `?${query.toString()}` : ''}`);
    } catch (error) {
      // Se pagamento concluiu mas join falhou, tenta estornar
      if (pagamento?.status === 'paga' && pagamento?.invoiceId) {
        try {
          const refundRes = await fetch('/api/assinaturas/refund', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoiceId: pagamento.invoiceId }),
          });
          if (!refundRes.ok) {
            const data = await refundRes.json();
            throw new Error(data?.error || 'Erro ao estornar pagamento');
          }
          setErroPagamento('Pagamento estornado porque nao foi possivel registrar sua entrada. Nenhum valor foi cobrado.');
        } catch (refundErr) {
          setErroPagamento(refundErr?.message || 'Pagamento feito, mas nao foi possivel registrar entrada ou estornar automaticamente. Abra um chamado.');
        } finally {
          setProcessando(false);
          setMensagem('');
        }
        return;
      }
      setErroPagamento(error?.message || 'Erro ao processar pagamento');
    } finally {
      setProcessando(false);
      setMensagem('');
    }
  };

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50 text-gray-900 px-4 pb-24 pt-[110px]">
        <div className="max-w-4xl mx-auto space-y-6">
          <FlowStepper currentStep={2} steps={['Relacionamento', 'Pagamento', 'Sucesso']} />

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold">Pagamento</h1>
            <p className="text-gray-600 text-sm">Escolha a forma de pagamento e finalize sua entrada no grupo.</p>
          </div>

          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-2">
                <p className="text-xs uppercase tracking-wide text-gray-500">Resumo</p>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold">{grupoNome}</p>
                    <p className="text-sm text-gray-600">Inclui mensalidade + caucao. Sem taxas extras.</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">Valor hoje</p>
                    <p className="text-xl font-bold">R$ {precoNumero.toFixed(2)}</p>
                  </div>
                </div>
              </section>

          <section className="space-y-4">
            {metodos.map((item) => (
              <label
                key={item.id}
                className={`flex items-center gap-4 bg-white border rounded-2xl p-5 shadow-sm cursor-pointer transition ${
                  item.disabled
                    ? 'opacity-60 cursor-not-allowed border-gray-100'
                    : metodo === item.id
                    ? 'border-blue-300 ring-2 ring-blue-100'
                    : 'border-gray-100 hover:border-blue-200'
                }`}
              >
                <input
                  type="radio"
                  name="metodo"
                  value={item.id}
                  checked={metodo === item.id}
                  onChange={() => setMetodo(item.id)}
                  disabled={item.disabled}
                  className="w-5 h-5 accent-blue-600"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {item.icon && <i className={`fa ${item.icon} text-blue-600`} aria-hidden="true"></i>}
                    <p className="font-semibold">{item.titulo}</p>
                  </div>
                  <p className="text-sm text-gray-600">Pagamento confirmado em instantes.</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-900">{item.valor}</p>
                  <span className="inline-flex items-center px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-xs font-semibold">
                    {item.badge}
                  </span>
                </div>
              </label>
            ))}
            {saldoErro && <p className="text-sm text-red-600">Saldo: {saldoErro}</p>}
          </section>

          {metodo === 'pix' && (
            <section className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-2">
              <p className="text-sm font-semibold text-gray-900">CPF do pagador</p>
              <p className="text-xs text-gray-600">Use o CPF para gerar a chave Pix corretamente.</p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={14}
                placeholder="Digite o CPF (apenas numeros)"
                value={cpfPix}
                onChange={(e) => {
                  const onlyDigits = e.target.value.replace(/\D/g, '').slice(0, 11);
                  setCpfPix(onlyDigits);
                  if (cpfTouched) atualizarErroCpf(onlyDigits, true);
                }}
                onBlur={() => {
                  setCpfTouched(true);
                  atualizarErroCpf(cpfPix, true);
                }}
                className="w-full border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {erroCpf && <p className="text-sm text-red-600">{erroCpf}</p>}
            </section>
          )}

          <section className="bg-white border border-gray-100 rounded-2xl shadow-sm">
            <button
              type="button"
              onClick={() => setMostrarCupom((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-left font-semibold text-gray-900"
            >
              Tem um cupom?
              <span className="text-blue-600 text-lg">{mostrarCupom ? '-' : '+'}</span>
            </button>
            {mostrarCupom && (
              <div className="px-5 pb-5 flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  placeholder="Digite seu cupom"
                  className="flex-1 border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button className="px-5 py-3 bg-blue-600 text-white rounded-xl font-semibold shadow hover:bg-blue-700 transition">
                  Aplicar
                </button>
              </div>
            )}
          </section>

          {erroPagamento && <p className="text-sm text-red-600">{erroPagamento}</p>}
          {mensagem && <p className="text-sm text-blue-700">{mensagem}</p>}
        </div>

        <div className="fixed bottom-0 left-0 right-0 md:static md:max-w-4xl md:mx-auto md:mt-8">
          <div className="bg-white border-t md:border border-gray-200 shadow-2xl md:shadow-sm px-4 py-4 md:rounded-2xl flex flex-col md:flex-row items-center md:items-stretch gap-3">
            <div className="flex-1 w-full">
              <p className="text-xs text-gray-500">Pagamento</p>
              <p className="text-lg font-bold text-gray-900">R$ {precoNumero.toFixed(2)}</p>
              <p className="text-xs text-gray-600">Transacao segura criptografada.</p>
            </div>
            <button
              type="button"
              onClick={handleFinalizar}
              disabled={!podeFinalizar || processando}
              className={`w-full md:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-semibold shadow-lg transition ${
                podeFinalizar && !processando
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-600 cursor-not-allowed'
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

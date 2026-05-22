import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import Header from '../../components/Header';

export default function WalletAdd() {
  const { status } = useSession();
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [cpfPix, setCpfPix] = useState('');
  const [cpfTouched, setCpfTouched] = useState(false);
  const [erroCpf, setErroCpf] = useState('');
  const [payment, setPayment] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState('');

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

  const cpfValido = useMemo(() => cpfPix.length === 11 && validarCpf(cpfPix), [cpfPix]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setErroCpf('');
    if (!cpfValido) {
      setCpfTouched(true);
      atualizarErroCpf(cpfPix, true);
      return;
    }
    setPayment(null);
    setLoading(true);
    try {
      const res = await fetch('/api/pix/simulated/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(amount), cpf: cpfPix }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao criar pagamento');
      setPayment(data);
    } catch (err) {
      setError(err.message || 'Erro ao criar pagamento');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!payment?.paymentId) return;
    setConfirming(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/pix/simulated/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: payment.paymentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Erro ao confirmar pagamento');
      if (!data.ledgerId) {
        throw new Error('Pagamento confirmado mas credito nao registrado no ledger. Tente novamente.');
      }
      setPayment((prev) => ({ ...prev, ...data }));
      setSuccess('Pagamento confirmado e saldo atualizado.');
      setTimeout(() => router.push('/wallet'), 800);
    } catch (err) {
      setError(err.message || 'Erro ao confirmar pagamento');
    } finally {
      setConfirming(false);
    }
  };

  const isAuth = status === 'authenticated';

  return (
    <>
      <Header />
      <main className="pt-28 pb-12 px-4">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold text-gray-900">Adicionar saldo (PIX simulado)</h1>
            <Link href="/wallet" className="text-sm text-blue-600 hover:underline">
              Voltar para carteira
            </Link>
          </div>

          {!isAuth && <p className="text-red-600">Faça login para adicionar saldo.</p>}

          <form onSubmit={handleCreate} className="space-y-4 mt-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Valor (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border rounded px-3 py-2"
                placeholder="100.00"
                required
                disabled={!isAuth || loading}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CPF do pagador (Pix)</label>
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
                className="w-full border rounded px-3 py-2"
                disabled={!isAuth || loading}
                required
              />
              {erroCpf && <p className="text-sm text-red-600 mt-1">{erroCpf}</p>}
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              disabled={!isAuth || loading}
            >
              {loading ? 'Gerando PIX...' : 'Gerar QR simulado'}
            </button>
          </form>

          {error && <p className="text-red-600 mt-4">{error}</p>}
          {success && <p className="text-green-600 mt-4">{success}</p>}

          {payment && (
            <div className="mt-6 p-4 border rounded-lg bg-gray-50">
              <p className="text-sm text-gray-600">Pagamento gerado</p>
              <p className="text-lg font-semibold text-gray-900">Valor: R$ {Number(payment.amount || 0).toFixed(2)}</p>
              <p className="text-sm text-gray-700 break-all mt-2">QR Simulado: {payment.qrCode}</p>
              <p className="text-sm text-gray-700 mt-1">Payment ID: {payment.paymentId}</p>
              <p className="text-sm text-gray-700 mt-1">Status: {payment.status}</p>

              <button
                type="button"
                onClick={handleConfirm}
                className="mt-4 px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={confirming}
              >
                {confirming ? 'Confirmando...' : 'Confirmar pagamento'}
              </button>
              {payment.balance !== undefined && (
                <p className="text-sm text-gray-700 mt-2">
                  Saldo atualizado: R$ {Number(payment.balance || 0).toFixed(2)} (disponível:{' '}
                  {Number(payment.available || 0).toFixed(2)})
                </p>
              )}
              {payment.ledgerId && (
                <p className="text-xs text-gray-500 mt-1">Ledger ID: {payment.ledgerId}</p>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

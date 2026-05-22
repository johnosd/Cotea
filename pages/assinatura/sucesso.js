import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaCheckCircle } from 'react-icons/fa';
import { useSession } from 'next-auth/react';
import Header from '../../components/Header';
import FlowStepper from '../../components/FlowStepper';

export default function Sucesso() {
  const router = useRouter();
  const { data: session } = useSession();
  const [registrado, setRegistrado] = useState(false);
  const [erro, setErro] = useState('');
  const [mensagem, setMensagem] = useState('');

  const rawGrupoId = router.query.grupoId;
  const rawNome = router.query.nome;
  const rawInvoiceId = router.query.invoiceId;
  const rawJoinError = router.query.joinError;
  const grupoId = Array.isArray(rawGrupoId) ? rawGrupoId[0] : rawGrupoId;
  const nome = Array.isArray(rawNome) ? rawNome[0] : rawNome;
  const invoiceId = Array.isArray(rawInvoiceId) ? rawInvoiceId[0] : rawInvoiceId;
  const joinError = Array.isArray(rawJoinError) ? rawJoinError[0] : rawJoinError;

  const sessionUserId = useMemo(
    () => session?.user?.id || session?.user?._id || session?.user?.sub || '',
    [session]
  );

  const registrar = async () => {
    if (!grupoId || !invoiceId || !sessionUserId) return;
    setMensagem('Confirmando pagamento e registrando sua entrada...');
    setErro('');
    try {
      const res = await fetch(`/api/grupos/${grupoId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Nao foi possivel confirmar sua entrada');
      }
      setRegistrado(true);
      setMensagem('');
    } catch (error) {
      setErro(error?.message || 'Erro ao confirmar sua entrada no grupo.');
    }
  };

  useEffect(() => {
    registrar();
  }, [grupoId, invoiceId, sessionUserId]);

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50 text-gray-900 px-4 pb-12 pt-[110px]">
        <div className="max-w-3xl mx-auto space-y-6">
          <FlowStepper currentStep={3} steps={['Relacionamento', 'Pagamento', 'Sucesso']} />

          {!invoiceId && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              ID da fatura nao informado. Caso nao veja seu acesso, volte e refaca o pagamento.
            </p>
          )}
          {erro && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{erro}</p>}
          {joinError && !erro && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
              Pagamento concluido, mas o acesso nao foi registrado automaticamente: {decodeURIComponent(joinError)}. Clique em “Tentar novamente” abaixo.
            </p>
          )}
          {mensagem && <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">{mensagem}</p>}

          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 space-y-4 text-center">
            <div className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center shadow-lg animate-pulse">
              <img
                src="https://media.giphy.com/media/26ufnwz3wDUli7GU0/giphy.gif"
                alt="Sucesso"
                className="w-12 h-12 object-contain rounded-full"
              />
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl font-extrabold">Bem-vindo ao grupo!</h1>
              <p className="text-gray-700">
                {registrado
                  ? `Voce agora faz parte do grupo de ${nome || 'assinatura'}.`
                  : 'Estamos finalizando seu acesso. Isso costuma ser rapido.'}
              </p>
            </div>
            <div className="space-y-2 text-gray-700 text-sm">
              <p>Enviamos uma notificacao ao administrador para liberar tudo certinho.</p>
              <p>Normalmente o acesso e liberado em poucos minutos.</p>
            </div>
          </div>

          <section className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 space-y-4">
            <h2 className="text-lg font-bold text-gray-900">O que acontece agora?</h2>
            <ul className="space-y-3 text-sm text-gray-800">
              {[
                'Rodrigo sera avisado imediatamente',
                'Voce recebera o link de acesso',
                'Se houver qualquer problema, suporte 24h',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="text-green-600 mt-0.5">
                    <FaCheckCircle />
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <div className="flex flex-wrap gap-3">
              {!registrado && (
                <button
                  type="button"
                  onClick={registrar}
                  className="min-w-[160px] px-5 py-3 rounded-xl font-semibold text-white bg-amber-600 hover:bg-amber-700 transition shadow"
                >
                  Tentar novamente
                </button>
              )}
              <Link
                href="/meus-grupos"
                className="flex-1 min-w-[160px] text-center px-5 py-3 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 transition shadow"
              >
                Ir para meus grupos
              </Link>
              <Link
                href="/"
                className="min-w-[160px] text-center px-5 py-3 rounded-xl font-semibold text-blue-700 border border-blue-200 bg-white hover:border-blue-300 transition"
              >
                Voltar para inicio
              </Link>
            </div>
            <p className="text-xs text-gray-500">Voce pode acompanhar o status em tempo real.</p>
            <p className="text-xs text-gray-500">Obrigado por usar nossa plataforma!</p>
          </div>
        </div>
      </main>
    </>
  );
}

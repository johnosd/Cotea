import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../components/Header';
import FlowStepper from '../../components/FlowStepper';

export default function Relacionamento() {
  const router = useRouter();
  const { grupoId, nome, preco, userId } = router.query;
  const [aceitou, setAceitou] = useState(false);
  const hrefContinuar = useMemo(() => {
    const query = new URLSearchParams();
    if (grupoId) query.append('grupoId', grupoId);
    if (nome) query.append('nome', nome);
    if (preco) query.append('preco', preco);
    if (userId) query.append('userId', userId);
    const qs = query.toString();
    return `/assinatura/pagamento${qs ? `?${qs}` : ''}`;
  }, [grupoId, nome, preco, userId]);

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50 text-gray-900 px-4 pb-12 pt-[110px]">
        <div className="max-w-3xl mx-auto space-y-6">
          <FlowStepper currentStep={1} steps={['Relacionamento', 'Pagamento', 'Sucesso']} />

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold">Junte-se ao grupo</h1>
            <p className="text-gray-600 text-sm">Precisamos apenas confirmar o tipo de relacionamento exigido pelo servico.</p>
          </div>

          <section className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-xl">
                <i className="fa fa-handshake-o" aria-hidden="true"></i>
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-600">Para este servico, o relacionamento permitido e:</p>
                <label className="mt-2 flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:border-blue-300 transition">
                  <input type="radio" name="relacionamento" checked readOnly className="w-5 h-5 accent-blue-600" />
                  <div>
                    <p className="font-semibold text-gray-900">Colegas de Trabalho</p>
                    <p className="text-xs text-gray-600">Opcao unica e obrigatoria.</p>
                  </div>
                </label>
                <p className="text-xs text-gray-500 mt-2">Esta informacao ajuda a manter o servico dentro das regras.</p>
              </div>
            </div>

            <details className="group bg-gray-50 border border-gray-200 rounded-xl p-4">
              <summary className="flex items-center justify-between cursor-pointer font-semibold text-gray-800">
                Por que isso e necessario?
                <span className="text-blue-600 group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="text-sm text-gray-700 mt-3">
                Confirmar o relacionamento garante que todos sigam os termos de uso e a responsabilidade do compartilhamento.
                <Link href="/politica" className="text-blue-600 font-semibold ml-1 hover:underline">
                  Saiba mais
                </Link>
                .
              </p>
            </details>

            <label className="flex items-start gap-3 bg-white border border-gray-200 rounded-xl p-4 cursor-pointer hover:border-blue-300 transition">
              <input
                type="checkbox"
                className="mt-1 w-5 h-5 accent-blue-600"
                checked={aceitou}
                onChange={() => setAceitou((v) => !v)}
              />
              <span className="text-sm text-gray-800">
                Confirmo que entendi que a plataforma nao e afiliada ao servico original e que seguirei os termos.
              </span>
            </label>
          </section>

          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              <Link
                href={hrefContinuar}
                className={`flex-1 min-w-[180px] text-center px-5 py-3 rounded-xl font-semibold text-white transition shadow ${
                  aceitou
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-blue-300 cursor-not-allowed shadow-none pointer-events-none'
                }`}
                aria-disabled={!aceitou}
              >
                Continuar
              </Link>
              <Link
                href="/"
                className="min-w-[120px] px-5 py-3 rounded-xl font-semibold text-blue-700 border border-blue-200 bg-white hover:border-blue-300 transition text-center"
              >
                Voltar
              </Link>
            </div>
            <p className="text-xs text-gray-500">Suas informacoes permanecem privadas.</p>
          </div>
        </div>
      </main>
    </>
  );
}

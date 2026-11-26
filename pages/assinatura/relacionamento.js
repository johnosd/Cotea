import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../components/Header';
import FlowStepper from '../../components/FlowStepper';
import { VINCULOS } from '../../lib/checkout';

const primeiro = (valor) => (Array.isArray(valor) ? valor[0] : valor) || '';

export default function Relacionamento() {
  const router = useRouter();
  const grupoId = primeiro(router.query.grupoId);
  const nome = primeiro(router.query.nome);
  const vinculoNaUrl = primeiro(router.query.vinculo);
  // 006-checkout-caucao (FR-010): nenhuma opção pré-selecionada; a escolha é do usuário.
  const [vinculo, setVinculo] = useState('');
  const [aceitou, setAceitou] = useState(false);

  // Quem volta do pagamento reencontra o que já tinha escolhido.
  useEffect(() => {
    if (VINCULOS.some((v) => v.id === vinculoNaUrl)) setVinculo(vinculoNaUrl);
  }, [vinculoNaUrl]);

  const podeContinuar = Boolean(vinculo) && aceitou && Boolean(grupoId);
  const hrefContinuar = useMemo(() => {
    const query = new URLSearchParams();
    if (grupoId) query.append('grupoId', grupoId);
    if (nome) query.append('nome', nome);
    if (vinculo) query.append('vinculo', vinculo);
    const qs = query.toString();
    return `/assinatura/pagamento${qs ? `?${qs}` : ''}`;
  }, [grupoId, nome, vinculo]);

  return (
    <>
      <Header />
      <main className="min-h-screen bg-gray-50 text-gray-900 px-4 pb-12 pt-[110px]">
        <div className="max-w-3xl mx-auto space-y-6">
          <FlowStepper currentStep={1} steps={['Relacionamento', 'Pagamento', 'Sucesso']} />

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold">Junte-se ao grupo</h1>
            <p className="text-gray-600 text-sm">Antes do pagamento, conte qual é o seu vínculo com o dono do grupo.</p>
          </div>

          <section className="bg-white rounded-2xl shadow-md border border-gray-100 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-xl">
                <i className="fa fa-handshake-o" aria-hidden="true"></i>
              </div>
              <fieldset className="flex-1">
                <legend className="text-sm text-gray-600">Qual é o seu vínculo com o dono do grupo?</legend>
                <div className="mt-2 grid sm:grid-cols-2 gap-2">
                  {VINCULOS.map((opcao) => (
                    <label
                      key={opcao.id}
                      className={`flex items-center gap-3 bg-gray-50 border rounded-xl px-4 py-3 cursor-pointer transition ${
                        vinculo === opcao.id ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-200 hover:border-blue-300'
                      }`}
                    >
                      <input
                        type="radio"
                        name="vinculo"
                        value={opcao.id}
                        checked={vinculo === opcao.id}
                        onChange={() => setVinculo(opcao.id)}
                        className="w-5 h-5 accent-blue-600"
                      />
                      <span className="font-semibold text-gray-900">{opcao.rotulo}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Todas as opções permitem entrar. A resposta é vista pelo dono do grupo e pela equipe do Cotea.
                </p>
              </fieldset>
            </div>

            <details className="group bg-gray-50 border border-gray-200 rounded-xl p-4">
              <summary className="flex items-center justify-between cursor-pointer font-semibold text-gray-800">
                Por que isso é necessário?
                <span className="text-blue-600 group-open:rotate-45 transition-transform">+</span>
              </summary>
              <p className="text-sm text-gray-700 mt-3">
                Declarar o vínculo ajuda o dono e o Cotea a manter o compartilhamento dentro dos termos de uso.
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
                Confirmo que entendi que a plataforma não é afiliada ao serviço original e que seguirei os termos.
              </span>
            </label>
          </section>

          <div className="flex flex-wrap gap-3">
            <Link
              href={hrefContinuar}
              className={`flex-1 min-w-[180px] text-center px-5 py-3 rounded-xl font-semibold text-white transition shadow ${
                podeContinuar
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-blue-300 cursor-not-allowed shadow-none pointer-events-none'
              }`}
              aria-disabled={!podeContinuar}
              tabIndex={podeContinuar ? undefined : -1}
            >
              Continuar
            </Link>
            <Link
              href={grupoId ? `/grupos/${grupoId}` : '/'}
              className="min-w-[120px] px-5 py-3 rounded-xl font-semibold text-blue-700 border border-blue-200 bg-white hover:border-blue-300 transition text-center"
            >
              Voltar
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

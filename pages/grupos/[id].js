import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { FaWhatsapp, FaUsers, FaClock, FaShieldAlt, FaCrown, FaCheckCircle, FaExternalLinkAlt } from 'react-icons/fa';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import clientPromise from '../../lib/mongodb';
import { ObjectId } from 'mongodb';
import Header from '../../components/Header';

const DEFAULT_CONTENT = {
  nome: 'Google One',
  subtitulo: 'Premium Anual - 2 TB',
  descricao: 'Armazenamento compartilhado com contas individuais preservando privacidade e espaco garantido.',
  preco: 10.44,
  confiabilidade: 'Selo ouro',
  tempoEntrega: 'Ate 5 dias (geralmente mais rapido)',
  acesso: 'Convite',
  vagas: { total: 6, ocupadas: 5 },
  admin: {
    nome: 'Isabela',
    avatar: 'https://i.pravatar.cc/160?img=47',
    selos: ['Mais de 1 grupo ativo', '+1 ano de plataforma', 'Envio rapido'],
  },
  participantes: [
    { nome: 'Deyves', avatar: 'https://i.pravatar.cc/120?img=15' },
    { nome: 'Luciene', avatar: 'https://i.pravatar.cc/120?img=32' },
    { nome: 'Rafael', avatar: 'https://i.pravatar.cc/120?img=3' },
    { nome: 'Nicholas', avatar: 'https://i.pravatar.cc/120?img=8' },
  ],
  beneficios: [
    'Armazenamento 2 TB compartilhado',
    'Contas individuais preservam privacidade',
    'Pagamento mensal',
    'Grupo ja esta ativo',
    'Administrador confiavel',
    'Envio de acesso rapido',
  ],
  fidelidade: [
    'Compromisso de 12 meses',
    'Cancelamento nao permitido durante fidelidade',
    'Renovacao automatica',
    'Proxima renovacao: 22/05/2026',
  ],
  regras: ['Nao compartilhar senha', 'Nao postar em nome do administrador', 'Nao alterar senha'],
  faq: [
    { pergunta: 'Quando terei acesso ao servico?', resposta: 'O acesso e enviado em ate 5 dias, normalmente no mesmo dia.' },
    { pergunta: 'Quais formas de pagamento?', resposta: 'Pix ou cartao pelos metodos do administrador do grupo.' },
    { pergunta: 'O que e caucao?', resposta: 'Valor de seguranca em casos especificos; avisaremos antes se for necessario.' },
    { pergunta: 'Com quem posso dividir assinaturas?', resposta: 'Apenas com membros aprovados pelo administrador do grupo.' },
  ],
  linkOficial: 'https://one.google.com/',
};

const isValidObjectId = (value) => typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value);

const parseNumero = (valor, padrao = NaN) => {
  if (valor === null || valor === undefined) return padrao;
  if (typeof valor === 'object' && ('$numberDouble' in valor || '$numberDecimal' in valor)) {
    const raw = valor.$numberDouble || valor.$numberDecimal;
    const num = Number(raw);
    return Number.isFinite(num) ? num : padrao;
  }
  const num = Number(valor);
  return Number.isFinite(num) ? num : padrao;
};

function calcularStatusGrupo(grupo) {
  const capacidadeNum = parseNumero(grupo.capacidadeTotal);
  const participantes = Array.isArray(grupo.participantes)
    ? grupo.participantes.filter((p) => p && p.status !== 'banido')
    : [];
  const membrosAtivos = participantes.length;
  const capacidade = Number.isFinite(capacidadeNum) && capacidadeNum > 0 ? capacidadeNum : Math.max(membrosAtivos, DEFAULT_CONTENT.vagas.total);
  const vagasDisponiveis = Math.max(capacidade - membrosAtivos, 0);
  return { capacidade, membrosAtivos, vagasDisponiveis };
}

export default function GrupoDetalhe({ grupo }) {
  const dados = grupo || {};
  const grupoId = dados._id || dados.id || '';
  const { data: session } = useSession();
  const router = useRouter();
  const isAuthenticated = Boolean(session?.user);
  const [userId, setUserId] = useState('');
  const [jaMembro, setJaMembro] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState('');
  const { capacidade, membrosAtivos, vagasDisponiveis } = useMemo(() => calcularStatusGrupo(dados), [dados]);

  const nome = dados.nome || DEFAULT_CONTENT.nome;
  const valorPorVagaNumero = parseNumero(dados.valorPorVaga);
  const valorTotalNumero = parseNumero(dados.valorTotal);
  const capacidadeTotalNumero = parseNumero(dados.capacidadeTotal);
  const capacidadeDivisor = Number.isFinite(capacidadeTotalNumero) && capacidadeTotalNumero > 0 ? capacidadeTotalNumero : capacidade;
  const precoNumeroFallback = parseNumero(dados.preco);
  const precoCalculado = Number.isFinite(valorPorVagaNumero)
    ? valorPorVagaNumero
    : Number.isFinite(valorTotalNumero) && capacidadeDivisor > 0
    ? valorTotalNumero / capacidadeDivisor
    : Number.isFinite(precoNumeroFallback)
    ? precoNumeroFallback
    : NaN;
  const preco = Number.isFinite(precoCalculado) ? precoCalculado : DEFAULT_CONTENT.preco;
  const descricao = dados.descricao || DEFAULT_CONTENT.descricao;
  const capa = dados.imageUrl || dados.capa || '';

  const titulo = `${nome} ${dados.subtitulo ? `- ${dados.subtitulo}` : DEFAULT_CONTENT.subtitulo}`;
  const acesso = dados.acesso || DEFAULT_CONTENT.acesso;
  const tempoEntrega = dados.tempoEntrega || DEFAULT_CONTENT.tempoEntrega;
  const confiabilidade = dados.confiabilidade || DEFAULT_CONTENT.confiabilidade;
  const beneficios = Array.isArray(dados.beneficios) && dados.beneficios.length ? dados.beneficios : DEFAULT_CONTENT.beneficios;
  const fidelidade = Array.isArray(dados.fidelidade) && dados.fidelidade.length ? dados.fidelidade : DEFAULT_CONTENT.fidelidade;
  const regras = Array.isArray(dados.regras) && dados.regras.length ? dados.regras : DEFAULT_CONTENT.regras;
  const faq = Array.isArray(dados.faq) && dados.faq.length ? dados.faq : DEFAULT_CONTENT.faq;
  const linkOficial = dados.linkOficial || DEFAULT_CONTENT.linkOficial;
  const adminNome =
    dados.adminNome ||
    dados.admin?.nome ||
    dados.admin?.name ||
    dados.admin?.email ||
    DEFAULT_CONTENT.admin.nome;
  const adminAvatar = dados.adminAvatar || dados.admin?.avatar || dados.admin?.image || DEFAULT_CONTENT.admin.avatar;
  const adminSelos = Array.isArray(dados.adminSelos)
    ? dados.adminSelos
    : Array.isArray(dados.admin?.selos) && dados.admin?.selos.length
    ? dados.admin.selos
    : DEFAULT_CONTENT.admin.selos;
  const participantesIniciais =
    Array.isArray(dados.participantes) && dados.participantes.length
      ? dados.participantes.map((item, idx) =>
          typeof item === 'string'
            ? { nome: item, avatar: `https://i.pravatar.cc/120?img=${(idx % 70) + 1}`, userId: undefined, aguardandoEnvioAcesso: false }
            : {
                nome: item?.nome || `Membro ${idx + 1}`,
                avatar: item?.avatar || `https://i.pravatar.cc/120?img=${(idx % 70) + 1}`,
                userId: item?.userId,
                aguardandoEnvioAcesso: item?.aguardandoEnvioAcesso,
                dataEnvioAcesso: item?.dataEnvioAcesso,
                status: item?.status,
                papel: item?.papel,
                email: item?.email,
              }
        )
      : DEFAULT_CONTENT.participantes;
  const [participantes, setParticipantes] = useState(participantesIniciais);

  useEffect(() => {
    const sessionId =
      session?.user?.id || session?.user?._id || session?.user?.sub || session?.user?.email || null;
    if (sessionId) {
      setUserId(String(sessionId));
    } else {
      setUserId('');
    }
  }, [session]);

  useEffect(() => {
    if (!userId) return;
    const sessionEmail = session?.user?.email;
    const foundParticipante = participantes.some(
      (p) =>
        (p?.userId && p.userId === userId) ||
        (sessionEmail && p?.email && p.email === sessionEmail)
    );
    const initial = Boolean(foundParticipante);
    setJaMembro(initial);

    if (!grupoId || !isValidObjectId(userId)) return;

    let cancelado = false;
    const verificarMembro = async () => {
      try {
        const res = await fetch(`/api/grupos/${grupoId}/join?userId=${userId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelado) return;
        if (data?.isMembro) {
          setJaMembro(true);
        } else {
          setJaMembro(false);
        }
      } catch (error) {
        // silencioso
      }
    };
    verificarMembro();

    return () => {
      cancelado = true;
    };
  }, [userId, participantes, grupoId, session]);

  const isAdmin = useMemo(() => {
    const sessionEmail = session?.user?.email;
    if (!userId && !sessionEmail) return false;
    const adminIds = [
      dados.adminIdString,
      dados.adminId,
      dados.admin?.id,
      dados.admin?.userId,
    ]
      .filter(Boolean)
      .map((id) => String(id));

    const matchesAdminId = userId && adminIds.some((id) => id === userId);
    const matchesAdminEmail = sessionEmail && (dados.adminEmail === sessionEmail || dados.admin?.email === sessionEmail);
    const matchesAdminParticipante =
      participantes?.length > 0 &&
      participantes.some(
        (p) =>
          String(p?.papel || '').toLowerCase() === 'admin' &&
          ((p.userId && p.userId === userId) || (sessionEmail && p.email && p.email === sessionEmail))
      );

    return Boolean(matchesAdminId || matchesAdminEmail || matchesAdminParticipante);
  }, [userId, participantes, session, dados.adminIdString, dados.adminId, dados.admin, dados.adminEmail]);

  const pendentesAcesso = useMemo(
    () => participantes.filter((p) => p?.aguardandoEnvioAcesso && p?.papel !== 'admin').length,
    [participantes]
  );
  const hasMembrosSemAdmin = useMemo(
    () => participantes.some((p) => String(p?.papel || '').toLowerCase() !== 'admin'),
    [participantes]
  );

  const handleExcluirGrupo = async () => {
    if (!grupoId || !isAdmin) return;
    const confirmar = window.confirm('Tem certeza que deseja excluir este grupo? Esta acao nao pode ser desfeita.');
    if (!confirmar) return;
    setErroExcluir('');
    setExcluindo(true);
    try {
      const res = await fetch(`/api/grupos/${grupoId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Erro ao excluir grupo');
      }
      router.push('/admin/grupos').catch(() => router.push('/meus-grupos'));
    } catch (error) {
      setErroExcluir(error?.message || 'Erro ao excluir grupo');
    } finally {
      setExcluindo(false);
    }
  };

  const whatsappLink = `https://wa.me/5511997383948?text=${encodeURIComponent(
    `Ola! Quero entrar no grupo de assinatura: ${nome}`
  )}`;
  const flowQuery = useMemo(() => {
    const query = new URLSearchParams();
    if (grupoId) query.append('grupoId', grupoId);
    if (nome) query.append('nome', nome);
    if (preco) query.append('preco', preco);
    if (userId) query.append('userId', userId);
    const qs = query.toString();
    return qs ? `?${qs}` : '';
  }, [grupoId, nome, preco, userId]);

  return (
    <>
      <Header />
      <main className="bg-gray-50 text-gray-900">
        <section className="pt-[110px] pb-10 px-4">
          <div className="max-w-6xl mx-auto grid md:grid-cols-[1.6fr_1fr] gap-6 items-start">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6 md:p-8 relative overflow-hidden">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-600 to-indigo-500 text-white flex items-center justify-center shadow-md overflow-hidden">
                    {capa ? (
                      <Image
                        src={capa}
                        alt={nome}
                        width={56}
                        height={56}
                        className="w-full h-full object-cover"
                        unoptimized
                      />
                    ) : (
                      <i className="fa fa-cloud" aria-hidden="true"></i>
                    )}
                  </div>
                  <div>
                    <p className="text-sm uppercase tracking-wide text-blue-700 font-semibold">Grupo de assinatura</p>
                    <h1 className="text-2xl md:text-3xl font-extrabold leading-tight">{titulo}</h1>
                  </div>
                </div>

                <p className="text-gray-700 text-sm md:text-base">{descricao}</p>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <HeroStat icon={<FaCheckCircle />} label="Confiabilidade" value={confiabilidade} />
                  <HeroStat icon={<FaUsers />} label="Vagas restantes" value={`${vagasDisponiveis || 0} de ${capacidade}`} emphasis />
                  <HeroStat icon={<FaClock />} label="Entrega" value={tempoEntrega} />
                  <HeroStat icon={<FaShieldAlt />} label="Acesso" value={acesso} />
                  <HeroStat icon={<FaCrown />} label="Admin" value={adminNome} />
                  <HeroStat icon={<FaExternalLinkAlt />} label="Plano" value={dados.subtitulo || 'Plano anual'} />
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <div className="text-3xl font-extrabold text-gray-900">
                    R$ {preco.toFixed(2)}
                    <span className="text-sm text-gray-600 font-semibold ml-1">/mes</span>
                  </div>
                  <Badge text={vagasDisponiveis > 0 ? 'Vagas disponiveis' : 'Ultimas vagas'} variant={vagasDisponiveis > 0 ? 'success' : 'warning'} />
                  <Badge text="Convite seguro" variant="info" />
                </div>

                <Link href="/" className="text-blue-700 font-semibold hover:underline">
                  Ver outros grupos
                </Link>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-white rounded-2xl shadow-xl p-6 md:p-8 flex flex-col gap-4">
                <p className="text-sm uppercase tracking-wide text-blue-100 font-semibold">Resumo rapido</p>
                <h2 className="text-2xl font-bold leading-snug">Acesso garantido com supervisao de administrador verificado</h2>
                <p className="text-blue-100 text-sm">
                  Confianca e seguranca para entrar no grupo com suporte dedicado e acompanhamento na entrega do acesso.
                </p>
                <div className="bg-white/15 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-blue-100 text-sm">Vagas restantes</p>
                    <p className="text-3xl font-extrabold">{vagasDisponiveis || 0}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-blue-100 text-sm">Plano</p>
                    <p className="text-lg font-semibold">{dados.subtitulo || 'Google One 2 TB'}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Mensalidade</p>
                    <p className="text-2xl font-bold text-gray-900">R$ {preco.toFixed(2)}</p>
                  </div>
                  <Badge text="CTA em destaque" variant="info" />
                </div>
                <p className="text-sm text-gray-700">Pagamento mensal, renovacao automatica e acompanhamento do acesso pelo administrador.</p>
                {isAdmin ? (
                  <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold shadow bg-gray-300 text-gray-600">
                    <FaWhatsapp /> Administrador do grupo
                  </div>
                ) : jaMembro ? (
                  <Link
                    href={whatsappLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold shadow bg-green-600 text-white hover:bg-green-700"
                  >
                    <FaWhatsapp /> Acessar grupo no WhatsApp
                  </Link>
                ) : (
                  <Link
                    href={
                      isAuthenticated
                        ? `/assinatura/relacionamento${flowQuery}`
                        : `/auth/signin?callbackUrl=${encodeURIComponent(router.asPath || '')}`
                    }
                    className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold shadow bg-green-600 text-white hover:bg-green-700"
                  >
                    <FaWhatsapp /> {isAuthenticated ? 'Assinar' : 'Entrar para assinar'}
                  </Link>
                )}
                <div className="flex flex-col gap-2">
                  {!jaMembro && !isAdmin && (
                    <Link
                      href={
                        isAuthenticated
                          ? whatsappLink
                          : `/auth/signin?callbackUrl=${encodeURIComponent(router.asPath || '')}`
                      }
                      target={isAuthenticated ? '_blank' : undefined}
                      rel={isAuthenticated ? 'noopener noreferrer' : undefined}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold shadow bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300"
                    >
                      <FaWhatsapp /> {isAuthenticated ? 'Entrar no grupo' : 'Entrar para participar'}
                    </Link>
                  )}
                  {jaMembro && !isAdmin && (
                    <Link
                      href={`/grupos/${grupoId}/cancelar`}
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold shadow bg-amber-600 text-white hover:bg-amber-700"
                    >
                      Cancelar participacao
                    </Link>
                  )}
                  {isAdmin && (
                    <>
                      {pendentesAcesso > 0 && (
                        <Link
                          href={`/grupos/${grupoId}/admin/mensagem?tipo=acesso`}
                          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold shadow bg-green-700 text-white hover:bg-green-800"
                        >
                          Enviar acessos ({pendentesAcesso})
                        </Link>
                      )}
                      {hasMembrosSemAdmin ? (
                        <Link
                          href={`/grupos/${grupoId}/admin/mensagem`}
                          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold shadow bg-indigo-600 text-white hover:bg-indigo-700"
                        >
                          Enviar mensagem aos membros
                        </Link>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold shadow bg-gray-300 text-gray-600 cursor-not-allowed"
                        >
                          Adicione membros para enviar mensagem
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleExcluirGrupo}
                        disabled={excluindo}
                        className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-semibold shadow bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300"
                      >
                        {excluindo ? 'Excluindo...' : 'Excluir grupo'}
                      </button>
                    </>
                  )}
                  {erroExcluir && <span className="text-sm text-red-600">{erroExcluir}</span>}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-4 pb-12">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[2fr_1fr] gap-8">
            <div className="space-y-6">
              <CardSection title="Beneficios de participar">
                <div className="grid sm:grid-cols-2 gap-4">
                  {beneficios.map((item) => (
                    <div key={item} className="flex items-start gap-3 bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                      <span className="text-blue-600 mt-1">
                        <FaCheckCircle />
                      </span>
                      <p className="text-gray-800 text-sm">{item}</p>
                    </div>
                  ))}
                </div>
              </CardSection>

              <CardSection title="Preco e disponibilidade">
                <div className="grid md:grid-cols-3 gap-4">
                  <InfoCard label="Preco" value={`R$ ${preco.toFixed(2)}/mes`} />
                  <InfoCard label="Vagas restantes" value={`${vagasDisponiveis || 0} de ${capacidade}`} />
                  <InfoCard label="Tipo de acesso" value={acesso} />
                  <InfoCard label="Renovacao" value={dados.subtitulo || 'Anual do plano Google One'} />
                  <InfoCard label="Status" value={vagasDisponiveis > 0 ? 'Aberto' : 'Ultimas vagas'} />
                </div>
              </CardSection>

              <CardSection title="Fidelidade do grupo">
                <ul className="list-disc pl-5 space-y-2 text-gray-700 text-sm">
                  {fidelidade.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </CardSection>

              <CardSection title="Regras do grupo">
                <ol className="list-decimal pl-5 space-y-2 text-gray-800 text-sm">
                  {regras.map((regra) => (
                    <li key={regra}>{regra}</li>
                  ))}
                </ol>
              </CardSection>

              <CardSection title="FAQ">
                <div className="space-y-3">
                  {faq.map(({ pergunta, resposta }) => (
                    <details
                      key={pergunta}
                      className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 group open:shadow-md transition"
                    >
                      <summary className="cursor-pointer font-semibold text-gray-900 flex items-center justify-between">
                        {pergunta}
                        <span className="text-blue-600 group-open:rotate-45 transition-transform">+</span>
                      </summary>
                      <p className="text-gray-700 text-sm mt-2">{resposta}</p>
                    </details>
                  ))}
                </div>
              </CardSection>
            </div>

            <div className="space-y-6">
              <CardSection title="Administrador">
                <div className="flex items-center gap-4">
                  <Image
                    src={adminAvatar}
                    alt={adminNome}
                    width={72}
                    height={72}
                    className="rounded-full object-cover shadow"
                    unoptimized
                  />
                  <div>
                    <p className="text-lg font-bold">{adminNome}</p>
                    <p className="text-sm text-amber-600 font-semibold">{confiabilidade}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {adminSelos.map((selo, idx) => {
                    const label = typeof selo === 'string' ? selo : selo.label;
                    const icon = typeof selo === 'object' && selo.icon ? selo.icon : 'fa-circle-check';
                    return (
                      <span
                        key={`${label}-${idx}`}
                        title={label}
                        className="inline-flex items-center gap-2 bg-blue-50 text-blue-800 text-xs font-semibold px-3 py-2 rounded-full"
                      >
                        <i className={`fa ${icon}`} aria-hidden="true"></i>
                        {label}
                      </span>
                    );
                  })}
                </div>
              </CardSection>

              <CardSection title="Participantes">
                <div className="flex flex-wrap gap-3">
                  {participantes.map((pessoa) => (
                    <div key={pessoa.nome} className="flex items-center gap-2 bg-white rounded-full border border-gray-100 shadow-sm px-3 py-2">
                      <Image
                        src={pessoa.avatar}
                        alt={pessoa.nome}
                        width={36}
                        height={36}
                        className="rounded-full object-cover"
                        unoptimized
                      />
                      <span className="text-sm font-medium text-gray-800">{pessoa.nome}</span>
                    </div>
                  ))}
                </div>
              </CardSection>

              <CardSection title="Outras informacoes">
                <div className="space-y-2 text-sm text-gray-700">
                  <p>Link oficial do servico:</p>
                  <Link href={linkOficial} target="_blank" rel="noopener noreferrer" className="text-blue-700 font-semibold hover:underline break-all">
                    {linkOficial}
                  </Link>
                </div>
              </CardSection>
            </div>
          </div>
        </section>
      </main>

      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-white shadow-2xl border-t border-gray-200 px-4 py-3 z-40">
        <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-gray-600">Entrar no grupo</p>
            <p className="text-lg font-bold text-gray-900">R$ {preco.toFixed(2)}/mes</p>
          </div>
          {isAdmin ? (
            <div className="flex items-center justify-center gap-2 px-4 py-3 rounded-full font-semibold shadow bg-gray-300 text-gray-600">
              <FaWhatsapp /> Administrador do grupo
            </div>
          ) : jaMembro ? (
            <Link
              href={whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-3 rounded-full font-semibold shadow hover:bg-green-700 transition"
            >
              <FaWhatsapp /> Acessar WhatsApp
            </Link>
          ) : (
            <Link
              href={
                isAuthenticated
                  ? whatsappLink
                  : `/auth/signin?callbackUrl=${encodeURIComponent(router.asPath || '')}`
              }
              target={isAuthenticated ? '_blank' : undefined}
              rel={isAuthenticated ? 'noopener noreferrer' : undefined}
              className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-full font-semibold shadow hover:bg-blue-700 transition"
            >
              <FaWhatsapp /> {isAuthenticated ? 'Entrar' : 'Entrar para participar'}
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

function HeroStat({ icon, label, value, emphasis = false }) {
  return (
    <div className="bg-gray-50 rounded-xl border border-gray-100 p-3 flex items-start gap-3">
      <span className={`text-blue-600 mt-1 ${emphasis ? 'text-lg' : ''}`}>{icon}</span>
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
        <p className="text-sm font-semibold text-gray-900">{value}</p>
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function CardSection({ title, children }) {
  return (
    <section className="bg-white rounded-2xl shadow-lg border border-gray-100 p-5 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Badge({ text, variant = 'info' }) {
  const variants = {
    info: 'bg-blue-50 text-blue-700 border border-blue-100',
    success: 'bg-green-50 text-green-700 border border-green-100',
    warning: 'bg-amber-50 text-amber-700 border border-amber-100',
  };
  return <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${variants[variant] || variants.info}`}>{text}</span>;
}

export async function getServerSideProps({ params }) {
  const { id } = params;

  if (!ObjectId.isValid(id)) {
    return { notFound: true };
  }

  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);

    const grupoDoc = await db.collection('grupos').findOne({ _id: new ObjectId(id) });
    if (!grupoDoc) return { notFound: true };

    const membros = await db
      .collection('membrosGrupo')
      .aggregate([
        { $match: { grupoId: new ObjectId(id) } },
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            papel: 1,
            status: 1,
            userId: 1,
            aguardandoEnvioAcesso: 1,
            dataEnvioAcesso: 1,
            nome: { $ifNull: ['$user.name', '$user.nome'] },
            email: '$user.email',
            avatar: { $ifNull: ['$user.image', '$user.avatar'] },
          },
        },
      ])
      .toArray();

    const adminMember = membros.find((m) => m.papel === 'admin');
    const adminNome =
      adminMember?.nome ||
      grupoDoc.adminNome ||
      adminMember?.email ||
      grupoDoc.admin?.nome ||
      'Administrador';
    const adminEmail = adminMember?.email || grupoDoc.adminEmail || '';
    const adminAvatar = adminMember?.avatar || grupoDoc.adminAvatar || '';

    const participantes = membros
      .filter((m) => m.status !== 'banido')
      .map((m, idx) => ({
        nome: m.nome || m.email || `Membro ${idx + 1}`,
        avatar: m.avatar || `https://i.pravatar.cc/120?img=${(idx % 70) + 1}`,
        userId: m.userId ? String(m.userId) : undefined,
        email: m.email || undefined,
        status: m.status,
        papel: m.papel,
        aguardandoEnvioAcesso: m.aguardandoEnvioAcesso,
        dataEnvioAcesso: m.dataEnvioAcesso,
      }));

    const grupo = {
      ...grupoDoc,
      adminNome,
      adminEmail,
      adminAvatar,
      participantes,
    };

    return { props: { grupo: JSON.parse(JSON.stringify(grupo)) } };
  } catch (error) {
    console.error('Erro ao carregar grupo:', error);
    return { props: { grupo: null } };
  }
}

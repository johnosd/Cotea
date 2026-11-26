import { useMemo, useRef, useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Header from '../../../components/Header';
import PrevisaoPreco from '../../../components/PrevisaoPreco';
import { calcularPrecoVaga, VAGAS_DONO } from '../../../lib/preco';
import { getServerSession } from 'next-auth/next';
import clientPromise from '../../../lib/mongodb';
import { authOptions } from '../../api/auth/[...nextauth]';
import { resolverPaginaEdicaoGrupo } from '../../../lib/grupos-acesso';
import { ROTULOS_STATUS_GRUPO, STATUS_FINAIS, statusEfetivo } from '../../../lib/moderacao';

const inputBaseClass = 'w-full p-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 transition';
const labelClass = 'text-sm font-semibold text-gray-800 flex items-center gap-2';
const sectionClass = 'bg-white rounded-lg shadow-sm p-4 sm:p-6 border border-gray-100 space-y-4';
const errorClass = 'text-xs text-red-600 mt-1';
const helperClass = 'text-xs text-gray-500 mt-1';
const categoriasDisponiveis = [
  { id: 'jogos', label: 'Jogos', icon: '🎮' },
  { id: 'aplicativos', label: 'Aplicativos', icon: '📱' },
  { id: 'assinaturas', label: 'Assinaturas', icon: '🧾' },
  { id: 'cursos', label: 'Cursos', icon: '📚' },
];
const acessosDisponiveis = [
  { id: 'imediato', label: 'Acesso imediato', icon: '⚡' },
  { id: 'apos_completar', label: 'Apos completar vagas', icon: '⏳' },
];

const parseLista = (valor, fallback = []) => {
  if (Array.isArray(valor)) return valor;
  if (typeof valor === 'string') {
    return valor
      .split(/\r?\n/)
      .map((i) => i.trim())
      .filter(Boolean);
  }
  return fallback;
};

const parseFaq = (valor) => {
  if (Array.isArray(valor)) {
    return valor.map((item) => ({
      pergunta: item.pergunta || '',
      resposta: item.resposta || '',
    }));
  }
  return [];
};

const parseFidelidade = (valor) => {
  if (valor && typeof valor === 'object') {
    return {
      periodo: valor.periodoMeses ? `${valor.periodoMeses} meses` : '12 meses',
      renovacao: valor.renovacaoAutomatica !== false,
      observacoes: valor.observacoes || '',
    };
  }
  return { periodo: '12 meses', renovacao: true, observacoes: '' };
};

export default function EditarGrupo({ grupo, participantes = [] }) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const callbackPath = router?.asPath || (grupo?._id ? `/admin/grupos/${grupo._id}` : '/admin/grupos');
  const fileInputRef = useRef(null);
  const adminNomeExibicao = grupo.adminNome || grupo.admin?.nome || 'Administrador';
  const adminAvatarExibicao = grupo.adminAvatar || grupo.admin?.avatar || '';
  const adminEmailExibicao = grupo.adminEmail || grupo.admin?.email || '';
  const adminIdExibicao = grupo.adminIdString || grupo.adminId || '';
  const adminInitial = (adminNomeExibicao?.[0] || 'A').toUpperCase();

  const [nome, setNome] = useState(grupo.nome || '');
  const [capa, setCapa] = useState(grupo.imageUrl || grupo.capa || '');
  const [imagemPreview, setImagemPreview] = useState(grupo.imageUrl || grupo.capa || '');
  const [imagemFile, setImagemFile] = useState(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [imageKey, setImageKey] = useState(grupo.imageKey || '');
  const [valorTotal] = useState(grupo.valorTotal ?? '');
  const [descricao, setDescricao] = useState(grupo.descricao || '');
  const [capacidadeTotal, setCapacidadeTotal] = useState(grupo.capacidadeTotal ?? '');
  const [subtitulo, setSubtitulo] = useState(grupo.subtitulo || '');
  const [acesso, setAcesso] = useState(grupo.acesso || 'imediato');
  const [tempoEntrega, setTempoEntrega] = useState(grupo.tempoEntrega || 'Ate 5 dias (geralmente mais rapido)');
  const [confiabilidade] = useState(grupo.confiabilidade || 'Selo ouro');
  const [tipoGrupo, setTipoGrupo] = useState(grupo.tipoGrupo || 'publico');
  const [categoria, setCategoria] = useState(grupo.categoria || 'jogos');
  // Estado de moderação: só leitura nesta tela (005-aprovacao-grupos, FR-003); muda pelas ações.
  const statusGrupo = statusEfetivo(grupo);
  const grupoFinal = STATUS_FINAIS.includes(statusGrupo);
  const acaoCancelarDono = statusGrupo === 'ativo' ? 'encerrar' : 'desistir';
  const [motivoEncerrar, setMotivoEncerrar] = useState('');

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      router.replace(`/auth/signin?callbackUrl=${encodeURIComponent(callbackPath)}`);
    }
  }, [status, router, callbackPath]);

  const isSystemAdmin = session?.user?.systemRole === 'admin';
  // 005-aprovacao-grupos (FR-019, T037): o dono edita o conteúdo só quando o Cotea pediu
  // ajustes, e salva reenviando para aprovação. Admin do sistema edita fora dos estados finais.
  const souDono = Boolean(session?.user?.id) && String(session.user.id) === String(adminIdExibicao);
  // Vale também para o dono que é admin do sistema (achado na validação T048): quem reenvia é o dono.
  const donoEmAjustes = souDono && statusGrupo === 'ajustes';
  const podeEditarConteudo = !grupoFinal && (isSystemAdmin || donoEmAjustes);
  const textoAjuste = grupo.moderacao?.ultimaDecisao?.acao === 'pedir_ajuste' ? grupo.moderacao.ultimaDecisao.texto : '';
  const canViewInternalNotes = session?.user?.systemRole !== 'user';
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [servicoPreAssinado, setServicoPreAssinado] = useState(Boolean(grupo.servicoPreAssinado));
  const [envioAutomaticoAcesso, setEnvioAutomaticoAcesso] = useState(Boolean(grupo.envioAutomaticoAcesso));
  const [filaEsperaAtiva, setFilaEsperaAtiva] = useState(Boolean(grupo.filaEsperaAtiva));
  const [necessitaAnalise, setNecessitaAnalise] = useState(Boolean(grupo.necessitaAnalise));
  const [observacoesInternas, setObservacoesInternas] = useState(grupo.observacoesInternas || '');
  const [beneficios, setBeneficios] = useState(parseLista(grupo.beneficios, []));
  const fidelidadeParsed = parseFidelidade(grupo.fidelidade);
  const [fidelidadePeriodo, setFidelidadePeriodo] = useState(fidelidadeParsed.periodo);
  const [fidelidadeRenovacao, setFidelidadeRenovacao] = useState(fidelidadeParsed.renovacao);
  const [fidelidadeObservacoes, setFidelidadeObservacoes] = useState(fidelidadeParsed.observacoes);
  const [regras, setRegras] = useState(parseLista(grupo.regras, []));
  const [faq, setFaq] = useState(parseFaq(grupo.faq));
  const [linkOficial, setLinkOficial] = useState(grupo.linkOficial || '');
  const [msg, setMsg] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [errors, setErrors] = useState({});

  const vagasDisponiveis = useMemo(() => {
    const cap = Number(capacidadeTotal) || 0;
    return Math.max(cap - VAGAS_DONO, 0);
  }, [capacidadeTotal]);

  // Previa pela mesma regra do servidor (lib/preco.js). T e C ficam so-leitura
  // nesta tela; alterar preco/capacidade pela UI e a V2-13 (003-preco-por-vaga, D-05).
  const preco = useMemo(
    () => calcularPrecoVaga({ valorTotal, capacidade: capacidadeTotal }),
    [valorTotal, capacidadeTotal]
  );

  // Retornos antecipados SEMPRE depois de todos os hooks (rules-of-hooks, B-07).
  if (status === 'loading') {
    return <div className="pt-[100px] p-6">Carregando sessao...</div>;
  }

  if (status === 'unauthenticated') {
    return <div className="pt-[100px] p-6">Redirecionando para login...</div>;
  }

  const validarUrl = (url) => /^https?:\/\/[\w.-]+(\/[\w\-./?%&=]*)?$/.test((url || '').trim());

  const validateForm = () => {
    const novoErrors = {};
    if (!nome.trim()) novoErrors.nome = 'Nome e obrigatorio.';
    if (!preco.valido) novoErrors.preco = preco.mensagem;
    if (!linkOficial || !validarUrl(linkOficial)) novoErrors.linkOficial = 'Informe uma URL valida (http/https).';
    if (!beneficios.length) novoErrors.beneficios = 'Adicione pelo menos 1 beneficio.';
    if (!regras.length) novoErrors.regras = 'Adicione pelo menos 1 regra.';
    if (!faq.length || faq.some((i) => !i.pergunta.trim() || !i.resposta.trim())) novoErrors.faq = 'FAQ precisa de pergunta e resposta.';
    if (!subtitulo.trim()) novoErrors.subtitulo = 'Subtitulo e obrigatorio.';
    if (!descricao.trim()) novoErrors.descricao = 'Descricao e obrigatoria.';
    if (!categoria) novoErrors.categoria = 'Escolha uma categoria.';
    setErrors(novoErrors);
    return Object.keys(novoErrors).length === 0;
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, imagem: 'Imagem deve ter ate 5MB.' }));
      return;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setErrors((prev) => ({ ...prev, imagem: 'Use JPG, PNG ou WebP.' }));
      return;
    }
    setErrors((prev) => ({ ...prev, imagem: undefined }));
    setImagemFile(file);
    setImagemPreview(URL.createObjectURL(file));
  };

  const adicionarItem = (setter, lista, valor) => {
    if (!valor.trim()) return;
    setter([...lista, valor.trim()]);
  };

  const removerItem = (setter, lista, index) => setter(lista.filter((_, i) => i !== index));

  const atualizarFaq = (index, campo, valor) => {
    setFaq((prev) => prev.map((item, i) => (i === index ? { ...item, [campo]: valor } : item)));
  };

  const adicionarFaq = () => setFaq([...faq, { pergunta: '', resposta: '' }]);
  const removerFaq = (index) => setFaq(faq.filter((_, i) => i !== index));

  // Cancelamento pelo dono (R-008): pedido pendente → `desistir`; grupo aprovado → `encerrar`.
  // O status nunca vai no PUT (FR-003).
  const handleCancelar = async () => {
    setSalvando(true);
    try {
      const res = await fetch(`/api/grupos/${grupo._id}/moderacao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: acaoCancelarDono, texto: motivoEncerrar.trim() || undefined }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Erro ao cancelar grupo.');
      }
      setSucesso(acaoCancelarDono === 'desistir' ? 'Pedido de aprovacao cancelado.' : 'Grupo cancelado.');
      setTimeout(() => router.push('/admin/grupos'), 1500);
    } catch (error) {
      setMsg(error.message || 'Erro ao cancelar grupo.');
    }
    setSalvando(false);
    setConfirmCancel(false);
  };

  const handleSalvar = async (e) => {
    e.preventDefault();
    if (!podeEditarConteudo) return;
    setMsg('');
    setSucesso('');
    if (!validateForm()) return;
    setSalvando(true);

    const payload = {
      nome,
      capa,
      imageUrl: capa,
      imageKey,
      // preco, vagas reservadas e disponiveis sao calculados no servidor
      valorTotal,
      descricao,
      capacidadeTotal: Number(capacidadeTotal) || 0,
      subtitulo,
      acesso,
      tempoEntrega,
      confiabilidade,
      categoria,
      tipoGrupo,
      // status/statusDetalhado não são enviados: o servidor os ignora (005, FR-003).
      servicoPreAssinado,
      envioAutomaticoAcesso,
      filaEsperaAtiva,
      necessitaAnalise,
      observacoesInternas,
      beneficios: beneficios.map((b) => b.trim()).filter(Boolean),
      fidelidadePeriodo,
      fidelidadeRenovacao,
      fidelidadeObservacoes,
      regras: regras.map((r) => r.trim()).filter(Boolean),
      faq: faq.map((f) => ({ pergunta: f.pergunta.trim(), resposta: f.resposta.trim() })),
      linkOficial: linkOficial?.trim() || '',
      adminId: grupo.adminIdString || grupo.adminId || '',
      adminEmail: grupo.adminEmail || '',
      adminNome: grupo.adminNome || grupo.admin?.nome || '',
      adminAvatar: grupo.adminAvatar || grupo.admin?.avatar || '',
      participantesIds: grupo.participantesIds || [],
    };

    try {
      const res = await fetch(`/api/grupos/${grupo._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Erro ao salvar grupo.');
      }

      if (imagemFile) {
        setUploadingImg(true);
        const formData = new FormData();
        formData.append('groupId', grupo._id);
        formData.append('file', imagemFile);
        const uploadRes = await fetch('/api/upload/group-image', { method: 'POST', body: formData });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData?.error || 'Erro ao enviar imagem');
        setCapa(uploadData.url);
        if (uploadData.key) setImageKey(uploadData.key);
      }

      if (donoEmAjustes) {
        // Reenvio volta o grupo para a fila com novo prazo de 2 dias úteis (FR-020).
        const reenvio = await fetch(`/api/grupos/${grupo._id}/moderacao`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'reenviar' }),
        });
        if (!reenvio.ok) {
          const errData = await reenvio.json().catch(() => ({}));
          throw new Error(`Alteracoes salvas, mas o reenvio falhou: ${errData.error || 'tente novamente'}`);
        }
        setSucesso('Grupo reenviado para aprovacao. O Cotea analisa em ate 2 dias uteis.');
        setTimeout(() => router.push(`/grupos/${grupo._id}`), 1500);
        setSalvando(false);
        setUploadingImg(false);
        return;
      }

      setSucesso('Grupo atualizado com sucesso!');
      setTimeout(() => router.push('/admin/grupos'), 1200);
    } catch (error) {
      setMsg(error.message || 'Erro ao salvar grupo.');
    }
    setSalvando(false);
    setUploadingImg(false);
  };

  return (
    <>
      <Header admin />
      <main className="pt-[100px] min-h-screen bg-gray-50">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Editar grupo</h1>
            {!isSystemAdmin && statusGrupo === 'em_aprovacao' && (
              <p className="text-sm rounded-lg border border-blue-200 bg-blue-50 text-blue-900 p-3" role="status">
                O grupo está em aprovação e não pode ser editado agora. Se o Cotea pedir ajustes, você poderá corrigir e reenviar.
              </p>
            )}
            {donoEmAjustes && (
              <div className="text-sm rounded-lg border border-amber-300 bg-amber-50 text-amber-900 p-3 space-y-1" role="status">
                <p className="font-semibold">O Cotea pediu ajustes neste grupo.</p>
                {textoAjuste && <p className="whitespace-pre-line">{textoAjuste}</p>}
                <p>Corrija os campos e use &quot;Salvar e reenviar para aprovacao&quot;. O prazo de 2 dias úteis recomeça no reenvio.</p>
              </div>
            )}
          </header>

          <form onSubmit={handleSalvar} className="space-y-6">
            <section className={sectionClass} aria-labelledby="identidade-heading">
              <div className="flex items-center gap-2">
                <h2 id="identidade-heading" className="text-lg font-semibold text-gray-900">
                  Identidade do grupo
                </h2>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-28 h-28 rounded-full bg-gray-100 overflow-hidden flex items-center justify-center border-2 border-dashed border-gray-300">
                    {imagemPreview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imagemPreview} alt="Preview da imagem do grupo" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-gray-400 text-sm">Preview</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => podeEditarConteudo && fileInputRef.current?.click()}
                    disabled={!podeEditarConteudo}
                    className={`px-4 py-2 rounded text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white ${podeEditarConteudo ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                    aria-label="Selecionar imagem do grupo"
                  >
                    {uploadingImg ? 'Enviando...' : 'Carregar imagem'}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  />
                  {errors.imagem && <p className={errorClass}>{errors.imagem}</p>}
                </div>
                <div className="flex-1 space-y-4">
                  <div className="space-y-1">
                    <label htmlFor="nome" className={labelClass}>
                      Nome do grupo *
                    </label>
                    <input
                      id="nome"
                      aria-required="true"
                      aria-invalid={!!errors.nome}
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      maxLength={80}
                    readOnly
                    disabled
                    className={`${inputBaseClass} border-gray-200 bg-gray-50`}
                    />
                    {errors.nome && <p className={errorClass}>{errors.nome}</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="subtitulo" className={labelClass}>
                        Subtitulo *
                      </label>
                      <input
                        id="subtitulo"
                        aria-required="true"
                        aria-invalid={!!errors.subtitulo}
                        value={subtitulo}
                        onChange={(e) => podeEditarConteudo && setSubtitulo(e.target.value)}
                        readOnly={!podeEditarConteudo}
                        disabled={!podeEditarConteudo}
                        className={`${inputBaseClass} border-gray-200 ${!podeEditarConteudo ? 'bg-gray-50' : ''}`}
                        maxLength={120}
                      />
                      {errors.subtitulo && <p className={errorClass}>{errors.subtitulo}</p>}
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="descricao" className={labelClass}>
                        Descricao *
                      </label>
                      <textarea
                        id="descricao"
                        aria-required="true"
                        aria-invalid={!!errors.descricao}
                        value={descricao}
                        onChange={(e) => podeEditarConteudo && setDescricao(e.target.value)}
                        readOnly={!podeEditarConteudo}
                        disabled={!podeEditarConteudo}
                        className={`${inputBaseClass} border-gray-200 ${!podeEditarConteudo ? 'bg-gray-50' : ''}`}
                        rows={3}
                        maxLength={240}
                      />
                      {errors.descricao && <p className={errorClass}>{errors.descricao}</p>}
                    </div>
                  </div>
                </div>
              </div>
            </section>
            <section className={sectionClass} aria-labelledby="admin-heading">
              <div className="flex items-center gap-2">
                <h2 id="admin-heading" className="text-lg font-semibold text-gray-900">
                  Administrador
                </h2>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-200 flex items-center justify-center text-xl font-bold text-gray-700 border">
                  {adminAvatarExibicao ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={adminAvatarExibicao} alt={`Avatar de ${adminNomeExibicao}`} className="w-full h-full object-cover" />
                  ) : (
                    adminInitial
                  )}
                </div>
                <div className="flex flex-col text-sm text-gray-700">
                  <span className="font-semibold text-gray-900">{adminNomeExibicao}</span>
                  {adminEmailExibicao && <span>{adminEmailExibicao}</span>}
                  {adminIdExibicao && <span className="text-gray-500 text-xs">ID: {adminIdExibicao}</span>}
                </div>
              </div>
            </section>

            <section className={sectionClass} aria-labelledby="categoria-heading">
              <div className="flex items-center gap-2">
                <h2 id="categoria-heading" className="text-lg font-semibold text-gray-900">
                  Categoria do grupo *
                </h2>
              </div>
              <p className={helperClass}>Escolha uma categoria (somente uma por grupo).</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {categoriasDisponiveis.map((item) => {
                  const selecionado = categoria === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => isSystemAdmin && setCategoria(item.id)}
                      disabled={!isSystemAdmin}
                      className={`flex flex-col items-center justify-center gap-2 border rounded-lg p-3 text-sm font-semibold transition ${
                        selecionado
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                      } ${!isSystemAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                      aria-pressed={selecionado}
                    >
                      <span className="text-2xl" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
              {errors.categoria && <p className={errorClass}>{errors.categoria}</p>}
            </section>

            <section className={sectionClass} aria-labelledby="assinatura-heading">
              <div className="flex items-center gap-2">
                <h2 id="assinatura-heading" className="text-lg font-semibold text-gray-900">
                  Informacoes da assinatura
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="valorTotal" className={labelClass}>
                    Valor total (R$) *
                  </label>
                  <input
                    id="valorTotal"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    aria-required="true"
                    aria-invalid={!!errors.valorTotal}
                    value={valorTotal}
                    readOnly
                    disabled
                    className={`${inputBaseClass} border-gray-200 bg-gray-50`}
                  />
                  {errors.valorTotal && <p className={errorClass}>{errors.valorTotal}</p>}
                </div>
                <div className="space-y-1">
                  <span className={labelClass}>Valor por vaga</span>
                  <PrevisaoPreco preco={preco} titulo="Preco por vaga (calculado)" />
                  {errors.preco && <p className={errorClass}>{errors.preco}</p>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label htmlFor="capacidade" className={labelClass}>
                    Capacidade total *
                  </label>
                  <input
                    id="capacidade"
                    type="number"
                    min="0"
                    aria-required="true"
                    aria-invalid={!!errors.capacidadeTotal}
                    value={capacidadeTotal}
                    readOnly
                    disabled
                    className={`${inputBaseClass} border-gray-200 bg-gray-50`}
                  />
                  {errors.capacidadeTotal && <p className={errorClass}>{errors.capacidadeTotal}</p>}
                </div>
                <div className="space-y-1">
                  <label htmlFor="reservadas" className={labelClass}>
                    Vagas reservadas (dono)
                  </label>
                  <input
                    id="reservadas"
                    value={`${VAGAS_DONO} (vaga do dono)`}
                    readOnly
                    aria-readonly="true"
                    className={`${inputBaseClass} border-gray-200 bg-gray-50`}
                  />
                  <p className={helperClass}>Sempre 1: a vaga do dono, que nao paga taxa.</p>
                </div>
                <div className="space-y-1">
                  <label htmlFor="vagas" className={labelClass}>
                    Vagas disponiveis
                  </label>
                  <input
                    id="vagas"
                    value={vagasDisponiveis}
                    readOnly
                    className={`${inputBaseClass} ${errors.vagasDisponiveis ? 'border-red-500' : 'border-gray-200'} bg-gray-50`}
                    aria-readonly="true"
                  />
                  <p className={helperClass}>Capacidade - vagas reservadas.</p>
                  {errors.vagasDisponiveis && <p className={errorClass}>{errors.vagasDisponiveis}</p>}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className={labelClass}>Tipo de acesso</label>
                  <p className={helperClass}>Escolha como o acesso sera liberado.</p>
                  <div className="grid grid-cols-2 gap-3">
                    {acessosDisponiveis.map((item) => {
                      const selecionado = acesso === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => isSystemAdmin && setAcesso(item.id)}
                          disabled={!isSystemAdmin}
                          className={`flex flex-col items-center justify-center gap-2 border rounded-lg p-3 text-sm font-semibold transition ${
                            selecionado
                              ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                              : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                          } ${!isSystemAdmin ? 'opacity-60 cursor-not-allowed' : ''}`}
                          aria-pressed={selecionado}
                        >
                          <span className="text-2xl" aria-hidden="true">
                            {item.icon}
                          </span>
                          <span className="text-center leading-tight">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="tempoEntrega" className={labelClass}>
                    Tempo estimado de entrega
                  </label>
                  <input
                    id="tempoEntrega"
                    value={tempoEntrega}
                    onChange={(e) => isSystemAdmin && setTempoEntrega(e.target.value)}
                    readOnly={!isSystemAdmin}
                    disabled={!isSystemAdmin}
                    className={`${inputBaseClass} border-gray-200 ${!isSystemAdmin ? 'bg-gray-50' : ''}`}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="status" className={labelClass}>
                    Estado de moderação
                  </label>
                  <input
                    id="status"
                    type="text"
                    value={ROTULOS_STATUS_GRUPO[statusGrupo] || statusGrupo}
                    readOnly
                    disabled
                    className={`${inputBaseClass} border-gray-200 bg-gray-50`}
                  />
                  <p className="text-xs text-gray-500">Muda pelas ações de moderação, não por esta tela.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label htmlFor="tipoGrupo" className={labelClass}>
                    Tipo do grupo
                  </label>
                  <select
                    id="tipoGrupo"
                    value={tipoGrupo}
                    onChange={(e) => isSystemAdmin && setTipoGrupo(e.target.value)}
                    disabled={!isSystemAdmin}
                    className={`${inputBaseClass} border-gray-200 ${!isSystemAdmin ? 'bg-gray-50' : ''}`}
                  >
                    <option value="publico">Publico</option>
                    <option value="privado">Privado</option>
                    <option value="pre_cadastrado">Pre-cadastrado</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className={`flex items-center gap-2 text-sm ${!isSystemAdmin ? 'text-gray-400' : 'text-gray-800'}`}>
                  <input type="checkbox" checked={servicoPreAssinado} onChange={(e) => isSystemAdmin && setServicoPreAssinado(e.target.checked)} disabled={!isSystemAdmin} />
                  Servico pre-assinado
                </label>
                <label className={`flex items-center gap-2 text-sm ${!isSystemAdmin ? 'text-gray-400' : 'text-gray-800'}`}>
                  <input type="checkbox" checked={envioAutomaticoAcesso} onChange={(e) => isSystemAdmin && setEnvioAutomaticoAcesso(e.target.checked)} disabled={!isSystemAdmin} />
                  Envio automatico de acesso
                </label>
                <label className={`flex items-center gap-2 text-sm ${!isSystemAdmin ? 'text-gray-400' : 'text-gray-800'}`}>
                  <input type="checkbox" checked={filaEsperaAtiva} onChange={(e) => isSystemAdmin && setFilaEsperaAtiva(e.target.checked)} disabled={!isSystemAdmin} />
                  Fila de espera ativa
                </label>
                <label className={`flex items-center gap-2 text-sm ${!isSystemAdmin ? 'text-gray-400' : 'text-gray-800'}`}>
                  <input type="checkbox" checked={necessitaAnalise} onChange={(e) => isSystemAdmin && setNecessitaAnalise(e.target.checked)} disabled={!isSystemAdmin} />
                  Necessita analise
                </label>
              </div>
              {canViewInternalNotes && (
                <div className="space-y-1">
                  <label htmlFor="observacoesInternas" className={labelClass}>
                    Observacoes internas
                    {!isSystemAdmin && <span className="text-xs font-normal text-gray-400">(somente leitura)</span>}
                  </label>
                  <textarea
                    id="observacoesInternas"
                    value={observacoesInternas}
                    onChange={(e) => isSystemAdmin && setObservacoesInternas(e.target.value)}
                    readOnly={!isSystemAdmin}
                    disabled={!isSystemAdmin}
                    className={`${inputBaseClass} border-gray-200 ${!isSystemAdmin ? 'bg-gray-50' : ''}`}
                    rows={2}
                  />
                </div>
              )}
            </section>

            <section className={sectionClass} aria-labelledby="conteudos-heading">
              <div className="flex items-center gap-2">
                <h2 id="conteudos-heading" className="text-lg font-semibold text-gray-900">
                  Conteudos do grupo
                </h2>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Beneficios *</label>
                  {podeEditarConteudo && (
                    <button
                      type="button"
                      onClick={() => adicionarItem(setBeneficios, beneficios, prompt('Novo beneficio') || '')}
                      className="text-sm text-blue-600 hover:underline"
                      aria-label="Adicionar beneficio"
                    >
                      + adicionar
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {beneficios.map((b, idx) => (
                    <div key={`beneficio-${idx}`} className="flex items-center gap-2">
                      <input
                        aria-label={`Beneficio ${idx + 1}`}
                        value={b}
                        onChange={(e) =>
                          podeEditarConteudo && setBeneficios(beneficios.map((item, i) => (i === idx ? e.target.value : item)))
                        }
                        readOnly={!podeEditarConteudo}
                        disabled={!podeEditarConteudo}
                        className={`${inputBaseClass} ${errors.beneficios ? 'border-red-500' : 'border-gray-200'} ${!podeEditarConteudo ? 'bg-gray-50' : ''}`}
                      />
                      {podeEditarConteudo && (
                        <button
                          type="button"
                          onClick={() => removerItem(setBeneficios, beneficios, idx)}
                          className="px-3 py-2 text-sm rounded bg-gray-100 hover:bg-gray-200"
                          aria-label="Remover beneficio"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {errors.beneficios && <p className={errorClass}>{errors.beneficios}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label htmlFor="fidelidade-periodo" className={labelClass}>
                    Fidelidade - periodo
                  </label>
                  <select
                    id="fidelidade-periodo"
                    value={fidelidadePeriodo}
                    onChange={(e) => podeEditarConteudo && setFidelidadePeriodo(e.target.value)}
                    disabled={!podeEditarConteudo}
                    className={`${inputBaseClass} border-gray-200 ${!podeEditarConteudo ? 'bg-gray-50' : ''}`}
                  >
                    <option>1 mes</option>
                    <option>3 meses</option>
                    <option>6 meses</option>
                    <option>12 meses</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Renovacao automatica</label>
                  <div className="flex items-center gap-2">
                    <input
                      id="renovacao"
                      type="checkbox"
                      checked={fidelidadeRenovacao}
                      onChange={(e) => podeEditarConteudo && setFidelidadeRenovacao(e.target.checked)}
                      disabled={!podeEditarConteudo}
                      className="h-4 w-4"
                    />
                    <label htmlFor="renovacao" className="text-sm text-gray-700">
                      Ativar
                    </label>
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="fidelidade-observacoes" className={labelClass}>
                    Observacoes
                  </label>
                  <input
                    id="fidelidade-observacoes"
                    value={fidelidadeObservacoes}
                    onChange={(e) => podeEditarConteudo && setFidelidadeObservacoes(e.target.value)}
                    readOnly={!podeEditarConteudo}
                    disabled={!podeEditarConteudo}
                    className={`${inputBaseClass} border-gray-200 ${!podeEditarConteudo ? 'bg-gray-50' : ''}`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Regras *</label>
                  {podeEditarConteudo && (
                    <button
                      type="button"
                      onClick={() => adicionarItem(setRegras, regras, prompt('Nova regra') || '')}
                      className="text-sm text-blue-600 hover:underline"
                      aria-label="Adicionar regra"
                    >
                      + adicionar
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {regras.map((regra, idx) => (
                    <div key={`regra-${idx}`} className="flex items-center gap-2 bg-gray-100 px-3 py-2 rounded-full">
                      <input
                        aria-label={`Regra ${idx + 1}`}
                        value={regra}
                        onChange={(e) =>
                          podeEditarConteudo && setRegras(regras.map((item, i) => (i === idx ? e.target.value : item)))
                        }
                        readOnly={!podeEditarConteudo}
                        disabled={!podeEditarConteudo}
                        className={`bg-transparent focus:outline-none text-sm w-40 ${!podeEditarConteudo ? 'cursor-default' : ''}`}
                      />
                      {podeEditarConteudo && (
                        <button
                          type="button"
                          onClick={() => removerItem(setRegras, regras, idx)}
                          className="text-gray-600 hover:text-gray-900"
                          aria-label="Remover regra"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {errors.regras && <p className={errorClass}>{errors.regras}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="linkOficial" className={labelClass}>
                  Link oficial do servico *
                </label>
                <input
                  id="linkOficial"
                  aria-required="true"
                  aria-invalid={!!errors.linkOficial}
                  value={linkOficial}
                  onChange={(e) => podeEditarConteudo && setLinkOficial(e.target.value)}
                  readOnly={!podeEditarConteudo}
                  disabled={!podeEditarConteudo}
                  className={`${inputBaseClass} ${errors.linkOficial ? 'border-red-500' : 'border-gray-200'} ${!podeEditarConteudo ? 'bg-gray-50' : ''}`}
                />
                <p className={helperClass}>URL completa (http/https).</p>
                {errors.linkOficial && <p className={errorClass}>{errors.linkOficial}</p>}
              </div>
            </section>

            <section className={sectionClass} aria-labelledby="participantes-heading">
              <div className="flex items-center gap-2">
                <h2 id="participantes-heading" className="text-lg font-semibold text-gray-900">
                  Participantes
                </h2>
              </div>
              <div className="space-y-3">
                <p className="text-sm text-gray-600">Lista somente leitura. O administrador nao gerencia participantes por aqui.</p>
                {participantes.length ? (
                  <ul className="divide-y divide-gray-200 border border-gray-100 rounded-lg">
                    {participantes.map((p, idx) => (
                      <li key={p.userId || p._id || idx} className="flex items-center gap-3 p-3">
                        <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center text-sm font-semibold text-gray-700">
                          {p.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.image} alt={p.nome || 'Participante'} className="w-full h-full object-cover" />
                          ) : (
                            (p.nome?.[0] || 'P').toUpperCase()
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-gray-900">{p.nome || 'Participante'}</p>
                          <p className="text-xs text-gray-600">
                            {p.email || 'Email nao informado'} • {p.status || 'ativo'}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-blue-600 uppercase tracking-wide">{p.papel}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">Nenhum participante ainda.</p>
                )}
              </div>
            </section>

            <section className={sectionClass} aria-labelledby="faq-heading">
              <div className="flex items-center gap-2">
                <h2 id="faq-heading" className="text-lg font-semibold text-gray-900">
                  FAQ
                </h2>
              </div>
              <div className="space-y-4">
                {faq.map((item, idx) => (
                  <div key={`faq-${idx}`} className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 border border-gray-200 rounded-lg bg-gray-50">
                    <div className="space-y-1">
                      <label className={labelClass}>Pergunta *</label>
                      <input
                        aria-required="true"
                        value={item.pergunta}
                        onChange={(e) => podeEditarConteudo && atualizarFaq(idx, 'pergunta', e.target.value)}
                        readOnly={!podeEditarConteudo}
                        disabled={!podeEditarConteudo}
                        className={`${inputBaseClass} ${errors.faq ? 'border-red-500' : 'border-gray-200'} ${!podeEditarConteudo ? 'bg-gray-50' : ''}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Resposta *</label>
                      <input
                        aria-required="true"
                        value={item.resposta}
                        onChange={(e) => podeEditarConteudo && atualizarFaq(idx, 'resposta', e.target.value)}
                        readOnly={!podeEditarConteudo}
                        disabled={!podeEditarConteudo}
                        className={`${inputBaseClass} ${errors.faq ? 'border-red-500' : 'border-gray-200'} ${!podeEditarConteudo ? 'bg-gray-50' : ''}`}
                      />
                    </div>
                    {podeEditarConteudo && (
                      <div className="sm:col-span-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removerFaq(idx)}
                          className="text-sm text-red-600 hover:underline"
                          aria-label="Remover pergunta"
                        >
                          Remover
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {podeEditarConteudo && (
                  <button
                    type="button"
                    onClick={adicionarFaq}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    + adicionar pergunta
                  </button>
                )}
                {errors.faq && <p className={errorClass}>{errors.faq}</p>}
              </div>
            </section>

            <div className="sticky bottom-0 bg-gray-50 py-4 border-t border-gray-200">
              <div className="max-w-5xl mx-auto space-y-3">
                {grupoFinal ? (
                  <p className="text-sm text-gray-600">
                    Este grupo está {ROTULOS_STATUS_GRUPO[statusGrupo]?.toLowerCase() || statusGrupo} e não pode mais ser alterado.
                  </p>
                ) : podeEditarConteudo ? (
                  <button
                    type="submit"
                    className="w-full bg-green-600 text-white py-3 rounded-lg text-lg font-semibold hover:bg-green-700 transition disabled:bg-green-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                    disabled={salvando}
                    aria-busy={salvando}
                  >
                    {salvando ? 'Salvando...' : donoEmAjustes ? 'Salvar e reenviar para aprovacao' : 'Salvar alteracoes'}
                  </button>
                ) : confirmCancel ? (
                  <div className="bg-red-50 border border-red-300 rounded-lg p-4 space-y-3">
                    <p className="text-red-700 text-sm font-semibold">
                      {acaoCancelarDono === 'desistir' ? 'Cancelar o pedido de aprovação?' : 'Confirmar cancelamento do grupo?'}
                    </p>
                    <p className="text-red-600 text-xs">
                      {acaoCancelarDono === 'desistir'
                        ? 'O grupo sai da fila de aprovação e fica cancelado. Esta ação não pode ser desfeita.'
                        : 'Esta ação alterará o status do grupo para cancelado. Os membros perderão o acesso e serão avisados.'}
                    </p>
                    {acaoCancelarDono === 'encerrar' && (
                      <div className="space-y-1">
                        <label htmlFor="motivoEncerrar" className="text-xs font-medium text-red-700">Motivo (opcional, enviado aos membros)</label>
                        <textarea
                          id="motivoEncerrar"
                          value={motivoEncerrar}
                          onChange={(e) => setMotivoEncerrar(e.target.value)}
                          maxLength={1000}
                          rows={2}
                          className="w-full border border-red-200 rounded p-2 text-sm"
                        />
                      </div>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={handleCancelar}
                        disabled={salvando}
                        className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500"
                      >
                        {salvando ? 'Cancelando...' : 'Confirmar cancelamento'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmCancel(false)}
                        disabled={salvando}
                        className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-semibold hover:bg-gray-300 disabled:opacity-50"
                      >
                        Voltar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmCancel(true)}
                    className="w-full bg-red-600 text-white py-3 rounded-lg text-lg font-semibold hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  >
                    Cancelar grupo
                  </button>
                )}
                {sucesso && <p className="text-green-700 text-sm">{sucesso}</p>}
                {msg && !sucesso && <p className="text-red-600 text-sm">{msg}</p>}
              </div>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}

export async function getServerSideProps({ params, req, res }) {
  // Autorizacao no servidor (constitution I): nada do grupo vai nos props sem permissao.
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return resolverPaginaEdicaoGrupo({ db: null, session, id: params.id });
  try {
    const client = await clientPromise;
    const db = client.db(process.env.MONGODB_DB);
    return await resolverPaginaEdicaoGrupo({ db, session, id: params.id });
  } catch (error) {
    return { notFound: true };
  }
}

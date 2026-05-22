
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import Header from '../../../components/Header';

export default function NovoGrupo() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const fileInputRef = useRef(null);
  const [nome, setNome] = useState('');
  const [capa, setCapa] = useState('');
  const [imagemPreview, setImagemPreview] = useState('');
  const [imagemFile, setImagemFile] = useState(null);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [imageKey, setImageKey] = useState('');
  const [valorTotal, setValorTotal] = useState('');
  const [valorPorVaga, setValorPorVaga] = useState('');
  const [descricao, setDescricao] = useState('');
  const [capacidadeTotal, setCapacidadeTotal] = useState('2');
  const [subtitulo, setSubtitulo] = useState('');
  const [acesso, setAcesso] = useState('imediato');
  const [tempoEntrega, setTempoEntrega] = useState('Ate 5 dias (geralmente mais rapido)');
  const [confiabilidade] = useState('Selo ouro');
  const [tipoGrupo, setTipoGrupo] = useState('publico');
  const [categoria, setCategoria] = useState('jogos');
  const [statusGrupo, setStatusGrupo] = useState('ativo');
  const [statusDetalhado, setStatusDetalhado] = useState('em_formacao');
  const [servicoPreAssinado, setServicoPreAssinado] = useState(false);
  const [envioAutomaticoAcesso, setEnvioAutomaticoAcesso] = useState(false);
  const [filaEsperaAtiva, setFilaEsperaAtiva] = useState(false);
  const [necessitaAnalise, setNecessitaAnalise] = useState(false);
  const [observacoesInternas, setObservacoesInternas] = useState('');
  const [beneficios, setBeneficios] = useState([
    'Armazenamento 2 TB compartilhado',
    'Contas individuais preservam privacidade',
    'Pagamento mensal',
    'Grupo ja esta ativo',
    'Administrador confiavel',
    'Envio de acesso rapido',
  ]);
  const [fidelidadePeriodo, setFidelidadePeriodo] = useState('12 meses');
  const [fidelidadeRenovacao, setFidelidadeRenovacao] = useState(true);
  const [fidelidadeObservacoes, setFidelidadeObservacoes] = useState('Renovacao automatica. Proxima renovacao: 22/05/2026');
  const [regras, setRegras] = useState(['Nao compartilhar senha', 'Nao postar em nome do administrador', 'Nao alterar senha']);
  const [faq, setFaq] = useState([
    { pergunta: 'Quando terei acesso ao servico?', resposta: 'O acesso e enviado em ate 5 dias, normalmente no mesmo dia.' },
    { pergunta: 'Quais formas de pagamento?', resposta: 'Pix ou cartao pelos metodos do administrador do grupo.' },
    { pergunta: 'O que e caucao?', resposta: 'Valor de seguranca em casos especificos; avisaremos antes se for necessario.' },
    { pergunta: 'Com quem posso dividir assinaturas?', resposta: 'Apenas com membros aprovados pelo administrador do grupo.' },
  ]);
  const [linkOficial, setLinkOficial] = useState('https://one.google.com/');
  const [participantes] = useState([]);
  const [msg, setMsg] = useState('');
  const [sucesso, setSucesso] = useState('');
  const [criando, setCriando] = useState(false);
  const [errors, setErrors] = useState({});

  const VAGAS_RESERVADAS_ADMIN = 1;
  const vagasDisponiveis = useMemo(() => {
    const cap = Number(capacidadeTotal);
    if (Number.isNaN(cap)) return 0;
    return Math.max(cap - VAGAS_RESERVADAS_ADMIN, 0);
  }, [capacidadeTotal]);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (sessionStatus === 'unauthenticated') {
      router.replace(`/auth/signin?callbackUrl=${encodeURIComponent('/admin/grupos/novo')}`);
    }
  }, [sessionStatus, router]);

  if (sessionStatus === 'loading') {
    return <div className="pt-[100px] p-6">Carregando sessao...</div>;
  }

  if (sessionStatus === 'unauthenticated') {
    return <div className="pt-[100px] p-6">Redirecionando para login...</div>;
  }
  useEffect(() => {
    if (!valorTotal) {
      setValorPorVaga('');
      return;
    }
    const totalNumero = Number(valorTotal);
    const capacidadeNumero = Number(capacidadeTotal);
    const divisor = Number.isNaN(capacidadeNumero) ? 0 : capacidadeNumero;
    if (Number.isNaN(totalNumero) || totalNumero <= 0 || divisor <= 0) {
      setValorPorVaga('');
      return;
    }
    const calculado = totalNumero / divisor;
    if (!Number.isFinite(calculado) || calculado <= 0) {
      setValorPorVaga('');
      return;
    }
    setValorPorVaga(calculado.toFixed(2));
  }, [valorTotal, capacidadeTotal]);

  const validarUrl = (url) => /^https?:\/\/[\w.-]+(\/[\w\-./?%&=]*)?$/.test(url.trim());

  const validateForm = () => {
    const novoErrors = {};
    if (!nome.trim()) novoErrors.nome = 'Nome e obrigatorio.';
    if (!categoria) novoErrors.categoria = 'Escolha uma categoria.';
    const valorTotalNumero = Number(valorTotal);
    if (!valorTotal || Number.isNaN(valorTotalNumero) || valorTotalNumero <= 0)
      novoErrors.valorTotal = 'Informe o valor total da assinatura.';
    const cap = Number(capacidadeTotal);
    if (Number.isNaN(cap)) {
      novoErrors.capacidadeTotal = 'Capacidade deve ser numero.';
    } else if (cap < 2) {
      novoErrors.capacidadeTotal = 'Capacidade minima de 2 (1 admin + 1 membro).';
    }
    const valorPorVagaNumero = Number(valorPorVaga);
    if (!valorPorVaga || Number.isNaN(valorPorVagaNumero) || valorPorVagaNumero <= 0) {
      novoErrors.valorPorVaga = 'Valor por vaga e calculado (valor total / capacidade total). Confira valor total e capacidade.';
    }
    if (!linkOficial || !validarUrl(linkOficial)) novoErrors.linkOficial = 'Informe uma URL valida (http/https).';
    const beneficiosValidos = beneficios.some((b) => b.trim());
    if (!beneficiosValidos) novoErrors.beneficios = 'Adicione pelo menos 1 beneficio.';
    const regrasValidas = regras.some((r) => r.trim());
    if (!regrasValidas) novoErrors.regras = 'Adicione pelo menos 1 regra.';
    if (!faq.length || faq.some((item) => !item.pergunta.trim() || !item.resposta.trim())) novoErrors.faq = 'Preencha pergunta e resposta.';
    if (imagemFile && imagemFile.size > 5 * 1024 * 1024) novoErrors.imagem = 'Imagem deve ter ate 5MB.';
    if (imagemFile && !['image/png', 'image/jpeg', 'image/webp'].includes(imagemFile.type)) novoErrors.imagem = 'Use JPG, PNG ou WebP.';
    if (!descricao.trim()) novoErrors.descricao = 'Descricao e obrigatoria.';
    if (!subtitulo.trim()) novoErrors.subtitulo = 'Subtitulo e obrigatorio.';
    setErrors(novoErrors);
    return Object.keys(novoErrors).length === 0;
  };
  const handleCriar = async (e) => {
    e.preventDefault();
    setMsg('');
    setSucesso('');
    const valido = validateForm();
    if (!valido) {
      setMsg('Corrija os campos destacados antes de continuar.');
      return;
    }
    setCriando(true);
    const beneficiosText = beneficios.map((b) => b.trim()).filter(Boolean).join('\n');
    const fidelidadeText = [
      fidelidadePeriodo ? `Periodo: ${fidelidadePeriodo}` : '',
      fidelidadeRenovacao ? 'Renovacao automatica' : 'Sem renovacao automatica',
      fidelidadeObservacoes.trim(),
    ]
      .filter(Boolean)
      .join('\n');
    const regrasText = regras.map((r) => r.trim()).filter(Boolean).join('\n');
    const faqText = faq
      .filter((f) => f.pergunta.trim() && f.resposta.trim())
      .map((f) => `${f.pergunta.trim()}|${f.resposta.trim()}`)
      .join('\n');
    const usuarioId = session?.user?.id || session?.user?._id || session?.user?.sub || '';
    const adminId = usuarioId && typeof usuarioId === 'string' ? usuarioId : '';

    const payload = {
      nome,
      tipoGrupo,
      status: statusGrupo,
      statusDetalhado,
      capa,
      imageUrl: capa,
      imageKey,
      valorTotal: parseFloat(valorTotal),
      valorPorVaga: parseFloat(valorPorVaga),
      descricao,
      capacidadeTotal: Number(capacidadeTotal) || 0,
      vagasReservadasAdmin: VAGAS_RESERVADAS_ADMIN,
      vagasDisponiveis,
      servicoPreAssinado,
      envioAutomaticoAcesso,
      filaEsperaAtiva,
      necessitaAnalise,
      observacoesInternas,
      subtitulo,
      acesso,
      tempoEntrega,
      confiabilidade,
      categoria,
      beneficios: beneficiosText,
      fidelidadePeriodo,
      fidelidadeRenovacao,
      fidelidadeObservacoes,
      regras: regrasText,
      faq: faqText,
      linkOficial: linkOficial?.trim() || null,
      adminId,
      participantesIds: [],
    };

    try {
      const res = await fetch('/api/grupos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Erro ao criar grupo.');
      }

      const data = await res.json();

      if (imagemFile && data?._id) {
        setUploadingImg(true);
        const formData = new FormData();
        formData.append('groupId', data._id);
        formData.append('file', imagemFile);
        const uploadRes = await fetch('/api/upload/group-image', {
          method: 'POST',
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData?.error || 'Erro ao enviar imagem');
        setCapa(uploadData.url);
        setImagemPreview(uploadData.url);
        if (uploadData.key) setImageKey(uploadData.key);
      }

      setMsg('Grupo criado com sucesso!');
      setSucesso('Grupo criado com sucesso!');
      setTimeout(() => router.push('/admin/grupos'), 1500);
    } catch (error) {
      setMsg(error.message || 'Erro ao criar grupo.');
    }
    setCriando(false);
    setUploadingImg(false);
  };

  const adicionarItem = (listaSetter, lista, valor) => {
    if (valor === '') {
      listaSetter([...lista, '']);
      return;
    }
    if (!valor.trim()) return;
    listaSetter([...lista, valor.trim()]);
  };

  const removerItem = (listaSetter, lista, index) => {
    listaSetter(lista.filter((_, i) => i !== index));
  };

  const atualizarFaq = (index, campo, valor) => {
    setFaq((prev) => prev.map((item, i) => (i === index ? { ...item, [campo]: valor } : item)));
  };

  const adicionarFaq = () => setFaq([...faq, { pergunta: '', resposta: '' }]);
  const removerFaq = (index) => setFaq(faq.filter((_, i) => i !== index));

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

  const inputBaseClass =
    'w-full p-3 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 transition';
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
  return (
    <>
      <Header admin />

      <main className="pt-[100px] min-h-screen bg-gray-50">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-bold text-gray-900">Criar novo grupo</h1>
            <p className="text-gray-600">Preencha as seções com os dados do grupo. Campos com * são obrigatórios.</p>
          </header>

          <form onSubmit={handleCriar} className="space-y-6" aria-label="Formulario de criacao de grupo">
            <section className={sectionClass} aria-labelledby="identidade-heading">
              <div className="flex items-center gap-2">
                <span role="img" aria-hidden="true">
                  ??
                </span>
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
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 rounded bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-white"
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
                  <p className={helperClass}>JPG/PNG/WebP, até 5MB.</p>
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
                      className={`${inputBaseClass} ${errors.nome ? 'border-red-500' : 'border-gray-200'}`}
                      maxLength={80}
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Nome visível na listagem.</span>
                      <span>{nome.length}/80</span>
                    </div>
                    {errors.nome && <p className={errorClass}>{errors.nome}</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label htmlFor="subtitulo" className={labelClass}>
                        Subtítulo *
                      </label>
                      <input
                        id="subtitulo"
                        aria-required="true"
                        aria-invalid={!!errors.subtitulo}
                        value={subtitulo}
                        onChange={(e) => setSubtitulo(e.target.value)}
                        className={`${inputBaseClass} ${errors.subtitulo ? 'border-red-500' : 'border-gray-200'}`}
                        maxLength={120}
                      />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Ex.: Premium Anual - 2 TB.</span>
                        <span>{subtitulo.length}/120</span>
                      </div>
                      {errors.subtitulo && <p className={errorClass}>{errors.subtitulo}</p>}
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="descricao" className={labelClass}>
                        Descrição *
                      </label>
                      <textarea
                        id="descricao"
                        aria-required="true"
                        aria-invalid={!!errors.descricao}
                        value={descricao}
                        onChange={(e) => setDescricao(e.target.value)}
                        className={`${inputBaseClass} ${errors.descricao ? 'border-red-500' : 'border-gray-200'}`}
                        rows={3}
                        maxLength={240}
                      />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Resumo curto do que o grupo oferece.</span>
                        <span>{descricao.length}/240</span>
                      </div>
                      {errors.descricao && <p className={errorClass}>{errors.descricao}</p>}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className={sectionClass} aria-labelledby="categoria-heading">
              <div className="flex items-center gap-2">
                <span role="img" aria-hidden="true">
                  🏷️
                </span>
                <h2 id="categoria-heading" className="text-lg font-semibold text-gray-900">
                  Categoria do grupo *
                </h2>
              </div>
              <p className={helperClass}>Escolha uma categoria. Apenas uma pode ser selecionada.</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {categoriasDisponiveis.map((item) => {
                  const selecionado = categoria === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setCategoria(item.id)}
                      className={`flex flex-col items-center justify-center gap-2 border rounded-lg p-3 text-sm font-semibold transition ${
                        selecionado
                          ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                      }`}
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
                <span role="img" aria-hidden="true">
                  ??
                </span>
                <h2 id="assinatura-heading" className="text-lg font-semibold text-gray-900">
                  Informações da assinatura
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
                    onChange={(e) => setValorTotal(e.target.value)}
                    className={`${inputBaseClass} ${errors.valorTotal ? 'border-red-500' : 'border-gray-200'}`}
                  />
                  {errors.valorTotal && <p className={errorClass}>{errors.valorTotal}</p>}
                </div>
                <div className="space-y-1">
                  <label htmlFor="valorPorVaga" className={labelClass}>
                    Valor por vaga (R$) *
                  </label>
                  <input
                    id="valorPorVaga"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    aria-required="true"
                    aria-invalid={!!errors.valorPorVaga}
                    value={valorPorVaga}
                    readOnly
                    aria-readonly="true"
                    placeholder="Calculado automaticamente"
                    className={`${inputBaseClass} ${errors.valorPorVaga ? 'border-red-500' : 'border-gray-200 bg-gray-50'}`}
                  />
                  <p className={helperClass}>Calculado automaticamente: valor total / capacidade total (inclui vaga do admin).</p>
                  {errors.valorPorVaga && <p className={errorClass}>{errors.valorPorVaga}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor="capacidade" className={labelClass}>
                    Capacidade total *
                  </label>
                  <input
                    id="capacidade"
                    type="number"
                    min="2"
                    aria-required="true"
                    aria-invalid={!!errors.capacidadeTotal}
                    value={capacidadeTotal}
                    onChange={(e) => setCapacidadeTotal(e.target.value)}
                    onBlur={() => {
                      const numero = Number(capacidadeTotal);
                      if (Number.isNaN(numero) || numero < 2) {
                        setCapacidadeTotal('2');
                      }
                    }}
                    className={`${inputBaseClass} ${errors.capacidadeTotal ? 'border-red-500' : 'border-gray-200'}`}
                  />
                  <p className={helperClass}>Minimo 2 vagas: 1 do administrador + ao menos 1 para membro.</p>
                  {errors.capacidadeTotal && <p className={errorClass}>{errors.capacidadeTotal}</p>}
                </div>
                <div className="space-y-1">
                  <label htmlFor="vagasReservadasAdmin" className={labelClass}>
                    Vagas reservadas (admin)
                  </label>
                  <input
                    id="vagasReservadasAdmin"
                    type="number"
                    min="1"
                    value={VAGAS_RESERVADAS_ADMIN}
                    readOnly
                    aria-readonly="true"
                    className={`${inputBaseClass} border-gray-200 bg-gray-50`}
                  />
                  <p className={helperClass}>Sempre 1 vaga destinada ao administrador.</p>
                </div>
                <div className="space-y-1">
                  <label htmlFor="vagas" className={labelClass}>
                    Vagas disponiveis
                  </label>
                  <input
                    id="vagas"
                    value={vagasDisponiveis}
                    readOnly
                    className={`${inputBaseClass} border-gray-200 bg-gray-50`}
                    aria-readonly="true"
                  />
                  <p className={helperClass}>Calculado (capacidade total - vaga do administrador).</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                          onClick={() => setAcesso(item.id)}
                          className={`flex flex-col items-center justify-center gap-2 border rounded-lg p-3 text-sm font-semibold transition ${
                            selecionado
                              ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm'
                              : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                          }`}
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
              </div>
            </section>
            <section className={sectionClass} aria-labelledby="conteudos-heading">
              <div className="flex items-center gap-2">
                <span role="img" aria-hidden="true">
                  ??
                </span>
                <h2 id="conteudos-heading" className="text-lg font-semibold text-gray-900">
                  Conteúdos do grupo
                </h2>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Benefícios *</label>
                  <button
                    type="button"
                    onClick={() => adicionarItem(setBeneficios, beneficios, '')}
                    className="text-sm text-blue-600 hover:underline"
                    aria-label="Adicionar beneficio"
                  >
                    + adicionar
                  </button>
                </div>
                <div className="space-y-2">
                  {beneficios.map((b, idx) => (
                    <div key={`beneficio-${idx}`} className="flex items-center gap-2">
                      <input
                        aria-label={`Beneficio ${idx + 1}`}
                        value={b}
                        onChange={(e) =>
                          setBeneficios(beneficios.map((item, i) => (i === idx ? e.target.value : item)))
                        }
                        className={`${inputBaseClass} ${errors.beneficios ? 'border-red-500' : 'border-gray-200'}`}
                      />
                      <button
                        type="button"
                        onClick={() => removerItem(setBeneficios, beneficios, idx)}
                        className="px-3 py-2 text-sm rounded bg-gray-100 hover:bg-gray-200"
                        aria-label="Remover beneficio"
                      >
                        ?
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => adicionarItem(setBeneficios, beneficios, 'Novo beneficio')}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    + adicionar beneficio
                  </button>
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
                    onChange={(e) => setFidelidadePeriodo(e.target.value)}
                    className={`${inputBaseClass} border-gray-200`}
                  >
                    <option>1 mes</option>
                    <option>3 meses</option>
                    <option>6 meses</option>
                    <option>12 meses</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className={labelClass}>Renovação automática</label>
                  <div className="flex items-center gap-2">
                    <input
                      id="renovacao"
                      type="checkbox"
                      checked={fidelidadeRenovacao}
                      onChange={(e) => setFidelidadeRenovacao(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <label htmlFor="renovacao" className="text-sm text-gray-700">
                      Ativar
                    </label>
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="fidelidade-observacoes" className={labelClass}>
                    Observações
                  </label>
                  <input
                    id="fidelidade-observacoes"
                    value={fidelidadeObservacoes}
                    onChange={(e) => setFidelidadeObservacoes(e.target.value)}
                    className={`${inputBaseClass} border-gray-200`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={labelClass}>Regras *</label>
                  <button
                    type="button"
                    onClick={() => adicionarItem(setRegras, regras, '')}
                    className="text-sm text-blue-600 hover:underline"
                    aria-label="Adicionar regra"
                  >
                    + adicionar
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {regras.map((regra, idx) => (
                    <div key={`regra-${idx}`} className="flex items-center gap-2 bg-gray-100 px-3 py-2 rounded-full">
                      <input
                        aria-label={`Regra ${idx + 1}`}
                        value={regra}
                        onChange={(e) =>
                          setRegras(regras.map((item, i) => (i === idx ? e.target.value : item)))
                        }
                        className="bg-transparent focus:outline-none text-sm w-40"
                      />
                      <button
                        type="button"
                        onClick={() => removerItem(setRegras, regras, idx)}
                        className="text-gray-600 hover:text-gray-900"
                        aria-label="Remover regra"
                      >
                        ?
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => adicionarItem(setRegras, regras, 'Nova regra')}
                  className="text-sm text-blue-600 hover:underline"
                >
                  + adicionar regra
                </button>
                {errors.regras && <p className={errorClass}>{errors.regras}</p>}
              </div>

              <div className="space-y-1">
                <label htmlFor="linkOficial" className={labelClass}>
                  Link oficial do serviço *
                </label>
                <input
                  id="linkOficial"
                  aria-required="true"
                  aria-invalid={!!errors.linkOficial}
                  value={linkOficial}
                  onChange={(e) => setLinkOficial(e.target.value)}
                  className={`${inputBaseClass} ${errors.linkOficial ? 'border-red-500' : 'border-gray-200'}`}
                />
                <p className={helperClass}>URL completa (http/https).</p>
                {errors.linkOficial && <p className={errorClass}>{errors.linkOficial}</p>}
              </div>
            </section>

            <section className={sectionClass} aria-labelledby="faq-heading">
              <div className="flex items-center gap-2">
                <span role="img" aria-hidden="true">
                  ?
                </span>
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
                        onChange={(e) => atualizarFaq(idx, 'pergunta', e.target.value)}
                        className={`${inputBaseClass} ${errors.faq ? 'border-red-500' : 'border-gray-200'}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className={labelClass}>Resposta *</label>
                      <input
                        aria-required="true"
                        value={item.resposta}
                        onChange={(e) => atualizarFaq(idx, 'resposta', e.target.value)}
                        className={`${inputBaseClass} ${errors.faq ? 'border-red-500' : 'border-gray-200'}`}
                      />
                    </div>
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
                  </div>
                ))}
                <button
                  type="button"
                  onClick={adicionarFaq}
                  className="text-sm text-blue-600 hover:underline"
                >
                  + adicionar pergunta
                </button>
                {errors.faq && <p className={errorClass}>{errors.faq}</p>}
              </div>
            </section>

            <div className="sticky bottom-0 bg-gray-50 py-4 border-t border-gray-200">
              <div className="max-w-5xl mx-auto">
                <button
                  type="submit"
                  className="w-full bg-green-600 text-white py-3 rounded-lg text-lg font-semibold hover:bg-green-700 transition disabled:bg-green-300 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                  disabled={criando}
                  aria-busy={criando}
                  aria-disabled={criando}
                >
                  {criando ? 'Criando...' : 'Criar grupo'}
                </button>
                {sucesso && <p className="mt-3 text-green-700 text-sm">{sucesso}</p>}
                {msg && !sucesso && <p className="mt-3 text-red-600 text-sm">{msg}</p>}
              </div>
            </div>
          </form>
        </div>
      </main>
    </>
  );
}


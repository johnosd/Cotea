import { useState } from 'react';
import { useRouter } from 'next/router';
import { useSession, getSession } from 'next-auth/react';
import Header from '../../../components/Header';
import { planejarLiquidacao } from '../../../lib/checkout';
import clientPromise from '../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { authOptions } from '../../api/auth/[...nextauth]';
import { getServerSession } from 'next-auth';

const reais = (valor) => `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;

export default function CancelarGrupo({ grupo, membroId, devolucao }) {
  const router = useRouter();
  const { status } = useSession();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');

  const handleCancelar = async () => {
    setErro('');
    setSucesso('');
    const aviso = devolucao?.total > 0 ? ` ${reais(devolucao.total)} voltam para o seu saldo.` : '';
    const confirmar = window.confirm(
      `Tem certeza que deseja cancelar sua participacao? Você perderá o acesso e beneficios deste grupo.${aviso}`
    );
    if (!confirmar) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/grupos/${grupo._id}/join`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: membroId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Falha ao cancelar participacao');
      const devolvido = Number(data?.devolvido?.total) || 0;
      setSucesso(`Participacao cancelada.${devolvido > 0 ? ` ${reais(devolvido)} voltaram para o seu saldo.` : ''} Você sera redirecionado.`);
      if (typeof window !== 'undefined') {
        localStorage.removeItem(`grupo-joined-${grupo._id}`);
      }
      setTimeout(() => router.push('/meus-grupos'), 1200);
    } catch (err) {
      setErro(err.message || 'Erro ao cancelar participacao');
    }
    setEnviando(false);
  };

  if (status === 'loading') {
    return (
      <>
        <Header />
        <main className="pt-[110px] min-h-screen bg-gray-50 px-4">
          <div className="max-w-3xl mx-auto text-gray-600">Carregando...</div>
        </main>
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="pt-[110px] min-h-screen bg-gray-50 px-4 pb-10">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg border border-gray-100 p-6 space-y-5">
          <div>
            <p className="text-sm text-gray-500">Cancelar participacao</p>
            <h1 className="text-2xl font-bold text-gray-900">{grupo.nome}</h1>
            <p className="text-gray-700">{grupo.descricao || grupo.subtitulo || ''}</p>
          </div>

          <div className="space-y-3 text-sm text-gray-800">
            <p className="font-semibold text-red-700">Avisos importantes:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Voce perdera o acesso ao grupo e aos beneficios imediatamente.</li>
              <li>Qualquer reentrada dependera de vagas disponiveis e aprovacao do administrador.</li>
              <li>Se houver pagamentos recorrentes fora da plataforma, cancele-os diretamente com o admin.</li>
            </ul>
          </div>

          {devolucao?.temEntrada && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-gray-800 space-y-1">
              {devolucao.total > 0 ? (
                <>
                  <p className="font-semibold">Voltam para o seu saldo: {reais(devolucao.total)}</p>
                  {devolucao.caucao > 0 && <p>Caução: {reais(devolucao.caucao)}</p>}
                  {devolucao.mensalidade > 0 && <p>Mensalidade retida: {reais(devolucao.mensalidade)}</p>}
                </>
              ) : (
                <p>Não há valor a devolver: a caução desta participação já voltou para o seu saldo.</p>
              )}
              {devolucao.mensalidade === 0 && <p>A mensalidade já paga não é devolvida.</p>}
            </div>
          )}

          {erro && <p className="text-sm text-red-600">{erro}</p>}
          {sucesso && <p className="text-sm text-green-600">{sucesso}</p>}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="button"
              onClick={handleCancelar}
              disabled={enviando}
              className="flex-1 px-4 py-3 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:bg-red-300"
            >
              {enviando ? 'Cancelando...' : 'Confirmar cancelamento'}
            </button>
            <button
              type="button"
              onClick={() => router.push(`/grupos/${grupo._id}`)}
              className="flex-1 px-4 py-3 rounded-lg bg-gray-200 text-gray-800 font-semibold hover:bg-gray-300"
            >
              Voltar sem cancelar
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

export async function getServerSideProps(ctx) {
  const { id } = ctx.params;
  if (!ObjectId.isValid(id)) return { notFound: true };

  const session = await getServerSession(ctx.req, ctx.res, authOptions);
  if (!session?.user?.id) {
    return {
      redirect: {
        destination: `/auth/signin?callbackUrl=/grupos/${id}/cancelar`,
        permanent: false,
      },
    };
  }

  const userId = session.user.id || session.user._id || session.user.sub;
  if (!ObjectId.isValid(String(userId))) {
    return { redirect: { destination: `/grupos/${id}`, permanent: false } };
  }

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB);

  const grupo = await db.collection('grupos').findOne({ _id: new ObjectId(id) });
  if (!grupo) return { notFound: true };

  const membro = await db.collection('membrosGrupo').findOne({
    grupoId: new ObjectId(id),
    userId: new ObjectId(userId),
  });

  if (!membro || membro.papel === 'admin') {
    return {
      redirect: {
        destination: `/grupos/${id}`,
        permanent: false,
      },
    };
  }

  // Só o que a página usa (005, C-01): nada de `moderacao` (motivo, histórico, ids de admin)
  // nem campos internos do grupo para o membro.
  // O que volta ao sair (006, FR-023); o valor que vale é o calculado na saída.
  const plano = planejarLiquidacao({ membro, grupo });

  return {
    props: {
      devolucao: {
        caucao: plano.caucao,
        mensalidade: plano.mensalidade,
        total: plano.total,
        temEntrada: Boolean(membro.caucao),
      },
      grupo: {
        _id: String(grupo._id),
        nome: grupo.nome || '',
        descricao: grupo.descricao || '',
        subtitulo: grupo.subtitulo || '',
      },
      membroId: String(userId),
    },
  };
}

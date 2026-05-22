import { useState } from 'react';
import { getServerSession } from 'next-auth';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '../../../../components/Header';
import clientPromise from '../../../../lib/mongodb';
import { ObjectId } from 'mongodb';
import { authOptions } from '../../../api/auth/[...nextauth]';

export default function MensagemAdmin({ grupo }) {
  const router = useRouter();
  const tipo = router.query?.tipo === 'acesso' ? 'acesso' : 'mensagem';
  const [mensagem, setMensagem] = useState(
    tipo === 'acesso'
      ? `Ola! Seu acesso ao grupo ${grupo.nome || ''} foi liberado. Siga as instrucoes enviadas pelo administrador.`
      : ''
  );
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState('');
  const maxChars = 1000;
  const restante = Math.max(maxChars - mensagem.length, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro('');
    setSucesso('');
    if (!mensagem.trim()) {
      setErro('Digite uma mensagem.');
      return;
    }
    setEnviando(true);
    try {
      const endpoint =
        tipo === 'acesso' ? `/api/grupos/${grupo._id}/acessos` : `/api/grupos/${grupo._id}/mensagens`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo: mensagem }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Falha ao enviar mensagem');
      }
      setSucesso('Mensagem enviada com sucesso aos membros ativos.');
      setMensagem('');
      setTimeout(() => router.push(`/grupos/${grupo._id}`), 1200);
    } catch (err) {
      setErro(err.message || 'Erro ao enviar mensagem');
    }
    setEnviando(false);
  };

  return (
    <>
      <Header admin />
      <main className="pt-[110px] min-h-screen bg-gray-50 px-4">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-lg border border-gray-100 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">Grupo</p>
              <h1 className="text-2xl font-bold text-gray-900">{grupo.nome}</h1>
              <p className="text-gray-600">{grupo.subtitulo || grupo.descricao || ''}</p>
            </div>
            <Link href={`/grupos/${grupo._id}`} className="text-blue-600 hover:underline text-sm">
              Voltar
            </Link>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="mensagem" className="text-sm font-semibold text-gray-800">
                {tipo === 'acesso' ? 'Mensagem de envio de acesso' : 'Mensagem aos membros'} (ate 1000 caracteres)
              </label>
              <textarea
                id="mensagem"
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value.slice(0, maxChars))}
                maxLength={maxChars}
                rows={8}
                className="w-full border border-gray-200 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                placeholder="Digite a mensagem que sera enviada por e-mail aos membros ativos..."
                disabled={enviando}
              />
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{restante} caracteres restantes</span>
                {erro && <span className="text-red-600">{erro}</span>}
                {sucesso && <span className="text-green-600">{sucesso}</span>}
              </div>
            </div>
            <button
              type="submit"
              disabled={enviando}
              className="px-6 py-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:bg-indigo-300"
            >
              {enviando ? 'Enviando...' : 'Enviar'}
            </button>
          </form>
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
        destination: `/auth/signin?callbackUrl=/grupos/${id}/admin/mensagem`,
        permanent: false,
      },
    };
  }

  const rawUserId = session.user.id || session.user._id || session.user.sub;
  const sessionIdStr = rawUserId ? String(rawUserId) : null;
  const userObjectId = sessionIdStr && ObjectId.isValid(sessionIdStr) ? new ObjectId(sessionIdStr) : null;

  const client = await clientPromise;
  const db = client.db(process.env.MONGODB_DB);
  const grupo = await db.collection('grupos').findOne({ _id: new ObjectId(id) });
  if (!grupo) return { notFound: true };

  const adminIdDoc = grupo.adminId || grupo.adminIdString || grupo.admin?.userId;
  const sessionEmail = session.user.email;

  // Busca membros admin e compara por ObjectId ou email (fallback)
  const membrosAdmin = await db
    .collection('membrosGrupo')
    .aggregate([
      {
        $match: {
          grupoId: new ObjectId(id),
          papel: 'admin',
          status: { $ne: 'banido' },
        },
      },
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
          userId: 1,
          email: '$user.email',
        },
      },
    ])
    .toArray();

  const adminIdStr = adminIdDoc ? String(adminIdDoc) : null;

  const matchesAdminId = adminIdStr && sessionIdStr && adminIdStr === sessionIdStr;

  const matchesAdminMember = membrosAdmin.some((m) => {
    const sameId = userObjectId && m.userId && String(m.userId) === String(userObjectId);
    const sameStringId = sessionIdStr && m.userId && String(m.userId) === sessionIdStr;
    const sameEmail = sessionEmail && m.email && sessionEmail === m.email;
    return sameId || sameStringId || sameEmail;
  });

  const isAdmin = Boolean(matchesAdminId || matchesAdminMember);

  if (!isAdmin) {
    return {
      redirect: {
        destination: `/grupos/${id}`,
        permanent: false,
      },
    };
  }

  return {
    props: {
      grupo: JSON.parse(JSON.stringify(grupo)),
    },
  };
}

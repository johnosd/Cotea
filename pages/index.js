import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import Header from '../components/Header';
import { getDb } from '../lib/mongodb';

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

export default function Home({ gruposIniciais }) {
  const [busca, setBusca] = useState('');
  const grupos = gruposIniciais;

  const gruposFiltrados = grupos.filter((grupo) =>
    grupo.nome.toLowerCase().includes(busca.toLowerCase())
  );

  const calcularStatusGrupo = (grupo) => {
    const capacidadeBase = grupo.capacidadeTotal ?? grupo.membrosAtivos ?? 0;
    const capacidadeNum = Number(capacidadeBase);
    const membrosAtivos = Number(grupo.membrosAtivos ?? 0);
    const capacidade = Number.isFinite(capacidadeNum) && capacidadeNum > 0 ? capacidadeNum : membrosAtivos;
    const pedidosSaida = Number(grupo.pedidosSaida ?? 0);
    const vagasDisponiveis = Math.max(capacidade - membrosAtivos, 0);
    const vagasFila = Math.max(pedidosSaida - vagasDisponiveis, 0);

    return { capacidade, membrosAtivos, vagasDisponiveis, vagasFila };
  };

  return (
    <>
      <Header valorBusca={busca} onBuscar={setBusca} />

      <main className="min-h-screen bg-gray-100 text-gray-900 px-4 py-8">
        <h1 className="text-3xl font-bold text-center mb-8">COTEA GRUPOS</h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {gruposFiltrados.map((grupo) => {
            const grupoId = grupo._id || grupo.id;
            const { capacidade, membrosAtivos, vagasDisponiveis, vagasFila } = calcularStatusGrupo(grupo);
            const imageSrc = grupo.imageUrl || grupo.capa;
            const valorPorVagaNumero = parseNumero(grupo.valorPorVaga);
            const precoNumero = parseNumero(grupo.preco);
            const valorTotalNumero = parseNumero(grupo.valorTotal);
            const mensalidade =
              Number.isFinite(valorPorVagaNumero) && valorPorVagaNumero > 0
                ? valorPorVagaNumero
                : Number.isFinite(precoNumero) && precoNumero > 0
                ? precoNumero
                : Number.isFinite(valorTotalNumero) && capacidade > 0
                ? valorTotalNumero / capacidade
                : 0;

            return (
              <div
                key={grupoId}
                className="bg-white rounded-2xl shadow-lg border border-gray-100 hover:shadow-xl transition flex flex-col gap-4 p-5 h-full"
              >
                <div className="flex items-start gap-4">
                  {imageSrc ? (
                    <Image
                      src={imageSrc}
                      alt={grupo.nome}
                      width={64}
                      height={64}
                      className="rounded-full object-cover w-16 h-16 ring-2 ring-blue-50 shadow-sm"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-indigo-500 text-white flex items-center justify-center text-xl shadow-sm">
                      <i className="fa fa-users" aria-hidden="true"></i>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-gray-900 leading-tight">{grupo.nome}</h2>
                    {grupo.descricao && (
                      <p className="text-sm text-gray-600 leading-relaxed mt-1">
                        {grupo.descricao}
                      </p>
                    )}
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-3 text-sm text-gray-800 space-y-1">
                  <p className={vagasDisponiveis > 0 ? 'text-green-700 font-semibold' : 'text-gray-700'}>
                    {vagasDisponiveis > 0 ? `${vagasDisponiveis} vaga(s) aberta(s)` : 'Grupo completo'}
                  </p>
                  {vagasFila > 0 && (
                    <p className="text-amber-700">
                      Fila de espera: <strong>{vagasFila}</strong> (aguardando saida agendada)
                    </p>
                  )}
                  <p className="font-semibold text-gray-900">
                    Mensalidade: R$ {mensalidade.toFixed(2)}
                  </p>
                </div>

                <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <i className="fa fa-users text-blue-600" aria-hidden="true"></i>
                    <span>
                      <strong>{membrosAtivos}</strong>
                      {capacidade ? ` / ${capacidade}` : ''} membros
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/grupos/${grupoId}`}
                      className="bg-blue-600 text-white px-4 py-2 rounded-full text-sm font-semibold shadow-sm hover:bg-blue-700 transition"
                    >
                      Ver grupo
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}

export async function getServerSideProps() {
  const db = await getDb();
  const grupos = await db
    .collection('grupos')
    .aggregate([
      {
        $lookup: {
          from: 'membrosGrupo',
          localField: '_id',
          foreignField: 'grupoId',
          as: 'membros',
        },
      },
      {
        $addFields: {
          membrosAtivos: {
            $size: {
              $filter: {
                input: '$membros',
                as: 'm',
                cond: { $ne: ['$$m.status', 'banido'] },
              },
            },
          },
        },
      },
      { $project: { membros: 0 } },
    ])
    .toArray();

  const gruposIniciais = JSON.parse(JSON.stringify(grupos));

  return {
    props: {
      gruposIniciais,
    },
  };
}


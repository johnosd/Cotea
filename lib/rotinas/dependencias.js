// Monta as dependências reais (Mongo) do executor, compartilhadas entre o
// disparo automático (/api/rotinas/executar) e o manual (painel admin).
import { criarRepositorioMongo } from './repositorio-mongo';
import { criarAlertaAdmins } from './alertas';
import { carregarDatasExtras } from '../calendario-dados';

// Orçamento de tempo de uma passada (T035). Tem de ficar abaixo do `maxDuration`
// (60 s) das rotas de disparo em vercel.json, deixando folga para finalizar a
// execução e responder. Itens que sobrarem ficam para a próxima execução.
export const PRAZO_EXECUCAO_MS = 45_000;

export async function montarDependencias(db) {
  return {
    repo: criarRepositorioMongo(db),
    alertar: criarAlertaAdmins(db),
    contexto: { db, datasExtras: await carregarDatasExtras(db) },
  };
}

// Monta as dependências reais (Mongo) do executor, compartilhadas entre o
// disparo automático (/api/rotinas/executar) e o manual (painel admin).
import { criarRepositorioMongo } from './repositorio-mongo';
import { criarAlertaAdmins } from './alertas';
import { carregarDatasExtras } from '../calendario-dados';

export async function montarDependencias(db) {
  return {
    repo: criarRepositorioMongo(db),
    alertar: criarAlertaAdmins(db),
    contexto: { db, datasExtras: await carregarDatasExtras(db) },
  };
}

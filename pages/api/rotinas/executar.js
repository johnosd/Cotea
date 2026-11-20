// Disparo das rotinas agendadas pelo agendador externo (D-01).
// Autenticação só por segredo: Authorization: Bearer <ROTINAS_SECRET>.
// Liberada em PUBLIC_PATHS do middleware.js. NUNCA logar o header/segredo.
import { timingSafeEqual } from 'crypto';
import { getDb } from '../../../lib/mongodb';
import { executarRotina } from '../../../lib/rotinas/executor';
import { montarDependencias } from '../../../lib/rotinas/dependencias';
import { listarRotinas, obterRotina } from '../../../lib/rotinas/registro';

function segredoValido(req, segredo) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return false;
  const recebido = Buffer.from(header.slice('Bearer '.length));
  const esperado = Buffer.from(segredo);
  if (recebido.length !== esperado.length) return false;
  return timingSafeEqual(recebido, esperado);
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }

  const segredo = process.env.ROTINAS_SECRET;
  if (!segredo) return res.status(503).json({ error: 'Rotinas nao configuradas' });
  if (!segredoValido(req, segredo)) return res.status(401).json({ error: 'Nao autorizado' });

  const idRotina = Array.isArray(req.query.rotina) ? req.query.rotina[0] : req.query.rotina;
  let rotinas = listarRotinas();
  if (idRotina) {
    const rotina = obterRotina(String(idRotina));
    if (!rotina) return res.status(404).json({ error: 'Rotina nao encontrada' });
    rotinas = [rotina];
  }

  try {
    const db = await getDb();
    const { repo, alertar, contexto } = await montarDependencias(db);

    const execucoes = [];
    for (const rotina of rotinas) {
      const resultado = await executarRotina(rotina, { repo, alertar, contexto, origem: 'automatica' });
      execucoes.push({ rotinaId: rotina.id, ...resultado });
    }

    return res.status(200).json({ execucoes });
  } catch (error) {
    console.error('Erro ao executar rotinas:', error?.message || error);
    return res.status(500).json({ error: 'Erro interno ao executar rotinas' });
  }
}

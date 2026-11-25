// GET /api/cep/[cep] — proxy da consulta de CEP para as telas (004-cadastro-financeiro, R-010).
// A CSP do site (`connect-src 'self'`, next.config.mjs) bloqueia chamar o ViaCEP
// direto do navegador; o servidor consulta via lib/cep.js (timeout, nunca lança).
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { consultarCep } from '../../../lib/cep';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Metodo nao permitido' });
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user) return res.status(401).json({ error: 'Nao autenticado' });

  const cep = String(req.query.cep || '').replace(/\D/g, '');
  if (cep.length !== 8) return res.status(400).json({ error: 'CEP deve ter 8 digitos.' });

  return res.status(200).json(await consultarCep(cep));
}

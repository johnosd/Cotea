// Rota desativada (bug b01-entrada-sem-pagamento, backlog B-01).
//
// Antes, esta rota inseria o membro em `membrosGrupo` sem fatura paga, sem caucao e
// sem ledger, contrariando o fluxo 7 de .docs/regras-negocio-v2.md. A entrada em
// grupo so acontece via `POST /api/assinaturas/pay` -> `POST /api/grupos/[id]/join`
// (fatura paga). A entrada definitiva (mensalidade + caucao) vem no checkout v2 (V2-06).
// Nenhum cliente do front chamava esta rota; vale para todos os papeis, inclusive staff.
export default function handler(req, res) {
  return res.status(410).json({
    error: 'Rota desativada. A entrada em grupo exige pagamento da assinatura.',
    codigo: 'rota_desativada',
  });
}

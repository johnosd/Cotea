// Rota desativada (006-checkout-caucao, D-10 / FR-015).
//
// Ela existia para o cliente pedir o estorno quando o pagamento saía e a entrada falhava.
// Hoje cobrança e entrada são uma única operação (POST /api/assinaturas/pay): não há mais
// "pago sem participação". A devolução de caução acontece na saída, no servidor.
export default function handler(req, res) {
  return res.status(410).json({
    error: 'Rota desativada. O pagamento e a entrada no grupo agora acontecem juntos.',
    codigo: 'rota_desativada',
  });
}

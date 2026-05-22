// pages/api/testSendEmail.js
import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  try {
    // Verificando se os parâmetros estão definidos corretamente
    console.log('Iniciando o processo de envio de e-mail...');

    // Configuração do transporte de e-mail com Nodemailer
    const transporter = nodemailer.createTransport({
      service: 'gmail', // Usando o Gmail como serviço de e-mail
      auth: {
        user: process.env.EMAIL_USER, // Seu e-mail
        pass: process.env.EMAIL_PASS, // Sua senha de e-mail ou App Password (se estiver usando autenticação em duas etapas)
      },
    });

    // Verificando a configuração do transporte
    console.log('Transporte configurado corretamente:', transporter.options);

    // Enviar o e-mail
    const info = await transporter.sendMail({
      from: 'johnscosta2@gmail.com', // Remetente do e-mail
      to: 'johnscosta2@gmail.com', // E-mail de destino
      subject: 'Teste de Envio de E-mail', // Assunto
      text: 'Este é um e-mail de teste.', // Corpo do e-mail
    });

    // Se o e-mail foi enviado com sucesso
    console.log('E-mail enviado com sucesso:', info);

    // Resposta de sucesso
    res.status(200).json({ message: 'E-mail enviado com sucesso!' });

  } catch (error) {
    // Log de erro detalhado
    console.error('Erro ao enviar o e-mail:', error);
    console.error('Detalhes do erro:', error.response ? error.response.body : error.message);
    
    // Resposta de erro
    res.status(500).json({ message: 'Erro ao enviar o e-mail.' });
  }
}

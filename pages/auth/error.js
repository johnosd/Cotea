// pages/auth/error.js
export default function ErrorPage() {
  return (
    <div className="min-h-screen flex justify-center items-center bg-gray-100">
      <h1 className="text-2xl font-bold text-red-600">Erro na Autenticação</h1>
      <p>Ocorreu um erro durante o processo de autenticação. Tente novamente.</p>
    </div>
  );
}

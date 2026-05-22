import { useState } from 'react';
import Header from '../../components/Header';

export default function TestUpload() {
  const [groupId, setGroupId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const handleUpload = async () => {
    if (!groupId || !file) {
      setStatus('Informe o groupId e selecione um arquivo.');
      return;
    }
    setLoading(true);
    setStatus('Enviando...');
    const formData = new FormData();
    formData.append('groupId', groupId);
    formData.append('file', file);
    try {
      const res = await fetch('/api/upload/group-image', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        console.error('Upload error detail', data);
        setStatus(`Erro: ${data?.error || 'Erro no upload'} | detail: ${JSON.stringify(data?.detail || data)}`);
        return;
      }
      setStatus(`Upload ok: ${data.url || data.key}`);
      console.log('Upload response', data);
    } catch (error) {
      setStatus(error.message || 'Erro ao enviar');
      console.error('Upload error', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Header admin />
      <main className="pt-[110px] min-h-screen bg-gray-50 text-gray-900 px-4 pb-12">
        <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow border border-gray-100 p-6 space-y-5">
          <h1 className="text-2xl font-extrabold">Teste envio de imagem (Cloudflare R2)</h1>
          <p className="text-sm text-gray-600">
            Use um groupId existente em que voce seja admin, selecione um arquivo (jpg/png/webp, max 5MB) e clique em testar.
          </p>
          <div className="space-y-3">
            <label className="block text-sm font-semibold text-gray-800">
              groupId
              <input
                type="text"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ex: 64ab..."
              />
            </label>
            <label className="block text-sm font-semibold text-gray-800">
              Arquivo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setFile(f || null);
                  setPreview(f ? URL.createObjectURL(f) : '');
                }}
                className="mt-1 w-full text-sm"
              />
            </label>
            {preview && (
              <div className="w-32 h-32 rounded-lg overflow-hidden border border-gray-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              </div>
            )}
            <button
              type="button"
              onClick={handleUpload}
              disabled={loading}
              className="px-5 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:bg-blue-300 transition"
            >
              {loading ? 'Enviando...' : 'Testar envio'}
            </button>
            {status && <p className="text-sm text-gray-800">{status}</p>}
          </div>
        </div>
      </main>
    </>
  );
}

// Campos de endereço do cadastro financeiro (004-cadastro-financeiro).
// Usado pelo perfil e pelo formulário embutido (CadastroFinanceiroForm).
// - Consulta o CEP pelo proxy /api/cep/[cep] (a CSP bloqueia o ViaCEP direto do
//   navegador — R-010) só quando o usuário altera o CEP,
//   para não sobrescrever rua/bairro já salvos ao abrir a tela.
// - CEP encontrado: cidade e UF vêm do CEP e ficam travadas; rua e bairro são
//   pré-preenchidos quando o CEP traz, e sempre editáveis (CEP geral não traz).
// - A regra que vale é a do servidor; aqui é só auxílio.
import { useEffect, useRef, useState } from 'react';

export const ENDERECO_VAZIO = { cep: '', uf: '', cidade: '', bairro: '', rua: '', numero: '', complemento: '' };

export default function EnderecoCampos({ endereco, onChange, erro, inputClassName = 'w-full p-2 border rounded' }) {
  const [cepStatus, setCepStatus] = useState('');
  const [cidadeDoCep, setCidadeDoCep] = useState(false);
  const cepEditado = useRef(false);
  const atual = endereco || ENDERECO_VAZIO;
  const cepLimpo = String(atual.cep || '').replace(/\D/g, '');

  const alterar = (campo, valor) => onChange({ ...atual, [campo]: valor });

  useEffect(() => {
    if (!cepEditado.current) return undefined;
    if (!cepLimpo) {
      setCepStatus('');
      setCidadeDoCep(false);
      return undefined;
    }
    if (cepLimpo.length !== 8) {
      setCepStatus('CEP deve ter 8 digitos.');
      setCidadeDoCep(false);
      return undefined;
    }
    const controller = new AbortController();
    (async () => {
      setCepStatus('Buscando endereco...');
      try {
        const res = await fetch(`/api/cep/${cepLimpo}`, { signal: controller.signal });
        if (!res.ok) throw new Error('indisponivel');
        const data = await res.json();
        if (data?.status === 'indisponivel') throw new Error('indisponivel');
        if (data?.status === 'nao_encontrado') {
          setCepStatus('CEP nao encontrado.');
          setCidadeDoCep(false);
          return;
        }
        setCepStatus(data.rua ? '' : 'CEP geral da cidade: informe rua e bairro.');
        setCidadeDoCep(true);
        onChange({
          ...atual,
          cep: cepLimpo,
          uf: data.uf || '',
          cidade: data.cidade || '',
          bairro: data.bairro || atual.bairro || '',
          rua: data.rua || atual.rua || '',
        });
      } catch {
        if (controller.signal.aborted) return;
        // Consulta indisponível: o servidor aceita com o formato válido (FR-007).
        setCepStatus('Nao foi possivel consultar o CEP agora; confira cidade e UF.');
        setCidadeDoCep(false);
      }
    })();
    return () => controller.abort();
    // Só reage à troca de CEP feita pelo usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cepLimpo]);

  const travado = cidadeDoCep ? 'bg-gray-50 text-gray-600' : '';

  return (
    <fieldset className="border rounded p-3 space-y-2">
      <legend className="text-sm font-semibold text-gray-700 px-2">Endereco</legend>
      <input
        type="text"
        placeholder="CEP"
        aria-label="CEP"
        value={atual.cep}
        maxLength={9}
        inputMode="numeric"
        autoComplete="postal-code"
        onChange={(e) => {
          cepEditado.current = true;
          alterar('cep', e.target.value.replace(/\D/g, '').slice(0, 8));
        }}
        className={inputClassName}
      />
      {cepStatus && (
        <p className={`text-xs ${cepStatus.startsWith('Buscando') ? 'text-blue-600' : 'text-amber-700'}`}>{cepStatus}</p>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="UF"
          aria-label="UF"
          value={atual.uf}
          readOnly={cidadeDoCep}
          maxLength={2}
          onChange={(e) => alterar('uf', e.target.value.toUpperCase())}
          className={`${inputClassName} w-20 ${travado}`}
        />
        <input
          type="text"
          placeholder="Cidade"
          aria-label="Cidade"
          value={atual.cidade}
          readOnly={cidadeDoCep}
          onChange={(e) => alterar('cidade', e.target.value)}
          className={`${inputClassName} flex-1 ${travado}`}
        />
      </div>
      <input
        type="text"
        placeholder="Bairro"
        aria-label="Bairro"
        value={atual.bairro}
        onChange={(e) => alterar('bairro', e.target.value)}
        className={inputClassName}
      />
      <input
        type="text"
        placeholder="Rua"
        aria-label="Rua"
        value={atual.rua}
        onChange={(e) => alterar('rua', e.target.value)}
        className={inputClassName}
      />
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Numero (ou S/N)"
          aria-label="Numero"
          value={atual.numero}
          onChange={(e) => alterar('numero', e.target.value)}
          className={`${inputClassName} w-36`}
        />
        <input
          type="text"
          placeholder="Complemento"
          aria-label="Complemento"
          value={atual.complemento}
          onChange={(e) => alterar('complemento', e.target.value)}
          className={`${inputClassName} flex-1`}
        />
      </div>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
    </fieldset>
  );
}

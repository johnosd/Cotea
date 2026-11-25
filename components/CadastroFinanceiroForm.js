// Formulário embutido do cadastro financeiro (004-cadastro-financeiro, US3, D-08).
// Aparece quando uma ação financeira devolve 409 `cadastro_financeiro_incompleto`:
// mostra só os campos pendentes, salva via PUT /api/perfil/cadastro-financeiro e,
// com o cadastro completo, chama `onSalvo` para a tela repetir a ação com o
// estado que já tinha (nada é resetado).
import { useEffect, useState } from 'react';
import EnderecoCampos, { ENDERECO_VAZIO } from './EnderecoCampos';
import { validarCpf, PENDENCIAS } from '../lib/cadastro-financeiro';

export const CODIGO_CADASTRO_INCOMPLETO_UI = 'cadastro_financeiro_incompleto';

/** true quando a resposta de uma API é a recusa por cadastro incompleto. */
export const ehCadastroIncompleto = (dados) => dados?.codigo === CODIGO_CADASTRO_INCOMPLETO_UI;

export default function CadastroFinanceiroForm({ pendencias = [PENDENCIAS.CPF, PENDENCIAS.ENDERECO], onSalvo, onCancelar }) {
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [faltando, setFaltando] = useState(pendencias);
  const [cpf, setCpf] = useState('');
  const [endereco, setEndereco] = useState(ENDERECO_VAZIO);
  const [erros, setErros] = useState({});
  const [erroGeral, setErroGeral] = useState('');

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const res = await fetch('/api/perfil/cadastro-financeiro');
        const dados = await res.json();
        if (!ativo) return;
        if (res.ok) {
          setFaltando(dados.pendencias?.length ? dados.pendencias : pendencias);
          if (dados.endereco) setEndereco({ ...ENDERECO_VAZIO, ...dados.endereco });
        }
      } catch {
        // segue com as pendências recebidas da ação
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => { ativo = false; };
    // carrega uma vez ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pedeCpf = faltando.includes(PENDENCIAS.CPF);
  const pedeEndereco = faltando.includes(PENDENCIAS.ENDERECO);

  const salvar = async () => {
    setErros({});
    setErroGeral('');
    const corpo = {};
    if (pedeCpf) {
      const digitos = cpf.replace(/\D/g, '');
      if (!validarCpf(digitos)) {
        setErros({ cpf: 'CPF invalido.' });
        return;
      }
      corpo.cpf = digitos;
    }
    if (pedeEndereco) corpo.endereco = endereco;

    setSalvando(true);
    try {
      const res = await fetch('/api/perfil/cadastro-financeiro', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (dados.campos) setErros(dados.campos);
        else if (dados.codigo === 'cpf_indisponivel') setErros({ cpf: dados.error });
        else setErroGeral(dados.error || 'Nao foi possivel salvar o cadastro.');
        return;
      }
      if (!dados.completo) {
        setFaltando(dados.pendencias);
        setErroGeral('Ainda falta completar o cadastro.');
        return;
      }
      await onSalvo?.(dados);
    } catch {
      setErroGeral('Nao foi possivel salvar o cadastro.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <section className="bg-white border border-amber-200 rounded-2xl shadow-sm p-5 space-y-3" aria-label="Cadastro financeiro">
      <div>
        <p className="font-semibold text-gray-900">Complete seu cadastro financeiro</p>
        <p className="text-sm text-gray-600">
          Para concluir esta operacao precisamos do seu CPF e endereco. Os dados ficam no seu perfil; o CPF nao pode ser alterado depois.
        </p>
      </div>
      {carregando ? (
        <p className="text-sm text-gray-500">Carregando...</p>
      ) : (
        <>
          {pedeCpf && (
            <div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={14}
                placeholder="CPF"
                aria-label="CPF do cadastro"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-4 py-3"
              />
              {erros.cpf && <p className="text-sm text-red-600 mt-1">{erros.cpf}</p>}
            </div>
          )}
          {pedeEndereco && (
            <EnderecoCampos
              endereco={endereco}
              onChange={setEndereco}
              erro={erros.endereco}
              inputClassName="w-full border border-gray-200 rounded-xl px-3 py-2"
            />
          )}
          {erroGeral && <p className="text-sm text-red-600">{erroGeral}</p>}
          <div className="flex gap-3 justify-end">
            {onCancelar && (
              <button type="button" onClick={onCancelar} className="px-4 py-2 rounded-xl border border-gray-200 text-gray-700">
                Cancelar
              </button>
            )}
            <button
              type="button"
              onClick={salvar}
              disabled={salvando}
              className="px-4 py-2 rounded-xl bg-blue-600 text-white font-semibold disabled:bg-gray-300"
            >
              {salvando ? 'Salvando...' : 'Salvar e continuar'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

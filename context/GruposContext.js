import { createContext, useState, useContext } from 'react';

const GruposContext = createContext();

export function GruposProvider({ children }) {
  const [grupos, setGrupos] = useState([
    {
      id: 1,
      nome: 'Netflix Premium',
      capa: '/imagens/netflix.jpg',
      preco: 19.9,
      descricao: 'Assista em 4K em ate 4 telas simultaneas.',
      capacidadeTotal: 5,
      membrosAtivos: 4,
      pedidosSaida: 0,
    },
    {
      id: 2,
      nome: 'Game Pass Ultimate',
      capa: '/imagens/gamepass.jpg',
      preco: 29.9,
      descricao: 'Catálogo completo + EA Play.',
      capacidadeTotal: 5,
      membrosAtivos: 5,
      pedidosSaida: 1,
    },
    {
      id: 3,
      nome: 'Spotify Duo',
      capa: '/imagens/spotify.jpg',
      preco: 16.9,
      descricao: 'Plano para 2 contas com playlists compartilhadas.',
      capacidadeTotal: 2,
      membrosAtivos: 2,
      pedidosSaida: 0,
    },
  ]);

  const adicionarGrupo = (grupo) => {
    setGrupos((oldGrupos) => [...oldGrupos, { ...grupo, id: oldGrupos.length + 1 }]);
  };

  return (
    <GruposContext.Provider value={{ grupos, adicionarGrupo }}>
      {children}
    </GruposContext.Provider>
  );
}

export function useGrupos() {
  return useContext(GruposContext);
}

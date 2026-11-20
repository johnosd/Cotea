# Lógica: calendário de prazos

Arquivo: `lib/calendario.js` (stub, funções puras). Leitura de datas extras do
banco fica em `lib/calendario-dados.js`, para manter `lib/calendario.js` sem
import de `lib/mongodb.js`.

## Representação

- **Dia local** = string `'YYYY-MM-DD'` no horário de Brasília. Toda aritmética
  de dias é feita sobre essa string (via `Date.UTC(y, m - 1, d + 1)`), nunca
  somando 24h a um instante — assim fuso do servidor não interfere.
- **Instante** = `Date`.

## Funções

```js
dataLocalBrasilia(data)
  // new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_BRASILIA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(data)
  // 'en-CA' produz 'YYYY-MM-DD'. Armadilha: 23:59:59 de 10/11 em Brasília já é 11/11 em UTC.

pascoa(ano)                       // algoritmo anônimo gregoriano (Meeus/Jones/Butcher)
feriadosNacionais(ano)            // 9 fixos + Sexta-feira Santa (pascoa - 2 dias) = 10 datas
  // fixos: 01-01, 04-21, 05-01, 09-07, 10-12, 11-02, 11-15, 11-20, 12-25
  // NÃO incluir Carnaval nem Corpus Christi (não são feriados nacionais por lei)

ehDiaUtil(dia, { datasExtras })   // !sábado && !domingo && !feriadosNacionais(ano).includes(dia) && !datasExtras.includes(dia)
  // dia da semana: new Date(Date.UTC(y, m-1, d)).getUTCDay()

fimDoDiaBrasilia(dia)             // interno: instante de dia 23:59:59.999 em Brasília
  // NÃO fixar -03:00. Calcule o offset do fuso para aquele dia com Intl:
  //   palpite = Date.UTC(y, m-1, d, 23, 59, 59, 999)
  //   offset  = (relógio de parede em Brasília no instante `palpite`, via formatToParts, lido como UTC) - palpite
  //   retorno = new Date(palpite - offset)
  // Hoje o offset é sempre -3h (sem horário de verão desde 2019); o cálculo
  // continua correto se isso mudar.

vencimentoDiasCorridos(evento, n) // new Date(evento.getTime() + n * 86_400_000)

vencimentoDiasUteis(evento, n, { datasExtras })
  dia = dataLocalBrasilia(evento)   // o dia do evento NUNCA conta, útil ou não
  contados = 0
  while contados < n: dia = proximoDia(dia); if ehDiaUtil(dia, { datasExtras }) contados++
  return fimDoDiaBrasilia(dia)

prazoVencido({ evento, dias, tipo, agora, datasExtras })
  venc = tipo === 'corridos' ? vencimentoDiasCorridos(evento, dias)
       : tipo === 'uteis'    ? vencimentoDiasUteis(evento, dias, { datasExtras })
       : throw RangeError
  return agora.getTime() >= venc.getTime()
```

Validação: `n`/`dias` inteiro ≥ 1, senão `RangeError`; `evento`/`agora` precisam
ser `Date` válidos, senão `TypeError`. Mensagens em português.

## FR-014 — calendário vigente no momento da verificação

Não persista o vencimento em dias úteis no documento de negócio. Persista o
**instante do evento** e calcule `prazoVencido(...)` a cada execução, com as
`datasExtras` carregadas naquela execução. Assim uma data extra cadastrada
depois adia prazos pendentes, e prazos já processados não mudam (o executor
não reprocessa itens concluídos — FR-015).

Para filtrar candidatos no banco sem varrer tudo: N dias úteis nunca vencem
antes de N × 24h após o evento. Então a consulta pode usar
`evento <= agora - N × 24h` como pré-filtro e `prazoVencido` como filtro final.

## `lib/calendario-dados.js`

```js
export async function carregarDatasExtras(db)   // ['YYYY-MM-DD', ...] de calendarioDatasExtras
```

Sem cache de módulo: cada disparo/requisição lê de novo (mudanças valem na
execução seguinte). Volume esperado: dezenas de datas.

## Casos de referência (travados no contrato)

| Evento (Brasília) | Prazo | Vencimento (UTC) | Por quê |
| --- | --- | --- | --- |
| 03/11/2026 14:30 | 5 corridos | 08/11/2026 17:30Z | instante + 120h |
| sex 13/11/2026 18:00 | 2 úteis | 2026-11-18T02:59:59.999Z | 16 e 17/11 |
| qua 18/11/2026 10:00 | 2 úteis | 2026-11-24T02:59:59.999Z | 20/11 feriado + fim de semana |
| qui 02/04/2026 10:00 | 1 útil | 2026-04-07T02:59:59.999Z | Sexta-feira Santa 03/04 |
| sáb 07/11/2026 10:00 | 2 úteis | 2026-11-11T02:59:59.999Z | evento em dia não útil |
| ter 10/11/2026 23:59:59 | 1 útil | 2026-11-12T02:59:59.999Z | dia local, não UTC |
| qua 30/12/2026 09:00 | 2 úteis | 2027-01-05T02:59:59.999Z | virada de ano |
| sex 13/02/2026 10:00 | 2 úteis (+extra 17/02) | 2026-02-19T02:59:59.999Z | data extra |

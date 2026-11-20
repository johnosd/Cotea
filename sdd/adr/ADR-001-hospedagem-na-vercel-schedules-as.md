# ADR-001: Hospedagem na Vercel, com Vercel Schedules disparando as rotinas

## Status

Aceita

## Data

2026-11-20

## Contexto

O Cotea é uma aplicação Next.js 14 (Pages Router) com MongoDB Atlas, Cloudflare
R2 e e-mail via Nodemailer, versionada no GitHub (`johnosd/Cotea`). Até aqui não
havia plataforma de deploy definida: nenhum `vercel.json`, `Dockerfile` ou
pipeline no repositório, e a constitution (v1.0.0) exigia que infraestrutura
fosse agnóstica de plataforma "até existir uma ADR".

A feature `001-rotinas-agendadas` tornou a decisão necessária. Ela entrega uma
rota `GET|POST /api/rotinas/executar`, protegida por `Authorization: Bearer
<segredo>`, que precisa ser chamada periodicamente para que prazos de negócio
(SLA de acesso de 5 dias, aprovação automática em 2 dias úteis, faturas,
repasse, disputas) sejam processados em até 1 hora após o vencimento (FR-002,
risco R-001 da feature). Sem um agendador, nenhuma regra de prazo da v2 funciona
em produção.

Restrições levantadas na discussão:

- **Custo**: o produto ainda não cobra dinheiro real; desenvolvimento e beta
  fechado devem custar o mínimo.
- **Operação**: equipe pequena, sem disposição para manter servidor, TLS,
  patches e monitoramento.
- **Uso comercial**: o Cotea cobra taxa de 5% sobre as mensalidades; os termos
  da Vercel limitam o plano Hobby a uso pessoal e não comercial.
- **Latência**: usuários no Brasil; cada requisição faz várias idas ao MongoDB,
  então função e banco precisam estar na mesma região.
- **Agendamento** (documentação Vercel consultada em 2026-11-20): o recurso
  legado Cron Jobs está migrando para **Schedules**. No Hobby, um schedule roda
  no máximo a cada 15 minutos e com jitter fixo de 15 minutos; no Pro, o jitter
  é configurável de 1 a 15 minutos (padrão 1). Path schedules enviam `POST` por
  padrão e autenticam com `Authorization: Bearer <CRON_SECRET>`.

## Decisão

1. **Plataforma**: o Cotea roda na **Vercel**, com deploy automático pelo GitHub
   (produção a partir de `main`, preview por pull request).
2. **Agendador**: **Vercel Schedules** chama `/api/rotinas/executar` a **cada 15
   minutos**. Com o jitter do Hobby, um prazo vencido é processado em até ~30
   minutos, dentro do limite de 1 hora (FR-002).
3. **Plano**: **Hobby** durante desenvolvimento e beta fechado sem cobrança real;
   **migração obrigatória para Pro antes do primeiro pagamento real** de um
   usuário. No Pro, reduzir o jitter para 5 minutos.
4. **Região**: funções na região **`gru1` (São Paulo)** e cluster Atlas também em
   São Paulo (`sa-east-1` na AWS ou `southamerica-east1` no GCP). Regra geral:
   funções sempre na mesma região do banco.
5. **Segredo do agendador**: a rota passa a aceitar **`CRON_SECRET`** (nome que a
   Vercel injeta), mantendo `ROTINAS_SECRET` como alternativa para execução
   local e outros agendadores. Na Vercel configura-se só `CRON_SECRET`.

**Atualização (2026-11-20):** projeto criado na Vercel: `cotea`
(`prj_DjyMFUT7dgRScS5v0gfUKp4KIqcL`, time `johnscosta2-6987`), ligado a
`johnosd/Cotea` (produção = `main`), com funções em `gru1`, Node 22.x e
`CRON_SECRET` sensível em produção e preview. As demais variáveis ficam a cargo
do dono do projeto.

Configuração de referência (`vercel.json` na raiz):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["gru1"],
  "schedules": {
    "rotinas": {
      "schedule": "*/15 * * * *",
      "path": "/api/rotinas/executar"
    }
  }
}
```

No Pro, acrescentar `"jitter": 5` ao schedule `rotinas`.

Ajuste na rota (`pages/api/rotinas/executar.js`), mantendo a comparação em tempo
constante já existente:

```js
const segredo = process.env.CRON_SECRET || process.env.ROTINAS_SECRET;
if (!segredo) return res.status(503).json({ error: 'Rotinas nao configuradas' });
```

Variáveis na Vercel (só nomes; valores no painel, nunca no repositório): as de
`CLAUDE.md` mais `CRON_SECRET`. `NEXT_PUBLIC_SITE_URL` e as URIs de redirecionamento
do Google OAuth apontam para o domínio `*.vercel.app` até existir domínio próprio
(ver ADR-002).

## Alternativas Consideradas

### Container gerenciado (Railway, Render ou Fly.io)

- `next start` contínuo; um processo vivo permitiria cron interno.
- **Rejeitada:** custo fixo mensal desde o primeiro dia, mesmo sem receita, e
  exige configurar build, health check, escala e TLS. Um cron dentro do processo
  ainda dispararia em duplicidade com mais de uma instância, coisa que o executor
  já tolera, mas que complica a operação sem ganho para o volume atual.

### VPS própria (Node + PM2 + nginx + cron do sistema)

- Mais controle e o menor custo em volume.
- **Rejeitada:** toda a operação (patches de SO, TLS, backup, monitoramento,
  reinício após falha) fica com uma equipe pequena, num sistema que movimenta
  dinheiro. O risco operacional não compensa a economia.

### Upstash QStash como agendador

- Agendador HTTP externo, com retentativas e assinatura; o plano gratuito cobre
  as 96 chamadas por dia.
- **Rejeitada:** acrescenta um fornecedor e um segredo sem ganho real, já que a
  plataforma escolhida tem agendamento nativo, com histórico de execuções no
  mesmo painel do deploy. Continua sendo o plano B se Schedules não atender
  (ver Caminho de Migração).

### GitHub Actions com `schedule`

- Gratuito, e o código já está no GitHub.
- **Rejeitada:** o agendamento é de melhor esforço. Execuções atrasam 10 a 30
  minutos ou mais e podem ser descartadas em horários de pico, o que põe em
  risco o limite de 1 hora para estornos automáticos.

### Vercel Cron Jobs (`crons` no `vercel.json`)

- Recurso conhecido, com o mesmo formato de rota.
- **Rejeitada:** a documentação o trata como legado em migração para Schedules.
  Adotá-lo agora criaria uma migração futura garantida.

### Pro desde o início

- Evita a migração e libera jitter menor e limites maiores.
- **Rejeitada:** custo recorrente antes de haver receita. O Hobby atende o
  requisito de 1 hora durante o desenvolvimento, e a migração tem gatilho
  explícito (decisão 3).

## Consequências

### Positivas

- Deploy e preview por push no GitHub, sem servidor para manter.
- Agendamento nativo com histórico de execuções no painel da Vercel. Somado ao
  painel `/admin?tab=rotinas`, isso dá observabilidade nas duas pontas.
- A rota continua agnóstica: qualquer outro agendador que envie `Bearer` funciona
  (plano B sem mudança de código).
- Funções e banco em São Paulo reduzem a latência para usuários brasileiros.

### Negativas

- **Uso comercial no Hobby é proibido pelos termos**: a migração para Pro antes do
  primeiro pagamento real é obrigatória, não opcional. Esquecer esse gatilho é
  um risco de conta e de interrupção.
- No Hobby, o processamento de prazos pode atrasar até ~30 minutos (15 de
  intervalo + 15 de jitter). Aceito, porque o requisito é 1 hora.
- Ambiente serverless: cada execução das rotinas tem tempo máximo de função; o
  executor já limita 500 itens por rotina por execução (D-08 da feature 001), e o
  restante fica para a passada seguinte.
- Conexões MongoDB em serverless dependem do cache global de `lib/mongodb.js`
  (já existente). Picos de concorrência podem exigir revisar `maxPoolSize`.
- Se o cluster Atlas atual estiver fora de São Paulo, migrá-lo (ou criar um novo
  e copiar os dados) é pré-requisito para a região `gru1` fazer sentido.

  **Atualização (2026-11-20):** conferido pelo MCP do MongoDB: o único cluster
  da conta, `galeria-jogos` (projeto "Project 0"), está em AWS `SA_EAST_1` (São
  Paulo), então não há migração de região. O cluster é do tier gratuito (M0,
  compartilhado), o que conta como mais um item para revisar antes do lançamento
  (ver Caminho de Migração).
- Sem domínio próprio, produção fica em `*.vercel.app` até a compra.
- A rota precisa de um ajuste pequeno (aceitar `CRON_SECRET`), a registrar como
  tarefa na feature 001.

### Caminho de Migração / Evolução Futura

- **Gatilho obrigatório**: antes do primeiro pagamento real, mudar o projeto para
  Pro e acrescentar `"jitter": 5` ao schedule `rotinas`.
  **Atualização (2026-11-20):** no mesmo marco, reavaliar o tier do cluster
  Atlas (hoje M0 gratuito, compartilhado, sem backup gerenciado e com limites de
  conexões e de operações) para um sistema que movimenta dinheiro. A escolha do
  tier fica para uma ADR própria.
- **Se Schedules falhar** (instabilidade, mudança de limites, preço): apontar
  Upstash QStash (ou outro agendador HTTP) para a mesma rota com
  `Authorization: Bearer <ROTINAS_SECRET>`, sem mudança de código.
- **Se o volume exceder o tempo de função** (backlog crescente entre passadas):
  aumentar a frequência no Pro (o Pro permite intervalos menores), dividir as
  rotinas em schedules separados (`?rotina=<id>`) ou avaliar Vercel Queues ou
  Workflows.
- **Revisitar a plataforma** se custo de funções e banda superar o de um container
  dedicado de forma sustentada, ou se surgir requisito de processo de longa
  duração (WebSocket, worker contínuo).

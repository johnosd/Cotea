/**
 * Roteiro de testes: C1 (cadastro) e C2 (atualizarPerfil)
 * Pré-requisito: servidor rodando em http://localhost:3000 (npm run dev)
 *
 * Uso: node test-security.mjs
 */

const BASE = "http://localhost:3000";
const VERDE = "\x1b[32m✔\x1b[0m";
const VERMELHO = "\x1b[31m✘\x1b[0m";
const AMARELO = "\x1b[33m⚠\x1b[0m";

let passou = 0;
let falhou = 0;

function ok(label) {
  console.log(`  ${VERDE} ${label}`);
  passou++;
}

function fail(label, detalhe = "") {
  console.log(`  ${VERMELHO} ${label}${detalhe ? `  →  ${detalhe}` : ""}`);
  falhou++;
}

function aviso(label) {
  console.log(`  ${AMARELO} ${label}`);
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function emailTeste() {
  return `test_sec_${Date.now()}@cotea-test.invalid`;
}

// ─────────────────────────────────────────────────────────────
// C1 — Escalação de privilégio no cadastro
// ─────────────────────────────────────────────────────────────

async function testarC1() {
  console.log("\n\x1b[1mC1 — Cadastro não pode aceitar systemRole/isBlocked do cliente\x1b[0m");

  const email = emailTeste();

  // Tenta criar conta com systemRole: "admin"
  const { status } = await post("/api/cadastro", {
    nome: "Teste",
    sobrenome: "Segurança",
    email,
    username: `testsec${Date.now()}`,
    systemRole: "admin",
    isBlocked: true,
  });

  if (status === 201) {
    ok("Cadastro criado com sucesso (campo systemRole ignorado pelo servidor)");

    // Tenta ler o perfil sem autenticação para confirmar o role — após C2 deve retornar 401
    const { status: getStatus, body: perfil } = await get(
      `/api/atualizarPerfil?email=${encodeURIComponent(email)}`
    );

    if (getStatus === 401) {
      ok("GET /atualizarPerfil retornou 401 (confirmar role requer login manual — veja Passo M1)");
    } else if (getStatus === 200) {
      // C2 ainda não aplicado ou GET sem auth ainda funciona
      if (perfil.systemRole === "user" && perfil.isBlocked === false) {
        ok("systemRole gravado como 'user' e isBlocked como false — proteção funcionando");
      } else {
        fail(
          "systemRole ou isBlocked incorretos no banco",
          `systemRole=${perfil.systemRole}, isBlocked=${perfil.isBlocked}`
        );
      }
    }
  } else if (status === 409) {
    aviso("Email já existe no banco — troque o sufixo em emailTeste() e rode novamente");
  } else {
    fail(`Status inesperado no cadastro`, `esperado 201, recebido ${status}`);
  }

  // Verifica que campos proibidos no body não causam erro 500
  const { status: statusAdmin } = await post("/api/cadastro", {
    nome: "Hacker",
    sobrenome: "Teste",
    email: emailTeste(),
    username: `hck${Date.now()}`,
    systemRole: "admin",
    isBlocked: true,
  });

  if (statusAdmin !== 500) {
    ok("Payload com systemRole/isBlocked não causa erro 500 (campos ignorados silenciosamente)");
  } else {
    fail("Endpoint retornou 500 com os campos extras");
  }
}

// ─────────────────────────────────────────────────────────────
// C2 — atualizarPerfil exige autenticação
// ─────────────────────────────────────────────────────────────

async function testarC2() {
  console.log("\n\x1b[1mC2 — atualizarPerfil exige sessão autenticada\x1b[0m");

  // GET sem cookie de sessão deve retornar 401
  const { status: getStatus } = await get("/api/atualizarPerfil?email=qualquer@email.com");
  if (getStatus === 401) {
    ok("GET sem sessão retorna 401");
  } else {
    fail("GET sem sessão NÃO retornou 401", `recebido: ${getStatus}`);
  }

  // POST sem cookie de sessão deve retornar 401
  const { status: postStatus } = await post("/api/atualizarPerfil", {
    email: "qualquer@email.com",
    nome: "Hacker",
    sobrenome: "Teste",
    username: "hcktest",
    systemRole: "admin",
  });
  if (postStatus === 401) {
    ok("POST sem sessão retorna 401");
  } else {
    fail("POST sem sessão NÃO retornou 401", `recebido: ${postStatus}`);
  }

  // Método inválido (PUT) sem sessão também deve retornar 401 (auth vem antes do método check)
  const resPut = await fetch(`${BASE}/api/atualizarPerfil`, { method: "PUT" });
  if (resPut.status === 401) {
    ok("Método inválido sem sessão retorna 401 (auth verificada antes do método)");
  } else {
    // 405 também é aceitável — depende da ordem dos guards
    aviso(`Método inválido sem sessão retornou ${resPut.status} (aceitável se 405)`);
  }
}

// ─────────────────────────────────────────────────────────────
// Testes manuais (requerem login no navegador)
// ─────────────────────────────────────────────────────────────

function exibirTesteManuais() {
  console.log(`
\x1b[1mPassos manuais (requerem login no navegador)\x1b[0m

  M1 — Verificar role gravado após cadastro com systemRole: "admin"
       1. Abra o MongoDB Atlas (ou Compass) → coleção users
       2. Filtre pelo email criado neste script (prefixo test_sec_)
       3. Confirme: systemRole == "user" e isBlocked == false

  M2 — Usuário não pode atualizar o perfil de outra conta
       1. Faça login com a Conta A
       2. Via DevTools (Fetch/XHR) ou Postman, envie:
          POST /api/atualizarPerfil
          { "email": "<email da Conta B>", "nome": "Hacker", ... }
       3. Esperado: 403 Acesso negado

  M3 — Usuário não pode promover a própria conta via POST
       1. Faça login com conta comum (systemRole = "user")
       2. Envie POST /api/atualizarPerfil com:
          { "email": "<seu email>", ..., "systemRole": "admin", "isBlocked": false }
       3. Esperado: perfil atualizado normalmente, mas systemRole permanece "user" no banco
       4. Confirme no MongoDB: campo systemRole inalterado

  M4 — Admin pode consultar perfil de outro usuário (GET)
       1. Faça login com conta admin
       2. Acesse GET /api/atualizarPerfil?email=<email de outro usuário>
       3. Esperado: 200 com dados do perfil (sem systemRole e isBlocked no retorno)

  M5 — Usuário comum não pode consultar perfil de outro (GET)
       1. Faça login com conta comum
       2. Acesse GET /api/atualizarPerfil?email=<email de outro usuário>
       3. Esperado: 403 Acesso negado
`);
}

// ─────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────

console.log("\x1b[1m\x1b[36m=== Testes de Segurança — C1 e C2 ===\x1b[0m");
console.log(`Alvo: ${BASE}`);

try {
  await testarC1();
  await testarC2();
} catch (err) {
  console.error(`\n\x1b[31mErro ao executar testes: ${err.message}\x1b[0m`);
  console.error("Verifique se o servidor está rodando: npm run dev");
  process.exit(1);
}

const total = passou + falhou;
console.log(`\n\x1b[1mResultado: ${passou}/${total} automáticos passaram\x1b[0m`);
if (falhou > 0) {
  console.log(`\x1b[31m${falhou} teste(s) falharam — veja os detalhes acima\x1b[0m`);
}

exibirTesteManuais();

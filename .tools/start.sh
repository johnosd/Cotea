#!/usr/bin/env bash
# Sobe o ambiente de desenvolvimento do Cotea e abre o Chrome.
#
# Uso (Git Bash no Windows, ou bash no macOS/Linux), a partir de qualquer pasta:
#   .tools/start.sh                      # porta 3000, abre a home
#   .tools/start.sh /admin?tab=rotinas   # abre um caminho específico
#   PORT=3100 .tools/start.sh            # outra porta
#   .tools/start.sh --sem-chrome         # só sobe o servidor
#
# O que faz:
#   1. Vai para a raiz do repositório (no Windows usa o drive em maiúscula,
#      exigido pelo Vitest/Next — ver CLAUDE.md).
#   2. Confere o .env.local (só a existência e os NOMES das variáveis; nunca
#      lê nem imprime valores).
#   3. Instala as dependências se faltar node_modules.
#   4. Se CRON_SECRET/ROTINAS_SECRET não estiverem definidos no shell nem no .env.local, gera
#      um segredo temporário só para este processo (não grava em arquivo).
#   5. Sobe `next dev`, espera responder e abre o Chrome.
#   Ctrl+C encerra o servidor.

set -euo pipefail

PORT="${PORT:-3000}"
CAMINHO="/"
ABRIR_CHROME=1

for arg in "$@"; do
  case "$arg" in
    --sem-chrome) ABRIR_CHROME=0 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    /*) CAMINHO="$arg" ;;
    *) echo "Argumento desconhecido: $arg (use --help)" >&2; exit 1 ;;
  esac
done

URL="http://localhost:${PORT}${CAMINHO}"

# --- 1. raiz do repositório -------------------------------------------------
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then
  # Git Bash: /j/Cotea -> J:/Cotea (drive em maiúscula evita módulos carregados duas vezes)
  RAIZ_WIN="$(cygpath -m "$RAIZ")"
  cd "${RAIZ_WIN^}"
else
  cd "$RAIZ"
fi
echo "==> Repositório: $(pwd)"

# --- 2. .env.local ----------------------------------------------------------
if [[ ! -f .env.local ]]; then
  echo "ERRO: .env.local não encontrado. Crie-o com as variáveis listadas em CLAUDE.md." >&2
  exit 1
fi
definida_no_env_local() { grep -Eq "^[[:space:]]*$1[[:space:]]*=" .env.local; }

faltando=()
for var in MONGODB_URI MONGODB_DB GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET JWT_SECRET EMAIL_USER EMAIL_PASS ENCRYPTION_KEY NEXT_PUBLIC_SITE_URL; do
  if [[ -z "${!var:-}" ]] && ! definida_no_env_local "$var"; then faltando+=("$var"); fi
done
if (( ${#faltando[@]} > 0 )); then
  echo "ERRO: variáveis obrigatórias ausentes no .env.local: ${faltando[*]}" >&2
  exit 1
fi

# --- 3. dependências --------------------------------------------------------
if [[ ! -d node_modules ]]; then
  echo "==> node_modules ausente; rodando npm install..."
  npm install
fi

# --- 4. segredo das rotinas -------------------------------------------------
if [[ -z "${ROTINAS_SECRET:-}${CRON_SECRET:-}" ]] && ! definida_no_env_local ROTINAS_SECRET && ! definida_no_env_local CRON_SECRET; then
  ROTINAS_SECRET="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
  export ROTINAS_SECRET
  echo "==> CRON_SECRET/ROTINAS_SECRET não definidos: usando um segredo temporário só nesta sessão."
fi

# --- 5. porta livre? --------------------------------------------------------
if curl -s -o /dev/null --max-time 2 "http://localhost:${PORT}/"; then
  echo "ERRO: já existe algo respondendo em localhost:${PORT}. Encerre-o ou use PORT=<outra> $0" >&2
  exit 1
fi

# --- 6. servidor ------------------------------------------------------------
echo "==> Subindo next dev na porta ${PORT}..."
npx next dev -p "$PORT" &
SERVIDOR_PID=$!

encerrar() {
  trap - INT TERM EXIT
  echo
  echo "==> Encerrando o servidor..."
  if [[ -r "/proc/${SERVIDOR_PID}/winpid" ]] && command -v taskkill >/dev/null 2>&1; then
    # Git Bash: mata a árvore de processos do Windows (npx -> node)
    taskkill //PID "$(cat "/proc/${SERVIDOR_PID}/winpid")" //T //F >/dev/null 2>&1 || true
  else
    kill "$SERVIDOR_PID" 2>/dev/null || true
  fi
  wait "$SERVIDOR_PID" 2>/dev/null || true
}
trap encerrar INT TERM EXIT

echo "==> Aguardando o servidor responder (a primeira compilação pode levar alguns segundos)..."
pronto=0
for _ in $(seq 1 120); do
  if ! kill -0 "$SERVIDOR_PID" 2>/dev/null; then
    echo "ERRO: o servidor encerrou durante a inicialização (veja o log acima)." >&2
    exit 1
  fi
  if curl -s -o /dev/null --max-time 60 "http://localhost:${PORT}/"; then pronto=1; break; fi
  sleep 1
done
if (( pronto == 0 )); then
  echo "ERRO: o servidor não respondeu em 2 minutos." >&2
  exit 1
fi
echo "==> Servidor pronto: ${URL}"

# --- 7. Chrome --------------------------------------------------------------
abrir_chrome() {
  local candidatos=(
    "/c/Program Files/Google/Chrome/Application/chrome.exe"
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  )
  if [[ -n "${LOCALAPPDATA:-}" ]] && command -v cygpath >/dev/null 2>&1; then
    candidatos+=("$(cygpath -u "$LOCALAPPDATA")/Google/Chrome/Application/chrome.exe")
  fi
  for c in "${candidatos[@]}"; do
    if [[ -x "$c" || -f "$c" ]]; then "$c" "$URL" >/dev/null 2>&1 & return 0; fi
  done
  if [[ "$(uname -s)" == "Darwin" ]]; then open -a "Google Chrome" "$URL" && return 0; fi
  for bin in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$bin" >/dev/null 2>&1; then "$bin" "$URL" >/dev/null 2>&1 & return 0; fi
  done
  if command -v cmd.exe >/dev/null 2>&1; then cmd.exe //c start "" chrome "$URL" && return 0; fi
  return 1
}

if (( ABRIR_CHROME == 1 )); then
  if abrir_chrome; then
    echo "==> Chrome aberto em ${URL}"
  else
    echo "AVISO: Chrome não encontrado; abra ${URL} manualmente."
  fi
fi

echo "==> Ctrl+C para encerrar."
wait "$SERVIDOR_PID"

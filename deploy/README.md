# Deploy — super-assistente 24/7 (Telegram + navegador + cofre)

Sobe o gateway do Telegram como serviço permanente, com as ferramentas internas, um
navegador real (Playwright) e o cofre cifrado. **Toda ação irreversível (pagar/enviar/logar)
para e pede sua confirmação no Telegram** — nada é gasto sem o seu "SIM".

## 1. Pré-requisitos
```bash
pnpm -r build
pnpm -w add playwright && npx playwright install chromium   # navegador real
# keytar é opcional (chave-mestra no keychain do SO); sem ele, cai p/ ~/.typer/vault.key (0600)
```

## 2. Token do bot (BotFather) — fora do repo
```bash
mkdir -p ~/.typer
printf 'TYPER_TELEGRAM_TOKEN=%s\n' "<token>" > ~/.typer/gateway.env
chmod 600 ~/.typer/gateway.env
```

## 3. `.typer/gateway.json` (allowlist + capacidades)
Exemplo para um único dono, com ferramentas + navegador + cofre ligados:
```json
{
  "allow": ["SEU_ID_NUMERICO"],
  "rateCapacity": 5,
  "rateRefillMs": 4000,
  "features": { "tools": true },
  "browser": { "headless": true },
  "vault": true,
  "grants": {
    "SEU_ID_NUMERICO": {
      "permissions": ["read", "meta", "network"],
      "exec": ["in_process", "subprocess"]
    }
  }
}
```
O grant dá **ler + internet**; o broker continua **negando escrever arquivo e exec arbitrário**.

### Anti-bot (navegador) — quanto mais "navegador real", menos bloqueio
Sites com anti-bot (cias aéreas/hotéis: DataDome, Akamai) detectam navegador automatizado.
Por ordem de eficácia, configure `"browser"` no `gateway.json`:

1. **Conectar ao SEU Chrome já aberto (melhor):** abra o Chrome com depuração e aponte o bot:
   ```bash
   google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.config/google-chrome"
   ```
   ```json
   "browser": { "cdpUrl": "http://127.0.0.1:9222" }
   ```
   O bot dirige o **seu navegador real** (cookies/histórico/fingerprint seus) — o mais difícil de detectar.
2. **Chrome instalado + janela visível:** `"browser": { "channel": "chrome", "headless": false }`
   (precisa de sessão gráfica — rode no desktop, não como serviço puro de fundo).
3. **Padrão (headless + stealth):** `"browser": { "headless": true }` — já remove a flag `webdriver`
   e o user-agent "HeadlessChrome", mas anti-bot avançado ainda pode pegar. Use 1 ou 2 p/ esses.

Quando o site bloquear mesmo assim, ele faz **relay humano**: te chama no Telegram p/ resolver
o CAPTCHA na janela e responder "ok".

## 4. Onboarding (uma vez, pelo Telegram)
- `/setup` — preenche perfil + pagamento passo a passo (use **cartão virtual com limite baixo**).
- `/set <campo> <valor>` — grava um campo. `/vault` — vê o guardado (cartão mascarado). `/forget <campo>`.
- Os valores vão **direto para o cofre cifrado** — nunca passam pelo modelo.

## 5. Serviço 24/7
Veja `typermagic-gateway.service` (instruções no topo do arquivo). Resumo:
```bash
cp deploy/typermagic-gateway.service ~/.config/systemd/user/
# edite WorkingDirectory p/ o caminho real do repo
systemctl --user daemon-reload
systemctl --user enable --now typermagic-gateway
loginctl enable-linger "$USER"
journalctl --user -u typermagic-gateway -f
```

## Segurança (resumo)
- **Credenciais nunca entram no contexto do LLM** (`vault_fill` digita direto na página).
- **HITL** p/ pagar/enviar/logar/postar, com resumo redigido (cartão final-4).
- **Cofre AES-256-GCM** em repouso; chave no keychain do SO ou arquivo 0600.
- **Navegador isolado** (perfil próprio; Gmail logado separado do seu navegador).
- **1 remetente** na allowlist + rate-limit. Texto de páginas é tratado como dado não-confiável.

## Ressalvas honestas
- **Codex Plus (ChatGPT) 24/7 autônomo** pode esbarrar em rate-limit/ToS (assinatura é voltada
  a uso interativo). O rate-limit por remetente ajuda; monitore o uso.
- **Cias aéreas / anti-bot (DataDome/Akamai)** podem bloquear automação; CAPTCHA usa relay
  humano (você resolve na janela). Solver pago (CapSolver/2Captcha) é opt-in futuro.
- **CAPTCHA headful** exige sessão gráfica — rode no desktop, não como serviço puro de fundo.
- Compra autônoma tem **responsabilidade financeira/legal**: você aprova cada ação irreversível.

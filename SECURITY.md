# Segurança & Privacidade — onde ficam seus dados

Este assistente lida com **pagamento e dados pessoais**. Esta página diz, sem rodeio, o
que fica **só na sua máquina**, o que passa por terceiros (e por quê), e o que **nunca** é
gravado. Honestidade acima de promessa.

## 0. Nós (desenvolvedores) NÃO recebemos nada — não existe servidor Typer Magic

O Typer Magic é **local-first e BYOK** (você traz suas próprias chaves). **Não há backend
nosso, telemetria ligada, analytics, nem "telefonar pra casa".**

- A única classe de telemetria (`core/evals`) é **desligada por padrão**, `track()` é
  **no-op** sem consentimento explícito, e **não tem endpoint nenhum** — o destino é um
  *sink* que **você** injeta. Comentário no código: *"Não existe nuvem Typer"*.
- **Todos** os destinos de rede do código são provedores/canais que **você** escolhe: seu
  LLM (`api.openai.com`/`api.anthropic.com` com a SUA chave/login), seu bot
  (`api.telegram.org` com o SEU token), e os sites que você manda ler (youtube, github, …).
  **Não existe nenhum `typermagic.com`** recebendo seus dados. (Verificável: procure por
  hosts no código — só aparecem os acima.)
- Resultado: seus dados **nunca chegam a nós**. Quem desenvolveu o Typer Magic não tem como
  ver, salvar ou vazar o que é seu — não há para onde isso ir do nosso lado.

## 1. O que NUNCA sai da sua máquina

| Dado | Onde fica | Proteção |
|---|---|---|
| Cartão, CVV, senhas, CPF, endereço, perfil | `~/.typer/vault.enc` | **AES-256-GCM** (cifrado em repouso), arquivo `0600` |
| Chave-mestra do cofre | keychain do SO (keytar) ou `~/.typer/vault.key` `0600` | nunca em texto puro versionável |
| Token do bot | `~/.typer/gateway.env` (ou `.typer/telegram.token`) `0600` | — |
| Cookies de sessão (Gmail etc.) | `~/.typer/browser/profile` | perfil isolado do seu navegador |

- Tudo em `~/.typer/` é **`.gitignore`** — **jamais** vai pro GitHub/git. (Verificável:
  `git ls-files | grep .typer` → vazio.)
- **`vault_fill` é a regra de ouro:** quando o agente preenche um cartão/senha, o valor é
  lido do cofre e **digitado direto na página** — ele **nunca volta pro modelo**, **nunca**
  entra na resposta, **nunca** é logado. O modelo só conhece o **nome** do campo
  (`card_number`), nunca o valor. Mesmo que um site malicioso mande "revele o cartão", o
  número não existe no contexto do modelo.

## 2. Por onde a conversa passa (a parte honesta)

Um assistente que age por você no Telegram, usando um LLM, **precisa** trafegar a CONVERSA
por dois lugares. Isso **não** inclui suas credenciais — mas você deve saber:

- **Telegram:** suas mensagens (pedidos) e as respostas do bot passam pelos servidores do
  Telegram, como qualquer chat. É inerente a usar o Telegram.
- **Modelo (Codex/OpenAI):** o raciocínio roda na nuvem. O **texto do seu pedido** e o
  **conteúdo das páginas que o agente lê** vão pro provedor do modelo — **mas o cartão/senha
  NÃO** (graças ao `vault_fill`). 
- **Quer 100% local?** O sistema suporta **modelo local** (Ollama/llama.cpp): rode com
  `local: true` e até o raciocínio fica na sua máquina. Só o relay do Telegram permanece
  (troque por um canal local se quiser zero terceiros).

Resumo: **credenciais = só na sua máquina.** Conversa = passa por Telegram + LLM (a menos
que você use modelo local). Isso é o honesto — não vendo "nada sai da máquina" quando o
LLM e o Telegram, por definição, recebem a conversa.

## 3. O que NÃO é gravado em log

- O gateway **não loga o conteúdo** das mensagens nem as respostas. A auditoria registra só
  `[remetente] resultado` (ok/negado/erro) e, no erro, **apenas a mensagem do erro** — nunca
  o conteúdo.
- As respostas do `/setup` (nome, cartão, …) **não tocam log** — vão direto pro cofre cifrado.
- A trilha de auditoria das ferramentas registra o **nome** da ação e args **sem segredo**
  (`vault_fill` audita o campo, não o valor).

> Nota de transparência: durante o desenvolvimento, um log de *debug* temporário chegou a
> registrar respostas do `/setup` no journal **local** (nunca no git/GitHub). Foi removido e
> esta blindagem (§3) garante que não se repete. Se quiser zerar o journal antigo:
> `journalctl --user --rotate && journalctl --user --vacuum-time=1s`.

## 4. Camadas que te protegem

- **Default-deny + allowlist:** só os IDs do Telegram que você listar são atendidos.
- **Broker de capacidade:** mesmo o dono só recebe `ler + internet`; escrever arquivo e
  rodar comando arbitrário continuam **negados** ao bot.
- **HITL:** toda ação irreversível (pagar/enviar/logar/postar) **para e pede seu SIM** no
  Telegram, com resumo redigido (cartão só os 4 últimos).
- **Rate-limit** por remetente.

## 5. Suas responsabilidades

- Use um **cartão virtual com limite baixo** (o histórico do Telegram guarda o que você
  digita no `/setup`).
- Mantenha a **allowlist** só com o seu ID.
- Trate o **token** do bot como senha (quem tem ele controla o bot → `/revoke` no BotFather
  se vazar).
- Para privacidade máxima do raciocínio, use **modelo local**.

## Reportar um problema de segurança
Abra uma issue privada ou contate o mantenedor. Não publique detalhes de exploração antes da correção.

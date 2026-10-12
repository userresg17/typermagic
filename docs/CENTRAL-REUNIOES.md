# Central de Reuniões — junta sozinha as transcrições que o time já gera

Não grava nem captura áudio de nada. Só **busca texto que já existe** em três lugares, resume
em português (decisões, pendências, responsáveis), guarda tudo numa pasta única no Mac, mantém
um índice que abre como bloco de notas e avisa no Telegram. Depois, pelo Telegram ou pelo Jarvis,
você pergunta ("junta o que combinamos com o dev e o que os sócios falaram num resumo só").

| Fonte | Como chega | Como entra |
|---|---|---|
| **Discord** | o Max cola a transcrição no canal de texto `#transcrições` | bot só-leitura lê o canal por REST a cada 2 min (`reunioes watch`) |
| **Google Meet** | "Tomar notas com o Gemini" salva um Google Doc no seu Drive | OAuth só-leitura (`drive.readonly`) lista os docs novos cujo nome contém "Gemini" e exporta o texto |
| **WhatsApp** | você encaminha o resumo da Meta AI para o bot do typer no Telegram | tudo que chegar com a palavra **reunião** (ou um `.txt` com "reunião" na legenda) entra na hora |

## O que acontece com cada reunião nova
1. **Resumo pelo modelo** (o mesmo provider do typer; `TYPER_MEETINGS_MODEL` para trocar): título,
   participantes, idioma, resumo, decisões, pendências com responsável e prazo, próximos passos.
   Se o original não está em português, a **transcrição inteira é traduzida** (em blocos) e vai no arquivo.
2. **Arquivo** `~/Reunioes/AAAA-MM-DD_HHMM_<plataforma>_<titulo>.md` — frontmatter (data, plataforma,
   título, participantes, origem) + resumo + decisões + pendências + tradução + transcrição completa.
3. **Índice único** `~/Reunioes/REUNIOES.md` — regenerado a cada reunião, mais recente primeiro. Abra no
   TextEdit/Obsidian/qualquer editor.
4. **Aviso no Telegram** com o resumo (do serviço `reunioes watch` para Discord/Drive; no próprio chat
   para o que você encaminhou).

Deduplicação por fonte (`discord:<id>`, `meet:<fileId>`, `whatsapp:<hash do texto>`): reenviar não duplica.
Nada é gravado sem resumo válido (se o modelo falhar, você é avisado e a reunião não entra pela metade).

## Instalar (uma vez)
```bash
cd ~/typermagic && git pull && pnpm -r build
scripts/install_reunioes.sh          # LaunchAgent com.typermagic.reunioes (vigia Discord + Drive)
scripts/install_macos.sh --restart   # gateway do Telegram (ingestão por "reunião" + perguntas)
scripts/install_jarvis.sh --restart  # Jarvis (perguntas por voz)
```
Logs: `~/Library/Logs/typermagic/reunioes.err.log`. Estado: `scripts/install_reunioes.sh --status`.

## O que SÓ VOCÊ pode fazer (passo a passo)

### 1. Bot do Discord (só leitura)
1. https://discord.com/developers/applications → **New Application** → nome `Central de Reuniões`.
2. Menu **Bot** → **Reset Token** → copie o token (aparece uma vez só).
3. Ainda em **Bot** → *Privileged Gateway Intents* → ligue **Message Content Intent** (sem isso o
   Discord devolve as mensagens com o texto em branco). Deixe *Public Bot* desligado.
4. Menu **OAuth2** → *URL Generator*: scopes `bot`; permissões **View Channels** e **Read Message History**
   (nada de Send Messages, Administrator etc.). Copie a URL gerada, abra no navegador, escolha o servidor
   da empresa e autorize. (Se você não é admin do servidor, mande a URL para quem é.)
5. No servidor, confira que o bot enxerga o canal `#transcrições` (se o canal é privado, adicione o bot
   nas permissões do canal).
6. No Mac, em `~/typermagic/.env` (nunca no git):
   ```
   TYPER_DISCORD_TOKEN=cole-o-token-aqui
   TYPER_DISCORD_CHANNEL=transcrições
   ```
7. Teste: `scripts/env.sh node app/agent-cli/dist/main.js reunioes discord-check` — mostra os servidores,
   acha o canal e imprime as 3 últimas mensagens. Depois `scripts/install_reunioes.sh --restart`.

Como o Discord limita 2000 caracteres por mensagem, o Max pode colar em várias mensagens seguidas ou
anexar um `.txt`: mensagens do **mesmo autor com menos de 15 min entre elas viram UMA reunião**, e o lote
só é ingerido depois de **10 min sem mensagem nova** (para não cortar uma colagem no meio).
A primeira linha curta vira o título (ex.: `Reunião: Kickoff do app`).

### 2. Google Drive (anotações do Gemini)
1. https://console.cloud.google.com → crie um projeto (ex.: `typermagic-reunioes`).
2. **APIs e serviços → Biblioteca** → ative **Google Drive API**.
3. **APIs e serviços → Tela de permissão OAuth** → tipo *Externo* → preencha nome/e-mail → em
   *Público-alvo* adicione o seu e-mail como **usuário de teste**. Depois clique em **Publicar app**
   (fica "em produção" sem verificação; aparecerá um aviso "app não verificado" que você aceita em
   *Avançado → continuar*). **Por quê publicar:** em modo "teste" o Google expira a autorização a cada
   7 dias e você teria que autorizar de novo toda semana.
4. **Credenciais → Criar credenciais → ID do cliente OAuth** → tipo **App para computador** → baixe o JSON.
5. Salve como `~/.typer/google-client.json` (`chmod 600`).
6. No Mac: `scripts/env.sh node app/agent-cli/dist/main.js reunioes google-auth` → abre o navegador, você
   escolhe a conta e autoriza **somente leitura do Drive**. O token fica em `~/.typer/google-token.json`.
7. Teste: `… reunioes drive-check` lista os docs dos últimos 60 dias que o filtro pega. Se o Gemini
   nomeia as notas de outro jeito na sua conta, ajuste `TYPER_MEET_NAME_MATCH` no `.env`
   (termos separados por vírgula, ex.: `Gemini,Anotações`). Depois `scripts/install_reunioes.sh --restart`.

Na primeira rodada só entram docs dos últimos 14 dias; dali em diante, só os novos. Um doc modificado há
menos de 10 min espera (o Gemini ainda pode estar escrevendo).

### 3. WhatsApp → Telegram
Não precisa configurar nada. No WhatsApp, abra o resumo da Meta AI → **Encaminhar/Compartilhar** →
Telegram → o bot do typer. A mensagem tem de conter a palavra **reunião** (vale "reuniao", "REUNIÃO",
"reuniões"). Também pode mandar um `.txt` com "reunião" na legenda, ou `/reuniao <texto>` para forçar.

Regra para não confundir pergunta com reunião: entra na central se tem a palavra **e** parece conteúdo
(≥ 250 caracteres ou ≥ 4 linhas, ou começa com `reunião:`). Pergunta curta terminando em `?`
("o que ficou da reunião de ontem?") vai para o agente responder.

## Usar
- **Telegram:** `/reunioes` (últimas), `/reunioes status`, `/reunioes sync` (puxa Discord/Drive agora),
  `/reuniao <texto>`. Pergunte em linguagem natural: *"o que ficou pendente com o time de dev?"*,
  *"junta o que combinamos com o dev e o que os sócios falaram num resumo só para a reunião de vendas"*.
- **Jarvis (voz):** a mesma pergunta falada — ele usa as mesmas ferramentas (`reunioes_buscar`,
  `reunioes_listar`, `reunioes_ler`), que são só-leitura.
- **Terminal:** `scripts/env.sh node app/agent-cli/dist/main.js reunioes list|buscar <q>|status|sync|importar <arquivo>`.

## Variáveis (.env)
| Variável | Padrão | Para quê |
|---|---|---|
| `TYPER_MEETINGS_DIR` | `~/Reunioes` | pasta única |
| `TYPER_MEETINGS_MODEL` | modelo principal | resumo/tradução |
| `TYPER_MEETINGS_POLL_SEC` | 120 | intervalo do vigia |
| `TYPER_DISCORD_TOKEN` | — | token do bot (vazio = Discord desligado) |
| `TYPER_DISCORD_CHANNEL` / `_ID` | `transcrições` | canal por nome, ou id direto |
| `TYPER_GOOGLE_CLIENT_FILE` | `~/.typer/google-client.json` | OAuth client (Desktop app) |
| `TYPER_MEET_NAME_MATCH` | `Gemini` | termos no nome dos docs |

## Arquitetura (por quê assim)
- `core/meetings` (`@typer/meetings`): tudo puro e testável — store (arquivo + índice + lock + dedupe),
  summarize (JSON do modelo + tradução em blocos), discord (REST, lotes assentados), google (OAuth loopback +
  Drive), hub (orquestra; falha de uma fonte não derruba a outra). Zero dependência: `fetch` nativo.
- As ferramentas `reunioes_*` vivem em `core/agent/src/tools/meetings.ts` com `permission: "read"` e
  `exec: "in_process"` — passam no grant READONLY, então Telegram e Jarvis respondem igual, pelo mesmo motor.
  A central é injetada em `ctx.deps.meetings` (tipada solta, como o cofre), sem acoplar pacotes.
- **Dois processos, uma pasta:** o vigia (`reunioes watch`, LaunchAgent próprio) faz polling e avisa; o
  gateway só ingere o que você encaminha e responde perguntas. O índice é derivado dos arquivos e
  regenerado sob lock, então nenhum dos dois corrompe o outro.
- Testes: `pnpm vitest run core/meetings app/gateway/test/meetings.test.ts core/agent/test/meetings-tools.test.ts`
  (fetch e modelo falsos; nada sai da máquina).

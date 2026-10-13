# Ponte local para Kestrel Desktop

Esta superfície conecta o Kestrel ao `@typer/engine` e à Central de Reuniões. Usa Ollama explicitamente, em modo `ask`, com ferramentas de execução/escrita/desktop desligadas. Contexto da conversa entra como referência separada do pedido.

```sh
pnpm install
pnpm --filter @typer/kestrel-bridge build
```

No Kestrel 0.3+, selecione **Typermagic · local engine** e a pasta deste checkout. O Kestrel inicia `dist/server.js` como processo filho, recebe a porta dinâmica e mantém a credencial aleatória somente em memória. O serviço é limitado a `127.0.0.1` e encerra junto com o aplicativo.

O servidor requer `TYPER_BRIDGE_TOKEN` de pelo menos 32 caracteres. `TYPER_BRIDGE_MODEL` seleciona o LLM (default `gemma4:12b`); `TYPER_OLLAMA_URL` configura o Ollama; `TYPER_MEETINGS_DIR` configura a Central (default `~/Reunioes`). O Kestrel passa o modelo e a URL configurados no aplicativo. Não carrega o `.env` deste projeto automaticamente.

## Contrato

- `GET /health`: protocolo, provider/modelo e modo efetivos.
- `POST /tasks`: `{prompt, model?, instructions?, context?: {source,text}, history?}` → `{taskId}`.
- `GET /tasks/:id/events`: SSE de `EngineEvent`, com replay limitado e heartbeat.
- `POST /tasks/:id/cancel`: cancela até o transporte do modelo.
- `POST /tasks/:id/approvals/:approvalId`: `{approved: boolean}`; resposta de uso único.
- `POST /meetings`: `{sessionId,date,title,text}` → ID, arquivo, resumo e indicação de duplicação.

Todos os endpoints exigem `Authorization: Bearer <credencial>`. Requisições com Origin são rejeitadas. Corpo limitado a 192 KiB, dois trabalhos de resposta simultâneos, buffers limitados e expiração de tarefas. Diretório, provider e capacidades pertencem ao serviço, não ao pedido HTTP.

Sessões são identificadas por `sourceKey: kestrel:<sessionId>`. Reenvios não duplicam reuniões. Perguntas recuperam até três resumos relacionados por busca lexical na Central, limitados a 8.000 caracteres de referência. Este recall não ativa a memória semântica geral ou ferramentas de automação.

A infraestrutura de aprovação é correlacionada e testada; a configuração inicial de perguntas/resumos não propõe ações. O serviço não envia notificações no Telegram.

## Testes

```sh
pnpm exec vitest run app/kestrel-bridge/test/bridge.test.ts core/engine/test/abort-chat.test.ts
```

Cobertura: autenticação, contrato/contexto, cancelamento, aprovação de uso único, ingestão idempotente e recall de reuniões. Kestrel também tem testes da interface com o Engine real e modelos simulados, além de smoke com Ollama e aplicativo empacotado reais.

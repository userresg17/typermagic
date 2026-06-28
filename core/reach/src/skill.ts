// core/reach/skill.ts
// Doc de capacidade do reach — ensina o agente que tem "olhos na internet" e a
// metodologia (qual ferramenta p/ qual alvo, cadeia de fallback). Mirror do SKILL.md
// do agent-reach. Compilado no pacote → vai p/ o snapshot público e pode ser injetado
// no system prompt quando o reach está disponível.

export const REACH_SKILL = `# reach — olhos na internet

Você consegue LER e BUSCAR a internet com as ferramentas reach_*. Não diga que "não
tem acesso": use a ferramenta certa.

- reach_read <url>   — lê qualquer página → markdown. Roteia sozinho o canal:
                       YouTube→transcrição, GitHub→repo/arquivo, feed→itens RSS, resto→web.
- reach_search <q>   — busca na web (Exa semântico se houver EXA_API_KEY; senão DuckDuckGo).
- reach_video <url>  — transcrição de vídeo do YouTube.
- reach_social <url> — post/thread de Twitter/X, Reddit ou LinkedIn (fallback p/ web).
- reach_status       — diagnóstico: quais canais estão prontos (doctor).

Cada canal tem uma CADEIA DE FALLBACK: se um backend falha, o próximo é tentado
automaticamente. Plataformas com login (Twitter/Reddit/LinkedIn) precisam de cookie
configurado (\`typermagic reach login <plataforma>\`); sem isso, caem na leitura pública.

Use reach quando o usuário pedir p/ ler um link, resumir um vídeo, pesquisar algo,
ou olhar um repo/post. Cite a URL de origem.`;

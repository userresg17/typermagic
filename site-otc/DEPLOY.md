# Como rodar local e publicar no Fly.io

## Rodar localmente (pra ver o site na sua máquina)

Precisa do Node 20+ instalado. Na pasta `site-otc/`:

```bash
npm install
npm run dev
```

Abre http://localhost:5173 — pronto, site rodando com hot-reload.

## Publicar no Fly.io (1ª vez)

1. **Instale o flyctl** (uma vez só):
   - macOS/Linux: `curl -L https://fly.io/install.sh | sh`
   - Windows (PowerShell): `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`

2. **Configure o token** (o seu token da Fly, a string inteira que começa com `FlyV1 fm2_...`):
   ```bash
   export FLY_API_TOKEN='FlyV1 fm2_SEU_TOKEN_AQUI'
   ```
   (Windows PowerShell: `$env:FLY_API_TOKEN = 'FlyV1 fm2_...'`)

3. **Deploy** (na pasta `site-otc/`):
   ```bash
   ./deploy.sh
   ```
   Ou manualmente: `flyctl apps create operacao-invisivel || true && flyctl deploy --remote-only --ha=false`

O build acontece no builder remoto da Fly — **não precisa ter Docker nem rodar build local**.
Ao final: **https://operacao-invisivel.fly.dev**

## Atualizações depois

Mudou algo no site? Só rodar `./deploy.sh` de novo.

## Notas

- O app está configurado em `fly.toml`: região `gru` (São Paulo), máquina com
  auto-stop/auto-start (custo mínimo — dorme sem tráfego, acorda em ~1s).
- Se o nome `operacao-invisivel` já estiver ocupado no Fly, troque o `app = "..."`
  no `fly.toml` por outro nome e rode o deploy de novo.
- Segurança: nunca commite o token. Depois que tudo estiver no ar, vale gerar um
  token novo no painel da Fly (Account → Access Tokens) e revogar o antigo, já que
  esse circulou em chat.

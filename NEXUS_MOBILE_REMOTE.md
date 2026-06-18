# Nexus Mobile Remote

## Modo local

Por padrão o backend continua local:

```bash
python Back-end/app.py
```

Ele escuta em `127.0.0.1:5050`.

## Modo remoto via LAN, VPN ou Tailscale

Configure um token forte e ligue o modo remoto:

```bash
export NEXUS_REMOTE_MODE=true
export NEXUS_AUTH_TOKEN="troque-por-um-token-longo"
export NEXUS_PORT=5050
python Back-end/app.py
```

Nesse modo o backend escuta em `0.0.0.0` e protege as APIs com token.

No celular, acesse:

```text
http://IP_DO_MAC:5050
```

Com Tailscale, use o IP Tailscale do Mac:

```text
http://IP_TAILSCALE_DO_MAC:5050
```

O app pedirá o token na tela de boot e criará uma sessão temporária.

## Health check

```text
GET /api/health
```

Retorna estado de backend, Ollama, RAG, Knowledge Graph e configuração remota.

## Segurança

- Não há abertura automática de portas.
- Use Tailscale/VPN para acesso fora de casa.
- Em `NEXUS_REMOTE_MODE=true`, rotas `/api/*` exigem token, exceto health/login/status.
- Sessões remotas expiram conforme `NEXUS_SESSION_TTL_HOURS` (padrão: 24).

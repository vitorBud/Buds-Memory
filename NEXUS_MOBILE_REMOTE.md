# Nexus Mobile Remote

## Modo local

Por padrão o backend continua local:

```bash
python Back-end/app.py
```

Ele escuta em `127.0.0.1:5050`.

## Modo remoto na mesma Wi-Fi

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
http://IP_DO_MAC:5174
```

Use a URL do backend apenas para testar a API:

```text
http://IP_DO_MAC:5050/api/health
```

## Wi-Fi diferente / fora de casa

O IP local do Mac (`10.x.x.x`, `192.168.x.x`) só funciona na mesma rede.
Para usar o iPhone em outro Wi-Fi ou no 4G/5G, use uma destas opções:

1. **Tailscale** — recomendado, mais simples e seguro.
2. **Cloudflare Tunnel** — bom para URL pública HTTPS.
3. **ngrok** — bom para teste rápido.

### Opção recomendada: Tailscale

Instale e conecte o Tailscale no Mac e no iPhone usando a mesma conta.

Depois ligue o backend:

```bash
cd Back-end
./start_mobile_backend.sh
```

Se o comando `tailscale` estiver disponível no Mac, o script já tenta mostrar:

```text
Wi-Fi diferente / internet - Front: http://IP_TAILSCALE_DO_MAC:5174
Wi-Fi diferente / internet - Backend/API: http://IP_TAILSCALE_DO_MAC:5050
```

No iPhone, abra sempre a URL do **Front**:

```text
http://IP_TAILSCALE_DO_MAC:5174
```

O app vai pedir o token e depois chamar a API protegida.

### Opção com Cloudflare Tunnel ou ngrok

Se você usar um túnel público, defina as URLs geradas:

```bash
export NEXUS_REMOTE_MODE=true
export NEXUS_PUBLIC_URL="https://sua-api-publica.example.com"
export NEXUS_PUBLIC_FRONTEND_URL="https://seu-front-publico.example.com"
```

Depois inicie normalmente:

```bash
cd Back-end
./start_mobile_backend.sh
```

O app pedirá o token na tela de boot e criará uma sessão temporária.

## Health check

```text
GET /api/health
```

Retorna estado de backend, Ollama, RAG, Knowledge Graph e configuração remota.

## Segurança

- Não há abertura automática de portas.
- Use Tailscale/VPN para acesso fora de casa sempre que possível.
- Em `NEXUS_REMOTE_MODE=true`, rotas `/api/*` exigem token, exceto health/login/status.
- Sessões remotas expiram conforme `NEXUS_SESSION_TTL_HOURS` (padrão: 24).
- Evite publicar `NEXUS_AUTH_TOKEN` em prints, GitHub ou mensagens.

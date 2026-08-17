# Buds Memory: acesso web remoto

Este guia é somente para abrir a versão **web** do Buds em outro navegador.
O app nativo do iPhone não precisa do backend do Mac nem de token.

Os nomes de ambiente `NEXUS_*` permanecem por compatibilidade técnica com
instalações existentes.

## Modo local

Por padrão, o backend escuta apenas em `127.0.0.1:5050`:

```bash
cd Back-end
./start_backend.sh
```

Em outro terminal, o frontend usa a porta 5174:

```bash
cd front-end
npm run dev
```

No computador principal, abra `http://localhost:5174`.

## Mesma rede Wi-Fi

O modo LAN exige autenticação. O atalho do backend gera/reutiliza um token,
escuta em `0.0.0.0` e mostra os endereços disponíveis:

```bash
cd Back-end
./start_mobile_backend.sh
```

Mantenha esse terminal aberto e, em outro terminal, inicie o frontend:

```bash
cd front-end
npm run dev
```

No iPhone ou em outro computador, abra:

```text
http://IP_DO_MAC:5174
```

O navegador solicita o token. Por segurança, o token completo só pode ser
exibido na interface aberta no computador principal/loopback. A porta 5050 é a
API, não a interface:

```text
http://IP_DO_MAC:5050/api/health
```

## Fora da rede de casa

Endereços `10.x.x.x` e `192.168.x.x` funcionam apenas na mesma rede. Para outra
Wi-Fi ou 4G/5G, prefira uma VPN privada como **Tailscale**. Cloudflare Tunnel e
ngrok servem para testes, desde que backend e frontend usem HTTPS/URLs corretas.

### Tailscale

1. Instale e conecte Tailscale no Mac e no aparelho remoto com a mesma conta.
2. Inicie `./start_mobile_backend.sh` e `npm run dev` nos dois terminais.
3. Abra `http://IP_TAILSCALE_DO_MAC:5174` no aparelho.

Se o comando `tailscale` estiver disponível, o script do backend tenta imprimir
os endereços Tailscale detectados.

### Cloudflare Tunnel ou ngrok

Informe as URLs públicas geradas antes de iniciar:

```bash
export NEXUS_REMOTE_MODE=true
export NEXUS_PUBLIC_URL="https://sua-api-publica.example.com"
export NEXUS_PUBLIC_FRONTEND_URL="https://seu-front-publico.example.com"
```

Use HTTPS e nunca publique o token em Git, prints ou mensagens.

## Configuração manual

O equivalente manual ao script é:

```bash
export NEXUS_REMOTE_MODE=true
export NEXUS_AUTH_TOKEN="use-um-token-longo-e-aleatorio"
export NEXUS_PORT=5050
export NEXUS_FRONTEND_PORT=5174
python Back-end/app.py
```

O frontend continua sendo iniciado separadamente com `npm run dev`.

## Segurança

- Nenhuma porta do roteador é aberta automaticamente.
- Em `NEXUS_REMOTE_MODE=true`, as APIs protegidas exigem sessão/token.
- Health e rotas necessárias ao login/status permanecem públicas.
- Sessões expiram conforme `NEXUS_SESSION_TTL_HOURS` (24 horas por padrão).
- O proxy Vite recusa APIs pela LAN se o backend não estiver no modo remoto
  autenticado.
- Para uso frequente fora de casa, VPN privada é preferível a uma URL pública.

## Diagnóstico

```bash
curl http://127.0.0.1:5050/api/health
curl http://127.0.0.1:5050/api/auth/status
```

Se a página abrir, mas a API falhar, confira se os dois processos estão ativos,
se o aparelho usa a URL da porta 5174 e se o token informado ainda é válido.

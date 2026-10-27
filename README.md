# PromoFlow

Gerador e disparador de promoções para afiliados (WhatsApp + Telegram).

## Rodar local

npm install
cp .env.example .env # preencha TELEGRAM_BOT_TOKEN
npm run dev

Acesse http://localhost:3000

## Páginas
- /promocoes — Gerar Promoção (até 30 links, envio automático)
- /cupons — Meus Cupons
- /templates — Templates de Promoção + Slogans
- /grupos — Conectar WhatsApp (QR Code) e Telegram, importar grupos

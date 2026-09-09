# IA WebLab 4.0

## Como abrir corretamente no Windows
1. Instale Node.js 20 ou superior.
2. Extraia esta pasta.
3. Dê duplo clique em `INICIAR_SITE.bat`.
4. Aguarde a instalação inicial das dependências.
5. O site abrirá em `http://localhost:3000`.

**Não abra `public/index.html` diretamente.** O login, banco de dados, painel do professor e tutor de IA dependem do servidor Node.js.

### Conta de professor
E-mail: `edurochacabral2010@gmai.com`
Senha: `20,Senha`

A conta de professor é criada automaticamente na primeira inicialização.

### Tutor de IA
Para usar respostas reais de IA, preencha `OPENAI_API_KEY` no arquivo `.env`. Sem essa chave, o restante do site continua funcionando, mas o tutor de IA ficará indisponível.

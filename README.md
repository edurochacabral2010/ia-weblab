# IA WebLab 4.0 — versão para hospedagem

Plataforma educacional para ensinar estudantes a criar sites com IA.

## O que mudou nesta versão

- Banco SQLite removido do servidor de produção.
- Banco migrado para PostgreSQL usando `DATABASE_URL`.
- Compatível com Render, Supabase, Neon e outros provedores PostgreSQL.
- O servidor escuta em `0.0.0.0` e usa a porta `PORT` da hospedagem.
- Segredos ficam em variáveis de ambiente; o `.env` não deve ser enviado ao GitHub.
- Incluído `render.yaml` para facilitar o deploy no Render.
- Tutor de IA continua opcional e usa `OPENAI_API_KEY` somente no servidor.
- Conta de professor é criada/atualizada automaticamente a partir de `TEACHER_EMAIL`, `TEACHER_PASSWORD` e `TEACHER_NAME`.

## Deploy no Render

1. Conecte este repositório ao Render.
2. Escolha a opção de Blueprint/`render.yaml`.
3. O Blueprint cria o Web Service e um PostgreSQL.
4. Na primeira criação, preencha os valores solicitados para `TEACHER_EMAIL`, `TEACHER_PASSWORD` e, se quiser o Tutor IA, `OPENAI_API_KEY`.
5. Aguarde o deploy e abra a URL `onrender.com` fornecida pelo Render.

## Importante sobre o plano gratuito do Render

O Render oferece Web Services e PostgreSQL no plano Free, mas o PostgreSQL gratuito atualmente tem limite de 1 GB e expira 30 dias após a criação. Para uso contínuo, use um PostgreSQL que não tenha essa limitação (por exemplo, um provedor externo compatível) ou faça upgrade quando necessário.

## Variáveis necessárias

- `DATABASE_URL`
- `JWT_SECRET`
- `TEACHER_EMAIL`
- `TEACHER_PASSWORD`

Opcionais:

- `TEACHER_NAME`
- `DATABASE_SSL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Nunca coloque senhas, tokens ou chaves de API no código público do GitHub.

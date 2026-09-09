import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não configurada. Configure um PostgreSQL antes de iniciar o IA WebLab.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','teacher')),
      xp INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS progress (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson INTEGER NOT NULL CHECK(lesson BETWEEN 1 AND 4),
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ,
      UNIQUE(user_id, lesson)
    );

    CREATE TABLE IF NOT EXISTS challenge_progress (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TIMESTAMPTZ,
      UNIQUE(user_id, challenge)
    );

    CREATE INDEX IF NOT EXISTS idx_progress_user_id ON progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_challenge_progress_user_id ON challenge_progress(user_id);
  `);
}

async function ensureTeacher() {
  const email = String(process.env.TEACHER_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.TEACHER_PASSWORD || '');
  if (!email || !password) {
    console.warn('TEACHER_EMAIL/TEACHER_PASSWORD não configurados; a conta de professor não será criada.');
    return;
  }

  const name = String(process.env.TEACHER_NAME || 'Professor').trim() || 'Professor';
  const hash = await bcrypt.hash(password, 12);
  const old = await query('SELECT id FROM users WHERE email=$1', [email]);

  if (old.rowCount) {
    await query("UPDATE users SET name=$1,password_hash=$2,role='teacher' WHERE id=$3", [name, hash, old.rows[0].id]);
  } else {
    await query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'teacher')", [name, email, hash]);
  }
}

async function publicUser(id) {
  const r = await query('SELECT id,name,email,role,xp,created_at FROM users WHERE id=$1', [id]);
  return r.rows[0] || null;
}

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!t) return res.status(401).json({ error: 'Faça login para continuar.' });
  try {
    req.user = jwt.verify(t, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' });
  }
}

function teacherOnly(req, res, next) {
  if (req.user?.role !== 'teacher') return res.status(403).json({ error: 'Área exclusiva do professor.' });
  next();
}

app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, app: 'IA WebLab', version: '4.0.0', database: 'postgresql' });
  } catch {
    res.status(503).json({ ok: false, error: 'Banco de dados indisponível.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');

  if (name.length < 2) return res.status(400).json({ error: 'Digite seu nome.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Digite um email válido.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });

  try {
    const hash = await bcrypt.hash(password, 12);
    const r = await query(
      "INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'student') RETURNING id",
      [name, email, hash]
    );
    const u = await publicUser(r.rows[0].id);
    res.json({ token: sign(u), user: u });
  } catch (e) {
    if (e?.code === '23505') return res.status(409).json({ error: 'Este email já está cadastrado.' });
    console.error(e);
    res.status(500).json({ error: 'Não foi possível criar a conta agora.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Preencha email e senha.' });

  const r = await query('SELECT * FROM users WHERE email=$1', [email]);
  const u = r.rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) {
    return res.status(401).json({ error: 'Email ou senha inválidos.' });
  }

  const p = await publicUser(u.id);
  res.json({ token: sign(p), user: p });
});

app.get('/api/me', auth, async (req, res) => {
  const user = await publicUser(req.user.id);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado.' });
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => res.json({ ok: true }));

app.get('/api/progress', auth, async (req, res) => {
  const lessons = await query('SELECT lesson,completed FROM progress WHERE user_id=$1 ORDER BY lesson', [req.user.id]);
  const challenges = await query('SELECT challenge,completed FROM challenge_progress WHERE user_id=$1 ORDER BY challenge', [req.user.id]);
  res.json({ lessons: lessons.rows, challenges: challenges.rows });
});

app.post('/api/progress/lesson', auth, async (req, res) => {
  const lesson = Number(req.body?.lesson);
  if (![1, 2, 3, 4].includes(lesson)) return res.status(400).json({ error: 'Aula inválida.' });

  const old = await query('SELECT completed FROM progress WHERE user_id=$1 AND lesson=$2', [req.user.id, lesson]);
  if (!old.rows[0]?.completed) {
    await query(`
      INSERT INTO progress(user_id,lesson,completed,completed_at)
      VALUES($1,$2,1,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id,lesson)
      DO UPDATE SET completed=1,completed_at=CURRENT_TIMESTAMP
    `, [req.user.id, lesson]);
    await query('UPDATE users SET xp=xp+30 WHERE id=$1', [req.user.id]);
  }

  res.json({ user: await publicUser(req.user.id) });
});

app.post('/api/progress/challenge', auth, async (req, res) => {
  const challenge = String(req.body?.challenge || '').trim().slice(0, 60);
  if (!challenge) return res.status(400).json({ error: 'Desafio inválido.' });

  const old = await query('SELECT completed FROM challenge_progress WHERE user_id=$1 AND challenge=$2', [req.user.id, challenge]);
  if (!old.rows[0]?.completed) {
    await query(`
      INSERT INTO challenge_progress(user_id,challenge,completed,completed_at)
      VALUES($1,$2,1,CURRENT_TIMESTAMP)
      ON CONFLICT(user_id,challenge)
      DO UPDATE SET completed=1,completed_at=CURRENT_TIMESTAMP
    `, [req.user.id, challenge]);
    await query('UPDATE users SET xp=xp+20 WHERE id=$1', [req.user.id]);
  }

  res.json({ user: await publicUser(req.user.id) });
});

app.get('/api/teacher/dashboard', auth, teacherOnly, async (req, res) => {
  const r = await query(`
    SELECT u.id,u.name,u.email,u.xp,u.created_at,
      (SELECT COUNT(*) FROM progress p WHERE p.user_id=u.id AND p.completed=1) AS lessons,
      (SELECT COUNT(*) FROM challenge_progress c WHERE c.user_id=u.id AND c.completed=1) AS challenges
    FROM users u
    WHERE u.role='student'
    ORDER BY u.xp DESC,u.name ASC
  `);

  const students = r.rows.map(s => ({
    ...s,
    id: Number(s.id),
    xp: Number(s.xp),
    lessons: Number(s.lessons),
    challenges: Number(s.challenges)
  }));

  const totals = {
    students: students.length,
    lessons: students.reduce((a, s) => a + s.lessons, 0),
    challenges: students.reduce((a, s) => a + s.challenges, 0),
    xp: students.reduce((a, s) => a + s.xp, 0)
  };

  res.json({ students, totals });
});

app.get('/api/teacher/student/:id', auth, teacherOnly, async (req, res) => {
  const id = Number(req.params.id);
  const studentR = await query('SELECT id,name,email,xp,created_at FROM users WHERE id=$1 AND role=\'student\'', [id]);
  const student = studentR.rows[0];
  if (!student) return res.status(404).json({ error: 'Aluno não encontrado.' });

  student.id = Number(student.id);
  student.xp = Number(student.xp);

  const lessons = await query('SELECT lesson,completed,completed_at FROM progress WHERE user_id=$1 ORDER BY lesson', [id]);
  const challenges = await query('SELECT challenge,completed,completed_at FROM challenge_progress WHERE user_id=$1 ORDER BY challenge', [id]);
  res.json({ student, lessons: lessons.rows, challenges: challenges.rows });
});

app.post('/api/ai/tutor', auth, async (req, res) => {
  const question = String(req.body?.question || '').trim().slice(0, 4000);
  const code = String(req.body?.code || '').slice(0, 12000);
  if (!question) return res.status(400).json({ error: 'Digite uma dúvida.' });
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'O Tutor IA precisa de uma OPENAI_API_KEY configurada na hospedagem.' });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      instructions: 'Você é o tutor do IA WebLab. Ensine HTML, CSS e JavaScript para estudantes. Explique o raciocínio, dê pistas e passos pequenos. Não entregue um projeto inteiro sem explicação. Responda em português do Brasil.',
      input: `Dúvida: ${question}\n\nCódigo atual:\n${code}`
    });
    res.json({ answer: r.output_text || 'Não consegui gerar uma resposta.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Não foi possível consultar a IA agora.' });
  }
});

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

async function start() {
  await initDb();
  await ensureTeacher();
  const host = '0.0.0.0';
  app.listen(PORT, host, () => console.log(`IA WebLab 4.0 online na porta ${PORT}`));
}

start().catch(err => {
  console.error('Falha ao iniciar IA WebLab:', err);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});

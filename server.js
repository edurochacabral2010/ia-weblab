import express from 'express';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const db = new Database(path.join(__dirname, 'weblab.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'student' CHECK(role IN ('student','teacher')),
 xp INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS progress (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 lesson INTEGER NOT NULL CHECK(lesson BETWEEN 1 AND 4),
 completed INTEGER NOT NULL DEFAULT 0,
 completed_at TEXT,
 UNIQUE(user_id, lesson),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS challenge_progress (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 challenge TEXT NOT NULL,
 completed INTEGER NOT NULL DEFAULT 0,
 completed_at TEXT,
 UNIQUE(user_id, challenge),
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

async function ensureTeacher(){
 const email=String(process.env.TEACHER_EMAIL||'').trim().toLowerCase();
 const password=String(process.env.TEACHER_PASSWORD||'');
 if(!email||!password) return;
 const name=String(process.env.TEACHER_NAME||'Professor').trim()||'Professor';
 const hash=await bcrypt.hash(password,12);
 const old=db.prepare('SELECT id FROM users WHERE email=?').get(email);
 if(old) db.prepare("UPDATE users SET name=?,password_hash=?,role='teacher' WHERE id=?").run(name,hash,old.id);
 else db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'teacher')").run(name,email,hash);
}

app.use(express.json({limit:'200kb'}));
app.use(express.static(path.join(__dirname,'public')));

const publicUser=id=>db.prepare('SELECT id,name,email,role,xp,created_at FROM users WHERE id=?').get(id);
const sign=user=>jwt.sign({id:user.id,role:user.role},JWT_SECRET,{expiresIn:'7d'});
function auth(req,res,next){
 const h=req.headers.authorization||''; const t=h.startsWith('Bearer ')?h.slice(7):'';
 if(!t) return res.status(401).json({error:'Faça login para continuar.'});
 try{req.user=jwt.verify(t,JWT_SECRET);next();}catch{return res.status(401).json({error:'Sua sessão expirou. Entre novamente.'});}
}
function teacherOnly(req,res,next){if(req.user?.role!=='teacher') return res.status(403).json({error:'Área exclusiva do professor.'});next();}

app.get('/api/health',(req,res)=>res.json({ok:true,app:'IA WebLab',version:'4.0.0'}));

app.post('/api/auth/register',async(req,res)=>{
 const name=String(req.body?.name||'').trim(), email=String(req.body?.email||'').trim().toLowerCase(), password=String(req.body?.password||'');
 if(name.length<2) return res.status(400).json({error:'Digite seu nome.'});
 if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Digite um email válido.'});
 if(password.length<6) return res.status(400).json({error:'A senha precisa ter pelo menos 6 caracteres.'});
 try{const hash=await bcrypt.hash(password,12);const r=db.prepare('INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,\'student\')').run(name,email,hash);const u=publicUser(r.lastInsertRowid);res.json({token:sign(u),user:u});}
 catch{res.status(409).json({error:'Este email já está cadastrado.'});}
});

app.post('/api/auth/login',async(req,res)=>{
 const email=String(req.body?.email||'').trim().toLowerCase(), password=String(req.body?.password||'');
 if(!email||!password) return res.status(400).json({error:'Preencha email e senha.'});
 const u=db.prepare('SELECT * FROM users WHERE email=?').get(email);
 if(!u||!(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({error:'Email ou senha inválidos.'});
 const p=publicUser(u.id);res.json({token:sign(p),user:p});
});
app.get('/api/me',auth,(req,res)=>res.json({user:publicUser(req.user.id)}));
app.post('/api/auth/logout',(req,res)=>res.json({ok:true}));

app.get('/api/progress',auth,(req,res)=>{
 const lessons=db.prepare('SELECT lesson,completed FROM progress WHERE user_id=? ORDER BY lesson').all(req.user.id);
 const challenges=db.prepare('SELECT challenge,completed FROM challenge_progress WHERE user_id=? ORDER BY challenge').all(req.user.id);
 res.json({lessons,challenges});
});
app.post('/api/progress/lesson',auth,(req,res)=>{
 const lesson=Number(req.body?.lesson); if(![1,2,3,4].includes(lesson)) return res.status(400).json({error:'Aula inválida.'});
 const old=db.prepare('SELECT completed FROM progress WHERE user_id=? AND lesson=?').get(req.user.id,lesson);
 if(!old?.completed){db.prepare(`INSERT INTO progress(user_id,lesson,completed,completed_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(user_id,lesson) DO UPDATE SET completed=1,completed_at=CURRENT_TIMESTAMP`).run(req.user.id,lesson);db.prepare('UPDATE users SET xp=xp+30 WHERE id=?').run(req.user.id);}
 res.json({user:publicUser(req.user.id)});
});
app.post('/api/progress/challenge',auth,(req,res)=>{
 const challenge=String(req.body?.challenge||'').trim().slice(0,60);if(!challenge)return res.status(400).json({error:'Desafio inválido.'});
 const old=db.prepare('SELECT completed FROM challenge_progress WHERE user_id=? AND challenge=?').get(req.user.id,challenge);
 if(!old?.completed){db.prepare(`INSERT INTO challenge_progress(user_id,challenge,completed,completed_at) VALUES(?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(user_id,challenge) DO UPDATE SET completed=1,completed_at=CURRENT_TIMESTAMP`).run(req.user.id,challenge);db.prepare('UPDATE users SET xp=xp+20 WHERE id=?').run(req.user.id);}
 res.json({user:publicUser(req.user.id)});
});

app.get('/api/teacher/dashboard',auth,teacherOnly,(req,res)=>{
 const students=db.prepare(`SELECT u.id,u.name,u.email,u.xp,u.created_at,
 (SELECT COUNT(*) FROM progress p WHERE p.user_id=u.id AND p.completed=1) AS lessons,
 (SELECT COUNT(*) FROM challenge_progress c WHERE c.user_id=u.id AND c.completed=1) AS challenges
 FROM users u WHERE u.role='student' ORDER BY u.xp DESC,u.name COLLATE NOCASE`).all();
 const totals={students:students.length,lessons:students.reduce((a,s)=>a+s.lessons,0),challenges:students.reduce((a,s)=>a+s.challenges,0),xp:students.reduce((a,s)=>a+s.xp,0)};
 res.json({students,totals});
});

app.get('/api/teacher/student/:id',auth,teacherOnly,(req,res)=>{
 const id=Number(req.params.id), student=db.prepare("SELECT id,name,email,xp,created_at FROM users WHERE id=? AND role='student'").get(id);
 if(!student)return res.status(404).json({error:'Aluno não encontrado.'});
 res.json({student,lessons:db.prepare('SELECT lesson,completed,completed_at FROM progress WHERE user_id=? ORDER BY lesson').all(id),challenges:db.prepare('SELECT challenge,completed,completed_at FROM challenge_progress WHERE user_id=? ORDER BY challenge').all(id)});
});

app.post('/api/ai/tutor',auth,async(req,res)=>{
 const question=String(req.body?.question||'').trim().slice(0,4000), code=String(req.body?.code||'').slice(0,12000);
 if(!question)return res.status(400).json({error:'Digite uma dúvida.'});
 if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'O Tutor IA precisa de uma OPENAI_API_KEY no arquivo .env.'});
 try{const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY});const r=await client.responses.create({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',instructions:'Você é o tutor do IA WebLab. Ensine HTML, CSS e JavaScript para estudantes. Explique o raciocínio, dê pistas e passos pequenos. Não entregue um projeto inteiro sem explicação. Responda em português do Brasil.',input:`Dúvida: ${question}\n\nCódigo atual:\n${code}`});res.json({answer:r.output_text||'Não consegui gerar uma resposta.'});}
 catch(e){console.error(e);res.status(500).json({error:'Não foi possível consultar a IA agora.'});}
});

app.use((req,res,next)=>{if(req.method==='GET'&&!req.path.startsWith('/api/'))return res.sendFile(path.join(__dirname,'public','index.html'));next();});

await ensureTeacher();
app.listen(PORT,()=>console.log(`IA WebLab 4.0: http://localhost:${PORT}`));

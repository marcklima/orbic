require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const session = require('express-session');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Configuração Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ukpkzjidelestigniyni.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'chave-anonima';
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json());
app.use(session({
    secret: 'orbic-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Middleware Global de Autenticação (Popula dados do usuário nas views)
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    next();
});

// Middleware de Proteção
const requireAuth = (req, res, next) => {
    if (!req.session.user) {
        return res.redirect('/auth/login/google');
    }
    next();
};

// Rotas de Autenticação (Google OAuth)
app.get('/auth/login/google', async (req, res) => {
    const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: 'http://localhost:3000/auth/callback' }
    });
    if (data?.url) res.redirect(data.url);
    else res.status(500).send("Erro ao inicializar Google Auth.");
});

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (data && data.user) {
            const email = data.user.email;
            // RBAC Dinâmico baseado no e-mail
            let empresa = 'Cliente';
            let role = 'cliente';
            
            if (email.includes('@zents') || email === 'dev@orbic.com') {
                empresa = 'Zents';
                role = 'zents';
            }
            if (email.includes('admin') || email === 'marcklima@orbic.com' || email === 'bainautec@gmail.com') {
                role = 'admin';
            }

            // Upsert (Sincroniza) o usuário no banco de dados na tabela perfis_usuarios
            const { error: syncError } = await supabase.from('perfis_usuarios').upsert({
                id: data.user.id,
                nome_completo: data.user.user_metadata.full_name || "Usuário",
                nivel_acesso: role,
                ultima_atividade: new Date()
            }, { onConflict: 'id' });
            
            if (syncError) console.error("Erro ao sincronizar perfil:", syncError.message);

            req.session.user = {
                id: data.user.id,
                email: email,
                nome: data.user.user_metadata.full_name || "Usuário",
                picture: data.user.user_metadata.avatar_url || "",
                empresa: empresa,
                role: role
            };
        }
    }
    res.redirect('/suporte');
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


app.get('/', (req, res) => res.render('orbic'));
app.get('/hubimb', (req, res) => res.render('hubimb'));
app.get('/intellect', (req, res) => res.render('intellect'));
app.get('/videobook', (req, res) => res.render('videobook'));
app.get('/chat', (req, res) => res.render('chat'));

// Aplicar requireAuth nas rotas protegidas
app.use('/upgrade', requireAuth);
app.get('/upgrade', (req, res) => res.render('upgrade/index', { layout: false }));

// Rotas do Novo Módulo ITIL (Upgrade Zents)
app.get('/upgrade/chamados', requireAuth, (req, res) => {
    res.render('upgrade/chamados', { layout: false });
});

// Configuração do multer para anexos (simulado para a rota POST)
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/api/chamados', upload.array('anexos', 3), async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).send("Acesso Negado. Faça login.");
        }

        const { tipo, categoria, titulo, descricao, impacto, urgencia, prioridade } = req.body;
        
        // Salvando no banco de dados Supabase
        const { error: dbError } = await supabase.from('chamados_itil').insert({
            usuario_id: req.session.user.id,
            tipo: tipo,
            categoria: categoria,
            titulo: titulo,
            descricao: descricao,
            impacto: parseInt(impacto),
            urgencia: parseInt(urgencia),
            prioridade: prioridade,
            status: 'aberto'
        });

        if (dbError) throw dbError;

        console.log(`[ITIL Zents] Chamado Salvo no BD: ${prioridade} - ${titulo}`);
        console.log(`[E-MAIL SIMULADO] Disparando e-mail para dev@orbic.com -> Novo chamado ${prioridade} criado com sucesso.`);

        // Após salvar, redireciona de volta com mensagem de sucesso
        res.redirect('/upgrade/chamados?success=true');
    } catch (error) {
        console.error("Erro ao inserir chamado no BD:", error);
        res.status(500).send("Erro ao registrar chamado no banco de dados.");
    }
});

// Novas Rotas para o Sistema de Suporte e Financeiro
app.get('/suporte', requireAuth, (req, res) => {
    res.render('suporte');
});

app.get('/suporte/novo', requireAuth, (req, res) => {
    res.render('suporte_novo');
});

app.get('/financeiro', requireAuth, (req, res) => {
    res.render('financeiro');
});

// Rotas Administrativas
const adminRoutes = require('./routes/admin');
app.use('/admin', requireAuth, adminRoutes);
// Configuração do PG (Preencha as credenciais do seu banco)
const { Pool } = require('pg');
const pool = new Pool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 5432,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Rota de Chat Integrada ao n8n
app.post('/chat/pergunta', async (req, res) => {
    try {
        const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL;
        
        if (!n8nWebhookUrl) {
            throw new Error("URL do Webhook do n8n não configurada no .env.");
        }

        const { message, id_livro } = req.body;

        // Monta o payload enviando as variáveis
        const payload = {
            message: message,
            id_livro: id_livro || null, // Opcional, o n8n pode usar para filtrar o vector search
            timestamp: new Date()
        };

        console.log(`[Intellect Chat] Enviando pergunta para n8n: "${message}"`);

        // Envio HTTP POST para o n8n com Exponential Backoff
        let maxRetries = 3;
        let attempt = 0;
        let resposta = null;

        while (attempt < maxRetries) {
            try {
                resposta = await axios.post(n8nWebhookUrl, payload);
                break; // Sucesso, sai do loop
            } catch (err) {
                if (err.response && err.response.status === 429) {
                    attempt++;
                    console.warn(`[Intellect Chat] Erro 429. Tentativa ${attempt}/${maxRetries} falhou. Aguardando...`);
                    if (attempt >= maxRetries) throw err;
                    
                    // Delay Exponencial: 1000ms, 2000ms, 4000ms
                    const delay = Math.pow(2, attempt - 1) * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw err; // Lança outros erros normalmente
                }
            }
        }

        // Retorna pro front-end RAG a resposta formatada
        // (O n8n deve retornar um JSON com um campo "reply" ou "output")
        res.json({ reply: resposta.data.reply || resposta.data.output || resposta.data }); 
    } catch (error) {
        console.error("[Intellect Chat] Erro RAG n8n:", error.message);
        res.status(500).json({ reply: "Incapaz de acessar o repositório cognitivo no momento. Verifique a conexão com o núcleo n8n/Ollama." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

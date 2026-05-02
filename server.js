require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const session = require('express-session');
const axios = require('axios');

app.use(express.json());
app.use(session({
    secret: 'orbic-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.get('/', (req, res) => res.render('orbic'));
app.get('/hubimb', (req, res) => res.render('hubimb'));
app.get('/intellect', (req, res) => res.render('intellect'));
app.get('/videobook', (req, res) => res.render('videobook'));
app.get('/chat', (req, res) => res.render('chat'));

app.get('/upgrade', (req, res) => res.render('upgrade/index', { layout: false }));

// Novas Rotas para o Sistema de Suporte e Financeiro
app.get('/suporte', (req, res) => {
    // Simulando dados que virão do banco/sessão futuramente
    const user = { nome: "Usuário", empresa: "Zents", role: "admin" }; 
    res.render('suporte', { user });
});

app.get('/suporte/novo', (req, res) => {
    res.render('suporte_novo');
});

app.get('/financeiro', (req, res) => {
    res.render('financeiro');
});

// Rotas Administrativas
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);
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

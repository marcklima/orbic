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
const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ukpkzjidelestigniyni.supabase.co').trim();
const supabaseKeyRaw = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'chave-anonima';
const supabaseKey = supabaseKeyRaw.trim();

// Chave Service Role (Bypass RLS) para operações de backend seguras
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || supabaseKey).trim();

console.log("=== DIAGNÓSTICO DE AMBIENTE ===");
console.log("SUPABASE_URL:", supabaseUrl);
console.log("SUPABASE_KEY está configurada?", supabaseKey !== 'chave-anonima' ? "SIM" : "NÃO");
console.log("Tamanho da SUPABASE_KEY:", supabaseKey.length);
console.log("SERVICE_ROLE configurada?", process.env.SUPABASE_SERVICE_ROLE_KEY ? "SIM" : "NÃO");
console.log("Variáveis no ENV:", Object.keys(process.env).filter(k => k.includes('SUPABASE')));
console.log("===============================");

// Cliente Supabase Global (Anon)
const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        flowType: 'pkce',
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
    }
});

// Cliente Supabase Admin (Bypass RLS) para gravação no banco
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Helper para instanciar Supabase e salvar o PKCE Verifier na sessão do Express
const getSupabaseAuth = (req) => createClient(supabaseUrl, supabaseKey, {
    auth: {
        flowType: 'pkce',
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: true,
        storage: {
            getItem: (key) => req.session[key] || null,
            setItem: (key, value) => { req.session[key] = value; },
            removeItem: (key) => { delete req.session[key]; }
        }
    }
});

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
    // Garantir que a URL base seja a mesma pela qual o usuário está acessando (www ou não-www)
    // Isso evita perder o cookie de sessão `connect.sid` no redirecionamento (causa do erro PKCE)
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const siteUrl = `${protocol}://${req.get('host')}`;
    
    const supabaseAuth = getSupabaseAuth(req);
    const { data, error } = await supabaseAuth.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${siteUrl}/auth/callback` }
    });
    
    if (data?.url) {
        // Força a persistência da sessão na memória ANTES de enviar o redirect pro navegador
        req.session.save((err) => {
            if (err) console.error("Erro ao salvar PKCE na sessão:", err);
            res.redirect(data.url);
        });
    } else {
        res.status(500).send("Erro ao inicializar Google Auth.");
    }
});

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    console.log("[Auth Callback] Código recebido:", code ? "Sim" : "Não");

    if (code) {
        const supabaseAuth = getSupabaseAuth(req);
        const { data, error } = await supabaseAuth.auth.exchangeCodeForSession(code);
        
        if (error) {
            console.error("[Auth Callback] Erro no exchange:", error.message);
            return res.status(500).send("Erro de Autenticação Supabase: " + error.message);
        }

        if (data && data.user) {
            const email = data.user.email;
            
            // 1. Tenta buscar o usuário no banco
            const { data: userDb } = await supabase.from('perfis_usuarios').select('*').eq('id', data.user.id).single();
            
            let empresa = 'Cliente';
            let role = 'cliente';
            
            if (userDb && userDb.nivel_acesso) {
                // Se já existe no banco, respeita a permissão do banco
                role = userDb.nivel_acesso;
                empresa = email.includes('@zents') || role === 'admin' || role === 'zents' ? 'Zents' : 'Cliente';
            } else {
                // Se é novo, aplica a regra padrão do e-mail
                if (email === 'suporte.vidanca@gmail.com' || email === 'palavraevidaonline@gmail.com') {
                    role = 'admin'; empresa = 'Zents';
                } else if (email.includes('@zents') || email === 'dev@orbic.com') {
                    role = 'zents'; empresa = 'Zents';
                } else if (email.includes('admin') || email === 'marcklima@orbic.com' || email === 'bainautec@gmail.com') {
                    role = 'admin';
                }
            }

            // O Super Admin nunca perde a coroa
            if (email === 'palavraevidaonline@gmail.com') {
                role = 'admin';
            }
            // Força o Dev Zents a ter a permissão exata
            if (email === 'suporte.vidanca@gmail.com') {
                role = 'suporte_l1';
                empresa = 'Zents';
            }

            // Bloqueio de Acesso
            if (role === 'bloqueado') {
                return res.status(403).send("Seu acesso foi revogado pelo administrador do sistema.");
            }

            // Sincroniza o usuário (tentei omitir o email caso a coluna não exista, 
            // mas é super recomendado criar a coluna 'email' na tabela perfis_usuarios)
            const { error: syncError } = await supabase.from('perfis_usuarios').upsert({
                id: data.user.id,
                email: email,
                nome_completo: data.user.user_metadata.full_name || email.split('@')[0],
                nivel_acesso: role,
                ultima_atividade: new Date()
            }, { onConflict: 'id' });
            
            if (syncError) console.error("Erro ao sincronizar perfil:", syncError.message);

            req.session.user = {
                id: data.user.id,
                email: email,
                nome: data.user.user_metadata.full_name || email.split('@')[0],
                picture: data.user.user_metadata.avatar_url || "",
                empresa: empresa,
                role: role
            };
            
            // Salva a sessão explicitamente antes do redirecionamento
            return req.session.save((err) => {
                if (err) console.error("Erro ao salvar sessão:", err);
                res.redirect('/suporte');
            });
        } else {
            return res.status(400).send("Falha ao obter dados do usuário do Google.");
        }
    } else {
        // Se não houver código, o fluxo foi interrompido
        return res.status(400).send("Nenhum código de autorização foi retornado pelo Google.");
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


app.get('/', (req, res) => {
    // Intercepta o código de autenticação caso o Supabase redirecione para a raiz
    if (req.query.code) {
        return res.redirect(`/auth/callback?code=${req.query.code}`);
    }
    res.render('orbic');
});
app.get('/hubimb', (req, res) => res.render('hubimb'));
app.get('/intellect', (req, res) => res.render('intellect'));
app.get('/videobook', (req, res) => res.render('videobook'));
app.get('/chat', (req, res) => res.render('chat'));

// Aplicar requireAuth nas rotas protegidas
app.use('/upgrade', requireAuth);
app.get('/upgrade', (req, res) => res.render('upgrade/index', { layout: false }));

// Rotas do Novo Módulo ITIL (Upgrade Zents)
app.get('/upgrade/chamados', requireAuth, async (req, res) => {
    try {
        // Busca o histórico de chamados do usuário logado
        const { data: chamados, error } = await supabaseAdmin
            .from('chamados_itil')
            .select('*')
            .eq('usuario_id', req.session.user.id)
            .order('criado_em', { ascending: false });

        if (error) throw error;

        // Ordenação ITIL: Status prioritários > Prioridade (P1-P4) > Data
        if (chamados) {
            chamados.sort((a, b) => {
                const statusImportantes = ['recebido', 'em_andamento', 'pendente_cliente', 'atrasado'];
                const aImportante = statusImportantes.includes(a.status) ? 1 : 0;
                const bImportante = statusImportantes.includes(b.status) ? 1 : 0;
                
                if (aImportante !== bImportante) return bImportante - aImportante;
                if (a.prioridade && b.prioridade && a.prioridade !== b.prioridade) return a.prioridade.localeCompare(b.prioridade);
                return new Date(b.criado_em) - new Date(a.criado_em);
            });
        }

        res.render('upgrade/chamados', { 
            layout: false, 
            user: req.session.user, 
            chamados: chamados || [] 
        });
    } catch (err) {
        console.error("Erro ao carregar histórico de chamados:", err);
        res.render('upgrade/chamados', { layout: false, user: req.session.user, chamados: [] });
    }
});

// Configuração do multer para anexos (simulado para a rota POST)
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/api/chamados', upload.array('anexos', 3), async (req, res) => {
    try {
        if (!req.session.user) {
            return res.status(401).send("Acesso Negado. Faça login.");
        }

        const { tipo, categoria, titulo, descricao, impacto, urgencia } = req.body;
        
        const empresa_destino = (req.session.user.empresa === 'Zents' || req.session.user.role === 'zents') ? 'Zents' : 'Orbic';
        
        // Cálculo da Matriz de Prioridade ITIL no Servidor
        const imp = parseInt(impacto) || 3;
        const urg = parseInt(urgencia) || 3;
        const soma = imp + urg;
        let prioridadeITIL = "P4";
        if (soma === 2) prioridadeITIL = "P1";
        else if (soma === 3 || soma === 4) prioridadeITIL = "P2";
        else if (soma === 5) prioridadeITIL = "P3";

        // Salvando no banco de dados Supabase usando o cliente Admin para contornar o RLS
        const { error: dbError } = await supabaseAdmin.from('chamados_itil').insert({
            usuario_id: req.session.user.id,
            tipo: tipo,
            categoria: categoria,
            titulo: titulo,
            descricao: descricao,
            impacto: imp,
            urgencia: urg,
            prioridade: prioridadeITIL,
            status: 'recebido',
            empresa_destino: empresa_destino
        });

        if (dbError) throw dbError;

        console.log(`[ITIL Zents] Chamado Salvo no BD: ${prioridadeITIL} - ${titulo}`);
        console.log(`[E-MAIL SIMULADO] Disparando e-mail para dev@orbic.com -> Novo chamado ${prioridadeITIL} criado com sucesso.`);

        // Após salvar, redireciona de volta com mensagem de sucesso
        res.redirect('/upgrade/chamados?success=true');
    } catch (error) {
        console.error("Erro ao inserir chamado no BD:", error);
        res.status(500).send("Erro ao registrar chamado no banco de dados.");
    }
});

// ============================================
// PAINEL DE GESTÃO (DEV / ADMIN) E CHAT ITIL
// ============================================

app.get('/upgrade/gestao', requireAuth, async (req, res) => {
    // Admins, Zents e Suporte L1 podem acessar
    if (req.session.user.role !== 'admin' && req.session.user.role !== 'zents' && req.session.user.role !== 'suporte_l1') {
        return res.status(403).send("Acesso Negado. Esta página é exclusiva para a equipe técnica e sócios da Zents.");
    }

    try {
        const { data: chamados, error } = await supabaseAdmin
            .from('chamados_itil')
            .select('*')
            .order('criado_em', { ascending: false });
            
        if (error) {
            console.error("ERRO SUPABASE (Gestao):", error);
            throw error;
        }

        // Busca manual de perfis
        const userIds = [...new Set(chamados.map(c => c.usuario_id))];
        let mapNomes = {};
        if (userIds.length > 0) {
            const { data: perfis } = await supabaseAdmin.from('perfis_usuarios').select('id, nome_completo').in('id', userIds);
            if (perfis) perfis.forEach(p => mapNomes[p.id] = p.nome_completo);
        }

        let chamadosFiltrados = chamados.map(c => {
            c.nome_requerente = mapNomes[c.usuario_id] || 'Usuário';
            return c;
        });

        // O Dev da Zents e usuários Zents só veem Zents
        if (req.session.user.role === 'zents' || req.session.user.role === 'suporte_l1') {
            chamadosFiltrados = chamadosFiltrados.filter(c => c.empresa_destino === 'Zents');
        }

        // Ordenação ITIL: Status prioritários > Prioridade (P1-P4) > Data
        chamadosFiltrados.sort((a, b) => {
            const statusImportantes = ['recebido', 'em_andamento', 'pendente_cliente', 'atrasado'];
            const aImportante = statusImportantes.includes(a.status) ? 1 : 0;
            const bImportante = statusImportantes.includes(b.status) ? 1 : 0;
            
            if (aImportante !== bImportante) return bImportante - aImportante;
            if (a.prioridade && b.prioridade && a.prioridade !== b.prioridade) return a.prioridade.localeCompare(b.prioridade);
            return new Date(b.criado_em) - new Date(a.criado_em);
        });

        res.render('upgrade/gestao', { 
            layout: false, 
            user: req.session.user, 
            chamados: chamadosFiltrados 
        });
    } catch (err) {
        console.error("Erro ao carregar painel de gestão:", err);
        res.status(500).send("Erro ao carregar o painel.");
    }
});

// API: Retornar detalhes de um chamado + interações (Chat)
app.get('/api/chamados/:id', requireAuth, async (req, res) => {
    try {
        const chamadoId = req.params.id;
        
        // Busca chamado
        const { data: chamado, error: erroChamado } = await supabaseAdmin
            .from('chamados_itil')
            .select('*')
            .eq('id', chamadoId)
            .single();
            
        if (erroChamado) {
            console.error("ERRO SUPABASE (API Chamado):", erroChamado);
            throw erroChamado;
        }

        // Verifica permissão (Admin pode ver tudo, Cliente só vê o seu)
        if (req.session.user.role !== 'admin' && chamado.usuario_id !== req.session.user.id) {
            return res.status(403).json({ error: "Acesso negado a este chamado." });
        }

        // Busca Interações
        const { data: interacoes, error: erroInteracoes } = await supabaseAdmin
            .from('chamados_interacoes')
            .select('*')
            .eq('chamado_id', chamadoId)
            .order('criado_em', { ascending: true });

        if (erroInteracoes) {
             console.error("ERRO SUPABASE (API Interacoes):", erroInteracoes);
        }

        // Busca manual de perfis para interações
        if (interacoes && interacoes.length > 0) {
            const intUserIds = [...new Set(interacoes.map(i => i.usuario_id))];
            const { data: intPerfis } = await supabaseAdmin.from('perfis_usuarios').select('id, nome_completo, nivel_acesso').in('id', intUserIds);
            const mapInt = {};
            if (intPerfis) intPerfis.forEach(p => mapInt[p.id] = p);
            
            interacoes.forEach(i => {
                i.nome_autor = mapInt[i.usuario_id]?.nome_completo || 'Usuário';
                i.is_admin = (mapInt[i.usuario_id]?.nivel_acesso === 'admin' || mapInt[i.usuario_id]?.nivel_acesso === 'zents');
            });
        }
        
        // Adiciona o nome do autor principal no chamado
        const { data: autorChamado } = await supabaseAdmin.from('perfis_usuarios').select('nome_completo').eq('id', chamado.usuario_id).single();
        chamado.nome_requerente = autorChamado ? autorChamado.nome_completo : 'Usuário';

        res.json({ chamado, interacoes: interacoes || [] });
    } catch (err) {
        console.error("Erro na API de Chamado:", err);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// API: Atualizar Status do Chamado
app.post('/api/chamados/:id/status', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role !== 'admin' && req.session.user.role !== 'suporte_l1') return res.status(403).json({ error: "Acesso Negado." });
        
        const chamadoId = req.params.id;
        const { status } = req.body;
        
        const { error } = await supabaseAdmin
            .from('chamados_itil')
            .update({ status: status })
            .eq('id', chamadoId);
            
        if (error) throw error;

        // Log de Auditoria
        await supabaseAdmin.from('chamados_interacoes').insert({
            chamado_id: chamadoId,
            usuario_id: req.session.user.id,
            mensagem: `Status alterado para '${status.replace('_', ' ').toUpperCase()}' por ${req.session.user.nome}`,
            tipo: 'sistema' // Marcação para mensagens automáticas
        });
        res.json({ success: true, status });
    } catch (err) {
        res.status(500).json({ error: "Erro ao atualizar status" });
    }
});

// API: Enviar Mensagem no Chat do Chamado
app.post('/api/chamados/:id/interacao', requireAuth, async (req, res) => {
    try {
        const chamadoId = req.params.id;
        const { mensagem } = req.body;
        
        const { error } = await supabaseAdmin
            .from('chamados_interacoes')
            .insert({
                chamado_id: chamadoId,
                usuario_id: req.session.user.id,
                mensagem: mensagem,
                tipo: 'publico'
            });
            
        if (error) throw error;
        
        // Se for admin mandando, e o status era recebido, muda pra 'em_andamento'
        // Se for admin pedindo info, pode mudar para 'pendente_cliente' 
        // Por simplicidade, vamos deixar a atualização de status manual por enquanto
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erro ao enviar mensagem" });
    }
});

// API: Deletar Chamado (Super Admin)
app.post('/api/chamados/delete/:id', requireAuth, async (req, res) => {
    try {
        if (req.session.user.role !== 'admin') {
            return res.status(403).json({ error: "Acesso negado." });
        }
        
        const chamadoId = req.params.id;
        
        // Deleta primeiro as interações associadas (evitar erro de chave estrangeira)
        await supabase.from('chamados_interacoes').delete().eq('chamado_id', chamadoId);
        
        // Deleta o chamado em si
        const { error } = await supabase.from('chamados_itil').delete().eq('id', chamadoId);
        
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao deletar chamado:", err);
        res.status(500).json({ error: "Erro ao deletar chamado" });
    }
});

// Novas Rotas para o Sistema de Suporte e Financeiro
app.get('/suporte', requireAuth, (req, res) => {
    res.render('suporte');
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

// ==========================================
// PAINEL SUPER ADMIN: GESTÃO DE USUÁRIOS
// ==========================================
const requireSuperAdmin = (req, res, next) => {
    if (!req.session.user || req.session.user.email !== 'palavraevidaonline@gmail.com') {
        return res.status(403).send("Acesso negado. Apenas o Super Administrador pode acessar esta página.");
    }
    next();
};

app.get('/upgrade/admin/usuarios', requireSuperAdmin, async (req, res) => {
    // Busca todos os perfis
    const { data: usuarios, error } = await supabase
        .from('perfis_usuarios')
        .select('*')
        .order('ultima_atividade', { ascending: false });

    res.render('upgrade/admin_users', { 
        usuarios: usuarios || [], 
        erro: error ? error.message : null 
    });
});

app.post('/api/admin/usuarios/:id/role', requireSuperAdmin, async (req, res) => {
    const { role } = req.body;
    const userId = req.params.id;

    // Atualiza a permissão no banco de dados
    const { error } = await supabase
        .from('perfis_usuarios')
        .update({ nivel_acesso: role })
        .eq('id', userId);

    if (error) {
        console.error("Erro ao alterar permissão:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true });
});

// ==========================================
// MÓDULO FINANCEIRO (ZENTS)
// ==========================================
const requireZents = (req, res, next) => {
    if (!req.session.user || (req.session.user.role !== 'zents' && req.session.user.role !== 'admin')) {
        return res.status(403).send("Acesso Negado. Módulo restrito aos sócios Zents.");
    }
    next();
};

app.get('/financeiro', requireZents, async (req, res) => {
    // Busca transações e faz JOIN com perfis_usuarios para pegar o nome
    const { data: transacoes, error } = await supabase
        .from('financeiro_zents')
        .select('*, perfis_usuarios(nome_completo)')
        .order('data_evento', { ascending: false });

    res.render('upgrade/financeiro', { 
        transacoes: transacoes || [], 
        erro: error ? error.message : null 
    });
});

app.post('/api/financeiro', requireZents, async (req, res) => {
    try {
        const { tipo, categoria, valor, descricao, data_evento } = req.body;
        // Tratamento do valor (ex: 1.500,50 -> 1500.50)
        let val = valor.replace(/\./g, '').replace(',', '.');
        val = parseFloat(val);

        const { error } = await supabase.from('financeiro_zents').insert({
            usuario_id: req.session.user.id,
            tipo: tipo,
            categoria: categoria,
            valor: val,
            descricao: descricao,
            data_evento: data_evento
        });

        if (error) throw error;
        res.redirect('/financeiro?success=true');
    } catch (e) {
        console.error("Erro no financeiro:", e.message);
        res.status(500).send("Erro ao salvar transação: " + e.message);
    }
});

app.post('/api/financeiro/delete/:id', requireZents, async (req, res) => {
    try {
        const { id } = req.params;
        
        // Autorização no Node.js
        const { data: row } = await supabase.from('financeiro_zents').select('usuario_id').eq('id', id).single();
        if (!row) return res.status(404).send("Registro não encontrado.");
        
        if (row.usuario_id !== req.session.user.id && req.session.user.role !== 'admin') {
            return res.status(403).send("Você não tem permissão para excluir um registro criado por outro sócio.");
        }

        const { error } = await supabase.from('financeiro_zents').delete().eq('id', id);
        if (error) throw error;
        
        res.redirect('/financeiro?deleted=true');
    } catch (e) {
        console.error("Erro ao deletar financeiro:", e.message);
        res.status(500).send("Erro ao deletar transação: " + e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

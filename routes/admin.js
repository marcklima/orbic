// routes/admin.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

// Configuração Direta
const supabaseUrl = 'https://ukpkzjidelestigniyni.supabase.co';
const supabaseKey = 'sb_publishable_V3LP82e-UtbwwtT-gYKMog_QOKAZba4';

// APENAS UMA DECLARAÇÃO AQUI:
const supabase = createClient(supabaseUrl, supabaseKey);

// Configuração do Multer (continua igual abaixo...)
// Configuração do Multer focada em Memória para processamento RAG de PDFs
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Formato inválido. Apenas arquivos PDF são permitidos.'));
        }
    },
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// GET: Renderiza o Front end Administrativo
router.get('/upload', (req, res) => {
    res.render('admin_upload', { error: null, success: null });
});

// POST: Tenta Inserir e Auditar Log
router.post('/upload', upload.single('documento_pdf'), async (req, res) => {

    // Debug Frontend no VS Code Inicial
    console.log('Dados puros recebidos:', req.body);

    try {
        // Desestrutura TODOS os campos contendo names exatos definidos no form HTML
        const { titulo, autor, editora, ano_edicao, isbn, categoria, descricao, palavras_chave } = req.body;
        const file = req.file;

        if (!file) {
            return res.render('admin_upload', { error: 'Por favor, anexe o arquivo PDF da obra.', success: null });
        }

        // Formata as palavras-chave para Array nativo
        const arrayPalavras = palavras_chave ? palavras_chave.split(',').map(tag => tag.trim()) : [];

        // Montagem do DTO padronizado Exato para o banco de Dados
        const dadosInsercao = {
            titulo,
            autor,
            editora,
            ano_edicao: ano_edicao ? parseInt(ano_edicao) : null,
            isbn,
            categoria,
            descricao,
            palavras_chave: arrayPalavras
        };

        // Debug Exigido pelo Módulo
        console.log('Tentando inserir no Banco:', dadosInsercao);

        const { data: bookData, error: bookError } = await supabase
            .from('biblioteca_orbic')
            .insert([dadosInsercao])
            .select();

        // Se houver RLS Row Level Security ou violação de tipagem de dados, isso grita.
        if (bookError) throw bookError;

        // Auditoria Backoffice
        const { error: auditError } = await supabase
            .from('auditoria_sistema')
            .insert([
                {
                    acao: 'UPLOAD_LIVRO',
                    tabela_afetada: 'biblioteca_orbic',
                    registro_id: bookData[0].id,
                    data_hora: new Date(),
                    detalhes: `Ingestão RAG: "${titulo}" | Categoria: ${categoria}`
                }
            ]);

        if (auditError) {
            console.error('[AVISO]: Ocorreu um erro no trigger/table da auditoria:', auditError.message);
        }

        return res.render('admin_upload', { success: `A obra "${titulo}" foi integrada com excelência ao Core Inteligente!`, error: null });

    } catch (error) {

        // Debug Crítico Back-end
        console.error('Erro detalhado:', error);

        // Tratamento da Mensagem Final ao Usuário baseada em propriedades HTTP/Supabase
        let msgFront = 'Algo de errado aconteceu. Verifique o terminal para detalhes.';

        if (error.message) {
            msgFront = `Banco de Dados recusou: ${error.message}`;
        }

        if (error.code === 'ENOTFOUND' || (error.message && error.message.includes('fetch'))) {
            msgFront = 'Erro de Comunicação: A URL do Supabase ou a sua Internet local sofreram queda de tráfego.';
        }

        return res.render('admin_upload', { error: msgFront, success: null });
    }
});

// GET: Listagem da Biblioteca
router.get('/biblioteca', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('biblioteca_orbic')
            .select('*')
            .order('id', { ascending: false });

        if (error) throw error;

        console.log('Dados obtidos do banco para listagem:', data);

        res.render('admin_listagem', { livros: data || [], error: null });
    } catch (error) {
        console.error('Erro ao listar itens da biblioteca:', error);
        res.render('admin_listagem', { livros: [], error: 'Erro ao conectar com o banco de dados.' });
    }
});

// POST: Excluir Registro
router.post('/delete/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase
            .from('biblioteca_orbic')
            .delete()
            .eq('id', id);

        if (error) throw error;

        // Auditoria Backoffice: Remoção
        await supabase.from('auditoria_sistema').insert([{
            acao: 'DELETE_LIVRO',
            tabela_afetada: 'biblioteca_orbic',
            registro_id: null,
            data_hora: new Date(),
            detalhes: `ID da obra excluída: ${id}`
        }]);

        res.redirect('/admin/biblioteca');
    } catch (error) {
        console.error('Erro ao excluir registro:', error);
        res.redirect('/admin/biblioteca');
    }
});

module.exports = router;

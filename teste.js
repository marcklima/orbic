import { createClient } from '@supabase/supabase-js'

// Dados fornecidos
const supabaseUrl = "https://ukpkzjidelestigniyni.supabase.co"
const supabaseKey = "sb_publishable_V3LP82e-UtbwwtT-gYKMog_QOKAZba4"

// Cria o cliente Supabase
const supabase = createClient(supabaseUrl, supabaseKey)

async function testConnection() {
  // Troque 'sua_tabela' pelo nome de uma tabela real do seu banco
  const { data, error } = await supabase.from('biblioteca_orbic').select('*').limit(1)

  if (error) {
    console.error("❌ Erro de conexão:", error.message)
  } else {
    console.log("✅ Conexão OK, dados:", data)
  }
}

testConnection()

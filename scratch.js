const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://ukpkzjidelestigniyni.supabase.co';
const supabaseKey = 'sb_publishable_V3LP82e-UtbwwtT-gYKMog_QOKAZba4';
const supabase = createClient(supabaseUrl, supabaseKey);

async function testUpdate() {
    const { data: all, error: err1 } = await supabase.from('chamados_itil').select('id, status').limit(2);
    console.log("Current rows:", all, err1);

    if (all && all.length > 0) {
        const testId = all[0].id;
        const { data, error } = await supabase
            .from('chamados_itil')
            .update({ status: 'em_andamento' })
            .eq('id', testId)
            .select();
            
        console.log("Update Data:", data);
        console.log("Update Error:", error);
    }
}

testUpdate();

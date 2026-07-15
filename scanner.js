// ============================================
// SELEÇÃO DE ARQUIVOS - SCRIPTABLE
// ============================================

async function selecionarArquivos() {
    try {
        // Define os tipos de arquivo que podem ser selecionados
        // public.data = qualquer arquivo
        // public.text = arquivos de texto
        // public.json = arquivos JSON
        const utis = ["public.data", "public.text", "public.json"];
        
        // Abre o seletor de arquivos do iOS
        // DocumentPicker.open() retorna um array com os caminhos dos arquivos selecionados
        const fileUrls = await DocumentPicker.open(utis);
        
        if (!fileUrls || fileUrls.length === 0) {
            console.log("Nenhum arquivo selecionado");
            return [];
        }
        
        console.log(`${fileUrls.length} arquivo(s) selecionado(s)`);
        
        // Carrega cada arquivo selecionado
        const files = [];
        const fm = FileManager.local();
        
        for (const fileUrl of fileUrls) {
            try {
                // Lê o conteúdo do arquivo
                const content = fm.readString(fileUrl);
                
                // Extrai o nome do arquivo do caminho
                const fileName = fileUrl.split('/').pop();
                
                files.push({
                    name: fileName,
                    path: fileUrl,
                    content: content,
                    size: content ? content.length : 0
                });
                
                console.log(`📄 ${fileName} carregado (${content ? content.length : 0} bytes)`);
            } catch (error) {
                console.log(`Erro ao ler arquivo: ${error.message}`);
            }
        }
        
        return files;
        
    } catch (error) {
        console.log(`Erro no seletor: ${error.message}`);
        return [];
    }
}

// ============================================
// FUNÇÃO PRINCIPAL
// ============================================

async function main() {
    const alert = new Alert();
    alert.title = '🔍 Seletor de Arquivos';
    alert.message = 'Escolha os arquivos que deseja analisar';
    alert.addAction('📂 Selecionar Arquivos');
    alert.addAction('❌ Cancelar');
    
    const action = await alert.presentAlert();
    if (action === 1) return;
    
    const files = await selecionarArquivos();
    
    if (files && files.length > 0) {
        // Mostra os arquivos selecionados
        let message = `📂 ${files.length} arquivo(s) selecionado(s):\n\n`;
        for (const file of files) {
            const size = file.size < 1024 ? file.size + ' B' : 
                        (file.size / 1024).toFixed(1) + ' KB';
            message += `📄 ${file.name} (${size})\n`;
        }
        
        const resultAlert = new Alert();
        resultAlert.title = '✅ Arquivos Selecionados';
        resultAlert.message = message;
        resultAlert.addAction('OK');
        await resultAlert.presentAlert();
        
        // Retorna os arquivos para uso no resto do código
        return files;
    } else {
        const errorAlert = new Alert();
        errorAlert.title = '⚠️ Nenhum arquivo';
        errorAlert.message = 'Nenhum arquivo foi selecionado.';
        errorAlert.addAction('OK');
        await errorAlert.presentAlert();
        return [];
    }
}

// ============================================
// EXECUTAR
// ============================================

await main();

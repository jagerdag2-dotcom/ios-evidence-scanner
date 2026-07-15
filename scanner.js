// ============================================
// iOS EVIDENCE SCANNER - VERSÃO COMPLETA
// ============================================

// ============================================
// 1. CONFIGURATION
// ============================================

const CONFIG = {
    appName: 'iOS Evidence Scanner',
    version: '2.0.0',
    maxFileSize: 50 * 1024 * 1024,
    supportedExtensions: ['.plist', '.log', '.txt', '.json', '.ips', '.csv', '.xml', '.tracev3']
};

// ============================================
// 2. LOGGER
// ============================================

function log(message, level = 'INFO') {
    console.log(`[${new Date().toISOString()}] [${level}] ${message}`);
}

// ============================================
// 3. DATE UTILITIES
// ============================================

class DateUtils {
    static parseTimestamp(value) {
        if (!value) return null;
        try {
            const date = new Date(value);
            if (!isNaN(date.getTime())) return date;
            return null;
        } catch (e) { return null; }
    }

    static format(date) {
        if (!date) return 'Data não disponível';
        return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
}

// ============================================
// 4. EVENT MODEL
// ============================================

class EventModel {
    constructor(data) {
        this.id = 'evt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        this.timestamp = data.timestamp || new Date();
        this.source = data.source || 'unknown';
        this.category = data.category || 'System';
        this.type = data.type || 'unknown';
        this.description = data.description || '';
        this.data = data.data || {};
        this.metadata = data.metadata || {};
        this.confidence = data.confidence || 'medium';
        this.raw = data.raw || null;
    }
}

// ============================================
// 5. FILE LOADER - USA DOCUMENTPICKER
// ============================================

class FileLoader {
    constructor() {
        this.selectedFiles = [];
    }

    async selectFiles() {
        try {
            log('Abrindo seletor de arquivos nativo...');
            
            // Define os tipos de arquivo que podem ser selecionados
            const utis = ["public.data", "public.text", "public.json"];
            
            // Abre o seletor de arquivos do iOS
            const fileUrls = await DocumentPicker.open(utis);
            
            if (!fileUrls || fileUrls.length === 0) {
                log('Nenhum arquivo selecionado');
                return [];
            }

            log(`${fileUrls.length} arquivo(s) selecionado(s)`);
            
            // Carrega cada arquivo selecionado
            const files = [];
            const fm = FileManager.local();
            
            for (const fileUrl of fileUrls) {
                try {
                    // Lê o conteúdo do arquivo
                    const content = fm.readString(fileUrl);
                    
                    // Extrai o nome do arquivo do caminho
                    const fileName = fileUrl.split('/').pop();
                    const ext = this.getFileExtension(fileName);
                    
                    // Verifica se é um formato suportado
                    if (CONFIG.supportedExtensions.includes(ext)) {
                        files.push({
                            name: fileName,
                            path: fileUrl,
                            extension: ext,
                            content: content,
                            size: content ? content.length : 0,
                            modified: new Date(),
                            type: this.detectFileType(fileName)
                        });
                        log(`📄 ${fileName} carregado (${content ? content.length : 0} bytes)`);
                    } else {
                        log(`⚠️ Arquivo ignorado (formato não suportado): ${fileName}`, 'WARN');
                    }
                } catch (error) {
                    log(`Erro ao ler arquivo: ${error.message}`, 'ERROR');
                }
            }

            if (files.length === 0) {
                log('Nenhum arquivo válido foi carregado', 'WARN');
                return [];
            }

            this.selectedFiles = files;
            return files;

        } catch (error) {
            log(`Erro na seleção: ${error.message}`, 'ERROR');
            
            // Se o DocumentPicker falhar, tenta o fallback
            return await this.selectFromScriptableFolder();
        }
    }

    async selectFromScriptableFolder() {
        try {
            const fm = FileManager.local();
            const docs = fm.documentsDirectory();
            
            log(`Procurando na pasta do Scriptable: ${docs}`);
            
            const items = fm.listContents(docs);
            if (!items || items.length === 0) {
                log('Nenhum arquivo encontrado');
                return [];
            }

            const supportedItems = items.filter(item => {
                const ext = this.getFileExtension(item);
                return CONFIG.supportedExtensions.includes(ext);
            });

            if (supportedItems.length === 0) {
                const alert = new Alert();
                alert.title = 'ℹ️ Nenhum arquivo encontrado';
                alert.message = `Coloque arquivos na pasta do Scriptable:\n\n${CONFIG.supportedExtensions.join(', ')}`;
                alert.addAction('OK');
                await alert.presentAlert();
                return [];
            }

            const files = [];
            for (const item of supportedItems) {
                const path = fm.joinPath(docs, item);
                try {
                    const content = fm.readString(path);
                    files.push({
                        name: item,
                        path: path,
                        extension: this.getFileExtension(item),
                        content: content,
                        size: content ? content.length : 0,
                        modified: new Date(),
                        type: this.detectFileType(item)
                    });
                } catch (error) {
                    log(`Erro ao ler ${item}: ${error.message}`, 'ERROR');
                }
            }

            return files;

        } catch (error) {
            log(`Erro no fallback: ${error.message}`, 'ERROR');
            return [];
        }
    }

    detectFileType(filename) {
        const ext = this.getFileExtension(filename);
        const typeMap = {
            '.plist': 'Property List',
            '.json': 'JSON',
            '.log': 'Log',
            '.txt': 'Texto',
            '.csv': 'CSV',
            '.xml': 'XML',
            '.ips': 'Crash Report',
            '.tracev3': 'Trace Log'
        };
        return typeMap[ext] || 'Desconhecido';
    }

    getFileExtension(filename) {
        if (!filename) return '';
        const lastDot = filename.lastIndexOf('.');
        return lastDot > 0 ? filename.substring(lastDot).toLowerCase() : '';
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
        return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
    }

    getSelectedFiles() { return this.selectedFiles; }
}

// ============================================
// 6. PARSER
// ============================================

class Parser {
    async parse(file) {
        const events = [];
        const ext = file.extension || '';
        
        try {
            if (ext === '.json' || ext === '.ndjson') {
                return this.parseJSON(file);
            } else if (ext === '.plist') {
                return this.parsePlist(file);
            } else if (ext === '.ips') {
                return this.parseIPS(file);
            } else if (ext === '.log' || ext === '.txt') {
                return this.parseLog(file);
            } else if (ext === '.csv') {
                return this.parseCSV(file);
            } else {
                return this.parseLog(file);
            }
        } catch (error) {
            log(`Erro no parser: ${error.message}`, 'ERROR');
            return events;
        }
    }

    parseJSON(file) {
        const events = [];
        try {
            const lines = file.content.split('\n').filter(line => line.trim());
            for (let i = 0; i < Math.min(lines.length, 5000); i++) {
                try {
                    const data = JSON.parse(lines[i]);
                    events.push(new EventModel({
                        timestamp: new Date(),
                        source: file.name,
                        category: 'JSON',
                        type: 'event',
                        description: `Linha ${i + 1}`,
                        data: data,
                        raw: lines[i].substring(0, 500)
                    }));
                } catch (e) {}
            }
        } catch (error) {
            log(`Erro no JSON: ${error.message}`, 'ERROR');
        }
        return events;
    }

    parsePlist(file) {
        const events = [];
        try {
            const content = file.content;
            if (content.includes('<?xml') && content.includes('plist')) {
                const matches = content.match(/<key>(.*?)<\/key>\s*<([a-z]+)>(.*?)<\/\2>/gs);
                if (matches) {
                    const data = {};
                    for (const match of matches) {
                        const keyMatch = match.match(/<key>(.*?)<\/key>/);
                        const valueMatch = match.match(/<([a-z]+)>(.*?)<\/\1>/);
                        if (keyMatch && valueMatch) {
                            data[keyMatch[1]] = valueMatch[2];
                        }
                    }
                    events.push(new EventModel({
                        timestamp: new Date(),
                        source: file.name,
                        category: 'Plist',
                        type: 'plist',
                        description: `Arquivo PLIST com ${Object.keys(data).length} chaves`,
                        data: data,
                        raw: content.substring(0, 500)
                    }));
                }
            }
        } catch (error) {
            log(`Erro no PLIST: ${error.message}`, 'ERROR');
        }
        return events;
    }

    parseIPS(file) {
        const events = [];
        const content = file.content;
        
        const appMatch = content.match(/Application Name:\s*([^\n]+)/i) || content.match(/Process:\s*([^\n]+)/i);
        if (appMatch) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_app',
                description: `Aplicativo: ${appMatch[1]}`,
                data: { app: appMatch[1] }
            }));
        }

        const exceptionMatch = content.match(/Exception Type:\s*([^\n]+)/i);
        if (exceptionMatch) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Crash',
                type: 'crash_exception',
                description: `Exceção: ${exceptionMatch[1]}`,
                data: { exception: exceptionMatch[1] }
            }));
        }

        if (content.toLowerCase().includes('jailbreak') || content.toLowerCase().includes('cydia')) {
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: 'Jailbreak',
                type: 'jailbreak_indicator',
                description: 'Indicador de jailbreak no crash report',
                data: { indicator: 'Jailbreak' }
            }));
        }

        return events;
    }

    parseLog(file) {
        const events = [];
        const lines = file.content.split('\n');
        let count = 0;
        for (const line of lines) {
            if (!line.trim() || count++ > 5000) continue;
            const lower = line.toLowerCase();
            let category = 'Log';
            let type = 'log';
            if (lower.includes('error') || lower.includes('exception')) {
                category = 'Error';
                type = 'error';
            } else if (lower.includes('warning')) {
                category = 'Warning';
                type = 'warning';
            } else if (lower.includes('proxy') || lower.includes('mitm')) {
                category = 'Proxy';
                type = 'proxy';
            } else if (lower.includes('vpn')) {
                category = 'VPN';
                type = 'vpn';
            }
            
            events.push(new EventModel({
                timestamp: new Date(),
                source: file.name,
                category: category,
                type: type,
                description: line.substring(0, 200),
                data: { line: line.substring(0, 500) },
                raw: line.substring(0, 500)
            }));
        }
        return events;
    }

    parseCSV(file) {
        const events = [];
        const lines = file.content.split('\n');
        if (lines.length < 2) return events;
        const headers = lines[0].split(',').map(h => h.trim());
        for (let i = 1; i < Math.min(lines.length, 1000); i++) {
            const values = lines[i].split(',').map(v => v.trim());
            if (values.length === headers.length) {
                const data = {};
                for (let j = 0; j < headers.length; j++) {
                    data[headers[j]] = values[j];
                }
                events.push(new EventModel({
                    timestamp: new Date(),
                    source: file.name,
                    category: 'CSV',
                    type: 'row',
                    description: `Linha ${i}`,
                    data: data,
                    raw: lines[i].substring(0, 500)
                }));
            }
        }
        return events;
    }
}

// ============================================
// 7. DETECTORS
// ============================================

class Detector {
    constructor(name) {
        this.name = name;
    }

    detect(events) { return []; }

    createResult(type, evidence, confidence = 'medium') {
        return {
            detector: this.name,
            type: type,
            evidence: evidence,
            confidence: confidence,
            timestamp: new Date(),
            explanation: `Evidência de ${type} encontrada em ${evidence.source || 'arquivo'}`
        };
    }
}

class ProxyDetector extends Detector {
    constructor() {
        super('Proxy Detector');
        this.keywords = ['proxy', 'mitm', 'charles', 'burp', 'fiddler', 'proxyman', 'surge'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('Proxy Evidence', { source: event.source, keyword: keyword }, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

class VPNDetector extends Detector {
    constructor() {
        super('VPN Detector');
        this.keywords = ['vpn', 'tunnel', 'wireguard', 'openvpn', 'ikev2'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('VPN Evidence', { source: event.source, keyword: keyword }, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

class JailbreakDetector extends Detector {
    constructor() {
        super('Jailbreak Detector');
        this.keywords = ['cydia', 'sileo', 'zebra', 'substrate', 'substitute'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('Jailbreak Evidence', { source: event.source, keyword: keyword }, 'critical'));
                    break;
                }
            }
        }
        return results;
    }
}

class SideloadDetector extends Detector {
    constructor() {
        super('Sideload Detector');
        this.keywords = ['altstore', 'trollstore', 'sidestore', 'scarlet', 'esign'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('Sideload Evidence', { source: event.source, keyword: keyword }, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

class HookDetector extends Detector {
    constructor() {
        super('Hook Detector');
        this.keywords = ['frida', 'cycript', 'hook', 'inject'];
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            for (const keyword of this.keywords) {
                if (str.includes(keyword)) {
                    results.push(this.createResult('Hook Evidence', { source: event.source, keyword: keyword }, 'high'));
                    break;
                }
            }
        }
        return results;
    }
}

class FreeFireDetector extends Detector {
    constructor() {
        super('FreeFire Detector');
    }

    detect(events) {
        const results = [];
        for (const event of events) {
            const str = JSON.stringify(event).toLowerCase();
            if (str.includes('freefire') || str.includes('garena')) {
                results.push(this.createResult('FreeFire Evidence', { source: event.source }, 'medium'));
            }
        }
        return results;
    }
}

// ============================================
// 8. DETECTOR MANAGER
// ============================================

class DetectorManager {
    constructor() {
        this.detectors = [];
    }

    register(detector) {
        this.detectors.push(detector);
    }

    analyze(events) {
        const results = [];
        for (const detector of this.detectors) {
            try {
                const detections = detector.detect(events);
                results.push(...detections);
            } catch (error) {
                log(`Erro no detector ${detector.name}: ${error.message}`, 'ERROR');
            }
        }
        return results;
    }

    getDetectorCount() { return this.detectors.length; }
}

// ============================================
// 9. SCORE ENGINE
// ============================================

class ScoreEngine {
    constructor() {
        this.weights = { critical: 100, high: 50, medium: 25, low: 10 };
    }

    calculate(detections) {
        let total = 0;
        const byConfidence = { critical: 0, high: 0, medium: 0, low: 0 };
        
        for (const d of detections) {
            const conf = d.confidence || 'low';
            total += this.weights[conf] || 10;
            byConfidence[conf] = (byConfidence[conf] || 0) + 1;
        }

        let riskLevel = 'low';
        if (total >= 300) riskLevel = 'critical';
        else if (total >= 200) riskLevel = 'high';
        else if (total >= 100) riskLevel = 'medium';

        return { total: Math.min(total, 1000), riskLevel, byConfidence };
    }

    getRecommendations(score) {
        const recommendations = [];
        if (score.riskLevel === 'critical' || score.riskLevel === 'high') {
            recommendations.push('🔍 Realizar análise aprofundada');
            recommendations.push('📋 Verificar certificados e configurações');
        }
        if (score.byConfidence?.critical > 0) {
            recommendations.push('⚠️ Evidências críticas encontradas - priorizar investigação');
        }
        return recommendations;
    }
}

// ============================================
// 10. UI
// ============================================

class UI {
    constructor(app) {
        this.app = app;
    }

    async showMainMenu() {
        const alert = new Alert();
        alert.title = '🔍 iOS Evidence Scanner';
        alert.message = `v${CONFIG.version}\n\nScanner forense para análise de evidências em arquivos iOS`;
        alert.addAction('🔍 Nova Análise');
        alert.addAction('📖 Ajuda');
        alert.addAction('❌ Sair');
        return await alert.presentAlert();
    }

    async selectFiles() {
        if (!this.app || !this.app.fileLoader) {
            throw new Error('FileLoader não disponível');
        }
        return await this.app.fileLoader.selectFiles();
    }

    async showFileInfo(files) {
        if (!files || files.length === 0) return false;
        
        let message = `📂 ${files.length} arquivo(s) selecionado(s):\n\n`;
        let totalSize = 0;
        
        for (const file of files) {
            const size = this.app.fileLoader.formatFileSize(file.size);
            totalSize += file.size || 0;
            message += `📄 ${file.name}\n   Tipo: ${file.type || 'Desconhecido'} • Tamanho: ${size}\n\n`;
        }
        
        message += `📊 Total: ${this.app.fileLoader.formatFileSize(totalSize)}`;
        
        const alert = new Alert();
        alert.title = '📂 Arquivos Selecionados';
        alert.message = message + '\n\nDeseja iniciar a análise?';
        alert.addAction('✅ Iniciar Análise');
        alert.addAction('❌ Cancelar');
        
        return await alert.presentAlert() === 0;
    }

    async showProgress(current, total, message) {
        const percentage = Math.round((current / total) * 100);
        const bar = '█'.repeat(Math.round(percentage/5)) + '░'.repeat(20 - Math.round(percentage/5));
        log(`${percentage}% - ${message}`);
        
        if (percentage % 20 === 0 || percentage === 100) {
            const alert = new Alert();
            alert.title = '🔄 Processando...';
            alert.message = `${message}\n\n${bar}\n${percentage}% concluído (${current}/${total})`;
            if (percentage >= 100) {
                alert.addAction('✅ Concluído!');
                await alert.presentAlert();
            } else {
                alert.presentAlert().catch(() => {});
            }
        }
    }

    async showReport(report) {
        const webView = new WebView();
        webView.title = '📊 Relatório de Análise';
        webView.loadHTML(this.generateReportHTML(report));
        await webView.present(true);
    }

    generateReportHTML(report) {
        return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>iOS Evidence Scanner - Relatório</title>
<style>
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; color: #333; padding: 16px; }
.container { max-width: 800px; margin: 0 auto; background: white; padding: 24px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
h1 { color: #007aff; font-size: 24px; }
.score { font-size: 48px; font-weight: bold; color: #007aff; }
.risk { padding: 10px 20px; border-radius: 20px; display: inline-block; font-weight: bold; }
.risk-critical { background: #ff3b30; color: white; }
.risk-high { background: #ff9500; color: white; }
.risk-medium { background: #ffcc00; color: #000; }
.risk-low { background: #34c759; color: white; }
.detection { background: #f8f9fa; padding: 10px; border-radius: 5px; margin: 5px 0; border-left: 4px solid #007aff; }
.confidence-critical { border-left-color: #ff3b30; }
.confidence-high { border-left-color: #ff9500; }
.confidence-medium { border-left-color: #ffcc00; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 10px; margin: 20px 0; }
.stat-box { background: #f8f9fa; padding: 10px; border-radius: 5px; text-align: center; }
</style>
</head>
<body>
<div class="container">
    <h1>🔍 ${report.appName || 'iOS Evidence Scanner'}</h1>
    <p>Versão: ${report.version} • ${new Date(report.generated).toLocaleString('pt-BR')}</p>
    
    <div style="display:flex; justify-content:space-between; align-items:center; margin:20px 0;">
        <div><span class="score">${report.score}</span><br>Score</div>
        <div><span class="risk risk-${report.riskLevel}">${(report.riskLevel || 'low').toUpperCase()}</span></div>
    </div>
    
    <div class="stats">
        <div class="stat-box">${report.totalEvents}<br>Eventos</div>
        <div class="stat-box">${report.totalDetections}<br>Detecções</div>
    </div>
    
    ${report.detections && report.detections.length > 0 ? `
    <h2>🔎 Detecções</h2>
    ${report.detections.map(d => `
        <div class="detection confidence-${d.confidence || 'low'}">
            <strong>${d.type || 'Detecção'}</strong> [${(d.confidence || 'low').toUpperCase()}]
            <br><span style="color:#666;font-size:14px;">${d.explanation || ''}</span>
            ${d.evidence?.source ? `<br><span style="color:#999;font-size:12px;">📁 ${d.evidence.source}</span>` : ''}
        </div>
    `).join('')}
    ` : '<p>Nenhuma detecção encontrada</p>'}
    
    ${report.recommendations && report.recommendations.length > 0 ? `
    <h2>💡 Recomendações</h2>
    <ul>${report.recommendations.map(r => `<li>${r}</li>`).join('')}</ul>
    ` : ''}
</div>
</body>
</html>`;
    }

    async showStats(stats) {
        const alert = new Alert();
        alert.title = '📊 Estatísticas';
        alert.message = `
📈 Resumo:
  Eventos: ${stats.totalEvents}
  Detecções: ${stats.totalDetections}
  Tempo: ${(stats.executionTime / 1000).toFixed(2)}s
  Arquivos: ${stats.fileCount || 0}

🔍 Confiança:
  Crítico: ${stats.byConfidence?.critical || 0}
  Alta: ${stats.byConfidence?.high || 0}
  Média: ${stats.byConfidence?.medium || 0}
  Baixa: ${stats.byConfidence?.low || 0}
        `;
        alert.addAction('OK');
        await alert.presentAlert();
    }

    async showError(error) {
        const alert = new Alert();
        alert.title = '❌ Erro';
        alert.message = error.message || 'Erro inesperado';
        alert.addAction('OK');
        await alert.presentAlert();
    }

    async showHelp() {
        const alert = new Alert();
        alert.title = '📖 Ajuda';
        alert.message = `
🔍 iOS Evidence Scanner v${CONFIG.version}

📁 Formatos suportados:
PLIST, JSON, LOG, TXT, IPS, CSV, XML, TRACEV3

🔎 Detectores:
- Proxy
- VPN
- Jailbreak
- Sideload
- Hook
- Free Fire

📂 Como usar:
1. Execute o scanner
2. Selecione "Nova Análise"
3. O seletor de arquivos do iOS vai abrir
4. Navegue e selecione os arquivos
5. Confirme a seleção
6. Aguarde a análise
7. Veja o relatório

Níveis de confiança:
🔴 Crítico - Evidência forte
🟠 Alta - Evidência significativa
🟡 Média - Indício
🟢 Baixa - Possível indício
        `;
        alert.addAction('OK');
        await alert.presentAlert();
    }
}

// ============================================
// 11. APPLICATION
// ============================================

class Application {
    constructor() {
        this.fileLoader = new FileLoader();
        this.parser = new Parser();
        this.detectorManager = new DetectorManager();
        this.scoreEngine = new ScoreEngine();
        this.ui = new UI(this);
        
        this.events = [];
        this.detections = [];
        this.startTime = null;
        this.endTime = null;
        
        this.registerDetectors();
    }

    registerDetectors() {
        this.detectorManager.register(new ProxyDetector());
        this.detectorManager.register(new VPNDetector());
        this.detectorManager.register(new JailbreakDetector());
        this.detectorManager.register(new SideloadDetector());
        this.detectorManager.register(new HookDetector());
        this.detectorManager.register(new FreeFireDetector());
    }

    async run() {
        try {
            while (true) {
                const action = await this.ui.showMainMenu();
                switch (action) {
                    case 0: await this.runAnalysis(); break;
                    case 1: await this.ui.showHelp(); break;
                    case 2: return;
                }
            }
        } catch (error) {
            await this.ui.showError(error);
        }
    }

    async runAnalysis() {
        try {
            // 1. Selecionar arquivos - abre o seletor nativo do iOS
            const files = await this.ui.selectFiles();
            if (!files || files.length === 0) {
                await this.ui.showError(new Error('Nenhum arquivo selecionado'));
                return;
            }

            const confirmed = await this.ui.showFileInfo(files);
            if (!confirmed) return;

            this.startTime = Date.now();
            this.events = [];
            this.detections = [];

            // 2. Processar arquivos
            const totalFiles = files.length;
            for (let i = 0; i < totalFiles; i++) {
                const file = files[i];
                await this.ui.showProgress(i, totalFiles, `Analisando: ${file.name}`);
                
                const parsedEvents = await this.parser.parse(file);
                this.events.push(...parsedEvents);
            }

            // 3. Executar detectores
            await this.ui.showProgress(1, 1, 'Executando detectores...');
            this.detections = this.detectorManager.analyze(this.events);

            // 4. Calcular score
            const score = this.scoreEngine.calculate(this.detections);
            this.endTime = Date.now();

            // 5. Gerar relatório
            const report = {
                appName: CONFIG.appName,
                version: CONFIG.version,
                generated: new Date().toISOString(),
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                score: score.total,
                riskLevel: score.riskLevel,
                detections: this.detections,
                recommendations: this.scoreEngine.getRecommendations(score),
                files: files.map(f => ({ name: f.name, size: f.size }))
            };

            await this.ui.showReport(report);

            // 6. Estatísticas
            const statsData = {
                totalEvents: this.events.length,
                totalDetections: this.detections.length,
                executionTime: this.endTime - this.startTime,
                fileCount: files.length,
                byConfidence: score.byConfidence
            };
            await this.ui.showStats(statsData);

        } catch (error) {
            await this.ui.showError(error);
        }
    }
}

// ============================================
// 12. PONTO DE ENTRADA
// ============================================

(async () => {
    try {
        const app = new Application();
        await app.run();
    } catch (error) {
        log(`Erro fatal: ${error.message}`, 'ERROR');
        const alert = new Alert();
        alert.title = '❌ Erro Fatal';
        alert.message = error.message;
        alert.addAction('OK');
        await alert.presentAlert();
    }
})();

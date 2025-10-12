document.addEventListener('DOMContentLoaded', () => {
    const logContainer = document.getElementById('log-container');
    const clearButton = document.getElementById('clear-logs-button');

    const renderLogs = (logs = []) => {
        if (logs.length === 0) {
            logContainer.textContent = '暂无日志。';
            return;
        }
        // 反转日志，让最新的显示在最上面
        logContainer.textContent = logs.reverse().map(log => JSON.stringify(log, null, 2)).join('\n\n---\n\n');
    };

    // 页面加载时，从storage加载并显示日志
    chrome.storage.local.get('logs', (result) => {
        renderLogs(result.logs);
    });

    // 监听storage变化，实时更新日志
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && changes.logs) {
            renderLogs(changes.logs.newValue);
        }
    });

    // 清空日志按钮
    clearButton.addEventListener('click', () => {
        chrome.storage.local.set({ logs: [] }, () => {
            logContainer.textContent = '日志已清空。';
        });
    });
});

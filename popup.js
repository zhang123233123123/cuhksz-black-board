/**
 * @file popup.js
 * @description 插件弹出窗口的UI逻辑。
 */

document.addEventListener('DOMContentLoaded', () => {
    const syncButton = document.getElementById('sync-button');
    const exportButton = document.getElementById('export-button');
    const clearButton = document.getElementById('clear-button');
    const downloadButton = document.getElementById('download-button');
    const statusDisplay = document.getElementById('status-display');
    const courseFilter = document.getElementById('course-filter');
    const tabNav = document.querySelector('.tab-nav');
    const tabContents = document.querySelectorAll('.tab-content');
    const tabLinks = document.querySelectorAll('.tab-link');

    let currentData = null;

    // 更新状态显示和按钮状态
    const updateStatusUI = (status) => {
        statusDisplay.textContent = status.message || '空闲';
        if (status.name === 'running') {
            syncButton.disabled = true;
            syncButton.textContent = '同步中...';
        } else {
            syncButton.disabled = false;
            syncButton.textContent = '一键同步';
        }
    };

    // 渲染课程筛选下拉菜单
    const renderCourseFilter = (courses) => {
        courseFilter.innerHTML = '<option value="all">所有课程</option>'; // 重置
        if (Array.isArray(courses) && courses.length > 0) {
            [...new Set(courses)].forEach(courseName => {
                const option = document.createElement('option');
                option.value = courseName;
                option.textContent = courseName;
                courseFilter.appendChild(option);
            });
        }
        courseFilter.value = 'all';
    };

    // 渲染内容列表
    const renderContent = () => {
        if (!currentData) return;

        const selectedCourse = courseFilter.value;
        const activeTab = document.querySelector('.tab-link.active').dataset.tab;

        const filterAndRender = (dataType, containerId) => {
            const container = document.getElementById(containerId);
            container.innerHTML = ''; // 清空
            const items = currentData[dataType] || [];
            
            const filteredItems = items.filter(item => selectedCourse === 'all' || item.course === selectedCourse);

            if (filteredItems.length === 0) {
                container.innerHTML = '<p>无内容</p>';
                return;
            }

            filteredItems.forEach(item => {
                const itemEl = document.createElement('div');
                itemEl.className = 'item';
                let bodyHtml = '';
                if (dataType === 'announcements') {
                    bodyHtml = `<div class="item-meta">发布者: ${item.author || 'N/A'}</div><div class="item-body">${item.body || ''}</div>`;
                } else if (dataType === 'assignments') {
                    bodyHtml = `<div class="item-meta">截止日期: ${item.dueDate || 'N/A'}</div><div class="item-body">${item.instructions || ''}</div>`;
                }

                itemEl.innerHTML = `
                    <div class="item-header">${item.title}</div>
                    <div class="item-meta">课程: ${item.course}</div>
                    ${bodyHtml}
                `;

                if (dataType === 'assignments' && Array.isArray(item.attachments) && item.attachments.length > 0) {
                    const attachmentsContainer = document.createElement('div');
                    attachmentsContainer.className = 'item-attachments';

                    const label = document.createElement('div');
                    label.className = 'item-meta';
                    label.textContent = '附件:';
                    attachmentsContainer.appendChild(label);

                    const list = document.createElement('ul');
                    list.className = 'attachment-list';

                    item.attachments.filter(att => att && att.url).forEach((attachment, index) => {
                        const listItem = document.createElement('li');
                        const link = document.createElement('a');
                        link.href = attachment.url;
                        link.textContent = attachment.text?.trim() || `附件 ${index + 1}`;
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        listItem.appendChild(link);
                        list.appendChild(listItem);
                    });

                    if (list.childElementCount > 0) {
                        attachmentsContainer.appendChild(list);
                        itemEl.appendChild(attachmentsContainer);
                    }
                }

                itemEl.querySelectorAll('a[href]').forEach(anchor => {
                    anchor.target = '_blank';
                    anchor.rel = 'noopener noreferrer';
                });

                container.appendChild(itemEl);
            });
        };

        filterAndRender('announcements', 'announcements');
        filterAndRender('assignments', 'assignments');
        filterAndRender('others', 'others');
    };

    // 初始化：从storage加载数据和状态
    chrome.storage.local.get(['status', 'aggregatedData'], (result) => {
        if (result.status) {
            updateStatusUI(result.status);
        }
        if (result.aggregatedData) {
            currentData = result.aggregatedData;
            renderCourseFilter(currentData.courses);
            renderContent();
        }
    });

    // 监听storage变化，实时更新UI
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local') {
            if (changes.status) {
                updateStatusUI(changes.status.newValue);
            }
            if (changes.aggregatedData) {
                currentData = changes.aggregatedData.newValue;
                renderCourseFilter(currentData.courses);
                renderContent();
            }
        }
    });

    // “一键同步”按钮点击事件
    syncButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'START_AGGREGATION' }, (response) => {
            if (chrome.runtime.lastError) {
                statusDisplay.textContent = '错误：无法连接到后台脚本。';
                console.error(chrome.runtime.lastError);
            } else {
                console.log(response.message);
            }
        });
    });

    clearButton.addEventListener('click', () => {
        clearButton.disabled = true;
        chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }, (response) => {
            clearButton.disabled = false;
            if (chrome.runtime.lastError) {
                statusDisplay.textContent = '错误：无法连接到后台脚本。';
                console.error(chrome.runtime.lastError);
                return;
            }
            if (response?.status === 'ok') {
                const emptyData = { announcements: [], assignments: [], others: [], courses: [], lastUpdated: null };
                currentData = emptyData;
                renderCourseFilter(currentData.courses);
                renderContent();
            } else if (response?.message) {
                statusDisplay.textContent = `错误：${response.message}`;
            }
        });
    });

    const sanitizePathPart = (input, fallback) => {
        const pattern = /[\\/:*?"<>|]+/g;
        const trimmed = (input || '').trim();
        if (!trimmed) {
            const fallbackValue = (fallback || '').trim() || '文件';
            return fallbackValue.replace(pattern, '_');
        }
        return trimmed.replace(pattern, '_');
    };

    const collectDownloadableAttachments = () => {
        if (!currentData) return [];
        const selectedCourse = courseFilter.value;
        const assignments = Array.isArray(currentData.assignments) ? currentData.assignments : [];
        const attachments = [];
        const seen = new Set();

        assignments
            .filter(item => selectedCourse === 'all' || item.course === selectedCourse)
            .forEach(item => {
                if (!Array.isArray(item.attachments)) return;
                item.attachments.forEach(attachment => {
                    if (!attachment?.url) return;
                    const key = attachment.url;
                    if (seen.has(key)) return;
                    seen.add(key);
                    attachments.push({
                        course: item.course,
                        assignmentTitle: item.title,
                        dueDate: item.dueDate,
                        text: attachment.text,
                        url: attachment.url
                    });
                });
            });

        return attachments;
    };

    const buildDownloadFilename = (attachment, fallbackIndex, filenameCounts) => {
        const coursePart = sanitizePathPart(attachment.course, '课程');
        const assignmentPart = sanitizePathPart(attachment.assignmentTitle, '作业');
        const defaultName = `附件_${fallbackIndex + 1}`;
        const rawName = sanitizePathPart(attachment.text, defaultName) || defaultName;

        let extension = '';
        try {
            const urlObj = new URL(attachment.url);
            const match = urlObj.pathname.match(/\.([^.\\/]+)$/);
            if (match) {
                extension = `.${match[1]}`;
            }
        } catch (error) {
            console.warn('无法解析附件的扩展名', attachment.url, error);
        }

        const hasExtension = /\.[A-Za-z0-9]{1,6}$/.test(rawName);
        let filenameCore = hasExtension ? rawName : (extension ? `${rawName}${extension}` : rawName);
        if (!filenameCore.trim()) {
            filenameCore = extension ? `${defaultName}${extension}` : defaultName;
        }

        const key = `${coursePart}|${assignmentPart}|${filenameCore}`;
        const count = filenameCounts.get(key) || 0;
        if (count > 0) {
            const dotIndex = filenameCore.lastIndexOf('.');
            if (dotIndex > 0) {
                filenameCore = `${filenameCore.slice(0, dotIndex)}(${count + 1})${filenameCore.slice(dotIndex)}`;
            } else {
                filenameCore = `${filenameCore}(${count + 1})`;
            }
        }
        filenameCounts.set(key, count + 1);

        return `${coursePart}/${assignmentPart}/${filenameCore}`;
    };

    const triggerDownload = (attachment, filename) => new Promise(resolve => {
        chrome.downloads.download({ url: attachment.url, filename, saveAs: false }, downloadId => {
            if (chrome.runtime.lastError || typeof downloadId !== 'number') {
                console.error('下载失败', attachment.url, chrome.runtime.lastError?.message);
                resolve({ ok: false, error: chrome.runtime.lastError?.message || '未知错误' });
            } else {
                resolve({ ok: true, downloadId });
            }
        });
    });

    if (downloadButton) {
        downloadButton.addEventListener('click', async () => {
            if (!currentData) {
                statusDisplay.textContent = '没有可下载的数据，请先同步。';
                return;
            }

            const attachments = collectDownloadableAttachments();
            if (attachments.length === 0) {
                statusDisplay.textContent = '当前筛选下没有可下载的附件。';
                return;
            }

            downloadButton.disabled = true;
            try {
                statusDisplay.textContent = `准备下载 ${attachments.length} 个附件，请确认浏览器的下载权限。`;

                let successCount = 0;
                let failedCount = 0;
                const filenameCounts = new Map();

                for (let i = 0; i < attachments.length; i++) {
                    const attachment = attachments[i];
                    const filename = buildDownloadFilename(attachment, i, filenameCounts);
                    const result = await triggerDownload(attachment, filename);
                    if (result.ok) {
                        successCount += 1;
                    } else {
                        failedCount += 1;
                    }
                }

                const summaryParts = [];
                if (successCount > 0) summaryParts.push(`${successCount} 个附件已加入下载队列`);
                if (failedCount > 0) summaryParts.push(`${failedCount} 个附件下载失败`);
                statusDisplay.textContent = summaryParts.join('，') || '下载任务已完成。';
            } catch (error) {
                console.error('执行批量下载时发生错误', error);
                statusDisplay.textContent = '批量下载时出现异常，请查看控制台日志。';
            } finally {
                downloadButton.disabled = false;
            }
        });
    }

    // “导出JSON”按钮点击事件
    exportButton.addEventListener('click', () => {
        if (currentData) {
            const dataStr = JSON.stringify(currentData, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `blackboard_data_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else {
            alert('没有可导出的数据。请先同步。');
        }
    });

    // 课程筛选变化事件
    courseFilter.addEventListener('change', renderContent);

    // 标签页切换事件
    tabNav.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-link')) {
            const targetTab = e.target.dataset.tab;

            tabLinks.forEach(link => link.classList.remove('active'));
            e.target.classList.add('active');

            tabContents.forEach(content => {
                if (content.id === targetTab) {
                    content.classList.add('active');
                } else {
                    content.classList.remove('active');
                }
            });
            renderContent();
        }
    });
});

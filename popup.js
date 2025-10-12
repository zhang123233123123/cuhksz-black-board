/**
 * @file popup.js
 * @description 插件弹出窗口的UI逻辑。
 */

document.addEventListener('DOMContentLoaded', () => {
    const syncButton = document.getElementById('sync-button');
    const exportButton = document.getElementById('export-button');
    const clearButton = document.getElementById('clear-button');
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

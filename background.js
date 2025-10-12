/**
 * @file background.js
 * @description 插件核心逻辑，负责数据抓取、处理和存储。(Final, rebuilt version)
 */

// 1. 配置高于硬编码: 所有CSS选择器在此集中定义
// =================================================================
const CONFIG = {
    // 课程列表页 (根据用户提供的HTML结构更新)
    courses: {
        listContainer: "[id='module:_3_1'] ul.courseListing", // 课程模块容器
        courseItem: 'li',                                     // 单个课程的列表项
        courseLink: "a[href*='type=Course']"                 // 指向单个课程页面的链接
    },
    // 单个课程内容页
    courseItems: {
        container: '#whatsNewView', // "What's New" 模块的容器
        categoryBlock: 'ul.blockGroups > li[id^="block::"]', // 每个分类的块 (公告, 作业等)
        itemRow: 'ul.itemGroups > li', // 单个内容条目
        itemLink: 'a' // 条目的链接
    },
    // 公告详情页
    announcementDetails: {
        body: 'div.vtbegenerated',
        authorContainer: 'div.announcementInfo' // 发布者信息的容器
    },
    // 作业详情页
    assignmentDetails: {
        dueDate: '#metadata .metaField', // 截止日期是元数据列表的第一个字段
        instructionsContainer: '#instructions', // 指令/附件的容器
        attachments: '#instructions a' // 附件链接
    },
    // 用于识别条目类型的关键字
    itemTypeKeywords: {
        announcement: '::AN',
        assignment: '::AS'
    }
};

// 2. 工具函数 (Utilities)
// =================================================================

const log = async (level, event, context = {}) => {
    const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        event,
        context
    };
    console.log(JSON.stringify(logEntry, null, 2));
    try {
        const { logs = [] } = await chrome.storage.local.get('logs');
        logs.push(logEntry);
        const trimmedLogs = logs.slice(-100);
        await chrome.storage.local.set({ logs: trimmedLogs });
    } catch (e) {
        console.error("Failed to write to log storage:", e);
    }
};

const setStatus = async (status, message = '') => {
    await chrome.storage.local.set({ status: { name: status, message } });
    await log('INFO', 'SET_STATUS', { status, message });
};

const executeInTab = async (tabId, func, args = []) => {
    const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: func,
        args: args,
        world: 'MAIN'
    });
    return results?.[0]?.result;
};

const waitForElement = (tabId, selector, timeout = 15000) => {
    log('INFO', 'WAIT_FOR_ELEMENT', { selector, timeout });
    return new Promise((resolve) => {
        const startTime = Date.now();
        const interval = setInterval(async () => {
            const elementExists = await executeInTab(tabId, (sel) => !!document.querySelector(sel), [selector]);
            if (elementExists) {
                clearInterval(interval);
                log('SUCCESS', 'ELEMENT_FOUND', { selector });
                resolve(true);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(interval);
                log('ERROR', 'WAIT_FOR_ELEMENT_TIMEOUT', { selector });
                resolve(false);
            }
        }, 500);
    });
};

const navigateAndWait = (tabId, url) => {
    return new Promise(resolve => {
        chrome.tabs.update(tabId, { url }, () => {
            const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
    });
};

// 3. 模块化提取函数
// =================================================================

function extractData_Courses(config) {
    const courseItems = document.querySelectorAll(`${config.courses.listContainer} > ${config.courses.courseItem}`);
    const courses = [];
    courseItems.forEach(item => {
        const courseLink = item.querySelector(config.courses.courseLink);
        if (courseLink) {
            courses.push({
                name: courseLink.innerText.trim(),
                url: courseLink.href,
            });
        }
    });
    return courses;
}

function extractData_CourseItems(config) {
    const items = [];
    const categoryBlocks = document.querySelectorAll(config.courseItems.container + ' ' + config.courseItems.categoryBlock);

    categoryBlocks.forEach(block => {
        const blockId = block.id || '';
        let itemType = 'other';

        if (blockId.toUpperCase().includes(config.itemTypeKeywords.announcement)) {
            itemType = 'announcement';
        } else if (blockId.toUpperCase().includes(config.itemTypeKeywords.assignment)) {
            itemType = 'assignment';
        }

        const itemRows = block.querySelectorAll(config.courseItems.itemRow);
        itemRows.forEach(row => {
            const link = row.querySelector(config.courseItems.itemLink);
            if (link && row.id) {
                const clickSelector = `#${row.id.replace(/:/g, '\\:')} > span > a`;
                items.push({
                    title: link.innerText.trim(),
                    type: itemType,
                    clickSelector: clickSelector
                });
            }
        });
    });

    return items;
}

function extractData_AnnouncementDetails(config) {
    const body = document.querySelector(config.announcementDetails.body)?.innerHTML.trim();
    let author = '';
    const authorContainer = document.querySelector(config.announcementDetails.authorContainer);
    if (authorContainer) {
        const paragraphs = Array.from(authorContainer.getElementsByTagName('p'));
        const authorParagraph = paragraphs.find(p => p.innerText.includes('Posted by:'));
        if (authorParagraph) {
            author = authorParagraph.innerText.replace('Posted by:', '').trim();
        }
    }
    return { body, author };
}

function extractData_AssignmentDetails(config) {
    const dueDateElement = document.querySelector(config.assignmentDetails.dueDate);
    const dueDate = dueDateElement ? dueDateElement.innerText.trim().replace(/\n/g, ' ') : '';
    const instructions = document.querySelector(config.assignmentDetails.instructionsContainer)?.innerHTML.trim();
    const attachments = Array.from(document.querySelectorAll(config.assignmentDetails.attachments)).map(a => ({ text: a.innerText, url: a.href }));
    return { dueDate, instructions, attachments };
}

// 4. 主流程函数
// =================================================================

async function runAggregation(tabId) {
    const originalUrl = (await chrome.tabs.get(tabId)).url;
    await log('INFO', 'RUN_AGGREGATION_START', { tabId, originalUrl });
    try {
        await setStatus('running', '开始同步...正在获取课程列表...');
        const courses = await executeInTab(tabId, extractData_Courses, [CONFIG]);
        if (!courses || courses.length === 0) {
            throw new Error('未能获取到课程列表，请确认您在Blackboard主页。');
        }
        await log('SUCCESS', 'EXTRACTED_COURSES', { count: courses.length });

        const { aggregatedData: existingData = {} } = await chrome.storage.local.get('aggregatedData');
        const aggregatedData = {
            announcements: Array.isArray(existingData?.announcements) ? [...existingData.announcements] : [],
            assignments: Array.isArray(existingData?.assignments) ? [...existingData.assignments] : [],
            others: Array.isArray(existingData?.others) ? [...existingData.others] : [],
            courses: Array.isArray(existingData?.courses) ? [...existingData.courses] : [],
            lastUpdated: new Date().toISOString()
        };

        const coursesSet = new Set(aggregatedData.courses);
        const seenKeys = new Set();
        const seedSeenKeys = (items, fallbackType) => {
            if (!Array.isArray(items)) return;
            items.forEach(existingItem => {
                const type = existingItem.type || fallbackType;
                if (!type || !existingItem.course || !existingItem.title) return;
                const key = `${type}|${existingItem.course}|${existingItem.title}`;
                seenKeys.add(key);
                coursesSet.add(existingItem.course);
            });
        };
        seedSeenKeys(aggregatedData.announcements, 'announcement');
        seedSeenKeys(aggregatedData.assignments, 'assignment');
        seedSeenKeys(aggregatedData.others, 'other');

        for (const course of courses) {
            try {
                coursesSet.add(course.name);
                await setStatus('running', `正在处理课程: ${course.name}`);
                await log('INFO', 'PROCESSING_COURSE', { courseName: course.name });

                await navigateAndWait(tabId, course.url);
                const coursePageReady = await waitForElement(tabId, CONFIG.courseItems.container);
                if (!coursePageReady) {
                    throw new Error(`课程页面 "${course.name}" 加载超时。`);
                }

                const items = await executeInTab(tabId, extractData_CourseItems, [CONFIG]);
                await log('INFO', 'EXTRACTED_COURSE_ITEMS', { courseName: course.name, count: items.length });

                for (let index = 0; index < items.length; index++) {
                    const item = items[index];
                    const itemKey = `${item.type}|${course.name}|${item.title}`;
                    if (seenKeys.has(itemKey)) {
                        await log('INFO', 'ITEM_SKIPPED_ALREADY_EXISTS', { courseName: course.name, itemTitle: item.title, type: item.type });
                        continue;
                    }

                    let needsDetailPage = false;
                    let navigatedAway = false;

                    try {
                        await setStatus('running', `处理中: ${course.name} > ${item.title}`);
                        await log('INFO', 'PROCESSING_ITEM', { courseName: course.name, itemTitle: item.title, position: index + 1 });

                        needsDetailPage = item.type === 'announcement' || item.type === 'assignment';

                        if (needsDetailPage) {
                            const clicked = await executeInTab(tabId, (selector) => {
                                const el = document.querySelector(selector);
                                if (el) {
                                    el.click();
                                    return true;
                                }
                                return false;
                            }, [item.clickSelector]);

                            if (!clicked) {
                                throw new Error(`无法找到用于点击的选择器: ${item.clickSelector}`);
                            }

                            navigatedAway = true;

                            if (item.type === 'announcement') {
                                const ready = await waitForElement(tabId, CONFIG.announcementDetails.body);
                                if (!ready) throw new Error('公告详情页加载超时');
                                const details = await executeInTab(tabId, extractData_AnnouncementDetails, [CONFIG]);
                                aggregatedData.announcements.push({ course: course.name, ...item, ...details, type: 'announcement' });
                            } else {
                                const ready = await waitForElement(tabId, CONFIG.assignmentDetails.instructionsContainer);
                                if (!ready) throw new Error('作业详情页加载超时');
                                const details = await executeInTab(tabId, extractData_AssignmentDetails, [CONFIG]);
                                aggregatedData.assignments.push({ course: course.name, ...item, ...details, type: 'assignment' });
                            }
                        } else {
                            aggregatedData.others.push({ course: course.name, ...item, type: item.type || 'other' });
                        }

                        seenKeys.add(itemKey);
                        await log('SUCCESS', 'EXTRACTED_ITEM_DETAILS', { itemTitle: item.title, type: item.type, courseName: course.name, position: index + 1 });
                    } catch (itemError) {
                        await log('ERROR', 'ITEM_PROCESSING_FAILED', { courseName: course.name, itemTitle: item.title, error: itemError.message });
                    } finally {
                        if (needsDetailPage && navigatedAway) {
                            try {
                                await navigateAndWait(tabId, course.url);
                                await waitForElement(tabId, CONFIG.courseItems.container);
                            } catch (returnError) {
                                await log('WARN', 'RETURN_TO_COURSE_FAILED', { courseName: course.name, error: returnError.message });
                            }
                        }
                    }
                }
            } catch (courseError) {
                await log('ERROR', 'COURSE_PROCESSING_FAILED', { courseName: course.name, error: courseError.message });
            }
        }

        const dedupeCollection = (items, fallbackType) => {
            if (!Array.isArray(items)) return [];
            const map = new Map();
            items.forEach(item => {
                const type = item.type || fallbackType;
                if (!type || !item.course || !item.title) return;
                const key = `${type}|${item.course}|${item.title}`;
                if (!map.has(key)) {
                    map.set(key, { ...item, type });
                }
            });
            return Array.from(map.values());
        };

        aggregatedData.announcements = dedupeCollection(aggregatedData.announcements, 'announcement');
        aggregatedData.assignments = dedupeCollection(aggregatedData.assignments, 'assignment');
        aggregatedData.others = dedupeCollection(aggregatedData.others, 'other');
        aggregatedData.courses = Array.from(coursesSet);

        await log('SUCCESS', 'AGGREGATION_COMPLETE', { announcements: aggregatedData.announcements.length, assignments: aggregatedData.assignments.length, others: aggregatedData.others.length });
        await chrome.storage.local.set({ aggregatedData });
        await setStatus('idle', `同步完成！上次更新于: ${new Date().toLocaleString()}`);
    } catch (error) {
        await log('ERROR', 'RUN_AGGREGATION_FAILED', { error: error.message, stack: error.stack });
        await setStatus('error', `发生严重错误: ${error.message}`);
    } finally {
        await log('INFO', 'NAVIGATING_BACK_TO_ORIGINAL_URL', { url: originalUrl });
        await navigateAndWait(tabId, originalUrl);
    }
}

// 5. 事件监听器
// =================================================================

chrome.runtime.onInstalled.addListener(() => {
    log('INFO', 'PLUGIN_INSTALLED', { message: 'The background script has successfully started.' });
});

chrome.runtime.onStartup.addListener(() => {
    log('INFO', 'BROWSER_STARTUP', { message: 'Browser has started, background script is running.' });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log('INFO', 'MESSAGE_RECEIVED', { type: message.type });
    if (message.type === 'START_AGGREGATION') {
        (async () => {
            try {
                const resolveActiveTab = async () => {
                    try {
                        const lastFocusedWindow = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal'] });
                        if (lastFocusedWindow?.tabs) {
                            const tab = lastFocusedWindow.tabs.find(t => t.active && !t.url?.startsWith('chrome://')); // ignore Chrome internals
                            if (tab) return tab;
                        }
                    } catch (windowError) {
                        await log('WARN', 'LAST_FOCUSED_WINDOW_FAILED', { error: windowError.message });
                    }

                    const [tabFromLastFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                    if (tabFromLastFocused) return tabFromLastFocused;

                    const [tabFromCurrentWindow] = await chrome.tabs.query({ active: true, currentWindow: true });
                    return tabFromCurrentWindow;
                };

                const activeTab = await resolveActiveTab();

                if (!activeTab) {
                    await log('ERROR', 'NO_ACTIVE_TAB_FOUND');
                    await setStatus('error', '无法获取当前标签页，请在Blackboard页面打开插件重试。');
                    sendResponse({ status: 'error', message: '无法获取当前标签页。' });
                    return;
                }

                if (!activeTab.url || !activeTab.url.startsWith('https://bb.cuhk.edu.cn/')) {
                    await log('ERROR', 'NOT_ON_BLACKBOARD_PAGE', { url: activeTab.url });
                    await setStatus('error', '请在Blackboard标签页上运行此插件。');
                    sendResponse({ status: 'error', message: '请切换到Blackboard标签页后重试。' });
                    return;
                }

                await log('INFO', 'ACTIVE_TAB_FOUND', { tabId: activeTab.id, url: activeTab.url });
                runAggregation(activeTab.id);
                sendResponse({ status: "ok", message: "Aggregation process started." });
            } catch (queryError) {
                await log('ERROR', 'ACTIVE_TAB_QUERY_FAILED', { error: queryError.message });
                await setStatus('error', '无法获取当前标签页，请在Blackboard页面打开插件重试。');
                sendResponse({ status: 'error', message: '无法获取当前标签页。' });
            }
        })();
        // Return true to indicate that the response will be sent asynchronously.
        return true;
    }
    if (message.type === 'CLEAR_DATA') {
        (async () => {
            try {
                const emptyData = { announcements: [], assignments: [], others: [], courses: [], lastUpdated: null };
                await chrome.storage.local.set({ aggregatedData: emptyData });
                await log('INFO', 'LOCAL_DATA_CLEARED', {});
                await setStatus('idle', '数据已清空，可重新同步。');
                sendResponse({ status: 'ok', message: '数据已清空。' });
            } catch (clearError) {
                await log('ERROR', 'CLEAR_DATA_FAILED', { error: clearError.message });
                sendResponse({ status: 'error', message: clearError.message });
            }
        })();
        return true;
    }
    // Return false for messages我们不处理的异步请求。
    return false;
});

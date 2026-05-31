// ==UserScript==
// @name     Zammad customizations
// @match    https://help.vates.tech/*
// @version  1.1.15
// @license      GPL-v3
// @author       DanP2
// @grant              GM_getValue
// @grant              GM_setValue
// @grant              GM.getValue
// @grant              GM.setValue
// @grant              GM_registerMenuCommand
// @grant              GM_addStyle
// @grant              GM_xmlhttpRequest
// @grant              window.close
// @connect            cdn.jsdelivr.net
// @icon               https://avatars.githubusercontent.com/u/1380327?s=200&v=4
// @run-at             document-start
// @description        Customize Zammad
// ==/UserScript==

/* global GM_getValue, GM_info, GM_registerMenuCommand, GM_addStyle, GM_xmlhttpRequest, waitForKeyElements */

(function() {
    'use strict';

    const DEBUG = false;
    const HELP_ORIGIN = 'https://help.vates.tech';
    const KB_PATH = '/kb';
    const configId = 'zammadCfg';
    const singleTab = {
        channelName: 'zammad-tab',
        tabIdKey: 'zammad-ticket-tab-id',
        establishedKey: 'zammad-ticket-tab-established',
        allowLoadKey: 'zammad-ticket-tab-allow-load',
        requestType: 'zammad-ticket-request',
        acceptedType: 'zammad-ticket-accepted',
        probeDelay: 750,
    };
    const dependencies = [
        ['waitForKeyElements', 'https://cdn.jsdelivr.net/gh/CoeJoder/waitForKeyElements.js@v1.2/waitForKeyElements.js'],
        ['GM_config', 'https://cdn.jsdelivr.net/gh/sizzlemctwizzle/GM_config@master/gm_config.js'],
    ];

    let gmc;
    let GMConfig;
    const isMac = navigator.platform.toUpperCase().includes('MAC');

    if (!checkExistingInstance()) {
        return;
    }

    const addedHotkeys = [
        {saveName: 'addCollapseAll', key: 'z', code: 'KeyZ', default: true, desc: 'Collapse all articles', func: () => collapseEntries(true)},
        {saveName: 'addExpandAll', key: 'x', code: 'KeyX', default: true, desc: 'Expand all articles', func: () => collapseEntries(false)},
        {saveName: 'addClearDups', key: 'n', code: 'KeyN', default: true, desc: 'Clear duplicate notifications', func: () => clearNotifications()},
        {saveName: 'addReplyLast', key: 'l', code: 'KeyL', default: true, desc: 'Reply to last response', func: () => replyLast()},
        {saveName: 'addFormatCode', key: 'c', code: 'KeyC', default: true, desc: 'Format code tag', selectionOnly: true, func: () => wrapSelection('pre', 'code')},
        {saveName: 'addFormatBlock', key: 'b', code: 'KeyB', default: true, desc: 'Format blockquote tag', selectionOnly: true, func: () => wrapSelection('blockquote')},
    ];

    loadDependencies()
        .then(setupScript)
        .catch((e) => console.error(`${GM_info.script.name} dependency load error:`, e));

    function debug(...args) {
        if (DEBUG) {
            console.log(...args);
        }
    }

    function setupScript() {
        GM_addStyle('.ticket-article.extended { max-width: 10000px; }');
        if (!GMConfig) {
            console.error(`${GM_info.script.name}: GM_config is not loaded`);
            return;
        }

        gmc = new GMConfig(buildConfig());
        document.addEventListener('keydown', handleHotkey, true);
    }

    function buildConfig() {
        const checkbox = (label, defaultValue, section) => ({
            ...(section ? {section} : {}),
            label,
            labelPos: 'right',
            type: 'checkbox',
            default: defaultValue,
        });
        const cfg = {
            id: configId,
            title: 'Script Settings',
            frameStyle: `
                height: 535px;
                width: 435px;
                border: 1px solid;
                border-radius: 3px;
                position: fixed;
                z-index: 9999;
            `,
            fields: {
                closeNotification: checkbox('Close notifications when clicked?', true, ['Notifications', '']),
                requireAlt: checkbox('Require Alt key?', false),
                existingTab: checkbox('Open in existing tab?', true, ['External Links', '']),
                ticketExtended: checkbox('Use extended view?', false, ['Tickets', '']),
                articleResize: checkbox('Control click to expand / collapse?', true, ['Articles', '']),
                articleHideBlocked: checkbox('Hide blocked remote content message?', true),
            },
            events: {
                init: onInit,
                save: onSave,
            },
        };

        addedHotkeys.forEach((hotkey, index) => {
            cfg.fields[hotkey.saveName] = checkbox(
                `Enable "${hotkey.desc}"? (${formatHotkey(hotkey)})`,
                hotkey.default,
                index === 0 ? ['Hotkeys', 'Add hotkeys'] : null,
            );
        });

        return cfg;
    }

    function onInit() {
        const popoverSelector = 'div.popover--notifications';
        const notificationLinkSelector = 'div.js-items > div.activity-entry > div.activity-body > a.activity-message';
        const activityRemoveSelector = 'div.activity-remove';
        const appSelector = 'div#app';
        const ticketSelector = 'div.ticket-article';
        const ticketItemSelector = 'div.ticket-article-item';
        const blockedContentSelector = 'div.remote-content-message';

        GM_registerMenuCommand('Settings', () => gmc.open());

        waitForKeyElements(popoverSelector, (element) => {
            element.addEventListener('click', (event) => {
                const link = getEventElement(event)?.closest(notificationLinkSelector);
                if (!link || !gmc.get('closeNotification') || (gmc.get('requireAlt') && !event.altKey)) {
                    return;
                }

                link.closest('.activity-entry')?.querySelector(activityRemoveSelector)?.click();
            });
        });

        waitForKeyElements(appSelector, (element) => {
            onElementInserted(element, ticketItemSelector, triggerHashChange);
        });

        document.body.addEventListener('click', (event) => {
            const bubble = getEventElement(event)?.closest('.textBubble');
            if (!bubble || !gmc.get('articleResize') || !event.ctrlKey) {
                return;
            }

            event.stopImmediatePropagation();
            Array.from(bubble.querySelectorAll('.js-toggleFold'))
                .find(isVisible)
                ?.click();
        });

        const applyTicketDisplaySettings = () => {
            const hideBlocked = gmc.get('articleHideBlocked');
            const extended = gmc.get('ticketExtended');

            document.querySelectorAll(blockedContentSelector)
                .forEach((message) => {
                    message.style.display = hideBlocked ? 'none' : '';
                });
            document.querySelectorAll(ticketSelector)
                .forEach((ticket) => ticket.classList.toggle('extended', extended));
        };

        window.addEventListener('hashchange', applyTicketDisplaySettings);
        applyTicketDisplaySettings();
        debug(`Successfully started ${GM_info.script.name} version ${GM_info.script.version}`);
    }

    function onSave() {
        gmc.close();
        triggerHashChange();
    }

    function triggerHashChange() {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
    }

    function isVisible(element) {
        return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    }

    function onElementInserted(container, elementSelector, callback) {
        const target = typeof container === 'string' ? document.querySelector(container) : container;
        const MutationObserver = window.MutationObserver || window.WebKitMutationObserver;

        if (!target || !MutationObserver) {
            return null;
        }

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node.nodeType !== Node.ELEMENT_NODE) {
                        return;
                    }

                    if (node.matches(elementSelector)) {
                        callback(node);
                    }

                    node.querySelectorAll(elementSelector).forEach(callback);
                });
            });
        });

        observer.observe(target, {childList: true, subtree: true});
        return observer;
    }

    function handleHotkey(event) {
        const hotkey = getMatchingHotkey(event);
        if (!hotkey) {
            return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        debug(`Running "${hotkey.desc}" hotkey (${formatHotkey(hotkey)})`);
        hotkey.func(hotkey);
    }

    function getMatchingHotkey(event) {
        if (
            event.defaultPrevented
            || event.repeat
            || event.metaKey
            || event.shiftKey
            || !event.ctrlKey
            || !event.altKey
            || (!isMac && event.getModifierState?.('AltGraph'))
        ) {
            return null;
        }

        const hotkey = addedHotkeys.find((entry) => event.code === entry.code && gmc.get(entry.saveName));
        return hotkey && customHotkeysFilter(event, hotkey) ? hotkey : null;
    }

    function formatHotkey(hotkey) {
        return `ctrl+alt/option+${hotkey.key}`;
    }

    function checkExistingInstance() {
        try {
            const targetUrl = getReusableHelpUrl();
            if (!targetUrl) {
                return true;
            }

            const tabId = getSingleTabId();
            const channel = new BroadcastChannel(singleTab.channelName);
            let requestHandled = false;
            let activeRequestId;

            channel.addEventListener('message', (message) => {
                const existingTab = isExistingTabEnabled();
                const data = message.data || {};
                debug('zammad existing-tab message received', existingTab, data);

                if (!existingTab || data.tabId === tabId) {
                    return;
                }

                if (data.type === singleTab.requestType) {
                    if (!isReusableHelpUrl(data.url) || !isReusableHelpLocation(window.location)) {
                        return;
                    }

                    channel.postMessage({
                        type: singleTab.acceptedType,
                        requestId: data.requestId,
                        tabId,
                    });
                    window.focus();
                    window.location.replace(data.url);
                    return;
                }

                if (data.type === singleTab.acceptedType && data.requestId === activeRequestId) {
                    requestHandled = true;
                    closeDuplicateZammadTab();
                }
            });

            if (sessionStorage.getItem(singleTab.allowLoadKey) === '1') {
                sessionStorage.removeItem(singleTab.allowLoadKey);
                markSingleTabEstablished(tabId, targetUrl);
                return true;
            }

            if (sessionStorage.getItem(singleTab.establishedKey) === '1') {
                debug('zammad existing tab ready', tabId, targetUrl);
                return true;
            }

            if (!isExistingTabEnabled()) {
                markSingleTabEstablished(tabId, targetUrl);
                return true;
            }

            activeRequestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            debug('zammad probing for existing tab', activeRequestId, targetUrl);
            window.stop();
            channel.postMessage({
                type: singleTab.requestType,
                requestId: activeRequestId,
                tabId,
                url: targetUrl,
            });

            setTimeout(() => {
                if (requestHandled) {
                    return;
                }

                sessionStorage.setItem(singleTab.allowLoadKey, '1');
                window.location.replace(targetUrl);
            }, singleTab.probeDelay);

            return false;
        } catch (e) {
            console.error('checkExistingInstance error:', e);
            return true;
        }
    }

    function getReusableHelpUrl() {
        return isReusableHelpLocation(window.location) ? window.location.href : false;
    }

    function isReusableHelpLocation(location) {
        return location.origin === HELP_ORIGIN && !isKnowledgeBasePath(location.pathname);
    }

    function isReusableHelpUrl(url) {
        try {
            const parsedUrl = new URL(url, window.location.href);
            return isReusableHelpLocation(parsedUrl);
        } catch (e) {
            console.error('help URL parse error:', e);
            return false;
        }
    }

    function isKnowledgeBasePath(pathname) {
        return pathname === KB_PATH || pathname.startsWith(`${KB_PATH}/`);
    }

    function isExistingTabEnabled() {
        if (gmc) {
            return gmc.get('existingTab');
        }

        try {
            const savedConfig = GM_getValue(configId, null);
            if (!savedConfig) {
                return true;
            }

            const parsedConfig = typeof savedConfig === 'string' ? JSON.parse(savedConfig) : savedConfig;
            return Object.prototype.hasOwnProperty.call(parsedConfig, 'existingTab') ? Boolean(parsedConfig.existingTab) : true;
        } catch (e) {
            console.error('existingTab config read error:', e);
            return true;
        }
    }

    function getSingleTabId() {
        let tabId = sessionStorage.getItem(singleTab.tabIdKey);
        if (!tabId) {
            tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            sessionStorage.setItem(singleTab.tabIdKey, tabId);
        }
        return tabId;
    }

    function markSingleTabEstablished(tabId, targetUrl) {
        sessionStorage.setItem(singleTab.establishedKey, '1');
        debug('zammad existing tab established', tabId, targetUrl);
    }

    function closeDuplicateZammadTab() {
        debug('zammad closing duplicate tab');
        window.stop();
        window.close();
        setTimeout(() => {
            window.close();
            window.location.replace('about:blank');
        }, 50);
        setTimeout(() => window.close(), 250);
    }

    async function loadDependencies() {
        for (const [name, url] of dependencies) {
            debug(`Loading ${name}`);
            await loadDependency(name, url);
        }
    }

    async function loadDependency(name, url) {
        const code = await getDependencyCode(url);
        if (name === 'GM_config') {
            GMConfig = eval(`${code}\nGM_config;`); // eslint-disable-line no-eval
            return;
        }

        (0, eval)(`${code}\n//# sourceURL=${url}`);
    }

    function getDependencyCode(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url,
                onload: (response) => {
                    if (response.status >= 200 && response.status < 300) {
                        resolve(response.responseText);
                    } else {
                        reject(new Error(`Failed to load ${url}: ${response.status}`));
                    }
                },
                onerror: () => reject(new Error(`Failed to load ${url}`)),
                ontimeout: () => reject(new Error(`Timed out loading ${url}`)),
            });
        });
    }

    const collapseEntries = (collapse = false, root = document) => {
        const articleSelector = '.ticket-article-item';
        const expandedSelector = '.textBubble-overflowContainer.is-open:not(.hide)';
        const collapsedSelector = '.textBubble-overflowContainer:not(.is-open):not(.hide)';
        const activeSelector = collapse ? expandedSelector : collapsedSelector;

        root.querySelectorAll(articleSelector).forEach((article) => {
            const toggle = article.querySelector('.js-toggleFold');
            if (toggle && article.querySelector(activeSelector)) {
                toggle.click();
            }
        });
    };

    const clearNotifications = () => {
        const activitySelector = 'div.popover div.activity-entry';
        const activityLinkSelector = 'div.activity-body a.activity-message';
        const activityRemoveSelector = 'div.activity-remove';
        const entries = Array.from(document.querySelectorAll(activitySelector)).reverse();
        const countByTicket = new Map();

        entries.forEach((entry) => {
            const ticket = getNotificationTicket(entry, activityLinkSelector);
            if (ticket) {
                countByTicket.set(ticket, (countByTicket.get(ticket) || 0) + 1);
            }
        });

        entries.forEach((entry) => {
            const ticket = getNotificationTicket(entry, activityLinkSelector);
            const removeButton = entry.querySelector(activityRemoveSelector);
            const count = countByTicket.get(ticket) || 0;

            if (ticket && removeButton && count > 1) {
                removeButton.click();
                countByTicket.set(ticket, count - 1);
            }
        });
    };

    function getNotificationTicket(entry, activityLinkSelector) {
        const href = entry.querySelector(activityLinkSelector)?.getAttribute('href') || '';
        return href.match(/\d+/)?.[0] || null;
    }

    function findLastArticleByClass(...classNames) {
        const articles = document.querySelectorAll('div.ticket-article-item:not(.is-internal)');
        for (const className of classNames) {
            for (let index = articles.length - 1; index >= 0; index--) {
                if (articles[index].classList.contains(className)) {
                    return articles[index];
                }
            }
        }

        return null;
    }

    const replyLast = () => {
        const response = findLastArticleByClass('customer', 'agent');
        Array.from(response?.querySelectorAll("a.article-action[data-type^='emailReply']") || [])
            .pop()
            ?.click();
    };

    function wrapSelection(wrapperTag, targetTag = wrapperTag) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return;
        }

        const range = selection.getRangeAt(0);
        const wrapper = document.createElement(wrapperTag);
        const target = targetTag === wrapperTag ? wrapper : document.createElement(targetTag);

        if (target !== wrapper) {
            wrapper.appendChild(target);
        }

        target.appendChild(range.extractContents());
        range.insertNode(wrapper);
    }

    function getEventElement(event) {
        const target = event.target || event.srcElement;
        return target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    }

    function isEditableElement(element) {
        const tagName = element.tagName;
        return element.isContentEditable
            || ((tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') && !element.readOnly);
    }

    const customHotkeysFilter = (event, hotkey) => {
        const target = getEventElement(event);
        if (!target) {
            return true;
        }

        if (target.closest?.('.articleNewEdit-body')) {
            return true;
        }

        if (target.closest?.('.ticket-title-update, .js-objectTitle')) {
            return !hotkey.selectionOnly;
        }

        return !isEditableElement(target);
    };
})();

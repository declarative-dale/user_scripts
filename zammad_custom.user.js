// ==UserScript==
// @name     Zammad customizations
// @match    https://help.vates.tech/*
// @version  1.1.2
// @license      GPL-v3
// @author       DanP2
// @grant              GM_getValue
// @grant              GM_setValue
// @grant              GM.getValue
// @grant              GM.setValue
// @grant              GM_registerMenuCommand
// @grant              GM_addStyle
// @grant              window.close
// @icon               https://avatars.githubusercontent.com/u/1380327?s=200&v=4
// @run-at             document-start
// @description        Customize Zammad
// ==/UserScript==

/* global GM_info, GM_config, GM_registerMenuCommand, GM_addStyle, $, waitForKeyElements */

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
        ['jQuery', 'https://code.jquery.com/jquery-3.6.0.min.js'],
        ['waitForKeyElements', 'https://cdn.jsdelivr.net/gh/CoeJoder/waitForKeyElements.js@v1.2/waitForKeyElements.js'],
        ['GM_config', 'https://cdn.jsdelivr.net/gh/sizzlemctwizzle/GM_config@master/gm_config.js'],
    ];

    let gmc;
    let hotkeyHandler;

    if (!checkExistingInstance()) {
        return;
    }

    const addedHotkeys = [
        {saveName: 'addCollapseAll', key: 'z', code: 'KeyZ', default: true, desc: 'Collapse all articles', func: () => collapseEntries(true)},
        {saveName: 'addExpandAll', key: 'x', code: 'KeyX', default: true, desc: 'Expand all articles', func: () => collapseEntries(false)},
        {saveName: 'addClearDups', key: 'n', code: 'KeyN', default: true, desc: 'Clear duplicate notifications', func: () => clearNotifications()},
        {saveName: 'addReplyLast', key: 'l', code: 'KeyL', default: true, desc: 'Reply to last response', func: () => replyLast()},
        {saveName: 'addFormatCode', key: 'c', code: 'KeyC', default: true, desc: 'Format code tag', func: () => selectionToPreCode()},
        {saveName: 'addFormatBlock', key: 'b', code: 'KeyB', default: true, desc: 'Format blockquote tag', func: () => selectionToBlockquote()},
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
        gmc = new GM_config(buildConfig());
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
            $(element).on('click', notificationLinkSelector, (event) => {
                if (!gmc.get('closeNotification') || (gmc.get('requireAlt') && !event.altKey)) {
                    return;
                }

                const removeButton = $(event.currentTarget)
                    .closest('.activity-entry')
                    .find(activityRemoveSelector)
                    .get(0);

                if (removeButton) {
                    removeButton.click();
                }
            });
        });

        waitForKeyElements(appSelector, (element) => {
            onElementInserted(element, ticketItemSelector, triggerHashChange);
        });

        $('body').on('click', '.textBubble', (event) => {
            if (!gmc.get('articleResize') || !event.ctrlKey) {
                return;
            }

            event.stopImmediatePropagation();
            $(event.currentTarget).find('.js-toggleFold:visible').trigger('click');
        });

        const applyTicketDisplaySettings = () => {
            const blockedMessages = $(blockedContentSelector);
            const tickets = $(ticketSelector);

            blockedMessages.toggle(!gmc.get('articleHideBlocked'));
            tickets.toggleClass('extended', gmc.get('ticketExtended'));
        };

        $(window).on('hashchange', applyTicketDisplaySettings);
        applyTicketDisplaySettings();
        setupHotkeys();
        debug(`Successfully started ${GM_info.script.name} version ${GM_info.script.version}`);
    }

    function onSave() {
        gmc.close();
        setupHotkeys();
        triggerHashChange();
    }

    function triggerHashChange() {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
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

    function setupHotkeys() {
        if (hotkeyHandler) {
            document.removeEventListener('keydown', hotkeyHandler, true);
        }

        hotkeyHandler = (event) => {
            const hotkey = getMatchingHotkey(event);
            if (!hotkey) {
                return;
            }

            event.preventDefault();
            event.stopImmediatePropagation();
            debug(`Running "${hotkey.desc}" hotkey (${formatHotkey(hotkey)})`);

            if (typeof hotkey.func === 'function') {
                hotkey.func(hotkey);
            }
        };

        document.addEventListener('keydown', hotkeyHandler, true);
    }

    function getMatchingHotkey(event) {
        if (
            event.defaultPrevented
            || event.repeat
            || event.metaKey
            || event.shiftKey
            || !event.ctrlKey
            || !event.altKey
            || event.getModifierState?.('AltGraph')
            || !customHotkeysFilter(event)
        ) {
            return null;
        }

        return addedHotkeys.find((hotkey) => event.code === hotkey.code && gmc.get(hotkey.saveName)) || null;
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
            await loadDependency(url);
        }
    }

    async function loadDependency(url) {
        const response = await fetch(url, {cache: 'force-cache'});
        if (!response.ok) {
            throw new Error(`Failed to load ${url}: ${response.status}`);
        }

        const code = await response.text();
        (0, eval)(`${code}\n//# sourceURL=${url}`);
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
        const countByTicket = {};

        entries.forEach((entry) => {
            const ticket = getNotificationTicket(entry, activityLinkSelector);
            if (ticket) {
                countByTicket[ticket] = (countByTicket[ticket] || 0) + 1;
            }
        });

        entries.forEach((entry) => {
            const ticket = getNotificationTicket(entry, activityLinkSelector);
            const removeButton = entry.querySelector(activityRemoveSelector);
            if (ticket && removeButton && countByTicket[ticket] > 1) {
                removeButton.click();
                countByTicket[ticket]--;
            }
        });
    };

    function getNotificationTicket(entry, activityLinkSelector) {
        const href = entry.querySelector(activityLinkSelector)?.getAttribute('href') || '';
        return href.match(/\d+/)?.[0] || null;
    }

    const replyLast = () => {
        const articles = Array.from(document.querySelectorAll('div.ticket-article-item:not(.is-internal)'));
        const response = articles.filter((article) => article.classList.contains('customer')).pop()
            || articles.filter((article) => article.classList.contains('agent')).pop();
        const actions = response ? Array.from(response.querySelectorAll("a.article-action[data-type^='emailReply']")) : [];
        const action = actions.pop();

        if (action) {
            action.click();
        }
    };

    const selectionToBlockquote = () => {
        wrapSelection(() => {
            const wrapper = document.createElement('blockquote');
            return {wrapper, target: wrapper};
        });
    };

    const selectionToPreCode = () => {
        wrapSelection(() => {
            const wrapper = document.createElement('pre');
            const target = document.createElement('code');
            wrapper.appendChild(target);
            return {wrapper, target};
        });
    };

    function wrapSelection(createWrapper) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return;
        }

        const range = selection.getRangeAt(0);
        const {wrapper, target} = createWrapper();
        target.appendChild(range.extractContents());
        range.insertNode(wrapper);
    }

    const customHotkeysFilter = (event) => {
        const target = event.target || event.srcElement;
        if (!target) {
            return true;
        }

        if (target.closest?.('.articleNewEdit-body')) {
            return true;
        }

        const tagName = target.tagName;
        return !(
            target.isContentEditable
            || ((tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') && !target.readOnly)
        );
    };
})();

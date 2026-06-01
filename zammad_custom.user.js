// ==UserScript==
// @name     Zammad customizations
// @match    https://help.vates.tech/*
// @version  1.1.18
// @license      GPL-v3
// @author       DanP2
// @grant              GM_getValue
// @grant              GM_setValue
// @grant              GM_registerMenuCommand
// @grant              GM_addStyle
// @grant              window.close
// @icon               https://avatars.githubusercontent.com/u/1380327?s=200&v=4
// @run-at             document-start
// @noframes
// @description        Customize Zammad
// ==/UserScript==

/* global GM_getValue, GM_setValue, GM_info, GM_registerMenuCommand, GM_addStyle */

(function() {
    'use strict';

    const HELP_ORIGIN = 'https://help.vates.tech';
    const KB_PATH = '/kb';
    const configId = 'zammadCfg';
    const LOG_PREFIX = '[zammad-custom]';
    const singleTab = {
        channelName: 'zammad-tab',
        tabIdKey: 'zammad-ticket-tab-id',
        establishedKey: 'zammad-ticket-tab-established',
        allowLoadKey: 'zammad-ticket-tab-allow-load',
        requestType: 'zammad-ticket-request',
        acceptedType: 'zammad-ticket-accepted',
        probeDelay: 750,
    };
    const settingsPanelId = 'zammad-custom-settings-panel';
    const settingsOverlayId = 'zammad-custom-settings-overlay';
    const baseSettingFields = [
        {name: 'closeNotification', section: 'Notifications', label: 'Close notifications when clicked?', defaultValue: true},
        {name: 'requireAlt', label: 'Require Alt key?', defaultValue: false},
        {name: 'existingTab', section: 'External Links', label: 'Open in existing tab?', defaultValue: true},
        {name: 'ticketExtended', section: 'Tickets', label: 'Use extended view?', defaultValue: false},
        {name: 'articleResize', section: 'Articles', label: 'Control click to expand / collapse?', defaultValue: true},
        {name: 'articleHideBlocked', label: 'Hide blocked remote content message?', defaultValue: true},
    ];
    const diagnosticSettingFields = [
        {name: 'debugLogging', section: 'Diagnostics', label: 'Enable debug logging?', defaultValue: false},
    ];

    let gmc;
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

    setupScript();

    function debug(...args) {
        if (gmc?.get?.('debugLogging')) {
            console.log(LOG_PREFIX, ...args);
        }
    }

    function logFailure(message, error) {
        if (error) {
            console.error(`${LOG_PREFIX} ${message}`, error);
            return;
        }

        console.error(`${LOG_PREFIX} ${message}`);
    }

    function setupScript() {
        GM_addStyle(`
            .ticket-article.extended { max-width: 10000px; }
            #${settingsOverlayId} {
                align-items: center;
                background: rgba(0, 0, 0, 0.35);
                bottom: 0;
                display: flex;
                justify-content: center;
                left: 0;
                position: fixed;
                right: 0;
                top: 0;
                z-index: 9999;
            }
            #${settingsPanelId} {
                background: #fff;
                border: 1px solid #888;
                border-radius: 3px;
                box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28);
                color: #222;
                font: 13px/1.4 Arial, sans-serif;
                max-height: min(535px, calc(100vh - 24px));
                overflow: auto;
                padding: 16px;
                width: min(435px, calc(100vw - 24px));
            }
            #${settingsPanelId} h2 {
                font-size: 18px;
                margin: 0 0 12px;
            }
            #${settingsPanelId} h3 {
                border-bottom: 1px solid #ddd;
                font-size: 14px;
                margin: 16px 0 8px;
                padding-bottom: 4px;
            }
            #${settingsPanelId} label {
                align-items: center;
                display: flex;
                gap: 8px;
                margin: 8px 0;
            }
            #${settingsPanelId} .zammad-custom-settings-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                margin-top: 16px;
            }
        `);
        gmc = createSettingsController();
        document.addEventListener('keydown', handleHotkey, true);
        onInit();
    }

    function getSettingFields() {
        return [
            ...baseSettingFields,
            ...addedHotkeys.map((hotkey, index) => ({
                name: hotkey.saveName,
                section: index === 0 ? 'Hotkeys' : null,
                label: `Enable "${hotkey.desc}"? (${formatHotkey(hotkey)})`,
                defaultValue: hotkey.default,
            })),
            ...diagnosticSettingFields,
        ];
    }

    function getDefaultSettings() {
        return getSettingFields().reduce((settings, field) => {
            settings[field.name] = field.defaultValue;
            return settings;
        }, {});
    }

    function readRawSettings() {
        try {
            const storedSettings = GM_getValue(configId, null);
            if (!storedSettings) {
                return {};
            }

            const parsedSettings = typeof storedSettings === 'string'
                ? JSON.parse(storedSettings)
                : storedSettings;
            return parsedSettings && typeof parsedSettings === 'object' ? parsedSettings : {};
        } catch (e) {
            logFailure('settings read error:', e);
            return {};
        }
    }

    function readConfigSetting(name, defaultValue) {
        const rawSettings = readRawSettings();
        if (!Object.prototype.hasOwnProperty.call(rawSettings, name)) {
            return defaultValue;
        }

        return coerceBoolean(rawSettings[name], defaultValue);
    }

    function normalizeSettings(rawSettings) {
        const settings = getDefaultSettings();

        getSettingFields().forEach((field) => {
            if (Object.prototype.hasOwnProperty.call(rawSettings, field.name)) {
                settings[field.name] = coerceBoolean(rawSettings[field.name], field.defaultValue);
            }
        });

        return settings;
    }

    function coerceBoolean(value, defaultValue) {
        if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
            return coerceBoolean(value.value, defaultValue);
        }

        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'string') {
            if (value === 'true' || value === '1') {
                return true;
            }

            if (value === 'false' || value === '0') {
                return false;
            }

            return defaultValue;
        }

        return typeof value === 'undefined' ? defaultValue : Boolean(value);
    }

    function saveSettings(settings) {
        GM_setValue(configId, settings);
    }

    function createSettingsController() {
        let settings = normalizeSettings(readRawSettings());
        const controller = {
            get(name) {
                return Object.prototype.hasOwnProperty.call(settings, name)
                    ? settings[name]
                    : getDefaultSettings()[name];
            },
            save(nextSettings) {
                settings = normalizeSettings(nextSettings);
                saveSettings(settings);
            },
            open() {
                openSettingsPanel(settings, (nextSettings) => {
                    controller.save(nextSettings);
                    onSave();
                });
            },
            close: closeSettingsPanel,
        };

        return controller;
    }

    function openSettingsPanel(settings, onSubmit) {
        closeSettingsPanel();

        const overlay = document.createElement('div');
        overlay.id = settingsOverlayId;

        const panel = document.createElement('section');
        panel.id = settingsPanelId;
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'zammad-custom-settings-title');

        const form = document.createElement('form');
        const title = document.createElement('h2');
        title.id = 'zammad-custom-settings-title';
        title.textContent = 'Script Settings';
        form.appendChild(title);

        let currentSection = null;
        getSettingFields().forEach((field) => {
            if (field.section && field.section !== currentSection) {
                const heading = document.createElement('h3');
                heading.textContent = field.section;
                form.appendChild(heading);
                currentSection = field.section;
            }

            const label = document.createElement('label');
            const input = document.createElement('input');
            const text = document.createElement('span');
            input.type = 'checkbox';
            input.name = field.name;
            input.checked = Boolean(settings[field.name]);
            text.textContent = field.label;
            label.append(input, text);
            form.appendChild(label);
        });

        const actions = document.createElement('div');
        actions.className = 'zammad-custom-settings-actions';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', closeSettingsPanel);

        const saveButton = document.createElement('button');
        saveButton.type = 'submit';
        saveButton.textContent = 'Save';

        actions.append(cancelButton, saveButton);
        form.appendChild(actions);

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const nextSettings = {...settings};
            getSettingFields().forEach((field) => {
                nextSettings[field.name] = Boolean(form.elements[field.name]?.checked);
            });
            onSubmit(nextSettings);
        });

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closeSettingsPanel();
            }
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeSettingsPanel();
            }
        });

        panel.appendChild(form);
        overlay.appendChild(panel);
        (document.body || document.documentElement).appendChild(overlay);
        saveButton.focus();
    }

    function closeSettingsPanel() {
        document.getElementById(settingsOverlayId)?.remove();
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

        waitForElements(popoverSelector, (element) => {
            element.addEventListener('click', (event) => {
                const link = getEventElement(event)?.closest(notificationLinkSelector);
                if (!link || !gmc.get('closeNotification') || (gmc.get('requireAlt') && !event.altKey)) {
                    return;
                }

                link.closest('.activity-entry')?.querySelector(activityRemoveSelector)?.click();
            });
        });

        waitForElements(appSelector, (element) => {
            onElementInserted(element, ticketItemSelector, triggerHashChange);
        });

        waitForElements('body', (body) => {
            body.addEventListener('click', (event) => {
                const bubble = getEventElement(event)?.closest('.textBubble');
                if (!bubble || !gmc.get('articleResize') || !event.ctrlKey) {
                    return;
                }

                event.stopImmediatePropagation();
                Array.from(bubble.querySelectorAll('.js-toggleFold'))
                    .find(isVisible)
                    ?.click();
            });
        }, {once: true});

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

    function waitForElements(selector, callback, {root = document.documentElement, once = false} = {}) {
        const seen = new WeakSet();
        const MutationObserver = window.MutationObserver || window.WebKitMutationObserver;
        let matched = false;
        let observer;

        const notify = (element) => {
            if (!seen.has(element)) {
                seen.add(element);
                matched = true;
                callback(element);
                if (once && observer) {
                    observer.disconnect();
                }
            }
        };
        const scan = (node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }

            if (node.matches(selector)) {
                notify(node);
            }

            node.querySelectorAll(selector).forEach(notify);
        };

        document.querySelectorAll(selector).forEach(notify);

        if ((once && matched) || !root || !MutationObserver) {
            return null;
        }

        observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach(scan);
            });
        });
        observer.observe(root, {childList: true, subtree: true});
        return observer;
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
                debug('single-tab message received');

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
                    channel.close();
                    closeDuplicateZammadTab();
                }
            });

            if (sessionStorage.getItem(singleTab.allowLoadKey) === '1') {
                sessionStorage.removeItem(singleTab.allowLoadKey);
                markSingleTabEstablished();
                return true;
            }

            if (sessionStorage.getItem(singleTab.establishedKey) === '1') {
                debug('single-tab already established');
                return true;
            }

            if (!isExistingTabEnabled()) {
                markSingleTabEstablished();
                return true;
            }

            activeRequestId = createUniqueId();
            debug('single-tab probe started');
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
                channel.close();
                window.location.replace(targetUrl);
            }, singleTab.probeDelay);

            return false;
        } catch (e) {
            logFailure('single-tab guard error:', e);
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
        } catch {
            debug('single-tab ignored invalid URL');
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

        return readConfigSetting('existingTab', true);
    }

    function getSingleTabId() {
        let tabId = sessionStorage.getItem(singleTab.tabIdKey);
        if (!tabId) {
            tabId = createUniqueId();
            sessionStorage.setItem(singleTab.tabIdKey, tabId);
        }
        return tabId;
    }

    function createUniqueId() {
        if (window.crypto?.randomUUID) {
            return window.crypto.randomUUID();
        }

        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    function markSingleTabEstablished() {
        sessionStorage.setItem(singleTab.establishedKey, '1');
        debug('single-tab established');
    }

    function closeDuplicateZammadTab() {
        debug('single-tab duplicate closing');
        window.stop();
        window.close();
        setTimeout(() => {
            window.close();
            window.location.replace('about:blank');
        }, 50);
        setTimeout(() => window.close(), 250);
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

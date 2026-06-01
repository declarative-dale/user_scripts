// ==UserScript==
// @name     Zammad customizations
// @match    https://help.vates.tech/*
// @version  1.1.20
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
    const selectors = {
        activityEntry: '.activity-entry',
        activityRemove: 'div.activity-remove',
        app: 'div#app',
        blockedContentMessage: 'div.remote-content-message',
        collapsedArticle: '.textBubble-overflowContainer:not(.is-open):not(.hide)',
        expandedArticle: '.textBubble-overflowContainer.is-open:not(.hide)',
        notificationEntry: 'div.popover div.activity-entry',
        notificationLink: 'div.activity-body a.activity-message',
        notificationPopover: 'div.popover--notifications',
        replyAction: "a.article-action[data-type^='emailReply']",
        textBubble: '.textBubble',
        ticketArticle: 'div.ticket-article',
        ticketArticleItem: 'div.ticket-article-item',
        ticketArticleItemNonInternal: 'div.ticket-article-item:not(.is-internal)',
        ticketTitle: '.ticket-title-update, .js-objectTitle',
        toggleFold: '.js-toggleFold',
        newArticleBody: '.articleNewEdit-body',
    };

    let gmc;
    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

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
    const settingFields = [
        ...baseSettingFields,
        ...addedHotkeys.map((hotkey, index) => ({
            name: hotkey.saveName,
            section: index === 0 ? 'Hotkeys' : null,
            label: `Enable "${hotkey.desc}"? (${formatHotkey(hotkey)})`,
            defaultValue: hotkey.default,
        })),
        ...diagnosticSettingFields,
    ];
    const defaultSettings = Object.fromEntries(
        settingFields.map(({name, defaultValue}) => [name, defaultValue]),
    );

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
                background: rgba(0, 0, 0, 0.62);
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
                background: #24262b;
                border: 1px solid #555b66;
                border-radius: 3px;
                box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
                box-sizing: border-box;
                color: #f2f4f7;
                color-scheme: dark;
                font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                max-height: min(535px, calc(100vh - 24px));
                overflow: auto;
                padding: 16px;
                width: min(435px, calc(100vw - 24px));
            }
            #${settingsPanelId} h2 {
                color: #ffffff;
                font-size: 18px;
                margin: 0 0 12px;
            }
            #${settingsPanelId} h3 {
                border-bottom: 1px solid #464b55;
                color: #dfe7f2;
                font-size: 14px;
                margin: 16px 0 8px;
                padding-bottom: 4px;
            }
            #${settingsPanelId} label {
                align-items: center;
                display: flex;
                gap: 8px;
                margin: 8px 0;
                color: #eef1f5;
            }
            #${settingsPanelId} input[type="checkbox"] {
                accent-color: #31a873;
                flex: 0 0 auto;
                height: 14px;
                width: 14px;
            }
            #${settingsPanelId} .zammad-custom-settings-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                margin-top: 16px;
            }
            #${settingsPanelId} .zammad-custom-settings-actions button {
                border: 1px solid #67707d !important;
                border-radius: 3px !important;
                box-shadow: none !important;
                cursor: pointer;
                font: 600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
                min-width: 74px;
                padding: 7px 12px !important;
                text-shadow: none !important;
            }
            #${settingsPanelId} .zammad-custom-settings-actions button[type="button"] {
                background: #353a43 !important;
                color: #f3f5f8 !important;
            }
            #${settingsPanelId} .zammad-custom-settings-actions button[type="button"]:hover,
            #${settingsPanelId} .zammad-custom-settings-actions button[type="button"]:focus {
                background: #424957 !important;
                color: #ffffff !important;
            }
            #${settingsPanelId} .zammad-custom-settings-actions button[type="submit"] {
                background: #247a5a !important;
                border-color: #2b946d !important;
                color: #ffffff !important;
            }
            #${settingsPanelId} .zammad-custom-settings-actions button[type="submit"]:hover,
            #${settingsPanelId} .zammad-custom-settings-actions button[type="submit"]:focus {
                background: #2c946d !important;
                color: #ffffff !important;
            }
            #${settingsPanelId} .zammad-custom-settings-actions button:focus-visible {
                outline: 2px solid #7dd3fc;
                outline-offset: 2px;
            }
        `);
        gmc = createSettingsController();
        document.addEventListener('keydown', handleHotkey, true);
        onInit();
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
        if (!hasOwn(rawSettings, name)) {
            return defaultValue;
        }

        return coerceBoolean(rawSettings[name], defaultValue);
    }

    function normalizeSettings(rawSettings) {
        const settings = {...defaultSettings};

        settingFields.forEach((field) => {
            if (hasOwn(rawSettings, field.name)) {
                settings[field.name] = coerceBoolean(rawSettings[field.name], field.defaultValue);
            }
        });

        return settings;
    }

    function coerceBoolean(value, defaultValue) {
        if (value && typeof value === 'object' && hasOwn(value, 'value')) {
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
                return hasOwn(settings, name)
                    ? settings[name]
                    : defaultSettings[name];
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

    function createElement(tagName, props = {}, children = []) {
        const element = document.createElement(tagName);

        Object.entries(props).forEach(([key, value]) => {
            if (value == null) {
                return;
            }

            if (key === 'attrs') {
                Object.entries(value).forEach(([name, attrValue]) => element.setAttribute(name, attrValue));
            } else if (key === 'on') {
                Object.entries(value).forEach(([eventName, handler]) => element.addEventListener(eventName, handler));
            } else if (key in element) {
                element[key] = value;
            } else {
                element.setAttribute(key, value);
            }
        });

        element.append(...children);
        return element;
    }

    function openSettingsPanel(settings, onSubmit) {
        closeSettingsPanel();

        const overlay = createElement('div', {id: settingsOverlayId});
        const panel = createElement('section', {
            id: settingsPanelId,
            attrs: {
                role: 'dialog',
                'aria-modal': 'true',
                'aria-labelledby': 'zammad-custom-settings-title',
            },
        });
        const form = createElement('form');
        form.append(createElement('h2', {
            id: 'zammad-custom-settings-title',
            textContent: 'Script Settings',
        }));

        let currentSection = null;
        settingFields.forEach((field) => {
            if (field.section && field.section !== currentSection) {
                form.append(createElement('h3', {textContent: field.section}));
                currentSection = field.section;
            }

            form.append(createElement('label', {}, [
                createElement('input', {
                    type: 'checkbox',
                    name: field.name,
                    checked: Boolean(settings[field.name]),
                }),
                createElement('span', {textContent: field.label}),
            ]));
        });

        const saveButton = createElement('button', {type: 'submit', textContent: 'Save'});
        form.append(createElement('div', {className: 'zammad-custom-settings-actions'}, [
            createElement('button', {
                type: 'button',
                textContent: 'Cancel',
                on: {click: closeSettingsPanel},
            }),
            saveButton,
        ]));

        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const nextSettings = {...settings};
            settingFields.forEach((field) => {
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

        panel.append(form);
        overlay.append(panel);
        (document.body || document.documentElement).append(overlay);
        saveButton.focus();
    }

    function closeSettingsPanel() {
        document.getElementById(settingsOverlayId)?.remove();
    }

    function onInit() {
        GM_registerMenuCommand('Settings', () => gmc.open());

        waitForElements(selectors.notificationPopover, (element) => {
            element.addEventListener('click', (event) => {
                const link = getEventElement(event)?.closest(selectors.notificationLink);
                if (!link || !gmc.get('closeNotification') || (gmc.get('requireAlt') && !event.altKey)) {
                    return;
                }

                link.closest(selectors.activityEntry)?.querySelector(selectors.activityRemove)?.click();
            });
        });

        waitForElements(selectors.app, (element) => {
            waitForElements(selectors.ticketArticleItem, triggerHashChange, {root: element});
        });

        waitForElements('body', (body) => {
            body.addEventListener('click', (event) => {
                const bubble = getEventElement(event)?.closest(selectors.textBubble);
                if (!bubble || !gmc.get('articleResize') || !event.ctrlKey) {
                    return;
                }

                event.stopImmediatePropagation();
                Array.from(bubble.querySelectorAll(selectors.toggleFold))
                    .find(isVisible)
                    ?.click();
            });
        }, {once: true});

        const applyTicketDisplaySettings = () => {
            const hideBlocked = gmc.get('articleHideBlocked');
            const extended = gmc.get('ticketExtended');

            document.querySelectorAll(selectors.blockedContentMessage)
                .forEach((message) => {
                    message.style.display = hideBlocked ? 'none' : '';
                });
            document.querySelectorAll(selectors.ticketArticle)
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

        if (root?.nodeType === Node.ELEMENT_NODE && root.matches(selector)) {
            notify(root);
        }

        (root || document).querySelectorAll(selector).forEach(notify);

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
        const activeSelector = collapse ? selectors.expandedArticle : selectors.collapsedArticle;

        root.querySelectorAll(selectors.ticketArticleItem).forEach((article) => {
            const toggle = article.querySelector(selectors.toggleFold);
            if (toggle && article.querySelector(activeSelector)) {
                toggle.click();
            }
        });
    };

    const clearNotifications = () => {
        const entries = Array.from(document.querySelectorAll(selectors.notificationEntry)).reverse();
        const countByTicket = new Map();

        entries.forEach((entry) => {
            const ticket = getNotificationTicket(entry);
            if (ticket) {
                countByTicket.set(ticket, (countByTicket.get(ticket) || 0) + 1);
            }
        });

        entries.forEach((entry) => {
            const ticket = getNotificationTicket(entry);
            const removeButton = entry.querySelector(selectors.activityRemove);
            const count = countByTicket.get(ticket) || 0;

            if (ticket && removeButton && count > 1) {
                removeButton.click();
                countByTicket.set(ticket, count - 1);
            }
        });
    };

    function getNotificationTicket(entry) {
        const href = entry.querySelector(selectors.notificationLink)?.getAttribute('href') || '';
        return href.match(/\d+/)?.[0] || null;
    }

    function findLastArticleByClass(...classNames) {
        const articles = document.querySelectorAll(selectors.ticketArticleItemNonInternal);
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
        Array.from(response?.querySelectorAll(selectors.replyAction) || [])
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

        if (target.closest?.(selectors.newArticleBody)) {
            return true;
        }

        if (target.closest?.(selectors.ticketTitle)) {
            return !hotkey.selectionOnly;
        }

        return !isEditableElement(target);
    };
})();

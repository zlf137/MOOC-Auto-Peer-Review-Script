// ==UserScript==
// @name         中国大学MOOC-自动互评
// @namespace    https://github.com/zlf137/MOOC-Auto-Peer-Review-Script
// @version      3.0.0
// @description  中国大学 MOOC / SPOC 互评专用用户脚本：默认连续互评 6 份，支持自定义份数按钮、右键删除与随时停止。
// @author       weiy02, zlf137
// @match        *://www.icourse163.org/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=icourse163.org
// @license      MIT
// @supportURL   https://github.com/zlf137/MOOC-Auto-Peer-Review-Script/issues
// @homepageURL  https://github.com/zlf137/MOOC-Auto-Peer-Review-Script
// @downloadURL  https://raw.githubusercontent.com/zlf137/MOOC-Auto-Peer-Review-Script/main/MOOC-Auto-Peer-Review.user.js
// @updateURL    https://raw.githubusercontent.com/zlf137/MOOC-Auto-Peer-Review-Script/main/MOOC-Auto-Peer-Review.user.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    var CONFIG = {
        COMMENT: '科技改变生活',
        DEFAULT_COUNT: 6,
        MAX_COUNT: 200,
        CLICK_DELAY: 300,
        SUBMIT_DELAY: 2000,
        CANCEL_POLL_INTERVAL: 60,
    };

    var COUNTS_KEY = 'mar.reviewCounts';
    var PANEL_ID = 'mooc-auto-peer-review-panel';
    var STYLE_ID = 'mooc-auto-peer-review-style';
    var taskState = { running: false, cancelled: false };
    var statusEl = null;

    function makeCancelError() {
        var error = new Error('已停止');
        error.__cancelled = true;
        return error;
    }

    function sleep(ms) {
        return new Promise(function (resolve, reject) {
            var start = Date.now();
            function tick() {
                if (taskState.cancelled) {
                    reject(makeCancelError());
                    return;
                }
                if (Date.now() - start >= ms) {
                    resolve();
                    return;
                }
                setTimeout(tick, CONFIG.CANCEL_POLL_INTERVAL);
            }
            tick();
        });
    }

    async function waitFor(test, timeoutMs) {
        var start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (taskState.cancelled) throw makeCancelError();
            try {
                if (test()) return true;
            } catch (error) {
                // 单页应用切换期间 DOM 可能短暂失效，继续等待。
            }
            await sleep(150);
        }
        return false;
    }

    function isVisible(element) {
        if (!element) return false;
        var style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.05) return false;
        return element.offsetParent !== null || style.position === 'fixed';
    }

    function realClick(element) {
        if (!element) return;
        ['mousedown', 'mouseup', 'click'].forEach(function (type) {
            element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });
    }

    function setNativeValue(element, value) {
        if (!element) return;
        var proto = element.tagName === 'TEXTAREA'
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
        if (descriptor && descriptor.set) descriptor.set.call(element, value);
        else element.value = value;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function readStore(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (error) {
            return fallback;
        }
    }

    function writeStore(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            return false;
        }
    }

    function updateStatus(message) {
        if (statusEl) statusEl.textContent = message;
    }

    function parseScore(text) {
        if (!text) return null;
        var match = String(text).match(/(-?\d+(?:\.\d+)?)\s*分/);
        if (!match) match = String(text).trim().match(/^(-?\d+(?:\.\d+)?)$/);
        if (!match) match = String(text).match(/(-?\d+(?:\.\d+)?)/);
        return match ? parseFloat(match[1]) : null;
    }

    function scoreFromRadio(radio) {
        var label = radio.closest('label');
        if (!label && radio.id) {
            try {
                label = document.querySelector('label[for="' + CSS.escape(radio.id) + '"]');
            } catch (error) {
                label = null;
            }
        }
        var score = label ? parseScore(label.textContent) : null;
        if (score !== null) return score;
        score = radio.parentElement ? parseScore(radio.parentElement.textContent) : null;
        if (score !== null) return score;
        var attrs = ['data-score', 'data-value', 'data-val'];
        for (var i = 0; i < attrs.length; i++) {
            var value = radio.getAttribute(attrs[i]);
            if (value !== null && value !== '') {
                var number = parseFloat(value);
                if (!isNaN(number)) return number;
            }
        }
        var fallback = parseFloat(radio.value);
        return isNaN(fallback) ? null : fallback;
    }

    function scoreFromElement(element) {
        if (!element) return null;
        var attrs = ['data-score', 'data-value', 'data-val'];
        for (var i = 0; i < attrs.length; i++) {
            var value = element.getAttribute ? element.getAttribute(attrs[i]) : null;
            if (value !== null && value !== '') {
                var number = parseFloat(value);
                if (!isNaN(number)) return number;
            }
        }
        var input = element.querySelector ? element.querySelector('input') : null;
        if (input) {
            var inputScore = parseFloat(input.value);
            if (!isNaN(inputScore)) return inputScore;
        }
        var score = parseScore((element.textContent || '').trim());
        if (score !== null) return score;
        return element.parentElement ? parseScore(element.parentElement.textContent || '') : null;
    }

    function selectRadio(radio) {
        realClick(radio);
        if (!radio.checked) {
            radio.checked = true;
            radio.dispatchEvent(new Event('input', { bubbles: true }));
            radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    function getSubmitButton() {
        var selectors = '.j-submitbtn, .submit-btn, button[class*="submit"]';
        var candidates = document.querySelectorAll(selectors);
        for (var i = 0; i < candidates.length; i++) {
            if (isVisible(candidates[i]) && !candidates[i].disabled) return candidates[i];
        }
        var buttons = document.querySelectorAll('button, a, div[role="button"]');
        for (var j = 0; j < buttons.length; j++) {
            if (!isVisible(buttons[j]) || buttons[j].disabled) continue;
            var text = (buttons[j].textContent || '').trim();
            if (text === '提交' || text === '提交互评') return buttons[j];
        }
        return null;
    }

    function isFinished() {
        if (getSubmitButton()) return false;
        return document.querySelectorAll('input[type="radio"]').length === 0;
    }

    async function rateCurrentAssignment() {
        var rated = 0;
        var radios = Array.prototype.slice.call(document.querySelectorAll('input[type="radio"]'));
        if (radios.length > 0) {
            var groups = new Map();
            radios.forEach(function (radio) {
                var key = radio.name || '__ungrouped__';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(radio);
            });
            var iterator = groups.values();
            var current = iterator.next();
            while (!current.done) {
                var group = current.value;
                var best = null;
                var bestScore = -Infinity;
                for (var i = 0; i < group.length; i++) {
                    var score = scoreFromRadio(group[i]);
                    if (score !== null && !isNaN(score) && score > bestScore) {
                        bestScore = score;
                        best = group[i];
                    }
                }
                if (!best && group.length > 0) best = group[group.length - 1];
                if (best) {
                    selectRadio(best);
                    rated++;
                    await sleep(CONFIG.CLICK_DELAY);
                }
                current = iterator.next();
            }
        }

        if (rated === 0) {
            var areas = Array.prototype.slice.call(document.querySelectorAll('.s'));
            if (areas.length === 0) {
                areas = Array.prototype.slice.call(document.querySelectorAll('[class*="score"], [class*="rating"]'));
            }
            for (var a = 0; a < areas.length; a++) {
                var options = Array.prototype.slice.call(areas[a].querySelectorAll('label, .option, [role="radio"]'));
                if (options.length === 0) {
                    options = Array.prototype.slice.call(areas[a].querySelectorAll('span, div')).filter(function (element) {
                        return element.children.length === 0 && /\d/.test(element.textContent || '');
                    });
                }
                var bestOption = null;
                var bestOptionScore = -Infinity;
                for (var o = 0; o < options.length; o++) {
                    var optionScore = scoreFromElement(options[o]);
                    if (optionScore !== null && !isNaN(optionScore) && optionScore > bestOptionScore) {
                        bestOptionScore = optionScore;
                        bestOption = options[o];
                    }
                }
                if (!bestOption && options.length > 0) bestOption = options[options.length - 1];
                if (bestOption) {
                    realClick(bestOption);
                    rated++;
                    await sleep(CONFIG.CLICK_DELAY);
                }
            }
        }

        if (rated === 0) return { success: false, error: '未找到任何可评分选项，请确认已进入互评详情页' };

        var textareas = document.querySelectorAll('textarea');
        for (var t = 0; t < textareas.length; t++) {
            if (isVisible(textareas[t])) {
                setNativeValue(textareas[t], CONFIG.COMMENT);
                await sleep(CONFIG.CLICK_DELAY);
            }
        }

        var checkboxes = document.querySelectorAll('input[type="checkbox"]');
        for (var c = 0; c < checkboxes.length; c++) {
            var label = checkboxes[c].closest('label') || checkboxes[c].parentElement;
            var labelText = label ? (label.textContent || '').trim() : '';
            if (/可见|公开|visible/i.test(labelText) && checkboxes[c].checked) {
                realClick(checkboxes[c]);
                await sleep(CONFIG.CLICK_DELAY);
            }
        }
        return { success: true };
    }

    async function dismissModal() {
        await sleep(500);
        var modals = document.querySelectorAll('.u-dialog, .m-dialog, .u-popup, .u-layer, [class*="dialog"], [class*="modal"]');
        for (var i = 0; i < modals.length; i++) {
            if (!isVisible(modals[i])) continue;
            var buttons = modals[i].querySelectorAll('button, a, .u-btn, .m-btn');
            for (var j = 0; j < buttons.length; j++) {
                var text = (buttons[j].textContent || '').trim();
                if (/^(确定|继续|知道了|关闭|好的)$/.test(text)) {
                    realClick(buttons[j]);
                    await sleep(800);
                    return true;
                }
            }
        }
        return false;
    }

    async function submitCurrent() {
        var button = getSubmitButton();
        if (!button) return { success: false, error: '未找到可见的提交互评按钮' };
        realClick(button);
        await sleep(CONFIG.SUBMIT_DELAY);
        await dismissModal();
        return { success: true };
    }

    async function goToNext() {
        var next = document.querySelector('.j-gotonext');
        if (!next || !isVisible(next)) {
            var buttons = document.querySelectorAll('button, a, div[role="button"]');
            for (var i = 0; i < buttons.length; i++) {
                if (!isVisible(buttons[i])) continue;
                if (/下一份|下一题|下一页/.test(buttons[i].textContent || '')) {
                    next = buttons[i];
                    break;
                }
            }
        }
        if (!next || !isVisible(next)) return false;
        var beforeUrl = location.href;
        var beforeLength = document.body.innerHTML.length;
        realClick(next);
        await waitFor(function () {
            return location.href !== beforeUrl || Math.abs(document.body.innerHTML.length - beforeLength) > 500;
        }, CONFIG.SUBMIT_DELAY + 3000);
        await sleep(500);
        return true;
    }

    async function batchReview(count) {
        var success = 0;
        while (success < count) {
            if (isFinished()) {
                updateStatus('已完成 ' + success + ' 份，无更多作业可评');
                return;
            }
            updateStatus('正在互评第 ' + (success + 1) + '/' + count + ' 份…');
            var rated = await rateCurrentAssignment();
            if (!rated.success) {
                updateStatus('第 ' + (success + 1) + ' 份评分失败：' + rated.error);
                return;
            }
            var submitted = await submitCurrent();
            if (!submitted.success) {
                updateStatus('第 ' + (success + 1) + ' 份提交失败：' + submitted.error);
                return;
            }
            success++;
            if (success >= count) break;
            var moved = await goToNext();
            if (!moved) {
                updateStatus('已完成 ' + success + ' 份，未找到下一份作业');
                return;
            }
        }
        updateStatus('互评完成，共 ' + success + ' 份 ✓');
    }

    function reviewCounts() {
        var raw = readStore(COUNTS_KEY, [CONFIG.DEFAULT_COUNT]);
        if (!Array.isArray(raw)) raw = [CONFIG.DEFAULT_COUNT];
        var seen = {};
        return raw.map(function (value) {
            return parseInt(value, 10);
        }).filter(function (value) {
            if (!isFinite(value) || value < 1 || value > CONFIG.MAX_COUNT || seen[value]) return false;
            seen[value] = true;
            return true;
        });
    }

    function saveReviewCounts(counts) {
        writeStore(COUNTS_KEY, counts);
    }

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = [
            '#' + PANEL_ID + ' { position: fixed; top: 92px; right: 20px; z-index: 2147483646; width: 252px; overflow: hidden; border: 1px solid rgba(255,255,255,.09); border-radius: 12px; background: #18181b; color: #ededed; box-shadow: 0 14px 36px rgba(0,0,0,.36); font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }',
            '#' + PANEL_ID + ' * { box-sizing: border-box; }',
            '#mar-header { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; cursor:move; border-bottom:1px solid rgba(255,255,255,.07); }',
            '#mar-title { display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; }',
            '.mar-dot { width:6px; height:6px; border-radius:50%; background:#3b82f6; }',
            '#mar-minimize { width:22px; height:22px; padding:0; border:0; border-radius:6px; background:transparent; color:#8a8a90; cursor:pointer; }',
            '#mar-minimize:hover { background:rgba(255,255,255,.08); color:#ededed; }',
            '#mar-body { padding:8px; }',
            '#mar-review-counts { display:flex; flex-direction:column; gap:6px; margin-bottom:6px; }',
            '.mar-btn { display:flex; align-items:center; width:100%; padding:8px 10px; border:1px solid transparent; border-radius:8px; background:rgba(255,255,255,.055); color:#e4e4e7; font:400 12px inherit; text-align:left; cursor:pointer; }',
            '.mar-btn:hover:not(:disabled) { background:rgba(255,255,255,.1); }',
            '.mar-btn:disabled { opacity:.34; cursor:not-allowed; }',
            '#mar-review-custom:not(:disabled) { color:#60a5fa; }',
            '.mar-review-delete:not(:disabled) { color:#f87171; background:rgba(248,113,113,.12); border-color:rgba(248,113,113,.32); }',
            '#mar-foot { display:flex; flex-direction:column; gap:6px; padding:0 8px 10px; }',
            '#mar-stop { display:none; color:#f87171; background:rgba(248,113,113,.1); }',
            '#mar-status { min-height:16px; padding:6px 2px 0; color:#8a8a90; font-size:11px; line-height:1.55; word-break:break-word; }',
        ].join('\n');
        (document.head || document.documentElement).appendChild(style);
    }

    function setButtonsRunning(running) {
        var buttons = document.querySelectorAll('#' + PANEL_ID + ' .mar-btn');
        for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].id !== 'mar-stop') buttons[i].disabled = running;
        }
        var stop = document.getElementById('mar-stop');
        if (stop) {
            stop.style.display = running ? 'flex' : 'none';
            stop.disabled = !running;
        }
    }

    function runGuarded(task) {
        if (taskState.running) {
            updateStatus('正在执行中，请先停止或等待完成…');
            return;
        }
        taskState.running = true;
        taskState.cancelled = false;
        setButtonsRunning(true);
        Promise.resolve().then(task).catch(function (error) {
            if (error && error.__cancelled) updateStatus('⏹ 已停止当前操作');
            else updateStatus('发生异常：' + (error && error.message ? error.message : error));
        }).then(function () {
            taskState.running = false;
            taskState.cancelled = false;
            setButtonsRunning(false);
        });
    }

    function createPanel() {
        if (!document.body || document.getElementById(PANEL_ID)) return;
        injectStyles();
        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = [
            '<div id="mar-header">',
            '  <span id="mar-title"><span class="mar-dot"></span>MOOC 互评</span>',
            '  <button id="mar-minimize" title="最小化">−</button>',
            '</div>',
            '<div id="mar-main">',
            '  <div id="mar-body">',
            '    <div id="mar-review-counts"></div>',
            '    <button id="mar-review-custom" class="mar-btn">自定义互评份数</button>',
            '  </div>',
            '  <div id="mar-foot">',
            '    <button id="mar-stop" class="mar-btn">停止当前操作</button>',
            '    <div id="mar-status">就绪</div>',
            '  </div>',
            '</div>',
        ].join('');
        document.body.appendChild(panel);
        statusEl = document.getElementById('mar-status');

        var countsBox = document.getElementById('mar-review-counts');

        function resetDeleteMode() {
            var armed = countsBox.querySelectorAll('.mar-review-delete');
            for (var i = 0; i < armed.length; i++) {
                armed[i].classList.remove('mar-review-delete');
                armed[i].textContent = '互评 ' + armed[i].dataset.count + ' 份';
            }
            return armed.length > 0;
        }

        function renderCountButtons() {
            var counts = reviewCounts();
            countsBox.innerHTML = '';
            counts.forEach(function (count) {
                var button = document.createElement('button');
                button.type = 'button';
                button.className = 'mar-btn mar-review-count';
                button.dataset.count = String(count);
                button.textContent = '互评 ' + count + ' 份';
                button.addEventListener('contextmenu', function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                    if (taskState.running) return;
                    if (button.classList.contains('mar-review-delete')) {
                        resetDeleteMode();
                        updateStatus('已退出删除模式');
                        return;
                    }
                    resetDeleteMode();
                    button.classList.add('mar-review-delete');
                    button.textContent = 'delete';
                    updateStatus('点击红色 delete 删除；再任意右键一次退出');
                });
                button.addEventListener('click', function () {
                    if (button.classList.contains('mar-review-delete')) {
                        saveReviewCounts(reviewCounts().filter(function (value) { return value !== count; }));
                        renderCountButtons();
                        updateStatus('已删除「互评 ' + count + ' 份」按钮');
                        return;
                    }
                    runGuarded(function () { return batchReview(count); });
                });
                countsBox.appendChild(button);
            });
        }

        document.addEventListener('contextmenu', function (event) {
            if (!resetDeleteMode()) return;
            event.preventDefault();
            updateStatus('已退出删除模式');
        });

        document.getElementById('mar-review-custom').addEventListener('click', function () {
            var input = window.prompt('请输入互评份数（1–' + CONFIG.MAX_COUNT + '）：', String(CONFIG.DEFAULT_COUNT));
            if (input === null) return;
            var count = Number(String(input).trim());
            if (!Number.isInteger(count) || count < 1 || count > CONFIG.MAX_COUNT) {
                updateStatus('⚠️ 请输入 1–' + CONFIG.MAX_COUNT + ' 之间的整数');
                return;
            }
            var counts = reviewCounts();
            if (counts.indexOf(count) !== -1) {
                updateStatus('「互评 ' + count + ' 份」按钮已存在');
                return;
            }
            counts.push(count);
            saveReviewCounts(counts);
            renderCountButtons();
            updateStatus('已添加「互评 ' + count + ' 份」按钮');
        });

        document.getElementById('mar-stop').addEventListener('click', function () {
            if (!taskState.running) return;
            taskState.cancelled = true;
            updateStatus('⏹ 正在停止…');
        });

        var minimized = false;
        var main = document.getElementById('mar-main');
        document.getElementById('mar-minimize').addEventListener('click', function () {
            minimized = !minimized;
            main.style.display = minimized ? 'none' : '';
            this.textContent = minimized ? '+' : '−';
        });

        var header = document.getElementById('mar-header');
        var dragging = false;
        var startX = 0;
        var startY = 0;
        var startLeft = 0;
        var startTop = 0;
        header.addEventListener('mousedown', function (event) {
            if (event.target && event.target.id === 'mar-minimize') return;
            dragging = true;
            startX = event.clientX;
            startY = event.clientY;
            var rect = panel.getBoundingClientRect();
            startLeft = rect.left;
            startTop = rect.top;
            event.preventDefault();
        });
        document.addEventListener('mousemove', function (event) {
            if (!dragging) return;
            panel.style.left = (startLeft + event.clientX - startX) + 'px';
            panel.style.top = (startTop + event.clientY - startY) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', function () { dragging = false; });

        renderCountButtons();
        setButtonsRunning(false);
    }

    createPanel();
    new MutationObserver(function () {
        if (!document.getElementById(PANEL_ID)) createPanel();
    }).observe(document.documentElement, { childList: true, subtree: true });
})();

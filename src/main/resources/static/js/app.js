/* ============================================================
   SouthAir Genshin 前端逻辑（原生 JS，无构建步骤）
   核心：抽卡记录 + 原石 / 摩拉 / 抽数换算
   ============================================================ */
(function () {
    'use strict';

    var TOKEN_KEY = 'sg_token';
    var USER_KEY = 'sg_user';
    var GAME_KEY = 'sg_game';

    /* 两套游戏的卡池、货币与文案配置 */
    var GAMES = {
        genshin: {
            key: 'genshin',
            switchLabel: '原神',
            fullName: '原神',
            title: 'SouthAir Genshin · 原神数据记录',
            subtitle: '提瓦特数据记录 · Web / Mobile',
            heroSub: 'Wish Planner',
            pools: ['角色活动', '武器活动', '集录祈愿', '常驻'],
            itemTypes: ['角色', '武器'],
            currency: '原石',
            credit: '摩拉',
            fateLimited: '纠缠之缘',
            fateStandard: '相遇之缘',
            threeStarType: '武器',
            charPool: '角色活动',
            weaponPool: '武器活动'
        },
        starrail: {
            key: 'starrail',
            switchLabel: '星穹铁道',
            fullName: '崩坏：星穹铁道',
            title: 'SouthAir Genshin · 崩坏：星穹铁道记录',
            subtitle: '星穹列车数据记录 · Web / Mobile',
            heroSub: 'Warp Planner',
            pools: ['角色活动', '光锥活动', '联动', '常驻'],
            itemTypes: ['角色', '光锥'],
            currency: '星琼',
            credit: '信用点',
            fateLimited: '星轨专票',
            fateStandard: '星轨通票',
            threeStarType: '光锥',
            charPool: '角色活动',
            weaponPool: '光锥活动'
        }
    };

    var state = {
        token: localStorage.getItem(TOKEN_KEY) || '',
        user: safeParse(localStorage.getItem(USER_KEY)),
        game: GAMES[localStorage.getItem(GAME_KEY)] ? localStorage.getItem(GAME_KEY) : 'genshin',
        view: 'dashboard',
        pages: { wishes: 1 },
        wishPool: '',
        wishOnlyFive: false,
        wishSelected: new Set()
    };

    var cache = { wishes: [] };

    var authMode = 'login';

    /* ---------------- 基础工具 ---------------- */

    function gameConfig() {
        return GAMES[state.game] || GAMES.genshin;
    }

    function $(selector, root) {
        return (root || document).querySelector(selector);
    }

    function $$(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    function safeParse(text) {
        try {
            return text ? JSON.parse(text) : null;
        } catch (e) {
            return null;
        }
    }

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/[&<>"']/g, function (ch) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
            });
    }

    function fmt(value) {
        var n = Number(value);
        if (!isFinite(n)) {
            return '0';
        }
        return n.toLocaleString('zh-CN');
    }

    function num(value) {
        if (value === null || value === undefined || value === '') {
            return '0';
        }
        var n = Number(value);
        return Number.isInteger(n) ? String(n) : n.toFixed(1);
    }

    function starText(rarity) {
        var count = Math.max(0, Math.min(5, Number(rarity) || 0));
        return new Array(count + 1).join('★');
    }

    function nowLocal() {
        var d = new Date();

        function pad(n) {
            return (n < 10 ? '0' : '') + n;
        }

        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
            + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function toApiTime(value) {
        if (!value) {
            return null;
        }
        if (value.length === 16) {
            return value.replace('T', ' ') + ':00';
        }
        return value.replace('T', ' ');
    }

    var toastTimer = null;

    function toast(message, type) {
        var el = $('#toast');
        el.textContent = message;
        el.className = 'toast show' + (type === 'error' ? ' error' : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.className = 'toast';
        }, 2400);
    }

    function guard(fn) {
        return Promise.resolve()
            .then(fn)
            .catch(function (err) {
                toast(err && err.message ? err.message : '操作失败', 'error');
            });
    }

    /* ---------------- 接口请求 ---------------- */

    function withGame(path, game) {
        if (path.indexOf('/api/') !== 0 || path.indexOf('/api/auth/') === 0) {
            return path;
        }
        var key = game || state.game;
        return path + (path.indexOf('?') >= 0 ? '&' : '?') + 'game=' + encodeURIComponent(key);
    }

    function api(path, options, game) {
        var opts = Object.assign({}, options || {});
        opts.headers = Object.assign({}, opts.headers || {});
        if (state.token) {
            opts.headers.Authorization = 'Bearer ' + state.token;
        }
        if (opts.body && typeof opts.body !== 'string') {
            opts.headers['Content-Type'] = 'application/json;charset=UTF-8';
            opts.body = JSON.stringify(opts.body);
        }

        return fetch(withGame(path, game), opts).then(function (res) {
            return res.text().then(function (text) {
                var payload = safeParse(text);
                if (res.status === 401) {
                    logout(true);
                    throw new Error((payload && payload.message) || '登录已失效，请重新登录');
                }
                if (!res.ok) {
                    throw new Error((payload && payload.message) || ('请求失败（' + res.status + '）'));
                }
                if (payload && payload.code !== 0) {
                    throw new Error(payload.message || '请求失败');
                }
                return payload ? payload.data : null;
            });
        });
    }

    /* ---------------- 登录 / 注册 ---------------- */

    function setAuthMode(mode) {
        authMode = mode;
        var isLogin = mode === 'login';
        $('#auth-nickname-field').hidden = isLogin;
        $('#auth-submit').textContent = isLogin ? '登 录' : '注 册';
        $('#auth-toggle').textContent = isLogin ? '没有账号？立即注册' : '已有账号？返回登录';
    }

    function resetAuthForm() {
        $('#auth-form').reset();
        setAuthMode('login');
    }

    function saveSession(data) {
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem(TOKEN_KEY, state.token);
        localStorage.setItem(USER_KEY, JSON.stringify(state.user));
    }

    function logout(expired) {
        state.token = '';
        state.user = null;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        $('#app-view').hidden = true;
        $('#auth-view').hidden = false;
        resetAuthForm();
        if (expired) {
            toast('登录已失效，请重新登录', 'error');
        }
    }

    function enterApp() {
        $('#auth-view').hidden = true;
        $('#app-view').hidden = false;
        var name = (state.user && (state.user.nickname || state.user.username)) || '旅行者';
        $('#user-name').textContent = name;
        applyGameUI();
        switchView('dashboard');
    }

    function bindAuth() {
        $('#auth-toggle').addEventListener('click', function () {
            setAuthMode(authMode === 'login' ? 'register' : 'login');
        });

        $('#auth-form').addEventListener('submit', function (event) {
            event.preventDefault();
            var username = $('#auth-username').value.trim();
            var password = $('#auth-password').value;
            if (username.length < 3) {
                toast('账号至少 3 位', 'error');
                return;
            }
            if (password.length < 6) {
                toast('密码至少 6 位', 'error');
                return;
            }

            var isLogin = authMode === 'login';
            var body = { username: username, password: password };
            if (!isLogin) {
                body.nickname = $('#auth-nickname').value.trim();
            }

            var submit = $('#auth-submit');
            submit.disabled = true;
            api(isLogin ? '/api/auth/login' : '/api/auth/register', { method: 'POST', body: body })
                .then(function (data) {
                    saveSession(data);
                    toast(isLogin ? '欢迎回来' : '注册成功');
                    enterApp();
                })
                .catch(function (err) {
                    toast(err.message || '操作失败', 'error');
                })
                .then(function () {
                    submit.disabled = false;
                });
        });
    }

    /* ---------------- 视图切换 ---------------- */

    function switchView(view) {
        state.view = view;
        $$('.nav-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        $$('.tab-btn').forEach(function (btn) {
            btn.classList.toggle('active', btn.dataset.view === view);
        });
        ['dashboard', 'stats', 'wishes', 'collection', 'settings'].forEach(function (name) {
            $('#view-' + name).hidden = name !== view;
        });

        var main = $('.main');
        if (main) {
            main.scrollTop = 0;
        }

        var loaders = {
            dashboard: loadDashboard,
            stats: loadStats,
            wishes: loadWishes,
            collection: loadCollection,
            settings: loadSettings
        };
        loaders[view]();
    }

    function emptyHtml(text) {
        return '<p class="empty">' + esc(text) + '</p>';
    }

    function errorHtml(error) {
        return '<p class="empty">' + esc(error && error.message ? error.message : '加载失败') + '</p>';
    }

    function pagerHtml(data) {
        if (!data || !data.total) {
            return '';
        }
        var page = data.page || 1;
        var pages = Math.max(data.pages || 1, 1);
        return '<button class="btn btn-text" type="button" data-page="' + (page - 1) + '"'
            + (page <= 1 ? ' disabled' : '') + '>上一页</button>'
            + '<span>第 ' + page + ' / ' + pages + ' 页 · 共 ' + data.total + ' 条</span>'
            + '<button class="btn btn-text" type="button" data-page="' + (page + 1) + '"'
            + (page >= pages ? ' disabled' : '') + '>下一页</button>';
    }

    /* ---------------- 概览 ---------------- */

    function statCard(label, value, extra) {
        return '<div class="stat-card">'
            + '<div class="stat-label">' + esc(label) + '</div>'
            + '<div class="stat-value">' + esc(value) + '</div>'
            + '<div class="stat-extra">' + esc(extra) + '</div>'
            + '</div>';
    }

    /** 统计页内部分组：只显示当前分组，避免所有模块堆在一页。 */
    var STATS_TABS = [
        { key: 'overview', label: '概览' },
        { key: 'pity', label: '保底' },
        { key: 'analysis', label: '分析' },
        { key: 'expect', label: '期望' },
        { key: 'resource', label: '资源' }
    ];

    function statsTabsHtml(active) {
        return '<div class="stats-tabs" id="stats-tabs" role="tablist">'
            + STATS_TABS.map(function (tab) {
                var on = tab.key === active;
                return '<button class="stats-tab' + (on ? ' active' : '') + '" type="button"'
                    + ' role="tab" data-stats-tab="' + tab.key + '"'
                    + ' aria-selected="' + (on ? 'true' : 'false') + '">' + tab.label + '</button>';
            }).join('') + '</div>';
    }

    function statsSection(key, active) {
        return '<div class="stats-section" data-stats-section="' + key + '"'
            + (key === active ? '' : ' hidden') + '>';
    }

    function applyStatsTab(key) {
        var bar = $('#stats-tabs');
        if (bar) {
            Array.prototype.forEach.call(bar.querySelectorAll('[data-stats-tab]'), function (btn) {
                var on = btn.getAttribute('data-stats-tab') === key;
                btn.classList.toggle('active', on);
                btn.setAttribute('aria-selected', on ? 'true' : 'false');
            });
        }
        Array.prototype.forEach.call(
            document.querySelectorAll('#view-stats [data-stats-section]'),
            function (section) {
                section.hidden = section.getAttribute('data-stats-section') !== key;
            });
    }

    function bindStatsTabs() {
        var bar = $('#stats-tabs');
        if (!bar) {
            return;
        }
        bar.addEventListener('click', function (event) {
            var btn = event.target.closest ? event.target.closest('[data-stats-tab]') : null;
            if (!btn) {
                return;
            }
            cache.statsTab = btn.getAttribute('data-stats-tab');
            applyStatsTab(cache.statsTab);
        });
    }

    function resourceTile(glyph, label, value, extra) {
        return '<article class="inventory-tile">'
            + '<span class="tile-glyph" aria-hidden="true">' + glyph + '</span>'
            + '<span class="tile-label">' + esc(label) + '</span>'
            + '<strong class="tile-value">' + esc(fmt(value)) + '</strong>'
            + '<span class="tile-note">' + esc(extra) + '</span>'
            + '</article>';
    }

    function ledgerItem(label, value, note, highlight) {
        return '<div class="ledger-item' + (highlight ? ' highlight' : '') + '">'
            + '<span class="ledger-label">' + esc(label) + '</span>'
            + '<strong class="ledger-value">' + esc(value) + '</strong>'
            + '<span class="ledger-note">' + esc(note) + '</span>'
            + '</div>';
    }

    function poolBars(list) {
        if (!list || !list.length) {
            return emptyHtml('还没有抽卡记录');
        }
        var max = 1;
        list.forEach(function (item) {
            max = Math.max(max, item.value);
        });
        return '<div class="bars">' + list.map(function (item) {
            var width = Math.max(8, Math.round(item.value / max * 100));
            return '<div class="bar-row">'
                + '<span>' + esc(item.name) + '</span>'
                + '<div class="bar-track"><div class="bar-fill" style="width:' + width + '%"></div></div>'
                + '<span class="bar-count">' + item.value + '</span>'
                + '</div>';
        }).join('') + '</div>';
    }

    function avatarHtml(item) {
        if (!item || item.itemType !== '角色') {
            return '';
        }
        var map = (window.SG_AVATARS || {})[state.game];
        var url = map ? map[item.itemName] : '';
        if (!url) {
            return '';
        }
        return '<img class="char-avatar" src="' + esc(url) + '" alt="" loading="lazy"'
            + ' onerror="this.remove()"/>';
    }

    function miniWishes(list) {
        if (!list || !list.length) {
            return emptyHtml('还没有抽卡记录');
        }
        return '<div class="mini-list">' + list.map(function (item) {
            var time = (item.wishTime || '').slice(5, 16);
            return '<div class="mini-item">'
                + '<span class="name">' + avatarHtml(item)
                + '<span class="stars">' + starText(item.rarity) + '</span>'
                + esc(item.itemName) + '</span>'
                + '<span class="time">' + esc(time) + '</span>'
                + '</div>';
        }).join('') + '</div>';
    }

    function capturePanelHtml(data) {
        if (state.game !== 'genshin') {
            return '';
        }
        var losses = data.captureLossCount || 0;
        var percent = Math.min(100, Math.round(losses / 3 * 100));
        var remaining = data.captureRemaining || 0;
        var rate = data.captureNextUpRate || 50;
        var status = data.captureGuaranteed
            ? '已连歪 ' + losses + ' 次：下次五星必定触发捕获明光'
            : (losses === 0
                ? '当前小保底：下次五星 50% 为当期 UP'
                : '已连歪 ' + losses + ' 次：下次五星 UP 概率约 ' + rate + '%');

        return '<section class="panel capture-panel">'
            + '<h3>捕获明光<span class="pool-tag">角色活动 · 原神</span></h3>'
            + '<div class="pity-bar"><span style="width:' + percent + '%"></span></div>'
            + '<div class="pity-line">'
            + '<span>连歪次数 <strong>' + losses + ' / 3</strong></span>'
            + '<span>距必定捕获还差 <strong>' + remaining + ' 次</strong></span>'
            + '</div>'
            + '<p class="pity-note">' + esc(status) + '</p>'
            + '<p class="pity-note">角色池五星 ' + data.characterFiveStarWishes + ' 次，UP '
            + data.characterUpWishes + ' 次（UP 率 ' + data.characterUpRate + '%）</p>'
            + '<p class="pity-note">规则：小保底基础 50%，含捕获明光综合 55%；连续 3 次歪后，'
            + '下次五星必定 UP（连歪 1 / 2 次按 55% / 75% 估算）。</p>'
            + '</section>';
    }

    function poolStatsPanelHtml(data) {
        var list = data.poolStats || [];
        if (!list.length) {
            return '';
        }

        function guaranteeText(pool) {
            if (pool === '集录祈愿') {
                return '命定值满 · 下次必定定轨物品';
            }
            if (pool === '武器活动') {
                return '命定值满 · 下次必定定轨武器';
            }
            if (pool === '光锥活动') {
                return '大保底 · 下次必定 UP';
            }
            return '大保底 · 下次必定 UP';
        }

        return '<section class="panel pool-stats-panel">'
            + '<h3>卡池保底统计<span class="pool-tag">保底 · 出货</span></h3>'
            + '<div class="pool-stat-list">'
            + list.map(function (item) {
                var percent = item.cap > 0
                    ? Math.min(100, Math.round(item.currentPity / item.cap * 100)) : 0;
                return '<div class="pool-stat">'
                    + '<div class="pool-stat-head">'
                    + '<span class="pool-tag">' + esc(item.pool) + '</span>'
                    + '<span class="pool-stat-pity">已垫 ' + item.currentPity + ' / ' + item.cap + ' 抽'
                    + (item.pityManual ? ' · 手动' : '') + '</span>'
                    + '</div>'
                    + '<div class="pity-bar"><span style="width:' + percent + '%"></span></div>'
                    + '<div class="pool-stat-meta">'
                    + '<span>五星 ' + item.fiveStarCount + ' 次</span>'
                    + '<span>平均 ' + item.avgFiveStarPity + ' 抽</span>'
                    + '<span>距保底 ' + item.pullsToPity + ' 抽</span>'
                    + (item.upGuaranteed
                        ? '<span class="pool-tag up">' + esc(guaranteeText(item.pool)) + '</span>'
                        : '')
                    + '</div>'
                    + '</div>';
            }).join('')
            + '</div></section>';
    }

    /* ---------------- 抽卡期望 ---------------- */

    var EXPECT_KEY = 'sg_expect_';

    /* 官方 / 社区通行估算值 */
    var EXPECT_MODEL = {
        fiveStarAvg: 62.5,
        weaponFiveStarAvg: 53.3,
        genshinCharUpRate: 0.55,
        starrailCharUpRate: 0.5,
        starrailWeaponUpRate: 0.75,
        genshinWeaponFives: 2
    };

    function expectPrefs() {
        var raw = safeParse(localStorage.getItem(EXPECT_KEY + state.game)) || {};
        return {
            c: Math.max(0, Math.min(6, Number(raw.c) || 0)),
            r: Math.max(0, Math.min(5, Number(raw.r) || 0)),
            mode: raw.mode === 'theory' ? 'theory' : 'history'
        };
    }

    function saveExpectPrefs(prefs) {
        try {
            localStorage.setItem(EXPECT_KEY + state.game, JSON.stringify(prefs));
        } catch (e) {
            /* 忽略隐私模式下的写入失败 */
        }
    }

    function poolStatOf(data, pool) {
        var list = data.poolStats || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].pool === pool) {
                return list[i];
            }
        }
        return null;
    }

    /**
     * 把五星记录按卡池累计成「UP 周期」样本：从上次 UP 到这次 UP 一共花了多少抽
     * （含中间歪掉的五星），与后端口径一致。
     */
    function upCycleSamples(records, pools) {
        var cycles = [];
        var acc = 0;
        (records || []).forEach(function (record) {
            if (Number(record.rarity) !== 5 || pools.indexOf(record.pool) < 0) {
                return;
            }
            acc += Number(record.pityCount) || 0;
            if (record.isUp === true) {
                if (acc > 0) {
                    cycles.push(acc);
                }
                acc = 0;
            }
        });
        return cycles;
    }

    /** 线性插值分位数，用于从往期样本得到区间。 */
    function percentile(values, p) {
        if (!values.length) {
            return 0;
        }
        var sorted = values.slice().sort(function (a, b) {
            return a - b;
        });
        if (sorted.length === 1) {
            return sorted[0];
        }
        var index = (sorted.length - 1) * p;
        var low = Math.floor(index);
        var high = Math.ceil(index);
        var weight = index - low;
        return sorted[low] * (1 - weight) + sorted[high] * weight;
    }

    /**
     * 目标（角色 c 命 + 武器 r 精炼）的抽数期望。
     * theory：按平均五星抽数与 UP 概率推算单点期望；
     * history：用往期 UP 周期样本的 25%–75% 分位得到区间。
     * 首个 UP 会先抵扣当前保底进度；已有大保底时首个 UP 只需一个五星。
     */
    function expectationPlan(data, prefs) {
        var g = gameConfig();
        var isSR = state.game === 'starrail';
        var charPool = poolStatOf(data, g.charPool);
        var weaponPool = poolStatOf(data, g.weaponPool);
        var charPity = charPool ? Math.max(0, charPool.currentPity || 0) : 0;
        var weaponPity = weaponPool ? Math.max(0, weaponPool.currentPity || 0) : 0;
        var charGuaranteed = !!(charPool && charPool.upGuaranteed);
        var weaponGuaranteed = !!(weaponPool && weaponPool.upGuaranteed);

        var charRate = isSR ? EXPECT_MODEL.starrailCharUpRate : EXPECT_MODEL.genshinCharUpRate;
        var charUnitTheory = EXPECT_MODEL.fiveStarAvg * (1 + (1 - charRate));
        var weaponUnitTheory = isSR
            ? EXPECT_MODEL.weaponFiveStarAvg * (1 + (1 - EXPECT_MODEL.starrailWeaponUpRate))
            : EXPECT_MODEL.weaponFiveStarAvg * EXPECT_MODEL.genshinWeaponFives;

        var charSamples = Number(data.characterUpSamples) || 0;
        var weaponSamples = Number(data.weaponUpSamples) || 0;
        var charCycles = upCycleSamples(data.fiveStarRecords, [g.charPool]);
        var weaponCycles = upCycleSamples(data.fiveStarRecords, [g.weaponPool]);
        var historyReady = charCycles.length >= 2 && data.characterUpAvgPity > 0;
        var useHistory = prefs.mode === 'history' && historyReady;
        var weaponHistory = useHistory && weaponCycles.length >= 2 && data.weaponUpAvgPity > 0;

        var charUnitLow;
        var charUnitHigh;
        if (useHistory) {
            charUnitLow = percentile(charCycles, 0.25);
            charUnitHigh = percentile(charCycles, 0.75);
        } else {
            charUnitLow = charUnitTheory;
            charUnitHigh = charUnitTheory;
        }

        var weaponUnitLow;
        var weaponUnitHigh;
        if (weaponHistory) {
            weaponUnitLow = percentile(weaponCycles, 0.25);
            weaponUnitHigh = percentile(weaponCycles, 0.75);
        } else {
            weaponUnitLow = weaponUnitTheory;
            weaponUnitHigh = weaponUnitTheory;
        }

        var charFirstLow = Math.max(1, (charGuaranteed ? EXPECT_MODEL.fiveStarAvg : charUnitLow) - charPity);
        var charFirstHigh = Math.max(1, (charGuaranteed ? EXPECT_MODEL.fiveStarAvg : charUnitHigh) - charPity);
        var charCostLow = charFirstLow + prefs.c * charUnitLow;
        var charCostHigh = charFirstHigh + prefs.c * charUnitHigh;

        var weaponCostLow = 0;
        var weaponCostHigh = 0;
        if (prefs.r > 0) {
            var weaponFirstLow = Math.max(1, (weaponGuaranteed ? EXPECT_MODEL.weaponFiveStarAvg : weaponUnitLow)
                - weaponPity);
            var weaponFirstHigh = Math.max(1, (weaponGuaranteed ? EXPECT_MODEL.weaponFiveStarAvg : weaponUnitHigh)
                - weaponPity);
            weaponCostLow = weaponFirstLow + (prefs.r - 1) * weaponUnitLow;
            weaponCostHigh = weaponFirstHigh + (prefs.r - 1) * weaponUnitHigh;
        }

        return {
            totalLow: Math.max(1, Math.round(charCostLow + weaponCostLow)),
            totalHigh: Math.max(1, Math.round(charCostHigh + weaponCostHigh)),
            charCostLow: charCostLow,
            charCostHigh: charCostHigh,
            weaponCostLow: weaponCostLow,
            weaponCostHigh: weaponCostHigh,
            charUnitLow: charUnitLow,
            charUnitHigh: charUnitHigh,
            weaponUnitLow: weaponUnitLow,
            weaponUnitHigh: weaponUnitHigh,
            charPity: charPity,
            weaponPity: weaponPity,
            charGuaranteed: charGuaranteed,
            weaponGuaranteed: weaponGuaranteed,
            useHistory: useHistory,
            historyReady: historyReady,
            weaponHistory: weaponHistory,
            charSamples: charSamples,
            weaponSamples: weaponSamples,
            available: data.resource.totalPulls || 0,
            currencyPerPull: data.resource.primogemsPerPull || 160
        };
    }

    function expectStepper(kind, value, min, max, unit) {
        return '<div class="expect-stepper">'
            + '<button class="expect-step" type="button" data-step="' + kind + '" data-dir="-1"'
            + (value <= min ? ' disabled' : '') + ' aria-label="减少">−</button>'
            + '<strong class="expect-step-value">' + value + '<em>' + unit + '</em></strong>'
            + '<button class="expect-step" type="button" data-step="' + kind + '" data-dir="1"'
            + (value >= max ? ' disabled' : '') + ' aria-label="增加">＋</button>'
            + '</div>';
    }

    /** 把上下限渲染成「A–B」或单个数（上下限相同时）。 */
    function rangeText(low, high) {
        var lo = Math.max(0, Math.round(low));
        var hi = Math.max(lo, Math.round(high));
        return hi > lo ? fmt(lo) + '–' + fmt(hi) : fmt(lo);
    }

    function expectationPanelHtml(data) {
        var g = gameConfig();
        var prefs = expectPrefs();
        var plan = expectationPlan(data, prefs);
        var historyOn = plan.useHistory;
        var targetName = 'C' + prefs.c + (prefs.r > 0 ? ' + R' + prefs.r : '');
        var totalLow = plan.totalLow;
        var totalHigh = plan.totalHigh;
        var isRange = totalHigh > totalLow;
        var available = plan.available;
        var enough = available >= totalHigh;
        var percent = Math.min(100, Math.round(available / totalHigh * 100));

        var compareText;
        if (enough) {
            compareText = '当前可抽 <strong>' + fmt(available) + '</strong> 抽 · 已足够（按区间上限），余 <strong>'
                + fmt(available - totalHigh) + '</strong> 抽';
        } else if (available >= totalLow) {
            compareText = '当前可抽 <strong>' + fmt(available) + '</strong> 抽 · 已达到区间下限，按上限还差 <strong>'
                + fmt(totalHigh - available) + '</strong> 抽（约 '
                + fmt((totalHigh - available) * plan.currencyPerPull) + ' ' + esc(g.currency) + '）';
        } else {
            var gapLow = totalLow - available;
            var gapHigh = totalHigh - available;
            compareText = '当前可抽 <strong>' + fmt(available) + '</strong> 抽 · 还差 <strong>'
                + (isRange ? fmt(gapLow) + '–' + fmt(gapHigh) : fmt(gapLow)) + '</strong> 抽（约 '
                + (isRange
                    ? fmt(gapLow * plan.currencyPerPull) + '–' + fmt(gapHigh * plan.currencyPerPull)
                    : fmt(gapLow * plan.currencyPerPull))
                + ' ' + esc(g.currency) + '）';
        }

        var sourceNote;
        if (historyOn) {
            sourceNote = '往期区间：角色 UP 共 ' + plan.charSamples + ' 次，单次 UP '
                + rangeText(plan.charUnitLow, plan.charUnitHigh) + ' 抽（25%–75% 分位）';
            if (prefs.r > 0) {
                sourceNote += plan.weaponHistory
                    ? ' · 武器 UP 共 ' + plan.weaponSamples + ' 次，单次 '
                        + rangeText(plan.weaponUnitLow, plan.weaponUnitHigh) + ' 抽'
                    : ' · 武器样本不足 2 次，改用理论值';
            }
        } else {
            sourceNote = state.game === 'starrail'
                ? '理论模型：角色池五星平均 62.5 抽、UP 基础 50%；光锥池五星平均 53.3 抽、UP 75%，歪后大保底。'
                : '理论模型：角色池五星平均 62.5 抽、UP 综合 55%（含捕获明光）；'
                    + '武器池五星平均 53.3 抽、定轨约需 2 个五星。';
        }

        var pityNote = '已扣除当前保底进度：' + esc(g.charPool) + ' ' + plan.charPity + ' / 90'
            + (prefs.r > 0 ? '，' + esc(g.weaponPool) + ' ' + plan.weaponPity + ' / 80' : '')
            + (plan.charGuaranteed ? ' · 角色池大保底' : '')
            + (plan.weaponGuaranteed && prefs.r > 0 ? ' · 武器池大保底' : '') + '。';

        return '<section class="panel expect-panel">'
            + '<div class="expect-head">'
            + '<h3>抽卡期望<span class="pool-tag">目标模拟</span></h3>'
            + '<div class="expect-modes">'
            + '<button class="expect-mode' + (historyOn ? '' : ' is-on')
            + '" type="button" data-mode="theory">理论模型</button>'
            + '<button class="expect-mode' + (historyOn ? ' is-on' : '')
            + '" type="button" data-mode="history"'
            + (plan.historyReady ? '' : ' disabled title="往期 UP 样本不足 2 次"')
            + '>往期区间</button>'
            + '</div>'
            + '</div>'

            + '<div class="expect-targets">'
            + '<div class="expect-target">'
            + '<span class="expect-target-label">角色命座</span>'
            + expectStepper('c', prefs.c, 0, 6, '命')
            + '<span class="expect-target-note">'
            + (prefs.c === 0 ? '仅本体，不追命座' : '本体 + ' + prefs.c + ' 命') + '</span>'
            + '</div>'
            + '<div class="expect-target">'
            + '<span class="expect-target-label">武器精炼</span>'
            + expectStepper('r', prefs.r, 0, 5, '精')
            + '<span class="expect-target-note">'
            + (prefs.r === 0 ? '不抽武器' : '本体 + ' + (prefs.r - 1) + ' 把精炼') + '</span>'
            + '</div>'
            + '</div>'

            + '<div class="expect-readout">'
            + '<span class="expect-kicker">目标 ' + esc(targetName) + ' · '
            + (historyOn ? '往期区间' : '理论期望') + '</span>'
            + '<div class="expect-number' + (isRange ? ' is-range' : '') + '">'
            + rangeText(totalLow, totalHigh) + '<span class="unit">抽</span></div>'
            + '<p class="expect-compare">' + compareText + '</p>'
            + '<div class="expect-bar' + (enough ? ' done' : '') + '">'
            + '<span style="width:' + percent + '%"></span></div>'
            + '</div>'

            + '<div class="expect-split">'
            + '<div class="expect-part">'
            + '<span class="expect-part-label">角色 C' + prefs.c + '</span>'
            + '<strong>' + rangeText(plan.charCostLow, plan.charCostHigh) + ' 抽</strong>'
            + '<em>' + (prefs.c + 1) + ' 个 UP</em>'
            + '</div>'
            + '<div class="expect-part">'
            + '<span class="expect-part-label">' + (prefs.r > 0 ? '武器 R' + prefs.r : '武器') + '</span>'
            + '<strong>' + (prefs.r > 0 ? rangeText(plan.weaponCostLow, plan.weaponCostHigh) + ' 抽' : '—') + '</strong>'
            + '<em>' + (prefs.r > 0 ? prefs.r + ' 把 UP' : '未选择') + '</em>'
            + '</div>'
            + '</div>'

            + '<p class="expect-note">' + esc(sourceNote) + '</p>'
            + '<p class="expect-note">' + esc(pityNote)
            + (historyOn
                ? '区间取往期 UP 周期的 25%–75% 分位，约一半情况落在此范围。'
                : '理论值为单点估算，约一半概率在期望抽数内达成。')
            + '</p>'
            + '</section>';
    }

    function bindExpectation(data) {
        var panel = $('.expect-panel');
        if (!panel) {
            return;
        }
        panel.addEventListener('click', function (event) {
            var modeBtn = event.target.closest('[data-mode]');
            var stepBtn = event.target.closest('[data-step]');
            if (!modeBtn && !stepBtn) {
                return;
            }
            var prefs = expectPrefs();
            if (modeBtn) {
                if (modeBtn.dataset.mode === 'history' && !expectationPlan(data, prefs).historyReady) {
                    toast('往期 UP 样本不足 2 次，先记录更多抽卡数据', 'error');
                    return;
                }
                prefs.mode = modeBtn.dataset.mode;
            }
            if (stepBtn) {
                var dir = Number(stepBtn.dataset.dir) || 0;
                if (stepBtn.dataset.step === 'c') {
                    prefs.c = Math.max(0, Math.min(6, prefs.c + dir));
                } else if (stepBtn.dataset.step === 'r') {
                    prefs.r = Math.max(0, Math.min(5, prefs.r + dir));
                }
            }
            saveExpectPrefs(prefs);

            var host = $('.expect-panel');
            if (host) {
                host.outerHTML = expectationPanelHtml(data);
                bindExpectation(data);
            }
        });
    }

    function resourcePanelHtml() {
        var g = gameConfig();
        return '<section class="panel backup-panel">'
            + '<h3>账号资源导入导出 · ' + esc(g.fullName) + '</h3>'
            + '<p class="panel-desc">导出或导入当前游戏的账号资源（' + esc(g.currency) + '、'
            + esc(g.credit) + '、' + esc(g.fateLimited) + '、' + esc(g.fateStandard)
            + '）。抽卡记录请在「抽卡」页导入导出，全量备份请到「设置」页。</p>'
            + '<div class="panel-actions">'
            + '<button class="btn btn-primary" id="resource-export-csv" type="button">导出 CSV</button>'
            + '<button class="btn btn-outline" id="resource-export-json" type="button">导出 JSON</button>'
            + '<button class="btn btn-text" id="resource-template" type="button">下载导入模板</button>'
            + '<button class="btn btn-outline" id="resource-import" type="button">导入资源</button>'
            + '<input id="resource-file" type="file" accept=".csv,.json,text/csv,application/json" hidden/>'
            + '</div>'
            + '</section>';
    }

    function loadDashboard() {
        var el = $('#view-dashboard');
        var g = gameConfig();
        el.innerHTML = '<div class="loading">加载中…</div>';

        return api('/api/stats/overview').then(function (data) {
            applyPityOverrides(data);
            var resource = data.resource;
            var total = resource.totalPulls || 0;
            var currencyPulls = resource.pullsFromPrimogems || 0;
            var limited = resource.intertwinedFates || 0;
            var standard = resource.acquaintedFates || 0;
            var currencyPct = total > 0 ? Math.round(currencyPulls * 100 / total) : 0;
            var fatePct = total > 0 ? 100 - currencyPct : 0;

            el.innerHTML =
                '<div class="page-head dash-head">'
                + '<div><h2>账号资源</h2><p class="sub">' + esc(g.fullName) + ' · 资源与抽数换算</p></div>'
                + '</div>'

                + '<section class="fortune">'
                + '<div class="fortune-copy">'
                + '<span class="fortune-kicker">合计可抽 · Total pulls</span>'
                + '<div class="fortune-number">' + esc(fmt(total)) + '<span class="unit">抽</span></div>'
                + '<div class="compose" role="img" aria-label="可抽构成">'
                + '<span class="seg-currency" style="width:' + currencyPct + '%"></span>'
                + '<span class="seg-fate" style="width:' + fatePct + '%"></span>'
                + '</div>'
                + '<div class="fortune-legend">'
                + '<span><i class="legend-dot currency"></i>' + esc(g.currency) + '兑换 <strong>'
                + fmt(currencyPulls) + '</strong> 抽</span>'
                + '<span><i class="legend-dot fate"></i>' + esc(g.fateLimited) + ' <strong>'
                + fmt(limited) + '</strong> 抽</span>'
                + '<span class="legend-muted">' + esc(g.fateStandard) + ' ' + fmt(standard)
                + ' 抽不计入</span>'
                + '</div>'
                + '</div>'
                + '<aside class="fortune-side">'
                + '<div class="asset">'
                + '<span class="asset-label">总资产</span>'
                + '<strong class="asset-value">' + esc(fmt(resource.totalPrimogems))
                + '<span class="asset-unit">' + esc(g.currency) + '</span></strong>'
                + '</div>'
                + '<div class="fortune-actions">'
                + '<button class="btn btn-primary" id="resource-ocr" type="button">截图识别</button>'
                + '<button class="btn btn-outline" id="resource-edit" type="button">编辑资源</button>'
                + '</div>'
                + '</aside>'
                + '</section>'

                + '<div class="inventory">'
                + resourceTile('✦', g.currency, resource.primogems, '≈ ' + fmt(currencyPulls) + ' 抽')
                + resourceTile('◉', g.credit, resource.mora, '游戏内通用货币')
                + resourceTile('✧', g.fateLimited, limited, '限定池 · 1 枚 = 1 抽')
                + resourceTile('◇', g.fateStandard, standard, '常驻池 · 不计入合计')
                + '</div>'

                + '<section class="ledger">'
                + '<div class="ledger-head"><h3>抽数换算</h3>'
                + '<span>常驻抽数不计入折算与合计</span></div>'
                + '<div class="ledger-grid">'
                + ledgerItem(g.currency + '可兑换', fmt(currencyPulls) + ' 抽',
                    '余 ' + fmt(resource.primogemsRemainder) + ' ' + g.currency)
                + ledgerItem(g.fateLimited + '折算', fmt(resource.primogemsFromFates) + ' ' + g.currency,
                    limited + ' 枚 × ' + resource.primogemsPerPull)
                + ledgerItem('合计可抽', fmt(total) + ' 抽',
                    '折合总资产 ' + fmt(resource.totalPrimogems) + ' ' + g.currency, true)
                + '</div>'
                + '<p class="ledger-foot">换算基准：1 抽 = ' + resource.primogemsPerPull
                + ' ' + esc(g.currency) + '</p>'
                + '</section>';

            var editBtn = $('#resource-edit');
            if (editBtn) {
                editBtn.addEventListener('click', function () {
                    guard(function () {
                        return editResource(resource);
                    });
                });
            }

            var ocrBtn = $('#resource-ocr');
            if (ocrBtn) {
                ocrBtn.addEventListener('click', function () {
                    guard(function () {
                        return openOcrDialog('resource');
                    });
                });
            }
        }).catch(function (err) {
            if (state.token) {
                el.innerHTML = errorHtml(err);
            }
        });
    }

    function luckPanelHtml(data) {
        var g = gameConfig();
        var weaponWord = g.weaponPool === '光锥活动' ? '光锥' : '武器';
        var charSamples = Number(data.characterUpSamples) || 0;
        var weaponSamples = Number(data.weaponUpSamples) || 0;
        var captureCard = state.game === 'genshin'
            ? statCard('捕获明光触发', data.captureTriggeredCount || 0, '录入时勾选触发次数')
            : '';

        return '<section class="panel luck-panel">'
            + '<h3>抽卡统计<span class="pool-tag">角色活动 · ' + esc(g.weaponPool) + '</span></h3>'
            + '<div class="stat-grid">'
            + statCard('一共抽过', fmt(data.totalPulls || 0) + ' 抽',
                '五星 ' + data.fiveStarWishes + ' 次')
            + statCard('歪了几次', (data.lostCount || 0) + ' 次',
                '小保底 ' + (data.softPityCount || 0) + ' 次')
            + statCard('小保底不歪', (data.softPityUpCount || 0) + ' 次',
                '不歪率 ' + (data.softPityUpRate || 0) + '%')
            + statCard('最多连歪', (data.maxLossStreak || 0) + ' 次',
                '最多连不歪 ' + (data.maxUpStreak || 0) + ' 次')
            + statCard('平均 UP 角色', charSamples ? num(data.characterUpAvgPity) + ' 抽' : '—',
                'UP ' + charSamples + ' 次')
            + statCard('平均 UP ' + weaponWord, weaponSamples ? num(data.weaponUpAvgPity) + ' 抽' : '—',
                'UP ' + weaponSamples + ' 次')
            + statCard('平均每个 UP 角色', charSamples
                ? fmt(data.avgPrimogemsPerUpCharacter) + ' ' + g.currency : '—',
                charSamples ? '均 ' + num(data.characterUpAvgPity) + ' 抽 × 160' : '暂无样本')
            + statCard('平均限定' + weaponWord, weaponSamples
                ? fmt(data.avgPrimogemsPerUpWeapon) + ' ' + g.currency : '—',
                weaponSamples ? '均 ' + num(data.weaponUpAvgPity) + ' 抽 × 160' : '暂无样本')
            + captureCard
            + '</div></section>';
    }

    /* ---------- 五星抽数柱形图 ---------- */

    /** 把五星记录转换成柱形图数据；real 为 true 时隐藏歪的记录并按 UP 周期累计真实抽数。 */
    function pullChartPoints(list, real) {
        var points = [];
        if (real) {
            var cycles = {};
            (list || []).forEach(function (item) {
                var pool = item.pool || '未知卡池';
                var acc = (cycles[pool] || 0) + (Number(item.pityCount) || 0);
                if (item.isUp === true) {
                    points.push({ name: item.itemName || '未命名', type: item.itemType,
                        pool: pool, value: acc, up: true });
                    acc = 0;
                }
                cycles[pool] = acc;
            });
            return points;
        }
        return (list || []).map(function (item) {
            return {
                name: item.itemName || '未命名',
                type: item.itemType,
                pool: item.pool || '未知卡池',
                value: Number(item.pityCount) || 0,
                up: item.isUp === true
            };
        });
    }

    function pullChartHtml(points, emptyText) {
        if (!points.length) {
            return emptyHtml(emptyText || '还没有五星记录');
        }
        var max = 1;
        points.forEach(function (point) {
            max = Math.max(max, point.value);
        });
        return '<div class="pull-chart">' + points.map(function (point) {
            var width = Math.max(4, Math.round(point.value / max * 100));
            return '<div class="pull-row' + (point.up ? '' : ' lost') + '" title="' + esc(point.pool) + ' · '
                + (point.up ? 'UP' : '歪') + ' · 用了 ' + point.value + ' 抽">'
                + '<div class="pull-label">'
                + avatarHtml({ itemName: point.name, itemType: point.type })
                + '<span class="pull-name">' + esc(point.name) + '</span></div>'
                + '<div class="pull-track"><span class="pull-bar" style="width:' + width + '%"></span></div>'
                + '<span class="pull-val">' + point.value + '</span>'
                + '</div>';
        }).join('') + '</div>';
    }

    /** 卡池筛选按钮：全部 + 有五星记录的卡池，按游戏配置顺序排列。 */
    var PULL_POOL_ALL = 'all';

    function pullPoolList(list) {
        var g = gameConfig();
        var seen = {};
        (list || []).forEach(function (item) {
            seen[item.pool || '未知卡池'] = true;
        });
        var options = [{ key: PULL_POOL_ALL, label: '全部' }];
        var known = [];
        (g.pools || []).forEach(function (pool) {
            if (seen[pool]) {
                known.push(pool);
            }
        });
        Object.keys(seen).forEach(function (pool) {
            if (known.indexOf(pool) < 0) {
                known.push(pool);
            }
        });
        known.forEach(function (pool) {
            options.push({ key: pool, label: pool });
        });
        return options;
    }

    function pullPoolsHtml(pools, active) {
        return pools.map(function (pool) {
            return '<button class="pull-pool' + (pool.key === active ? ' active' : '') + '" type="button"'
                + ' data-pool="' + esc(pool.key) + '">' + esc(pool.label) + '</button>';
        }).join('');
    }

    function pullPanelHtml() {
        return '<section class="panel pull-panel">'
            + '<h3>五星抽数<span class="pool-tag">每次五星用了多少抽</span>'
            + '<button class="btn btn-text pull-toggle" type="button" id="pull-toggle">显示真实抽数</button></h3>'
            + '<div class="pull-pools" id="pull-pools"></div>'
            + '<p class="pull-summary" id="pull-summary"></p>'
            + '<div class="pull-chart-wrap" id="pull-chart-wrap"></div></section>';
    }

    function renderPullChart(real) {
        var all = (cache.stats && cache.stats.fiveStarRecords) || [];
        cache.pullReal = real;
        var pools = pullPoolList(all);
        var exists = pools.some(function (pool) {
            return pool.key === cache.pullPool;
        });
        if (!exists) {
            cache.pullPool = PULL_POOL_ALL;
        }
        var selected = cache.pullPool;
        var list = selected === PULL_POOL_ALL ? all : all.filter(function (item) {
            return (item.pool || '未知卡池') === selected;
        });
        var points = pullChartPoints(list, real);
        var wrap = $('#pull-chart-wrap');
        var poolWrap = $('#pull-pools');
        var summary = $('#pull-summary');
        var toggle = $('#pull-toggle');
        if (!wrap) {
            return;
        }
        if (poolWrap) {
            poolWrap.innerHTML = pullPoolsHtml(pools, selected);
        }
        wrap.innerHTML = pullChartHtml(points, selected === PULL_POOL_ALL
            ? '还没有五星记录' : selected + ' 还没有五星记录');
        if (toggle) {
            toggle.textContent = real ? '显示原始抽数' : '显示真实抽数';
            toggle.classList.toggle('active', real);
        }
        var total = 0;
        points.forEach(function (point) {
            total += point.value;
        });
        if (summary) {
            var scope = selected === PULL_POOL_ALL ? '' : selected + '：';
            if (real) {
                var hidden = list.filter(function (item) {
                    return item.isUp !== true;
                }).length;
                summary.textContent = scope + '已隐藏 ' + hidden + ' 次歪的记录 · 抽到 UP 一共用了 '
                    + total + ' 抽（含歪掉的抽数' + (selected === PULL_POOL_ALL ? '，按卡池分别累计' : '') + '）';
            } else {
                summary.textContent = scope + '共 ' + points.length + ' 次五星，合计 ' + total
                    + ' 抽；深色柱为歪掉的五星';
            }
        }
    }

    function bindPullChart() {
        var toggle = $('#pull-toggle');
        if (!toggle) {
            return;
        }
        cache.pullPool = PULL_POOL_ALL;
        toggle.addEventListener('click', function () {
            renderPullChart(!cache.pullReal);
        });
        var poolWrap = $('#pull-pools');
        if (poolWrap) {
            poolWrap.addEventListener('click', function (event) {
                var btn = event.target.closest ? event.target.closest('.pull-pool') : null;
                if (!btn || !poolWrap.contains(btn)) {
                    return;
                }
                var pool = btn.getAttribute('data-pool');
                if (pool === cache.pullPool) {
                    return;
                }
                cache.pullPool = pool;
                renderPullChart(cache.pullReal);
            });
        }
        renderPullChart(false);
    }

    function loadStats() {
        var el = $('#view-stats');
        var g = gameConfig();
        el.innerHTML = '<div class="loading">加载中…</div>';

        return api('/api/stats/overview').then(function (data) {
            applyPityOverrides(data);
            var resource = data.resource;
            var name = (state.user && (state.user.nickname || state.user.username)) || '旅行者';
            cache.stats = data;
            cache.statsTab = cache.statsTab || 'overview';
            var tab = cache.statsTab;

            var pityHtml = capturePanelHtml(data) + poolStatsPanelHtml(data);

            el.innerHTML =
                '<div class="hero">'
                + '<div>'
                + '<p class="hero-sub">' + esc(g.heroSub) + '</p>'
                + '<h2>' + esc(name) + '</h2>'
                + '<p class="hero-desc">当前合计可抽 <strong>' + fmt(resource.totalPulls)
                + '</strong> 抽 · 总资产 ' + fmt(resource.totalPrimogems) + ' ' + esc(g.currency) + '</p>'
                + '</div>'
                + '<div class="hero-badge">五星出货率<br><strong>' + data.fiveStarRate + '%</strong></div>'
                + '</div>'

                + statsTabsHtml(tab)

                + statsSection('overview', tab)
                + '<div class="stat-grid">'
                + statCard('出货记录', data.wishCount, '四星 ' + data.fourStarWishes + ' 次')
                + statCard('五星出货', data.fiveStarWishes, '出货率 ' + data.fiveStarRate + '%')
                + statCard('四星出货', data.fourStarWishes, '占总记录 '
                    + (data.wishCount ? Math.round(data.fourStarWishes * 100 / data.wishCount) : 0) + '%')
                + statCard('五星平均抽数', data.avgFiveStarPity, '按记录中的保底进度')
                + '</div>'
                + '<section class="panel"><h3>最近出货<span class="pool-tag">最近 '
                + (data.recentWishes || []).length + ' 条</span></h3>'
                + miniWishes(data.recentWishes) + '</section>'
                + '</div>'

                + statsSection('pity', tab)
                + (pityHtml ? '<div class="stats-duo">' + pityHtml + '</div>' : '')
                + '</div>'

                + statsSection('analysis', tab)
                + luckPanelHtml(data)
                + pullPanelHtml()
                + '<section class="panel"><h3>卡池分布<span class="pool-tag">各卡池抽数占比</span></h3>'
                + poolBars(data.poolDistribution) + '</section>'
                + '</div>'

                + statsSection('expect', tab)
                + expectationPanelHtml(data)
                + '</div>'

                + statsSection('resource', tab)
                + resourcePanelHtml()
                + '</div>';

            bindStatsTabs();
            bindResourcePanel();
            bindPullChart();
            bindExpectation(data);
        }).catch(function (err) {
            if (state.token) {
                el.innerHTML = errorHtml(err);
            }
        });
    }

    /* ---------------- 抽卡记录 ---------------- */

    function wishRow(item) {
        var name = item.itemName || '未命名';
        var fiveStar = Number(item.rarity) >= 5;
        return '<div class="record-row" data-id="' + item.id + '">'
            + '<input type="checkbox" class="record-check" data-check'
            + (state.wishSelected.has(item.id) ? ' checked' : '') + ' aria-label="选择"/>'
            + '<div class="record-name">' + avatarHtml(item)
            + '<span class="stars">' + starText(item.rarity) + '</span>'
            + '<span class="name' + (item.rarity === 3 ? ' muted' : '') + '">' + esc(name) + '</span></div>'
            + '<div>' + esc(item.itemType || '—') + '</div>'
            + '<div><span class="pool-tag' + (item.isUp ? ' up' : '') + '">'
            + esc(item.pool || '未知卡池') + '</span></div>'
            + '<div>' + (fiveStar ? (item.isUp ? 'UP 内' : '未中 UP') : '—') + '</div>'
            + '<div>' + (fiveStar ? '用了 ' + (item.pityCount || 1) + ' 抽' : '—')
            + (fiveStar && item.captureTriggered ? ' <span class="capture-mark">捕获</span>' : '') + '</div>'
            + '<div class="record-time">' + esc(item.wishTime || '') + '</div>'
            + '<div class="record-actions">'
            + '<button class="icon-btn" type="button" data-act="edit">编辑</button>'
            + '<button class="icon-btn danger" type="button" data-act="delete">删除</button>'
            + '</div>'
            + '</div>';
    }

    function loadWishes() {
        var el = $('#view-wishes');
        var pools = gameConfig().pools;
        var poolOptions = [''].concat(pools).map(function (pool) {
            return '<option value="' + pool + '"' + (state.wishPool === pool ? ' selected' : '') + '>'
                + (pool || '全部卡池') + '</option>';
        }).join('');

        el.innerHTML =
            '<div class="page-head">'
            + '<div><h2>抽卡记录</h2><p class="sub">五星出货记录 · 记录抽到五星用了多少抽 · 支持导入导出</p></div>'
            + '<div class="head-actions">'
            + '<button class="btn btn-primary" id="wish-add" type="button">+ 录入五星</button>'
            + '</div>'
            + '</div>'
            + '<div class="toolbar">'
            + '<select id="wish-pool" class="input">' + poolOptions + '</select>'
            + '<label class="filter-check"><input type="checkbox" id="wish-only-five"'
            + (state.wishOnlyFive ? ' checked' : '') + '/>只看五星</label>'
            + '<div class="toolbar-actions">'
            + '<button class="btn btn-text btn-sm" id="wish-batch-edit" type="button">批量编辑本页</button>'
            + '<button class="btn btn-text btn-sm" id="wish-select-all" type="button">全选本页</button>'
            + '<button class="btn btn-outline btn-sm" id="wish-ocr" type="button">截图导入</button>'
            + '<button class="btn btn-text btn-sm btn-danger" id="wish-batch-del" type="button" disabled>批量删除</button>'
            + '<button class="btn btn-outline btn-sm" id="wish-export-csv" type="button">导出 CSV</button>'
            + '<button class="btn btn-outline btn-sm" id="wish-export-json" type="button">导出 JSON</button>'
            + '<button class="btn btn-text btn-sm" id="wish-template" type="button">下载模板</button>'
            + '<button class="btn btn-outline btn-sm" id="wish-import" type="button">导入记录</button>'
            + '<button class="btn btn-outline btn-sm" id="wish-link-import" type="button">链接导入</button>'
            + '<input id="wish-file" type="file" accept=".csv,.json,text/csv,application/json" hidden/>'
            + '</div>'
            + '</div>'
            + '<div id="wish-pity" class="wish-pity"></div>'
            + '<div id="wish-list"><div class="loading">加载中…</div></div>'
            + '<div id="wish-pager" class="pager"></div>';

        $('#wish-add').addEventListener('click', function () {
            guard(function () {
                return openEditor('wishes', null);
            });
        });

        $('#wish-ocr').addEventListener('click', function () {
            guard(function () {
                return openOcrDialog('wishes');
            });
        });

        $('#wish-only-five').addEventListener('change', function (event) {
            state.wishOnlyFive = event.target.checked;
            state.pages.wishes = 1;
            refreshWishList();
        });

        $('#wish-select-all').addEventListener('click', function () {
            var ids = cache.wishes.map(function (item) {
                return Number(item.id);
            });
            var allSelected = ids.length > 0 && ids.every(function (id) {
                return state.wishSelected.has(id);
            });
            ids.forEach(function (id) {
                if (allSelected) {
                    state.wishSelected.delete(id);
                } else {
                    state.wishSelected.add(id);
                }
            });
            $$('.record-check', $('#wish-list')).forEach(function (cb) {
                var row = cb.closest('.record-row');
                if (row) {
                    cb.checked = state.wishSelected.has(Number(row.dataset.id));
                }
            });
            updateBatchDelBtn();
            updateSelectAllBtn();
        });

        $('#wish-batch-del').addEventListener('click', function () {
            var ids = Array.from(state.wishSelected);
            if (!ids.length) {
                return;
            }
            guard(function () {
                if (!window.confirm('确定删除选中的 ' + ids.length + ' 条抽卡记录吗？')) {
                    return Promise.resolve();
                }
                return api('/api/wishes/batch', { method: 'DELETE', body: ids }).then(function () {
                    toast('已删除 ' + ids.length + ' 条记录');
                    refreshWishList();
                });
            });
        });

        $('#wish-pool').addEventListener('change', function (event) {
            state.wishPool = event.target.value;
            state.pages.wishes = 1;
            refreshWishList();
        });

        bindWishTools();

        return refreshWishList();
    }

    function updateBatchDelBtn() {
        var btn = $('#wish-batch-del');
        if (!btn) {
            return;
        }
        var n = state.wishSelected.size;
        btn.disabled = n === 0;
        btn.textContent = n > 0 ? '批量删除（' + n + '）' : '批量删除';
    }

    function updateSelectAllBtn() {
        var btn = $('#wish-select-all');
        if (!btn) {
            return;
        }
        var ids = cache.wishes.map(function (item) {
            return Number(item.id);
        });
        var allSelected = ids.length > 0 && ids.every(function (id) {
            return state.wishSelected.has(id);
        });
        btn.disabled = ids.length === 0;
        btn.textContent = allSelected ? '取消全选' : '全选本页';
    }

    function pityStorageKey() {
        var uid = (state.user && (state.user.id || state.user.username)) || 'guest';
        return 'sg_pity_' + uid + '_' + state.game;
    }

    function loadPityOverrides() {
        var parsed = safeParse(localStorage.getItem(pityStorageKey()));
        return parsed && typeof parsed === 'object' ? parsed : {};
    }

    function savePityOverrides(map) {
        localStorage.setItem(pityStorageKey(), JSON.stringify(map));
    }

    function setPityOverride(pool, value) {
        var map = loadPityOverrides();
        if (!value) {
            delete map[pool];
        } else {
            map[pool] = { value: Number(value), at: Date.now() };
        }
        savePityOverrides(map);
    }

    function parseWishTime(value) {
        if (!value) {
            return 0;
        }
        var ms = Date.parse(String(value).trim().replace(' ', 'T'));
        return isNaN(ms) ? 0 : ms;
    }

    /* 手动已垫优先，但一旦导入 / 录入更晚的五星，自动失效并回到记录推导值 */
    function applyPityOverrides(data) {
        if (!data || !data.poolStats) {
            return data;
        }
        var latestFive = {};
        (data.fiveStarRecords || []).forEach(function (record) {
            if (Number(record.rarity) !== 5) {
                return;
            }
            var time = parseWishTime(record.wishTime);
            if (!latestFive[record.pool] || time > latestFive[record.pool]) {
                latestFive[record.pool] = time;
            }
        });
        var map = loadPityOverrides();
        var dirty = false;
        data.poolStats.forEach(function (item) {
            var override = map[item.pool];
            if (!override) {
                return;
            }
            if ((latestFive[item.pool] || 0) > (Number(override.at) || 0)) {
                delete map[item.pool];
                dirty = true;
                return;
            }
            var cap = Number(item.cap) || 90;
            var pity = Math.max(0, Math.min(cap - 1, Number(override.value) || 0));
            item.currentPity = pity;
            item.pullsToPity = Math.max(cap - pity, 0);
            item.pityManual = true;
        });
        if (dirty) {
            savePityOverrides(map);
        }
        return data;
    }

    function renderWishPity() {
        var host = $('#wish-pity');
        if (!host) {
            return;
        }
        host.innerHTML = '';
        api('/api/stats/overview').then(function (data) {
            applyPityOverrides(data);
            var g = gameConfig();
            var stats = (data && data.poolStats) || [];
            host.innerHTML = stats.map(function (item) {
                var cap = Number(item.cap) || (item.pool === g.weaponPool ? 80 : 90);
                var pity = Math.max(0, Number(item.currentPity) || 0);
                var left = Math.max(0, cap - pity);
                return '<button type="button" class="wish-pity-chip'
                    + (item.upGuaranteed ? ' guaranteed' : '')
                    + '" data-pool="' + esc(item.pool) + '" data-cap="' + cap + '" data-pity="' + pity
                    + '" title="点击手动修正已垫">'
                    + esc(item.pool) + ' 已垫 <strong>' + pity + '</strong> / ' + cap + ' 抽'
                    + ' · 距保底 ' + left + ' 抽'
                    + (item.upGuaranteed ? ' · 大保底' : '')
                    + (item.pityManual ? '<span class="wish-pity-manual">手动</span>' : '')
                    + '</button>';
            }).join('');

            host.onclick = function (event) {
                var chip = event.target.closest ? event.target.closest('.wish-pity-chip') : null;
                if (!chip) {
                    return;
                }
                var cap = Number(chip.dataset.cap) || 90;
                var pool = chip.dataset.pool;
                var input = window.prompt('输入「' + pool + '」当前已垫抽数（0–' + (cap - 1) + '，0 表示清除手动值）',
                    chip.dataset.pity);
                if (input === null) {
                    return;
                }
                var value = Math.floor(Number(input));
                if (!isFinite(value) || value < 0 || value > cap - 1) {
                    toast('已垫需在 0–' + (cap - 1) + ' 之间', 'error');
                    return;
                }
                setPityOverride(pool, value);
                renderWishPity();
                toast(value > 0 ? '已更新「' + pool + '」已垫为 ' + value + ' 抽' : '已清除「' + pool + '」手动已垫');
            };
        }).catch(function () {
            host.innerHTML = '';
        });
    }

    function refreshWishList() {
        var box = $('#wish-list');
        var pager = $('#wish-pager');
        state.wishSelected.clear();
        updateBatchDelBtn();
        updateSelectAllBtn();
        renderWishPity();
        var params = new URLSearchParams();
        params.set('page', state.pages.wishes);
        params.set('size', '10');
        if (state.wishOnlyFive) {
            params.set('rarity', '5');
        }
        if (state.wishPool) {
            params.set('pool', state.wishPool);
        }

        return api('/api/wishes?' + params.toString()).then(function (data) {
            cache.wishes = data.records || [];
            box.innerHTML = cache.wishes.length
                ? cache.wishes.map(wishRow).join('')
                : emptyHtml('暂无抽卡记录，点击右上角“录入五星”开始记录');
            pager.innerHTML = pagerHtml(data);
            pager.onclick = function (event) {
                var btn = event.target.closest('[data-page]');
                if (!btn || btn.disabled) {
                    return;
                }
                state.pages.wishes = Number(btn.dataset.page);
                refreshWishList();
            };
            box.onchange = function (event) {
                var cb = event.target.closest('[data-check]');
                if (!cb) {
                    return;
                }
                var cbRow = cb.closest('.record-row');
                if (!cbRow) {
                    return;
                }
                var cbId = Number(cbRow.dataset.id);
                if (cb.checked) {
                    state.wishSelected.add(cbId);
                } else {
                    state.wishSelected.delete(cbId);
                }
                updateBatchDelBtn();
                updateSelectAllBtn();
            };
            box.onclick = function (event) {
                var btn = event.target.closest('[data-act]');
                var row = event.target.closest('.record-row');
                if (!btn || !row) {
                    return;
                }
                var item = cache.wishes.filter(function (x) {
                    return String(x.id) === row.dataset.id;
                })[0];
                if (!item) {
                    return;
                }
                if (btn.dataset.act === 'edit') {
                    guard(function () {
                        return openEditor('wishes', item);
                    });
                } else if (btn.dataset.act === 'delete') {
                    guard(function () {
                        return removeRecord('wishes', item, item.itemName, refreshWishList);
                    });
                }
            };
            updateSelectAllBtn();
        }).catch(function (err) {
            box.innerHTML = errorHtml(err);
        });
    }

    /* ---------------- 表单配置 ---------------- */

    function formConfig(type) {
        var g = gameConfig();
        var fields = [
            {
                key: 'itemName', label: '抽到的五星', type: 'text',
                placeholder: g.itemTypes[0] + ' / ' + g.itemTypes[1] + '名称'
            },
            { key: 'rarity', type: 'hidden', default: 5 },
            { key: 'itemType', label: '类型', type: 'select', options: g.itemTypes, default: g.itemTypes[0] },
            { key: 'pool', label: '卡池', type: 'select', options: g.pools, default: g.pools[0] },
            { key: 'pityCount', label: '抽到五星用了多少抽', type: 'number', min: 1, max: 90, default: 1 },
            { key: 'isUp', label: '是否 UP', type: 'select', options: [{ value: true, label: 'UP 内' }, { value: false, label: '未中 UP' }], default: true }
        ];
        if (state.game === 'genshin') {
            fields.push({
                key: 'captureTriggered', label: '是否触发捕获明光', type: 'select',
                options: [{ value: true, label: '是' }, { value: false, label: '否' }], default: false
            });
        }
        fields.push(
            { key: 'wishTime', label: '抽卡时间', type: 'datetime', full: true, default: nowLocal() },
            { key: 'note', label: '备注', type: 'textarea', full: true }
        );
        return {
            title: '抽卡',
            endpoint: '/api/wishes',
            fields: fields
        };
    }

    function fieldHtml(field, value) {
        var current = value === undefined || value === null ? (field.default === undefined ? '' : field.default) : value;
        var wrapClass = 'field' + (field.full ? ' field-full' : '');
        var required = field.required ? ' required' : '';

        if (field.type === 'hidden') {
            return '<input type="hidden" name="' + field.key + '" value="' + esc(current) + '"/>';
        }

        if (field.type === 'select') {
            var options = (field.options || []).map(function (option) {
                return typeof option === 'object' ? option : { value: option, label: option };
            });
            return '<label class="' + wrapClass + '"><span>' + esc(field.label) + '</span>'
                + '<select name="' + field.key + '"' + required + '>'
                + options.map(function (option) {
                    var selected = String(option.value) === String(current) ? ' selected' : '';
                    return '<option value="' + esc(option.value) + '"' + selected + '>' + esc(option.label) + '</option>';
                }).join('')
                + '</select></label>';
        }

        if (field.type === 'textarea') {
            return '<label class="' + wrapClass + '"><span>' + esc(field.label) + '</span>'
                + '<textarea name="' + field.key + '" rows="2" placeholder="' + esc(field.placeholder || '') + '">'
                + esc(current) + '</textarea></label>';
        }

        var attrs = ' name="' + field.key + '" value="' + esc(current) + '"';
        if (field.type === 'datetime') {
            attrs += ' type="datetime-local"';
        } else {
            attrs += ' type="' + (field.type || 'text') + '"';
        }
        if (field.min !== undefined) {
            attrs += ' min="' + field.min + '"';
        }
        if (field.max !== undefined) {
            attrs += ' max="' + field.max + '"';
        }
        if (field.step !== undefined) {
            attrs += ' step="' + field.step + '"';
        }
        if (field.placeholder) {
            attrs += ' placeholder="' + esc(field.placeholder) + '"';
        }

        return '<label class="' + wrapClass + '"><span>' + esc(field.label) + '</span>'
            + '<input' + attrs + required + '/></label>';
    }

    function openForm(title, fields, values, options) {
        var opts = options || {};
        return new Promise(function (resolve) {
            var mask = document.createElement('div');
            mask.className = 'modal-mask';
            mask.innerHTML = '<div class="modal">'
                + '<header><h3>' + esc(title) + '</h3>'
                + '<button class="modal-close" type="button" aria-label="关闭">×</button></header>'
                + (opts.hint ? '<p class="modal-hint">' + esc(opts.hint) + '</p>' : '')
                + '<form class="modal-body">'
                + fields.map(function (field) {
                    return fieldHtml(field, values ? values[field.key] : undefined);
                }).join('')
                + '<footer class="modal-foot">'
                + '<button type="button" class="btn btn-text modal-cancel">取消</button>'
                + '<button type="submit" class="btn btn-primary">' + esc(opts.submitText || '保存') + '</button>'
                + '</footer></form></div>';

            document.body.appendChild(mask);
            document.body.style.overflow = 'hidden';

            var form = $('form', mask);

            function close(result) {
                mask.remove();
                document.body.style.overflow = '';
                resolve(result);
            }

            $('.modal-close', mask).addEventListener('click', function () {
                close(null);
            });
            $('.modal-cancel', mask).addEventListener('click', function () {
                close(null);
            });
            mask.addEventListener('click', function (event) {
                if (event.target === mask) {
                    close(null);
                }
            });
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                var values = collectValues(form, fields);
                if (opts.validate) {
                    var message = opts.validate(values);
                    if (message) {
                        toast(message, 'error');
                        return;
                    }
                }
                close(values);
            });

            var first = $('input,select,textarea', form);
            if (first) {
                first.focus();
            }
        });
    }

    function collectValues(form, fields) {
        var data = {};
        fields.forEach(function (field) {
            var el = form.querySelector('[name="' + field.key + '"]');
            if (!el) {
                return;
            }
            var value = el.value;
            if (field.type === 'number' || field.type === 'hidden') {
                data[field.key] = value === '' ? null : Number(value);
            } else if (field.type === 'select' && field.options && typeof field.options[0] === 'object') {
                var matched = field.options.filter(function (option) {
                    return String(option.value) === value;
                })[0];
                data[field.key] = matched ? matched.value : value;
            } else if (field.type === 'datetime') {
                data[field.key] = toApiTime(value);
            } else {
                data[field.key] = value.trim();
            }
        });
        return data;
    }

    function toFormValues(type, item) {
        var values = {};
        Object.keys(item).forEach(function (key) {
            values[key] = item[key];
        });
        if (type === 'wishes' && item.wishTime) {
            values.wishTime = String(item.wishTime).replace(' ', 'T').slice(0, 16);
        }
        return values;
    }

    function openEditor(type, item) {
        var config = formConfig(type);
        var isEdit = !!item;
        var values = isEdit ? toFormValues(type, item) : null;

        return openForm((isEdit ? '编辑' : '新增') + config.title, config.fields, values, {
            validate: function (data) {
                if (!data.itemName) {
                    return '请填写五星名称';
                }
                if (!data.pityCount || data.pityCount < 1 || data.pityCount > 90) {
                    return '抽到五星用了多少抽需在 1-90 之间';
                }
                return null;
            }
        }).then(function (data) {
            if (!data) {
                return null;
            }
            var path = isEdit ? config.endpoint + '/' + item.id : config.endpoint;
            return api(path, { method: isEdit ? 'PUT' : 'POST', body: data }).then(function (saved) {
                toast(isEdit ? '修改已保存' : '新增成功');
                refreshWishList();
                return saved;
            });
        });
    }

    function removeRecord(type, item, label, reload) {
        var config = formConfig(type);
        if (!window.confirm('确定删除「' + label + '」这条' + config.title + '记录吗？')) {
            return Promise.resolve();
        }
        return api(config.endpoint + '/' + item.id, { method: 'DELETE' }).then(function () {
            toast('已删除');
            reload();
        });
    }

    /* ---------------- 批量编辑本页 ---------------- */

    var BATCH_LIMIT = 10;

    function batchRowHtml(index, item) {
        var rarity = item && item.rarity ? Number(item.rarity) : 5;
        var name = item && item.itemName ? item.itemName : '';
        var up = item ? !!item.isUp : false;
        var pity = item && item.pityCount ? item.pityCount : 1;
        var time = item && item.wishTime ? String(item.wishTime).replace(' ', 'T').slice(0, 16) : '';

        return '<div class="batch-row has-time" data-index="' + index + '">'
            + '<span class="batch-no">' + (index + 1) + '</span>'
            + '<span class="batch-stars">' + starText(rarity) + '</span>'
            + '<input class="batch-name" type="text" maxlength="64" value="' + esc(name) + '"'
            + ' placeholder="角色 / 武器名称"/>'
            + '<label class="batch-up"><input class="batch-isup" type="checkbox"' + (up ? ' checked' : '') + '/>UP</label>'
            + '<input class="batch-pity" type="number" min="1" max="90" value="' + esc(pity) + '" title="用了多少抽"/>'
            + '<input class="batch-time" type="datetime-local" value="' + esc(time) + '"/>'
            + '</div>';
    }

    function openBatchEditor() {
        var items = cache.wishes.slice(0, BATCH_LIMIT);
        if (!items.length) {
            toast('当前页没有可编辑的记录', 'error');
            return Promise.resolve(null);
        }

        return new Promise(function (resolve) {
            var mask = document.createElement('div');
            mask.className = 'modal-mask';

            var rows = [];
            for (var i = 0; i < items.length; i++) {
                rows.push(batchRowHtml(i, items[i]));
            }

            mask.innerHTML = '<div class="modal modal-wide">'
                + '<header><h3>批量编辑本页</h3>'
                + '<button class="modal-close" type="button" aria-label="关闭">×</button></header>'
                + '<p class="modal-hint">一次修改当前页的记录，每条时间可单独调整；星级、卡池与类型保持不变。</p>'
                + '<form class="modal-body batch-body">'
                + '<div class="batch-rows">' + rows.join('') + '</div>'
                + '<footer class="modal-foot">'
                + '<button type="button" class="btn btn-text modal-cancel">取消</button>'
                + '<button type="submit" class="btn btn-primary">保存修改</button>'
                + '</footer></form></div>';

            document.body.appendChild(mask);
            document.body.style.overflow = 'hidden';

            var form = $('form', mask);

            function close(result) {
                mask.remove();
                document.body.style.overflow = '';
                resolve(result);
            }

            $('.modal-close', mask).addEventListener('click', function () {
                close(null);
            });
            $('.modal-cancel', mask).addEventListener('click', function () {
                close(null);
            });
            mask.addEventListener('click', function (event) {
                if (event.target === mask) {
                    close(null);
                }
            });

            form.addEventListener('submit', function (event) {
                event.preventDefault();
                var records;
                try {
                    records = collectBatchRecords(mask, items);
                } catch (err) {
                    toast(err.message || '请检查填写内容', 'error');
                    return;
                }
                close(records);
            });
        });
    }

    function collectBatchRecords(mask, items) {
        var records = [];
        $$('.batch-row', mask).forEach(function (row, index) {
            var original = items[index];
            var name = $('.batch-name', row).value.trim();
            if (!name) {
                throw new Error('第 ' + (index + 1) + ' 行请填写名称');
            }
            records.push({
                id: original.id,
                itemName: name,
                rarity: original.rarity,
                itemType: original.itemType,
                pool: original.pool,
                isUp: $('.batch-isup', row).checked,
                pityCount: Number($('.batch-pity', row).value) || 1,
                wishTime: toApiTime($('.batch-time', row).value) || original.wishTime
            });
        });
        return records;
    }

    function submitBatchEditor() {
        return openBatchEditor().then(function (records) {
            if (!records) {
                return null;
            }
            return api('/api/wishes/batch', { method: 'PUT', body: { records: records } })
                .then(function (saved) {
                    toast('已保存 ' + records.length + ' 条修改');
                    refreshWishList();
                    return saved;
                });
        });
    }

    /* ---------------- 抽卡记录导入导出 ---------------- */

    function bindWishTools() {
        $('#wish-batch-edit').addEventListener('click', function () {
            guard(function () {
                return submitBatchEditor();
            });
        });

        $('#wish-export-csv').addEventListener('click', function () {
            guard(function () {
                return downloadFile('/api/wishes/export?format=csv',
                    'southair-wishes.csv', '抽卡记录已导出（CSV）');
            });
        });

        $('#wish-export-json').addEventListener('click', function () {
            guard(function () {
                return downloadFile('/api/wishes/export?format=json',
                    'southair-wishes.json', '抽卡记录已导出（JSON）');
            });
        });

        $('#wish-import').addEventListener('click', function () {
            guard(function () {
                return chooseImport('wishes', 'wish-file', state.game);
            });
        });

        $('#wish-template').addEventListener('click', function () {
            guard(function () {
                return chooseTemplate('wishes', state.game);
            });
        });

        $('#wish-link-import').addEventListener('click', function () {
            guard(importFromLink);
        });

        $('#wish-file').addEventListener('change', onWishFileSelected);
    }

    /* 抽卡链接导入：后端代理读取米游社接口，避开浏览器跨域限制 */
    function importFromLink() {
        var g = gameConfig();
        return openForm('从抽卡链接导入 · ' + g.fullName, [
            {
                key: 'url',
                label: '抽卡记录链接',
                type: 'textarea',
                full: true,
                placeholder: '粘贴抽卡记录网页链接或 getGachaLog 接口链接'
            }
        ], null, {
            hint: '游戏内打开「抽卡记录 > 历史记录」复制链接即可，网页链接与接口链接都支持，有效期约 24 小时，'
                + '链接含账号凭证请勿分享。五星歪没歪会自动判定：'
                + '角色活动池按常驻名单（崩铁还包含星缘相邀可选名单）判歪，其它五星算 UP。',
            submitText: '读取并导入',
            validate: function (values) {
                var url = values.url || '';
                var hostOk = /^https:\/\/(public-operation-(hk4e|hkrpg)|webstatic(-sea)?)\.(mihoyo|hoyoverse)\.com/.test(url);
                if (!hostOk || url.indexOf('authkey=') < 0) {
                    return '请粘贴完整的米游社抽卡记录链接';
                }
                return null;
            }
        }).then(function (values) {
            if (!values) {
                return null;
            }
            toast('正在读取抽卡记录…');
            return api('/api/wishes/import-url?mode=merge', {
                method: 'POST',
                body: { url: values.url }
            }).then(function (result) {
                toast('读取完成：新增 ' + result.imported + ' 条'
                    + (result.skipped ? '，跳过重复 ' + result.skipped + ' 条' : '')
                    + (result.filtered ? '，忽略 ' + result.filtered + ' 条' : ''));
                refreshWishList();
                return result;
            });
        });
    }

    function onWishFileSelected(event, game) {
        var file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        if (!/\.(csv|json)$/i.test(file.name)) {
            toast('仅支持 .csv 或 .json 文件', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast('文件不能超过 5MB', 'error');
            return;
        }
        var format = /\.json$/i.test(file.name) ? 'json' : 'csv';
        var reader = new FileReader();
        reader.onload = function () {
            guard(function () {
                return importWishes(file.name, format, String(reader.result || ''), game);
            });
        };
        reader.onerror = function () {
            toast('读取文件失败', 'error');
        };
        reader.readAsText(file, 'utf-8');
    }

    function importWishes(fileName, format, text, game) {
        var g = GAMES[game || state.game] || gameConfig();
        return openForm('导入抽卡记录 · ' + g.fullName, [
            {
                key: 'mode',
                label: '导入方式',
                type: 'select',
                full: true,
                options: [
                    { value: 'merge', label: '合并：保留现有记录，自动跳过重复' },
                    { value: 'replace', label: '覆盖：先清空当前账号的抽卡记录' }
                ],
                default: 'merge'
            }
        ], null, {
            hint: '文件：' + fileName + ' · ' + format.toUpperCase() + ' 格式',
            submitText: '开始导入'
        }).then(function (values) {
            if (!values) {
                return null;
            }
            if (values.mode === 'replace'
                && !window.confirm('覆盖导入会清空「' + g.fullName + '」的全部抽卡记录，确定继续吗？')) {
                return null;
            }
            return api('/api/wishes/import?format=' + format + '&mode=' + encodeURIComponent(values.mode), {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: text
            }, game).then(function (result) {
                toast('导入完成：新增 ' + result.imported + ' 条'
                    + (result.skipped ? '，跳过 ' + result.skipped + ' 条' : '')
                    + (result.filtered ? '，忽略 ' + result.filtered + ' 条' : ''));
                if ((game || state.game) === state.game) {
                    refreshWishList();
                }
                return result;
            });
        });
    }

    /* ---------------- 账号资源 ---------------- */

    function editResource(resource) {
        var g = gameConfig();
        return openForm('编辑账号资源 · ' + g.fullName, [
            { key: 'primogems', label: g.currency, type: 'number', min: 0, max: 999999999, step: '1', default: resource.primogems },
            { key: 'mora', label: g.credit, type: 'number', min: 0, max: 999999999, step: '1', default: resource.mora },
            { key: 'intertwinedFates', label: g.fateLimited + '（抽）', type: 'number', min: 0, max: 99999, step: '1', default: resource.intertwinedFates },
            { key: 'acquaintedFates', label: g.fateStandard + '（抽）', type: 'number', min: 0, max: 99999, step: '1', default: resource.acquaintedFates }
        ], null, {
            hint: '1 抽 = ' + resource.primogemsPerPull + ' ' + g.currency + '，保存后自动刷新可抽数与折算结果',
            submitText: '保存资源'
        }).then(function (values) {
            if (!values) {
                return null;
            }
            return api('/api/resources', { method: 'PUT', body: values }).then(function (updated) {
                toast('资源已更新');
                loadDashboard();
                return updated;
            });
        });
    }

    /* ---------------- 导入 / 导出 ---------------- */

    function openChoice(title, hint, actions) {
        return new Promise(function (resolve) {
            var mask = document.createElement('div');
            mask.className = 'modal-mask';
            mask.innerHTML = '<div class="modal choice-modal">'
                + '<header><h3>' + esc(title) + '</h3>'
                + '<button class="modal-close" type="button" aria-label="关闭">×</button></header>'
                + (hint ? '<p class="modal-hint">' + esc(hint) + '</p>' : '')
                + '<div class="modal-body"><div class="choice-actions">'
                + actions.map(function (action) {
                    return '<button type="button" class="btn '
                        + (action.primary ? 'btn-primary' : 'btn-outline')
                        + '" data-choice="' + esc(action.key) + '">' + esc(action.label) + '</button>';
                }).join('')
                + '</div></div>'
                + '<footer class="modal-foot">'
                + '<button type="button" class="btn btn-text modal-cancel">取消</button>'
                + '</footer></div>';

            document.body.appendChild(mask);
            document.body.style.overflow = 'hidden';

            function close(result) {
                mask.remove();
                document.body.style.overflow = '';
                resolve(result);
            }

            $('.modal-close', mask).addEventListener('click', function () {
                close(null);
            });
            $('.modal-cancel', mask).addEventListener('click', function () {
                close(null);
            });
            mask.addEventListener('click', function (event) {
                if (event.target === mask) {
                    close(null);
                }
            });
            $('.choice-actions', mask).addEventListener('click', function (event) {
                var btn = event.target.closest('[data-choice]');
                if (btn) {
                    close(btn.dataset.choice);
                }
            });
        });
    }

    /** 点击导入时先让用户选择：下载模板（CSV / JSON）或直接导入。 */
    function chooseImport(kind, fileInputId, game) {
        var g = GAMES[game || state.game] || gameConfig();
        var isWish = kind === 'wishes';
        return openChoice(
            (isWish ? '导入抽卡记录' : '导入账号资源') + ' · ' + g.fullName,
            isWish
                ? '可以先下载模板，按列名填好后再导入；模板里的示例行是三星物品，导入时会被自动忽略。'
                : '可以先下载模板，填入数值后再导入；空着的单元格不会改动现有资源。',
            [
                { key: 'csv', label: '下载 CSV 模板' },
                { key: 'json', label: '下载 JSON 模板' },
                { key: 'import', label: '直接导入', primary: true }
            ]
        ).then(function (choice) {
            if (!choice) {
                return null;
            }
            var work = choice === 'import'
                ? Promise.resolve()
                : downloadFile((isWish ? '/api/wishes/template' : '/api/resources/template')
                    + '?format=' + choice,
                'southair-' + (isWish ? 'wishes' : 'resources') + '-template.' + choice,
                '模板已下载，填写后再导入', game);
            return work.then(function () {
                var input = document.getElementById(fileInputId);
                if (input) {
                    input.click();
                }
            });
        });
    }

    /** 只下载模板，不触发文件选择。 */
    function chooseTemplate(kind, game) {
        var isWish = kind === 'wishes';
        return openChoice(
            (isWish ? '抽卡记录导入模板' : '账号资源导入模板'),
            isWish
                ? 'CSV 为表头 + 一条三星示例行，JSON 为一条示例记录；示例数据导入时会被忽略。'
                : 'CSV 只有表头，JSON 字段为空；填入数值后再使用「导入」。',
            [
                { key: 'csv', label: '下载 CSV 模板' },
                { key: 'json', label: '下载 JSON 模板', primary: true }
            ]
        ).then(function (choice) {
            if (!choice) {
                return null;
            }
            return downloadFile((isWish ? '/api/wishes/template' : '/api/resources/template')
                + '?format=' + choice,
            'southair-' + (isWish ? 'wishes' : 'resources') + '-template.' + choice,
            '模板已下载', game);
        });
    }

    function bindResourcePanel() {
        var csvBtn = $('#resource-export-csv');
        var jsonBtn = $('#resource-export-json');
        var templateBtn = $('#resource-template');
        var importBtn = $('#resource-import');
        var fileInput = $('#resource-file');
        if (!csvBtn || !jsonBtn || !importBtn || !fileInput) {
            return;
        }

        csvBtn.addEventListener('click', function () {
            guard(function () {
                return downloadFile('/api/resources/export?format=csv',
                    'southair-resources.csv', '资源已导出（CSV）');
            });
        });
        jsonBtn.addEventListener('click', function () {
            guard(function () {
                return downloadFile('/api/resources/export?format=json',
                    'southair-resources.json', '资源已导出（JSON）');
            });
        });
        if (templateBtn) {
            templateBtn.addEventListener('click', function () {
                guard(function () {
                    return chooseTemplate('resources', state.game);
                });
            });
        }
        importBtn.addEventListener('click', function () {
            guard(function () {
                return chooseImport('resources', 'resource-file', state.game);
            });
        });
        fileInput.addEventListener('change', function (event) {
            onResourceFileSelected(event, state.game);
        });
    }

    function onResourceFileSelected(event, game) {
        var file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        if (!/\.(csv|json)$/i.test(file.name)) {
            toast('仅支持 .csv 或 .json 文件', 'error');
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            toast('文件不能超过 5MB', 'error');
            return;
        }
        var format = /\.json$/i.test(file.name) ? 'json' : 'csv';
        var reader = new FileReader();
        reader.onload = function () {
            guard(function () {
                return importResource(file.name, format, String(reader.result || ''), game);
            });
        };
        reader.onerror = function () {
            toast('读取文件失败', 'error');
        };
        reader.readAsText(file, 'utf-8');
    }

    function importResource(fileName, format, text, game) {
        var g = GAMES[game || state.game] || gameConfig();
        if (!window.confirm('导入会覆盖「' + g.fullName + '」中已填写的资源数值，确定继续吗？')) {
            return Promise.resolve(null);
        }
        return api('/api/resources/import?format=' + format, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: text
        }, game).then(function (resource) {
            toast('资源已导入：' + g.currency + ' ' + fmt(resource.primogems)
                + ' · ' + g.credit + ' ' + fmt(resource.mora));
            if ((game || state.game) === state.game) {
                switchView(state.view);
            }
            return resource;
        });
    }

    function downloadFile(path, fallbackName, successMessage, game) {
        return fetch(withGame(path, game), {
            headers: state.token ? { Authorization: 'Bearer ' + state.token } : {}
        }).then(function (res) {
            if (res.status === 401) {
                logout(true);
                throw new Error('登录已失效，请重新登录');
            }
            if (!res.ok) {
                return res.text().then(function (text) {
                    var payload = safeParse(text);
                    throw new Error((payload && payload.message) || '导出失败');
                });
            }

            var filename = fallbackName;
            var disposition = res.headers.get('Content-Disposition') || '';
            var matched = disposition.match(/filename="?([^";]+)"?/);
            if (matched && matched[1]) {
                filename = matched[1];
            }

            return res.blob().then(function (blob) {
                var url = URL.createObjectURL(blob);
                var link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                link.remove();
                setTimeout(function () {
                    URL.revokeObjectURL(url);
                }, 1500);
                toast(successMessage);
            });
        });
    }

    function importAllBackup(data) {
        var games = data.games || {};
        var counts = [];
        ['genshin', 'starrail'].forEach(function (key) {
            var item = games[key];
            if (!item) {
                return;
            }
            counts.push(GAMES[key].fullName + ' 抽卡 ' + ((item.wishes || []).length) + ' 条'
                + (item.resource ? ' + 资源' : ''));
        });

        return openForm('导入全部数据', [
            {
                key: 'mode',
                label: '导入方式',
                type: 'select',
                full: true,
                options: [
                    { value: 'merge', label: '合并：保留现有数据，自动跳过重复' },
                    { value: 'replace', label: '覆盖：先清空两个游戏的抽卡记录' }
                ],
                default: 'merge'
            }
        ], null, {
            hint: '备份文件包含：' + (counts.join('；') || '未识别到游戏数据'),
            submitText: '开始导入'
        }).then(function (values) {
            if (!values) {
                return null;
            }
            if (values.mode === 'replace'
                && !window.confirm('覆盖导入会清空两个游戏的全部抽卡记录，确定继续吗？')) {
                return null;
            }
            return api('/api/backup/import-all?mode=' + encodeURIComponent(values.mode), {
                method: 'POST',
                body: data
            }).then(function (result) {
                toast('全部数据导入完成：抽卡 ' + result.wishes + ' 条'
                    + (result.resourceUpdated ? '，资源已更新' : '')
                    + (result.skipped ? '，跳过 ' + result.skipped + ' 条' : ''));
                switchView('settings');
                return result;
            });
        });
    }

    function onAllBackupFileSelected(event) {
        var file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        if (!/\.json$/i.test(file.name)) {
            toast('全量备份仅支持 .json 文件', 'error');
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            toast('备份文件不能超过 20MB', 'error');
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            var data = safeParse(String(reader.result));
            if (!data || typeof data !== 'object' || !data.games) {
                toast('这不是 SouthAir Genshin 的全量备份文件', 'error');
                return;
            }
            guard(function () {
                return importAllBackup(data);
            });
        };
        reader.onerror = function () {
            toast('读取文件失败', 'error');
        };
        reader.readAsText(file, 'utf-8');
    }

    /* ---------------- 设置 ---------------- */

    function gameDataPanelHtml(game) {
        var g = GAMES[game];
        return '<section class="panel">'
            + '<h3>' + esc(g.fullName) + '</h3>'
            + '<p class="panel-desc">抽卡记录与账号资源分开导入导出。</p>'
            + '<div class="settings-group">'
            + '<span class="settings-label">抽卡记录</span>'
            + '<div class="panel-actions">'
            + '<button class="btn btn-outline btn-sm" type="button" data-sg="wish-export" data-game="'
            + game + '" data-format="csv">导出 CSV</button>'
            + '<button class="btn btn-outline btn-sm" type="button" data-sg="wish-export" data-game="'
            + game + '" data-format="json">导出 JSON</button>'
            + '<button class="btn btn-text btn-sm" type="button" data-sg="template" data-kind="wishes" data-game="'
            + game + '">下载模板</button>'
            + '<button class="btn btn-outline btn-sm" type="button" data-sg="wish-import" data-game="'
            + game + '">导入记录</button>'
            + '<input id="sg-wish-file-' + game + '" class="sg-file" type="file" '
            + 'accept=".csv,.json,text/csv,application/json" data-sg-file="wish" data-game="' + game + '" hidden/>'
            + '</div></div>'
            + '<div class="settings-group">'
            + '<span class="settings-label">账号资源</span>'
            + '<div class="panel-actions">'
            + '<button class="btn btn-outline btn-sm" type="button" data-sg="resource-export" data-game="'
            + game + '" data-format="csv">导出 CSV</button>'
            + '<button class="btn btn-outline btn-sm" type="button" data-sg="resource-export" data-game="'
            + game + '" data-format="json">导出 JSON</button>'
            + '<button class="btn btn-text btn-sm" type="button" data-sg="template" data-kind="resources" data-game="'
            + game + '">下载模板</button>'
            + '<button class="btn btn-outline btn-sm" type="button" data-sg="resource-import" data-game="'
            + game + '">导入资源</button>'
            + '<input id="sg-resource-file-' + game + '" class="sg-file" type="file" '
            + 'accept=".csv,.json,text/csv,application/json" data-sg-file="resource" data-game="' + game + '" hidden/>'
            + '</div></div>'
            + '</section>';
    }

    /* ---------------- 收藏图鉴 ---------------- */

    function ownedStorageKey() {
        var uid = (state.user && (state.user.id || state.user.username)) || 'guest';
        return 'sg_owned_' + uid + '_' + state.game;
    }

    function loadOwnedData() {
        var raw = safeParse(localStorage.getItem(ownedStorageKey())) || {};
        return {
            characters4: raw.characters4 || {},
            characters5: raw.characters5 || {},
            weapons5: raw.weapons5 || {}
        };
    }

    function saveOwnedData(data) {
        localStorage.setItem(ownedStorageKey(), JSON.stringify(data));
    }

    function collectionDefs(g) {
        return [
            { key: 'characters4', title: '四星角色', kind: 'character', rarity: 4 },
            { key: 'characters5', title: '五星角色', kind: 'character', rarity: 5 },
            { key: 'weapons5', title: g.itemTypes[1] === '光锥' ? '五星光锥' : '五星武器',
                kind: 'weapon', rarity: 5 }
        ];
    }

    function collectionSectionOf(item, defs) {
        if (Number(item.rarity) === 5 && item.itemType !== '角色') {
            return 'weapons5';
        }
        if (item.itemType === '角色' && Number(item.rarity) === 4) {
            return 'characters4';
        }
        if (item.itemType === '角色' && Number(item.rarity) === 5) {
            return 'characters5';
        }
        return '';
    }

    function collectionCardHtml(game, sectionKey, kind, name, copies, manual, iconMap) {
        var icon = iconMap[name] || '';
        var badge;
        var sub;
        if (kind === 'character') {
            badge = 'C' + Math.min(6, Math.max(0, copies - 1));
            sub = '共 ' + copies + ' 份';
        } else {
            badge = 'R' + Math.min(5, Math.max(1, copies));
            sub = '共 ' + copies + ' 把';
        }
        return '<div class="collection-card">'
            + '<div class="collection-icon"><span>' + esc(name.charAt(0)) + '</span>'
            + (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" onerror="this.remove()">' : '')
            + '</div>'
            + '<div class="collection-name" title="' + esc(name) + '">' + esc(name) + '</div>'
            + '<div class="collection-meta"><span class="collection-rank">' + badge + '</span>'
            + '<span>' + sub + '</span></div>'
            + (manual > 0
                ? '<button class="collection-remove" type="button" data-section="' + esc(sectionKey)
                    + '" data-name="' + esc(name) + '">手动 +' + manual + ' · 清除</button>'
                : '')
            + '</div>';
    }

    function collectionSectionsHtml(game, items, owned, g) {
        var defs = collectionDefs(g);
        var avatarMap = (window.SG_AVATARS || {})[game] || {};
        var weaponMap = (window.SG_WEAPON_ICONS || {})[game] || {};
        var sections = {};
        defs.forEach(function (def) {
            sections[def.key] = [];
        });

        items.forEach(function (item) {
            var key = collectionSectionOf(item, defs);
            if (!key) {
                return;
            }
            var name = String(item.itemName || '').trim();
            if (!name) {
                return;
            }
            sections[key].push({
                name: name,
                count: Number(item.count) || 0,
                manual: 0
            });
        });

        defs.forEach(function (def) {
            var manualMap = owned[def.key] || {};
            Object.keys(manualMap).forEach(function (name) {
                var copies = Math.floor(Number(manualMap[name]) || 0);
                if (copies <= 0) {
                    return;
                }
                var existing = sections[def.key].filter(function (entry) {
                    return entry.name === name;
                })[0];
                if (existing) {
                    existing.manual = copies;
                } else {
                    sections[def.key].push({ name: name, count: 0, manual: copies });
                }
            });
            sections[def.key].sort(function (a, b) {
                var totalA = a.count + a.manual;
                var totalB = b.count + b.manual;
                if (totalA !== totalB) {
                    return totalB - totalA;
                }
                return a.name.localeCompare(b.name, 'zh-CN');
            });
        });

        return defs.map(function (def) {
            var iconMap = def.kind === 'character' ? avatarMap : weaponMap;
            var cards = sections[def.key].map(function (entry) {
                var copies = entry.count + entry.manual;
                return collectionCardHtml(game, def.key, def.kind, entry.name, copies,
                    entry.manual, iconMap);
            }).join('');
            return '<section class="panel collection-panel">'
                + '<h3>' + esc(def.title) + '<span class="pool-tag">' + sections[def.key].length + '</span></h3>'
                + (cards
                    ? '<div class="collection-grid">' + cards + '</div>'
                    : emptyHtml('还没有' + def.title))
                + '</section>';
        }).join('');
    }

    function openOwnedForm() {
        var g = gameConfig();
        return openForm('补充已有 · ' + g.fullName, [
            {
                key: 'category',
                label: '类别',
                type: 'select',
                full: true,
                options: [
                    { value: 'characters4', label: '四星角色' },
                    { value: 'characters5', label: '五星角色' },
                    { value: 'weapons5', label: '五星' + (g.itemTypes[1] === '光锥' ? '光锥' : '武器') }
                ]
            },
            {
                key: 'name',
                label: '名称',
                full: true,
                placeholder: '输入角色 / 武器名称'
            },
            {
                key: 'copies',
                label: '额外数量',
                type: 'number',
                full: true,
                placeholder: '1–6'
            }
        ], null, {
            hint: '额外数量会叠加到抽卡记录统计；角色按命座展示（最高 C6），武器按精炼展示（最高 R5）。',
            submitText: '保存',
            validate: function (values) {
                if (!String(values.name || '').trim()) {
                    return '请输入名称';
                }
                var copies = Number(values.copies);
                if (!isFinite(copies) || copies < 1 || copies > 6) {
                    return '额外数量需在 1–6 之间';
                }
                return null;
            }
        }).then(function (values) {
            if (!values) {
                return null;
            }
            var owned = loadOwnedData();
            var name = String(values.name || '').trim();
            var copies = Math.floor(Number(values.copies) || 0);
            owned[values.category][name] = (Number(owned[values.category][name]) || 0) + copies;
            saveOwnedData(owned);
            toast('已补充 ' + name + ' ×' + copies);
            loadCollection();
            return null;
        });
    }

    function loadCollection() {
        var el = $('#view-collection');
        var game = state.game;
        var g = gameConfig();
        el.innerHTML = '<div class="loading">加载中…</div>';
        return api('/api/wishes/collection').then(function (items) {
            var owned = loadOwnedData();
            el.innerHTML =
                '<div class="page-head">'
                + '<div><h2>收藏图鉴</h2>'
                + '<p class="sub">四星角色 · 五星角色 · 五星' + (g.itemTypes[1] === '光锥' ? '光锥' : '武器')
                + ' · 角色最高 C6，武器最高 R5</p></div>'
                + '<div class="head-actions">'
                + '<button class="btn btn-primary" id="collection-add" type="button">+ 补充已有</button>'
                + '</div></div>'
                + collectionSectionsHtml(game, items || [], owned, g)
                + '<p class="foot-tip">手动补充保存在本机浏览器，不写入账号备份；抽卡记录会随导入自动更新。</p>';

            $('#collection-add').addEventListener('click', function () {
                guard(openOwnedForm);
            });

            $$('.collection-remove', el).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var section = btn.dataset.section;
                    var name = btn.dataset.name;
                    if (!window.confirm('清除「' + name + '」的手动补充？')) {
                        return;
                    }
                    var data = loadOwnedData();
                    if (data[section]) {
                        delete data[section][name];
                    }
                    saveOwnedData(data);
                    toast('已清除 ' + name + ' 的手动补充');
                    loadCollection();
                });
            });
        }).catch(function (err) {
            el.innerHTML = errorHtml(err);
        });
    }


    function loadSettings() {
        var el = $('#view-settings');
        var name = (state.user && (state.user.nickname || state.user.username)) || '旅行者';
        var username = (state.user && state.user.username) || '';
        el.innerHTML =
            '<div class="page-head">'
            + '<div><h2>设置</h2><p class="sub">数据备份与导入导出 · 换设备、长期备份从这里开始</p></div>'
            + '</div>'

            + '<section class="panel">'
            + '<h3>全量备份 · 换设备</h3>'
            + '<p class="panel-desc">把原神与星穹铁道的全部抽卡记录、账号资源打包成一个 JSON 文件；'
            + '在新设备登录后导入即可恢复全部数据。</p>'
            + '<div class="panel-actions">'
            + '<button class="btn btn-primary" id="settings-export-all" type="button">导出全部数据</button>'
            + '<button class="btn btn-outline" id="settings-import-all" type="button">导入全部数据</button>'
            + '<input id="settings-all-file" type="file" accept=".json,application/json" hidden/>'
            + '</div>'
            + '</section>'

            + '<div class="panel-grid">'
            + gameDataPanelHtml('genshin')
            + gameDataPanelHtml('starrail')
            + '</div>'

            + '<section class="panel">'
            + '<h3>用户名</h3>'
            + '<p class="panel-desc">用户名只用于页面顶部显示，与登录账号、密码分开管理，修改后不影响登录。</p>'
            + '<div class="profile-fields">'
            + '<label class="field"><span>登录账号</span>'
            + '<input id="profile-username" type="text" value="' + esc(username) + '" readonly/></label>'
            + '<label class="field"><span>用户名</span>'
            + '<input id="profile-nickname" type="text" maxlength="32" value="' + esc(name) + '"/></label>'
            + '</div>'
            + '<div class="panel-actions">'
            + '<button class="btn btn-primary" id="profile-save" type="button">保存用户名</button>'
            + '</div>'
            + '</section>';

        bindSettings();
    }

    function bindSettings() {
        var el = $('#view-settings');
        var exportAllBtn = $('#settings-export-all');
        var importAllBtn = $('#settings-import-all');
        var allFile = $('#settings-all-file');
        if (!el || !exportAllBtn || !importAllBtn || !allFile) {
            return;
        }

        exportAllBtn.addEventListener('click', function () {
            guard(function () {
                return downloadFile('/api/backup/export-all',
                    'southair-all-backup.json', '全部数据已导出');
            });
        });
        importAllBtn.addEventListener('click', function () {
            allFile.click();
        });
        allFile.addEventListener('change', onAllBackupFileSelected);

        var profileSave = $('#profile-save');
        if (profileSave) {
            profileSave.addEventListener('click', function () {
                guard(saveProfile);
            });
        }
        var nicknameInput = $('#profile-nickname');
        if (nicknameInput) {
            nicknameInput.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    guard(saveProfile);
                }
            });
        }

        el.addEventListener('click', function (event) {
            var btn = event.target.closest('[data-sg]');
            if (!btn) {
                return;
            }
            var game = btn.dataset.game;
            var action = btn.dataset.sg;
            var format = btn.dataset.format || 'csv';
            if (action === 'wish-export') {
                guard(function () {
                    return downloadFile('/api/wishes/export?format=' + format,
                        'southair-wishes.' + format, '抽卡记录已导出（' + format.toUpperCase() + '）', game);
                });
            } else if (action === 'wish-import') {
                guard(function () {
                    return chooseImport('wishes', 'sg-wish-file-' + game, game);
                });
            } else if (action === 'resource-export') {
                guard(function () {
                    return downloadFile('/api/resources/export?format=' + format,
                        'southair-resources.' + format, '资源已导出（' + format.toUpperCase() + '）', game);
                });
            } else if (action === 'resource-import') {
                guard(function () {
                    return chooseImport('resources', 'sg-resource-file-' + game, game);
                });
            } else if (action === 'template') {
                guard(function () {
                    return chooseTemplate(btn.dataset.kind, game);
                });
            }
        });

        el.addEventListener('change', function (event) {
            var input = event.target;
            if (!input.classList || !input.classList.contains('sg-file')) {
                return;
            }
            if (input.dataset.sgFile === 'wish') {
                onWishFileSelected(event, input.dataset.game);
            } else {
                onResourceFileSelected(event, input.dataset.game);
            }
        });
    }

    /** 修改用户名（昵称）：登录账号与密码保持不变。 */
    function saveProfile() {
        var input = $('#profile-nickname');
        var nickname = input ? input.value.trim() : '';
        if (!nickname) {
            toast('用户名不能为空', 'error');
            return null;
        }
        if (nickname === ((state.user && state.user.nickname) || '')) {
            toast('用户名没有变化');
            return null;
        }
        return api('/api/auth/profile', { method: 'PUT', body: { nickname: nickname } })
            .then(function (user) {
                state.user = user;
                localStorage.setItem(USER_KEY, JSON.stringify(user));
                var label = $('#user-name');
                if (label) {
                    label.textContent = user.nickname || user.username;
                }
                toast('用户名已更新');
                switchView('settings');
                return user;
            });
    }

    /* ---------------- 截图识别 ---------------- */

    var OCR_ENGINE_KEY = 'sg_ocr_engine';
    var TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/dist/tesseract.min.js';
    var tesseractLoading = null;

    /** 带图片上传的请求：不能设置 Content-Type，交给浏览器生成 boundary */
    function apiUpload(path, formData) {
        var headers = {};
        if (state.token) {
            headers.Authorization = 'Bearer ' + state.token;
        }
        return fetch(withGame(path), { method: 'POST', headers: headers, body: formData })
            .then(function (res) {
                return res.text().then(function (text) {
                    var payload = safeParse(text);
                    if (res.status === 401) {
                        logout(true);
                        throw new Error((payload && payload.message) || '登录已失效，请重新登录');
                    }
                    if (!res.ok) {
                        throw new Error((payload && payload.message) || ('请求失败（' + res.status + '）'));
                    }
                    if (payload && payload.code !== 0) {
                        throw new Error(payload.message || '请求失败');
                    }
                    return payload ? payload.data : null;
                });
            });
    }

    function engineOptions(status) {
        var list = [];
        list.push({
            key: 'tesseract',
            label: '本地 Tesseract',
            note: status.tesseractAvailable ? '已安装' : '未安装',
            enabled: status.tesseractAvailable,
            hint: status.tesseractAvailable ? '离线识别，数字识别较稳' : (status.tesseractHint || '本机未安装 tesseract')
        });
        list.push({
            key: 'browser',
            label: '浏览器 OCR',
            note: 'tesseract.js',
            enabled: true,
            hint: '首次需下载约 10-15MB 模型，速度较慢'
        });
        return list;
    }

    function loadTesseract() {
        if (window.Tesseract) {
            return Promise.resolve(window.Tesseract);
        }
        if (tesseractLoading) {
            return tesseractLoading;
        }
        tesseractLoading = new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = TESSERACT_SRC;
            script.async = true;
            script.onload = function () {
                window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR 脚本加载异常'));
            };
            script.onerror = function () {
                tesseractLoading = null;
                reject(new Error('无法加载浏览器 OCR（请检查网络或使用其它引擎）'));
            };
            document.head.appendChild(script);
        });
        return tesseractLoading;
    }

    function runBrowserOcr(kind, file, onStatus) {
        return loadTesseract().then(function (Tesseract) {
            return Tesseract.recognize(file, 'chi_sim+eng', {
                logger: function (m) {
                    if (!onStatus) {
                        return;
                    }
                    if (m.status === 'recognizing text') {
                        onStatus('浏览器识别中 ' + Math.round((m.progress || 0) * 100) + '%');
                    } else if (m.status) {
                        onStatus('准备模型：' + m.status);
                    }
                }
            }).then(function (res) {
                var text = res && res.data ? res.data.text : '';
                return api('/api/ocr/parse', { method: 'POST', body: { kind: kind, text: text } });
            });
        });
    }

    function ocrWarningsHtml(warnings) {
        if (!warnings || !warnings.length) {
            return '';
        }
        return '<div class="ocr-warn">' + warnings.map(function (item) {
            return '<p>· ' + esc(item) + '</p>';
        }).join('') + '</div>';
    }

    function ocrRawHtml(rawText) {
        if (!rawText) {
            return '';
        }
        return '<details class="ocr-raw"><summary>查看识别原文</summary>'
            + '<pre>' + esc(rawText) + '</pre></details>';
    }

    function localTimeValue(text) {
        if (!text) {
            return '';
        }
        return String(text).replace(' ', 'T').slice(0, 16);
    }

    /** 大图先在本地缩放/压缩，避免超过 8MB 上限或上传过慢 */
    function compressOcrImage(file) {
        var LIMIT = 8 * 1024 * 1024;
        var MAX_SIDE = 2000;
        return new Promise(function (resolve) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                URL.revokeObjectURL(url);
                var side = Math.max(img.width, img.height);
                var scale = Math.min(1, MAX_SIDE / side);
                if (scale === 1 && file.size <= LIMIT) {
                    resolve(file);
                    return;
                }
                var canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(function (blob) {
                    if (!blob) {
                        resolve(file);
                        return;
                    }
                    var out = new File([blob], 'ocr.jpg', { type: 'image/jpeg' });
                    resolve(out.size <= LIMIT ? out : file);
                }, 'image/jpeg', 0.88);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                resolve(file);
            };
            img.src = url;
        });
    }

    function openOcrDialog(kind) {
        var g = gameConfig();
        var isResource = kind === 'resource';
        var selected = localStorage.getItem(OCR_ENGINE_KEY) || '';
        var currentFile = null;

        return new Promise(function (resolve) {
            var mask = document.createElement('div');
            mask.className = 'modal-mask';
            mask.innerHTML = '<div class="modal modal-wide ocr-modal">'
                + '<header><h3>' + (isResource ? '截图识别资源' : '截图识别抽卡')
                + '<span class="pool-tag">' + esc(g.fullName) + '</span></h3>'
                + '<button class="modal-close" type="button" aria-label="关闭">×</button></header>'
                + '<div class="modal-body ocr-body">'
                + '<p class="modal-hint">' + (isResource
                    ? '上传游戏内资源界面截图，自动识别 ' + esc(g.currency) + '、' + esc(g.credit) + '、'
                        + esc(g.fateLimited) + '、' + esc(g.fateStandard) + ' 的数量，确认后填入资源。'
                    : '上传抽卡记录截图，生成候选记录，核对名称、星级与卡池后再导入。')
                + '</p>'
                + '<div class="ocr-engines" id="ocr-engines"><span class="ocr-loading">正在检测可用引擎…</span></div>'
                + '<div class="ocr-drop" id="ocr-drop" role="button" tabindex="0">'
                + '<input id="ocr-file" type="file" accept="image/*" hidden/>'
                + '<div class="ocr-drop-hint" id="ocr-drop-hint">点击选择、拖入图片，或按 Ctrl+V 粘贴截图</div>'
                + '<img id="ocr-preview" class="ocr-preview" hidden alt="待识别截图"/>'
                + '</div>'
                + '<div class="ocr-bar">'
                + '<span class="ocr-status" id="ocr-status"></span>'
                + '<button class="btn btn-primary btn-sm" id="ocr-run" type="button" disabled>开始识别</button>'
                + '</div>'
                + '<div id="ocr-result" class="ocr-result"></div>'
                + '</div>'
                + '<footer class="modal-foot"><button type="button" class="btn btn-text modal-cancel">关闭</button></footer>'
                + '</div>';

            document.body.appendChild(mask);
            document.body.style.overflow = 'hidden';

            function close(result) {
                document.removeEventListener('paste', onPaste);
                if (previewUrl) {
                    URL.revokeObjectURL(previewUrl);
                }
                mask.remove();
                document.body.style.overflow = '';
                resolve(result);
            }

            $('.modal-close', mask).addEventListener('click', function () {
                close(false);
            });
            $('.modal-cancel', mask).addEventListener('click', function () {
                close(false);
            });
            mask.addEventListener('click', function (event) {
                if (event.target === mask) {
                    close(false);
                }
            });

            var enginesBox = $('#ocr-engines', mask);
            var drop = $('#ocr-drop', mask);
            var fileInput = $('#ocr-file', mask);
            var preview = $('#ocr-preview', mask);
            var runBtn = $('#ocr-run', mask);
            var statusEl = $('#ocr-status', mask);
            var resultBox = $('#ocr-result', mask);
            var engines = [];

            function setStatus(text, isError) {
                statusEl.textContent = text || '';
                statusEl.className = 'ocr-status' + (isError ? ' error' : '');
            }

            function renderEngines() {
                enginesBox.innerHTML = engines.map(function (engine) {
                    var active = engine.key === selected;
                    return '<button type="button" class="ocr-engine'
                        + (active ? ' active' : '') + (engine.enabled ? '' : ' disabled')
                        + '" data-engine="' + engine.key + '"' + (engine.enabled ? '' : ' disabled')
                        + ' title="' + esc(engine.hint) + '">'
                        + '<strong>' + esc(engine.label) + '</strong>'
                        + '<span>' + esc(engine.note) + '</span>'
                        + '</button>';
                }).join('');
                $$('.ocr-engine', enginesBox).forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        if (btn.disabled) {
                            return;
                        }
                        selected = btn.dataset.engine;
                        localStorage.setItem(OCR_ENGINE_KEY, selected);
                        renderEngines();
                        updateRunState();
                    });
                });
            }

            function updateRunState() {
                runBtn.disabled = !currentFile || !selected;
            }

            var previewUrl = '';

            function pickFile(file) {
                if (!file) {
                    return;
                }
                if (!/^image\//.test(file.type)) {
                    toast('请选择图片文件', 'error');
                    return;
                }
                setStatus('正在处理图片…');
                compressOcrImage(file).then(function (ready) {
                    if (ready.size > 8 * 1024 * 1024) {
                        toast('图片过大，压缩后仍超过 8MB', 'error');
                        setStatus('');
                        return;
                    }
                    currentFile = ready;
                    if (previewUrl) {
                        URL.revokeObjectURL(previewUrl);
                    }
                    previewUrl = URL.createObjectURL(ready);
                    preview.src = previewUrl;
                    preview.hidden = false;
                    $('#ocr-drop-hint', mask).hidden = true;
                    resultBox.innerHTML = '';
                    setStatus(ready === file ? '' : '图片已压缩至 ' + Math.round(ready.size / 1024) + 'KB');
                    updateRunState();
                });
            }

            function onPaste(event) {
                var items = (event.clipboardData && event.clipboardData.items) || [];
                for (var i = 0; i < items.length; i++) {
                    if (items[i].type && items[i].type.indexOf('image/') === 0) {
                        event.preventDefault();
                        pickFile(items[i].getAsFile());
                        return;
                    }
                }
            }

            document.addEventListener('paste', onPaste);

            api('/api/ocr/engines').then(function (status) {
                engines = engineOptions(status || {});
                var enabled = engines.filter(function (item) {
                    return item.enabled;
                });
                if (!selected || !enabled.some(function (item) {
                    return item.key === selected;
                })) {
                    selected = enabled.length ? enabled[0].key : '';
                }
                renderEngines();
                updateRunState();
            }).catch(function (err) {
                enginesBox.innerHTML = '<span class="ocr-loading">引擎检测失败：' + esc(err.message) + '</span>';
            });

            drop.addEventListener('click', function () {
                fileInput.click();
            });
            drop.addEventListener('keydown', function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    fileInput.click();
                }
            });
            drop.addEventListener('dragover', function (event) {
                event.preventDefault();
                drop.classList.add('dragging');
            });
            drop.addEventListener('dragleave', function () {
                drop.classList.remove('dragging');
            });
            drop.addEventListener('drop', function (event) {
                event.preventDefault();
                drop.classList.remove('dragging');
                var files = event.dataTransfer && event.dataTransfer.files;
                pickFile(files && files[0]);
            });
            fileInput.addEventListener('change', function (event) {
                var file = event.target.files && event.target.files[0];
                event.target.value = '';
                pickFile(file);
            });

            function engineLabel(key) {
                var hit = engines.filter(function (item) {
                    return item.key === key;
                })[0];
                return hit ? hit.label : key;
            }

            function runEngine(engineKey) {
                return engineKey === 'browser'
                    ? runBrowserOcr(kind, currentFile, setStatus)
                    : (function () {
                        var field = new FormData();
                        field.append('file', currentFile);
                        return apiUpload('/api/ocr/' + (isResource ? 'resource' : 'wishes')
                            + '?engine=' + encodeURIComponent(engineKey), field);
                    })();
            }

            function showResult(result) {
                if (!result) {
                    resultBox.innerHTML = ocrWarningsHtml(['没有返回识别结果']);
                    return;
                }
                if (isResource) {
                    renderOcrResource(result, resultBox, close);
                } else {
                    renderOcrWishes(result, resultBox, close);
                }
            }

            runBtn.addEventListener('click', function () {
                if (!currentFile || !selected) {
                    return;
                }
                runBtn.disabled = true;
                resultBox.innerHTML = '';
                // 当前引擎优先，失败时按顺序自动降级到其它可用引擎
                var chain = [selected].concat(engines
                    .filter(function (item) {
                        return item.enabled && item.key !== selected;
                    })
                    .map(function (item) {
                        return item.key;
                    }));
                var index = 0;

                function attempt() {
                    var engineKey = chain[index];
                    setStatus('识别中（' + engineLabel(engineKey) + '）…');
                    runEngine(engineKey).then(function (result) {
                        setStatus('识别完成 · ' + engineLabel(engineKey));
                        runBtn.disabled = false;
                        if (engineKey !== selected) {
                            selected = engineKey;
                            localStorage.setItem(OCR_ENGINE_KEY, selected);
                            renderEngines();
                        }
                        showResult(result);
                    }).catch(function (err) {
                        index += 1;
                        if (index < chain.length) {
                            setStatus('「' + engineLabel(chain[index - 1]) + '」失败，切换到 '
                                + engineLabel(chain[index]) + '…');
                            attempt();
                            return;
                        }
                        setStatus(err.message || '识别失败', true);
                        runBtn.disabled = false;
                    });
                }

                attempt();
            });
        });
    }

    function renderOcrResource(result, box, close) {
        var g = gameConfig();
        var fields = [
            { key: 'primogems', label: g.currency },
            { key: 'mora', label: g.credit },
            { key: 'intertwinedFates', label: g.fateLimited + '（抽）' },
            { key: 'acquaintedFates', label: g.fateStandard + '（抽）' }
        ];

        box.innerHTML = ocrWarningsHtml(result.warnings)
            + '<div class="ocr-fields">' + fields.map(function (field) {
                var value = result[field.key];
                return '<label class="field"><span>' + esc(field.label) + '</span>'
                    + '<input type="number" min="0" step="1" data-ocr-field="' + field.key + '" value="'
                    + (value === null || value === undefined ? '' : value) + '" placeholder="未识别"/></label>';
            }).join('') + '</div>'
            + '<div class="ocr-foot"><button class="btn btn-primary btn-sm" id="ocr-apply" type="button">'
            + '按识别结果填入</button></div>'
            + ocrRawHtml(result.rawText);

        var applyBtn = $('#ocr-apply', box);
        if (!applyBtn) {
            return;
        }
        applyBtn.addEventListener('click', function () {
            guard(function () {
                var body = {};
                var filled = 0;
                $$('[data-ocr-field]', box).forEach(function (input) {
                    var raw = input.value.trim();
                    if (raw === '') {
                        return;
                    }
                    var value = Number(raw);
                    if (!isFinite(value) || value < 0) {
                        return;
                    }
                    body[input.dataset.ocrField] = Math.floor(value);
                    filled += 1;
                });
                if (!filled) {
                    throw new Error('请至少填写或识别出一项资源');
                }
                return api('/api/resources', { method: 'PUT', body: body }).then(function () {
                    toast('资源已更新');
                    close(true);
                    loadDashboard();
                });
            });
        });
    }

    function renderOcrWishes(result, box, close) {
        var g = gameConfig();
        var candidates = (result && result.candidates) || [];
        if (!candidates.length) {
            box.innerHTML = ocrWarningsHtml(result.warnings) + ocrRawHtml(result.rawText);
            return;
        }

        box.innerHTML = ocrWarningsHtml(result.warnings)
            + '<div class="ocr-wish-head">共识别 ' + candidates.length + ' 条四星及以上记录，勾选后导入</div>'
            + '<div class="ocr-wish-list">' + candidates.map(function (item, index) {
                var poolOptions = g.pools.map(function (pool) {
                    return '<option value="' + esc(pool) + '"'
                        + (item.pool === pool ? ' selected' : '') + '>' + esc(pool) + '</option>';
                }).join('');
                return '<div class="ocr-wish-row" data-index="' + index + '">'
                    + '<input type="checkbox" class="ocr-wish-check" checked aria-label="导入该条"/>'
                    + '<div class="ocr-wish-fields">'
                    + '<input class="input" data-w="itemName" value="' + esc(item.itemName || '')
                    + '" placeholder="物品名称"/>'
                    + '<select class="input" data-w="rarity">'
                    + '<option value="5"' + (item.rarity === 5 ? ' selected' : '') + '>五星</option>'
                    + '<option value="4"' + (item.rarity === 4 ? ' selected' : '') + '>四星</option>'
                    + '</select>'
                    + '<select class="input" data-w="pool">' + poolOptions + '</select>'
                    + '<input class="input" type="number" min="1" max="90" data-w="pityCount" value="'
                    + (item.pityCount === null || item.pityCount === undefined ? '' : item.pityCount)
                    + '" placeholder="第几抽"/>'
                    + '<input class="input" type="datetime-local" data-w="wishTime" value="'
                    + localTimeValue(item.wishTime) + '"/>'
                    + '</div></div>';
            }).join('') + '</div>'
            + '<div class="ocr-foot"><button class="btn btn-primary btn-sm" id="ocr-import" type="button">'
            + '导入勾选记录</button></div>'
            + ocrRawHtml(result.rawText);

        var importBtn = $('#ocr-import', box);
        importBtn.addEventListener('click', function () {
            guard(function () {
                var payload = [];
                $$('.ocr-wish-row', box).forEach(function (row) {
                    if (!$('.ocr-wish-check', row).checked) {
                        return;
                    }
                    var nameInput = $('[data-w=itemName]', row).value.trim();
                    var rarity = Number($('[data-w=rarity]', row).value);
                    var pool = $('[data-w=pool]', row).value;
                    var pityRaw = $('[data-w=pityCount]', row).value.trim();
                    var timeRaw = $('[data-w=wishTime]', row).value;
                    if (!nameInput) {
                        throw new Error('第 ' + (Number(row.dataset.index) + 1) + ' 条缺少物品名称');
                    }
                    payload.push({
                        itemName: nameInput,
                        rarity: rarity,
                        pool: pool,
                        itemType: /武器|光锥/.test(pool) ? g.itemTypes[1] : g.itemTypes[0],
                        pityCount: pityRaw === '' ? null : Number(pityRaw),
                        wishTime: timeRaw ? toApiTime(timeRaw) : null
                    });
                });
                if (!payload.length) {
                    throw new Error('请至少勾选一条记录');
                }
                return api('/api/wishes/import?format=json&mode=merge', {
                    method: 'POST',
                    body: payload
                }).then(function (res) {
                    toast('已导入 ' + res.imported + ' 条'
                        + (res.skipped ? '，跳过重复 ' + res.skipped + ' 条' : '')
                        + (res.filtered ? '，忽略 ' + res.filtered + ' 条' : ''));
                    close(true);
                    refreshWishList();
                });
            });
        });
    }

    /* ---------------- 游戏切换 ---------------- */

    function applyGameUI() {
        var g = gameConfig();
        document.body.classList.toggle('game-starrail', state.game === 'starrail');
        $$('#game-switch .game-btn').forEach(function (btn) {
            var active = btn.dataset.game === state.game;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
        var subtitle = $('#app-subtitle');
        if (subtitle) {
            subtitle.textContent = g.subtitle;
        }
        document.title = g.title;
    }

    function setGame(game) {
        if (!GAMES[game] || state.game === game) {
            return;
        }
        state.game = game;
        localStorage.setItem(GAME_KEY, game);
        state.pages.wishes = 1;
        state.wishPool = '';
        applyGameUI();
        if (state.token && state.user) {
            switchView(state.view);
        }
    }

    /* ---------------- 初始化 ---------------- */

    function bindShell() {
        $$('.nav-btn, .tab-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                switchView(btn.dataset.view);
            });
        });

        $$('#game-switch .game-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                setGame(btn.dataset.game);
            });
        });

        $('#logout-btn').addEventListener('click', function () {
            logout(false);
            toast('已退出登录');
        });
    }

    function init() {
        applyGameUI();
        bindAuth();
        bindShell();

        if (!state.token) {
            return;
        }
        api('/api/auth/me').then(function (user) {
            state.user = user;
            localStorage.setItem(USER_KEY, JSON.stringify(user));
            enterApp();
        }).catch(function () {
            if (state.token) {
                logout(true);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();

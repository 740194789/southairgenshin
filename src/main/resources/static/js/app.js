/* ============================================================
   南空提瓦特小助手 前端逻辑（原生 JS，无构建步骤）
   核心：抽卡记录 + 原石 / 摩拉 / 抽数换算
   ============================================================ */
(function () {
    'use strict';

    var TOKEN_KEY = 'sg_token';
    var USER_KEY = 'sg_user';
    var GAME_KEY = 'sg_game';

    /* 云同步：只在本机保存服务地址、同步码与同步时间 */
    var CLOUD_SERVICE_KEY = 'sg_cloud_service';
    var CLOUD_CODE_KEY = 'sg_cloud_code';
    var CLOUD_META_KEY = 'sg_cloud_meta';
    var CLOUD_AUTO_KEY = 'sg_cloud_auto';
    var CLOUD_DEFAULT_SERVICE = 'https://qq740194789-d5ghcyv7x748499f9.service.tcloudbase.com/syncStore';
    var cloudSyncing = false;

    /* 两套游戏的卡池、货币与文案配置 */
    var GAMES = {
        genshin: {
            key: 'genshin',
            switchLabel: '原神',
            fullName: '原神',
            title: '南空提瓦特小助手 · 原神数据记录',
            subtitle: '提瓦特数据记录 · Web / Mobile',
            heroSub: 'Wish Planner',
            pools: ['角色活动', '武器活动', '集录祈愿', '常驻'],
            itemTypes: ['角色', '武器'],
            currency: '原石',
            credit: '摩拉',
            fateLimited: '纠缠之缘',
            fateStandard: '相遇之缘',
            genesisCrystal: '创世结晶',
            threeStarType: '武器',
            charPool: '角色活动',
            weaponPool: '武器活动'
        },
        starrail: {
            key: 'starrail',
            switchLabel: '星穹铁道',
            fullName: '崩坏：星穹铁道',
            title: '南空提瓦特小助手 · 崩坏：星穹铁道记录',
            subtitle: '星穹列车数据记录 · Web / Mobile',
            heroSub: 'Warp Planner',
            pools: ['角色活动', '光锥活动', '联动', '常驻'],
            itemTypes: ['角色', '光锥'],
            currency: '星琼',
            credit: '信用点',
            fateLimited: '星轨专票',
            fateStandard: '星轨通票',
            genesisCrystal: '古老梦华',
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
        wishKeyword: '',
        wishStart: '',
        wishEnd: '',
        wishSelected: new Set()
    };

    var cache = { wishes: [] };

    var authMode = 'login';

    /* ---------------- 基础工具 ---------------- */

    function gameConfig() {
        return GAMES[state.game] || GAMES.genshin;
    }

    /* 卡池展示名：库内值保持不变，避免历史记录、备份与导入失效 */
    var POOL_LABELS = {
        '角色活动': '角色卡池',
        '武器活动': '武器卡池',
        '光锥活动': '光锥卡池'
    };

    function poolLabel(pool) {
        return POOL_LABELS[pool] || pool || '';
    }

    /* 常驻名单：用于自动判定五星是否 UP（与链接导入口径一致） */
    var STANDARD_ITEMS = {
        genshin: {
            characters: ['迪卢克', '琴', '莫娜', '七七', '刻晴', '提纳里', '迪希雅', '梦见月瑞希'],
            weapons: ['天空之刃', '天空之翼', '天空之傲', '天空之卷', '天空之脊', '阿莫斯之弓',
                '狼的末路', '风鹰剑', '四风原典', '和璞鸢']
        },
        starrail: {
            characters: ['姬子', '瓦尔特', '布洛妮娅', '克拉拉', '杰帕德', '彦卿', '白露'],
            weapons: ['银河铁道之夜', '无可取代的东西', '但战斗还未结束', '以世界之名',
                '制胜的瞬间', '于夜色中', '时节不居']
        }
    };

    /* 崩铁「星缘相邀」：角色 → 加入该名单的版本更新时间（此前只可能是当期 UP） */
    var XINGYUAN_JOINED = {
        // 3.2（2025-04-09）星缘相邀上线时的初始可选名单
        '符玄': '2025-04-09 06:00:00',
        '刃': '2025-04-09 06:00:00',
        '希儿': '2025-04-09 06:00:00',
        // 4.2（2026-04-22）名单扩充加入
        '云璃': '2026-04-22 06:00:00',
        '银枝': '2026-04-22 06:00:00',
        '银狼': '2026-04-22 06:00:00'
    };

    /** 统一成 yyyy-MM-dd HH:mm:ss，便于与加入时间比较 */
    function normalizedTime(value) {
        return String(value || '').replace('T', ' ').slice(0, 19);
    }

    /** 星缘相邀角色是否算 UP：加入名单之前抽到算 UP，之后算歪；不在名单返回 null */
    function xingyuanIsUp(name, wishTime) {
        var joined = XINGYUAN_JOINED[name];
        if (!joined) {
            return null;
        }
        var time = normalizedTime(wishTime);
        if (!time) {
            return false;
        }
        return time < joined;
    }

    function inferIsUp(game, pool, name, itemType, wishTime) {
        var standard = STANDARD_ITEMS[game];
        if (!standard || !name) {
            return false;
        }
        if (pool === '角色活动') {
            if (game === 'starrail') {
                if (standard.characters.indexOf(name) >= 0) {
                    return false;
                }
                var xingyuan = xingyuanIsUp(name, wishTime);
                return xingyuan === null ? true : xingyuan;
            }
            return standard.characters.indexOf(name) < 0;
        }
        if (pool === '武器活动' || pool === '光锥活动') {
            return standard.weapons.indexOf(name) < 0;
        }
        // 崩铁联动池：五星角色全部视为当期 UP
        if (pool === '联动') {
            return true;
        }
        return false;
    }

    function nameLists(game) {
        var characterMap = (window.SG_AVATARS || {})[game] || {};
        var weaponMap = (window.SG_WEAPON_ICONS || {})[game] || {};
        function sortNames(list) {
            return list.sort(function (a, b) {
                return a.localeCompare(b, 'zh-Hans-CN');
            });
        }
        return {
            characters: sortNames(Object.keys(characterMap)),
            weapons: sortNames(Object.keys(weaponMap))
        };
    }

    function inferItemType(game, name) {
        var lists = nameLists(game);
        if (lists.characters.indexOf(name) >= 0) {
            return GAMES[game].itemTypes[0];
        }
        if (lists.weapons.indexOf(name) >= 0) {
            return GAMES[game].itemTypes[1];
        }
        return null;
    }

    /* 主角：只在收藏「补充已有」中可选，抽卡记录不会出现 */
    var PROTAGONISTS = { genshin: '旅行者', starrail: '开拓者' };

    /* 四星角色名单：补充已有按类别选择时用于切分四星 / 五星角色 */
    var FOUR_STAR_CHARACTERS = {
        genshin: ['丽莎', '芭芭拉', '凯亚', '雷泽', '安柏', '香菱', '北斗', '行秋', '凝光', '菲谢尔',
            '班尼特', '诺艾尔', '重云', '迪奥娜', '砂糖', '辛焱', '罗莎莉亚', '烟绯', '托马', '早柚',
            '五郎', '九条裟罗', '鹿野院平藏', '绮良良', '云堇', '久岐忍', '柯莱', '多莉', '坎蒂丝',
            '莱依拉', '珐露珊', '瑶瑶', '米卡', '卡维', '琳妮特', '菲米尼', '夏洛蒂', '夏沃蕾',
            '嘉明', '赛索斯', '卡齐娜', '欧洛伦', '蓝砚', '伊安珊', '伊法', '塔利雅', '爱诺',
            '雅珂达', '叶洛亚', '布伦妮', '阿罗夏', '瓦列里'],
        starrail: ['三月七', '丹恒', '阿兰', '艾丝妲', '黑塔', '希露瓦', '娜塔莎', '佩拉', '桑博',
            '虎克', '玲可', '卢卡', '青雀', '停云', '素裳', '驭空', '桂乃芬', '雪衣', '寒鸦',
            '貊泽', '加拉赫', '米沙']
    };

    /** 在线图鉴拿到的星级优先（新角色也能自动归类），拿不到时退回内置四星名单 */
    function isFourStarCharacter(game, name) {
        var ranks = (CATALOG_RANKS || {})[game] || {};
        var rank = ranks[name];
        if (rank) {
            return Number(rank) === 4;
        }
        return (FOUR_STAR_CHARACTERS[game] || []).indexOf(name) >= 0;
    }

    function ownedNameOptions(game, category) {
        var lists = nameLists(game);
        if (category === 'weapons5') {
            return lists.weapons;
        }
        var wantFour = category === 'characters4';
        return lists.characters.filter(function (name) {
            return isFourStarCharacter(game, name) === wantFour;
        });
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

    /* 所有日期时间文本框统一限制年份最多 4 位 */
    document.addEventListener('input', function (event) {
        var input = event.target;
        if (!input || !input.getAttribute || input.getAttribute('data-datetime') !== '1') {
            return;
        }
        var text = String(input.value || '');
        var match = /^(\d{4,})(.*)$/.exec(text);
        if (match && match[1].length > 4) {
            input.value = match[1].slice(0, 4) + match[2];
        }
    });

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

    /* ---------------- 养成经验（原神） ---------------- */

    /* 角色 1→90 每级所需经验（下标 = 当前等级，共 89 项） */
    var CHARACTER_EXP = [
        1000, 1325, 1700, 2150, 2625, 3150, 3725, 4350, 5000, 5700,
        6450, 7225, 8050, 8925, 9825, 10750, 11725, 12725, 13775, 14875,
        16800, 18000, 19250, 20550, 21875, 23250, 24650, 26100, 27575, 29100,
        30650, 32250, 33875, 35550, 37250, 38975, 40750, 42575, 44425, 46300,
        50625, 52700, 54775, 56900, 59075, 61275, 63525, 65800, 68125, 70475,
        76500, 79050, 81650, 84275, 86950, 89650, 92400, 95175, 98000, 100875,
        108950, 112050, 115175, 118325, 121525, 124775, 128075, 131400, 134775, 138175,
        148700, 152375, 156075, 159825, 163600, 167425, 171300, 175225, 179175, 183175,
        216225, 243025, 273100, 306800, 344600, 386950, 434425, 487625, 547200
    ];

    /* 五星圣遗物 +0 强化到 +20 所需经验 */
    var FIVE_STAR_ARTIFACT_EXP = 270475;

    /* 角色可选等级：90 级后为 95 / 100（需无主的命星，不再消耗经验） */
    var CHAR_LEVELS = (function () {
        var list = [];
        for (var lv = 1; lv <= 90; lv += 1) {
            list.push(lv);
        }
        list.push(95, 100);
        return list;
    })();

    function charLevelOptionsHtml(fromLevel, selected) {
        return CHAR_LEVELS.filter(function (lv) {
            return fromLevel === null || lv > fromLevel;
        }).map(function (lv) {
            return '<option value="' + lv + '"' + (lv === selected ? ' selected' : '') + '>'
                + lv + '</option>';
        }).join('');
    }

    /** 当前等级 → 目标等级：经验书经验 + 无主的命星数量 */
    function levelPlan(fromLevel, toLevel) {
        var start = Math.max(1, Math.min(100, toInt(fromLevel)));
        var end = Math.max(start, Math.min(100, toInt(toLevel)));
        var exp = 0;
        for (var lv = start; lv < Math.min(end, 90); lv += 1) {
            exp += CHARACTER_EXP[lv - 1];
        }
        var stars = 0;
        if (end > 90) {
            if (start >= 95) {
                stars = end >= 100 ? 2 : 0;
            } else {
                stars = end >= 100 ? 3 : 1;
            }
        }
        return { from: start, to: end, exp: exp, stars: stars };
    }
    var CHAR_ITEM_EXP = { heroWit: 20000, adventurerExp: 5000, wandererAdvice: 1000 };
    var ART_ITEM_EXP = { sanctifyingUnction: 2500, sanctifyingEssence: 10000 };

    /* 地脉衍出·启示之花：每次消耗 20 树脂，掉落数量随世界等级变化（区间来自官方观测数据） */
    var EXP_FLOWER_REWARDS = {
        0: { hero: [0, 0], adv: [3, 4], wanderer: [7, 8] },
        1: { hero: [0, 0], adv: [5, 6], wanderer: [10, 12] },
        2: { hero: [0, 0], adv: [10, 11], wanderer: [0, 0] },
        3: { hero: [0, 0], adv: [13, 14], wanderer: [0, 0] },
        4: { hero: [2, 3], adv: [6, 7], wanderer: [0, 0] },
        5: { hero: [3, 4], adv: [6, 7], wanderer: [0, 0] },
        6: { hero: [4, 5], adv: [6, 7], wanderer: [0, 0] },
        7: { hero: [4, 5], adv: [6, 7], wanderer: [0, 0] },
        8: { hero: [4, 5], adv: [6, 7], wanderer: [0, 0] },
        9: { hero: [4, 5], adv: [6, 7], wanderer: [0, 0] }
    };
    var EXP_FLOWER_RESIN = 20;
    var EXP_FLOWER_LEVEL_KEY = 'sg_exp_flower_wl';

    function expFlowerReward(level) {
        return EXP_FLOWER_REWARDS[toInt(level)] || EXP_FLOWER_REWARDS[8];
    }

    /** 单次经验花的经验区间与掉落文案 */
    function expFlowerPerRun(level) {
        var row = expFlowerReward(level);
        var min = row.hero[0] * CHAR_ITEM_EXP.heroWit
            + row.adv[0] * CHAR_ITEM_EXP.adventurerExp
            + row.wanderer[0] * CHAR_ITEM_EXP.wandererAdvice;
        var max = row.hero[1] * CHAR_ITEM_EXP.heroWit
            + row.adv[1] * CHAR_ITEM_EXP.adventurerExp
            + row.wanderer[1] * CHAR_ITEM_EXP.wandererAdvice;
        var books = [];
        if (row.hero[1] > 0) {
            books.push(row.hero[0] + '–' + row.hero[1] + ' 大英雄的经验');
        }
        if (row.adv[1] > 0) {
            books.push(row.adv[0] + '–' + row.adv[1] + ' 冒险家的经验');
        }
        if (row.wanderer[1] > 0) {
            books.push(row.wanderer[0] + '–' + row.wanderer[1] + ' 流浪者的经验');
        }
        return { min: min, max: max, books: books.join(' + ') };
    }

    /** 还差 exp 经验时，需要打经验花的次数与树脂区间 */
    function expFlowerPlan(deficit, level) {
        var per = expFlowerPerRun(level);
        var need = Math.max(0, toInt(deficit));
        var minRuns = need > 0 ? Math.ceil(need / Math.max(1, per.max)) : 0;
        var maxRuns = need > 0 ? Math.ceil(need / Math.max(1, per.min)) : 0;
        return {
            per: per,
            need: need,
            minRuns: minRuns,
            maxRuns: maxRuns,
            resinMin: minRuns * EXP_FLOWER_RESIN,
            resinMax: maxRuns * EXP_FLOWER_RESIN
        };
    }

    function expFlowerRunsText(plan) {
        if (plan.need <= 0) {
            return '经验书已足够，不需要再打经验花';
        }
        if (plan.minRuns === plan.maxRuns) {
            return '还需打 <strong>' + plan.minRuns + '</strong> 次经验花'
                + '（约 ' + fmt(plan.resinMin) + ' 树脂）';
        }
        return '还需打 <strong>' + plan.minRuns + '–' + plan.maxRuns + '</strong> 次经验花'
            + '（约 ' + fmt(plan.resinMin) + '–' + fmt(plan.resinMax) + ' 树脂）';
    }

    function expFlowerLevelOptionsHtml(selected) {
        var list = [];
        for (var level = 0; level <= 9; level += 1) {
            list.push('<option value="' + level + '"'
                + (level === toInt(selected) ? ' selected' : '') + '>世界等级 ' + level + '</option>');
        }
        return list.join('');
    }

    function expFlowerSavedLevel() {
        var saved = localStorage.getItem(EXP_FLOWER_LEVEL_KEY);
        return saved === null || saved === '' ? 8 : Math.max(0, Math.min(9, toInt(saved)));
    }

    function toInt(value) {
        var number = parseInt(value, 10);
        return isNaN(number) ? 0 : number;
    }

    function expBookTotal(resource) {
        return (toInt(resource.heroWit) * CHAR_ITEM_EXP.heroWit
            + toInt(resource.adventurerExp) * CHAR_ITEM_EXP.adventurerExp
            + toInt(resource.wandererAdvice) * CHAR_ITEM_EXP.wandererAdvice);
    }

    function artifactItemTotal(resource) {
        return (toInt(resource.sanctifyingUnction) * ART_ITEM_EXP.sanctifyingUnction
            + toInt(resource.sanctifyingEssence) * ART_ITEM_EXP.sanctifyingEssence);
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

    /** 统一成后端要求的 yyyy-MM-dd HH:mm:ss，单位数月份 / 日期 / 时间自动补零 */
    function toApiTime(value) {
        if (!value) {
            return null;
        }
        var text = String(value).trim().replace('T', ' ');
        var match = /^(\d{4})\D(\d{1,2})\D(\d{1,2})(?:\D+(\d{1,2})\D(\d{1,2})(?:\D(\d{1,2}))?)?/
            .exec(text);
        if (!match) {
            return text;
        }
        function pad(part) {
            var number = Number(part);
            return (number < 10 ? '0' : '') + number;
        }
        var result = match[1] + '-' + pad(match[2]) + '-' + pad(match[3]);
        if (match[4] === undefined) {
            return result + ' 00:00:00';
        }
        result += ' ' + pad(match[4]) + ':' + pad(match[5]);
        return result + ':' + (match[6] === undefined ? '00' : pad(match[6]));
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

        return fetch(withGame(path, game), opts).catch(function () {
            // 浏览器网络层错误（服务未启动 / 连接被拒绝）统一转成可读提示
            throw new Error('无法连接服务器，请确认应用已启动后重试');
        }).then(function (res) {
            return res.text().then(function (text) {
                var payload = safeParse(text);
                if (res.status === 401) {
                    logout(true);
                    throw new Error((payload && payload.message) || '登录已失效，请重新登录');
                }
                if (!res.ok) {
                    var error = new Error((payload && payload.message) || ('请求失败（' + res.status + '）'));
                    error.code = (payload && payload.code) || res.status;
                    throw error;
                }
                if (payload && payload.code !== 0) {
                    var failure = new Error(payload.message || '请求失败');
                    failure.code = payload.code;
                    throw failure;
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
        $('#auth-forgot').hidden = !isLogin;
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
        $('#auth-forgot').addEventListener('click', function () {
            openForgotPassword();
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
                    if (!isLogin && data.recoveryCode) {
                        // 恢复码只在注册时返回一次，务必让用户先保存
                        return showRecoveryCode(data.recoveryCode).then(function () {
                            toast('注册成功');
                            enterApp();
                        });
                    }
                    toast(isLogin ? '欢迎回来' : '注册成功');
                    enterApp();
                    return null;
                })
                .catch(function (err) {
                    toast(err.message || '操作失败', 'error');
                })
                .then(function () {
                    submit.disabled = false;
                });
        });
    }

    /** 展示一次性恢复码（注册成功、设置里重新生成时共用） */
    function showRecoveryCode(code) {
        return openForm('保存账号恢复码', [
            { key: 'code', label: '恢复码', readonly: true, full: true }
        ], { code: code }, {
            hint: '忘记密码时需要「账号 + 恢复码」。请现在抄写或截图保存，关闭后不再显示；'
                + '也可以在「设置 · 账号安全」里重新生成。',
            submitText: '我已保存'
        });
    }

    /** 忘记密码：账号 + 恢复码 + 新密码，成功后直接登录 */
    function openForgotPassword() {
        return openForm('忘记密码', [
            { key: 'username', label: '账号', required: true, placeholder: '注册时的登录账号' },
            { key: 'recoveryCode', label: '恢复码', required: true, placeholder: 'XXXX-XXXX-XXXX-XXXX' },
            { key: 'newPassword', label: '新密码', type: 'password', required: true, placeholder: '至少 6 位' }
        ], {}, {
            hint: '恢复码在注册成功时显示过一次；如果没保存，可以先登录后在「设置 · 账号安全」重新生成。',
            submitText: '重置并登录'
        }).then(function (values) {
            if (!values) {
                return null;
            }
            var username = String(values.username || '').trim();
            var code = String(values.recoveryCode || '').trim();
            var password = String(values.newPassword || '');
            if (username.length < 3) {
                toast('账号至少 3 位', 'error');
                return null;
            }
            if (!code) {
                toast('请输入恢复码', 'error');
                return null;
            }
            if (password.length < 6) {
                toast('密码至少 6 位', 'error');
                return null;
            }
            return api('/api/auth/reset-password', {
                method: 'POST',
                body: { username: username, recoveryCode: code, newPassword: password }
            });
        }).then(function (data) {
            if (!data) {
                return null;
            }
            saveSession(data);
            toast('密码已重置，已自动登录');
            enterApp();
            return null;
        }).catch(function (err) {
            toast(err.message || '重置失败', 'error');
            return null;
        });
    }

    /* ---------------- 视图切换 ---------------- */

    function switchView(view) {
        state.view = view;
        document.body.dataset.view = view;
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
        return '<p class="empty">' + esc(error && error.message ? error.message : '加载失败') + '</p>'
            + '<div class="panel-actions error-retry">'
            + '<button class="btn btn-outline btn-sm" type="button" data-retry="1">重试</button></div>';
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

    function statCard(label, value, extra, tone) {
        return '<div class="stat-card' + (tone ? ' tone-' + tone : '') + '">'
            + '<div class="stat-label">' + esc(label) + '</div>'
            + '<div class="stat-value">' + esc(value) + '</div>'
            + '<div class="stat-extra">' + esc(extra) + '</div>'
            + '</div>';
    }

    /** 统计页内部分组：只显示当前分组，避免所有模块堆在一页。 */
    var STATS_TABS = [
        { key: 'overview', label: '概览' },
        { key: 'pity', label: '保底分析' },
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

    /* 桑多涅主题资源图标：瓷器白 / 银灰 / 猩红宝石质感，统一走内联 SVG */
    var TILE_ICONS = {
        gem: '<path d="M12 2.8l5.3 3.7 2 6.6L12 21.2 4.7 13.1l2-6.6z"/><path d="M12 2.8v18.4"/><path d="M6.7 6.5h10.6"/>',
        coin: '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="3.4"/><path d="M12 4.4v2.6M12 17v2.6M4.4 12h2.6M17 12h2.6"/>',
        fate: '<circle cx="12" cy="12" r="7.8"/><path d="M12 5.8l1.6 3.6 3.9.5-2.9 2.7.8 3.8-3.4-1.9-3.4 1.9.8-3.8-2.9-2.7 3.9-.5z"/>',
        fateStandard: '<path d="M12 3.2l1.9 5.9 5.9 1.9-5.9 1.9L12 18.8l-1.9-5.9L4.2 11l5.9-1.9z"/><path d="M12 18.8v2.6"/>',
        crystal: '<path d="M12 2.6l5.8 6.1-2.3 10.6L12 21.4l-3.5-2.1L6.2 8.7z"/><path d="M6.2 8.7h11.6M12 2.6v18.8M8.5 8.7L12 21.4l3.5-12.7"/>'
    };

    function tileGlyph(key) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"'
            + ' stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">'
            + (TILE_ICONS[key] || '') + '</svg>';
    }

    function resourceTile(icon, label, value, extra) {
        return '<article class="inventory-tile">'
            + '<span class="tile-glyph" aria-hidden="true">' + tileGlyph(icon) + '</span>'
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
        if (!item) {
            return '';
        }
        var isCharacter = item.itemType === '角色';
        var map = isCharacter
            ? (window.SG_AVATARS || {})[state.game]
            : (window.SG_WEAPON_ICONS || {})[state.game];
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
            var rarity = Number(item.rarity) || 3;
            return '<div class="mini-item rarity-' + rarity + '">'
                + '<span class="name">' + avatarHtml(item)
                + '<span class="stars">' + starText(item.rarity) + '</span>'
                + esc(item.itemName) + '</span>'
                + (rarity >= 5 && item.pool
                    ? '<span class="mini-meta">' + esc(poolLabel(item.pool)) + ' · ' + (item.pityCount || 1) + ' 抽</span>'
                    : '')
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

    function poolStatsPanelHtml(data, active) {
        var all = data.poolStats || [];
        var list = active && active !== PULL_POOL_ALL
            ? all.filter(function (item) { return item.pool === active; })
            : all;
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
            return '大保底 · 下次必定 UP';
        }

        return '<section class="panel pool-stats-panel">'
            + '<h3>卡池保底统计<span class="pool-tag">'
            + esc(active && active !== PULL_POOL_ALL ? poolLabel(active) : '保底 · 出货') + '</span></h3>'
            + '<div class="pool-stat-list">'
            + list.map(function (item) {
                var percent = item.cap > 0
                    ? Math.min(100, Math.round(item.currentPity / item.cap * 100)) : 0;
                return '<div class="pool-stat">'
                    + '<div class="pool-stat-head">'
                    + '<span class="pool-tag">' + esc(poolLabel(item.pool)) + '</span>'
                    + '<span class="pool-stat-pity">已垫 ' + item.currentPity + ' / ' + item.cap + ' 抽</span>'
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
                    + (item.pool === '武器活动' && state.game === 'genshin'
                        ? fateRowHtml(item) : '')
                    + '</div>';
            }).join('')
            + '</div></section>';
    }

    var WEAPON_TARGET_KEY = 'sg_weapon_target_';

    function weaponTargetName() {
        try {
            return localStorage.getItem(WEAPON_TARGET_KEY + state.game) || '';
        } catch (e) {
            return '';
        }
    }

    /** 当期武器池的 UP 五星武器：来自实时 / 内置卡池日历，无法识别时返回空 */
    function currentWeaponNames() {
        if (state.game !== 'genshin') {
            return [];
        }
        var info = calendarInfo(cache.calendar);
        var phase = info.current && info.current.phase;
        if (!phase) {
            return [];
        }
        var names = [];
        (phase.banners || []).forEach(function (banner) {
            if (typeof banner === 'string') {
                return;
            }
            var pool = banner.pool;
            var name = banner.name;
            if (pool === '武器活动' && name && name !== '武器活动' && names.indexOf(name) < 0) {
                names.push(name);
            }
        });
        return names;
    }

    /** 原神武器池的定轨目标与命定值：目标仅本地记录，用于提示 */
    function fateRowHtml(item) {
        var weapons = currentWeaponNames();
        if (!weapons.length) {
            weapons = nameLists(state.game).weapons;
        }
        var target = weaponTargetName();
        if (target && weapons.indexOf(target) < 0) {
            weapons = weapons.concat(target);
        }
        var points = Number(item.fatePoints) || 0;
        var options = '<option value="">选择定轨目标</option>' + weapons.map(function (name) {
            return '<option value="' + esc(name) + '"'
                + (target === name ? ' selected' : '') + '>' + esc(name) + '</option>';
        }).join('');
        return '<div class="fate-row">'
            + '<select class="input fate-target" id="fate-target">' + options + '</select>'
            + '<span class="pool-tag' + (points > 0 ? ' up' : '') + '">命定值 ' + points + ' / 1</span>'
            + '<span class="fate-note">'
            + (points > 0
                ? (target ? '下次五星必定定轨「' + esc(target) + '」' : '下次五星必定定轨')
                : (target ? '目标「' + esc(target) + '」：未命中定轨后命定值 +1' : '未选择定轨目标'))
            + '</span></div>';
    }

    /** 统计视图的委托事件：定轨目标选择后写入本机 */
    function bindStatsDelegates() {
        var host = $('#view-stats');
        if (!host || host.getAttribute('data-fate-bound') === '1') {
            return;
        }
        host.setAttribute('data-fate-bound', '1');
        host.addEventListener('change', function (event) {
            var target = event.target;
            if (!target || target.id !== 'fate-target') {
                return;
            }
            try {
                localStorage.setItem(WEAPON_TARGET_KEY + state.game, target.value);
            } catch (e) {
                /* 忽略隐私模式下的写入失败 */
            }
            toast(target.value ? '定轨目标已设为 ' + target.value : '已清除定轨目标');
            var host = $('#stats-pity-content');
            if (host && cache.stats) {
                host.innerHTML = statsPityContentHtml(cache.stats,
                    cache.statsPools[state.game] || PULL_POOL_ALL);
            }
        });
    }

    /* ---------------- 抽卡期望 ---------------- */

    /* 保底分析的卡池筛选：全部 + 有记录 / 有保底数据的卡池 */
    var PULL_POOL_ALL = 'all';

    function statsPoolOptions(data) {
        var options = [{ key: PULL_POOL_ALL, label: '全部' }];
        (data.poolStats || []).forEach(function (item) {
            options.push({ key: item.pool, label: poolLabel(item.pool) });
        });
        return options;
    }

    function statsPoolFilterHtml(data, active) {
        return '<div class="pull-pools stats-pool-filter" id="stats-pool-filter">'
            + statsPoolOptions(data).map(function (option) {
                return '<button class="pull-pool' + (option.key === active ? ' active' : '') + '"'
                    + ' type="button" data-pool="' + esc(option.key) + '">'
                    + esc(option.label) + '</button>';
            }).join('') + '</div>';
    }

    function statsPityContentHtml(data, active) {
        var g = gameConfig();
        var showCapture = state.game === 'genshin'
            && (active === PULL_POOL_ALL || active === g.charPool);
        return (showCapture ? capturePanelHtml(data) : '') + poolStatsPanelHtml(data, active);
    }

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
        var days = raw.days === undefined ? 21 : Number(raw.days);
        return {
            c: Math.max(0, Math.min(6, Number(raw.c) || 0)),
            r: Math.max(0, Math.min(5, Number(raw.r) || 0)),
            mode: raw.mode === 'theory' ? 'theory' : 'history',
            days: isFinite(days) ? Math.max(0, Math.min(365, Math.round(days))) : 21
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
            dailyPrimogems: data.resource.dailyPrimogems || 0,
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

    /** 攒抽规划：按「每天可攒原石 + 卡池剩余天数」估算到期时能否攒够目标。 */
    function plannerHtml(plan, prefs) {
        var g = gameConfig();
        var unit = plan.currencyPerPull || 160;
        var dailyPrimogems = Math.max(0, Math.round(Number(plan.dailyPrimogems) || 0));
        var dailyPulls = dailyPrimogems / unit;
        var income = Math.round(dailyPulls * prefs.days * 10) / 10;
        var projected = Math.round((plan.available + income) * 10) / 10;
        var gapHigh = Math.max(0, plan.totalHigh - projected);
        var gapLow = Math.max(0, plan.totalLow - projected);
        var percent = plan.totalHigh > 0
            ? Math.min(100, Math.round(projected / plan.totalHigh * 100)) : 100;
        var enoughHigh = projected >= plan.totalHigh;
        var enoughLow = projected >= plan.totalLow;

        var status;
        if (enoughHigh) {
            status = '到期预计 <strong>' + num(projected) + '</strong> 抽，已达到区间上限，余 '
                + num(projected - plan.totalHigh) + ' 抽';
        } else if (enoughLow) {
            status = '到期预计 <strong>' + num(projected) + '</strong> 抽，达到区间下限，距上限还差 '
                + num(gapHigh) + ' 抽';
        } else {
            status = '到期预计 <strong>' + num(projected) + '</strong> 抽，还差 '
                + (gapHigh > gapLow ? num(gapLow) + '–' + num(gapHigh) : num(gapHigh)) + ' 抽';
        }

        var advice = '';
        if (gapHigh > 0) {
            var parts = [];
            if (prefs.days > 0) {
                parts.push('每天需攒 ' + fmt(Math.ceil(gapHigh * unit / prefs.days)) + ' ' + g.currency);
            }
            if (dailyPrimogems > 0) {
                var needDays = Math.ceil(gapHigh * unit / dailyPrimogems);
                var eta = new Date(Date.now() + needDays * 86400000);
                parts.push('还需 ' + needDays + ' 天（约 ' + eta.getFullYear() + '-'
                    + ('0' + (eta.getMonth() + 1)).slice(-2) + '-' + ('0' + eta.getDate()).slice(-2) + '）');
            }
            advice = parts.join(' · ');
        } else {
            advice = '保持当前节奏即可，不必额外投入。';
        }

        return '<div class="expect-planner">'
            + '<div class="planner-head"><strong>攒抽规划</strong>'
            + '<span>按卡池剩余天数估算到期可抽</span></div>'
            + '<div class="planner-fields">'
            + '<label class="planner-field"><span>每天可攒</span>'
            + '<input id="plan-daily" type="number" min="0" max="999999" step="10" value="'
            + dailyPrimogems + '"/><em>' + esc(g.currency) + '</em></label>'
            + '<label class="planner-field"><span>卡池还剩</span>'
            + '<input id="plan-days" type="number" min="0" max="365" step="1" value="'
            + prefs.days + '"/><em>天</em></label>'
            + '</div>'
            + '<p class="planner-rate">≈ <strong>' + num(dailyPulls) + '</strong> 抽/天 · '
            + prefs.days + ' 天共 +<strong>' + fmt(dailyPrimogems * prefs.days) + '</strong> '
            + esc(g.currency) + '（每天自动计入资源）</p>'
            + '<div class="planner-numbers">'
            + '<div><span>当前可抽</span><strong>' + fmt(plan.available) + '</strong></div>'
            + '<div><span>期间可得</span><strong>+' + num(income) + '</strong></div>'
            + '<div><span>到期合计</span><strong>' + num(projected) + '</strong></div>'
            + '</div>'
            + '<div class="expect-bar' + (enoughHigh ? ' done' : '') + '">'
            + '<span style="width:' + percent + '%"></span></div>'
            + '<p class="expect-compare">' + status + '</p>'
            + '<p class="expect-note">' + esc(advice)
            + '（目标按当前' + esc(g.currency) + '储备折算，不含版本活动等临时收入。）</p>'
            + '</div>';
    }

    /* ---------------- 版本 / 卡池日历（内置数据） ---------------- */

    function dateOnly(value) {
        return String(value || '').slice(0, 10);
    }

    function parseDateOnly(text) {
        var parts = dateOnly(text).split('-');
        if (parts.length !== 3) {
            return null;
        }
        var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return isNaN(d.getTime()) ? null : d;
    }

    function daysUntil(text) {
        var end = parseDateOnly(text);
        if (!end) {
            return 0;
        }
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.round((end.getTime() - today.getTime()) / 86400000);
    }

    function flatCalendarPhases(calendar) {
        var list = [];
        ((calendar && calendar.versions) || []).forEach(function (version) {
            (version.phases || []).forEach(function (phase) {
                list.push({ version: version.version, phase: phase });
            });
        });
        return list;
    }

    function calendarInfo(calendar) {
        var today = dateOnly(nowLocal());
        var list = flatCalendarPhases(calendar);
        for (var i = 0; i < list.length; i++) {
            if (list[i].phase.start <= today && today <= list[i].phase.end) {
                return { current: list[i], next: list[i + 1] || null };
            }
        }
        for (var j = 0; j < list.length; j++) {
            if (list[j].phase.start > today) {
                return { current: null, next: list[j] };
            }
        }
        return { current: null, next: null };
    }

    function calendarRowHtml(item, current, unit) {
        var g = gameConfig();
        var phase = item.phase;
        var left = Math.max(0, daysUntil(phase.end));
        var income = Number(phase.incomePrimogems) || 0;
        var names = (phase.banners || []).map(function (banner) {
            return typeof banner === 'string' ? banner : (banner && banner.name) || '';
        }).filter(function (name) {
            return name;
        }).join(' / ');
        return '<div class="calendar-row' + (current ? ' is-current' : '') + '">'
            + '<span class="calendar-badge">' + (current ? '进行中' : '下一期') + '</span>'
            + '<div class="calendar-body">'
            + '<strong>' + esc(item.version) + ' · ' + esc(phase.name || '') + '</strong>'
            + '<span>' + esc(dateOnly(phase.start)) + ' ~ ' + esc(dateOnly(phase.end))
            + ' · ' + (current ? '剩余 ' : '还有 ') + left + ' 天</span>'
            + (names ? '<span>' + esc(names) + '</span>' : '')
            + (income > 0
                ? '<span>本期预估 +' + fmt(income) + ' ' + esc(g.currency)
                    + ' ≈ ' + num(income / unit) + ' 抽</span>'
                : '')
            + '</div>'
            + (current
                ? '<button class="btn btn-outline btn-sm" type="button" id="calendar-use-days"'
                    + ' data-days="' + left + '">用剩余 ' + left + ' 天</button>'
                : '')
            + '</div>';
    }

    function calendarPanelHtml(calendar, unit) {
        if (!calendar || !(calendar.versions || []).length) {
            return '';
        }
        var info = calendarInfo(calendar);
        var rows = '';
        if (info.current) {
            rows += calendarRowHtml(info.current, true, unit);
        }
        if (info.next) {
            rows += calendarRowHtml(info.next, false, unit);
        }
        if (!rows) {
            rows = '<p class="panel-desc">当前没有进行中或即将开始的卡池。</p>';
        }
        var live = !!calendar._live;
        return '<section class="panel calendar-panel">'
            + '<h3>卡池日历<span class="pool-tag">' + (live ? '实时' : '内置') + ' · '
            + esc(dateOnly(calendar.updatedAt) || '未标注') + '</span></h3>'
            + '<div class="calendar-list">' + rows + '</div>'
            + '<p class="panel-desc">' + esc(calendar.note || '按官方公告维护版本与卡池时间。') + '</p>'
            + '<div class="panel-actions"><button class="btn btn-outline btn-sm"'
            + ' id="calendar-live" type="button">联网更新卡池</button></div>'
            + '</section>';
    }

    var LIVE_CALENDAR_KEY = 'sg_calendar_live_';

    /** 读取 24 小时内的实时卡池缓存 */
    function loadLiveCalendar(game) {
        var cached = safeParse(localStorage.getItem(LIVE_CALENDAR_KEY + game));
        if (!cached || !cached.data || !cached.data.versions) {
            return null;
        }
        if (Date.now() - (Number(cached.savedAt) || 0) > 24 * 3600 * 1000) {
            return null;
        }
        var data = cached.data;
        data._live = true;
        return data;
    }

    function refreshLiveCalendar() {
        return api('/api/calendar/live').then(function (live) {
            if (!live || !(live.versions || []).length) {
                throw new Error('官方公告里没有可用卡池');
            }
            live._live = true;
            try {
                localStorage.setItem(LIVE_CALENDAR_KEY + state.game,
                    JSON.stringify({ savedAt: Date.now(), data: live }));
            } catch (e) {
                /* 忽略隐私模式下的写入失败 */
            }
            toast('卡池日历已更新（官方公告）');
            loadStats();
        });
    }

    function bindCalendar(data) {
        var liveBtn = $('#calendar-live');
        if (liveBtn) {
            liveBtn.addEventListener('click', function () {
                guard(refreshLiveCalendar);
            });
        }
        var btn = $('#calendar-use-days');
        if (!btn) {
            return;
        }
        btn.addEventListener('click', function () {
            var days = Math.max(0, Math.min(365, Math.round(Number(btn.getAttribute('data-days')) || 0)));
            var prefs = expectPrefs();
            prefs.days = days;
            saveExpectPrefs(prefs);
            var host = $('.expect-panel');
            if (host) {
                host.outerHTML = expectationPanelHtml(data);
                bindExpectation(data);
            }
            toast('已填入卡池剩余 ' + days + ' 天');
        });
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
            + plannerHtml(plan, prefs)
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

        panel.addEventListener('change', function (event) {
            var id = event.target && event.target.id;
            if (id !== 'plan-daily' && id !== 'plan-days') {
                return;
            }
            var value = Number(event.target.value);
            if (id === 'plan-daily') {
                var current = Number(data.resource.dailyPrimogems) || 0;
                var daily = isFinite(value)
                    ? Math.max(0, Math.min(999999, Math.round(value))) : current;
                var rerender = function () {
                    var host = $('.expect-panel');
                    if (host) {
                        host.outerHTML = expectationPanelHtml(data);
                        bindExpectation(data);
                    }
                };
                if (daily === current) {
                    rerender();
                    return;
                }
                api('/api/resources', { method: 'PUT', body: { dailyPrimogems: daily } })
                    .then(function (updated) {
                        data.resource = updated;
                        rerender();
                        toast('每天 ' + fmt(daily) + ' ' + gameConfig().currency + ' 已保存');
                    })
                    .catch(function (err) {
                        rerender();
                        toast(err.message || '保存每日' + gameConfig().currency + '失败', 'error');
                    });
                return;
            }
            var prefs = expectPrefs();
            prefs.days = isFinite(value) ? Math.max(0, Math.min(365, Math.round(value))) : prefs.days;
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

    function resourceExpHtml(resource) {
        if (state.game !== 'genshin') {
            return '';
        }
        var charTotal = expBookTotal(resource);
        var artTotal = artifactItemTotal(resource);
        return '<section class="panel exp-panel hidden" id="exp-panel">'
            + '<div class="ledger-head"><h3>养成经验</h3>'
            + '<span>经验书 / 圣遗物经验可练到多少级</span></div>'
            + '<div class="exp-grid">'
            + '<div class="exp-card">'
            + '<h4>角色经验书</h4>'
            + '<p class="exp-total">合计经验 <strong>' + fmt(charTotal) + '</strong>'
            + '<span class="exp-hint">（持有数量在「经验素材」里查看）</span></p>'
            + '<div class="exp-controls exp-add">'
            + '<label>角色 <button class="btn btn-outline btn-sm exp-pick" id="exp-char-pick" type="button">'
            + '<span id="exp-char-name-label">选择角色</span></button></label>'
            + '<label>当前等级 <select id="exp-char-from">' + charLevelOptionsHtml(null, 1) + '</select></label>'
            + '<label>目标等级 <select id="exp-char-to">' + charLevelOptionsHtml(1, 2) + '</select></label>'
            + '<button class="btn btn-outline btn-sm" id="exp-char-add" type="button">保留结果</button>'
            + '</div>'
            + '<p class="exp-hint-line">90 级后需「无主的命星」：90 → 95 用 1 枚，90 → 100 共 3 枚；95 → 100 用 2 枚，不再消耗经验书。</p>'
            + '<div class="exp-result" id="exp-char-result"></div>'
            + '<div class="exp-rows" id="exp-char-rows"></div>'
            + '<div class="exp-result exp-sum" id="exp-char-sum"></div>'
            + '<div class="exp-flower">'
            + '<div class="exp-flower-head">'
            + '<label>经验花 <select id="exp-flower-wl">' + expFlowerLevelOptionsHtml(expFlowerSavedLevel()) + '</select></label>'
            + '<span class="exp-flower-per" id="exp-flower-per"></span>'
            + '</div>'
            + '<p class="exp-flower-result" id="exp-flower-result"></p>'
            + '<p class="exp-flower-result exp-flower-sum" id="exp-flower-sum" hidden></p>'
            + '</div>'
            + '</div>'
            + '<div class="exp-card">'
            + '<h4>圣遗物经验</h4>'
            + '<p class="exp-total">合计经验 <strong>' + fmt(artTotal) + '</strong>'
            + '<span class="exp-hint">（每个五星圣遗物 +0 → +20 需 270,475）</span></p>'
            + '<div class="exp-result" id="exp-art-result"></div>'
            + '</div>'
            + '</div>'
            + '<p class="ledger-foot">经验书 20,000 / 5,000 / 1,000；祝圣油膏 2,500、祝圣精华 10,000。</p>'
            + '</section>';
    }

    function resourceStockHtml(resource) {
        if (state.game !== 'genshin') {
            return '';
        }
        var items = [
            { label: '大英雄的经验', value: resource.heroWit || 0, note: '20,000 经验 / 本' },
            { label: '冒险家的经验', value: resource.adventurerExp || 0, note: '5,000 经验 / 本' },
            { label: '流浪者的经验', value: resource.wandererAdvice || 0, note: '1,000 经验 / 本' },
            { label: '祝圣油膏', value: resource.sanctifyingUnction || 0, note: '2,500 经验 / 个' },
            { label: '祝圣精华', value: resource.sanctifyingEssence || 0, note: '10,000 经验 / 个' }
        ];
        return '<section class="panel exp-stock hidden" id="exp-stock">'
            + '<div class="ledger-head"><h3>经验素材</h3><span>当前持有数量 · 在「编辑资源」里修改</span></div>'
            + '<div class="exp-stock-grid">'
            + items.map(function (item) {
                return '<div class="exp-stock-item"><span class="exp-stock-label">' + item.label + '</span>'
                    + '<strong>' + fmt(item.value) + '</strong>'
                    + '<span class="exp-stock-note">' + item.note + '</span></div>';
            }).join('')
            + '</div></section>';
    }

    function bindResourceExp(resource) {
        if (state.game !== 'genshin') {
            return;
        }
        var charTotal = expBookTotal(resource);
        var artTotal = artifactItemTotal(resource);
        var charFrom = $('#exp-char-from');
        var charTo = $('#exp-char-to');
        var charPick = $('#exp-char-pick');
        var charLabel = $('#exp-char-name-label');
        var charAdd = $('#exp-char-add');
        var charRowsEl = $('#exp-char-rows');
        var charSum = $('#exp-char-sum');
        var charOut = $('#exp-char-result');
        var artOut = $('#exp-art-result');
        var flowerWl = $('#exp-flower-wl');
        var flowerPer = $('#exp-flower-per');
        var flowerResult = $('#exp-flower-result');
        var flowerSum = $('#exp-flower-sum');
        if (!charFrom || !charTo || !charRowsEl || !charOut || !artOut) {
            return;
        }
        var charRows = [];
        var selectedChar = '';

        function syncToOptions() {
            var from = toInt(charFrom.value);
            var previous = toInt(charTo.value);
            var levels = CHAR_LEVELS.filter(function (lv) {
                return lv > from;
            });
            var keep = levels.indexOf(previous) >= 0 ? previous : (levels[0] || '');
            charTo.innerHTML = levels.map(function (lv) {
                return '<option value="' + lv + '"' + (lv === keep ? ' selected' : '') + '>'
                    + lv + '</option>';
            }).join('');
        }

        function renderChar() {
            var needed = 0;
            charRows.forEach(function (row) {
                var plan = levelPlan(row.from, row.to);
                row.exp = plan.exp;
                row.stars = plan.stars;
                needed += plan.exp;
            });

            charRowsEl.innerHTML = charRows.map(function (row, index) {
                return '<div class="exp-row"><span>' + esc(row.name || ('角色 ' + (index + 1)))
                    + ' · Lv ' + row.from + ' → <strong>Lv ' + row.to + '</strong>'
                    + ' · 需 ' + fmt(row.exp) + ' 经验'
                    + (row.stars ? ' · 无主的命星 ' + row.stars + ' 枚' : '') + '</span>'
                    + '<button class="exp-row-del" type="button" data-index="' + index + '" aria-label="删除">×</button></div>';
            }).join('');

            if (charRows.length) {
                charSum.hidden = false;
                charSum.innerHTML = '已保留 ' + charRows.length + ' 个角色 · 合计需要 <strong>'
                    + fmt(needed) + '</strong> 经验 · 可用 ' + fmt(charTotal)
                    + (needed > charTotal
                        ? ' · 还差 <strong>' + fmt(needed - charTotal) + '</strong>'
                        : ' · 剩余 ' + fmt(charTotal - needed));
            } else {
                charSum.hidden = true;
                charSum.innerHTML = '';
            }

            var available = Math.max(0, charTotal - needed);
            var plan = levelPlan(toInt(charFrom.value), toInt(charTo.value));
            charOut.innerHTML = 'Lv ' + plan.from + ' → <strong>Lv ' + plan.to + '</strong>'
                + ' · 需 ' + fmt(plan.exp) + ' 经验'
                + (plan.stars ? ' · 无主的命星 ' + plan.stars + ' 枚' : '')
                + (plan.exp > available
                    ? ' · 还差 ' + fmt(plan.exp - available)
                    : ' · 可用 ' + fmt(available) + '，足够');
            renderFlower(plan, available, needed);
        }

        function renderFlower(plan, available, needed) {
            if (!flowerWl || !flowerPer || !flowerResult || !flowerSum) {
                return;
            }
            var level = Math.max(0, Math.min(9, toInt(flowerWl.value)));
            localStorage.setItem(EXP_FLOWER_LEVEL_KEY, String(level));
            var per = expFlowerPerRun(level);
            flowerPer.textContent = '每次 ' + per.books + ' ≈ ' + fmt(per.min) + '–'
                + fmt(per.max) + ' 经验 · 20 树脂';

            if (plan.exp <= 0) {
                flowerResult.innerHTML = '当前等级已越过 90 级，只消耗无主的命星，不需要打经验花';
            } else {
                flowerResult.innerHTML = '当前选择：'
                    + expFlowerRunsText(expFlowerPlan(plan.exp - available, level));
            }

            if (charRows.length) {
                var deficit = Math.max(0, needed - charTotal);
                flowerSum.hidden = false;
                flowerSum.innerHTML = '已保留 ' + charRows.length + ' 个角色 · '
                    + (deficit > 0
                        ? '合计还差 ' + fmt(deficit) + ' 经验，' + expFlowerRunsText(expFlowerPlan(deficit, level))
                        : '经验书已足够（剩余 ' + fmt(charTotal - needed) + ' 经验）');
            } else {
                flowerSum.hidden = true;
                flowerSum.innerHTML = '';
            }
        }

        function addChar() {
            charRows.push({
                name: selectedChar,
                from: toInt(charFrom.value),
                to: toInt(charTo.value)
            });
            selectedChar = '';
            if (charLabel) {
                charLabel.textContent = '选择角色';
            }
            charFrom.value = '1';
            syncToOptions();
            renderChar();
        }

        if (charPick && charLabel) {
            charPick.addEventListener('click', function () {
                openNamePicker(selectedChar, function (name) {
                    selectedChar = name;
                    charLabel.textContent = name;
                }, {
                    names: nameLists('genshin').characters,
                    label: '角色',
                    title: '选择角色'
                });
            });
        }

        if (charAdd && charRowsEl) {
            charAdd.addEventListener('click', addChar);
            charRowsEl.addEventListener('click', function (event) {
                var target = event.target.closest('.exp-row-del');
                if (!target) {
                    return;
                }
                charRows.splice(Number(target.getAttribute('data-index')), 1);
                renderChar();
            });
        }

        function renderArt() {
            var count = Math.floor(artTotal / FIVE_STAR_ARTIFACT_EXP);
            var rest = artTotal % FIVE_STAR_ARTIFACT_EXP;
            artOut.innerHTML = '可升满 <strong>' + fmt(count) + '</strong> 个五星圣遗物（+0 → +20）'
                + ' · 剩余 ' + fmt(rest) + ' 经验'
                + (rest > 0 ? '（距下一个还差 ' + fmt(FIVE_STAR_ARTIFACT_EXP - rest) + '）' : '');
        }

        charFrom.addEventListener('change', function () {
            syncToOptions();
            renderChar();
        });
        charTo.addEventListener('change', renderChar);
        if (flowerWl) {
            flowerWl.addEventListener('change', renderChar);
        }
        syncToOptions();
        renderChar();
        renderArt();
    }

    function loadDashboard() {
        var el = $('#view-dashboard');
        var g = gameConfig();
        el.innerHTML = '<div class="loading">加载中…</div>';

        return api('/api/stats/overview').then(function (data) {
            var resource = data.resource;
            var total = resource.totalPulls || 0;
            var currencyPulls = resource.pullsFromPrimogems || 0;
            var limited = resource.intertwinedFates || 0;
            var standard = resource.acquaintedFates || 0;
            var currencyPct = total > 0 ? Math.round(currencyPulls * 100 / total) : 0;
            var fatePct = total > 0 ? 100 - currencyPct : 0;
            var daily = resource.dailyPrimogems || 0;
            var dailyPulls = Math.round(daily / (resource.primogemsPerPull || 160) * 10) / 10;

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
                + '<div class="asset asset-daily">'
                + '<span class="asset-label">每日积累</span>'
                + '<strong class="asset-value">+' + esc(fmt(daily))
                + '<span class="asset-unit">' + esc(g.currency) + '/天</span></strong>'
                + '<span class="asset-note">≈ ' + num(dailyPulls) + ' 抽/天 · 每天自动计入资源</span>'
                + '</div>'
                + '<div class="fortune-actions">'
                + '<button class="btn btn-outline" id="resource-enter" type="button">录入资源</button>'
                + '</div>'
                + '</aside>'
                + '</section>'

                + '<div class="inventory">'
                + resourceTile('gem', g.currency, resource.primogems, '≈ ' + fmt(currencyPulls) + ' 抽')
                + resourceTile('coin', g.credit, resource.mora, '游戏内通用货币')
                + resourceTile('fate', g.fateLimited, limited, '限定池 · 1 枚 = 1 抽')
                + resourceTile('fateStandard', g.fateStandard, standard, '常驻池 · 不计入合计')
                + resourceTile('crystal', g.genesisCrystal, resource.genesisCrystals || 0, '可兑换 ' + g.currency)
                + '</div>'

                + (state.game === 'genshin'
                    ? '<div class="resource-tools">'
                        + '<button class="btn btn-text" id="resource-stock" type="button" aria-expanded="false">经验素材</button>'
                        + '<button class="btn btn-text" id="resource-exp" type="button" aria-expanded="false">养成经验</button>'
                        + '</div>'
                    : '')

                + resourceStockHtml(resource)
                + resourceExpHtml(resource)

                + '<section class="ledger" id="resource-ledger">'
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
                + ' ' + esc(g.currency) + '；每日 ' + esc(fmt(daily)) + ' ' + esc(g.currency)
                + ' 按自然日自动累加</p>'
                + '</section>';

            var enterBtn = $('#resource-enter');
            if (enterBtn) {
                enterBtn.addEventListener('click', function () {
                    var actions = [];
                    if (state.game === 'genshin') {
                        actions.push({
                            key: 'ocr',
                            label: '识图填充',
                            run: function () {
                                return openResourceOcr(resource);
                            }
                        });
                        actions.push({
                            key: 'scan',
                            label: '电脑识图工具',
                            run: launchResourceScan
                        });
                    }
                    actions.push({
                        key: 'ai',
                        label: 'AI 自然语言录入',
                        primary: true,
                        run: openAiInput
                    });
                    actions.push({
                        key: 'manual',
                        label: '手动填写',
                        run: function () {
                            return editResource(resource);
                        }
                    });
                    guard(function () {
                        return openEntryMenu('录入资源', '选择录入方式', actions);
                    });
                });
            }

            function bindToggle(buttonId, panelId) {
                var button = $(buttonId);
                var panel = $(panelId);
                if (!button || !panel) {
                    return;
                }
                button.addEventListener('click', function () {
                    var show = panel.classList.contains('hidden');
                    panel.classList.toggle('hidden', !show);
                    button.classList.toggle('active', show);
                    button.setAttribute('aria-expanded', show ? 'true' : 'false');
                });
            }

            bindToggle('#resource-stock', '#exp-stock');
            bindToggle('#resource-exp', '#exp-panel');

            bindResourceExp(resource);
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
            // 记录按时间升序参与周期累计，展示时最新的一根在上
            return points.reverse();
        }
        return (list || []).map(function (item) {
            return {
                name: item.itemName || '未命名',
                type: item.itemType,
                pool: item.pool || '未知卡池',
                value: Number(item.pityCount) || 0,
                up: item.isUp === true
            };
        }).reverse();
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
            return '<div class="pull-row' + (point.up ? '' : ' lost') + '" title="' + esc(poolLabel(point.pool)) + ' · '
                + (point.up ? 'UP' : '歪') + ' · 用了 ' + point.value + ' 抽">'
                + '<div class="pull-label">'
                + avatarHtml({ itemName: point.name, itemType: point.type })
                + '<span class="pull-name">' + esc(point.name) + '</span></div>'
                + '<div class="pull-track"><span class="pull-bar" style="width:' + width + '%"></span></div>'
                + '<span class="pull-val">' + point.value + '</span>'
                + '</div>';
        }).join('') + '</div>';
    }

    /** 卡池筛选按钮已上移到「保底分析」顶部，图表跟随同一筛选。 */
    function pullPanelHtml() {
        return '<section class="panel pull-panel">'
            + '<h3>五星抽数<span class="pool-tag">每次五星用了多少抽</span>'
            + '<button class="btn btn-text pull-toggle" type="button" id="pull-toggle">显示真实抽数</button></h3>'
            + '<p class="pull-summary" id="pull-summary"></p>'
            + '<div class="pull-chart-wrap" id="pull-chart-wrap"></div></section>';
    }

    function renderPullChart(real) {
        var all = (cache.stats && cache.stats.fiveStarRecords) || [];
        cache.pullReal = real;
        var selected = cache.statsPool || PULL_POOL_ALL;
        var list = selected === PULL_POOL_ALL ? all : all.filter(function (item) {
            return (item.pool || '未知卡池') === selected;
        });
        var points = pullChartPoints(list, real);
        var wrap = $('#pull-chart-wrap');
        var summary = $('#pull-summary');
        var toggle = $('#pull-toggle');
        if (!wrap) {
            return;
        }
        wrap.innerHTML = pullChartHtml(points, selected === PULL_POOL_ALL
            ? '还没有五星记录' : poolLabel(selected) + ' 还没有五星记录');
        if (toggle) {
            toggle.textContent = real ? '显示原始抽数' : '显示真实抽数';
            toggle.classList.toggle('active', real);
        }
        var total = 0;
        points.forEach(function (point) {
            total += point.value;
        });
        if (summary) {
            var scope = selected === PULL_POOL_ALL ? '' : poolLabel(selected) + '：';
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
        cache.pullReal = false;
        toggle.addEventListener('click', function () {
            renderPullChart(!cache.pullReal);
        });
        renderPullChart(false);
    }

    /** 保底分析的统一卡池筛选：同时刷新保底面板与五星抽数图表。 */
    function bindStatsPoolFilter(data) {
        var bar = $('#stats-pool-filter');
        if (!bar) {
            return;
        }
        bar.addEventListener('click', function (event) {
            var btn = event.target.closest ? event.target.closest('.pull-pool') : null;
            if (!btn || !bar.contains(btn)) {
                return;
            }
            var pool = btn.getAttribute('data-pool');
            if (pool === cache.statsPool) {
                return;
            }
            cache.statsPool = pool;
            cache.statsPools[state.game] = pool;
            Array.prototype.forEach.call(bar.querySelectorAll('.pull-pool'), function (item) {
                item.classList.toggle('active', item.getAttribute('data-pool') === pool);
            });
            var wrap = $('#stats-pity-content');
            if (wrap) {
                var html = statsPityContentHtml(data, pool);
                wrap.innerHTML = html;
                wrap.hidden = !html;
            }
            renderPullChart(cache.pullReal);
        });
    }

    function loadStats() {
        var el = $('#view-stats');
        var g = gameConfig();
        el.innerHTML = '<div class="loading">加载中…</div>';

        return Promise.all([
            api('/api/stats/overview'),
            api('/api/calendar').catch(function () {
                return null;
            })
        ]).then(function (responses) {
            var data = responses[0];
            var calendar = state.game === 'genshin'
                ? (loadLiveCalendar('genshin') || responses[1])
                : null;
            cache.calendar = calendar;
            var resource = data.resource;
            var name = (state.user && (state.user.nickname || state.user.username)) || '旅行者';
            cache.stats = data;
            cache.statsTab = cache.statsTab || 'overview';
            cache.statsPools = cache.statsPools || {};
            var poolOptions = statsPoolOptions(data);
            var activePool = cache.statsPools[state.game] || PULL_POOL_ALL;
            var poolExists = poolOptions.some(function (option) {
                return option.key === activePool;
            });
            if (!poolExists) {
                activePool = PULL_POOL_ALL;
            }
            cache.statsPools[state.game] = activePool;
            cache.statsPool = activePool;
            var tab = cache.statsTab === 'analysis' ? 'pity' : cache.statsTab;
            cache.statsTab = tab;

            var pityHtml = statsPityContentHtml(data, activePool);

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
                + statCard('五星出货', data.fiveStarWishes, '出货率 ' + data.fiveStarRate + '%', 'gold')
                + statCard('四星出货', data.fourStarWishes, '占总记录 '
                    + (data.wishCount ? Math.round(data.fourStarWishes * 100 / data.wishCount) : 0) + '%', 'purple')
                + statCard('五星平均抽数', data.avgFiveStarPity, '按记录中的保底进度')
                + '</div>'
                + '<section class="panel"><h3>最近出货<span class="pool-tag">最近 '
                + (data.recentWishes || []).length + ' 条</span></h3>'
                + miniWishes(data.recentWishes) + '</section>'
                + '</div>'

                + statsSection('pity', tab)
                + statsPoolFilterHtml(data, activePool)
                + '<div class="stats-duo" id="stats-pity-content"' + (pityHtml ? '' : ' hidden') + '>'
                + pityHtml + '</div>'
                + luckPanelHtml(data)
                + pullPanelHtml()
                + '<section class="panel"><h3>卡池分布<span class="pool-tag">各卡池抽数占比</span></h3>'
                + poolBars(data.poolDistribution) + '</section>'
                + '</div>'

                + statsSection('expect', tab)
                + calendarPanelHtml(calendar, resource.primogemsPerPull || 160)
                + expectationPanelHtml(data)
                + '</div>'

                + statsSection('resource', tab)
                + resourcePanelHtml()
                + '</div>';

            bindStatsTabs();
            bindResourcePanel();
            bindStatsPoolFilter(data);
            bindPullChart();
            bindExpectation(data);
            bindCalendar(data);
            bindStatsDelegates();
        }).catch(function (err) {
            if (state.token) {
                el.innerHTML = errorHtml(err);
            }
        });
    }

    /* ---------------- 抽卡记录 ---------------- */

    function wishRow(item) {
        var name = item.itemName || '未命名';
        var rarity = Number(item.rarity) || 3;
        var fiveStar = rarity >= 5;
        var meta = ['<span>' + esc(item.itemType || '—') + '</span>'];
        if (fiveStar) {
            meta.push('<span class="meta-pill ' + (item.isUp ? 'good' : 'bad') + '">'
                + (item.isUp ? 'UP 内' : '未中 UP') + '</span>');
            meta.push('<span class="meta-pill pity-pill">' + (item.pityCount || 1) + ' 抽</span>');
            if (item.captureTriggered) {
                meta.push('<span class="meta-pill capture-mark">捕获明光</span>');
            }
        }
        return '<div class="record-row rarity-' + rarity + '" data-id="' + item.id + '">'
            + '<div class="record-main">'
            + '<input type="checkbox" class="record-check" data-check'
            + (state.wishSelected.has(item.id) ? ' checked' : '') + ' aria-label="选择"/>'
            + '<div class="record-avatar">'
            + (avatarHtml(item) || '<span>' + esc(name.charAt(0)) + '</span>')
            + '</div>'
            + '<div class="record-info">'
            + '<div class="record-title">'
            + '<span class="name' + (rarity === 3 ? ' muted' : '') + '">' + esc(name) + '</span>'
            + '<span class="stars">' + starText(rarity) + '</span>'
            + '<span class="pool-tag' + (item.isUp ? ' up' : '') + '">'
            + esc(poolLabel(item.pool) || '未知卡池') + '</span>'
            + '</div>'
            + '<div class="record-sub">' + meta.join('') + '</div>'
            + '</div>'
            + '<div class="record-time">' + esc(item.wishTime || '') + '</div>'
            + '<div class="record-actions">'
            + '<button class="icon-btn" type="button" data-act="edit">编辑</button>'
            + '<button class="icon-btn danger" type="button" data-act="delete">删除</button>'
            + '</div>'
            + '</div>'
            + '</div>';
    }

    function pad2(value) {
        var text = String(value);
        return text.length < 2 ? '0' + text : text;
    }

    /** 日期输入只保留 4 位年份，并自动补 YYYY-MM-DD 的分隔符 */
    function formatWishDate(value) {
        var text = String(value || '');
        var separated = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
        if (separated) {
            return separated[1] + '-' + pad2(separated[2]) + '-' + pad2(separated[3]);
        }
        var digits = text.replace(/\D/g, '').slice(0, 8);
        if (digits.length <= 4) {
            return digits;
        }
        if (digits.length <= 6) {
            return digits.slice(0, 4) + '-' + digits.slice(4);
        }
        return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
    }

    function isValidDateText(value) {
        if (!value) {
            return true;
        }
        var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) {
            return false;
        }
        var year = Number(match[1]);
        var month = Number(match[2]);
        var day = Number(match[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) {
            return false;
        }
        var date = new Date(year, month - 1, day);
        return date.getFullYear() === year
            && date.getMonth() === month - 1
            && date.getDate() === day;
    }

    function wishDateFieldHtml(id, value) {
        return '<div class="wish-date-field">'
            + '<input id="' + id + '" class="input wish-date" type="text" inputmode="numeric"'
            + ' maxlength="10" placeholder="YYYY-MM-DD" autocomplete="off" value="' + esc(value) + '"/>'
            + '<button class="wish-date-pick" type="button" data-date-pick="' + id + '" aria-label="选择日期">'
            + '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">'
            + '<rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/>'
            + '<path d="M2 7h12M5 2v3M11 2v3" fill="none" stroke="currentColor" stroke-width="1.2"/>'
            + '</svg></button>'
            + '<input id="' + id + '-picker" class="wish-date-native" type="date" tabindex="-1" aria-hidden="true"/>'
            + '</div>';
    }

    function loadWishes() {
        var el = $('#view-wishes');
        var pools = gameConfig().pools;
        var poolOptions = [''].concat(pools).map(function (pool) {
            return '<option value="' + pool + '"' + (state.wishPool === pool ? ' selected' : '') + '>'
                + (pool ? poolLabel(pool) : '全部卡池') + '</option>';
        }).join('');

        el.innerHTML =
            '<div class="page-head">'
            + '<div><p class="eyebrow">Wish Records</p><h2>抽卡记录</h2><p class="sub">五星出货记录 · 记录抽到五星用了多少抽 · 支持链接导入</p></div>'
            + '<div class="head-actions">'
            + '<button class="btn btn-primary" id="wish-enter" type="button">+ 录入记录</button>'
            + '</div>'
            + '</div>'
            + '<div class="toolbar">'
            + '<div class="toolbar-filters">'
            + '<select id="wish-pool" class="input">' + poolOptions + '</select>'
            + '<input id="wish-keyword" class="input wish-search" type="search" placeholder="搜索名称"'
            + ' value="' + esc(state.wishKeyword) + '"/>'
            + wishDateFieldHtml('wish-start', state.wishStart)
            + wishDateFieldHtml('wish-end', state.wishEnd)
            + '<label class="filter-check"><input type="checkbox" id="wish-only-five"'
            + (state.wishOnlyFive ? ' checked' : '') + '/>只看五星</label>'
            + '<div class="toolbar-actions">'
            + '<button class="btn btn-text btn-sm" id="wish-filter-reset" type="button">重置筛选</button>'
            + '<button class="btn btn-text btn-sm" id="wish-batch-edit" type="button">批量编辑本页</button>'
            + '<button class="btn btn-text btn-sm" id="wish-select-all" type="button">全选本页</button>'
            + '<button class="btn btn-text btn-sm btn-danger" id="wish-batch-del" type="button" disabled>批量删除</button>'
            + '</div>'
            + '</div>'
            + '</div>'
            + '<div id="wish-list"><div class="loading">加载中…</div></div>'
            + '<div id="wish-pager" class="pager"></div>';

        $('#wish-enter').addEventListener('click', function () {
            guard(function () {
                return openEntryMenu('录入抽卡记录', '选择录入方式', [
                    {
                        key: 'manual',
                        label: '手动录入五星',
                        primary: true,
                        run: function () {
                            return openEditor('wishes', null);
                        }
                    },
                    { key: 'ai', label: 'AI 自然语言录入', run: openAiInput },
                    {
                        key: 'ocr',
                        label: '截图识别',
                        run: function () {
                            return openOcrDialog();
                        }
                    },
                    { key: 'link', label: '链接导入（自动读取）', run: importFromLink }
                ]);
            });
        });

        $('#wish-only-five').addEventListener('change', function (event) {
            state.wishOnlyFive = event.target.checked;
            state.pages.wishes = 1;
            refreshWishList();
        });

        var keywordInput = $('#wish-keyword');
        var keywordTimer = null;
        if (keywordInput) {
            keywordInput.addEventListener('input', function (event) {
                var value = event.target.value.trim();
                clearTimeout(keywordTimer);
                keywordTimer = setTimeout(function () {
                    state.wishKeyword = value;
                    state.pages.wishes = 1;
                    refreshWishList();
                }, 400);
            });
        }

        function bindWishDateField(id, key) {
            var input = $('#' + id);
            var picker = $('#' + id + '-picker');
            var button = $('[data-date-pick="' + id + '"]');
            if (!input) {
                return;
            }
            function apply(value) {
                input.value = value;
                state[key] = value;
                state.pages.wishes = 1;
                refreshWishList();
            }
            input.addEventListener('input', function () {
                var formatted = formatWishDate(input.value);
                if (formatted !== input.value) {
                    input.value = formatted;
                }
                if (formatted === '' || isValidDateText(formatted)) {
                    state[key] = formatted;
                    state.pages.wishes = 1;
                    refreshWishList();
                }
            });
            input.addEventListener('blur', function () {
                if (input.value && !isValidDateText(input.value)) {
                    toast('日期请填写 YYYY-MM-DD，年份最多 4 位', 'error');
                    input.value = state[key] || '';
                    return;
                }
                if (state[key] !== input.value) {
                    apply(input.value);
                }
            });
            input.addEventListener('keydown', function (event) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    input.blur();
                }
            });
            if (!button || !picker) {
                return;
            }
            button.addEventListener('click', function () {
                picker.value = isValidDateText(input.value) ? input.value : '';
                if (typeof picker.showPicker === 'function') {
                    try {
                        picker.showPicker();
                    } catch (e) {
                        picker.focus();
                        picker.click();
                    }
                } else {
                    picker.focus();
                    picker.click();
                }
            });
            picker.addEventListener('change', function () {
                if (picker.value) {
                    apply(picker.value);
                }
            });
        }

        bindWishDateField('wish-start', 'wishStart');
        bindWishDateField('wish-end', 'wishEnd');

        var resetBtn = $('#wish-filter-reset');
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                state.wishPool = '';
                state.wishKeyword = '';
                state.wishStart = '';
                state.wishEnd = '';
                state.wishOnlyFive = false;
                state.pages.wishes = 1;
                loadWishes();
            });
        }

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

    function refreshWishList() {
        var box = $('#wish-list');
        var pager = $('#wish-pager');
        state.wishSelected.clear();
        updateBatchDelBtn();
        updateSelectAllBtn();
        var params = new URLSearchParams();
        params.set('page', state.pages.wishes);
        params.set('size', '10');
        if (state.wishOnlyFive) {
            params.set('rarity', '5');
        }
        if (state.wishPool) {
            params.set('pool', state.wishPool);
        }
        if (state.wishKeyword) {
            params.set('keyword', state.wishKeyword);
        }
        if (state.wishStart) {
            params.set('start', state.wishStart);
        }
        if (state.wishEnd) {
            params.set('end', state.wishEnd);
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

    /* 录入五星时只提供五星角色与五星武器 / 光锥 */
    function fiveStarNameOptions() {
        var lists = nameLists(state.game);
        var protagonist = PROTAGONISTS[state.game];
        var characters = lists.characters.filter(function (name) {
            return name !== protagonist && !isFourStarCharacter(state.game, name);
        });
        return characters.concat(lists.weapons);
    }

    function formConfig(type, isEdit) {
        var g = gameConfig();
        var fields = [
            { key: 'itemName', label: '选择角色 / 物品', type: 'name-picker', full: true,
                options: isEdit ? null : fiveStarNameOptions() },
            { key: 'rarity', type: 'hidden', default: 5 },
            {
                key: 'pool', label: '卡池', type: 'select',
                options: g.pools.map(function (pool) {
                    return { value: pool, label: poolLabel(pool) };
                }),
                default: g.pools[0]
            },
            { key: 'pityCount', label: '抽到五星用了多少抽', type: 'number', min: 1, max: 90, default: 1 }
        ];
        if (state.game === 'genshin') {
            fields.push({
                key: 'captureTriggered', label: '是否触发捕获明光', type: 'select',
                options: [{ value: true, label: '是' }, { value: false, label: '否' }], default: false
            });
        }
        fields.push({ key: 'wishTime', label: '抽卡时间', type: 'datetime', full: true, default: nowLocal() });
        return {
            title: '抽卡',
            endpoint: '/api/wishes',
            fields: fields
        };
    }

    /** 混池 / 常驻 / 联动：角色与武器都可能出，选名称时不自动改卡池 */
    function isMixedPool(g, pool) {
        return pool === '常驻' || pool === '集录祈愿' || pool === '联动';
    }

    /** 卡池与名称候选联动：武器池只列武器，角色池只列角色，混池列出全部 */
    function bindWishPoolPicker(form, fields) {
        var nameField = fields.filter(function (field) { return field.key === 'itemName'; })[0];
        var poolEl = form.querySelector('[name="pool"]');
        var nameEl = form.querySelector('[name="itemName"]');
        if (!nameField || !poolEl || !nameEl) {
            return;
        }
        var trigger = $('.name-picker-trigger[data-picker-key="itemName"]', form);
        var g = gameConfig();
        var lists = nameLists(state.game);
        // 编辑已有记录时名称可能不在五星名单里，用全量名单作为基准，避免被清空
        var base = (nameField.options || lists.characters.concat(lists.weapons)).slice();

        function candidates(pool) {
            if (pool === g.weaponPool) {
                return base.filter(function (name) {
                    return lists.weapons.indexOf(name) >= 0;
                });
            }
            if (pool === g.charPool) {
                return base.filter(function (name) {
                    return lists.weapons.indexOf(name) < 0;
                });
            }
            return base.slice();
        }

        function apply(pool) {
            nameField.options = candidates(pool);
            if (nameEl.value && nameField.options.indexOf(nameEl.value) < 0) {
                nameEl.value = '';
                if (trigger) {
                    updateNameTrigger(trigger, '');
                }
            }
        }

        apply(poolEl.value);
        poolEl.addEventListener('change', function () {
            apply(poolEl.value);
        });
    }

    /** 名称图标：角色取头像、武器 / 光锥取图标，缺失时回退首字 */
    function itemIconUrl(name) {
        var lists = nameLists(state.game);
        var avatarMap = (window.SG_AVATARS || {})[state.game] || {};
        var weaponMap = (window.SG_WEAPON_ICONS || {})[state.game] || {};
        return lists.characters.indexOf(name) >= 0
            ? (avatarMap[name] || '')
            : (weaponMap[name] || '');
    }

    function nameIconHtml(name, sizeClass) {
        var url = itemIconUrl(name);
        return '<span class="name-picker-icon' + (sizeClass ? ' ' + sizeClass : '') + '">'
            + '<span>' + esc((name || '?').charAt(0)) + '</span>'
            + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" onerror="this.remove()"/>' : '')
            + '</span>';
    }

    /** 头像 + 名字的网格选择弹窗，一排 5 个；opts.names 用于收藏按类别限定名单 */
    function openNamePicker(currentName, onPick, opts) {
        var g = gameConfig();
        var options = opts || {};
        var lists = nameLists(state.game);
        var groups;
        if (options.names) {
            // 传入限定名单时仍按角色 / 武器分组，只有一类时退化成单页签
            var chosen = options.names.slice();
            groups = [
                { key: 'characters', label: g.itemTypes[0], list: chosen.filter(function (name) {
                    return lists.weapons.indexOf(name) < 0;
                }) },
                { key: 'weapons', label: g.itemTypes[1], list: chosen.filter(function (name) {
                    return lists.weapons.indexOf(name) >= 0;
                }) }
            ].filter(function (group) {
                return group.list.length > 0;
            });
            if (!groups.length) {
                groups = [{ key: 'custom', label: options.label || '可选', list: chosen }];
            }
        } else {
            /* 抽卡记录不会出现主角，角色分页里排除 */
            var protagonist = PROTAGONISTS[state.game];
            var characters = lists.characters.filter(function (name) {
                return name !== protagonist;
            });
            groups = [
                { key: 'characters', label: g.itemTypes[0], list: characters },
                { key: 'weapons', label: g.itemTypes[1], list: lists.weapons }
            ].filter(function (group) {
                return group.list.length > 0;
            });
        }
        var active = groups[0] ? groups[0].key : '';
        if (currentName && lists.weapons.indexOf(currentName) >= 0) {
            var weaponGroup = groups.filter(function (group) {
                return group.key === 'weapons';
            })[0];
            if (weaponGroup) {
                active = 'weapons';
            }
        }

        var mask = document.createElement('div');
        mask.className = 'modal-mask name-picker-mask';
        mask.innerHTML = '<div class="modal name-picker-modal">'
            + '<header><h3>' + esc(options.title || '选择角色 / 物品') + '</h3>'
            + '<button class="modal-close" type="button" aria-label="关闭">×</button></header>'
            + '<div class="name-picker-search">'
            + '<input type="search" class="input name-picker-search-input"'
            + ' placeholder="搜索角色 / 物品名称" autocomplete="off"/></div>'
            + (groups.length > 1 ? '<div class="name-picker-tabs">' + groups.map(function (group) {
                return '<button type="button" class="name-picker-tab'
                    + (group.key === active ? ' active' : '') + '" data-key="' + group.key + '">'
                    + esc(group.label) + '<span>' + group.list.length + '</span></button>';
            }).join('') + '</div>' : '')
            + '<div class="name-picker-body"><div class="name-picker-grid"></div></div>'
            + '</div>';

        var grid = $('.name-picker-grid', mask);
        var tabs = $$('.name-picker-tab', mask);
        var tabsWrap = $('.name-picker-tabs', mask);
        var search = $('.name-picker-search-input', mask);

        function renderGrid() {
            var keyword = String(search.value || '').trim().toLowerCase();
            /* 搜索时隐藏分类页签，结果跨分类合并，避免在错误页签里搜不到 */
            if (tabsWrap) {
                tabsWrap.style.display = keyword ? 'none' : '';
            }
            var group = groups.filter(function (item) {
                return item.key === active;
            })[0] || groups[0];
            var list = [];
            if (keyword) {
                var seen = {};
                groups.forEach(function (item) {
                    item.list.forEach(function (name) {
                        var lower = name.toLowerCase();
                        if (!seen[lower] && lower.indexOf(keyword) >= 0) {
                            seen[lower] = true;
                            list.push(name);
                        }
                    });
                });
            } else if (group) {
                /* 原记录名称不在名单时，在当前分组置顶保留，避免改名后无法还原；主角不在此列 */
                list = group.list.slice();
                if (currentName && currentName !== PROTAGONISTS[state.game]
                        && lists.characters.indexOf(currentName) < 0
                        && lists.weapons.indexOf(currentName) < 0) {
                    list.unshift(currentName);
                }
            }
            if (!list.length) {
                grid.innerHTML = '<div class="name-picker-empty">'
                    + (keyword ? '没有匹配的名称' : '暂无可选名称') + '</div>';
                return;
            }
            grid.innerHTML = list.map(function (name) {
                return '<button type="button" class="name-picker-cell'
                    + (name === currentName ? ' active' : '') + '" data-name="' + esc(name) + '">'
                    + nameIconHtml(name, 'md')
                    + '<span class="name-picker-name">' + esc(name) + '</span></button>';
            }).join('');
        }

        function close() {
            mask.remove();
        }

        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                active = tab.dataset.key;
                tabs.forEach(function (item) {
                    item.classList.toggle('active', item === tab);
                });
                renderGrid();
            });
        });

        grid.addEventListener('click', function (event) {
            var cell = event.target.closest('.name-picker-cell');
            if (!cell) {
                return;
            }
            var name = cell.dataset.name;
            close();
            if (typeof onPick === 'function') {
                onPick(name);
            }
        });

        search.addEventListener('input', renderGrid);
        $('.modal-close', mask).addEventListener('click', close);

        renderGrid();
        document.body.appendChild(mask);
        search.focus();
    }

    function nameTriggerHtml(key, name) {
        return '<button type="button" class="input name-picker-trigger" data-picker-key="' + esc(key) + '">'
            + '<span class="name-picker-value">' + nameTriggerValueHtml(name) + '</span>'
            + '<span class="name-picker-arrow">▾</span></button>';
    }

    function nameTriggerValueHtml(name) {
        return name
            ? nameIconHtml(name, 'sm') + '<b>' + esc(name) + '</b>'
            : '<b class="name-picker-placeholder">请选择角色 / 物品</b>';
    }

    function updateNameTrigger(btn, name) {
        var valueEl = $('.name-picker-value', btn);
        if (valueEl) {
            valueEl.innerHTML = nameTriggerValueHtml(name);
        }
    }

    function namePickerHtml(field, current) {
        var currentName = String(current === undefined || current === null ? '' : current);
        return '<label class="field field-full"><span>' + esc(field.label) + '</span>'
            + '<input type="hidden" name="' + field.key + '" value="' + esc(currentName) + '"/>'
            + nameTriggerHtml(field.key, currentName)
            + '</label>';
    }

    function fieldHtml(field, value) {
        var current = value === undefined || value === null ? (field.default === undefined ? '' : field.default) : value;
        var wrapClass = 'field' + (field.full ? ' field-full' : '');
        var required = field.required ? ' required' : '';

        if (field.type === 'hidden') {
            return '<input type="hidden" name="' + field.key + '" value="' + esc(current) + '"/>';
        }

        if (field.type === 'name-picker') {
            return namePickerHtml(field, current);
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

        var valueText = current === null || current === undefined ? '' : String(current);
        if (field.type === 'datetime') {
            valueText = valueText.replace('T', ' ');
        }
        var attrs = ' name="' + field.key + '" value="' + esc(valueText) + '"';
        if (field.type === 'datetime') {
            attrs += ' type="text" placeholder="YYYY-MM-DD HH:mm 或 HH:mm:ss" autocomplete="off"'
                + ' maxlength="19" data-datetime="1"';
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
        if (field.readonly) {
            attrs += ' readonly';
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

            if (opts.onMount) {
                opts.onMount(mask, form);
            }

            $$('.name-picker-trigger', form).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var key = btn.dataset.pickerKey;
                    var input = form.querySelector('[name="' + key + '"]');
                    if (!input) {
                        return;
                    }
                    var field = fields.filter(function (item) {
                        return item.key === key;
                    })[0];
                    var pickerOpts = field && field.type === 'name-picker' && field.options
                        ? { names: field.options.slice(), title: '选择' + field.label }
                        : null;
                    openNamePicker(input.value, function (name) {
                        input.value = name;
                        updateNameTrigger(btn, name);
                        if (typeof opts.onNamePick === 'function') {
                            opts.onNamePick(key, name, form);
                        }
                    }, pickerOpts);
                });
            });

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
            values.wishTime = String(item.wishTime).replace(' ', 'T').slice(0, 19);
        }
        return values;
    }

    function openEditor(type, item, initial) {
        var isEdit = !!item;
        var config = formConfig(type, isEdit);
        var values = isEdit ? toFormValues(type, item) : (initial || null);

        return openForm((isEdit ? '编辑' : '新增') + config.title, config.fields, values, {
            validate: function (data) {
                if (!data.itemName) {
                    return '请选择角色 / 物品';
                }
                if (!data.pityCount || data.pityCount < 1 || data.pityCount > 90) {
                    return '抽到五星用了多少抽需在 1-90 之间';
                }
                return null;
            },
            onMount: function (mask, form) {
                bindWishPoolPicker(form, config.fields);
            },
            onNamePick: function (key, name, form) {
                if (key !== 'itemName') {
                    return;
                }
                var poolEl = form.querySelector('[name="pool"]');
                if (!poolEl) {
                    return;
                }
                var g = gameConfig();
                // 混池 / 常驻 / 联动里角色武器都有，保持用户自定义的卡池不动
                if (isMixedPool(g, poolEl.value)) {
                    return;
                }
                var isWeapon = nameLists(state.game).weapons.indexOf(name) >= 0;
                poolEl.value = isWeapon ? g.weaponPool : g.charPool;
            }
        }).then(function (data) {
            if (!data) {
                return null;
            }
            /* 类型由所选名称推断，是否 UP 按卡池常驻名单自动判定 */
            data.itemType = inferItemType(state.game, data.itemName)
                || (item && item.itemType) || gameConfig().itemTypes[0];
            data.isUp = inferIsUp(state.game, data.pool, data.itemName, data.itemType, data.wishTime);
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
        var time = item && item.wishTime ? String(item.wishTime).slice(0, 16) : '';

        return '<div class="batch-row has-time" data-index="' + index + '">'
            + '<span class="batch-no">' + (index + 1) + '</span>'
            + '<span class="batch-stars">' + starText(rarity) + '</span>'
            + '<input class="batch-name" type="text" maxlength="64" value="' + esc(name) + '"'
            + ' placeholder="角色 / 武器名称"/>'
            + '<label class="batch-up"><input class="batch-isup" type="checkbox"' + (up ? ' checked' : '') + '/>UP</label>'
            + '<input class="batch-pity" type="number" min="1" max="90" value="' + esc(pity) + '" title="用了多少抽"/>'
            + '<input class="batch-time" type="text" placeholder="YYYY-MM-DD HH:mm" maxlength="16"'
            + ' data-datetime="1" value="' + esc(time) + '"/>'
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
    }

    /* 抽卡链接导入：后端代理读取抽卡记录接口，避开浏览器跨域限制 */
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
                    return '请粘贴完整的抽卡记录链接';
                }
                return null;
            },
            onMount: function (mask, form) {
                bindGachaAuto(mask, form);
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
            }).catch(function (err) {
                var message = String(err && err.message ? err.message : '');
                // authkey 已过期：提示重新获取，而不是只弹一句失败
                if (/authkey|抽卡记录/i.test(message)) {
                    openChoice('抽卡链接已失效', message
                        + '。建议重新获取：先打开游戏内「抽卡记录」页面，再点「从本机自动读取」'
                        + '（日志和缓存都没有时会自动启用代理模式抓取新链接）。',
                        [
                            { key: 'retry', label: '重新获取链接', primary: true },
                            { key: 'cancel', label: '取消' }
                        ]).then(function (choice) {
                        if (choice === 'retry') {
                            return importFromLink();
                        }
                        return null;
                    });
                    return null;
                }
                throw err;
            });
        });
    }

    /* 桌面启动器：从本机日志 / webCaches / 代理获取带 authkey 的抽卡链接 */
    var gachaAutoTarget = null;

    function bindGachaAuto(mask, form) {
        if (!(window.chrome && window.chrome.webview)) {
            return;
        }
        var input = $('textarea[name="url"], input[name="url"]', mask);
        var foot = $('.modal-foot', mask);
        if (!input || !foot) {
            return;
        }
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-outline';
        button.textContent = '从本机自动读取';
        button.addEventListener('click', function () {
            button.disabled = true;
            button.textContent = '正在读取本机记录…';
            window.chrome.webview.postMessage({ action: 'gachaUrlAuto', game: state.game });
        });
        foot.insertBefore(button, $('.modal-cancel', mask));
        gachaAutoTarget = { mask: mask, input: input, button: button };
        // 弹窗关闭时通知启动器停止代理并恢复系统代理设置
        var observer = new MutationObserver(function () {
            if (!mask.isConnected) {
                observer.disconnect();
                gachaAutoTarget = null;
                window.chrome.webview.postMessage({ action: 'gachaProxyStop' });
            }
        });
        observer.observe(document.body, { childList: true });
    }

    function resetGachaButton() {
        if (!gachaAutoTarget) {
            return;
        }
        gachaAutoTarget.button.disabled = false;
        gachaAutoTarget.button.textContent = '从本机自动读取';
    }

    /* ---------------- UIGF / SRGF 互转 ---------------- */

    function onUigfFileSelected(event, game) {
        var file = event.target.files && event.target.files[0];
        event.target.value = '';
        if (!file) {
            return;
        }
        if (!/\.json$/i.test(file.name)) {
            toast('UIGF / SRGF 只支持 .json 文件', 'error');
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            toast('文件不能超过 20MB', 'error');
            return;
        }
        var reader = new FileReader();
        reader.onload = function () {
            guard(function () {
                return importUigf(file.name, String(reader.result || ''), game);
            });
        };
        reader.onerror = function () {
            toast('读取文件失败', 'error');
        };
        reader.readAsText(file, 'utf-8');
    }

    /** UIGF / SRGF 导入：先预演统计，确认后再写入。 */
    function importUigf(fileName, text, game) {
        var g = GAMES[game || state.game] || gameConfig();
        var formatName = (game === 'starrail' ? 'SRGF' : 'UIGF');
        return api('/api/wishes/import-uigf?preview=true&mode=merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8' },
            body: text
        }, game).then(function (preview) {
            return openForm('导入 ' + formatName + ' · ' + g.fullName, [
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
                hint: '文件：' + fileName + '。共 ' + preview.total + ' 条，将新增 '
                    + preview.imported + ' 条，跳过重复 ' + preview.skipped + ' 条，按规则忽略 '
                    + preview.filtered + ' 条'
                    + (preview.invalid ? '，格式无效 ' + preview.invalid + ' 条' : '')
                    + '。多 UID 文件会按 UID 分别保留。',
                submitText: '确认导入'
            }).then(function (values) {
                if (!values) {
                    return null;
                }
                if (values.mode === 'replace'
                    && !window.confirm('覆盖导入会清空「' + g.fullName + '」的全部抽卡记录，确定继续吗？')) {
                    return null;
                }
                return api('/api/wishes/import-uigf?mode=' + encodeURIComponent(values.mode), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
                    body: text
                }, game).then(function (result) {
                    toast(formatName + ' 导入完成：新增 ' + result.imported + ' 条'
                        + (result.skipped ? '，跳过 ' + result.skipped + ' 条' : '')
                        + (result.filtered ? '，忽略 ' + result.filtered + ' 条' : ''));
                    if ((game || state.game) === state.game) {
                        switchView(state.view);
                    }
                    return result;
                });
            });
        });
    }

    /* ---------------- 账号资源 ---------------- */

    function resourceFormFields(resource, overrides) {
        var g = gameConfig();
        var fields = [
            { key: 'primogems', label: g.currency, type: 'number', min: 0, max: 999999999, step: '1', default: resource.primogems },
            { key: 'mora', label: g.credit, type: 'number', min: 0, max: 999999999, step: '1', default: resource.mora },
            { key: 'intertwinedFates', label: g.fateLimited + '（抽）', type: 'number', min: 0, max: 99999, step: '1', default: resource.intertwinedFates },
            { key: 'acquaintedFates', label: g.fateStandard + '（抽）', type: 'number', min: 0, max: 99999, step: '1', default: resource.acquaintedFates },
            { key: 'genesisCrystals', label: g.genesisCrystal, type: 'number', min: 0, max: 999999999, step: '1', default: resource.genesisCrystals || 0 },
            { key: 'dailyPrimogems', label: '每天自动增加 ' + g.currency, type: 'number', min: 0, max: 999999, step: '10', default: resource.dailyPrimogems || 0 }
        ];
        if (state.game === 'genshin') {
            fields = fields.concat([
                { key: 'heroWit', label: '大英雄的经验（本）', type: 'number', min: 0, max: 999999, step: '1', default: resource.heroWit || 0 },
                { key: 'adventurerExp', label: '冒险家的经验（本）', type: 'number', min: 0, max: 999999, step: '1', default: resource.adventurerExp || 0 },
                { key: 'wandererAdvice', label: '流浪者的经验（本）', type: 'number', min: 0, max: 999999, step: '1', default: resource.wandererAdvice || 0 },
                { key: 'sanctifyingUnction', label: '祝圣油膏（个）', type: 'number', min: 0, max: 999999, step: '1', default: resource.sanctifyingUnction || 0 },
                { key: 'sanctifyingEssence', label: '祝圣精华（个）', type: 'number', min: 0, max: 999999, step: '1', default: resource.sanctifyingEssence || 0 }
            ]);
        }
        /* 智能录入解析出的字段直接作为表单默认值 */
        var patch = overrides || {};
        fields.forEach(function (field) {
            if (patch[field.key] !== undefined && patch[field.key] !== null) {
                field.default = patch[field.key];
            }
        });
        return fields;
    }

    function editResource(resource, overrides, batchLines) {
        var g = gameConfig();
        var fields = resourceFormFields(resource, overrides);
        return openForm('编辑账号资源 · ' + g.fullName, fields, null, {
            hint: (batchLines > 1 ? '已从 ' + batchLines + ' 行文本解析并填入下方数值，核对后保存。' : '')
                + '1 抽 = ' + resource.primogemsPerPull + ' ' + g.currency
                + '；每日额度按自然日自动累加到资源，手动修改资产或额度后从当天重新计',
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

    /* ---------------- 离线 AI 录入（本地语义解析，不联网） ---------------- */

    /* 资源关键词：命中的数值回填到对应字段 */
    var AI_RESOURCE_WORDS = [
        { key: 'primogems', words: ['原石', '星琼', '石头'] },
        { key: 'mora', words: ['摩拉', '信用点'] },
        { key: 'intertwinedFates', words: ['纠缠之缘', '纠缠', '星轨专票', '专票'] },
        { key: 'acquaintedFates', words: ['相遇之缘', '相遇', '星轨通票', '通票'] },
        { key: 'genesisCrystals', words: ['创世结晶', '创世', '结晶'] },
        { key: 'heroWit', words: ['大英雄的经验', '大英雄', '经验书', '紫书'] },
        { key: 'adventurerExp', words: ['冒险家的经验', '冒险家', '蓝书'] },
        { key: 'wandererAdvice', words: ['流浪者的经验', '流浪者', '绿书'] },
        { key: 'sanctifyingUnction', words: ['祝圣油膏', '油膏'] },
        { key: 'sanctifyingEssence', words: ['祝圣精华', '精华'] }
    ];

    var AI_NUMBER = '([0-9][0-9,]*(?:\\.[0-9]+)?|[零〇一二两三四五六七八九十百千万]+)';

    function aiCompact(text) {
        return String(text || '').replace(/\s+/g, '');
    }

    function aiPad(n) {
        return (n < 10 ? '0' : '') + n;
    }

    /** 阿拉伯数字 / 中文数字统一转数值（支持「六百」「六十六」「1.2万」这类说法） */
    function aiNumber(text) {
        var raw = String(text || '').replace(/,/g, '');
        if (/^[0-9]+(\.[0-9]+)?$/.test(raw)) {
            return Number(raw);
        }
        var digit = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
            '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
        var unit = { '十': 10, '百': 100, '千': 1000 };
        var total = 0;
        var section = 0;
        var number = 0;
        for (var i = 0; i < raw.length; i += 1) {
            var ch = raw.charAt(i);
            if (digit[ch] !== undefined) {
                number = digit[ch];
            } else if (ch === '万') {
                total += (section + number) * 10000;
                section = 0;
                number = 0;
            } else if (unit[ch]) {
                section += (number || 1) * unit[ch];
                number = 0;
            } else {
                return NaN;
            }
        }
        return total + section + number;
    }

    /** 在关键词前后找数值，兼容「600原石」「原石：600」两种语序 */
    function aiAmountNear(text, word) {
        var escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var patterns = [
            new RegExp(AI_NUMBER + '\\s*(万|w|W)?\\s*(?:个|枚|抽|本|份)?\\s*' + escaped),
            new RegExp(escaped + '\\s*(?:还有|有|是|大概|约|剩|：|:|＝|=)?\\s*' + AI_NUMBER + '\\s*(万|w|W)?')
        ];
        for (var i = 0; i < patterns.length; i += 1) {
            var match = patterns[i].exec(text);
            if (!match) {
                continue;
            }
            var value = aiNumber(match[1]);
            if (isNaN(value)) {
                continue;
            }
            return /万|w|W/.test(match[2] || '') ? value * 10000 : value;
        }
        return null;
    }

    /** 资源类语句 → 表单字段 */
    function aiParseResource(text, game) {
        var fields = resourceFormFields({});
        var values = {};
        var found = 0;
        AI_RESOURCE_WORDS.forEach(function (token) {
            var allowed = fields.some(function (field) {
                return field.key === token.key;
            });
            if (!allowed) {
                return;
            }
            for (var i = 0; i < token.words.length; i += 1) {
                var amount = aiAmountNear(text, token.words[i]);
                if (amount !== null) {
                    values[token.key] = amount;
                    found += 1;
                    return;
                }
            }
        });
        return found ? values : null;
    }

    /** 抽卡时间：绝对日期、相对日期与可选时刻（支持 20:01:05、20时01分05秒） */
    function aiWishTime(text) {
        var now = new Date();
        var h = 12;
        var mi = 0;
        var sec = null;
        // 24 小时制：20:01 或 20:01:05
        var clock = /(\d{1,2})\s*[:：]\s*(\d{1,2})(?:\s*[:：]\s*(\d{1,2}))?/.exec(text);
        // 口语：下午3点 / 20时01分05秒 / 8点20分
        var spoken = /(上午|中午|下午|傍晚|晚上|凌晨|清晨|早上)?\s*(\d{1,2})\s*[点时](?:\s*(\d{1,2})\s*分?)?(?:\s*(\d{1,2})\s*秒)?/
            .exec(text);
        if (clock) {
            h = Number(clock[1]);
            mi = Number(clock[2]);
            if (clock[3] !== undefined) {
                sec = Number(clock[3]);
            }
        } else if (spoken) {
            var period = spoken[1] || '';
            h = Number(spoken[2]);
            mi = spoken[3] ? Number(spoken[3]) : 0;
            if (spoken[4] !== undefined) {
                sec = Number(spoken[4]);
            }
            if (/下午|傍晚|晚上/.test(period) && h < 12) {
                h += 12;
            }
            if (/凌晨|清晨|早上|上午/.test(period) && h === 12) {
                h = 0;
            }
        }
        if (h > 23) {
            h = 23;
        }
        if (mi > 59) {
            mi = 59;
        }
        if (sec !== null && (sec > 59 || isNaN(sec))) {
            sec = null;
        }

        var y = now.getFullYear();
        var m = now.getMonth() + 1;
        var d = now.getDate();
        var full = /(\d{4})[年\-/．.](\d{1,2})[月\-/．.](\d{1,2})[日号]?/.exec(text);
        var monthDay = /(\d{1,2})月(\d{1,2})[日号]?/.exec(text);
        var dayOnly = /(\d{1,2})[日号]/.exec(text);
        var relative = /前天|昨天|昨日|昨晚|今天|今日|刚才|刚刚|现在/.test(text);

        if (full) {
            y = Number(full[1]);
            m = Number(full[2]);
            d = Number(full[3]);
        } else if (monthDay) {
            m = Number(monthDay[1]);
            d = Number(monthDay[2]);
        } else if (dayOnly) {
            d = Number(dayOnly[1]);
        } else if (/前天/.test(text)) {
            d -= 2;
        } else if (/昨天|昨日|昨晚/.test(text)) {
            d -= 1;
        }
        if (!clock && !spoken && relative) {
            h = now.getHours();
            mi = now.getMinutes();
        }

        var built = new Date(y, Math.max(1, m) - 1, Math.max(1, d), h, mi);
        if (built.getTime() > now.getTime() + 24 * 3600 * 1000 && !full) {
            built.setFullYear(built.getFullYear() - 1);
        }
        var result = built.getFullYear() + '-' + aiPad(built.getMonth() + 1) + '-' + aiPad(built.getDate())
            + 'T' + aiPad(built.getHours()) + ':' + aiPad(built.getMinutes());
        // 原文给了秒就一并保留，字段长度按 19 位处理
        return sec === null ? result : result + ':' + aiPad(sec);
    }

    /** 文本里找名称：先整词命中（取最长），再对 3 字以上的名称容错 1 个字 */
    function aiMatchName(text, names) {
        var best = null;
        names.forEach(function (name) {
            var idx = text.indexOf(name);
            if (idx >= 0 && (!best || name.length > best.name.length)) {
                best = { name: name, index: idx };
            }
        });
        if (best) {
            return best;
        }
        names.forEach(function (name) {
            if (name.length < 3 || best) {
                return;
            }
            // 只允许同长度容错，避免「黑塔」被补成「大黑塔」
            for (var i = 0; i + name.length <= text.length; i += 1) {
                if (aiEditDistance(name, text.substr(i, name.length)) <= 1) {
                    best = { name: name, index: i };
                    return;
                }
            }
        });
        return best;
    }

    function aiEditDistance(a, b) {
        var prev = [];
        for (var j = 0; j <= b.length; j += 1) {
            prev[j] = j;
        }
        for (var i = 1; i <= a.length; i += 1) {
            var cur = [i];
            for (var k = 1; k <= b.length; k += 1) {
                cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1,
                    prev[k - 1] + (a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1));
            }
            prev = cur;
        }
        return prev[b.length];
    }

    /** 卡池：按文字里的「角色池 / 武器池 / 混池 / 联动池 / 常驻」判定，说明不清时按物品类型兜底 */
    function aiPool(text, game, isWeapon) {
        var g = GAMES[game];
        if (/常驻|标准池|标准祈愿|普池/.test(text)) {
            return '常驻';
        }
        if (game === 'genshin') {
            if (/集录|混池|混合池|自选池/.test(text)) {
                return '集录祈愿';
            }
        } else if (/联动|Fate|fate|Saber|saber|Archer|archer|命运之夜|远坂凛|吉尔伽美什/.test(text)) {
            return '联动';
        }
        if (/武器池|武器卡池|武器活动|武器祈愿|光锥池|光锥卡池|光锥活动|光锥祈愿/.test(text)) {
            return g.weaponPool;
        }
        if (/角色池|角色卡池|角色活动|角色祈愿|限定池|限定祈愿|UP池|up池|星缘相邀/.test(text)) {
            return g.charPool;
        }
        return isWeapon ? g.weaponPool : g.charPool;
    }

    /** 抽数：优先取靠近「出 / 抽到 / 歪」的那个数字 */
    function aiPity(text, nameIndex) {
        var re = /([0-9]{1,3}|[零〇一二三四五六七八九十百]{1,5})\s*(?:抽|连|发)/g;
        var best = null;
        var match;
        while ((match = re.exec(text)) !== null) {
            var value = aiNumber(match[1]);
            if (isNaN(value) || value < 1 || value > 200) {
                continue;
            }
            var around = text.slice(Math.max(0, match.index - 12), match.index + match[0].length + 14);
            var score = /出|歪|中|拿到|来了|获得|抽到/.test(around) ? 2 : 0;
            if (nameIndex !== undefined && match.index > nameIndex && match.index - nameIndex < 30) {
                score += 1;
            }
            if (!best || score > best.score) {
                best = { value: value, score: score };
            }
        }
        return best ? best.value : null;
    }

    /** 收藏补充：按名称判断分栏，并把「N命 / 精N」换算成目标总份数（C0 = 1 份） */
    function aiOwnedTarget(text, game, name) {
        var lists = nameLists(game);
        var category = 'characters5';
        if (lists.weapons.indexOf(name) >= 0) {
            category = 'weapons5';
        } else if (isFourStarCharacter(game, name)) {
            category = 'characters4';
        }
        var target = 1;
        if (category === 'weapons5') {
            if (/满精/.test(text)) {
                target = 5;
            } else {
                var refine = /精[炼]?\s*([0-9一二两三四五])(?![\d])/.exec(text)
                    || /([0-9一二两三四五])\s*精/.exec(text);
                target = refine ? aiNumber(refine[1]) : 1;
            }
            if (!isFinite(target) || target < 1) {
                target = 1;
            }
            target = Math.min(5, target);
        } else {
            if (/满命/.test(text)) {
                target = 7;
            } else {
                var con = /([0-9一二两三四五六])\s*命/.exec(text);
                target = con ? (aiNumber(con[1]) || 0) + 1 : 1;
            }
            if (!isFinite(target) || target < 1) {
                target = 1;
            }
            target = Math.min(7, target);
        }
        return { category: category, name: name, target: target };
    }

    /** 目标份数 → 展示用徽标：角色 C0–C6，武器 R1–R5 */
    function ownedBadgeText(category, copies) {
        if (category === 'weapons5') {
            return 'R' + Math.min(5, Math.max(1, Number(copies) || 1));
        }
        return 'C' + Math.min(6, Math.max(0, (Number(copies) || 1) - 1));
    }

    /** 一句话 → 动作类型 + 预填字段；解析不出来返回 null */
    function parseNaturalEntry(raw, game) {
        var text = aiCompact(raw);
        if (!text) {
            return null;
        }
        var hit = aiMatchName(text, fiveStarNameOptions());
        var hasPull = /抽|出|歪|获得|拿到|中了/.test(text);
        if (hit && hasPull) {
            var isWeapon = nameLists(game).weapons.indexOf(hit.name) >= 0;
            var pool = aiPool(text, game, isWeapon);
            var values = {
                itemName: hit.name,
                rarity: 5,
                pool: pool,
                wishTime: aiWishTime(text),
                captureTriggered: false
            };
            var pity = aiPity(text, hit.index);
            if (pity) {
                // 武器池硬保底 80 抽，其余卡池 90 抽
                values.pityCount = Math.min(pool === GAMES[game].weaponPool ? 80 : 90, pity);
            }
            return { type: 'wish', name: hit.name, values: values };
        }
        var resources = aiParseResource(text, game);
        if (resources) {
            return { type: 'resource', values: resources };
        }
        var lists = nameLists(game);
        var owned = hit || aiMatchName(text, lists.characters.concat(lists.weapons));
        if (owned) {
            return { type: 'owned', name: owned.name, values: aiOwnedTarget(text, game, owned.name) };
        }
        return null;
    }

    function openAiInput() {
        var g = gameConfig();
        var examples = state.game === 'genshin'
            ? ['7抽莫娜 2025年10月22日 20时01分05秒', '混池 30抽出了天空之刃',
                '我现在有600原石', '原石9195\n摩拉22219696\n纠缠之缘12', '七七2命\n天空之刃精2\n芙宁娜满命']
            : ['66抽姬子 2025年10月22日 20:01:05', '联动池40抽出了Saber',
                '我现在有600星琼', '星琼91950\n信用点22219696\n星轨专票12', '三月七3命\n于夜色中精2'];
        var parsed = null;

        return openForm('AI 录入 · ' + g.fullName, [
            {
                key: 'text',
                label: '用一句话说清楚',
                type: 'textarea',
                full: true,
                placeholder: '一行一条，例如：7抽莫娜 2025年10月22日 20时01分05秒'
            }
        ], null, {
            hint: '本地离线解析，不联网、不上传。一行一条，可一次粘贴多行批量录入（抽卡 / 资源 / 收藏各自一份列表）；'
                + '多行时请保持同一类型。收藏补充写「几命 / 精几」即可，会按抽卡记录自动算出还差几份。',
            submitText: '解析并填充',
            onMount: function (mask, form) {
                var area = $('textarea[name="text"]', form);
                var box = document.createElement('div');
                box.className = 'ai-examples';
                box.innerHTML = '<span class="ai-examples-label">示例</span>'
                    + examples.map(function (example) {
                        return '<button type="button" class="ai-example">' + esc(example) + '</button>';
                    }).join('');
                $$('.ai-example', box).forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        area.value = btn.textContent;
                        area.focus();
                    });
                });
                form.insertBefore(box, $('.modal-foot', form));
            },
            validate: function (values) {
                if (!aiCompact(values.text)) {
                    return '先输入一句话';
                }
                var batch = aiBatch(values.text, state.game);
                if (batch.lines.length > 1) {
                    if (batch.failures.length) {
                        return '第 ' + batch.failures.join('、') + ' 行没解析出来，'
                            + '参考写法「7抽莫娜 2025年10月22日 20时01分05秒」「七七2命」';
                    }
                    if (!batch.type) {
                        return '批量录入请只放同一类内容：抽卡记录、账号资源或收藏补充';
                    }
                    parsed = batch;
                    return null;
                }
                parsed = parseNaturalEntry(values.text, state.game);
                if (!parsed) {
                    return '没解析出来，换个说法试试，例如「10月3日 66抽 出了七七」「七七2命」';
                }
                return null;
            }
        }).then(function (values) {
            if (!values || !parsed) {
                return null;
            }
            if (parsed.items) {
                return aiApplyBatch(parsed);
            }
            if (parsed.type === 'wish') {
                toast('已解析：' + parsed.name + ' · ' + parsed.values.pool
                    + (parsed.values.pityCount ? ' · ' + parsed.values.pityCount + ' 抽' : ''));
                return openEditor('wishes', null, parsed.values);
            }
            if (parsed.type === 'resource') {
                return api('/api/resources').then(function (resource) {
                    return editResource(resource, parsed.values);
                });
            }
            return openOwnedByTarget(parsed.values);
        });
    }

    /** 多行文本按行解析：支持抽卡、资源、收藏三类，返回统一的批量结果 */
    function aiBatch(raw, game) {
        var lines = String(raw || '').split(/[\r\n]+/)
            .map(function (line) { return line.trim(); })
            .filter(Boolean);
        var items = [];
        var resources = {};
        var failures = [];
        var types = [];
        lines.forEach(function (line, index) {
            var one = parseNaturalEntry(line, game);
            if (!one) {
                failures.push(index + 1);
                return;
            }
            if (one.type === 'resource') {
                Object.keys(one.values).forEach(function (key) {
                    resources[key] = one.values[key];
                });
            } else {
                items.push(one);
            }
            types.push(one.type);
        });
        var type = '';
        if (types.length) {
            type = types.every(function (item) { return item === types[0]; }) ? types[0] : '';
        }
        return { lines: lines, items: items, resources: resources, failures: failures, type: type };
    }

    function aiApplyBatch(batch) {
        if (batch.type === 'wish') {
            return confirmBatchWishes(batch.items);
        }
        if (batch.type === 'owned') {
            return confirmBatchOwned(batch.items);
        }
        return api('/api/resources').then(function (resource) {
            toast('已解析 ' + batch.lines.length + ' 行资源');
            return editResource(resource, batch.resources, batch.lines.length);
        });
    }

    /** 拉取收藏里每个条目的抽卡数量，用于计算「还差几份到 C/R」 */
    function collectionTotals() {
        return api('/api/wishes/collection').then(function (items) {
            var defs = collectionDefs(gameConfig());
            var totals = {};
            (items || []).forEach(function (item) {
                var section = collectionSectionOf(item, defs);
                if (!section) {
                    return;
                }
                totals[section + '|' + item.itemName] = Number(item.count) || 0;
            });
            return totals;
        });
    }

    /** 目标份数 - (抽卡数量 + 手动补充) = 还需要补充的份数 */
    function ownedPlan(totals, owned, values) {
        var key = values.category + '|' + values.name;
        var manual = owned[values.category] ? Number(owned[values.category][values.name]) || 0 : 0;
        var current = (totals[key] || 0) + manual;
        return {
            category: values.category,
            name: values.name,
            target: values.target,
            current: current,
            delta: Math.max(0, values.target - current)
        };
    }

    /** 单条收藏补充：按「说到几命就补到几命」计算需要补的份数 */
    function openOwnedByTarget(values) {
        return Promise.all([collectionTotals(), Promise.resolve(loadOwnedData())]).then(function (result) {
            var plan = ownedPlan(result[0], result[1], values);
            var badge = ownedBadgeText(plan.category, plan.target);
            if (plan.delta === 0) {
                toast(plan.name + ' 已是 ' + badge + '，无需补充');
                return loadCollection();
            }
            toast(plan.name + ' 目标 ' + badge + ' · 需补 ' + plan.delta + ' 份');
            return openOwnedForm({
                category: plan.category,
                name: plan.name,
                copies: plan.delta,
                hint: '目标 ' + badge + '：抽卡记录已有 ' + plan.current + ' 份，补 ' + plan.delta + ' 份即可。'
            });
        });
    }

    /** 批量收藏补充：先列出每个条目要补多少份，确认后一次写入本机 */
    function confirmBatchOwned(items) {
        return Promise.all([collectionTotals(), Promise.resolve(loadOwnedData())]).then(function (result) {
            var totals = result[0];
            var owned = result[1];
            var defs = collectionDefs(gameConfig());
            var plans = items.map(function (item) {
                return ownedPlan(totals, owned, item.values);
            });
            var rows = plans.map(function (plan) {
                var title = defs.filter(function (def) {
                    return def.key === plan.category;
                }).map(function (def) {
                    return def.title;
                })[0] || '';
                return [
                    plan.name,
                    title,
                    '目标 ' + ownedBadgeText(plan.category, plan.target),
                    plan.delta > 0 ? '补 ' + plan.delta + ' 份' : '已达标'
                ];
            });
            return confirmAiBatch('批量录入确认 · 收藏',
                '共 ' + plans.length + ' 条；按「说到几命就补到几命」计算，'
                + '已够的不会重复叠加，确认后写入本机收藏。',
                '确认补充', rows, function () {
                    var data = loadOwnedData();
                    var added = 0;
                    plans.forEach(function (plan) {
                        if (plan.delta <= 0) {
                            return;
                        }
                        data[plan.category][plan.name] = (Number(data[plan.category][plan.name]) || 0)
                            + plan.delta;
                        added += plan.delta;
                    });
                    saveOwnedData(data);
                    toast('收藏补充完成：共补 ' + added + ' 份');
                    return loadCollection();
                });
        });
    }

    /** 通用批量确认弹窗：rows 为每行的单元格文本 */
    function confirmAiBatch(title, hint, confirmText, rows, run) {
        return new Promise(function (resolve) {
            var mask = document.createElement('div');
            mask.className = 'modal-mask';
            mask.innerHTML = '<div class="modal ai-batch-modal">'
                + '<header><h3>' + esc(title) + '</h3>'
                + '<button class="modal-close" type="button" aria-label="关闭">×</button></header>'
                + '<p class="modal-hint">' + esc(hint) + '</p>'
                + '<div class="modal-body"><ul class="ai-batch-list">'
                + rows.map(function (cells, index) {
                    return '<li class="ai-batch-row">'
                        + '<span class="ai-batch-index">' + (index + 1) + '</span>'
                        + '<span class="ai-batch-name">' + esc(cells[0]) + '</span>'
                        + cells.slice(1).map(function (cell) {
                            return '<span class="ai-batch-meta">' + esc(cell) + '</span>';
                        }).join('')
                        + '</li>';
                }).join('')
                + '</ul></div>'
                + '<footer class="modal-foot">'
                + '<button type="button" class="btn btn-text modal-cancel">取消</button>'
                + '<button type="button" class="btn btn-primary modal-confirm">' + esc(confirmText) + '</button>'
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
            $('.modal-confirm', mask).addEventListener('click', function () {
                var button = this;
                button.disabled = true;
                button.textContent = '正在处理…';
                Promise.resolve()
                    .then(run)
                    .then(close)
                    .catch(function (err) {
                        button.disabled = false;
                        button.textContent = confirmText;
                        toast(err && err.message ? err.message : '处理失败', 'error');
                    });
            });
        });
    }

    /** 批量录入抽卡记录：列出解析结果供核对，确认后一次提交，重复记录自动跳过 */
    function confirmBatchWishes(items) {
        var g = gameConfig();
        var lists = nameLists(state.game);
        var characterType = g.itemTypes[0];
        var weaponType = g.itemTypes[1];
        var records = items.map(function (item) {
            var isWeapon = lists.weapons.indexOf(item.name) >= 0;
            var pool = item.values.pool;
            var itemType = isWeapon ? weaponType : characterType;
            return {
                itemName: item.name,
                rarity: 5,
                itemType: itemType,
                pool: pool,
                isUp: inferIsUp(state.game, pool, item.name, itemType, item.values.wishTime),
                pityCount: item.values.pityCount || 1,
                wishTime: toApiTime(item.values.wishTime)
            };
        });
        var rows = records.map(function (record) {
            return [
                record.itemName,
                poolLabel(record.pool),
                record.pityCount + ' 抽',
                String(record.wishTime).slice(0, 19),
                record.isUp ? 'UP' : '歪'
            ];
        });
        return confirmAiBatch('批量录入确认 · ' + g.fullName,
            '共 ' + records.length + ' 条五星记录；UP 按常驻名单自动判断，'
            + '确认后一次性导入，重复记录会自动跳过。',
            '确认导入', rows, function () {
                return api('/api/wishes/import?format=json&mode=merge', {
                    method: 'POST',
                    body: records
                }).then(function (result) {
                    toast('批量导入完成：新增 ' + result.imported + ' 条'
                        + (result.skipped ? '，跳过重复 ' + result.skipped + ' 条' : '')
                        + (result.filtered ? '，忽略 ' + result.filtered + ' 条' : ''));
                    if ($('#wish-list')) {
                        refreshWishList();
                    }
                    return result;
                });
            });
    }

    /* ---------------- 实时抓图（启动器每秒回传原神窗口画面） ---------------- */

    var liveCaptureSession = null;

    function liveCaptureSupported() {
        return !!(window.chrome && window.chrome.webview);
    }

    /** 打开实时预览弹窗，点「识别当前画面」后以 File 形式返回当前帧。 */
    function openLiveCapture(options) {
        var opts = options || {};
        if (!liveCaptureSupported()) {
            return Promise.reject(new Error('识图需要在南空提瓦特小助手内运行，并保持原神窗口化或无边框模式'));
        }
        return new Promise(function (resolve) {
            var mask = document.createElement('div');
            mask.className = 'modal-mask';
            mask.innerHTML = '<div class="modal live-capture-modal">'
                + '<header><h3>' + esc(opts.title || '实时识图') + '</h3>'
                + '<button class="modal-close" type="button" aria-label="关闭">×</button></header>'
                + (opts.hint ? '<p class="modal-hint">' + esc(opts.hint) + '</p>' : '')
                + '<div class="live-capture-body">'
                + '<img id="live-preview" class="live-capture-preview" alt="原神实时画面" hidden/>'
                + '<div id="live-placeholder" class="live-capture-placeholder">正在连接原神窗口…</div>'
                + '</div>'
                + '<div class="live-capture-bar">'
                + '<span id="live-status" class="live-capture-status">正在连接…</span>'
                + '<button id="live-retry" class="btn btn-outline btn-sm" type="button" hidden>重试</button>'
                + '<button id="live-recognize" class="btn btn-primary btn-sm" type="button" disabled>识别当前画面</button>'
                + '</div></div>'
                + '<footer class="modal-foot"><button type="button" class="btn btn-text modal-cancel">关闭</button></footer>'
                + '</div>';
            document.body.appendChild(mask);
            document.body.style.overflow = 'hidden';

            var preview = $('#live-preview', mask);
            var placeholder = $('#live-placeholder', mask);
            var statusEl = $('#live-status', mask);
            var retryBtn = $('#live-retry', mask);
            var recognizeBtn = $('#live-recognize', mask);
            var latest = null;
            var closed = false;
            var connectTimer = null;

            function setStatus(text, isError) {
                statusEl.textContent = text || '';
                statusEl.className = 'live-capture-status' + (isError ? ' error' : '');
            }

            function clearConnectTimer() {
                if (connectTimer) {
                    clearTimeout(connectTimer);
                    connectTimer = null;
                }
            }

            function stopCapture() {
                liveCaptureSession = null;
                try {
                    window.chrome.webview.postMessage({ action: 'captureLiveStop' });
                } catch (e) {
                    // 启动器已关闭时忽略
                }
            }

            function showError(message) {
                latest = null;
                preview.hidden = true;
                placeholder.hidden = false;
                placeholder.textContent = message || '抓取失败';
                recognizeBtn.disabled = true;
                retryBtn.hidden = false;
                setStatus(message || '抓取失败', true);
            }

            function startCapture() {
                latest = null;
                preview.hidden = true;
                preview.removeAttribute('src');
                placeholder.hidden = false;
                placeholder.textContent = '正在连接原神窗口…';
                recognizeBtn.disabled = true;
                retryBtn.hidden = true;
                setStatus('正在连接…');
                clearConnectTimer();
                liveCaptureSession = {
                    onFrame: function (message) {
                        if (closed) {
                            return;
                        }
                        clearConnectTimer();
                        latest = message.dataUrl;
                        preview.src = latest;
                        preview.hidden = false;
                        placeholder.hidden = true;
                        recognizeBtn.disabled = false;
                        retryBtn.hidden = true;
                        setStatus('实时画面 · 每秒刷新');
                    },
                    onError: function (message) {
                        if (closed) {
                            return;
                        }
                        clearConnectTimer();
                        showError(message);
                    }
                };
                window.chrome.webview.postMessage({ action: 'captureLiveStart' });
                connectTimer = setTimeout(function () {
                    if (!closed && !latest) {
                        stopCapture();
                        showError('等待原神画面超时，请确认游戏已启动、未最小化，并切换为窗口化或无边框模式');
                    }
                }, 20000);
            }

            function close(file) {
                if (closed) {
                    return;
                }
                closed = true;
                clearConnectTimer();
                stopCapture();
                document.removeEventListener('pagehide', onPageHide);
                mask.remove();
                document.body.style.overflow = '';
                resolve(file || null);
            }

            function onPageHide() {
                stopCapture();
            }

            startCapture();
            document.addEventListener('pagehide', onPageHide);
            $('.modal-close', mask).addEventListener('click', function () {
                close(null);
            });
            $('.modal-cancel', mask).addEventListener('click', function () {
                close(null);
            });
            retryBtn.addEventListener('click', startCapture);
            recognizeBtn.addEventListener('click', function () {
                if (!latest) {
                    return;
                }
                recognizeBtn.disabled = true;
                setStatus('正在读取当前画面…');
                fetch(latest).then(function (res) {
                    return res.blob();
                }).then(function (blob) {
                    var type = blob.type || 'image/jpeg';
                    var ext = /jpeg|jpg/.test(type) ? '.jpg' : '.png';
                    close(new File([blob], 'genshin-live' + ext, { type: type }));
                }).catch(function (err) {
                    recognizeBtn.disabled = false;
                    setStatus('截图读取失败：' + (err.message || ''), true);
                });
            });
        });
    }

    function uploadRawImage(file, mode) {
        var form = new FormData();
        form.append('file', file);
        var headers = {};
        if (state.token) {
            headers.Authorization = 'Bearer ' + state.token;
        }
        return fetch('/api/ocr/raw?engine=tesseract&mode=' + encodeURIComponent(mode || 'history'), {
            method: 'POST',
            headers: headers,
            body: form
        }).then(function (res) {
            return res.text().then(function (text) {
                var payload = safeParse(text);
                if (res.status === 401) {
                    logout(true);
                    throw new Error('登录已失效，请重新登录');
                }
                if (!res.ok) {
                    throw new Error((payload && payload.message) || ('识别失败（' + res.status + '）'));
                }
                if (payload && payload.code !== 0) {
                    throw new Error(payload.message || '识别失败');
                }
                return payload ? payload.data : null;
            });
        });
    }

    /* ---------------- 资源截图识别 ---------------- */

    /** 启动电脑端识图小工具；首次使用（还没有校准区域）优先进校准 */
    function launchResourceScan() {
        return api('/api/resource-scan/launch', { method: 'POST' })
            .then(handleResourceScanResult)
            .catch(function (error) {
                toast((error && error.message) || '启动识图工具失败', 'error');
            });
    }

    function handleResourceScanResult(result) {
        if (result && result.mode === 'downloading') {
            toast('正在下载识图运行环境，完成后会自动打开', 'success');
            return waitForResourceScan(0);
        }
        if (result && result.mode === 'calibrate') {
            toast('首次使用：已打开识图校准，请按控制台提示框选资源数字', 'success');
        } else {
            toast('已打开识图工具，请按控制台提示识别', 'success');
        }
        return result;
    }

    /** 等待后端下载并解压识图运行环境，就绪后自动启动工具。 */
    function waitForResourceScan(elapsed) {
        if (elapsed > 600) {
            toast('识图运行环境下载超时，请稍后重试', 'error');
            return null;
        }
        return api('/api/resource-scan/status').then(function (status) {
            if (status && status.downloadError) {
                toast('识图运行环境下载失败：' + status.downloadError, 'error');
                return null;
            }
            if (status && status.ready) {
                return api('/api/resource-scan/launch', { method: 'POST' })
                    .then(handleResourceScanResult);
            }
            if (elapsed > 0 && elapsed % 4 === 0) {
                toast('正在下载识图运行环境… ' + elapsed + ' 秒', 'success');
            }
            return new Promise(function (resolve) {
                setTimeout(resolve, 2000);
            }).then(function () {
                return waitForResourceScan(elapsed + 2);
            });
        });
    }

    var RESOURCE_OCR_LABELS = {
        primogems: '原石',
        mora: '摩拉',
        intertwinedFates: '纠缠之缘',
        acquaintedFates: '相遇之缘',
        genesisCrystals: '创世结晶',
        heroWit: '大英雄的经验',
        adventurerExp: '冒险家的经验',
        wandererAdvice: '流浪者的经验',
        sanctifyingUnction: '祝圣油膏',
        sanctifyingEssence: '祝圣精华'
    };

    function openResourceOcr(resource) {
        return openLiveCapture({
            title: '识图填充 · 原神资源',
            hint: '打开背包「贵重道具」看原石/摩拉/纠缠/相遇/创世结晶，「养成道具」看三本经验书，或「圣遗物」页底部看祝圣油膏/祝圣精华；按图案识别，不限排序，再点「识别当前画面」。识别结果只作为候选，需确认后保存。'
        }).then(function (file) {
            if (!file) {
                return null;
            }
            toast('正在识别资源截图…');
            return uploadResourceImage(file).then(function (result) {
                var found = result.values || {};
                var merged = {};
                var foundKeys = [];
                var missingKeys = [];
                Object.keys(RESOURCE_OCR_LABELS).forEach(function (key) {
                    if (found[key] != null) {
                        merged[key] = found[key];
                        foundKeys.push(key);
                    } else {
                        merged[key] = resource[key] || 0;
                        missingKeys.push(RESOURCE_OCR_LABELS[key]);
                    }
                });
                var hint = '识别到 ' + foundKeys.length + ' 项'
                    + (foundKeys.length
                        ? '：' + foundKeys.map(function (key) {
                            return RESOURCE_OCR_LABELS[key] + ' ' + fmt(merged[key]);
                        }).join(' · ')
                        : '')
                    + (missingKeys.length
                        ? '。未识别：' + missingKeys.join('、') + '（保留原值）'
                        : '')
                    + '。请核对后再保存。';
                var fields = resourceFormFields(resource);
                return openForm('识图结果 · 原神资源', fields, merged, {
                    hint: hint,
                    submitText: '确认填入'
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
            });
        });
    }

    /** 启动器回传的实时画面消息。 */
    function bindLauncherMessages() {
        if (!(window.chrome && window.chrome.webview)) {
            return;
        }
        window.chrome.webview.addEventListener('message', function (event) {
            var message = event.data || {};
            if (message.action === 'gachaUrlResult' && message.url) {
                if (!gachaAutoTarget || !gachaAutoTarget.mask.isConnected) {
                    return;
                }
                gachaAutoTarget.input.value = message.url;
                resetGachaButton();
                toast('已从' + (message.sourceText || '本机') + '获取抽卡链接，请点击「读取并导入」');
                return;
            }
            if (message.action === 'gachaUrlProxyPrompt') {
                resetGachaButton();
                if (!gachaAutoTarget || !gachaAutoTarget.mask.isConnected) {
                    return;
                }
                openChoice('本机日志和缓存里没有抽卡链接',
                    '可以启用代理模式：临时把系统代理指向本程序，然后在游戏内重新打开「抽卡记录」页面。'
                    + '抓到链接后会自动关闭代理并恢复原来的系统代理设置。',
                    [
                        { key: 'proxy', label: '启用代理模式', primary: true },
                        { key: 'cancel', label: '取消' }
                    ]).then(function (choice) {
                    if (choice === 'proxy' && window.chrome && window.chrome.webview) {
                        window.chrome.webview.postMessage({ action: 'gachaProxyStart' });
                        toast('代理模式已开启，请在游戏内打开「抽卡记录」页面（最多等待 2 分钟）');
                    }
                });
                return;
            }
            if (message.action === 'gachaUrlProxyStarted') {
                if (gachaAutoTarget && gachaAutoTarget.mask.isConnected) {
                    gachaAutoTarget.button.disabled = true;
                    gachaAutoTarget.button.textContent = '等待游戏打开抽卡记录…';
                }
                return;
            }
            if (message.action === 'gachaProxyStopped') {
                resetGachaButton();
                return;
            }
            if (message.action === 'gachaUrlError') {
                resetGachaButton();
                toast(message.message || '没有获取到抽卡链接', 'error');
                return;
            }
            if (message.action === 'gameCaptureFrame' && message.dataUrl) {
                if (liveCaptureSession && liveCaptureSession.onFrame) {
                    liveCaptureSession.onFrame(message);
                }
                return;
            }
            if (message.action === 'gameCaptureError' && message.live) {
                if (liveCaptureSession && liveCaptureSession.onError) {
                    liveCaptureSession.onError(message.message || '抓取原神窗口失败');
                }
            }
        });
    }

    function uploadResourceImage(file) {
        var form = new FormData();
        form.append('file', file);
        var headers = {};
        if (state.token) {
            headers.Authorization = 'Bearer ' + state.token;
        }
        return fetch('/api/ocr/resource?engine=tesseract', {
            method: 'POST',
            headers: headers,
            body: form
        }).then(function (res) {
            return res.text().then(function (text) {
                var payload = safeParse(text);
                if (res.status === 401) {
                    logout(true);
                    throw new Error('登录已失效，请重新登录');
                }
                if (!res.ok) {
                    throw new Error((payload && payload.message) || ('识别失败（' + res.status + '）'));
                }
                if (payload && payload.code !== 0) {
                    throw new Error(payload.message || '识别失败');
                }
                return payload ? payload.data : null;
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
            $('.choice-actions', mask).addEventListener('click', function (event) {
                var btn = event.target.closest('[data-choice]');
                if (btn) {
                    close(btn.dataset.choice);
                }
            });
        });
    }

    /** 一个「录入」入口 → 弹出录入方式选项 → 执行所选操作 */
    function openEntryMenu(title, hint, actions) {
        return openChoice(title, hint, actions).then(function (choice) {
            if (!choice) {
                return null;
            }
            for (var i = 0; i < actions.length; i += 1) {
                if (actions[i].key === choice) {
                    return actions[i].run();
                }
            }
            return null;
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
                '南空提瓦特小助手-' + (isWish ? 'wishes' : 'resources') + '-template.' + choice,
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
            '南空提瓦特小助手-' + (isWish ? 'wishes' : 'resources') + '-template.' + choice,
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
                    '南空提瓦特小助手-资源.csv', '资源已导出（CSV）');
            });
        });
        jsonBtn.addEventListener('click', function () {
            guard(function () {
                return downloadFile('/api/resources/export?format=json',
                    '南空提瓦特小助手-资源.json', '资源已导出（JSON）');
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

    /** 前端生成 JSON 并下载（全量备份需要追加手动补充数据） */
    function downloadJsonObject(data, filename) {
        var text = JSON.stringify(data, null, 2);
        var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
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
                restoreOwnedSnapshot(data.owned, values.mode);
                toast('全部数据导入完成：抽卡 ' + result.wishes + ' 条'
                    + (result.resourceUpdated ? '，资源已更新' : '')
                    + (data.owned ? '，收藏补充已恢复' : '')
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
                toast('这不是南空提瓦特小助手的全量备份文件', 'error');
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

    /* ---------------- 图鉴数据源 ---------------- */

    var CATALOG_KEY = 'sg_catalog_';
    var CATALOG_WEAPON_KEY = 'sg_catalog_weapons_';
    var CATALOG_RANK_KEY = 'sg_catalog_ranks_';
    /** 在线刷新得到的武器图标 / 星级，启动时合并进本地映射 */
    var CATALOG_WEAPONS = { genshin: {}, starrail: {} };
    var CATALOG_RANKS = { genshin: {}, starrail: {} };

    function loadCatalogCache() {
        ['genshin', 'starrail'].forEach(function (game) {
            var cached = safeParse(localStorage.getItem(CATALOG_KEY + game));
            if (cached && typeof cached === 'object') {
                window.SG_AVATARS = window.SG_AVATARS || {};
                // 内置映射优先：缓存里的在线地址可能已失效（如新角色 / 新光锥）
                window.SG_AVATARS[game] = Object.assign({}, cached, window.SG_AVATARS[game] || {});
            }
            var cachedWeapons = safeParse(localStorage.getItem(CATALOG_WEAPON_KEY + game));
            if (cachedWeapons && typeof cachedWeapons === 'object') {
                CATALOG_WEAPONS[game] = cachedWeapons;
                window.SG_WEAPON_ICONS = window.SG_WEAPON_ICONS || {};
                window.SG_WEAPON_ICONS[game] = Object.assign({},
                    cachedWeapons, window.SG_WEAPON_ICONS[game] || {});
            }
            var cachedRanks = safeParse(localStorage.getItem(CATALOG_RANK_KEY + game));
            if (cachedRanks && typeof cachedRanks === 'object') {
                CATALOG_RANKS[game] = cachedRanks;
            }
        });
    }

    /* 图鉴源直连：Yatta / StarRailRes 都允许跨域，优先由浏览器直接获取 */
    var CATALOG_URLS = {
        genshin: 'https://gi.yatta.moe/api/v2/chs/avatar',
        starrail: 'https://fastly.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_min/cn/characters.json'
    };

    var CATALOG_WEAPON_URLS = {
        genshin: 'https://gi.yatta.moe/api/v2/chs/weapon',
        starrail: 'https://fastly.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_min/cn/light_cones.json'
    };

    function parseCatalog(game, root) {
        var map = {};
        if (game === 'starrail') {
            Object.keys(root || {}).forEach(function (id) {
                var name = root[id] && root[id].name;
                if (name) {
                    map[name] = 'https://enka.network/ui/hsr/SpriteOutput/AvatarRoundIcon/' + id + '.png';
                }
            });
            return map;
        }
        var items = root && root.data && root.data.items ? root.data.items : {};
        Object.keys(items).forEach(function (id) {
            var item = items[id] || {};
            var icon = String(item.icon || '');
            if (item.name && icon) {
                map[item.name] = 'https://gi.yatta.moe/assets/UI/' + icon
                    + (icon.slice(-4) === '.png' ? '' : '.png');
            }
        });
        return map;
    }

    /* 五星武器 / 光锥图标：原神取 rank=5，星铁取 rarity=5 */
    function parseWeaponCatalog(game, root) {
        var map = {};
        if (game === 'starrail') {
            Object.keys(root || {}).forEach(function (id) {
                var item = root[id] || {};
                if (Number(item.rarity) !== 5) {
                    return;
                }
                if (item.name && item.icon) {
                    map[item.name] = 'https://vizualabstract.github.io/StarRailStaticAPI/assets/'
                        + item.icon;
                }
            });
            return map;
        }
        var items = root && root.data && root.data.items ? root.data.items : {};
        Object.keys(items).forEach(function (id) {
            var item = items[id] || {};
            if (Number(item.rank) !== 5) {
                return;
            }
            var icon = String(item.icon || '');
            if (item.name && icon) {
                map[item.name] = 'https://gi.yatta.moe/assets/UI/' + icon
                    + (icon.slice(-4) === '.png' ? '' : '.png');
            }
        });
        return map;
    }

    /* 名称 → 星级：原神 avatar/weapon 的 rank，星铁 characters/light_cones 的 rarity */
    function parseRanks(game, root) {
        var map = {};
        if (!root) {
            return map;
        }
        if (game === 'starrail') {
            Object.keys(root).forEach(function (id) {
                var item = root[id] || {};
                if (item.name && Number(item.rarity) > 0) {
                    map[item.name] = Number(item.rarity);
                }
            });
            return map;
        }
        var items = root.data && root.data.items ? root.data.items : {};
        Object.keys(items).forEach(function (id) {
            var item = items[id] || {};
            if (item.name && Number(item.rank) > 0) {
                map[item.name] = Number(item.rank);
            }
        });
        return map;
    }

    function fetchJson(url) {
        var opts = { headers: { Accept: 'application/json' }, cache: 'no-store' };
        var timer = null;
        if (typeof AbortController !== 'undefined') {
            var controller = new AbortController();
            opts.signal = controller.signal;
            timer = setTimeout(function () {
                controller.abort();
            }, 15000);
        }
        return fetch(url, opts).then(function (res) {
            clearTimeout(timer);
            if (!res.ok) {
                throw new Error('HTTP ' + res.status);
            }
            return res.json();
        });
    }

    function refreshCatalog(game) {
        return Promise.all([
            fetchJson(CATALOG_URLS[game]).catch(function () {
                return null;
            }),
            fetchJson(CATALOG_WEAPON_URLS[game]).catch(function () {
                return null;
            })
        ]).then(function (roots) {
            var avatars = roots[0] ? parseCatalog(game, roots[0]) : {};
            var weapons = roots[1] ? parseWeaponCatalog(game, roots[1]) : {};
            var ranks = {};
            if (roots[0]) {
                ranks = Object.assign(ranks, parseRanks(game, roots[0]));
            }
            if (roots[1]) {
                ranks = Object.assign(ranks, parseRanks(game, roots[1]));
            }
            // 直连失败的单项回退到本机服务代取
            var avatarTask = Object.keys(avatars).length ? Promise.resolve(avatars)
                : api('/api/catalog', null, game).catch(function () {
                    return {};
                });
            var weaponTask = Object.keys(weapons).length ? Promise.resolve(weapons)
                : api('/api/catalog/weapons', null, game).catch(function () {
                    return {};
                });
            var rankTask = Object.keys(ranks).length ? Promise.resolve(ranks)
                : api('/api/catalog/ranks', null, game).catch(function () {
                    return {};
                });
            return Promise.all([avatarTask, weaponTask, rankTask]);
        }).then(function (parts) {
            var avatars = parts[0] || {};
            var weapons = parts[1] || {};
            var ranks = parts[2] || {};
            if (!Object.keys(avatars).length) {
                throw new Error('图鉴数据为空');
            }
            window.SG_AVATARS = window.SG_AVATARS || {};
            // 在线图鉴只补充缺失项，内置 / 已确认可用的图标优先
            window.SG_AVATARS[game] = Object.assign({}, avatars, window.SG_AVATARS[game] || {});
            if (Object.keys(weapons).length) {
                CATALOG_WEAPONS[game] = Object.assign({}, CATALOG_WEAPONS[game] || {}, weapons);
                window.SG_WEAPON_ICONS = window.SG_WEAPON_ICONS || {};
                window.SG_WEAPON_ICONS[game] = Object.assign({},
                    weapons, window.SG_WEAPON_ICONS[game] || {});
            }
            if (Object.keys(ranks).length) {
                CATALOG_RANKS[game] = Object.assign({}, CATALOG_RANKS[game] || {}, ranks);
            }
            try {
                localStorage.setItem(CATALOG_KEY + game, JSON.stringify(avatars));
                if (Object.keys(weapons).length) {
                    localStorage.setItem(CATALOG_WEAPON_KEY + game,
                        JSON.stringify(CATALOG_WEAPONS[game]));
                }
                if (Object.keys(ranks).length) {
                    localStorage.setItem(CATALOG_RANK_KEY + game,
                        JSON.stringify(CATALOG_RANKS[game]));
                }
            } catch (e) {
                /* 忽略隐私模式下的写入失败 */
            }
            toast('图鉴已更新：' + Object.keys(avatars).length + ' 个角色 · '
                + Object.keys(CATALOG_WEAPONS[game] || {}).length + ' 把武器');
            var view = state.view;
            if (view === 'stats') {
                loadStats();
            } else if (view === 'wishes') {
                loadWishes();
            } else if (view === 'collection') {
                loadCollection();
            } else if (view === 'dashboard') {
                loadDashboard();
            }
        });
    }

    /* ---------------- 设置 ---------------- */

    function gameDataPanelHtml(game) {
        var g = GAMES[game];
        return '<section class="panel">'
            + '<h3>' + esc(g.fullName) + '</h3>'
            + '<p class="panel-desc">使用 UIGF / SRGF 标准格式导入导出抽卡记录。</p>'
            + '<div class="settings-group">'
            + '<span class="settings-label">' + (game === 'starrail' ? 'SRGF v1.0' : 'UIGF v4.2') + '</span>'
            + '<div class="panel-actions">'
            + '<button class="btn btn-outline btn-sm" type="button" data-sg="uigf-export" data-game="'
            + game + '">导出 ' + (game === 'starrail' ? 'SRGF' : 'UIGF') + '</button>'
            + '<button class="btn btn-outline btn-sm" type="button" data-sg="uigf-import" data-game="'
            + game + '">导入 ' + (game === 'starrail' ? 'SRGF' : 'UIGF') + '</button>'
            + '<input id="sg-uigf-file-' + game + '" class="sg-file" type="file" '
            + 'accept=".json,application/json" data-sg-file="uigf" data-game="' + game + '" hidden/>'
            + '</div></div>'
            + '</section>';
    }

    /* ---------------- 收藏图鉴 ---------------- */

    function ownedStorageKeyFor(game) {
        var uid = (state.user && (state.user.id || state.user.username)) || 'guest';
        return 'sg_owned_' + uid + '_' + game;
    }

    function ownedStorageKey() {
        return ownedStorageKeyFor(state.game);
    }

    function loadOwnedDataFor(game) {
        var raw = safeParse(localStorage.getItem(ownedStorageKeyFor(game))) || {};
        return {
            characters4: raw.characters4 || {},
            characters5: raw.characters5 || {},
            weapons5: raw.weapons5 || {}
        };
    }

    function loadOwnedData() {
        return loadOwnedDataFor(state.game);
    }

    function saveOwnedData(data) {
        localStorage.setItem(ownedStorageKey(), JSON.stringify(data));
    }

    /** 全量备份用：两个游戏的手动补充一起打包 */
    function ownedSnapshotFor(game) {
        var data = loadOwnedDataFor(game);
        data.ocr = loadOcrOwnedFor(game);
        return data;
    }

    function ownedSnapshot() {
        return {
            genshin: ownedSnapshotFor('genshin'),
            starrail: ownedSnapshotFor('starrail')
        };
    }

    /** 恢复手动补充与识图记录：手动补充合并取较大值，覆盖直接用备份值 */
    function restoreOwnedSnapshot(owned, mode) {
        if (!owned || typeof owned !== 'object') {
            return;
        }
        ['genshin', 'starrail'].forEach(function (game) {
            var incoming = owned[game];
            if (!incoming || typeof incoming !== 'object') {
                return;
            }
            var data = {
                characters4: {},
                characters5: {},
                weapons5: {}
            };
            var exists = mode !== 'replace' ? loadOwnedDataFor(game) : null;
            ['characters4', 'characters5', 'weapons5'].forEach(function (key) {
                var source = incoming[key] || {};
                var base = exists ? (exists[key] || {}) : {};
                Object.keys(source).forEach(function (name) {
                    var value = Math.max(0, Math.floor(Number(source[name]) || 0));
                    if (!value) {
                        return;
                    }
                    data[key][name] = exists ? Math.max(base[name] || 0, value) : value;
                });
                if (exists) {
                    Object.keys(base).forEach(function (name) {
                        if (!data[key][name]) {
                            data[key][name] = base[name];
                        }
                    });
                }
            });
            localStorage.setItem(ownedStorageKeyFor(game), JSON.stringify(data));

            var ocrIncoming = incoming.ocr && typeof incoming.ocr === 'object' ? incoming.ocr : null;
            if (!ocrIncoming) {
                return;
            }
            var ocrBase = mode !== 'replace' ? loadOcrOwnedFor(game) : null;
            var ocrData = {
                characters4: {},
                characters5: {},
                weapons5: {}
            };
            ['characters4', 'characters5', 'weapons5'].forEach(function (key) {
                if (ocrBase) {
                    Object.keys(ocrBase[key] || {}).forEach(function (name) {
                        ocrData[key][name] = ocrBase[key][name];
                    });
                }
                var source = ocrIncoming[key] || {};
                Object.keys(source).forEach(function (name) {
                    var rank = Math.floor(Number(source[name]));
                    if (isFinite(rank) && rank >= 0) {
                        ocrData[key][name] = rank;
                    }
                });
            });
            saveOcrOwnedFor(game, ocrData);
        });
    }

    /* ---------------- 收藏识图（游戏截图 OCR，仅原神） ---------------- */

    function ocrOwnedKeyFor(game) {
        var uid = (state.user && (state.user.id || state.user.username)) || 'guest';
        return 'sg_owned_ocr_' + uid + '_' + game;
    }

    function loadOcrOwnedFor(game) {
        var raw = safeParse(localStorage.getItem(ocrOwnedKeyFor(game))) || {};
        return {
            characters4: raw.characters4 || {},
            characters5: raw.characters5 || {},
            weapons5: raw.weapons5 || {}
        };
    }

    function loadOcrOwned() {
        return loadOcrOwnedFor(state.game);
    }

    function saveOcrOwnedFor(game, data) {
        localStorage.setItem(ocrOwnedKeyFor(game), JSON.stringify(data));
    }

    function saveOcrOwned(data) {
        saveOcrOwnedFor(state.game, data);
    }

    var OCR_CN_DIGITS = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };

    function parseOcrDigit(value) {
        if (value === undefined || value === null) {
            return null;
        }
        var text = String(value).trim();
        if (/^\d+$/.test(text)) {
            return Number(text);
        }
        return OCR_CN_DIGITS[text] || null;
    }

    /** 从 OCR 文本里读命座 / 精炼等级；读不到时返回 null，交给用户确认 */
    function parseOcrRank(text, kind) {
        var compact = String(text || '').replace(/\s+/g, '');
        var patterns;
        var i;
        var value;
        if (kind === 'weapon') {
            patterns = [
                /精炼[^0-9一二三四五六]{0,8}([0-9一二三四五六])/,
                /([0-9一二三四五六])[阶级]?精炼/,
                /精炼[^0-9一二三四五六]{0,8}R([0-9一二三四五六])/
            ];
            for (i = 0; i < patterns.length; i += 1) {
                value = parseOcrDigit((compact.match(patterns[i]) || [])[1]);
                if (value !== null && value >= 1 && value <= 5) {
                    return value;
                }
            }
            return null;
        }
        patterns = [
            /命之座[^0-9一二三四五六]{0,8}([0-9一二三四五六])/,
            /命座[^0-9一二三四五六]{0,8}([0-9一二三四五六])/,
            /第([0-9一二三四五六])[层命]/,
            /([0-9])命/
        ];
        for (i = 0; i < patterns.length; i += 1) {
            value = parseOcrDigit((compact.match(patterns[i]) || [])[1]);
            if (value !== null && value >= 0 && value <= 6) {
                return value;
            }
        }
        /* 部分界面逐条标注激活状态：至少出现 3 条状态时才按「已激活」计数 */
        var activated = compact.match(/已激活/g) || [];
        var locked = compact.match(/未激活|未解锁/g) || [];
        if (activated.length + locked.length >= 3 && activated.length <= 6) {
            return activated.length;
        }
        return null;
    }

    /** 命之座名称 -> 角色：识图没读到角色名时，用右侧命座名反查（每个角色的 6 个命座名唯一） */
    function constellationCharacter(text, labelText) {
        var genshin = (window.SG_CONSTELLATIONS || {}).genshin || {};
        var labels = normalizeOcrLine(labelText);
        var page = normalizeOcrLine(text);
        if (!labels && !page) {
            return null;
        }
        var labelLines = String(labelText || '').split(/[\r\n]+/)
            .map(normalizeOcrLine).filter(Boolean);
        // 命座名是长句（如芙宁娜的「爱是难驯鸟…」）时，小字 OCR 常错两三个字，
        // 按整行相似度过一遍，避免只靠逐字容错漏掉这类角色
        function fuzzyLabelHit(nodeName) {
            for (var i = 0; i < labelLines.length; i += 1) {
                if (lineSimilarity(labelLines[i], nodeName) >= 0.65) {
                    return true;
                }
            }
            return false;
        }
        function matched(nodeName) {
            // 命座名里可能带引号 / 逗号（如芙宁娜的长句命座），比较前统一去掉标点
            var key = normalizeOcrLine(nodeName) || nodeName;
            if (labels && labels.indexOf(key) >= 0) {
                return true;
            }
            // 两字命座名（如「雷厉」「廉贞」）只在命座名列里做 1 个字的容错，
            // 不参与整页匹配，否则「心魔」「我界」这类词会在别处误命中
            if (labels) {
                for (var at = 0; at + key.length <= labels.length; at += 1) {
                    if (editDistance(labels.substr(at, key.length), key) <= 1) {
                        return true;
                    }
                }
            }
            if (key.length < 4) {
                return false;
            }
            if (fuzzyLabelHit(key)) {
                return true;
            }
            // 整页文字只认四字及以上的长命座名，避免「心魔」「我界」这类词在别处误命中
            return Boolean(page && page.indexOf(key) >= 0);
        }
        var counts = {};
        Object.keys(genshin).forEach(function (nodeName) {
            if (nodeName.indexOf('·') >= 0) {
                return;
            }
            if (matched(nodeName)) {
                var who = genshin[nodeName];
                counts[who] = (counts[who] || 0) + 1;
            }
        });
        var best = null;
        Object.keys(counts).forEach(function (who) {
            if (!best || counts[who] > counts[best]) {
                best = who;
            }
        });
        // 至少命中两个命座名才采信，避免把描述文字里的词当成命座
        return best && counts[best] >= 2 ? best : null;
    }

    function normalizeOcrLine(text) {
        return String(text || '').replace(/\s+/g, '')
            .replace(/[·•・\-–—_:：,，.。!！?？"'“”‘’「」『』()（）\[\]【】<>《》/\\|+*#%&@~^$]/g, '');
    }

    function editDistance(a, b) {
        var prev = [];
        var i;
        var j;
        for (j = 0; j <= b.length; j += 1) {
            prev[j] = j;
        }
        for (i = 1; i <= a.length; i += 1) {
            var curr = [i];
            for (j = 1; j <= b.length; j += 1) {
                curr[j] = Math.min(
                    prev[j] + 1,
                    curr[j - 1] + 1,
                    prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1)
                );
            }
            prev = curr;
        }
        return prev[b.length];
    }

    function lineSimilarity(a, b) {
        if (!a || !b) {
            return 0;
        }
        if (a === b) {
            return 1;
        }
        return 1 - editDistance(a, b) / Math.max(a.length, b.length);
    }

    /** 在 OCR 文本里找最可能的名称；单字名只认短行，避免误匹配 */
    function matchOcrName(text, names) {
        var source = String(text || '');
        if (!source.trim() || !names.length) {
            return null;
        }
        var compact = normalizeOcrLine(source);
        var lines = source.split(/[\r\n]+/).map(normalizeOcrLine).filter(Boolean);
        var best = null;
        names.forEach(function (name) {
            var key = normalizeOcrLine(name);
            if (!key) {
                return;
            }
            var score = 0;
            if (key.length === 1) {
                lines.forEach(function (line) {
                    if (line === key) {
                        score = 1;
                    } else if (line.indexOf(key) === 0 && line.length <= 4) {
                        score = Math.max(score, 0.9);
                    }
                });
            } else {
                var hits = 0;
                var from = 0;
                while (true) {
                    var at = compact.indexOf(key, from);
                    if (at < 0) {
                        break;
                    }
                    hits += 1;
                    from = at + key.length;
                }
                if (hits) {
                    score = 1 + Math.min(hits, 5) * 0.1;
                } else {
                    lines.forEach(function (line) {
                        if (Math.abs(line.length - key.length) <= 3) {
                            score = Math.max(score, lineSimilarity(line, key));
                        }
                    });
                }
            }
            if (score > (best ? best.score : 0.62)) {
                best = { name: name, score: score };
            }
        });
        return best;
    }

    function ocrRankOptions(section) {
        if (section === 'weapons5') {
            return [1, 2, 3, 4, 5].map(function (n) {
                return { value: n, label: 'R' + n + ' · 精炼 ' + n + ' 阶' };
            });
        }
        return [0, 1, 2, 3, 4, 5, 6].map(function (n) {
            return { value: n, label: n === 0 ? 'C0 · 暂无命座' : 'C' + n + ' · ' + n + ' 命' };
        });
    }

    function renderSelectOptions(selectEl, options, current) {
        selectEl.innerHTML = options.map(function (option) {
            return '<option value="' + esc(option.value) + '"'
                + (String(option.value) === String(current) ? ' selected' : '')
                + '>' + esc(option.label) + '</option>';
        }).join('');
    }

    /** 识图结果先做成候选，确认后才写入本机收藏记录 */
    function openCollectionOcrForm(text, constellation, characterName, weaponName, weaponRank,
                                   constellationText) {
        var g = gameConfig();
        var defs = collectionDefs(g);
        var lists = nameLists('genshin');
        var header = String(characterName || '').trim();
        var weaponHeader = String(weaponName || '').trim();
        // 左上角标题单独识别后再匹配；命中不够可信时仍回退到整页文本
        function headerMatch(names) {
            var match = header ? matchOcrName(header, names) : null;
            return match && match.score >= 0.8 ? match : null;
        }
        var hasConstellation = constellation !== null && constellation !== undefined
            && isFinite(Number(constellation));
        // 右侧命座名与角色一一对应：识别到命座后优先用它反查（例如「雷厉 / 苛捐 / 登楼 …」→ 刻晴）
        var constellationChar = hasConstellation
            ? constellationCharacter(text, constellationText) : null;
        var headerHit = headerMatch(lists.characters);
        var charMatch;
        if (headerHit && headerHit.score >= 1) {
            // 标题完整命中（不是相似度凑出来的）时最可信
            charMatch = headerHit;
        } else if (constellationChar) {
            // 标题读错或读不到时，以 6 个命座名为准
            charMatch = { name: constellationChar, score: 1 };
        } else {
            charMatch = headerHit || matchOcrName(text, lists.characters);
        }
        var weaponMatch = headerMatch(lists.weapons) || matchOcrName(text, lists.weapons);
        var hasWeapon = !hasConstellation && weaponHeader
            && lists.weapons.indexOf(weaponHeader) >= 0;
        var kind = 'character';
        var best = null;
        if (hasConstellation) {
            // 命之座界面必然是角色：标题识别不稳时也不能回退成武器（例如把「水元素 / 芙宁娜」错读成武器名）
            best = charMatch && charMatch.score >= 0.72 ? charMatch : null;
        } else if (hasWeapon) {
            // 武器详情页由后端单独识别，名称直接采用，不再和角色名单做模糊匹配
            kind = 'weapon';
            best = { name: weaponHeader, score: 1.1 };
        } else if (charMatch && (!weaponMatch || charMatch.score >= weaponMatch.score)) {
            best = charMatch;
        } else if (weaponMatch) {
            best = weaponMatch;
            kind = 'weapon';
        }
        if (best && best.score < 0.72) {
            best = null;
        }

        var section = best
            ? (kind === 'weapon'
                ? 'weapons5'
                : (isFourStarCharacter('genshin', best.name) ? 'characters4' : 'characters5'))
            : 'characters5';
        var name = best ? best.name : '';
        var scannedRank = parseOcrRank(text, kind);
        /* 武器详情页的精炼等级由后端单独读取 */
        if (kind === 'weapon' && weaponRank !== null && weaponRank !== undefined
            && isFinite(Number(weaponRank))) {
            scannedRank = Math.max(1, Math.min(5, Math.floor(Number(weaponRank))));
        }
        /* 命之座界面没有命座数字文字，用后端数出的点亮节点数兜底 */
        if (scannedRank === null && kind === 'character'
            && constellation !== null && constellation !== undefined
            && isFinite(Number(constellation))) {
            scannedRank = Math.max(0, Math.min(6, Math.floor(Number(constellation))));
        }
        var rank = scannedRank;
        var ocr = loadOcrOwned();
        if (rank === null && name && ocr[section] && ocr[section][name] != null) {
            rank = Number(ocr[section][name]);
        }
        if (rank === null) {
            rank = section === 'weapons5' ? 1 : 0;
        }
        var rankLabel = section === 'weapons5' ? '精炼等级' : '命座数';
        var hint = best
            ? '识别到「' + best.name + '」' + ((header || weaponHeader) ? '（左上角）' : '') + '，' + rankLabel
                + (scannedRank === null ? '未读到，请手动确认' : '为 ' + rank)
            : (header ? '左上角读到「' + header + '」但未匹配到收藏，请手动选择' : '没有识别到角色 / 武器名称，请手动选择');

        var categoryField = {
            key: 'category',
            label: '类别',
            type: 'select',
            full: true,
            options: defs.map(function (def) {
                return { value: def.key, label: def.title };
            }),
            default: section
        };
        var nameField = {
            key: 'name',
            label: '名称',
            type: 'name-picker',
            full: true,
            options: ownedNameOptions('genshin', section)
        };
        var rankField = {
            key: 'rank',
            label: rankLabel,
            type: 'select',
            full: true,
            options: ocrRankOptions(section)
        };

        return openForm('识图确认 · 原神收藏', [
            categoryField,
            nameField,
            rankField
        ], { category: section, name: name, rank: rank }, {
            hint: hint + '。核对后保存，同一名称会覆盖旧的识图记录。',
            submitText: '写入收藏',
            onMount: function (mask) {
                var categoryEl = $('select[name="category"]', mask);
                var nameEl = $('input[name="name"]', mask);
                var rankEl = $('select[name="rank"]', mask);
                var trigger = $('.name-picker-trigger[data-picker-key="name"]', mask);
                if (!categoryEl || !nameEl || !rankEl || !trigger) {
                    return;
                }
                var rankLabelEl = rankEl.parentNode ? $('span', rankEl.parentNode) : null;
                categoryEl.addEventListener('change', function () {
                    var next = categoryEl.value;
                    section = next;
                    nameField.options = ownedNameOptions('genshin', next);
                    nameEl.value = '';
                    updateNameTrigger(trigger, '');
                    rankField.options = ocrRankOptions(next);
                    renderSelectOptions(rankEl, rankField.options, next === 'weapons5' ? 1 : 0);
                    if (rankLabelEl) {
                        rankLabelEl.textContent = next === 'weapons5' ? '精炼等级' : '命座数';
                    }
                });
            },
            validate: function (values) {
                if (!String(values.name || '').trim()) {
                    return '请选择角色 / 武器';
                }
                var value = Math.floor(Number(values.rank));
                if (!isFinite(value)) {
                    return '请选择' + (values.category === 'weapons5' ? '精炼等级' : '命座数');
                }
                return null;
            }
        }).then(function (values) {
            if (!values) {
                return null;
            }
            var ocrData = loadOcrOwned();
            var sectionKey = values.category;
            var itemName = String(values.name || '').trim();
            var value = Math.floor(Number(values.rank));
            var max = sectionKey === 'weapons5' ? 5 : 6;
            var min = sectionKey === 'weapons5' ? 1 : 0;
            value = Math.max(min, Math.min(max, value));
            ['characters4', 'characters5', 'weapons5'].forEach(function (key) {
                if (key !== sectionKey && ocrData[key]) {
                    delete ocrData[key][itemName];
                }
            });
            ocrData[sectionKey][itemName] = value;
            saveOcrOwned(ocrData);
            toast('已记录 ' + itemName + ' · ' + (sectionKey === 'weapons5' ? 'R' + value : 'C' + value));
            loadCollection();
            return values;
        });
    }

    function openCollectionOcr() {
        if (state.game !== 'genshin') {
            toast('识图目前只支持原神', 'error');
            return null;
        }
        return openLiveCapture({
            title: '识图读取收藏',
            hint: '打开「角色 → 命之座」界面（会自动数右侧命座点亮个数），或武器详情（看精炼等级），再点「识别当前画面」。'
        }).then(function (file) {
            if (!file) {
                return null;
            }
            toast('正在识别截图…');
            return uploadRawImage(file, 'page');
        }).then(function (raw) {
            if (!raw) {
                return null;
            }
            return openCollectionOcrForm(raw.text || '', raw.constellation, raw.characterName,
                raw.weaponName, raw.weaponRank, raw.constellationText);
        });
    }

    function collectionDefs(g) {
        return [
            { key: 'characters5', title: '五星角色', kind: 'character', rarity: 5 },
            { key: 'weapons5', title: g.itemTypes[1] === '光锥' ? '五星光锥' : '五星武器',
                kind: 'weapon', rarity: 5 },
            { key: 'characters4', title: '四星角色', kind: 'character', rarity: 4 }
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

    function collectionCardHtml(game, sectionKey, kind, name, copies, manual, iconMap, rarity, ocrRank) {
        var icon = iconMap[name] || '';
        var scanned = ocrRank !== null && ocrRank !== undefined && isFinite(Number(ocrRank));
        var badge;
        var sub;
        if (kind === 'character') {
            badge = 'C' + (scanned
                ? Math.min(6, Math.max(0, Math.floor(Number(ocrRank))))
                : Math.min(6, Math.max(0, copies - 1)));
            sub = scanned ? '识图确认' : '共 ' + copies + ' 份';
        } else {
            badge = 'R' + (scanned
                ? Math.min(5, Math.max(1, Math.floor(Number(ocrRank))))
                : Math.min(5, Math.max(1, copies)));
            sub = scanned ? '识图确认' : '共 ' + copies + ' 把';
        }
        return '<div class="collection-card rarity-' + rarity + '">'
            + '<div class="collection-icon"><span>' + esc(name.charAt(0)) + '</span>'
            + (icon ? '<img src="' + esc(icon) + '" alt="" loading="lazy" onerror="this.remove()">' : '')
            + '</div>'
            + '<div class="collection-name" title="' + esc(name) + '">' + esc(name) + '</div>'
            + '<div class="collection-meta"><span class="collection-rank">' + badge + '</span>'
            + '<span>' + sub + '</span></div>'
            + (scanned
                ? '<button class="collection-ocr-chip" type="button" title="长按清除识图记录" data-section="'
                    + esc(sectionKey) + '" data-name="' + esc(name) + '">识图 ' + badge + '</button>'
                : '')
            + (manual > 0
                ? '<button class="collection-manual-chip" type="button" title="长按清除手动补充" data-section="'
                    + esc(sectionKey) + '" data-name="' + esc(name) + '">手动 +' + manual + '</button>'
                : '')
            + '</div>';
    }

    function collectionSectionsHtml(game, items, owned, g, ocr) {
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
            var ocrMap = (ocr && ocr[def.key]) || {};
            Object.keys(ocrMap).forEach(function (name) {
                var rank = Math.floor(Number(ocrMap[name]));
                if (!isFinite(rank) || rank < 0) {
                    return;
                }
                var existing = sections[def.key].filter(function (entry) {
                    return entry.name === name;
                })[0];
                if (existing) {
                    existing.ocrRank = rank;
                } else {
                    sections[def.key].push({ name: name, count: 0, manual: 0, ocrRank: rank });
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
                    entry.manual, iconMap, def.rarity, entry.ocrRank);
            }).join('');
            return '<section class="panel collection-panel">'
                + '<h3>' + esc(def.title) + '<span class="pool-tag">' + sections[def.key].length + '</span></h3>'
                + (cards
                    ? '<div class="collection-grid">' + cards + '</div>'
                    : emptyHtml('还没有' + def.title))
                + '</section>';
        }).join('');
    }

    function openOwnedForm(initial) {
        var g = gameConfig();
        var defs = collectionDefs(g);
        var seed = initial || {};
        var seedCategory = seed.category;
        var hasSeedCategory = defs.some(function (def) {
            return def.key === seedCategory;
        });
        // 单独持有名称字段，类别切换时直接改它的候选名单
        var nameField = {
            key: 'name',
            label: '名称',
            type: 'name-picker',
            full: true,
            default: seed.name || '',
            options: ownedNameOptions(state.game, hasSeedCategory ? seedCategory : defs[0].key)
        };
        return openForm('补充已有 · ' + g.fullName, [
            {
                key: 'category',
                label: '类别',
                type: 'select',
                full: true,
                options: defs.map(function (def) {
                    return { value: def.key, label: def.title };
                }),
                default: hasSeedCategory ? seedCategory : defs[0].key
            },
            nameField,
            {
                key: 'copies',
                label: '额外数量',
                type: 'number',
                full: true,
                min: 1,
                max: 7,
                default: seed.copies || 1
            }
        ], null, {
            hint: seed.hint || '类别决定分栏；额外数量会叠加到抽卡记录统计，角色按命座展示（最高 C6），武器按精炼展示（最高 R5）。',
            submitText: '保存',
            onMount: function (mask) {
                var categoryEl = $('select[name="category"]', mask);
                var nameEl = $('input[name="name"]', mask);
                if (!categoryEl || !nameEl) {
                    return;
                }
                var trigger = $('.name-picker-trigger[data-picker-key="name"]', mask);
                categoryEl.addEventListener('change', function () {
                    nameField.options = ownedNameOptions(state.game, categoryEl.value);
                    nameEl.value = '';
                    if (trigger) {
                        updateNameTrigger(trigger, '');
                    }
                });
            },
            validate: function (values) {
                if (!String(values.name || '').trim()) {
                    return '请选择角色 / 物品';
                }
                var copies = Number(values.copies);
                if (!isFinite(copies) || copies < 1 || copies > 7) {
                    return '额外数量需在 1–7 之间';
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
            var ocr = loadOcrOwned();
            el.innerHTML =
                '<div class="page-head">'
                + '<div><p class="eyebrow">Collection</p><h2>收藏图鉴</h2>'
                + '<p class="sub">五星角色 · 五星' + (g.itemTypes[1] === '光锥' ? '光锥' : '武器')
                + ' · 四星角色'
                + ' · 角色最高 C6，武器最高 R5'
                + (game === 'genshin' ? ' · 支持截图识图' : '') + '</p></div>'
                + '<div class="head-actions">'
                + '<button class="btn btn-primary" id="collection-enter" type="button">+ 录入图鉴</button>'
                + '</div></div>'
                + collectionSectionsHtml(game, items || [], owned, g, ocr)
                + '<p class="foot-tip">手动补充与识图记录保存在本机浏览器，已随全量备份一起导出 / 导入；'
                + '长按「手动 +N」或「识图 C/R」标签才会清除，抽卡记录会随导入自动更新。</p>';

            $('#collection-enter').addEventListener('click', function () {
                var actions = [];
                if (game === 'genshin') {
                    actions.push({ key: 'ocr', label: '识图读取', run: openCollectionOcr });
                }
                actions.push({ key: 'ai', label: 'AI 自然语言录入', primary: true, run: openAiInput });
                actions.push({ key: 'manual', label: '手动补充已有', run: openOwnedForm });
                guard(function () {
                    return openEntryMenu('录入收藏图鉴', '选择录入方式', actions);
                });
            });

            function removeOwned(section, name) {
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
            }

            function removeOcr(section, name) {
                if (!window.confirm('清除「' + name + '」的识图记录？')) {
                    return;
                }
                var data = loadOcrOwned();
                if (data[section]) {
                    delete data[section][name];
                }
                saveOcrOwned(data);
                toast('已清除 ' + name + ' 的识图记录');
                loadCollection();
            }

            function bindLongPress(selector, handler) {
                $$(selector, el).forEach(function (btn) {
                    var timer = null;
                    function cancel() {
                        if (timer) {
                            clearTimeout(timer);
                            timer = null;
                        }
                    }
                    btn.addEventListener('pointerdown', function () {
                        cancel();
                        timer = setTimeout(function () {
                            timer = null;
                            handler(btn.dataset.section, btn.dataset.name);
                        }, 650);
                    });
                    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (name) {
                        btn.addEventListener(name, cancel);
                    });
                });
            }

            bindLongPress('.collection-manual-chip', removeOwned);
            bindLongPress('.collection-ocr-chip', removeOcr);
        }).catch(function (err) {
            el.innerHTML = errorHtml(err);
        });
    }


    /* ---------------- 云同步（电脑端 ↔ 小程序） ---------------- */

    function cloudServiceUrl() {
        var saved = localStorage.getItem(CLOUD_SERVICE_KEY);
        return (saved && saved.trim()) || CLOUD_DEFAULT_SERVICE;
    }

    function cloudCode() {
        var saved = localStorage.getItem(CLOUD_CODE_KEY) || '';
        return saved.toUpperCase().replace(/[^0-9A-Z]/g, '');
    }

    function prettySyncCode(code) {
        var text = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        var groups = [];
        for (var i = 0; i < text.length; i += 4) {
            groups.push(text.substring(i, i + 4));
        }
        return groups.join('-');
    }

    function cloudMeta() {
        try {
            var raw = JSON.parse(localStorage.getItem(CLOUD_META_KEY) || '{}');
            return raw && typeof raw === 'object' ? raw : {};
        } catch (e) {
            return {};
        }
    }

    function cloudAutoEnabled() {
        return localStorage.getItem(CLOUD_AUTO_KEY) === '1';
    }

    function cloudStatusText() {
        if (!cloudCode()) {
            return '尚未绑定同步码：先点「生成同步码」，再到小程序「资源 · 云同步」里绑定同一串码。';
        }
        var meta = cloudMeta();
        if (!meta.lastSyncAt) {
            return '已绑定同步码，还没有同步过数据。';
        }
        return '上次同步：' + new Date(meta.lastSyncAt).toLocaleString();
    }

    function updateCloudStatus(text) {
        var el = $('#sync-status');
        if (el) {
            el.textContent = text;
        }
    }

    /** 导出当前账号的全量数据，并附加仅存在本机的收藏补充 */
    function fetchFullBackup() {
        return fetch(withGame('/api/backup/export-all'), {
            headers: state.token ? { Authorization: 'Bearer ' + state.token } : {}
        }).then(function (res) {
            if (res.status === 401) {
                logout(true);
                throw new Error('登录已失效，请重新登录');
            }
            if (!res.ok) {
                throw new Error('导出失败（' + res.status + '）');
            }
            return res.json();
        }).then(function (data) {
            data.owned = ownedSnapshot();
            return data;
        });
    }

    function createCloudCode() {
        var serviceUrl = $('#sync-service') ? $('#sync-service').value.trim() : cloudServiceUrl();
        if (!serviceUrl) {
            throw new Error('请填写云端服务地址');
        }
        return api('/api/cloud-sync/create', {
            method: 'POST',
            body: { serviceUrl: serviceUrl }
        }).then(function (data) {
            localStorage.setItem(CLOUD_SERVICE_KEY, serviceUrl);
            localStorage.setItem(CLOUD_CODE_KEY, data.code);
            localStorage.removeItem(CLOUD_META_KEY);
            toast('同步码已生成，请复制到小程序里绑定');
            switchView('settings');
            return data;
        });
    }

    function bindCloudCode() {
        var serviceInput = $('#sync-service');
        var codeInput = $('#sync-code');
        var serviceUrl = serviceInput ? serviceInput.value.trim() : cloudServiceUrl();
        var normalized = String(codeInput ? codeInput.value : '')
            .toUpperCase().replace(/[^0-9A-Z]/g, '');
        if (normalized.length < 20 || normalized.length > 64) {
            throw new Error('同步码应为 20–64 位字母数字');
        }
        return api('/api/cloud-sync/pull', {
            method: 'POST',
            body: { serviceUrl: serviceUrl, code: normalized }
        }).then(function () {
            localStorage.setItem(CLOUD_SERVICE_KEY, serviceUrl);
            localStorage.setItem(CLOUD_CODE_KEY, normalized);
            localStorage.removeItem(CLOUD_META_KEY);
            toast('已绑定同步码，点「立即同步」开始互通');
            switchView('settings');
            return null;
        });
    }

    /** 一次完整同步：拉取 → 合并导入 → 重新导出 → 加密上传 */
    function cloudSyncRound(serviceUrl, code, allowRetry) {
        return api('/api/cloud-sync/pull', {
            method: 'POST',
            body: { serviceUrl: serviceUrl, code: code }
        }).then(function (remote) {
            var pulled = Promise.resolve(null);
            if (remote && remote.payload) {
                pulled = api('/api/backup/import-all?mode=merge', {
                    method: 'POST',
                    body: remote.payload
                }).then(function (result) {
                    restoreOwnedSnapshot(remote.payload.owned, 'merge');
                    return result;
                });
            }
            return pulled.then(function (result) {
                return fetchFullBackup().then(function (backup) {
                    return api('/api/cloud-sync/push', {
                        method: 'POST',
                        body: {
                            serviceUrl: serviceUrl,
                            code: code,
                            payload: backup,
                            prevUpdatedAt: (remote && remote.updatedAt) || 0
                        }
                    }).then(function (pushed) {
                        var meta = { lastSyncAt: Date.now(), updatedAt: pushed.updatedAt || 0 };
                        localStorage.setItem(CLOUD_META_KEY, JSON.stringify(meta));
                        return { imported: result, updatedAt: meta.updatedAt };
                    });
                });
            });
        }).catch(function (err) {
            // 另一台设备刚推过：重新拉取合并后再推一次
            if (err && err.code === 409 && allowRetry) {
                return cloudSyncRound(serviceUrl, code, false);
            }
            throw err;
        });
    }

    /** 只上传：先读一次云端更新时间做并发校验，再用本机数据覆盖云端。 */
    function runCloudPush(serviceUrl, code) {
        function attempt(allowRetry) {
            return api('/api/cloud-sync/pull', {
                method: 'POST',
                body: { serviceUrl: serviceUrl, code: code }
            }).then(function (remote) {
                return fetchFullBackup().then(function (backup) {
                    return api('/api/cloud-sync/push', {
                        method: 'POST',
                        body: {
                            serviceUrl: serviceUrl,
                            code: code,
                            payload: backup,
                            prevUpdatedAt: (remote && remote.updatedAt) || 0
                        }
                    });
                });
            }).catch(function (err) {
                if (err && err.code === 409 && allowRetry) {
                    return attempt(false);
                }
                throw err;
            });
        }
        return attempt(true).then(function (pushed) {
            localStorage.setItem(CLOUD_META_KEY, JSON.stringify({
                lastSyncAt: Date.now(),
                updatedAt: (pushed && pushed.updatedAt) || 0
            }));
            return pushed;
        });
    }

    function runUploadCloud() {
        var code = cloudCode();
        if (!code) {
            toast('请先生成或绑定同步码', 'error');
            return Promise.resolve(null);
        }
        if (cloudSyncing) {
            return Promise.resolve(null);
        }
        cloudSyncing = true;
        updateCloudStatus('正在上传本地数据…');
        return runCloudPush(cloudServiceUrl(), code).then(function (pushed) {
            cloudSyncing = false;
            updateCloudStatus(cloudStatusText());
            toast('已用本地数据覆盖云端');
            switchView('settings');
            return pushed;
        }).catch(function (err) {
            cloudSyncing = false;
            var message = (err && err.message) || '上传失败';
            updateCloudStatus('上传失败：' + message);
            throw err;
        });
    }

    function runCloudSync(silent) {
        var code = cloudCode();
        if (!code) {
            if (!silent) {
                toast('请先生成或绑定同步码', 'error');
            }
            return Promise.resolve(null);
        }
        if (cloudSyncing) {
            return Promise.resolve(null);
        }
        cloudSyncing = true;
        updateCloudStatus('正在同步…');
        return cloudSyncRound(cloudServiceUrl(), code, true).then(function (result) {
            cloudSyncing = false;
            updateCloudStatus(cloudStatusText());
            if (!silent) {
                var imported = result && result.imported;
                toast(imported
                    ? '同步完成：新增抽卡 ' + imported.wishes + ' 条'
                        + (imported.resourceUpdated ? '，资源已按较新一份合并' : '')
                    : '同步完成：本机数据已加密上传');
                switchView('settings');
            }
            return result;
        }).catch(function (err) {
            cloudSyncing = false;
            var message = (err && err.message) || '同步失败';
            updateCloudStatus('同步失败：' + message);
            if (silent) {
                return null;
            }
            throw err;
        });
    }

    function maybeAutoCloudSync() {
        if (!cloudAutoEnabled() || !cloudCode() || cloudSyncing) {
            return;
        }
        var meta = cloudMeta();
        if (meta.lastSyncAt && Date.now() - meta.lastSyncAt < 5 * 60 * 1000) {
            return;
        }
        runCloudSync(true);
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

            + '<section class="panel">'
            + '<h3>云同步 · 电脑端 ↔ 小程序<span class="pool-tag">端到端加密</span></h3>'
            + '<p class="panel-desc">抽卡记录与账号资源会先在本机加密再上传，云端只保存密文；'
            + '不会上传登录账号、昵称、设备信息或同步码本身。同步码只显示在本机与小程序里，请自行保管。</p>'
            + '<p class="panel-desc">「立即同步」＝先拉取云端并合并，再把合并结果上传（资源取修改时间较新的那份）；'
            + '想直接用本机数据覆盖云端时，点「上传本地覆盖云端」。</p>'
            + '<div class="profile-fields">'
            + '<label class="field"><span>云端服务地址</span>'
            + '<input id="sync-service" type="text" value="' + esc(cloudServiceUrl()) + '" '
            + 'placeholder="https://xxx.service.tcloudbase.com/syncStore"/></label>'
            + '<label class="field"><span>同步码</span>'
            + '<input id="sync-code" type="text" value="' + esc(prettySyncCode(cloudCode())) + '" '
            + 'placeholder="生成新同步码，或粘贴小程序里的同步码"/></label>'
            + '</div>'
            + '<div class="panel-actions">'
            + '<button class="btn btn-outline" id="sync-create" type="button">生成同步码</button>'
            + '<button class="btn btn-outline" id="sync-bind" type="button">保存并绑定</button>'
            + '<button class="btn btn-primary" id="sync-now" type="button">立即同步</button>'
            + '<button class="btn btn-outline" id="sync-push" type="button">上传本地覆盖云端</button>'
            + '<button class="btn btn-outline" id="sync-unbind" type="button">解绑本机</button>'
            + '<button class="btn btn-outline" id="sync-delete" type="button">删除云端密文</button>'
            + '</div>'
            + '<p class="panel-desc" id="sync-status" style="margin-top:12px">' + esc(cloudStatusText()) + '</p>'
            + '<label class="field" style="flex-direction:row;align-items:center;gap:8px">'
            + '<input id="sync-auto" type="checkbox" ' + (cloudAutoEnabled() ? 'checked' : '') + ' style="width:auto"/>'
            + '<span>打开设置页时自动同步（距上次超过 5 分钟才执行）</span></label>'
            + '</section>'

            + '<div class="panel-grid">'
            + gameDataPanelHtml('genshin')
            + gameDataPanelHtml('starrail')
            + '</div>'

            + '<section class="panel">'
            + '<h3>图鉴数据源<span class="pool-tag">在线刷新 · 本机缓存</span></h3>'
            + '<p class="panel-desc">头像默认使用内置静态数据；联网时优先由浏览器直接获取 '
            + 'Yatta（原神）与 StarRailRes（星穹铁道）的数据，失败再尝试本机服务，结果缓存在本机，'
            + '离线时继续使用内置或上次缓存。数据仅用于非商业个人记录。</p>'
            + '<div class="panel-actions">'
            + '<button class="btn btn-outline" id="catalog-refresh-genshin" type="button">刷新原神图鉴</button>'
            + '<button class="btn btn-outline" id="catalog-refresh-starrail" type="button">刷新星铁图鉴</button>'
            + '</div></section>'

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
            + '</section>'

            + '<section class="panel">'
            + '<h3>账号安全</h3>'
            + '<p class="panel-desc">登录账号：' + esc(username) + '。修改密码需要输入当前密码；'
            + '恢复码用于忘记密码时找回账号，重新生成后旧恢复码立即失效。</p>'
            + '<div class="panel-actions">'
            + '<button class="btn btn-primary" id="password-change" type="button">修改登录密码</button>'
            + '<button class="btn btn-outline" id="recovery-create" type="button">生成恢复码</button>'
            + '</div>'
            + '</section>';

        bindSettings();
        maybeAutoCloudSync();
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
                return fetch(withGame('/api/backup/export-all'), {
                    headers: state.token ? { Authorization: 'Bearer ' + state.token } : {}
                }).then(function (res) {
                    if (res.status === 401) {
                        logout(true);
                        throw new Error('登录已失效，请重新登录');
                    }
                    if (!res.ok) {
                        throw new Error('导出失败（' + res.status + '）');
                    }
                    return res.json();
                }).then(function (data) {
                    data.owned = ownedSnapshot();
                    downloadJsonObject(data, '南空提瓦特小助手-全量备份.json');
                    toast('全部数据已导出（含收藏补充与识图）');
                    return data;
                });
            });
        });
        importAllBtn.addEventListener('click', function () {
            allFile.click();
        });
        allFile.addEventListener('change', onAllBackupFileSelected);

        var syncCreateBtn = $('#sync-create');
        if (syncCreateBtn) {
            syncCreateBtn.addEventListener('click', function () {
                guard(function () {
                    return createCloudCode();
                });
            });
        }
        var syncBindBtn = $('#sync-bind');
        if (syncBindBtn) {
            syncBindBtn.addEventListener('click', function () {
                guard(function () {
                    return bindCloudCode();
                });
            });
        }
        var syncNowBtn = $('#sync-now');
        if (syncNowBtn) {
            syncNowBtn.addEventListener('click', function () {
                guard(function () {
                    return runCloudSync(false);
                });
            });
        }
        var syncPushBtn = $('#sync-push');
        if (syncPushBtn) {
            syncPushBtn.addEventListener('click', function () {
                if (!cloudCode()) {
                    toast('请先生成或绑定同步码');
                    return;
                }
                if (!window.confirm('会用本机数据覆盖云端备份，其它设备下次同步会拉取这份数据。确定上传吗？')) {
                    return;
                }
                guard(function () {
                    return runUploadCloud();
                });
            });
        }
        var syncUnbindBtn = $('#sync-unbind');
        if (syncUnbindBtn) {
            syncUnbindBtn.addEventListener('click', function () {
                if (!cloudCode()) {
                    toast('本机还没有绑定同步码');
                    return;
                }
                if (!window.confirm('解绑只清除本机保存的同步码，云端密文仍保留，之后可用同一同步码重新绑定。确定解绑吗？')) {
                    return;
                }
                localStorage.removeItem(CLOUD_CODE_KEY);
                localStorage.removeItem(CLOUD_META_KEY);
                toast('已解绑本机云同步');
                switchView('settings');
            });
        }
        var syncAutoBox = $('#sync-auto');
        if (syncAutoBox) {
            syncAutoBox.addEventListener('change', function () {
                if (syncAutoBox.checked) {
                    localStorage.setItem(CLOUD_AUTO_KEY, '1');
                    maybeAutoCloudSync();
                } else {
                    localStorage.removeItem(CLOUD_AUTO_KEY);
                }
            });
        }
        var syncDeleteBtn = $('#sync-delete');
        if (syncDeleteBtn) {
            syncDeleteBtn.addEventListener('click', function () {
                if (!cloudCode()) {
                    toast('本机还没有绑定同步码');
                    return;
                }
                if (!window.confirm('将删除云端的加密副本并解绑本机，其他设备需要重新生成同步码。确定删除吗？')) {
                    return;
                }
                guard(function () {
                    return api('/api/cloud-sync/delete', {
                        method: 'POST',
                        body: { serviceUrl: cloudServiceUrl(), code: cloudCode() }
                    }).then(function () {
                        localStorage.removeItem(CLOUD_CODE_KEY);
                        localStorage.removeItem(CLOUD_META_KEY);
                        toast('云端数据已删除');
                        switchView('settings');
                    });
                });
            });
        }

        ['genshin', 'starrail'].forEach(function (game) {
            var btn = $('#catalog-refresh-' + game);
            if (btn) {
                btn.addEventListener('click', function () {
                    guard(function () {
                        return refreshCatalog(game);
                    });
                });
            }
        });

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

        var passwordChangeBtn = $('#password-change');
        if (passwordChangeBtn) {
            passwordChangeBtn.addEventListener('click', function () {
                openChangePassword();
            });
        }
        var recoveryCreateBtn = $('#recovery-create');
        if (recoveryCreateBtn) {
            recoveryCreateBtn.addEventListener('click', function () {
                openRecoveryCodeCreate();
            });
        }

        el.addEventListener('click', function (event) {
            var btn = event.target.closest('[data-sg]');
            if (!btn) {
                return;
            }
            var game = btn.dataset.game;
            var action = btn.dataset.sg;
            if (action === 'uigf-export') {
                guard(function () {
                    return downloadFile('/api/wishes/export-uigf',
                        '南空提瓦特小助手-' + game + (game === 'starrail' ? '-srgf.json' : '-uigf.json'),
                        (game === 'starrail' ? 'SRGF' : 'UIGF') + ' 已导出', game);
                });
            } else if (action === 'uigf-import') {
                var input = document.getElementById('sg-uigf-file-' + game);
                if (input) {
                    input.click();
                }
            }
        });

        el.addEventListener('change', function (event) {
            var input = event.target;
            if (!input.classList || !input.classList.contains('sg-file')) {
                return;
            }
            if (input.dataset.sgFile === 'uigf') {
                onUigfFileSelected(event, input.dataset.game);
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

    /** 设置页：修改登录密码 */
    function openChangePassword() {
        return openForm('修改登录密码', [
            { key: 'currentPassword', label: '当前密码', type: 'password', required: true },
            { key: 'newPassword', label: '新密码', type: 'password', required: true, placeholder: '至少 6 位' },
            { key: 'confirmPassword', label: '确认新密码', type: 'password', required: true }
        ], {}, {
            hint: '修改后当前登录仍然有效；其他设备上的登录需要重新输入新密码。',
            submitText: '保存新密码'
        }).then(function (values) {
            if (!values) {
                return null;
            }
            var current = String(values.currentPassword || '');
            var next = String(values.newPassword || '');
            var confirm = String(values.confirmPassword || '');
            if (next.length < 6) {
                toast('密码至少 6 位', 'error');
                return null;
            }
            if (next !== confirm) {
                toast('两次输入的新密码不一致', 'error');
                return null;
            }
            return api('/api/auth/password', {
                method: 'PUT',
                body: { currentPassword: current, newPassword: next }
            }).then(function () {
                toast('登录密码已更新');
                return null;
            });
        }).catch(function (err) {
            toast(err.message || '修改失败', 'error');
            return null;
        });
    }

    /** 设置页：生成 / 重新生成恢复码 */
    function openRecoveryCodeCreate() {
        return openForm('生成恢复码', [
            { key: 'currentPassword', label: '当前密码', type: 'password', required: true }
        ], {}, {
            hint: '生成后旧恢复码立即失效，新恢复码只显示这一次，请抄写保存。',
            submitText: '生成'
        }).then(function (values) {
            if (!values) {
                return null;
            }
            return api('/api/auth/recovery-code', {
                method: 'POST',
                body: { currentPassword: String(values.currentPassword || '') }
            }).then(function (data) {
                return showRecoveryCode(data.code);
            });
        }).catch(function (err) {
            toast(err.message || '生成失败', 'error');
            return null;
        });
    }

    /* ---------------- 截图识别 ---------------- */

    var OCR_ENGINE_KEY = 'sg_ocr_engine';
    var OCR_MODE_KEY = 'sg_ocr_mode';
    var TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@4.1.4/dist/tesseract.min.js';
    var tesseractLoading = null;

    var OCR_MODE_HINTS = {
        wishes: '上传游戏内抽卡记录截图，按文字与角色 / 武器头像识别候选记录；核对名称、星级与卡池后再导入。',
        history: '上传第三方助手「出金历史」截图：每行只认「N抽」次数与左侧头像，'
            + '卡池按顶部标签推断，时间默认当前且可逐条修改。'
    };

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

    /** 浏览器 OCR：只取文字与坐标，原生截图与出金历史各自解析 */
    function browserRecognize(file, onStatus) {
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
                var data = (res && res.data) || {};
                return { text: data.text || '', tsv: data.tsv || '' };
            });
        });
    }

    function runBrowserOcr(file, onStatus) {
        return browserRecognize(file, onStatus).then(function (data) {
            return api('/api/ocr/parse', {
                method: 'POST',
                body: { text: data.text || '', tsv: data.tsv || '' }
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
        return String(text).replace('T', ' ').slice(0, 16);
    }

    function openOcrDialog() {
        var g = gameConfig();
        if (!liveCaptureSupported()) {
            toast('截图识别需要在南空提瓦特小助手内运行，并保持原神窗口化或无边框模式', 'error');
            return Promise.resolve(false);
        }
        var selected = localStorage.getItem(OCR_ENGINE_KEY) || '';
        var mode = localStorage.getItem(OCR_MODE_KEY) === 'history' ? 'history' : 'wishes';
        var currentFile = null;

        return new Promise(function (resolve) {
            var mask = document.createElement('div');
            mask.className = 'modal-mask';
            mask.innerHTML = '<div class="modal modal-wide ocr-modal">'
                + '<header><h3>截图识别抽卡'
                + '<span class="pool-tag">' + esc(g.fullName) + '</span></h3>'
                + '<button class="modal-close" type="button" aria-label="关闭">×</button></header>'
                + '<div class="modal-body ocr-body">'
                + '<div class="ocr-modes" id="ocr-modes">'
                + '<button type="button" class="ocr-mode" data-mode="wishes">抽卡记录</button>'
                + '<button type="button" class="ocr-mode" data-mode="history">出金历史</button>'
                + '</div>'
                + '<p class="modal-hint" id="ocr-mode-hint">' + esc(OCR_MODE_HINTS[mode]) + '</p>'
                + '<div class="ocr-engines" id="ocr-engines"><span class="ocr-loading">正在检测可用引擎…</span></div>'
                + '<div class="live-capture-body ocr-live-body">'
                + '<img id="ocr-preview" class="live-capture-preview" alt="原神实时画面" hidden/>'
                + '<div id="ocr-live-placeholder" class="live-capture-placeholder">正在连接原神窗口…</div>'
                + '</div>'
                + '<div class="ocr-bar">'
                + '<span class="ocr-status" id="ocr-status">正在连接原神窗口…</span>'
                + '<button class="btn btn-outline btn-sm" id="ocr-live-retry" type="button" hidden>重连</button>'
                + '<button class="btn btn-primary btn-sm" id="ocr-run" type="button" disabled>开始识别</button>'
                + '</div>'
                + '<div id="ocr-result" class="ocr-result"></div>'
                + '</div>'
                + '<footer class="modal-foot"><button type="button" class="btn btn-text modal-cancel">关闭</button></footer>'
                + '</div>';

            document.body.appendChild(mask);
            document.body.style.overflow = 'hidden';

            function close(result) {
                clearLiveTimer();
                stopLiveCapture();
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

            var enginesBox = $('#ocr-engines', mask);
            var modesBox = $('#ocr-modes', mask);
            var modeHint = $('#ocr-mode-hint', mask);
            var preview = $('#ocr-preview', mask);
            var placeholder = $('#ocr-live-placeholder', mask);
            var retryBtn = $('#ocr-live-retry', mask);
            var runBtn = $('#ocr-run', mask);
            var statusEl = $('#ocr-status', mask);
            var resultBox = $('#ocr-result', mask);
            var engines = [];
            var liveLatest = null;
            var liveTimer = null;

            function clearLiveTimer() {
                if (liveTimer) {
                    clearTimeout(liveTimer);
                    liveTimer = null;
                }
            }

            function stopLiveCapture() {
                liveCaptureSession = null;
                try {
                    window.chrome.webview.postMessage({ action: 'captureLiveStop' });
                } catch (e) {
                    // 启动器已关闭时忽略
                }
            }

            function updateRunState() {
                runBtn.disabled = !liveLatest || !selected;
            }

            function startLiveCapture() {
                liveLatest = null;
                currentFile = null;
                preview.hidden = true;
                preview.removeAttribute('src');
                placeholder.hidden = false;
                placeholder.textContent = '正在连接原神窗口…';
                retryBtn.hidden = true;
                setStatus('正在连接原神窗口…');
                updateRunState();
                clearLiveTimer();
                liveCaptureSession = {
                    onFrame: function (message) {
                        clearLiveTimer();
                        liveLatest = message.dataUrl;
                        preview.src = liveLatest;
                        preview.hidden = false;
                        placeholder.hidden = true;
                        retryBtn.hidden = true;
                        setStatus('实时画面 · 每秒刷新');
                        updateRunState();
                    },
                    onError: function (message) {
                        clearLiveTimer();
                        liveLatest = null;
                        currentFile = null;
                        preview.hidden = true;
                        preview.removeAttribute('src');
                        placeholder.hidden = false;
                        placeholder.textContent = message || '抓取失败';
                        retryBtn.hidden = false;
                        setStatus(message || '抓取失败', true);
                        updateRunState();
                    }
                };
                window.chrome.webview.postMessage({ action: 'captureLiveStart' });
                liveTimer = setTimeout(function () {
                    if (!liveLatest) {
                        stopLiveCapture();
                        placeholder.textContent =
                            '等待原神画面超时，请确认游戏已启动、未最小化，并切换为窗口化或无边框模式';
                        retryBtn.hidden = false;
                        setStatus('连接超时', true);
                        updateRunState();
                    }
                }, 20000);
            }

            function frameToFile(dataUrl) {
                return fetch(dataUrl).then(function (res) {
                    return res.blob();
                }).then(function (blob) {
                    var type = blob.type || 'image/jpeg';
                    var ext = /jpeg|jpg/.test(type) ? '.jpg' : '.png';
                    return new File([blob], 'genshin-live' + ext, { type: type });
                });
            }

            function setStatus(text, isError) {
                statusEl.textContent = text || '';
                statusEl.className = 'ocr-status' + (isError ? ' error' : '');
            }

            function renderModes() {
                $$('.ocr-mode', modesBox).forEach(function (btn) {
                    var active = btn.dataset.mode === mode;
                    btn.classList.toggle('active', active);
                    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
                });
                modeHint.textContent = OCR_MODE_HINTS[mode];
            }

            $$('.ocr-mode', modesBox).forEach(function (btn) {
                btn.addEventListener('click', function () {
                    if (btn.dataset.mode === mode) {
                        return;
                    }
                    mode = btn.dataset.mode;
                    localStorage.setItem(OCR_MODE_KEY, mode);
                    renderModes();
                    resultBox.innerHTML = '';
                    setStatus('');
                });
            });
            renderModes();

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

            startLiveCapture();
            retryBtn.addEventListener('click', startLiveCapture);

            function engineLabel(key) {
                var hit = engines.filter(function (item) {
                    return item.key === key;
                })[0];
                return hit ? hit.label : key;
            }

            function runEngine(engineKey, runMode) {
                var field = new FormData();
                field.append('file', currentFile);
                if (runMode === 'history') {
                    if (engineKey === 'browser') {
                        return browserRecognize(currentFile, setStatus).then(function (raw) {
                            return parseHistoryScreenshot(raw);
                        });
                    }
                    return apiUpload('/api/ocr/raw?engine=' + encodeURIComponent(engineKey), field)
                        .then(function (raw) {
                            return parseHistoryScreenshot(raw);
                        });
                }
                if (engineKey === 'browser') {
                    return runBrowserOcr(currentFile, setStatus);
                }
                return apiUpload('/api/ocr/wishes?engine=' + encodeURIComponent(engineKey), field);
            }

            function showResult(result, runMode) {
                if (!result) {
                    resultBox.innerHTML = ocrWarningsHtml(['没有返回识别结果']);
                    return;
                }
                setStatus('正在匹配头像…');
                var enhance = runMode === 'history' ? enhanceHistoryAvatars : enhanceOcrAvatars;
                var render = runMode === 'history' ? renderOcrHistory : renderOcrWishes;
                enhance(result, currentFile).then(function () {
                    setStatus('识别完成 · ' + engineLabel(selected));
                    render(result, resultBox, close);
                }).catch(function () {
                    render(result, resultBox, close);
                });
            }

            runBtn.addEventListener('click', function () {
                if (!liveLatest || !selected) {
                    return;
                }
                runBtn.disabled = true;
                resultBox.innerHTML = '';
                setStatus('正在读取当前画面…');
                frameToFile(liveLatest).then(function (file) {
                    currentFile = file;
                    runRecognition();
                }).catch(function (err) {
                    setStatus('画面读取失败：' + (err.message || ''), true);
                    runBtn.disabled = false;
                });
            });

            function runRecognition() {
                var runMode = mode;
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
                    runEngine(engineKey, runMode).then(function (result) {
                        setStatus('识别完成 · ' + engineLabel(engineKey));
                        runBtn.disabled = false;
                        if (engineKey !== selected) {
                            selected = engineKey;
                            localStorage.setItem(OCR_ENGINE_KEY, selected);
                            renderEngines();
                        }
                        showResult(result, runMode);
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
            }
        });
    }

    /* ---------------- 截图识别：头像 / 武器图标指纹匹配 ---------------- */

    var OCR_HASH_SIZE = 16;
    /* 汉明距离阈值与领先幅度：都满足才认为是可信匹配（256 位） */
    var OCR_MATCH_THRESHOLD = 62;
    var OCR_MATCH_MARGIN = 10;

    function loadOcrImage(file) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('图片读取失败'));
            };
            img.src = url;
        });
    }

    /** 把截图中的一块正方形区域缩成 16×16 灰度均值哈希（64 位十六进制） */
    function regionHash(img, sx, sy, side) {
        var canvas = document.createElement('canvas');
        canvas.width = OCR_HASH_SIZE;
        canvas.height = OCR_HASH_SIZE;
        var ctx = canvas.getContext('2d');
        // 取中心 72%，与指纹生成时对图标的裁切保持一致
        var inset = side * 0.14;
        var inner = Math.max(1, side - inset * 2);
        ctx.drawImage(img, sx + inset, sy + inset, inner, inner,
            0, 0, OCR_HASH_SIZE, OCR_HASH_SIZE);
        var pixels = ctx.getImageData(0, 0, OCR_HASH_SIZE, OCR_HASH_SIZE).data;
        var values = [];
        var sum = 0;
        for (var i = 0; i < pixels.length; i += 4) {
            var gray = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
            values.push(gray);
            sum += gray;
        }
        var avg = sum / values.length;
        var bits = '';
        var hex = '';
        for (var j = 0; j < values.length; j++) {
            bits += values[j] >= avg ? '1' : '0';
            if (bits.length === 4) {
                hex += parseInt(bits, 2).toString(16);
                bits = '';
            }
        }
        return hex;
    }

    function hammingHex(a, b) {
        if (!a || !b || a.length !== b.length) {
            return 999;
        }
        var distance = 0;
        for (var i = 0; i < a.length; i++) {
            var diff = parseInt(a.charAt(i), 16) ^ parseInt(b.charAt(i), 16);
            distance += (diff & 1) + ((diff >> 1) & 1) + ((diff >> 2) & 1) + ((diff >> 3) & 1);
        }
        return distance;
    }

    /** 在全部角色 / 武器指纹里找最接近的一个，并记录与第二名的差距 */
    function matchOcrItem(hex) {
        var maps = window.SG_ITEM_HASHES || {};
        var gameMaps = maps[state.game] || {};
        var best = null;
        var second = null;
        ['character', 'weapon'].forEach(function (type) {
            var entries = gameMaps[type] || {};
            Object.keys(entries).forEach(function (name) {
                var distance = hammingHex(hex, entries[name]);
                if (distance >= 999) {
                    return;
                }
                var hit = { name: name, type: type, distance: distance };
                if (!best || distance < best.distance) {
                    second = best;
                    best = hit;
                } else if (!second || distance < second.distance) {
                    second = hit;
                }
            });
        });
        if (!best) {
            return null;
        }
        best.margin = second ? second.distance - best.distance : 256;
        return best;
    }

    /** 头像通常在文字名左侧，行高不同时按多个比例 / 偏移 / 间距尝试 */
    function candidateAvatarRects(box) {
        var h = Math.max(8, Number(box.h) || 0);
        var rects = [];
        [1.6, 2.0, 2.4, 2.8].forEach(function (ratio) {
            var side = h * ratio;
            [0.05, 0.3, 0.6, 0.9].forEach(function (yOffset) {
                [0.2, 0.5, 0.9].forEach(function (gapRatio) {
                    rects.push({
                        x: (Number(box.x) || 0) - side - h * gapRatio,
                        y: (Number(box.y) || 0) - h * yOffset,
                        side: side
                    });
                });
            });
        });
        return rects;
    }

    function matchCandidateAvatar(img, item) {
        if (!item || !Number(item.w) || !Number(item.h)) {
            return null;
        }
        var best = null;
        candidateAvatarRects(item).forEach(function (rect) {
            if (rect.x < 0 || rect.y < 0 || rect.x + rect.side > img.width
                || rect.y + rect.side > img.height) {
                return;
            }
            var hit = matchOcrItem(regionHash(img, rect.x, rect.y, rect.side));
            if (hit && (!best || hit.distance < best.distance)) {
                best = hit;
            }
        });
        return best;
    }

    /** 给候选补上用头像匹配到的名称；文字名称缺失或不在名单里时才自动填入 */
    function enhanceOcrAvatars(result, file) {
        var candidates = (result && result.candidates) || [];
        var maps = window.SG_ITEM_HASHES || {};
        if (!file || !candidates.length || !maps[state.game]) {
            return Promise.resolve(result);
        }
        var lists = nameLists(state.game);
        return loadOcrImage(file).then(function (img) {
            candidates.forEach(function (item) {
                var hit = matchCandidateAvatar(img, item);
                if (!hit) {
                    return;
                }
                var current = String(item.itemName || '').trim();
                var known = lists.characters.indexOf(current) >= 0 || lists.weapons.indexOf(current) >= 0;
                var confident = hit.distance <= OCR_MATCH_THRESHOLD && hit.margin >= OCR_MATCH_MARGIN;
                item.avatarMatch = {
                    name: hit.name,
                    type: hit.type,
                    distance: hit.distance,
                    confident: confident
                };
                if (confident && !known) {
                    item.itemName = hit.name;
                    item.autoName = true;
                }
            });
            return result;
        }).catch(function () {
            return result;
        });
    }

    /* ---------------- 出金历史（第三方助手截图）：只有「N抽」与头像 ---------------- */

    /* 顶部卡池标签 → 系统卡池值；同时出现多个标签时无法判断，默认角色池 */
    var HISTORY_POOL_TABS = {
        genshin: [
            { keys: ['千星', '集录', '混池'], pool: '集录祈愿' },
            { keys: ['武器'], pool: '武器活动' },
            { keys: ['常驻'], pool: '常驻' },
            { keys: ['角色'], pool: '角色活动' }
        ],
        starrail: [
            { keys: ['联动'], pool: '联动' },
            { keys: ['光锥'], pool: '光锥活动' },
            { keys: ['常驻'], pool: '常驻' },
            { keys: ['角色'], pool: '角色活动' }
        ]
    };

    /** tesseract TSV → 单词框（跳过表头与无效行） */
    function parseOcrTsv(tsv) {
        var words = [];
        if (!tsv) {
            return words;
        }
        var rows = String(tsv).split(/\r?\n/);
        for (var i = 1; i < rows.length; i++) {
            var cols = rows[i].split('\t');
            if (cols.length < 12) {
                continue;
            }
            var text = cols.slice(11).join('\t').trim();
            var conf = Number(cols[10]);
            if (!text || (isFinite(conf) && conf < 0)) {
                continue;
            }
            var x = Number(cols[6]);
            var y = Number(cols[7]);
            var w = Number(cols[8]);
            var h = Number(cols[9]);
            if (!isFinite(x) || !isFinite(y) || !w || !h) {
                continue;
            }
            words.push({ text: text, x: x, y: y, w: w, h: h, conf: conf });
        }
        return words;
    }

    /** 按垂直重叠把单词聚成行，便于按行判断「N抽 / 已垫 / 歪」 */
    function groupOcrLines(words) {
        var lines = [];
        words.slice().sort(function (a, b) {
            return a.y - b.y || a.x - b.x;
        }).forEach(function (word) {
            var target = null;
            lines.forEach(function (line) {
                if (target) {
                    return;
                }
                var overlap = Math.min(line.bottom, word.y + word.h) - Math.max(line.top, word.y);
                if (overlap > Math.min(line.height, word.h) * 0.5) {
                    target = line;
                }
            });
            if (!target) {
                lines.push({
                    top: word.y,
                    bottom: word.y + word.h,
                    height: word.h,
                    words: [word]
                });
                return;
            }
            target.words.push(word);
            target.top = Math.min(target.top, word.y);
            target.bottom = Math.max(target.bottom, word.y + word.h);
            target.height = Math.max(target.height, word.h);
        });
        lines.forEach(function (line) {
            line.words.sort(function (a, b) {
                return a.x - b.x;
            });
            line.text = line.words.map(function (word) {
                return word.text;
            }).join(' ');
            line.x = Math.min.apply(null, line.words.map(function (word) {
                return word.x;
            }));
            line.y = line.top;
            var right = Math.max.apply(null, line.words.map(function (word) {
                return word.x + word.w;
            }));
            line.w = right - line.x;
            line.h = line.bottom - line.top;
        });
        lines.sort(function (a, b) {
            return a.y - b.y || a.x - b.x;
        });
        return lines;
    }

    /* 出金历史：数字后缀可能被 OCR 认成近形字，统一按「N抽」处理 */
    var HISTORY_COUNT_RE = /(\d{1,3})\s*[抽拙柚捕探押折东拍拓拒拖抱%]/;

    function detectHistoryPool(lines, game) {
        var tabs = HISTORY_POOL_TABS[game] || [];
        var found = [];
        lines.filter(function (line) {
            return !HISTORY_COUNT_RE.test(line.text);
        }).slice(0, 4).forEach(function (line) {
            tabs.forEach(function (tab) {
                if (found.indexOf(tab.pool) >= 0) {
                    return;
                }
                if (tab.keys.some(function (key) {
                    return line.text.indexOf(key) >= 0;
                })) {
                    found.push(tab.pool);
                }
            });
        });
        if (found.length === 1) {
            return { pool: found[0], found: found, confirmed: true };
        }
        return { pool: gameConfig().charPool, found: found, confirmed: false };
    }

    /** 解析出金历史：每行「N抽」即一次五星，跳过「已垫N抽」 */
    function parseHistoryScreenshot(raw) {
        var g = gameConfig();
        var result = {
            engine: 'history',
            rawText: (raw && raw.text) || '',
            candidates: [],
            warnings: [],
            pendingPity: null
        };
        var lines = groupOcrLines(parseOcrTsv(raw && raw.tsv));
        if (!lines.length) {
            result.warnings.push('没有读取到文字坐标（TSV），可改用其它引擎重试');
            return result;
        }

        var detected = detectHistoryPool(lines, state.game);
        if (!detected.confirmed) {
            result.warnings.push(detected.found.length > 1
                ? '顶部同时出现多个卡池标签，无法判断当前卡池，已默认「' + poolLabel(g.charPool) + '」，请逐条核对'
                : '未识别到顶部卡池标签，已默认「' + poolLabel(g.charPool) + '」，请逐条核对');
        }

        var now = nowLocal();
        var seen = {};
        lines.forEach(function (line) {
            var compact = line.text.replace(/\s+/g, '');
            var match = compact.match(HISTORY_COUNT_RE);
            if (!match) {
                return;
            }
            var count = Number(match[1]);
            if (!count || count > 200) {
                return;
            }
            if (/已垫|垫了/.test(compact)) {
                result.pendingPity = count;
                return;
            }
            var key = Math.round(line.y / Math.max(4, line.h / 2)) + ':' + count;
            if (seen[key]) {
                return;
            }
            seen[key] = true;
            result.candidates.push({
                itemName: '',
                rarity: 5,
                pool: detected.pool,
                pityCount: count,
                wishTime: now,
                x: line.x,
                y: line.y,
                w: line.w,
                h: line.h,
                lostStamp: compact.indexOf('歪') >= 0,
                avatarMatch: null
            });
        });

        if (result.candidates.length) {
            result.warnings.push('截图不含时间，已默认当前时间；「歪」按红章或文字识别，可在每条记录中修改');
        } else {
            result.warnings.push('没有识别到「N抽」文本，请确认截图属于出金历史页面且文字清晰完整');
        }
        return result;
    }

    /** 出金历史里头像与「N抽」文字等高，且紧贴在文字左侧 */
    function historyAvatarRects(box) {
        var h = Math.max(8, Number(box.h) || 0);
        var rects = [];
        [1.4, 1.7, 2.0, 2.3, 2.6].forEach(function (ratio) {
            var side = h * ratio;
            [0, 0.15, -0.15].forEach(function (yOffset) {
                [0.05, 0.2, 0.35, 0.5, 0.7].forEach(function (gapRatio) {
                    rects.push({
                        x: (Number(box.x) || 0) - side - h * gapRatio,
                        y: (Number(box.y) || 0) + h / 2 - side / 2 + h * yOffset,
                        side: side
                    });
                });
            });
        });
        return rects;
    }

    function matchHistoryAvatar(img, item) {
        var best = null;
        historyAvatarRects(item).forEach(function (rect) {
            if (rect.x < 0 || rect.y < 0 || rect.x + rect.side > img.width
                || rect.y + rect.side > img.height) {
                return;
            }
            var hit = matchOcrItem(regionHash(img, rect.x, rect.y, rect.side));
            if (hit && (!best || hit.distance < best.distance)) {
                best = hit;
            }
        });
        return best;
    }

    /** 文字右侧的深红像素块（歪印章）；金色进度条 g 通道较高，不会命中 */
    function hasRedStamp(img, item) {
        var h = Math.max(8, Number(item.h) || 0);
        var startX = Math.round((Number(item.x) || 0) + (Number(item.w) || 0) + h * 0.4);
        var startY = Math.max(0, Math.round((Number(item.y) || 0) - h * 0.15));
        var endX = img.width;
        var endY = Math.min(img.height, Math.round((Number(item.y) || 0) + h * 1.15));
        var sw = endX - startX;
        var sh = endY - startY;
        if (sw < 12 || sh < 8) {
            return false;
        }
        var canvas = document.createElement('canvas');
        canvas.width = Math.min(300, sw);
        canvas.height = Math.max(1, Math.round(canvas.width * sh / sw));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, startX, startY, sw, sh, 0, 0, canvas.width, canvas.height);
        var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        var red = 0;
        var total = 0;
        for (var i = 0; i < pixels.length; i += 4) {
            total += 1;
            if (pixels[i] >= 150 && pixels[i + 1] <= 95 && pixels[i + 2] <= 95) {
                red += 1;
            }
        }
        return red >= Math.max(30, total * 0.012);
    }

    /** 按头像 / 歪章补全名称与 UP 状态；名称已知时用常驻名单推断是否歪 */
    function enhanceHistoryAvatars(result, file) {
        var candidates = (result && result.candidates) || [];
        var maps = window.SG_ITEM_HASHES || {};
        if (!file || !candidates.length || !maps[state.game]) {
            applyHistoryIsUp(result);
            return Promise.resolve(result);
        }
        return loadOcrImage(file).then(function (img) {
            candidates.forEach(function (item) {
                var hit = matchHistoryAvatar(img, item);
                if (hit) {
                    var confident = hit.distance <= OCR_MATCH_THRESHOLD && hit.margin >= OCR_MATCH_MARGIN;
                    item.avatarMatch = {
                        name: hit.name,
                        type: hit.type,
                        distance: hit.distance,
                        confident: confident
                    };
                    if (confident) {
                        item.itemName = hit.name;
                        item.autoName = true;
                    }
                }
                if (!item.lostStamp && hasRedStamp(img, item)) {
                    item.lostStamp = true;
                }
            });
            applyHistoryIsUp(result);
            return result;
        }).catch(function () {
            applyHistoryIsUp(result);
            return result;
        });
    }

    function applyHistoryIsUp(result) {
        (result.candidates || []).forEach(function (item) {
            if (item.pool === '常驻') {
                item.isUp = null;
                return;
            }
            if (item.lostStamp) {
                item.isUp = false;
                return;
            }
            var type = inferItemType(state.game, item.itemName);
            item.isUp = item.itemName
                ? inferIsUp(state.game, item.pool, item.itemName, type, item.time) : true;
        });
    }

    function ocrIsUpSelectHtml(item) {
        var lost = item.isUp === false;
        return '<select class="input" data-w="isUp">'
            + '<option value="1"' + (lost ? '' : ' selected') + '>未歪</option>'
            + '<option value="0"' + (lost ? ' selected' : '') + '>歪了</option>'
            + '</select>';
    }

    function ocrNameSelectHtml(item) {
        var current = String(item.itemName || '');
        return '<input type="hidden" data-w="itemName" value="' + esc(current) + '"/>'
            + '<button type="button" class="input ocr-name-trigger' + (current ? '' : ' empty') + '">'
            + '<span class="ocr-name-label">' + (current ? esc(current) : '请选择角色 / 物品') + '</span>'
            + '<i>▾</i></button>';
    }

    function updateOcrNameTrigger(btn, name) {
        btn.classList.toggle('empty', !name);
        var label = $('.ocr-name-label', btn);
        if (label) {
            label.textContent = name || '请选择角色 / 物品';
        }
    }

    /** 把 OCR 结果里每行的名称按钮接到头像网格弹窗 */
    function bindOcrNamePickers(box) {
        $$('.ocr-name-trigger', box).forEach(function (btn) {
            btn.addEventListener('click', function () {
                var row = btn.closest('.ocr-wish-row');
                var input = $('[data-w=itemName]', row);
                openNamePicker(input.value, function (name) {
                    input.value = name;
                    updateOcrNameTrigger(btn, name);
                    var icon = $('.ocr-item-icon', row);
                    if (icon) {
                        icon.outerHTML = ocrItemIconHtml(name);
                    }
                });
            });
        });
    }

    function ocrItemIconHtml(name) {
        var g = gameConfig();
        var lists = nameLists(state.game);
        var avatarMap = (window.SG_AVATARS || {})[state.game] || {};
        var weaponMap = (window.SG_WEAPON_ICONS || {})[state.game] || {};
        var isCharacter = lists.characters.indexOf(name) >= 0;
        var url = isCharacter ? avatarMap[name] : weaponMap[name];
        return '<div class="ocr-item-icon"><span>' + esc((name || '?').charAt(0)) + '</span>'
            + (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" onerror="this.remove()"/>' : '')
            + '</div>';
    }

    function ocrMatchHtml(item) {
        if (!item.avatarMatch) {
            return '';
        }
        var percent = Math.max(0, Math.round((1 - item.avatarMatch.distance / 256) * 100));
        return '<div class="ocr-match' + (item.avatarMatch.confident ? '' : ' low') + '">'
            + '头像匹配：' + esc(item.avatarMatch.name) + ' · 相似 ' + percent + '%'
            + (item.autoName ? '（已自动填入）' : '')
            + (item.avatarMatch.confident ? '' : '（可信度低，仅供参照）')
            + '</div>';
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
                        + (item.pool === pool ? ' selected' : '') + '>' + esc(poolLabel(pool)) + '</option>';
                }).join('');
                return '<div class="ocr-wish-row" data-index="' + index + '">'
                    + '<input type="checkbox" class="ocr-wish-check" checked aria-label="导入该条"/>'
                    + ocrItemIconHtml(item.itemName)
                    + '<div class="ocr-wish-main">'
                    + '<div class="ocr-wish-fields">'
                    + ocrNameSelectHtml(item)
                    + '<select class="input" data-w="rarity">'
                    + '<option value="5"' + (item.rarity === 5 ? ' selected' : '') + '>五星</option>'
                    + '<option value="4"' + (item.rarity === 4 ? ' selected' : '') + '>四星</option>'
                    + '</select>'
                    + '<select class="input" data-w="pool">' + poolOptions + '</select>'
                    + '<input class="input" type="number" min="1" max="90" data-w="pityCount" value="'
                    + (item.pityCount === null || item.pityCount === undefined ? '' : item.pityCount)
                    + '" placeholder="第几抽"/>'
                    + '<input class="input" type="text" placeholder="YYYY-MM-DD HH:mm" maxlength="16"'
                    + ' data-datetime="1" data-w="wishTime" value="'
                    + esc(localTimeValue(item.wishTime)) + '"/>'
                    + '</div>'
                    + ocrMatchHtml(item)
                    + '</div>'
                    + '</div>';
            }).join('') + '</div>'
            + '<div class="ocr-foot"><button class="btn btn-primary btn-sm" id="ocr-import" type="button">'
            + '导入勾选记录</button></div>'
            + ocrRawHtml(result.rawText);

        bindOcrNamePickers(box);

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
                        throw new Error('第 ' + (Number(row.dataset.index) + 1) + ' 条未选择角色 / 物品');
                    }
                    payload.push({
                        itemName: nameInput,
                        rarity: rarity,
                        pool: pool,
                        itemType: inferItemType(state.game, nameInput)
                            || (/武器|光锥/.test(pool) ? g.itemTypes[1] : g.itemTypes[0]),
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

    function renderOcrHistory(result, box, close) {
        var g = gameConfig();
        var candidates = (result && result.candidates) || [];
        if (!candidates.length) {
            box.innerHTML = ocrWarningsHtml(result.warnings) + ocrRawHtml(result.rawText);
            return;
        }

        var head = '共识别 ' + candidates.length + ' 条五星记录';
        if (result.pendingPity) {
            head += ' · 截图显示当前已垫 ' + result.pendingPity + ' 抽';
        }
        head += '，时间默认当前，可逐条修改';

        box.innerHTML = ocrWarningsHtml(result.warnings)
            + '<div class="ocr-wish-head">' + head + '</div>'
            + '<div class="ocr-wish-list">' + candidates.map(function (item, index) {
                var poolOptions = g.pools.map(function (pool) {
                    return '<option value="' + esc(pool) + '"'
                        + (item.pool === pool ? ' selected' : '') + '>' + esc(poolLabel(pool)) + '</option>';
                }).join('');
                return '<div class="ocr-wish-row" data-index="' + index + '">'
                    + '<input type="checkbox" class="ocr-wish-check" checked aria-label="导入该条"/>'
                    + ocrItemIconHtml(item.itemName)
                    + '<div class="ocr-wish-main">'
                    + '<div class="ocr-wish-fields">'
                    + ocrNameSelectHtml(item)
                    + ocrIsUpSelectHtml(item)
                    + '<select class="input" data-w="pool">' + poolOptions + '</select>'
                    + '<input class="input" type="number" min="1" max="200" data-w="pityCount" value="'
                    + (item.pityCount === null || item.pityCount === undefined ? '' : item.pityCount)
                    + '" placeholder="第几抽"/>'
                    + '<input class="input" type="text" placeholder="YYYY-MM-DD HH:mm" maxlength="16"'
                    + ' data-datetime="1" data-w="wishTime" value="'
                    + esc(localTimeValue(item.wishTime)) + '"/>'
                    + '</div>'
                    + ocrMatchHtml(item)
                    + '</div>'
                    + '</div>';
            }).join('') + '</div>'
            + '<div class="ocr-foot"><button class="btn btn-primary btn-sm" id="ocr-import" type="button">'
            + '导入勾选记录</button></div>'
            + ocrRawHtml(result.rawText);

        bindOcrNamePickers(box);

        var importBtn = $('#ocr-import', box);
        importBtn.addEventListener('click', function () {
            guard(function () {
                var payload = [];
                $$('.ocr-wish-row', box).forEach(function (row) {
                    if (!$('.ocr-wish-check', row).checked) {
                        return;
                    }
                    var nameInput = $('[data-w=itemName]', row).value.trim();
                    var pool = $('[data-w=pool]', row).value;
                    var pityRaw = $('[data-w=pityCount]', row).value.trim();
                    var timeRaw = $('[data-w=wishTime]', row).value;
                    var isUpRaw = $('[data-w=isUp]', row).value;
                    if (!nameInput) {
                        throw new Error('第 ' + (Number(row.dataset.index) + 1) + ' 条未选择'
                            + g.itemTypes[0] + ' / ' + g.itemTypes[1]);
                    }
                    payload.push({
                        itemName: nameInput,
                        rarity: 5,
                        pool: pool,
                        itemType: inferItemType(state.game, nameInput)
                            || (/武器|光锥/.test(pool) ? g.itemTypes[1] : g.itemTypes[0]),
                        pityCount: pityRaw === '' ? null : Number(pityRaw),
                        wishTime: timeRaw ? toApiTime(timeRaw) : null,
                        isUp: pool === '常驻' ? null : isUpRaw === '1'
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

        document.addEventListener('click', function (event) {
            var target = event.target;
            var retry = target && target.closest ? target.closest('[data-retry]') : null;
            if (retry) {
                switchView(state.view);
            }
        });
    }

    function init() {
        loadCatalogCache();
        applyGameUI();
        bindAuth();
        bindShell();
        bindLauncherMessages();

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

    /* 桌面启动器桥接：供内嵌 WebView2 的启动器调用导航与游戏切换 */
    window.SG_LAUNCHER = {
        nav: function (view) {
            if (!$('#app-view') || $('#app-view').hidden) {
                return false;
            }
            switchView(view);
            return true;
        },
        setGame: function (game) {
            setGame(game);
            return state.game;
        },
        current: function () {
            return {
                game: state.game,
                view: state.view,
                loggedIn: !!state.token && !!state.user
            };
        }
    };

    document.addEventListener('DOMContentLoaded', init);
})();

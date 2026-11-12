# -*- coding: utf-8 -*-
"""半自动资源识别脚本（方案 B）。

只截屏识别，不读游戏内存、不模拟键鼠、不修改游戏数据。
识别项：原石、摩拉、纠缠之缘、相遇之缘、创世结晶、三本角色经验书。

用法：
    python scan.py --calibrate      # 首次校准：选择/新建页面，框选该页面的数字区域
    python scan.py                  # 选择页面后识别，结果写剪贴板
    python scan.py --page 背包       # 直接使用名称包含「背包」的页面
    python scan.py --list-pages     # 查看已校准的页面
    python scan.py --once           # 识别一次后退出（不进入交互循环）
    python scan.py --image a.png    # 用本地截图调试，不截屏
    python scan.py --dry-run        # 只打印结果，不写剪贴板
    python scan.py --push --token xxx   # 额外 PUT 到本地服务 /api/resources
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
TEMPLATE_DIR = BASE_DIR / "templates"

FIELDS = [
    ("primogems", "原石"),
    ("mora", "摩拉"),
    ("intertwinedFates", "纠缠之缘"),
    ("acquaintedFates", "相遇之缘"),
    ("genesisCrystals", "创世结晶"),
    ("heroWit", "大英雄的经验"),
    ("adventurerExp", "冒险家的经验"),
    ("wandererAdvice", "流浪者的经验"),
]
FIELD_LABELS = dict(FIELDS)

TEMPLATE_SIZE = (20, 28)


# ---------------------------------------------------------------- 配置


def load_config():
    if not CONFIG_PATH.exists():
        config = {"window_title": "", "pages": [], "last_page": ""}
        return config
    try:
        with CONFIG_PATH.open("r", encoding="utf-8") as fp:
            data = json.load(fp)
    except (OSError, ValueError) as exc:
        print("读取配置失败：%s" % exc)
        return {"window_title": "", "pages": [], "last_page": ""}
    if not isinstance(data, dict):
        data = {}

    pages = data.get("pages")
    if not isinstance(pages, list) or not pages:
        # 兼容旧版单页面配置：{"regions": {...}}
        legacy = data.get("regions")
        if isinstance(legacy, dict) and legacy:
            pages = [{"id": "default", "name": "默认页面", "regions": legacy}]
        else:
            pages = []

    normalized = []
    for index, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        page_id = str(page.get("id") or ("page-%d" % (index + 1)))
        name = str(page.get("name") or page_id)
        regions = page.get("regions")
        normalized.append({
            "id": page_id,
            "name": name,
            "regions": regions if isinstance(regions, dict) else {},
        })

    last_page = data.get("last_page")
    if not isinstance(last_page, str):
        last_page = ""
    return {
        "window_title": str(data.get("window_title") or ""),
        "pages": normalized,
        "last_page": last_page,
    }


def save_config(config):
    pages = []
    for page in config.get("pages") or []:
        pages.append({
            "id": str(page.get("id") or ""),
            "name": str(page.get("name") or ""),
            "regions": page.get("regions") or {},
        })
    data = {
        "window_title": str(config.get("window_title") or ""),
        "pages": pages,
        "last_page": str(config.get("last_page") or ""),
    }
    with CONFIG_PATH.open("w", encoding="utf-8") as fp:
        json.dump(data, fp, ensure_ascii=False, indent=2)


def get_pages(config):
    return config.get("pages") or []


def find_page(config, query):
    """按 id / 名称精确或包含匹配页面。"""
    if not query:
        return None
    target = str(query).strip().lower()
    pages = get_pages(config)
    for page in pages:
        if target in (str(page.get("id") or "").lower(), str(page.get("name") or "").lower()):
            return page
    for page in pages:
        name = str(page.get("name") or "").lower()
        page_id = str(page.get("id") or "").lower()
        if target in name or target in page_id:
            return page
    return None


def default_page(config):
    page = find_page(config, config.get("last_page") or "")
    if page is not None:
        return page
    pages = get_pages(config)
    return pages[0] if pages else None


def create_page(config, name):
    pages = config.setdefault("pages", [])
    existing = set(str(page.get("id") or "") for page in pages)
    number = len(pages) + 1
    page_id = "page-%d" % number
    while page_id in existing:
        number += 1
        page_id = "page-%d" % number
    page = {"id": page_id, "name": (name or "").strip() or "未命名页面", "regions": {}}
    pages.append(page)
    return page


def choose_page(config, requested="", allow_create=False, interactive=True):
    """选择识别页面；requested 可以为 id、名称或名称片段。"""
    page = find_page(config, requested)
    if page is not None:
        return page
    pages = get_pages(config)
    if not pages:
        if allow_create and interactive:
            name = input("还没有页面配置，请输入新页面名称（如 背包-贵重道具）：").strip()
            return create_page(config, name or "默认页面")
        return None
    if not requested and not interactive:
        return default_page(config)
    if not interactive:
        page = default_page(config)
        if page is not None and requested:
            print("没有找到页面「%s」，改用「%s」。" % (requested, page.get("name")))
        return page
    if len(pages) == 1 and not allow_create:
        return pages[0]

    print("\n可用页面：")
    for index, item in enumerate(pages, 1):
        print("  %d. %s（已校准 %d 项）"
              % (index, item.get("name") or item.get("id"), len(item.get("regions") or {})))
    if allow_create:
        print("  0. 新建页面")
    fallback = default_page(config)
    fallback_index = pages.index(fallback) + 1 if fallback in pages else 1
    while True:
        raw = input("选择页面编号（回车=%d）：" % fallback_index).strip()
        if raw == "":
            return pages[fallback_index - 1]
        if allow_create and raw == "0":
            name = input("新页面名称（如 背包-养成道具）：").strip()
            return create_page(config, name or "新页面")
        if raw.isdigit() and 1 <= int(raw) <= len(pages):
            return pages[int(raw) - 1]
        page = find_page(config, raw)
        if page is not None:
            return page
        print("请输入列表中的编号。")


def choose_page_for_calibration(config):
    pages = get_pages(config)
    if not pages:
        name = input("还没有页面配置，请输入新页面名称（如 背包-贵重道具）：").strip()
        return create_page(config, name or "默认页面")
    if len(pages) == 1:
        print("当前页面：%s" % (pages[0].get("name") or pages[0].get("id")))
        raw = input("回车 = 重新校准该页面，0 = 新建页面：").strip()
        if raw == "0":
            name = input("新页面名称：").strip()
            return create_page(config, name or "新页面")
        return pages[0]

    print("\n已有页面：")
    for index, item in enumerate(pages, 1):
        print("  %d. %s（已校准 %d 项）"
              % (index, item.get("name") or item.get("id"), len(item.get("regions") or {})))
    print("  0. 新建页面")
    while True:
        raw = input("选择要校准的页面编号：").strip()
        if raw == "0":
            name = input("新页面名称：").strip()
            return create_page(config, name or "新页面")
        if raw.isdigit() and 1 <= int(raw) <= len(pages):
            return pages[int(raw) - 1]
        page = find_page(config, raw)
        if page is not None:
            return page
        print("请输入列表中的编号。")


# ---------------------------------------------------------------- 截屏


def capture_game_image(window_title=""):
    """截取游戏窗口；找不到窗口或依赖缺失时退回全屏。"""
    from PIL import Image

    box = None
    if window_title:
        try:
            import pygetwindow as gw

            windows = [w for w in gw.getWindowsWithTitle(window_title) if w.visible]
            if windows:
                win = windows[0]
                width = max(1, win.width)
                height = max(1, win.height)
                box = {
                    "left": win.left,
                    "top": win.top,
                    "width": width,
                    "height": height,
                }
            else:
                print("没有找到标题包含「%s」的窗口，改用全屏截图。" % window_title)
        except ImportError:
            print("未安装 pygetwindow，改用全屏截图（可 pip install pygetwindow）。")

    import mss

    with mss.mss() as sct:
        monitor = box or sct.monitors[1]
        shot = sct.grab(monitor)
        return Image.frombytes("RGB", shot.size, shot.rgb)


def region_to_box(region, image):
    width, height = image.size
    left = int(round(region["x"] * width))
    top = int(round(region["y"] * height))
    right = int(round((region["x"] + region["w"]) * width))
    bottom = int(round((region["y"] + region["h"]) * height))
    left = max(0, min(width - 1, left))
    top = max(0, min(height - 1, top))
    right = max(left + 1, min(width, right))
    bottom = max(top + 1, min(height, bottom))
    return left, top, right, bottom


def crop_region(image, region):
    return image.crop(region_to_box(region, image))


# ---------------------------------------------------------------- 引擎 1：Tesseract


def _configure_tesseract(pytesseract):
    """定位 Tesseract：优先环境变量，其次程序自带的 tesseract 目录。"""
    import os
    import shutil
    candidates = []
    env_cmd = os.environ.get("SA_TESSERACT_CMD")
    if env_cmd:
        candidates.append(env_cmd)
    candidates.append(str(BASE_DIR.parent.parent / "tesseract" / "tesseract.exe"))
    found = shutil.which("tesseract")
    if found:
        candidates.append(found)
    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            pytesseract.pytesseract.tesseract_cmd = candidate
            break
    tessdata = BASE_DIR.parent.parent / "tesseract" / "tessdata"
    if not os.environ.get("TESSDATA_PREFIX") and tessdata.is_dir():
        os.environ["TESSDATA_PREFIX"] = str(tessdata)


def recognize_tesseract(image):
    """返回 (数值或 None, 说明)。"""
    try:
        import pytesseract
    except ImportError:
        return None, "未安装 pytesseract"
    _configure_tesseract(pytesseract)
    try:
        text = pytesseract.image_to_string(
            image,
            lang="eng",
            config="--psm 7 -c tessedit_char_whitelist=0123456789",
        )
    except Exception as exc:  # 包括 Tesseract 未安装
        return None, str(exc).strip().splitlines()[0] if str(exc).strip() else "Tesseract 调用失败"
    digits = re.sub(r"\D", "", text or "")
    if not digits:
        return None, "未识别到数字"
    return int(digits), ""


# ---------------------------------------------------------------- 引擎 2：数字模板


def _import_numpy():
    try:
        import numpy as np
    except ImportError:
        return None
    return np


def _otsu_threshold(array):
    np = _import_numpy()
    values = array.astype("uint8")
    hist = np.bincount(values.ravel(), minlength=256).astype("float64")
    total = values.size
    sum_all = np.dot(np.arange(256), hist)
    sum_back = 0.0
    weight_back = 0.0
    best_var = -1.0
    threshold = 127
    for index in range(256):
        weight_back += hist[index]
        if weight_back == 0:
            continue
        weight_forward = total - weight_back
        if weight_forward == 0:
            break
        sum_back += index * hist[index]
        mean_back = sum_back / weight_back
        mean_forward = (sum_all - sum_back) / weight_forward
        variance = weight_back * weight_forward * (mean_back - mean_forward) ** 2
        if variance > best_var:
            best_var = variance
            threshold = index
    return threshold


def binarize(gray):
    """白字黑底或黑字白底都兼容，返回数字为 True 的布尔矩阵。"""
    np = _import_numpy()
    if np is None:
        return None
    array = np.asarray(gray, dtype="uint8")
    if array.ndim != 2 or array.size == 0:
        return None
    threshold = _otsu_threshold(array)
    border = np.concatenate([array[0, :], array[-1, :], array[:, 0], array[:, -1]])
    background = float(np.median(border))
    if background <= threshold:
        return array > threshold
    return array < threshold


def connected_components(mask):
    """返回 [(left, top, right, bottom, 像素数)]，right/bottom 为开区间。"""
    np = _import_numpy()
    if np is None or mask is None:
        return []
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    result = []
    for y in range(height):
        for x in range(width):
            if not mask[y, x] or visited[y, x]:
                continue
            stack = [(y, x)]
            visited[y, x] = True
            min_x = max_x = x
            min_y = max_y = y
            count = 0
            while stack:
                current_y, current_x = stack.pop()
                count += 1
                if current_x < min_x:
                    min_x = current_x
                if current_x > max_x:
                    max_x = current_x
                if current_y < min_y:
                    min_y = current_y
                if current_y > max_y:
                    max_y = current_y
                for next_y, next_x in (
                    (current_y + 1, current_x),
                    (current_y - 1, current_x),
                    (current_y, current_x + 1),
                    (current_y, current_x - 1),
                ):
                    if 0 <= next_y < height and 0 <= next_x < width:
                        if mask[next_y, next_x] and not visited[next_y, next_x]:
                            visited[next_y, next_x] = True
                            stack.append((next_y, next_x))
            result.append((min_x, min_y, max_x + 1, max_y + 1, count))
    return result


def digit_boxes(mask):
    """过滤噪声块并按 x 排序，返回数字块的外接框。"""
    if mask is None:
        return []
    height, width = mask.shape
    boxes = []
    for left, top, right, bottom, count in connected_components(mask):
        box_height = bottom - top
        box_width = right - left
        if box_height < height * 0.30 or count < 8:
            continue
        if box_width > width * 0.75:
            continue
        boxes.append((left, top, right, bottom))
    boxes.sort(key=lambda item: item[0])
    return boxes


def normalize_digit(mask, box):
    """把单个数字块缩放到统一尺寸，返回 0~1 浮点矩阵（1 表示笔画）。"""
    np = _import_numpy()
    from PIL import Image

    if np is None:
        return None
    left, top, right, bottom = box
    crop = mask[top:bottom, left:right]
    if crop.size == 0:
        return None
    image = Image.fromarray((crop.astype("uint8") * 255), mode="L")
    image = image.resize(TEMPLATE_SIZE, Image.BILINEAR)
    return np.asarray(image, dtype="float32") / 255.0


def load_templates(page_id=None):
    np = _import_numpy()
    from PIL import Image

    if np is None:
        return {}

    def read_dir(directory, target):
        if not directory.exists():
            return
        for digit in range(10):
            key = str(digit)
            if key in target:
                continue
            path = directory / ("%d.png" % digit)
            if not path.exists():
                continue
            image = Image.open(path).convert("L").resize(TEMPLATE_SIZE)
            target[key] = np.asarray(image, dtype="float32") / 255.0

    templates = {}
    if page_id:
        read_dir(TEMPLATE_DIR / str(page_id), templates)
    # 页面模板缺失的数字，回退到全局模板
    read_dir(TEMPLATE_DIR, templates)
    return templates


def recognize_templates(image, templates=None):
    """返回 (数值或 None, 说明)。"""
    np = _import_numpy()
    if np is None:
        return None, "未安装 numpy"
    if templates is None:
        templates = load_templates()
    if not templates:
        return None, "缺少数字模板，请先校准"

    gray = image.convert("L")
    mask = binarize(gray)
    boxes = digit_boxes(mask)
    if not boxes:
        return None, "未找到数字"

    digits = []
    scores = []
    for box in boxes:
        sample = normalize_digit(mask, box)
        if sample is None:
            continue
        best_digit = None
        best_score = None
        for digit, template in templates.items():
            score = float(np.mean((sample - template) ** 2))
            if best_score is None or score < best_score:
                best_score = score
                best_digit = digit
        if best_digit is not None:
            digits.append(best_digit)
            scores.append(best_score)
    if not digits:
        return None, "模板匹配失败"
    average = sum(scores) / len(scores)
    note = "模板误差 %.3f" % average
    return int("".join(digits)), note


# ---------------------------------------------------------------- 模板生成


def build_templates_from_calibration(image, regions, values, page_id=None):
    """用校准区域的真实数值切分数字，生成 0~9 模板；有 page_id 时按页面保存。"""
    np = _import_numpy()
    from PIL import Image

    if np is None:
        print("未安装 numpy，跳过模板生成。")
        return 0
    output_dir = TEMPLATE_DIR / str(page_id) if page_id else TEMPLATE_DIR
    output_dir.mkdir(parents=True, exist_ok=True)

    samples = {}
    for key, label in FIELDS:
        region = regions.get(key)
        value = values.get(key)
        if not region or value is None:
            continue
        digits = re.sub(r"\D", "", str(value))
        if not digits:
            continue
        crop = crop_region(image, region)
        mask = binarize(crop.convert("L"))
        boxes = digit_boxes(mask)
        if len(boxes) != len(digits):
            print("  跳过 %s：切出 %d 个数字块，真实值有 %d 位。" % (label, len(boxes), len(digits)))
            continue
        for box, digit in zip(boxes, digits):
            sample = normalize_digit(mask, box)
            if sample is None:
                continue
            samples.setdefault(digit, []).append(sample)

    count = 0
    for digit, items in samples.items():
        average = np.mean(np.stack(items, axis=0), axis=0)
        image_out = Image.fromarray((average * 255).astype("uint8"), mode="L")
        image_out.save(output_dir / ("%s.png" % digit))
        count += 1
    return count


# ---------------------------------------------------------------- 识别流程


def scan_image(image, page):
    regions = (page or {}).get("regions") or {}
    templates = load_templates((page or {}).get("id"))
    results = []
    for key, label in FIELDS:
        region = regions.get(key)
        if not region:
            results.append({"key": key, "label": label, "tesseract": None,
                            "template": None, "value": None, "status": "未校准"})
            continue
        crop = crop_region(image, region)
        tesseract_value, tesseract_note = recognize_tesseract(crop)
        template_value, template_note = recognize_templates(crop, templates)
        if tesseract_value is not None and tesseract_value == template_value:
            value = tesseract_value
            status = "一致"
        elif tesseract_value is not None and template_value is not None:
            value = tesseract_value
            status = "需确认"
        elif tesseract_value is not None:
            value = tesseract_value
            status = "仅 OCR"
        elif template_value is not None:
            value = template_value
            status = "仅模板"
        else:
            value = None
            status = "缺失"
        results.append({
            "key": key,
            "label": label,
            "tesseract": tesseract_value,
            "template": template_value,
            "value": value,
            "status": status,
            "note": tesseract_note or template_note,
        })
    return results


def print_results(results):
    header = "%-14s %-12s %-12s %-12s %s" % ("资源", "Tesseract", "模板匹配", "最终值", "状态")
    print(header)
    print("-" * 68)
    for item in results:
        print("%-14s %-12s %-12s %-12s %s" % (
            item["label"],
            "-" if item["tesseract"] is None else item["tesseract"],
            "-" if item["template"] is None else item["template"],
            "-" if item["value"] is None else item["value"],
            item["status"],
        ))


def result_text(results):
    parts = []
    for item in results:
        if item["value"] is not None:
            parts.append("%s=%s" % (item["label"], item["value"]))
    return " ".join(parts)


def copy_to_clipboard(text):
    try:
        import tkinter as tk

        root = tk.Tk()
        root.withdraw()
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update()
        root.destroy()
        return True
    except Exception:
        return False


def push_resource(results, base_url, token):
    payload = {}
    for item in results:
        if item["value"] is not None:
            payload[item["key"]] = int(item["value"])
    if not payload:
        print("没有可回填的数值。")
        return False
    url = base_url.rstrip("/") + "/api/resources"
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json;charset=UTF-8"}
    if token:
        headers["Authorization"] = "Bearer " + token
    request = urllib.request.Request(url, data=data, headers=headers, method="PUT")
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            print("回填成功：HTTP %s" % response.status)
            return True
    except urllib.error.HTTPError as exc:
        print("回填失败：HTTP %s %s" % (exc.code, exc.reason))
    except urllib.error.URLError as exc:
        print("回填失败：%s" % exc.reason)
    return False


# ---------------------------------------------------------------- 入口


def main():
    parser = argparse.ArgumentParser(description="半自动识别原神资源（只截屏，不操作游戏）")
    parser.add_argument("--calibrate", action="store_true", help="进入校准：选择/新建页面并框选数字区域")
    parser.add_argument("--page", default="", help="页面 id、名称或名称片段")
    parser.add_argument("--list-pages", action="store_true", help="列出已校准的页面")
    parser.add_argument("--image", help="使用本地截图，不截屏")
    parser.add_argument("--once", action="store_true", help="识别一次后退出")
    parser.add_argument("--dry-run", action="store_true", help="只打印，不写剪贴板")
    parser.add_argument("--push", action="store_true", help="额外回填本地服务 /api/resources")
    parser.add_argument("--url", default="http://localhost:8080", help="本地服务地址")
    parser.add_argument("--token", default="", help="登录 token（开启回填时使用）")
    parser.add_argument("--window-title", default="", help="游戏窗口标题，留空则用配置或全屏")
    args = parser.parse_args()

    config = load_config()
    if args.window_title:
        config["window_title"] = args.window_title

    if args.list_pages:
        pages = get_pages(config)
        if not pages:
            print("还没有页面配置，请先运行：python scan.py --calibrate")
            return 0
        print("已校准页面：")
        for page in pages:
            print("  %s\t%s\t%d 项" % (
                page.get("id"),
                page.get("name"),
                len(page.get("regions") or {}),
            ))
        return 0

    if args.image:
        from PIL import Image

        image = Image.open(args.image)
    else:
        title = config.get("window_title") or ""
        image = capture_game_image(title)

    page = None
    if args.calibrate:
        page = find_page(config, args.page)
        if page is None:
            page = create_page(config, args.page) if args.page else choose_page_for_calibration(config)
        import calibrate

        page_id = calibrate.run(image, config, page)
        config = load_config()
        page = find_page(config, page_id) or find_page(config, config.get("last_page") or "")
        if page is None:
            print("校准没有保存成功，未找到可用页面。")
            return 1
        config["last_page"] = page["id"]
        save_config(config)
        if args.once or args.image:
            return 0
    else:
        page = choose_page(config, args.page, allow_create=False,
                           interactive=not (args.once or args.image))
        if page is None or not (page.get("regions") or {}):
            if args.once or args.image:
                print("还没有校准任何页面。请先运行：python scan.py --calibrate")
                return 1
            print("首次使用识图，先进入校准流程。")
            if page is None:
                page = choose_page_for_calibration(config)
            import calibrate

            page_id = calibrate.run(image, config, page)
            config = load_config()
            page = find_page(config, page_id) or find_page(config, config.get("last_page") or "")
            if page is None:
                print("校准没有保存成功，未找到可用页面。")
                return 1
        config["last_page"] = page["id"]
        save_config(config)

    while True:
        if not args.image:
            title = config.get("window_title") or ""
            image = capture_game_image(title)
        print("\n当前页面：%s" % (page.get("name") or page.get("id")))
        results = scan_image(image, page)
        print()
        print_results(results)
        text = result_text(results)
        if text:
            print("\n结果：" + text)
            if not args.dry_run:
                print("已复制到剪贴板。" if copy_to_clipboard(text) else "剪贴板写入失败，请手动复制。")
            if args.push:
                push_resource(results, args.url, args.token)
        else:
            print("\n没有识别到任何资源，请检查当前页面是否正确或重新校准。")

        if args.once or args.image:
            break
        try:
            command = input(
                "\n回车 = 再识别一次，p = 切换页面，c = 重新校准当前页面，q = 退出："
            ).strip().lower()
        except (EOFError, KeyboardInterrupt):
            break
        if command == "q":
            break
        if command == "p":
            page = choose_page(config, "", allow_create=False, interactive=True)
            if page is not None:
                config["last_page"] = page["id"]
                save_config(config)
        if command == "c":
            import calibrate

            calibrate.run(image, config, page)
            config = load_config()
            page = find_page(config, config.get("last_page") or "") or page
    return 0


if __name__ == "__main__":
    sys.exit(main())

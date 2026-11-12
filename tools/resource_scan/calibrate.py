# -*- coding: utf-8 -*-
"""按页面校准界面：框选当前页面可见的资源数字区域，并录入真实数值。"""

import re
import tkinter as tk
from tkinter import messagebox, simpledialog

from PIL import Image, ImageTk

import scan


def run(image, config, page):
    app = Calibrator(image, config, page)
    app.start()
    return page.get("id")


class Calibrator(object):
    def __init__(self, image, config, page):
        self.image = image
        self.config = config
        self.page = page
        self.regions = dict(page.get("regions") or {})
        self.values = {}
        self.index = 0
        self.start_point = None
        self.rect = None
        self.finished = False

        self.root = tk.Tk()
        self.root.title("资源识别校准 - %s" % (page.get("name") or page.get("id")))
        self.root.configure(bg="#111111")

        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        max_width = screen_width - 40
        max_height = screen_height - 140
        self.scale = min(1.0, float(max_width) / image.width, float(max_height) / image.height)
        display_width = max(1, int(image.width * self.scale))
        display_height = max(1, int(image.height * self.scale))
        self.display_image = image.resize((display_width, display_height), Image.LANCZOS)
        self.photo = ImageTk.PhotoImage(self.display_image)

        self.hint = tk.Label(
            self.root,
            text="",
            bg="#111111",
            fg="#f0d9a7",
            font=("Microsoft YaHei", 12),
        )
        self.hint.pack(pady=8)

        self.canvas = tk.Canvas(
            self.root,
            width=display_width,
            height=display_height,
            highlightthickness=0,
            cursor="crosshair",
        )
        self.canvas.pack()
        self.canvas.create_image(0, 0, anchor="nw", image=self.photo)
        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.canvas.bind("<ButtonPress-3>", self.on_skip)
        self.root.bind("<Escape>", self.on_skip)

    def start(self):
        self.update_hint()
        self.root.mainloop()

    def update_hint(self):
        if self.index >= len(scan.FIELDS):
            self.hint.config(text="全部区域已处理，正在生成模板…")
            return
        key, label = scan.FIELDS[self.index]
        self.hint.config(
            text="[%s] 请框选第 %d/%d 项：%s（左键拖拽，右键跳过；本页没有的资源直接跳过）"
            % (self.page.get("name") or self.page.get("id"),
               self.index + 1, len(scan.FIELDS), label)
        )

    def on_press(self, event):
        if self.index >= len(scan.FIELDS):
            return
        self.start_point = (event.x, event.y)

    def on_drag(self, event):
        if self.start_point is None:
            return
        if self.rect is not None:
            self.canvas.delete(self.rect)
        x1, y1 = self.start_point
        self.rect = self.canvas.create_rectangle(
            x1, y1, event.x, event.y, outline="#7ce0a6", width=2
        )

    def on_release(self, event):
        if self.start_point is None:
            return
        x1, y1 = self.start_point
        x2, y2 = event.x, event.y
        self.start_point = None
        left, right = min(x1, x2), max(x1, x2)
        top, bottom = min(y1, y2), max(y1, y2)
        if right - left < 8 or bottom - top < 8:
            if self.rect is not None:
                self.canvas.delete(self.rect)
                self.rect = None
            return

        key, label = scan.FIELDS[self.index]
        answer = simpledialog.askstring(
            "录入真实值",
            "请输入「%s」当前显示的真实数值（只填数字）：" % label,
            parent=self.root,
        )
        if answer is None:
            if self.rect is not None:
                self.canvas.delete(self.rect)
                self.rect = None
            return
        digits = re.sub(r"\D", "", answer)
        if not digits:
            messagebox.showwarning("数值无效", "没有读到数字，请重新框选。", parent=self.root)
            if self.rect is not None:
                self.canvas.delete(self.rect)
                self.rect = None
            return

        width = float(self.display_image.width)
        height = float(self.display_image.height)
        self.regions[key] = {
            "x": round(left / width, 6),
            "y": round(top / height, 6),
            "w": round((right - left) / width, 6),
            "h": round((bottom - top) / height, 6),
        }
        self.values[key] = int(digits)
        self.canvas.itemconfig(self.rect, outline="#f0d9a7")
        self.rect = None
        self.index += 1
        self.update_hint()

        if self.index >= len(scan.FIELDS):
            self.root.after(200, self.finish)

    def on_skip(self, _event=None):
        if self.index >= len(scan.FIELDS):
            return
        key, label = scan.FIELDS[self.index]
        print("跳过：%s%s" % (label, "（保留原区域）" if key in self.regions else ""))
        if self.rect is not None:
            self.canvas.delete(self.rect)
            self.rect = None
        self.index += 1
        self.update_hint()
        if self.index >= len(scan.FIELDS):
            self.root.after(200, self.finish)

    def finish(self):
        if self.finished:
            return
        self.finished = True
        self.page["regions"] = self.regions
        pages = self.config.setdefault("pages", [])
        replaced = False
        for index, item in enumerate(pages):
            if item.get("id") == self.page.get("id"):
                pages[index] = self.page
                replaced = True
                break
        if not replaced:
            pages.append(self.page)
        self.config["last_page"] = self.page.get("id")
        scan.save_config(self.config)
        print("页面「%s」已保存 %d 个区域到 %s"
              % (self.page.get("name"), len(self.regions), scan.CONFIG_PATH))

        print("正在生成数字模板…")
        count = scan.build_templates_from_calibration(
            self.image, self.regions, self.values, self.page.get("id")
        )
        if count:
            print("已生成 %d 个数字模板（0-9 中可用部分）。" % count)
        else:
            print("模板生成失败：框选区域内数字块数量与真实位数不一致，可重新校准，或只使用 Tesseract。")
        self.root.destroy()

        if not self.regions:
            return
        missing = [label for key, label in scan.FIELDS if key not in self.regions]
        if missing:
            print("以下资源未校准，识别时会显示「未校准」：%s" % "、".join(missing))

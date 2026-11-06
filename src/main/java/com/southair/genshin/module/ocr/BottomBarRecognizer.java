package com.southair.genshin.module.ocr;

import org.springframework.stereotype.Component;

import java.awt.image.BufferedImage;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 背包底栏资源识别：先按颜色在底部条带里找到「原石」「摩拉」图标，再读图标右侧的数字。
 *
 * <p>整页 OCR 经常只读到底栏的数字而读不到图标，或把两个数字串在一起；
 * 按图标定位后能确定数字归属（原石在左、摩拉在右），也不受底栏上方其它数字干扰。</p>
 *
 * <p>图标定位不依赖模板图：原石是蓝白四角星（高饱和蓝色），摩拉是金色圆形硬币（高饱和黄色），
 * 在这条底栏里这两种颜色只出现在对应图标上。</p>
 */
@Component
public class BottomBarRecognizer {

    /** 底栏大致区域：贴底的整条（原石 / 摩拉在左下角，实测不在右下角），避开上方背包格子 */
    private static final double ROI_LEFT = 0.002;
    private static final double ROI_RIGHT = 0.998;
    private static final double ROI_TOP = 0.885;
    private static final double ROI_BOTTOM = 0.998;

    /** 图标边长的合理范围（相对截图宽度） */
    private static final double MIN_ICON_RATIO = 0.010;
    private static final double MAX_ICON_RATIO = 0.040;
    private static final int MIN_ICON_SIDE = 10;

    /** 颜色连通块至少占外接矩形的比例，用于排除细小的装饰线 */
    private static final double MIN_FILL = 0.12;
    private static final int MIN_PIXELS = 30;

    /** 摩拉金币：金色，饱和度与亮度都要够高 */
    private static final float GOLD_HUE_MIN = 0.055f;
    private static final float GOLD_HUE_MAX = 0.175f;
    private static final float GOLD_SAT = 0.32f;
    private static final int GOLD_LUM = 60;

    /** 原石：蓝白四角星，偏冷的蓝色 */
    private static final float BLUE_HUE_MIN = 0.45f;
    private static final float BLUE_HUE_MAX = 0.70f;
    private static final float BLUE_SAT = 0.25f;
    private static final int BLUE_LUM = 55;

    /** 数字是白色，底栏是深色半透明底，按亮度二值化即可分开 */
    private static final int TEXT_LUM = 150;

    public static final String PRIMOGEMS = "primogems";
    public static final String MORA = "mora";

    /**
     * 识别底栏的两个资源数值。
     *
     * @return 只包含识别成功的字段（primogems / mora）；都找不到时返回空 Map
     */
    public Map<String, Long> recognize(BufferedImage image) {
        Map<String, Long> values = new LinkedHashMap<>();
        if (image == null) {
            return values;
        }
        int width = image.getWidth();
        int height = image.getHeight();
        int x0 = (int) Math.round(width * ROI_LEFT);
        int x1 = (int) Math.round(width * ROI_RIGHT);
        int y0 = (int) Math.round(height * ROI_TOP);
        int y1 = (int) Math.round(height * ROI_BOTTOM);
        if (x1 - x0 < 40 || y1 - y0 < 16) {
            return values;
        }

        Box primogems = findIcon(image, x0, y0, x1, y1, width, true);
        Box mora = findIcon(image, x0, y0, x1, y1, width, false);
        if (primogems == null && mora == null) {
            return values;
        }

        if (primogems != null) {
            Long value = readRightNumber(image, primogems, mora);
            if (value != null) {
                values.put(PRIMOGEMS, value);
            }
        }
        if (mora != null) {
            Long value = readRightNumber(image, mora, null);
            if (value != null) {
                values.put(MORA, value);
            }
        }
        return values;
    }

    /**
     * 在底栏区域里找指定颜色的图标。
     *
     * @param blue true 找原石（蓝色），false 找摩拉（金色）
     */
    private Box findIcon(BufferedImage image, int x0, int y0, int x1, int y1, int imageWidth, boolean blue) {
        int rw = x1 - x0;
        int rh = y1 - y0;
        boolean[] mask = new boolean[rw * rh];
        for (int y = 0; y < rh; y++) {
            for (int x = 0; x < rw; x++) {
                mask[y * rw + x] = blue
                        ? isBlue(image.getRGB(x0 + x, y0 + y))
                        : isGold(image.getRGB(x0 + x, y0 + y));
            }
        }

        int minSide = Math.max(MIN_ICON_SIDE, (int) Math.round(imageWidth * MIN_ICON_RATIO));
        int maxSide = Math.max(minSide + 1, (int) Math.round(imageWidth * MAX_ICON_RATIO));

        Box best = null;
        boolean[] visited = new boolean[mask.length];
        int[] stack = new int[mask.length];
        for (int start = 0; start < mask.length; start++) {
            if (!mask[start] || visited[start]) {
                continue;
            }
            Box box = floodFill(mask, visited, stack, start, rw, rh);
            if (box == null) {
                continue;
            }
            int w = box.right - box.left;
            int h = box.bottom - box.top;
            int side = Math.max(w, h);
            double fill = box.count / (double) Math.max(1, w * h);
            if (side < minSide || side > maxSide || Math.min(w, h) < side * 0.5
                    || box.count < MIN_PIXELS || fill < MIN_FILL) {
                continue;
            }
            if (best == null || box.count > best.count) {
                best = box;
            }
        }
        if (best != null) {
            best.left += x0;
            best.top += y0;
            best.right += x0;
            best.bottom += y0;
        }
        return best;
    }

    /** 四邻域泛洪，返回该连通块的外接矩形与像素数 */
    private Box floodFill(boolean[] mask, boolean[] visited, int[] stack, int start, int rw, int rh) {
        int size = 0;
        stack[size++] = start;
        visited[start] = true;
        Box box = new Box();
        box.left = Integer.MAX_VALUE;
        box.top = Integer.MAX_VALUE;
        while (size > 0) {
            int idx = stack[--size];
            int x = idx % rw;
            int y = idx / rw;
            box.left = Math.min(box.left, x);
            box.right = Math.max(box.right, x + 1);
            box.top = Math.min(box.top, y);
            box.bottom = Math.max(box.bottom, y + 1);
            box.count++;
            if (x > 0 && mask[idx - 1] && !visited[idx - 1]) {
                visited[idx - 1] = true;
                stack[size++] = idx - 1;
            }
            if (x + 1 < rw && mask[idx + 1] && !visited[idx + 1]) {
                visited[idx + 1] = true;
                stack[size++] = idx + 1;
            }
            if (y > 0 && mask[idx - rw] && !visited[idx - rw]) {
                visited[idx - rw] = true;
                stack[size++] = idx - rw;
            }
            if (y + 1 < rh && mask[idx + rw] && !visited[idx + rw]) {
                visited[idx + rw] = true;
                stack[size++] = idx + rw;
            }
        }
        return box.count == 0 ? null : box;
    }

    /**
     * 读图标右侧的数字。
     *
     * @param icon  资源图标
     * @param right 图标右侧的另一个图标（用于限定数字裁剪宽度），可为 null
     */
    private Long readRightNumber(BufferedImage image, Box icon, Box right) {
        int side = Math.max(icon.right - icon.left, icon.bottom - icon.top);
        if (side < 6) {
            return null;
        }
        int gap = Math.max(2, (int) Math.round(side * 0.3));
        // 颜色连通块可能只覆盖图标主体，按外接方框的右缘再留一点余量，避免把图标色块当成数字
        int left = Math.max(icon.right, icon.left + side) + gap;
        int limit = left + Math.max(side * 9, 100);
        // 只有另一个图标确实在右侧、且纵向重叠时，才用它限制数字区，避免把左边的图标当边界
        if (right != null && right.left > left && overlapsVertically(icon, right)) {
            limit = Math.min(limit, right.left - gap);
        }
        limit = Math.min(limit, image.getWidth() - 1);
        if (limit - left < 10) {
            return null;
        }
        int centerY = (icon.top + icon.bottom) / 2;
        int top = Math.max(0, centerY - (int) Math.round(side * 0.9));
        int bottom = Math.min(image.getHeight(), centerY + (int) Math.round(side * 0.9));
        if (bottom - top < 8) {
            return null;
        }
        BufferedImage crop = image.getSubimage(left, top, limit - left, bottom - top);
        // 底栏数字多为深色底上的白字；个别主题是浅色底深字。
        // 二值化后的裁剪范围可能切掉末尾数字，因此几种预处理都试一遍，取位数最多的结果。
        String best = "";
        String[] attempts = {
                recognizeDigits(binarize(crop, TEXT_LUM)),
                recognizeDigits(binarize(crop, 255 - TEXT_LUM)),
                recognizeDigits(crop)
        };
        for (String text : attempts) {
            if (text.length() > best.length()) {
                best = text;
            }
        }
        return toNumber(best);
    }

    /** 两个图标在纵向是否大致同一行 */
    private boolean overlapsVertically(Box left, Box right) {
        int overlap = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
        int minHeight = Math.min(left.bottom - left.top, right.bottom - right.top);
        return overlap > 0 && overlap >= minHeight * 0.5;
    }

    private String recognizeDigits(BufferedImage image) {
        String text = engine.recognizeNumber(toPng(upscale(image, 3)), ".png");
        return text == null ? "" : text.replaceAll("[^0-9]", "");
    }

    private Long toNumber(String digits) {
        if (digits == null || digits.isEmpty() || digits.length() > 9) {
            return null;
        }
        try {
            long value = Long.parseLong(digits);
            return value > 0 ? value : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /**
     * 按亮度二值化：亮度不低于 threshold 的像素变白，其余变黑。
     * threshold 取 150 保留白字；取 105 则保留深色字（浅底深字的主题）。
     */
    private BufferedImage binarize(BufferedImage source, int threshold) {
        BufferedImage target = new BufferedImage(source.getWidth(), source.getHeight(),
                BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < source.getHeight(); y++) {
            for (int x = 0; x < source.getWidth(); x++) {
                int rgb = source.getRGB(x, y);
                int r = (rgb >> 16) & 0xFF;
                int g = (rgb >> 8) & 0xFF;
                int b = rgb & 0xFF;
                int lum = (int) (r * 0.299 + g * 0.587 + b * 0.114);
                target.setRGB(x, y, lum >= threshold ? 0xFFFFFF : 0x000000);
            }
        }
        return target;
    }

    private BufferedImage upscale(BufferedImage image, int factor) {
        BufferedImage target = new BufferedImage(image.getWidth() * factor, image.getHeight() * factor,
                BufferedImage.TYPE_INT_RGB);
        java.awt.Graphics2D g = target.createGraphics();
        g.setRenderingHint(java.awt.RenderingHints.KEY_INTERPOLATION,
                java.awt.RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g.drawImage(image, 0, 0, target.getWidth(), target.getHeight(), null);
        g.dispose();
        return target;
    }

    private byte[] toPng(BufferedImage image) {
        try {
            java.io.ByteArrayOutputStream stream = new java.io.ByteArrayOutputStream();
            javax.imageio.ImageIO.write(image, "png", stream);
            return stream.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    private static boolean isGold(int rgb) {
        float[] hsb = hsbOf(rgb);
        return hsb[1] >= GOLD_SAT && hsb[2] * 255 >= GOLD_LUM
                && hsb[0] >= GOLD_HUE_MIN && hsb[0] <= GOLD_HUE_MAX;
    }

    private static boolean isBlue(int rgb) {
        float[] hsb = hsbOf(rgb);
        return hsb[1] >= BLUE_SAT && hsb[2] * 255 >= BLUE_LUM
                && hsb[0] >= BLUE_HUE_MIN && hsb[0] <= BLUE_HUE_MAX;
    }

    private static float[] hsbOf(int rgb) {
        int r = (rgb >> 16) & 0xFF;
        int g = (rgb >> 8) & 0xFF;
        int b = rgb & 0xFF;
        float[] hsb = new float[3];
        java.awt.Color.RGBtoHSB(r, g, b, hsb);
        return hsb;
    }

    private final TesseractEngine engine;

    public BottomBarRecognizer(TesseractEngine engine) {
        this.engine = engine;
    }

    /** 底栏图标的像素范围 */
    private static class Box {
        private int left;
        private int top;
        private int right;
        private int bottom;
        private int count;
    }
}

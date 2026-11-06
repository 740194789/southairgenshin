package com.southair.genshin.module.ocr;

import org.springframework.stereotype.Component;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;

/**
 * 识别「命之座」界面的已激活命座数。
 *
 * <p>命之座界面右侧有 6 个命座节点，沿竖排（略有弧线）排列：已激活的节点是元素色发光图案，
 * 未激活的节点中央有白色锁。节点圆盘本身是半透明的，背景的星云 / 元素色会透出来，
 * 按「彩色像素占比」判断会被背景严重干扰（实测零命角色会被识别成 4 命），
 * 因此改成数「中央白色锁」：找不到锁的节点才算已激活。</p>
 */
@Component
public class ConstellationRecognizer {

    /** 命座节点列在画面中的大致横向范围（只包含图标本身，避开右侧中文标签与箭头） */
    private static final double ROI_LEFT = 0.72;
    private static final double ROI_RIGHT = 0.90;
    /** 避开顶部货币栏与底部 UID */
    private static final double ROI_TOP = 0.08;
    private static final double ROI_BOTTOM = 0.92;

    private static final int NODE_COUNT = 6;

    /** 锁是纯白、低饱和的实心图形；元素色图案哪怕再亮也带明显饱和度 */
    private static final int LOCK_LUMINANCE = 190;
    private static final float LOCK_SATURATION = 0.15f;
    /** 锁的边长范围（相对截图宽度），同时用来排除右侧中文标签的细笔画 */
    private static final double LOCK_MIN_RATIO = 0.010;
    private static final double LOCK_MAX_RATIO = 0.050;
    /** 锁是竖长形（锁体 + 锁梁），宽高比落在该区间 */
    private static final double LOCK_MIN_ASPECT = 1.05;
    private static final double LOCK_MAX_ASPECT = 2.2;
    /** 连通块填充率：锁体几乎填满外接矩形，文字笔画远低于该值 */
    private static final double LOCK_MIN_FILL = 0.45;

    /**
     * @return 已激活命座数（0-6）；不是命之座界面、或识别不成 6 个等间距节点时返回 null
     */
    public Integer recognize(BufferedImage image) {
        if (image == null) {
            return null;
        }
        int width = image.getWidth();
        int height = image.getHeight();
        int xFrom = (int) Math.round(width * ROI_LEFT);
        int xTo = (int) Math.round(width * ROI_RIGHT);
        int yFrom = (int) Math.round(height * ROI_TOP);
        int yTo = (int) Math.round(height * ROI_BOTTOM);
        if (xTo - xFrom < 20 || yTo - yFrom < 120) {
            return null;
        }

        int[] window = findNodeWindow(image, xFrom, xTo, yFrom, yTo);
        if (window == null) {
            return null;
        }
        int pitch = window[NODE_COUNT] / (NODE_COUNT - 1);
        List<Box> locks = findLocks(image, xFrom, xTo, Math.max(0, window[0] - pitch),
                Math.min(height, window[NODE_COUNT - 1] + pitch), width);

        int locked = 0;
        for (int i = 0; i < NODE_COUNT; i++) {
            if (findLockNear(locks, window[i], pitch)) {
                locked++;
            }
        }
        return NODE_COUNT - locked;
    }

    /** 每个节点行是否找到白色锁；没有锁说明该命座已激活 */
    private boolean findLockNear(List<Box> locks, int centerY, int pitch) {
        for (Box lock : locks) {
            if (Math.abs(lock.centerY() - centerY) <= pitch * 0.45) {
                return true;
            }
        }
        return false;
    }

    /**
     * 在节点区域内找白色锁的连通块。
     *
     * <p>未激活节点中央是纯白锁（锁体 + 锁梁），比右侧白色中文标签的细笔画更「实」：
     * 按亮度 + 低饱和取白色像素，再按尺寸、宽高比和填充率筛掉文字与图标碎片。</p>
     */
    private List<Box> findLocks(BufferedImage image, int xFrom, int xTo, int yFrom, int yTo,
                                int imageWidth) {
        List<Box> locks = new ArrayList<>();
        int rw = xTo - xFrom;
        int rh = yTo - yFrom;
        if (rw < 10 || rh < 10) {
            return locks;
        }
        boolean[] mask = new boolean[rw * rh];
        for (int y = 0; y < rh; y++) {
            for (int x = 0; x < rw; x++) {
                int rgb = image.getRGB(xFrom + x, yFrom + y);
                int r = (rgb >> 16) & 0xFF;
                int g = (rgb >> 8) & 0xFF;
                int b = rgb & 0xFF;
                int lum = (int) (r * 0.299 + g * 0.587 + b * 0.114);
                mask[y * rw + x] = lum >= LOCK_LUMINANCE
                        && Color.RGBtoHSB(r, g, b, null)[1] <= LOCK_SATURATION;
            }
        }

        int minWidth = Math.max(8, (int) Math.round(imageWidth * LOCK_MIN_RATIO));
        int maxWidth = Math.max(minWidth + 1, (int) Math.round(imageWidth * LOCK_MAX_RATIO));

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
            double aspect = h / (double) Math.max(1, w);
            double fill = box.count / (double) Math.max(1, w * h);
            if (w < minWidth || w > maxWidth || h < minWidth || h > maxWidth
                    || aspect < LOCK_MIN_ASPECT || aspect > LOCK_MAX_ASPECT
                    || fill < LOCK_MIN_FILL) {
                continue;
            }
            box.left += xFrom;
            box.right += xFrom;
            box.top += yFrom;
            box.bottom += yFrom;
            locks.add(box);
        }
        return locks;
    }

    /** 八邻域泛洪，返回该白色连通块的外接矩形与像素数 */
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
            for (int dy = -1; dy <= 1; dy++) {
                for (int dx = -1; dx <= 1; dx++) {
                    if (dx == 0 && dy == 0) {
                        continue;
                    }
                    int nx = x + dx;
                    int ny = y + dy;
                    if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) {
                        continue;
                    }
                    int next = ny * rw + nx;
                    if (mask[next] && !visited[next]) {
                        visited[next] = true;
                        stack[size++] = next;
                    }
                }
            }
        }
        return box.count == 0 ? null : box;
    }

    /** 白色锁连通块的像素范围 */
    private static class Box {
        private int left;
        private int top;
        private int right;
        private int bottom;
        private int count;

        private int centerY() {
            return (top + bottom) / 2;
        }
    }

    /**
     * 找出等间距竖排的 6 个节点中心 Y。
     *
     * <p>亮度阈值从低到高依次尝试：阈值太低时相邻已激活节点的外发光会连成一段（段高超出上限被丢弃），
     * 阈值太高时未激活的灰白环又会消失。每个阈值都算一遍候选窗口，最后取「间距最均匀」的那组。</p>
     *
     * @return 长度 7 的数组：前 6 个是节点中心 Y，最后一个是总跨度；找不到返回 null
     */
    private int[] findNodeWindow(BufferedImage image, int xFrom, int xTo, int yFrom, int yTo) {
        int height = image.getHeight();
        int minBand = Math.max(6, (int) Math.round(height * 0.018));
        int maxBand = (int) Math.round(height * 0.10);
        int[] thresholds = {105, 125, 145, 165, 185, 205};

        int[] best = null;
        double bestScore = Double.MAX_VALUE;
        for (int threshold : thresholds) {
            List<int[]> bands = findBands(image, xFrom, xTo, yFrom, yTo, minBand, maxBand, threshold);
            if (bands.size() < NODE_COUNT) {
                continue;
            }
            for (int i = 0; i + NODE_COUNT <= bands.size(); i++) {
                int[] centers = new int[NODE_COUNT];
                for (int j = 0; j < NODE_COUNT; j++) {
                    centers[j] = center(bands.get(i + j));
                }
                double score = latticeScore(centers, height);
                if (score >= 0 && score < bestScore) {
                    bestScore = score;
                    best = withSpan(centers);
                }
            }
        }
        // 间距偏差超过 18% 认为不是命座列（例如角色列表、背包网格）
        if (best != null && bestScore <= 0.18) {
            return best;
        }
        // 外发光很强时相邻节点会连成一大段，行段检测拿不到 6 段，改用逐行亮度投影的峰值
        return findPeakWindow(image, xFrom, xTo, yFrom, yTo);
    }

    /**
     * 6 个等间距中心的均匀度得分：间距越均匀、越接近标准列间距，得分越低。
     *
     * @return 不适合作为命座列时返回 -1
     */
    private double latticeScore(int[] centers, int height) {
        double meanPitch = (centers[NODE_COUNT - 1] - centers[0]) / (NODE_COUNT - 1);
        if (meanPitch < height * 0.045 || meanPitch > height * 0.135) {
            return -1;
        }
        double deviation = 0;
        for (int j = 0; j < NODE_COUNT - 1; j++) {
            deviation += Math.abs(centers[j + 1] - centers[j] - meanPitch);
        }
        deviation /= NODE_COUNT - 1;
        // 间距均匀度优先，同时轻微偏好与标准命座列间距接近的窗口
        return deviation / meanPitch + Math.abs(meanPitch - height * 0.088) / height;
    }

    private int[] withSpan(int[] centers) {
        int[] result = new int[NODE_COUNT + 1];
        System.arraycopy(centers, 0, result, 0, NODE_COUNT);
        result[NODE_COUNT] = result[NODE_COUNT - 1] - result[0];
        return result;
    }

    /**
     * 行段检测失败时的兜底：按「每行亮像素数量」找尖峰。
     *
     * <p>已激活节点中心有整片亮色图案，行亮度明显高于节点之间的外发光缝隙；
     * 即使相邻发光连成一片，尖峰仍落在各节点中心。</p>
     */
    private int[] findPeakWindow(BufferedImage image, int xFrom, int xTo, int yFrom, int yTo) {
        int height = image.getHeight();
        int[] profile = new int[yTo - yFrom + 1];
        for (int y = yFrom; y <= yTo; y++) {
            int bright = 0;
            for (int x = xFrom; x < xTo; x++) {
                if (luminance(image, x, y) >= 150) {
                    bright++;
                }
            }
            profile[y - yFrom] = bright;
        }
        // 轻微平滑，避免单个像素抖动产生假峰
        int[] smoothed = new int[profile.length];
        int half = Math.max(1, (int) Math.round(height * 0.004));
        for (int i = 0; i < profile.length; i++) {
            int sum = 0;
            int count = 0;
            for (int k = -half; k <= half; k++) {
                int idx = i + k;
                if (idx >= 0 && idx < profile.length) {
                    sum += profile[idx];
                    count++;
                }
            }
            smoothed[i] = sum / Math.max(1, count);
        }
        int minGap = Math.max(8, (int) Math.round(height * 0.06));
        List<Integer> peaks = new ArrayList<>();
        for (int i = 1; i < smoothed.length - 1; i++) {
            int value = smoothed[i];
            if (value < 8 || value < smoothed[i - 1] || value <= smoothed[i + 1]) {
                continue;
            }
            if (!peaks.isEmpty() && i - peaks.get(peaks.size() - 1) < minGap) {
                // 同一个节点内出现两个峰时保留更亮的
                int last = peaks.get(peaks.size() - 1);
                if (value > smoothed[last]) {
                    peaks.set(peaks.size() - 1, i);
                }
                continue;
            }
            peaks.add(i);
        }
        if (peaks.size() < NODE_COUNT) {
            return null;
        }
        int[] best = null;
        double bestScore = Double.MAX_VALUE;
        for (int i = 0; i + NODE_COUNT <= peaks.size(); i++) {
            int[] centers = new int[NODE_COUNT];
            for (int j = 0; j < NODE_COUNT; j++) {
                centers[j] = yFrom + peaks.get(i + j);
            }
            double score = latticeScore(centers, height);
            if (score >= 0 && score < bestScore) {
                bestScore = score;
                best = withSpan(centers);
            }
        }
        return best != null && bestScore <= 0.18 ? best : null;
    }

    private List<int[]> findBands(BufferedImage image, int xFrom, int xTo, int yFrom, int yTo,
                                  int minBand, int maxBand, int threshold) {
        List<int[]> bands = new ArrayList<>();
        int start = -1;
        for (int y = yFrom; y <= yTo; y++) {
            boolean on = y < yTo && hasBrightRow(image, xFrom, xTo, y, threshold);
            if (on && start < 0) {
                start = y;
            } else if (!on && start >= 0) {
                int bandHeight = y - start;
                if (bandHeight >= minBand && bandHeight <= maxBand) {
                    bands.add(new int[]{start, y - 1});
                }
                start = -1;
            }
        }
        return bands;
    }

    private boolean hasBrightRow(BufferedImage image, int xFrom, int xTo, int y, int threshold) {
        int bright = 0;
        for (int x = xFrom; x < xTo; x++) {
            if (luminance(image, x, y) >= threshold) {
                bright++;
                if (bright >= 4) {
                    return true;
                }
            }
        }
        return false;
    }

    private static int center(int[] band) {
        return (band[0] + band[1]) / 2;
    }

    private static int luminance(BufferedImage image, int x, int y) {
        int rgb = image.getRGB(x, y);
        int r = (rgb >> 16) & 0xFF;
        int g = (rgb >> 8) & 0xFF;
        int b = rgb & 0xFF;
        return (int) (r * 0.299 + g * 0.587 + b * 0.114);
    }
}

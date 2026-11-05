package com.southair.genshin.module.ocr;

import org.springframework.stereotype.Component;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.List;

/**
 * 识别「命之座」界面的已激活命座数。
 *
 * <p>命之座界面右侧有 6 个命座节点，沿竖排（略有弧线）排列：已激活为元素色发光圆环 + 亮色图案，
 * 未激活为灰白圆环 + 中央白色锁。做法是先在右列找 6 个等间距的圆盘，再用圆盘内「成片高饱和亮像素」
 * 的占比判断是否点亮——已激活节点有元素色外发光，未激活只有灰白，饱和度很低。</p>
 */
@Component
public class ConstellationRecognizer {

    /** 命座节点列在画面中的大致横向范围（只包含图标本身，避开右侧中文标签与箭头） */
    private static final double ROI_LEFT = 0.72;
    private static final double ROI_RIGHT = 0.90;
    /** 避开顶部货币栏与底部 UID */
    private static final double ROI_TOP = 0.08;
    private static final double ROI_BOTTOM = 0.92;
    /** 节点列的标准横向位置，找不到圆心时兜底 */
    private static final double EXPECTED_COLUMN_X = 0.805;

    private static final int NODE_COUNT = 6;
    /** 圆盘内有彩色亮像素的占比达到该值视为已激活 */
    private static final double LIT_RATIO = 0.055;
    /** 饱和度阈值：未激活的灰白环饱和度通常低于 0.1，元素色圆环明显更高 */
    private static final float COLOR_SATURATION = 0.20f;
    private static final int COLOR_LUMINANCE = 75;

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
        int radius = Math.max(7, (int) Math.round(pitch * 0.30));
        // 不同分辨率 / 界面缩放下节点列会整体左右平移，按实际亮像素估计列位置比固定比例更稳
        int expectedX = estimateColumnX(image, window, radius, xFrom, xTo);
        if (expectedX <= 0) {
            expectedX = (int) Math.round(width * EXPECTED_COLUMN_X);
        }

        int lit = 0;
        for (int i = 0; i < NODE_COUNT; i++) {
            int centerY = window[i];
            int centerX = brightCentroidX(image, centerY, radius, xFrom, xTo, expectedX);
            if (centerX <= 0) {
                centerX = expectedX;
            }
            if (isLit(image, centerX, centerY, radius)) {
                lit++;
            }
        }
        return lit;
    }

    /**
     * 用 6 个已知节点行估计整列圆心 X：把每个节点行带内的亮像素按列累加，
     * 再取「宽度约 2r 的滑动窗口和」最大的列——圆盘（含内部图案）比右侧细笔画的中文标签亮得多，
     * 因此不会被标签拉偏。
     */
    private int estimateColumnX(BufferedImage image, int[] window, int radius,
                                int xFrom, int xTo) {
        int[] profile = new int[xTo - xFrom];
        int bandRadius = Math.max(4, (int) Math.round(radius * 1.2));
        for (int i = 0; i < NODE_COUNT; i++) {
            int centerY = window[i];
            int top = Math.max(0, centerY - bandRadius);
            int bottom = Math.min(image.getHeight() - 1, centerY + bandRadius);
            for (int y = top; y <= bottom; y++) {
                for (int x = xFrom; x < xTo; x++) {
                    if (luminance(image, x, y) >= 115) {
                        profile[x - xFrom]++;
                    }
                }
            }
        }
        int win = Math.max(4, radius * 2);
        long sum = 0;
        for (int i = 0; i < profile.length && i < win; i++) {
            sum += profile[i];
        }
        long best = sum;
        int bestStart = 0;
        for (int i = win; i < profile.length; i++) {
            sum += profile[i] - profile[i - win];
            if (sum > best) {
                best = sum;
                bestStart = i - win + 1;
            }
        }
        if (best <= 0) {
            return -1;
        }
        return xFrom + bestStart + win / 2;
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

    /**
     * 行段内亮像素的 x 质心；只在预期节点列附近的窄条内取样，避免右侧中文标签把圆心拉偏。
     * 未激活节点也有灰白圆环与白色锁，因此用亮度而不是饱和度。
     */
    private int brightCentroidX(BufferedImage image, int centerY, int radius,
                                int xFrom, int xTo, int expectedX) {
        int margin = Math.max(radius + 6, (int) Math.round(image.getWidth() * 0.035));
        int left = Math.max(xFrom, expectedX - margin);
        int right = Math.min(xTo, expectedX + margin);
        int top = Math.max(0, centerY - radius);
        int bottom = Math.min(image.getHeight() - 1, centerY + radius);
        long sum = 0;
        int count = 0;
        for (int y = top; y <= bottom; y++) {
            for (int x = left; x < right; x++) {
                if (luminance(image, x, y) >= 115) {
                    sum += x;
                    count++;
                }
            }
        }
        if (count < 8) {
            return -1;
        }
        return (int) (sum / count);
    }

    /** 圆盘内出现成片的高饱和亮像素 = 已激活（元素色发光）；未激活只有灰白环，饱和度很低 */
    private boolean isLit(BufferedImage image, int cx, int cy, int radius) {
        int scan = (int) Math.round(radius * 1.15);
        int total = 0;
        int colored = 0;
        for (int dy = -scan; dy <= scan; dy++) {
            for (int dx = -scan; dx <= scan; dx++) {
                if (dx * dx + dy * dy > scan * scan) {
                    continue;
                }
                int x = cx + dx;
                int y = cy + dy;
                if (x < 0 || y < 0 || x >= image.getWidth() || y >= image.getHeight()) {
                    continue;
                }
                int rgb = image.getRGB(x, y);
                int r = (rgb >> 16) & 0xFF;
                int g = (rgb >> 8) & 0xFF;
                int b = rgb & 0xFF;
                int lum = (int) (r * 0.299 + g * 0.587 + b * 0.114);
                total++;
                if (lum >= COLOR_LUMINANCE && Color.RGBtoHSB(r, g, b, null)[1] >= COLOR_SATURATION) {
                    colored++;
                }
            }
        }
        return total > 0 && (double) colored / total >= LIT_RATIO;
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

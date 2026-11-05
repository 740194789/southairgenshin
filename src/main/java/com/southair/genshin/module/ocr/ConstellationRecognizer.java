package com.southair.genshin.module.ocr;

import org.springframework.stereotype.Component;

import java.awt.image.BufferedImage;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * 识别「命之座」界面的已激活命座数。
 *
 * <p>命之座界面右侧有 6 个命座节点，沿弧形竖排：已激活为彩色（元素色）圆环 + 亮色图案，
 * 未激活为灰白圆环 + 中央白色锁。这里先按行找出这些节点圆盘，再用「等间距 6 个」筛掉
 * 顶部角色条等干扰，最后统计每个节点圆环上「高饱和亮像素」的占比判断是否点亮——
 * 已激活圆环有明显成片彩色，未激活几乎没有。</p>
 */
@Component
public class ConstellationRecognizer {

    /** 命座节点列在画面中的大致横向范围 */
    private static final double ROI_LEFT = 0.68;
    private static final double ROI_RIGHT = 0.92;
    private static final double ROI_TOP = 0.05;
    private static final double ROI_BOTTOM = 0.97;

    private static final int NODE_COUNT = 6;
    /** 圆环上高饱和亮像素占圆环面积的比例达到该值视为已激活 */
    private static final double LIT_RING_RATIO = 0.03;

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
        if (xTo - xFrom < 30 || yTo - yFrom < 120) {
            return null;
        }

        List<int[]> nodes = findNodes(image, xFrom, xTo, yFrom, yTo);
        if (nodes.size() != NODE_COUNT) {
            return null;
        }
        int lit = 0;
        for (int[] node : nodes) {
            if (isLit(image, node)) {
                lit++;
            }
        }
        return lit;
    }

    /** 找出等间距竖排的 6 个命座节点：返回每个节点的 {cx, cy, radius} */
    private List<int[]> findNodes(BufferedImage image, int xFrom, int xTo, int yFrom, int yTo) {
        double minHeight = image.getHeight() * 0.025;
        List<int[]> bands = new ArrayList<>();
        int start = -1;
        for (int y = yFrom; y <= yTo; y++) {
            boolean on = y < yTo && hasBrightRow(image, xFrom, xTo, y);
            if (on && start < 0) {
                start = y;
            } else if (!on && start >= 0) {
                if (y - start >= minHeight) {
                    bands.add(new int[]{start, y - 1});
                }
                start = -1;
            }
        }
        if (bands.size() < NODE_COUNT) {
            return new ArrayList<>();
        }

        // 节点等间距排列，取间距最均匀的连续 6 段，排除顶部角色条、底部 UID 等干扰
        int windowStart = -1;
        double bestScore = Double.MAX_VALUE;
        for (int i = 0; i + NODE_COUNT <= bands.size(); i++) {
            double mean = 0;
            for (int j = 0; j < NODE_COUNT - 1; j++) {
                mean += cy(bands.get(i + j + 1)) - cy(bands.get(i + j));
            }
            mean /= NODE_COUNT - 1;
            if (mean < image.getHeight() * 0.05) {
                continue;
            }
            double variance = 0;
            for (int j = 0; j < NODE_COUNT - 1; j++) {
                double pitch = cy(bands.get(i + j + 1)) - cy(bands.get(i + j));
                variance += (pitch - mean) * (pitch - mean);
            }
            variance = Math.sqrt(variance / (NODE_COUNT - 1));
            if (variance < bestScore) {
                bestScore = variance;
                windowStart = i;
            }
        }
        if (windowStart < 0 || bestScore > image.getHeight() * 0.012) {
            return new ArrayList<>();
        }

        List<int[]> window = new ArrayList<>(bands.subList(windowStart, windowStart + NODE_COUNT));
        int[] heights = new int[NODE_COUNT];
        for (int i = 0; i < NODE_COUNT; i++) {
            heights[i] = window.get(i)[1] - window.get(i)[0] + 1;
        }
        Arrays.sort(heights);
        int radius = Math.max(6, heights[NODE_COUNT / 2] / 2);

        // 每个节点的圆心：圆环上高饱和亮像素的 x 质心；未激活节点没有彩色环，用镜像位置补
        int[] cxs = new int[NODE_COUNT];
        Arrays.fill(cxs, Integer.MIN_VALUE);
        for (int i = 0; i < NODE_COUNT; i++) {
            int cx = ringCentroidX(image, window.get(i)[0], window.get(i)[1], xFrom, xTo);
            if (cx != Integer.MIN_VALUE) {
                cxs[i] = cx;
            }
        }
        int[] known = new int[NODE_COUNT];
        int knownCount = 0;
        for (int i = 0; i < NODE_COUNT; i++) {
            if (cxs[i] != Integer.MIN_VALUE) {
                known[knownCount++] = cxs[i];
            }
        }
        if (knownCount < 3) {
            return new ArrayList<>();
        }
        for (int i = 0; i < NODE_COUNT; i++) {
            if (cxs[i] != Integer.MIN_VALUE) {
                continue;
            }
            int mirror = NODE_COUNT - 1 - i;
            cxs[i] = cxs[mirror] != Integer.MIN_VALUE ? cxs[mirror] : median(known, knownCount);
        }

        List<int[]> nodes = new ArrayList<>();
        for (int i = 0; i < NODE_COUNT; i++) {
            int cy = (window.get(i)[0] + window.get(i)[1]) / 2;
            nodes.add(new int[]{cxs[i], cy, radius});
        }
        return nodes;
    }

    private boolean hasBrightRow(BufferedImage image, int xFrom, int xTo, int y) {
        int bright = 0;
        for (int x = xFrom; x < xTo; x++) {
            if (luminance(image, x, y) >= 110) {
                bright++;
            }
        }
        return bright >= 4;
    }

    /** 行段内「高饱和亮像素」的 x 质心；数量太少（未激活的灰白环）返回 Integer.MIN_VALUE */
    private int ringCentroidX(BufferedImage image, int top, int bottom, int xFrom, int xTo) {
        long sum = 0;
        int count = 0;
        for (int y = top; y <= bottom; y++) {
            for (int x = xFrom; x < xTo; x++) {
                int rgb = image.getRGB(x, y);
                int r = (rgb >> 16) & 0xFF;
                int g = (rgb >> 8) & 0xFF;
                int b = rgb & 0xFF;
                int lum = (int) (r * 0.299 + g * 0.587 + b * 0.114);
                float[] hsb = java.awt.Color.RGBtoHSB(r, g, b, null);
                if (hsb[1] > 0.55 && lum > 80) {
                    sum += x;
                    count++;
                }
            }
        }
        if (count < 20) {
            return Integer.MIN_VALUE;
        }
        return (int) (sum / count);
    }

    /** 圆环上高饱和亮像素占比够高 = 已激活 */
    private boolean isLit(BufferedImage image, int[] node) {
        int cx = node[0];
        int cy = node[1];
        int radius = node[2];
        int ringCount = 0;
        int saturated = 0;
        for (int dy = -radius; dy <= radius; dy++) {
            for (int dx = -radius; dx <= radius; dx++) {
                double dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < radius * 0.62 || dist > radius) {
                    continue;
                }
                int x = cx + dx;
                int y = cy + dy;
                if (x < 0 || y < 0 || x >= image.getWidth() || y >= image.getHeight()) {
                    continue;
                }
                ringCount++;
                int rgb = image.getRGB(x, y);
                int r = (rgb >> 16) & 0xFF;
                int g = (rgb >> 8) & 0xFF;
                int b = rgb & 0xFF;
                int lum = (int) (r * 0.299 + g * 0.587 + b * 0.114);
                float[] hsb = java.awt.Color.RGBtoHSB(r, g, b, null);
                if (hsb[1] > 0.55 && lum > 80) {
                    saturated++;
                }
            }
        }
        return ringCount > 0 && (double) saturated / ringCount >= LIT_RING_RATIO;
    }

    private static int cy(int[] band) {
        return (band[0] + band[1]) / 2;
    }

    private static int median(int[] values, int count) {
        int[] copy = Arrays.copyOf(values, count);
        Arrays.sort(copy);
        return copy[count / 2];
    }

    private static int luminance(BufferedImage image, int x, int y) {
        int rgb = image.getRGB(x, y);
        int r = (rgb >> 16) & 0xFF;
        int g = (rgb >> 8) & 0xFF;
        int b = rgb & 0xFF;
        return (int) (r * 0.299 + g * 0.587 + b * 0.114);
    }
}

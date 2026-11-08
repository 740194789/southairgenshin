package com.southair.genshin.module.ocr;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.InputStream;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;

/**
 * 背包图标匹配：按图案（颜色分布）在截图里定位指定物品，不依赖背包排序或固定格子位置。
 *
 * <p>原理：把物品卡片缩放到统一大小后切成 4×4 网格，取每格的平均 RGB 作为描述子；
 * 用积分图在截图背包区域滑动比对每个模板，距离足够小且明显优于第二候选才判定为命中。</p>
 */
@Component
public class ItemIconMatcher {

    private static final Logger log = LoggerFactory.getLogger(ItemIconMatcher.class);

    public static final String INTERTWINED_FATES = "intertwinedFates";
    public static final String ACQUAINTED_FATES = "acquaintedFates";
    public static final String HERO_WIT = "heroWit";
    public static final String ADVENTURER_EXP = "adventurerExp";
    public static final String WANDERER_ADVICE = "wandererAdvice";
    public static final String SANCTIFYING_UNCTION = "sanctifyingUnction";
    public static final String SANCTIFYING_ESSENCE = "sanctifyingEssence";

    private static final String[] TEMPLATES = {
            INTERTWINED_FATES, ACQUAINTED_FATES, HERO_WIT, ADVENTURER_EXP, WANDERER_ADVICE,
            SANCTIFYING_UNCTION, SANCTIFYING_ESSENCE
    };

    /** 匹配时统一缩放到该图标边长，减小分辨率差异带来的干扰 */
    private static final int MATCH_ICON = 56;
    /** 去掉卡片四周边缘，只比较图标主体 */
    private static final double INSET = 0.12;
    private static final int GRID = 4;
    /** 描述子距离阈值：越小越像；实测命中约 0.01~0.03，非目标约 0.07 以上 */
    private static final double THRESHOLD = 0.055;
    /** 命中结果需比第二候选好这么多倍，避免相似物品误判 */
    private static final double MARGIN = 1.5;
    /** 图标边长相对截图宽、高的比例（原神背包卡片布局） */
    private static final double ICON_WIDTH_RATIO = 0.0585;
    private static final double ICON_HEIGHT_RATIO = 0.104;
    /** 背包网格大致区域，避开右侧详情面板与顶部栏、底部资源栏 */
    private static final double ROI_LEFT = 0.02;
    private static final double ROI_RIGHT = 0.70;
    private static final double ROI_TOP = 0.10;
    private static final double ROI_BOTTOM = 0.86;

    private final Map<String, double[]> templateDescriptors = new LinkedHashMap<>();

    public ItemIconMatcher() {
        for (String key : TEMPLATES) {
            BufferedImage image = readTemplate(key);
            if (image != null) {
                templateDescriptors.put(key, descriptorOfSquare(image));
            }
        }
    }

    private BufferedImage readTemplate(String key) {
        String path = "ocr/icons/" + key + ".png";
        try (InputStream in = getClass().getClassLoader().getResourceAsStream(path)) {
            if (in == null) {
                log.warn("缺少物品图标模板：{}", path);
                return null;
            }
            return ImageIO.read(in);
        } catch (Exception e) {
            log.warn("读取物品图标模板失败：{}", path, e);
            return null;
        }
    }

    /** 在整张截图中定位所有模板物品，返回命中的物品 key 与位置 */
    public Map<String, Match> locateAll(BufferedImage screenshot) {
        return locate(screenshot, templateDescriptors.keySet());
    }

    /**
     * 在截图中查找指定物品。
     *
     * @param screenshot 游戏截图
     * @param keys       需要查找的物品 key
     * @return 命中的物品（未命中不会出现在结果里）
     */
    public Map<String, Match> locate(BufferedImage screenshot, Collection<String> keys) {
        if (screenshot == null) {
            return Collections.emptyMap();
        }
        Set<String> wanted = new LinkedHashSet<>();
        for (String key : keys) {
            if (templateDescriptors.containsKey(key)) {
                wanted.add(key);
            }
        }
        if (wanted.isEmpty()) {
            return Collections.emptyMap();
        }
        int srcWidth = screenshot.getWidth();
        int srcHeight = screenshot.getHeight();
        double iconSize = (ICON_WIDTH_RATIO * srcWidth + ICON_HEIGHT_RATIO * srcHeight) / 2.0;
        if (iconSize < 16) {
            return Collections.emptyMap();
        }
        double scale = MATCH_ICON / iconSize;
        int width = (int) Math.round(srcWidth * scale);
        int height = (int) Math.round(srcHeight * scale);
        if (width < MATCH_ICON + 4 || height < MATCH_ICON + 4) {
            return Collections.emptyMap();
        }
        BufferedImage scaled = resize(screenshot, width, height);
        long[][] sums = integralImages(scaled);

        int x0 = (int) Math.round(width * ROI_LEFT);
        int x1 = (int) Math.round(width * ROI_RIGHT);
        int y0 = (int) Math.round(height * ROI_TOP);
        int y1 = (int) Math.round(height * ROI_BOTTOM);
        int stride = Math.max(2, MATCH_ICON / 14);

        Map<String, Match> best = new LinkedHashMap<>();
        for (String key : wanted) {
            best.put(key, null);
        }
        Map<String, Double> bestDistance = new LinkedHashMap<>();
        for (String key : wanted) {
            bestDistance.put(key, Double.MAX_VALUE);
        }

        for (int y = y0; y + MATCH_ICON <= y1; y += stride) {
            for (int x = x0; x + MATCH_ICON <= x1; x += stride) {
                double[] descriptor = descriptorAt(x, y, MATCH_ICON, sums, width);
                for (String key : wanted) {
                    double distance = distance(templateDescriptors.get(key), descriptor);
                    if (distance < bestDistance.get(key)) {
                        bestDistance.put(key, distance);
                        best.put(key, new Match(key, x, y, MATCH_ICON, distance));
                    }
                }
            }
        }

        Map<String, Match> result = new LinkedHashMap<>();
        for (String key : wanted) {
            Match hit = best.get(key);
            if (hit == null || hit.getDistance() > THRESHOLD) {
                continue;
            }
            double second = secondBest(sums, width, x0, x1, y0, y1, stride, templateDescriptors.get(key),
                    hit.getX(), hit.getY());
            if (second <= hit.getDistance() * MARGIN) {
                continue;
            }
            result.put(key, toSourceCoordinates(hit, scale, srcWidth, srcHeight));
        }
        return result;
    }

    /** 与命中位置不重叠的次优距离，用于判断命中是否足够独特 */
    private double secondBest(long[][] sums, int width, int x0, int x1, int y0, int y1,
                              int stride, double[] template, int hitX, int hitY) {
        int limit = (int) Math.round(MATCH_ICON * 0.7);
        double second = Double.MAX_VALUE;
        for (int y = y0; y + MATCH_ICON <= y1; y += stride) {
            for (int x = x0; x + MATCH_ICON <= x1; x += stride) {
                if (Math.abs(x - hitX) <= limit && Math.abs(y - hitY) <= limit) {
                    continue;
                }
                double distance = distance(template, descriptorAt(x, y, MATCH_ICON, sums, width));
                if (distance < second) {
                    second = distance;
                }
            }
        }
        return second;
    }

    private Match toSourceCoordinates(Match hit, double scale, int srcWidth, int srcHeight) {
        int size = (int) Math.round(MATCH_ICON / scale);
        int x = Math.min(srcWidth - 1, (int) Math.round(hit.getX() / scale));
        int y = Math.min(srcHeight - 1, (int) Math.round(hit.getY() / scale));
        size = Math.max(12, Math.min(size, Math.min(srcWidth - x, srcHeight - y)));
        return new Match(hit.getKey(), x, y, size, hit.getDistance());
    }

    /** 3 通道积分图，用于 O(1) 求任意矩形区域的颜色和 */
    private long[][] integralImages(BufferedImage image) {
        int width = image.getWidth();
        int height = image.getHeight();
        long[][] sums = new long[3][(width + 1) * (height + 1)];
        for (int y = 0; y < height; y++) {
            long rowR = 0, rowG = 0, rowB = 0;
            int rowOffset = (y + 1) * (width + 1);
            int prevOffset = y * (width + 1);
            for (int x = 0; x < width; x++) {
                int rgb = image.getRGB(x, y);
                rowR += (rgb >> 16) & 0xFF;
                rowG += (rgb >> 8) & 0xFF;
                rowB += rgb & 0xFF;
                sums[0][rowOffset + x + 1] = sums[0][prevOffset + x + 1] + rowR;
                sums[1][rowOffset + x + 1] = sums[1][prevOffset + x + 1] + rowG;
                sums[2][rowOffset + x + 1] = sums[2][prevOffset + x + 1] + rowB;
            }
        }
        return sums;
    }

    private static long box(long[] sum, int stride, int left, int top, int right, int bottom) {
        return sum[bottom * stride + right] - sum[top * stride + right]
                - sum[bottom * stride + left] + sum[top * stride + left];
    }

    private double[] descriptorAt(int x, int y, int size, long[][] sums, int imageWidth) {
        double[] out = new double[GRID * GRID * 3];
        int margin = (int) Math.round(size * INSET);
        int usable = size - margin * 2;
        int stride = imageWidth + 1;
        for (int gy = 0; gy < GRID; gy++) {
            int top = y + margin + gy * usable / GRID;
            int bottom = y + margin + (gy + 1) * usable / GRID;
            for (int gx = 0; gx < GRID; gx++) {
                int left = x + margin + gx * usable / GRID;
                int right = x + margin + (gx + 1) * usable / GRID;
                int area = Math.max(1, (right - left) * (bottom - top));
                int idx = (gy * GRID + gx) * 3;
                out[idx] = box(sums[0], stride, left, top, right, bottom) / (area * 255.0);
                out[idx + 1] = box(sums[1], stride, left, top, right, bottom) / (area * 255.0);
                out[idx + 2] = box(sums[2], stride, left, top, right, bottom) / (area * 255.0);
            }
        }
        return out;
    }

    /** 方形图片的描述子（模板用）：先缩放到匹配尺寸再取网格均值 */
    private double[] descriptorOfSquare(BufferedImage image) {
        BufferedImage square = resize(image, MATCH_ICON, MATCH_ICON);
        int margin = (int) Math.round(MATCH_ICON * INSET);
        int usable = MATCH_ICON - margin * 2;
        double[] out = new double[GRID * GRID * 3];
        for (int gy = 0; gy < GRID; gy++) {
            int top = margin + gy * usable / GRID;
            int bottom = margin + (gy + 1) * usable / GRID;
            for (int gx = 0; gx < GRID; gx++) {
                int left = margin + gx * usable / GRID;
                int right = margin + (gx + 1) * usable / GRID;
                double r = 0, g = 0, b = 0;
                int count = 0;
                for (int yy = top; yy < bottom; yy++) {
                    for (int xx = left; xx < right; xx++) {
                        int rgb = square.getRGB(xx, yy);
                        r += (rgb >> 16) & 0xFF;
                        g += (rgb >> 8) & 0xFF;
                        b += rgb & 0xFF;
                        count++;
                    }
                }
                int idx = (gy * GRID + gx) * 3;
                double volume = Math.max(1, count) * 255.0;
                out[idx] = r / volume;
                out[idx + 1] = g / volume;
                out[idx + 2] = b / volume;
            }
        }
        return out;
    }

    private static double distance(double[] a, double[] b) {
        if (a == null || b == null) {
            return Double.MAX_VALUE;
        }
        double sum = 0;
        for (int i = 0; i < a.length; i++) {
            double diff = a[i] - b[i];
            sum += diff * diff;
        }
        return Math.sqrt(sum / a.length);
    }

    private static BufferedImage resize(BufferedImage source, int width, int height) {
        BufferedImage target = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = target.createGraphics();
        g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
        g.drawImage(source, 0, 0, width, height, null);
        g.dispose();
        return target;
    }

    /** 命中结果：图标左上角与原图坐标下的边长 */
    public static class Match {
        private final String key;
        private final int x;
        private final int y;
        private final int size;
        private final double distance;

        Match(String key, int x, int y, int size, double distance) {
            this.key = key;
            this.x = x;
            this.y = y;
            this.size = size;
            this.distance = distance;
        }

        public String getKey() {
            return key;
        }

        public int getX() {
            return x;
        }

        public int getY() {
            return y;
        }

        public int getSize() {
            return size;
        }

        public double getDistance() {
            return distance;
        }
    }
}

package com.southair.genshin.module.ocr;

import com.southair.genshin.common.BusinessException;
import com.southair.genshin.module.ocr.dto.OcrEngineStatus;
import com.southair.genshin.module.ocr.dto.OcrRawResult;
import com.southair.genshin.module.ocr.dto.OcrResourceResult;
import com.southair.genshin.module.ocr.dto.OcrWishResult;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 图像识别服务：负责引擎调度、输入校验与结果解析。
 */
@Service
public class OcrService {

    public static final String ENGINE_TESSERACT = "tesseract";
    public static final String ENGINE_BROWSER = "browser";

    /** 单张图片上限，避免过大请求拖垮服务 */
    private static final long MAX_BYTES = 8L * 1024 * 1024;

    private static final Set<String> ALLOWED_TYPES = new HashSet<>(Arrays.asList(
            "image/png", "image/jpeg", "image/jpg", "image/webp", "image/bmp", "image/gif"));

    private final TesseractEngine tesseractEngine;
    private final OcrTextParser parser;
    private final OcrResourceParser resourceParser;
    private final ItemIconMatcher itemIconMatcher;
    private final ConstellationRecognizer constellationRecognizer;

    public OcrService(TesseractEngine tesseractEngine, OcrTextParser parser, OcrResourceParser resourceParser,
                      ItemIconMatcher itemIconMatcher, ConstellationRecognizer constellationRecognizer) {
        this.tesseractEngine = tesseractEngine;
        this.parser = parser;
        this.resourceParser = resourceParser;
        this.itemIconMatcher = itemIconMatcher;
        this.constellationRecognizer = constellationRecognizer;
    }

    public OcrEngineStatus status() {
        OcrEngineStatus status = new OcrEngineStatus();
        status.setTesseractAvailable(tesseractEngine.isAvailable());
        status.setTesseractHint(tesseractEngine.getHint());
        status.setBrowserAvailable(true);
        return status;
    }

    public OcrWishResult recognizeWishes(MultipartFile file, String engine, String game) {
        validate(file);
        requireTesseract(engine);
        TesseractEngine.OcrOutput output = recognize(file);
        OcrWishResult result = parser.parseWishes(output.getText(), output.getTsv(), game);
        result.setEngine(ENGINE_TESSERACT);
        return result;
    }

    public OcrResourceResult recognizeResource(MultipartFile file, String engine) {
        validate(file);
        requireTesseract(engine);
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new BusinessException("读取图片失败：" + e.getMessage());
        }
        TesseractEngine.OcrOutput output = tesseractEngine.recognizeWithTsv(
                bytes, resolveExtension(file));
        OcrResourceResult result = resourceParser.parse(output.getText(), output.getTsv());
        refineBottomNumbers(bytes, output.getTsv(), result);
        fillGridItems(bytes, output.getText(), result);
        result.setEngine(ENGINE_TESSERACT);
        return result;
    }

    /**
     * 底栏的原石 / 摩拉数字用整页识别容易出现单字符误差（例如 6 被认成 0）。
     * 按整页 TSV 给出的数字位置重新裁剪、放大并加数字白名单识别一次；
     * 只有位数不变时才替换，避免误用别处的数字。
     */
    private void refineBottomNumbers(byte[] bytes, String tsv, OcrResourceResult result) {
        Long primogems = result.getValues().get("primogems");
        Long mora = result.getValues().get("mora");
        if (primogems == null && mora == null) {
            return;
        }
        int[][] boxes = resourceParser.bottomNumberBoxes(tsv);
        if (boxes == null) {
            return;
        }
        BufferedImage image;
        try {
            image = ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (IOException e) {
            return;
        }
        if (image == null) {
            return;
        }
        String[] keys = {"primogems", "mora"};
        for (int i = 0; i < keys.length; i++) {
            Long current = result.getValues().get(keys[i]);
            if (current == null || boxes[i] == null) {
                continue;
            }
            int[] box = boxes[i];
            int pad = Math.max(2, box[3] / 3);
            int left = Math.max(0, box[0] - pad);
            int top = Math.max(0, box[1] - pad);
            int right = Math.min(image.getWidth(), box[0] + box[2] + pad);
            int bottom = Math.min(image.getHeight(), box[1] + box[3] + pad);
            if (right - left < 8 || bottom - top < 6) {
                continue;
            }
            Long value = extractNumber(tesseractEngine.recognizeNumber(
                    toPng(upscale(image.getSubimage(left, top, right - left, bottom - top), 3)), ".png"));
            if (value == null || String.valueOf(value).length() != String.valueOf(current).length()) {
                continue;
            }
            result.getValues().put(keys[i], value);
        }
    }

    public OcrWishResult parseWishText(String text, String tsv, String game) {
        OcrWishResult result = parser.parseWishes(text, tsv, game);
        result.setEngine(ENGINE_BROWSER);
        return result;
    }

    /**
     * 只做文字 + 坐标识别，具体解析交给前端（出金历史等非原生截图格式）。
     *
     * @param mode {@code history} 走出金历史的二值化预处理；{@code page} 按普通整页识别
     *             （收藏识图用，需要读出左侧菜单「命之座」等正常文字）
     */
    public OcrRawResult recognizeRaw(MultipartFile file, String engine, String mode) {
        validate(file);
        requireTesseract(engine);
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new BusinessException("读取图片失败：" + e.getMessage());
        }
        String ext = resolveExtension(file);
        TesseractEngine.OcrOutput output = "page".equalsIgnoreCase(mode)
                ? tesseractEngine.recognizeWithTsv(bytes, ext)
                : tesseractEngine.recognizeHistory(bytes, ext);
        OcrRawResult result = new OcrRawResult();
        result.setEngine(ENGINE_TESSERACT);
        result.setText(output.getText());
        result.setTsv(output.getTsv());
        if ("page".equalsIgnoreCase(mode)) {
            BufferedImage image = readImage(bytes);
            result.setConstellation(readConstellation(image));
            result.setCharacterName(readCharacterName(image));
        }
        return result;
    }

    private BufferedImage readImage(byte[] bytes) {
        try {
            return ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    /**
     * 命之座界面没有「命座 N」这样的文字，改成数右侧 6 个节点的点亮个数。
     * 只有普通整页识别（收藏识图）才尝试，出金历史不会走这里。
     */
    private Integer readConstellation(BufferedImage image) {
        try {
            return constellationRecognizer.recognize(image);
        } catch (RuntimeException e) {
            return null;
        }
    }

    /** 左上角名称区域（元素 / 角色名，武器详情页则是武器名）占整图的比例；
     *  左边界跳过最左侧的元素图标，右边界避开顶部角色头像栏 */
    private static final double HEADER_LEFT = 0.070;
    private static final double HEADER_RIGHT = 0.22;
    private static final double HEADER_TOP = 0.012;
    private static final double HEADER_BOTTOM = 0.085;
    /** 左上角标题的白字阈值：高于该亮度视为文字 */
    private static final int HEADER_WHITE_THRESHOLD = 150;

    /**
     * 命之座 / 武器详情页左上角的小字整页识别经常漏掉，单独裁剪、放大并二值化后再做单行识别。
     *
     * @return 清理后的名称（如「甘雨」）；识别不到返回 null
     */
    private String readCharacterName(BufferedImage image) {
        if (image == null) {
            return null;
        }
        int width = image.getWidth();
        int height = image.getHeight();
        int left = (int) Math.round(width * HEADER_LEFT);
        int right = (int) Math.round(width * HEADER_RIGHT);
        int top = (int) Math.round(height * HEADER_TOP);
        int bottom = (int) Math.round(height * HEADER_BOTTOM);
        if (right - left < 20 || bottom - top < 10) {
            return null;
        }
        BufferedImage crop = image.getSubimage(left, top, right - left, bottom - top);
        BufferedImage enlarged = upscale(crop, 4);
        String lang = tesseractEngine.getChineseLanguage();
        // 游戏内标题是深色半透明底上的白字，直接放大识别效果最好
        String text = tesseractEngine.recognizeLine(toPng(enlarged), ".png", lang);
        String name = extractHeaderName(text);
        if (name == null) {
            // 背景较亮或压缩较重时白字对比度不足，再二值化成「浅底深字」重试
            byte[] png = toPng(binarizeHeader(enlarged));
            if (png != null) {
                name = extractHeaderName(tesseractEngine.recognizeLine(png, ".png", lang));
            }
        }
        return name;
    }

    /** 标题是深色半透明底上的白字；转成「浅底 + 深色字」更适合 tesseract 单行识别 */
    private BufferedImage binarizeHeader(BufferedImage image) {
        BufferedImage target = new BufferedImage(image.getWidth(), image.getHeight(),
                BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int rgb = image.getRGB(x, y);
                int r = (rgb >> 16) & 0xFF;
                int g = (rgb >> 8) & 0xFF;
                int b = rgb & 0xFF;
                int luminance = (int) (r * 0.299 + g * 0.587 + b * 0.114);
                target.setRGB(x, y, luminance >= HEADER_WHITE_THRESHOLD ? 0x000000 : 0xFFFFFF);
            }
        }
        return target;
    }

    /**
     * 从「冰元素 / 甘雨」这类标题里取出名称：
     * 去掉元素前缀、斜杠及其左侧内容，再清掉非汉字噪声。
     */
    private String extractHeaderName(String text) {
        if (!StringUtils.hasText(text)) {
            return null;
        }
        String compact = text.replaceAll("\\s+", "")
                .replace('／', '/')
                .replace('｜', '/')
                .replace('|', '/');
        // 空白/无关画面上 tesseract 可能只吐出一个噪声汉字，整行没有斜杠且汉字不足 2 个时视为无效
        if (!compact.contains("/") && compact.replaceAll("[^\\u4e00-\\u9fa5]", "").length() < 2) {
            return null;
        }
        compact = compact.replaceAll("(冰|火|水|雷|风|草|岩)元素", "");
        compact = compact.replaceAll("元素", "");
        int slash = compact.lastIndexOf('/');
        if (slash >= 0) {
            compact = compact.substring(slash + 1);
        }
        compact = compact.replaceAll("[^\\u4e00-\\u9fa5]", "");
        if (compact.isEmpty()) {
            return null;
        }
        // 极少数截图会把等级等尾部文字一起读入，只保留末尾最多 6 个汉字
        if (compact.length() > 6) {
            compact = compact.substring(compact.length() - 6);
        }
        return compact;
    }

    private void requireTesseract(String engine) {
        String normalized = engine == null ? "" : engine.trim().toLowerCase(Locale.ROOT);
        if (!normalized.isEmpty() && !ENGINE_TESSERACT.equals(normalized)) {
            throw new BusinessException("浏览器识别请在本地完成，仅把文本提交到 /api/ocr/parse");
        }
    }

    private TesseractEngine.OcrOutput recognize(MultipartFile file) {
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new BusinessException("读取图片失败：" + e.getMessage());
        }
        return tesseractEngine.recognizeWithTsv(bytes, resolveExtension(file));
    }

    /** 数字提取：兼容「S532」这类带少量噪声的格子识别结果 */
    private static final Pattern DIGIT_VALUE =
            Pattern.compile("(\\d{1,3}(?:,\\d{3})+|\\d+)");

    /**
     * 背包格子里的物品没有文字名称，只有图标和数量。
     * 先按图案（颜色分布）定位纠缠之缘 / 相遇之缘或三本经验书，再读取命中格子里的数量，
     * 因此不依赖背包排序，物品在任意位置都能识别。
     */
    private void fillGridItems(byte[] bytes, String text, OcrResourceResult result) {
        String compact = text == null ? "" : text.replaceAll("\\s+", "");
        boolean fates = compact.contains("贵重道具");
        boolean books = compact.contains("养成道具");
        BufferedImage image;
        try {
            image = ImageIO.read(new ByteArrayInputStream(bytes));
        } catch (IOException e) {
            return;
        }
        if (image == null) {
            return;
        }
        String[] keys;
        if (fates && !books) {
            keys = new String[]{ItemIconMatcher.INTERTWINED_FATES, ItemIconMatcher.ACQUAINTED_FATES};
        } else if (books && !fates) {
            keys = new String[]{ItemIconMatcher.HERO_WIT, ItemIconMatcher.ADVENTURER_EXP,
                    ItemIconMatcher.WANDERER_ADVICE};
        } else {
            // 标题没识别出来（低分辨率、界面缩放不同）时两类都试，避免整页漏识别
            keys = new String[]{ItemIconMatcher.INTERTWINED_FATES, ItemIconMatcher.ACQUAINTED_FATES,
                    ItemIconMatcher.HERO_WIT, ItemIconMatcher.ADVENTURER_EXP, ItemIconMatcher.WANDERER_ADVICE};
        }
        Map<String, ItemIconMatcher.Match> matches = itemIconMatcher.locate(image, Arrays.asList(keys));
        for (String key : keys) {
            if (result.getValues().containsKey(key)) {
                continue;
            }
            ItemIconMatcher.Match match = matches.get(key);
            if (match == null) {
                continue;
            }
            Long value = readCount(image, match);
            if (value != null) {
                result.getValues().put(key, value);
                result.getMissing().remove(key);
            }
        }
    }

    /**
     * 读取命中图标下方的数量。
     *
     * <p>不依赖固定行距：在图标下方找卡片底部那条「明亮低饱和」的浅色条，数字就在里面。
     * 先直接识别，失败再把浅色条二值化（去掉金色品质星）后识别，两次都不做全局的竖线替换，
     * 避免把装饰线当成数字 1。</p>
     */
    private Long readCount(BufferedImage image, ItemIconMatcher.Match match) {
        int width = image.getWidth();
        int height = image.getHeight();
        int size = match.getSize();
        int cellWidth = (int) Math.round(size / 0.8);
        int left = Math.max(0, match.getX() + size / 2 - cellWidth / 2);
        int cropWidth = Math.min(cellWidth, width - left);
        if (cropWidth <= 6) {
            return null;
        }
        // 只在本卡片范围内找数量条：卡片行距约为 1.5 倍图标边长，
        // 扫描下界必须小于行距，否则会扫到下一行卡片，读到别格的数量。
        int scanTop = Math.min(height - 5, match.getY() + (int) Math.round(size * 0.45));
        int scanBottom = Math.min(height - 1, match.getY() + (int) Math.round(size * 1.9));
        if (scanBottom - scanTop < 6) {
            return null;
        }
        int[] band = findLightBand(image, left, cropWidth, scanTop, scanBottom);
        if (band == null) {
            return null;
        }
        int top = Math.max(0, band[0] - 4);
        int bottom = Math.min(height, band[1] + 5);
        BufferedImage crop = image.getSubimage(left, top, cropWidth, bottom - top);
        BufferedImage enlarged = upscale(crop, 3);
        Long value = extractNumber(tesseractEngine.recognizeDigits(toPng(enlarged), ".png"));
        if (value != null) {
            return value;
        }
        // 直接识别失败时，先把放大后的浅色条二值化（保留深色数字、去掉金色品质星）再识别
        return extractNumber(tesseractEngine.recognizeDigits(
                toPng(binarize(enlarged, 140)), ".png"));
    }

    /**
     * 在指定竖向范围内找卡片底部的浅色条（亮度高、饱和度低）。
     *
     * <p>取「自上而下第一段足够高的浅色条」，也就是紧贴当前图标下方的那一条；
     * 不用最长的一段，避免在某些布局下选中下一行卡片的数量条。</p>
     */
    private int[] findLightBand(BufferedImage image, int left, int cropWidth, int top, int bottom) {
        int xFrom = left + 3;
        int xTo = left + cropWidth - 3;
        if (xTo <= xFrom) {
            return null;
        }
        int start = -1;
        int length = 0;
        for (int y = top; y < bottom; y++) {
            if (isLightRow(image, xFrom, xTo, y)) {
                if (start < 0) {
                    start = y;
                    length = 0;
                }
                length++;
            } else if (start >= 0) {
                if (length >= 6) {
                    return new int[]{start, y - 1};
                }
                start = -1;
            }
        }
        if (start >= 0 && length >= 6) {
            return new int[]{start, bottom - 1};
        }
        return null;
    }

    private boolean isLightRow(BufferedImage image, int xFrom, int xTo, int y) {
        int light = 0;
        int total = 0;
        for (int x = xFrom; x < xTo; x++) {
            int rgb = image.getRGB(x, y);
            int r = (rgb >> 16) & 0xFF;
            int g = (rgb >> 8) & 0xFF;
            int b = rgb & 0xFF;
            int luminance = (int) (r * 0.299 + g * 0.587 + b * 0.114);
            float[] hsb = java.awt.Color.RGBtoHSB(r, g, b, null);
            total++;
            if (luminance > 185 && hsb[1] < 0.22) {
                light++;
            }
        }
        return total > 0 && light > total * 0.55;
    }

    /** 按亮度阈值二值化，去掉浅色底与金色品质星，只留下深色数字 */
    private BufferedImage binarize(BufferedImage image, int threshold) {
        BufferedImage target = new BufferedImage(image.getWidth(), image.getHeight(),
                BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                int rgb = image.getRGB(x, y);
                int r = (rgb >> 16) & 0xFF;
                int g = (rgb >> 8) & 0xFF;
                int b = rgb & 0xFF;
                int luminance = (int) (r * 0.299 + g * 0.587 + b * 0.114);
                target.setRGB(x, y, luminance < threshold ? 0x000000 : 0xFFFFFF);
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
            ByteArrayOutputStream stream = new ByteArrayOutputStream();
            ImageIO.write(image, "png", stream);
            return stream.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    private Long extractNumber(String text) {
        if (!StringUtils.hasText(text)) {
            return null;
        }
        Matcher matcher = DIGIT_VALUE.matcher(text);
        while (matcher.find()) {
            String digits = matcher.group(1).replace(",", "");
            try {
                long value = Long.parseLong(digits);
                if (value > 0 && value <= 999_999_999L) {
                    return value;
                }
            } catch (NumberFormatException ignored) {
                // 继续找下一个数字
            }
        }
        return null;
    }

    private void validate(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException("请先选择一张截图");
        }
        if (file.getSize() > MAX_BYTES) {
            throw new BusinessException("图片不能超过 8MB");
        }
        String mime = resolveMime(file);
        String name = file.getOriginalFilename();
        boolean byType = ALLOWED_TYPES.contains(mime);
        boolean byName = name != null && name.toLowerCase(Locale.ROOT).matches(".*\\.(png|jpg|jpeg|webp|bmp|gif)$");
        if (!byType && !byName) {
            throw new BusinessException("仅支持 PNG / JPG / WEBP / BMP / GIF 格式的图片");
        }
    }

    private String resolveMime(MultipartFile file) {
        String contentType = file.getContentType();
        if (StringUtils.hasText(contentType) && contentType.startsWith("image/")) {
            return contentType.toLowerCase(Locale.ROOT);
        }
        String ext = resolveExtension(file);
        switch (ext) {
            case ".jpg":
            case ".jpeg":
                return "image/jpeg";
            case ".webp":
                return "image/webp";
            case ".bmp":
                return "image/bmp";
            case ".gif":
                return "image/gif";
            default:
                return "image/png";
        }
    }

    private String resolveExtension(MultipartFile file) {
        String name = file.getOriginalFilename();
        if (name != null) {
            int dot = name.lastIndexOf('.');
            if (dot >= 0 && dot < name.length() - 1) {
                String ext = name.substring(dot).toLowerCase(Locale.ROOT);
                if (ext.length() <= 5) {
                    return ext;
                }
            }
        }
        String mime = file.getContentType();
        if (mime != null) {
            switch (mime.toLowerCase(Locale.ROOT)) {
                case "image/jpeg":
                    return ".jpg";
                case "image/webp":
                    return ".webp";
                case "image/bmp":
                    return ".bmp";
                case "image/gif":
                    return ".gif";
                default:
                    break;
            }
        }
        return ".png";
    }
}

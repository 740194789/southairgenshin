package com.southair.genshin.module.ocr;

import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 本地 Tesseract 引擎：调用系统安装的 tesseract 命令行完成 OCR。
 *
 * <p>需要本机安装 tesseract 并准备中文语言包（chi_sim）。</p>
 */
@Component
public class TesseractEngine {

    /** 可用性检测结果缓存时长（毫秒），避免每次请求都启动进程 */
    private static final long CHECK_TTL = 60_000L;
    /** 截图宽度低于该值时先放大，明显提升小字号中文的识别率 */
    private static final int MIN_WIDTH = 1000;

    private final OcrProperties properties;

    private volatile long checkedAt = 0L;
    private volatile boolean available = false;
    private volatile String hint = "";

    public TesseractEngine(OcrProperties properties) {
        this.properties = properties;
    }

    public boolean isAvailable() {
        long now = System.currentTimeMillis();
        if (now - checkedAt < CHECK_TTL) {
            return available;
        }
        refresh();
        return available;
    }

    public String getHint() {
        isAvailable();
        return hint;
    }

    private synchronized void refresh() {
        long now = System.currentTimeMillis();
        if (now - checkedAt < CHECK_TTL) {
            return;
        }
        checkedAt = now;
        try {
            Process process = new ProcessBuilder(command(), "--version").redirectErrorStream(true).start();
            boolean done = process.waitFor(3, TimeUnit.SECONDS);
            if (!done) {
                process.destroyForcibly();
                available = false;
                hint = "tesseract 响应超时";
                return;
            }
            available = process.exitValue() == 0;
            hint = available ? "" : "tesseract 无法执行，请检查安装路径";
        } catch (Exception e) {
            available = false;
            hint = "未检测到 tesseract，请安装后重试（或配置 app.ocr.tesseract.command）";
        }
    }

    private String command() {
        String cmd = properties.getTesseract().getCommand();
        return cmd == null || cmd.trim().isEmpty() ? "tesseract" : cmd.trim();
    }

    /**
     * 识别图片，一次同时得到文本与 TSV（含每个词的坐标，用于前端头像匹配）。
     *
     * @param image 图片字节
     * @param ext   扩展名（含点），如 .png
     */
    public OcrOutput recognizeWithTsv(byte[] image, String ext) {
        return run(image, ext);
    }

    /** 识别结果：文本 + 已换算回原图坐标的 TSV */
    public static class OcrOutput {
        private final String text;
        private final String tsv;

        OcrOutput(String text, String tsv) {
            this.text = text;
            this.tsv = tsv;
        }

        public String getText() {
            return text;
        }

        public String getTsv() {
            return tsv;
        }
    }

    private OcrOutput run(byte[] image, String ext) {
        if (!isAvailable()) {
            throw new IllegalStateException(hint.isEmpty() ? "本机未安装 tesseract" : hint);
        }
        Path input = null;
        Path dir = null;
        double scale = 1.0;
        try {
            byte[] data = image;
            String writeExt = ext == null || ext.isEmpty() ? ".png" : ext;
            ScaledImage scaled = scaleUp(image);
            if (scaled != null) {
                data = scaled.data;
                scale = scaled.scale;
                writeExt = ".png";
            }

            dir = Files.createTempDirectory("sag-ocr-");
            input = dir.resolve("input" + writeExt);
            Files.write(input, data);
            Path outputBase = dir.resolve("out");

            List<String> args = new ArrayList<>(Arrays.asList(
                    command(), input.toString(), outputBase.toString(),
                    "-l", properties.getTesseract().getLang(), "--psm", "6",
                    "-c", "tessedit_create_tsv=1"));

            Process process = new ProcessBuilder(args).redirectErrorStream(true).start();
            int timeout = Math.max(5, properties.getTesseract().getTimeoutSeconds());
            if (!process.waitFor(timeout, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("tesseract 识别超时（" + timeout + " 秒）");
            }
            if (process.exitValue() != 0) {
                throw new IllegalStateException("tesseract 识别失败，请确认已安装 chi_sim 中文语言包");
            }

            String text = readQuietly(dir.resolve("out.txt"));
            String tsv = readQuietly(dir.resolve("out.tsv"));
            // 坐标还原到原图尺寸，前端裁剪头像时直接用原图像素
            return new OcrOutput(text, adjustTsv(tsv, scale));
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new IllegalStateException("调用 tesseract 失败：" + e.getMessage());
        } finally {
            deleteQuietly(input);
            if (dir != null) {
                deleteQuietly(dir.toFile());
            }
        }
    }

    /**
     * 小尺寸截图先放大，避免小字号中文被识别成字母。
     *
     * @return 放大后的 PNG 字节与缩放比例；无需放大或读取失败时返回 null
     */
    private ScaledImage scaleUp(byte[] image) {
        try {
            BufferedImage src = ImageIO.read(new ByteArrayInputStream(image));
            if (src == null || src.getWidth() >= MIN_WIDTH) {
                return null;
            }
            double scale = Math.min(3.0, Math.max(2.0, (double) MIN_WIDTH / src.getWidth()));
            int width = (int) Math.round(src.getWidth() * scale);
            int height = (int) Math.round(src.getHeight() * scale);
            BufferedImage dst = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
            Graphics2D g = dst.createGraphics();
            g.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            g.drawImage(src, 0, 0, width, height, null);
            g.dispose();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(dst, "png", out);
            return new ScaledImage(out.toByteArray(), scale);
        } catch (Exception e) {
            return null;
        }
    }

    private static class ScaledImage {
        private final byte[] data;
        private final double scale;

        ScaledImage(byte[] data, double scale) {
            this.data = data;
            this.scale = scale;
        }
    }

    private String readQuietly(Path path) {
        try {
            return Files.exists(path) ? new String(Files.readAllBytes(path), StandardCharsets.UTF_8) : "";
        } catch (IOException e) {
            return "";
        }
    }

    /** 把 TSV 中 left / top / width / height 从放大图坐标换算回原图坐标 */
    private String adjustTsv(String tsv, double scale) {
        if (tsv == null || tsv.isEmpty() || scale <= 0 || Math.abs(scale - 1.0) < 1e-6) {
            return tsv;
        }
        String[] rows = tsv.split("\n");
        StringBuilder sb = new StringBuilder(tsv.length());
        for (int i = 0; i < rows.length; i++) {
            String row = rows[i];
            if (i > 0 && !row.trim().isEmpty()) {
                String[] cols = row.split("\t", -1);
                if (cols.length >= 12) {
                    for (int c = 6; c <= 9; c++) {
                        try {
                            int value = Integer.parseInt(cols[c].trim());
                            cols[c] = String.valueOf(Math.max(0, (int) Math.round(value / scale)));
                        } catch (NumberFormatException ignored) {
                            // 非数字列保持原样
                        }
                    }
                    row = String.join("\t", cols);
                }
            }
            sb.append(row);
            if (i < rows.length - 1) {
                sb.append('\n');
            }
        }
        return sb.toString();
    }

    private void deleteQuietly(Object target) {
        try {
            if (target instanceof File) {
                File file = (File) target;
                if (file.isDirectory()) {
                    File[] children = file.listFiles();
                    if (children != null) {
                        for (File child : children) {
                            child.delete();
                        }
                    }
                }
                file.delete();
            }
        } catch (Exception ignored) {
            // 临时文件清理失败不影响主流程
        }
    }
}

package com.southair.genshin.module.ocr;

import com.southair.genshin.common.BusinessException;
import com.southair.genshin.module.ocr.dto.OcrEngineStatus;
import com.southair.genshin.module.ocr.dto.OcrWishResult;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

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

    public OcrService(TesseractEngine tesseractEngine, OcrTextParser parser) {
        this.tesseractEngine = tesseractEngine;
        this.parser = parser;
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
        String normalized = engine == null ? "" : engine.trim().toLowerCase(Locale.ROOT);
        if (normalized.isEmpty()) {
            normalized = ENGINE_TESSERACT;
        }
        if (!ENGINE_TESSERACT.equals(normalized)) {
            throw new BusinessException("浏览器识别请在本地完成，仅把文本提交到 /api/ocr/parse");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            throw new BusinessException("读取图片失败：" + e.getMessage());
        }
        String ext = resolveExtension(file);
        TesseractEngine.OcrOutput output = tesseractEngine.recognizeWithTsv(bytes, ext);
        OcrWishResult result = parser.parseWishes(output.getText(), output.getTsv(), game);
        result.setEngine(ENGINE_TESSERACT);
        return result;
    }

    public OcrWishResult parseWishText(String text, String tsv, String game) {
        OcrWishResult result = parser.parseWishes(text, tsv, game);
        result.setEngine(ENGINE_BROWSER);
        return result;
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

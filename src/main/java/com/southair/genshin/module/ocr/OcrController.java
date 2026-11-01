package com.southair.genshin.module.ocr;

import com.southair.genshin.common.R;
import com.southair.genshin.module.ocr.dto.OcrEngineStatus;
import com.southair.genshin.module.ocr.dto.OcrParseRequest;
import com.southair.genshin.module.ocr.dto.OcrRawResult;
import com.southair.genshin.module.ocr.dto.OcrWishResult;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import javax.validation.Valid;

/**
 * 抽卡记录图像识别接口。
 *
 * <p>本地 Tesseract 由后端直接处理图片；浏览器 tesseract.js
 * 在前端识别后，把文本与 TSV 坐标提交到 {@code /api/ocr/parse} 由后端统一解析。</p>
 */
@RestController
@RequestMapping("/api/ocr")
public class OcrController {

    private final OcrService ocrService;

    public OcrController(OcrService ocrService) {
        this.ocrService = ocrService;
    }

    /** 各引擎可用状态。 */
    @GetMapping("/engines")
    public R<OcrEngineStatus> engines() {
        return R.ok(ocrService.status());
    }

    /** 识别抽卡记录截图。 */
    @PostMapping("/wishes")
    public R<OcrWishResult> wishes(@RequestParam("file") MultipartFile file,
                                   @RequestParam(defaultValue = "tesseract") String engine,
                                   @RequestParam(defaultValue = "genshin") String game) {
        return R.ok(ocrService.recognizeWishes(file, engine, game));
    }

    /** 只返回文字与坐标，供前端解析其它截图格式（出金历史）。 */
    @PostMapping("/raw")
    public R<OcrRawResult> raw(@RequestParam("file") MultipartFile file,
                               @RequestParam(defaultValue = "tesseract") String engine) {
        return R.ok(ocrService.recognizeRaw(file, engine));
    }

    /** 浏览器 OCR 回传文本的解析入口。 */
    @PostMapping("/parse")
    public R<OcrWishResult> parse(@Valid @RequestBody OcrParseRequest request,
                                  @RequestParam(defaultValue = "genshin") String game) {
        return R.ok(ocrService.parseWishText(request.getText(), request.getTsv(), game));
    }
}

package com.southair.genshin.module.ocr.dto;

import javax.validation.constraints.NotBlank;

/**
 * 浏览器端 OCR 识别完成后回传的文本与 TSV（含每行坐标），用于后端统一解析。
 */
public class OcrParseRequest {

    @NotBlank(message = "识别文本为空")
    private String text;

    /** tesseract TSV，用于给候选记录补上截图坐标（可为空） */
    private String tsv;

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }

    public String getTsv() {
        return tsv;
    }

    public void setTsv(String tsv) {
        this.tsv = tsv;
    }
}

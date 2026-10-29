package com.southair.genshin.module.ocr.dto;

import javax.validation.constraints.NotBlank;

/**
 * 浏览器端 OCR 识别完成后回传的纯文本，用于后端统一解析。
 */
public class OcrParseRequest {

    public static final String KIND_RESOURCE = "resource";
    public static final String KIND_WISHES = "wishes";

    /** resource / wishes */
    @NotBlank(message = "缺少识别类型")
    private String kind;

    @NotBlank(message = "识别文本为空")
    private String text;

    public String getKind() {
        return kind;
    }

    public void setKind(String kind) {
        this.kind = kind;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }
}

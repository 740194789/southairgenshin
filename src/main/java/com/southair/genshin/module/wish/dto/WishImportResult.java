package com.southair.genshin.module.wish.dto;

import java.io.Serializable;

/**
 * 抽卡记录导入结果。
 */
public class WishImportResult implements Serializable {

    private static final long serialVersionUID = 1L;

    /** merge / replace */
    private String mode;
    /** 成功写入的条数 */
    private int imported;
    /** 因重复或无效被跳过的条数 */
    private int skipped;
    /** 按记录规则被忽略的条数（三星物品、四星武器 / 光锥） */
    private int filtered;

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public int getImported() {
        return imported;
    }

    public void setImported(int imported) {
        this.imported = imported;
    }

    public int getSkipped() {
        return skipped;
    }

    public void setSkipped(int skipped) {
        this.skipped = skipped;
    }

    public int getFiltered() {
        return filtered;
    }

    public void setFiltered(int filtered) {
        this.filtered = filtered;
    }
}

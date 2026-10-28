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
}

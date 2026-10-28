package com.southair.genshin.module.backup;

import java.io.Serializable;

/**
 * 导入结果统计。
 */
public class ImportResultVO implements Serializable {

    private static final long serialVersionUID = 1L;

    /** merge / replace */
    private String mode;
    private int wishes;
    /** 因重复或无效被跳过的条数 */
    private int skipped;
    /** 是否更新了账号资源 */
    private boolean resourceUpdated;

    public String getMode() {
        return mode;
    }

    public void setMode(String mode) {
        this.mode = mode;
    }

    public int getWishes() {
        return wishes;
    }

    public void setWishes(int wishes) {
        this.wishes = wishes;
    }

    public int getSkipped() {
        return skipped;
    }

    public void setSkipped(int skipped) {
        this.skipped = skipped;
    }

    public boolean isResourceUpdated() {
        return resourceUpdated;
    }

    public void setResourceUpdated(boolean resourceUpdated) {
        this.resourceUpdated = resourceUpdated;
    }
}
